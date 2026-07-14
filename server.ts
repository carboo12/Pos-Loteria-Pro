import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

// ─── FIREBASE ADMIN: import segura para esbuild CJS ─────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const firebaseAdmin: any = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("firebase-admin");
    return mod?.default || mod;
  } catch {
    return null;
  }
})();

if (!firebaseAdmin) {
  console.error("[Firebase Admin] No se pudo importar el módulo 'firebase-admin'. Verifique que esté instalado.");
}

const app = express();
const activePaymentLocks = new Set<string>();

// ─── SESIONES SEGURAS (crypto + TTL) ──────────────────────────────────
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const sessions = new Map<string, { user: any; createdAt: number }>();

function generateSessionToken(): string {
  return "sess_" + crypto.randomBytes(32).toString("hex");
}

function createSession(user: any): string {
  const token = generateSessionToken();
  sessions.set(token, { user, createdAt: Date.now() });
  return token;
}

function validateSession(token: string): any | null {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session.user;
}

function destroySession(token: string): void {
  sessions.delete(token);
}

// Limpieza periódica de sesiones expiradas (cada 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}, 30 * 60 * 1000);

// ─── MIDDLEWARE checkAuth (con soporte de roles) ───────────────────────
function checkAuth(allowedRoles?: string[]) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers.authorization;
    const routeLabel = `${req.method} ${req.path}`;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log(`[Auth] 401 → ${routeLabel} — No Bearer token. Headers: ${JSON.stringify(Object.keys(req.headers))}`);
      return res.status(401).json({ error: "No token provided." });
    }
    try {
      const token = authHeader.split(" ")[1];
      const sessionUser = validateSession(token);

      console.log(`[Auth] Token "${token.substring(0, 16)}..." → ${routeLabel} | Sesiones activas: ${sessions.size} | Resultado: ${sessionUser ? "VALID (" + sessionUser.rol + ")" : "INVALID"}`);

      if (!sessionUser) {
        return res.status(401).json({ error: "Sesión inválida o expirada. Por favor inicie sesión nuevamente." });
      }

      // Re-validar que el usuario sigue existiendo y activo en la DB
      const freshUser = db.usuarios.find((u: any) => u.id === sessionUser.id);
      if (!freshUser) {
        destroySession(token);
        return res.status(401).json({ error: "Usuario no encontrado. Sesión cerrada." });
      }
      if (!freshUser.activo) {
        destroySession(token);
        return res.status(403).json({ error: "Cuenta desactivada. Sesión cerrada." });
      }

      // Verificación de roles
      if (allowedRoles && allowedRoles.length > 0) {
        const userRole = freshUser.rol;
        if (!allowedRoles.includes(userRole)) {
          return res.status(403).json({ error: `Acceso denegado. Se requiere uno de estos roles: ${allowedRoles.join(", ")}.` });
        }
      }

      // Inyectar datos frescos del usuario en la request
      (req as any).user = { ...freshUser, password: undefined };
      return next();
    } catch (err) {
      console.error("[Auth] Error verificando sesión:", err);
      return res.status(401).json({ error: "Invalid token." });
    }
  };
}

const requireAdmin = checkAuth(["administrador"]);



function calculatePrizeMultiplier(juego: string, sorteo: string): number {
  const cleanJuego = juego.trim();
  if (cleanJuego === "Premia2" && sorteo.includes("(NI)")) return 4000;
  if (cleanJuego === "Jugá 3") return 600;
  if (cleanJuego === "Fechas") return 210;
  if (cleanJuego === "3 Monazos") return 650;
  return 80;
}

const PORT = parseInt(process.env.PORT || "8080", 10);

// ─── HEALTH CHECK: responde ANTES de todo middleware ─────────────────
app.get("/health", (_req, res) => {
  res.status(200).send("OK");
});

// ─── CORS: abierto para diagnosticar el bloqueo POST ────────────────
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: "10mb" }));

// ─── REQUEST LOGGER: TODAS las peticiones ───────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin || "no-origin";
  const ua = (req.headers["user-agent"] || "").substring(0, 60);
  process.stdout.write(`[HTTP] ${req.method} ${req.originalUrl} | origin=${origin} | ct=${req.headers["content-type"] || "N/A"} | ua=${ua}\n`);
  next();
});

// ─── FIREBASE CONFIGURATION (hardcoded — no editable) ────────────────
const FIREBASE_PROJECT_ID = "rapigestion-2";
const FIRESTORE_DATABASE_ID = "ai-studio-puntodeventadelo-99bc134f-793f-40a0-acdb-49f626766fdc";
console.log(`[Firebase] Proyecto: ${FIREBASE_PROJECT_ID} | Database: ${FIRESTORE_DATABASE_ID}`);

function getFirestoreInstance() {
  const firestoreDb = getFirestore(FIRESTORE_DATABASE_ID);
  return firestoreDb;
}

function getLocalDateString(date = new Date()): string {
  const offset = -6; // CST/GMT-6 for Nicaragua/Honduras
  const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
  const localDate = new Date(utc + (3600000 * offset));
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, "0");
  const day = String(localDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}


// ─── SERVER DATA INTERFACES ────────────────────────────────────────────
interface ServerSorteo {
  id: string;
  juego: string;
  hora_sorteo: string;
  hora_cierre: string;
  nombre: string;
  dias_habilitados?: number[];
}

interface ServerConfiguracion {
  tasa_cambio: number;
  contador_global_tickets: number;
  formato_ticket: any;
  sorteos: ServerSorteo[];
  limites_numeros: any[];
  resultados: any[];
  cobros: any[];
  ingresos?: any[];
  pagos_comision?: any[];
}

interface ServerUsuario {
  id: string;
  requiereCambioPassword: boolean;
  nombre: string;
  usuario: string;
  rol: string;
  estado: string;
  conexion: string;
  activo: boolean;
  region: string;
  email: string;
  id_supervisor: string;
  vendedoresAsignados: any[];
  password?: string;
  configuracion?: ServerConfiguracion;
}

interface ServerDB {
  usuarios: ServerUsuario[];
  configuracion: ServerConfiguracion;
  ventas: any[];
  cierres_caja: any[];
  resumenes_diarios: any[];
  cobros_admin: any[];
  pagos_comision: any[];
  fcm_tokens: string[];
}

// In-memory defaults — all persistence is in Firestore. No local file I/O.
function initDatabase(): ServerDB {
  const initialDB: ServerDB = {
    usuarios: [
      {
        id: "admin_1",
        requiereCambioPassword: true, nombre: "Administrador Global", usuario: "admin", rol: "administrador", estado: "activo", conexion: "online", activo: true, region: "Nicaragua", email: "carboo12@gmail.com", id_supervisor: "", vendedoresAsignados: []
      }
    ],
    configuracion: {
      tasa_cambio: 36.50,
      contador_global_tickets: 1000,
      formato_ticket: {
        titulo: "LA NUEVA ERA",
        ruc: "exiga su ticket en su compra de su numero.",
        mensaje_pie: "¡Gracias por su compra! Verifique su ticket en línea."
      },
      sorteos: [
        // Nicaragua (NI)
        { id: "ni_diaria_11", juego: "Diaria", hora_sorteo: "11:00", hora_cierre: "10:55", nombre: "Diaria 11:00 AM (NI)" },
        { id: "ni_diaria_15", juego: "Diaria", hora_sorteo: "15:00", hora_cierre: "14:55", nombre: "Diaria 3:00 PM (NI)" },
        { id: "ni_diaria_21", juego: "Diaria", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "Diaria 9:00 PM (NI)" },
        { id: "ni_fechas_11", juego: "Fechas", hora_sorteo: "11:00", hora_cierre: "10:55", nombre: "Fechas 11:00 AM (NI)" },
        { id: "ni_fechas_15", juego: "Fechas", hora_sorteo: "15:00", hora_cierre: "14:55", nombre: "Fechas 3:00 PM (NI)" },
        { id: "ni_fechas_21", juego: "Fechas", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "Fechas 9:00 PM (NI)" },
        { id: "ni_juga3_11", juego: "Jugá 3", hora_sorteo: "11:00", hora_cierre: "10:55", nombre: "Jugá 3 11:00 AM (NI)" },
        { id: "ni_juga3_15", juego: "Jugá 3", hora_sorteo: "15:00", hora_cierre: "14:55", nombre: "Jugá 3 3:00 PM (NI)" },
        { id: "ni_juga3_21", juego: "Jugá 3", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "Jugá 3 9:00 PM (NI)" },
        { id: "ni_premia_11", juego: "Premia2", hora_sorteo: "11:00", hora_cierre: "10:55", nombre: "Premia2 11:00 AM (NI)" },
        { id: "ni_premia_15", juego: "Premia2", hora_sorteo: "15:00", hora_cierre: "14:55", nombre: "Premia2 3:00 PM (NI)" },
        { id: "ni_premia_21", juego: "Premia2", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "Premia2 9:00 PM (NI)" },
        { id: "ni_term_11", juego: "Terminación 2", hora_sorteo: "11:00", hora_cierre: "10:55", nombre: "Terminación 2 11:00 AM (NI)" },
        { id: "ni_term_15", juego: "Terminación 2", hora_sorteo: "15:00", hora_cierre: "14:55", nombre: "Terminación 2 3:00 PM (NI)" },
        { id: "ni_term_21", juego: "Terminación 2", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "Terminación 2 9:00 PM (NI)" },

        // Honduras (HN)
        { id: "hn_diaria_11", juego: "La Diaria", hora_sorteo: "11:00", hora_cierre: "10:55", nombre: "La Diaria 11:00 AM (HN)" },
        { id: "hn_diaria_15", juego: "La Diaria", hora_sorteo: "15:00", hora_cierre: "14:55", nombre: "La Diaria 3:00 PM (HN)" },
        { id: "hn_diaria_21", juego: "La Diaria", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "La Diaria 9:00 PM (HN)" },
        { id: "hn_premia_11", juego: "Premia2", hora_sorteo: "11:00", hora_cierre: "10:55", nombre: "Premia2 11:00 AM (HN)" },
        { id: "hn_premia_15", juego: "Premia2", hora_sorteo: "15:00", hora_cierre: "14:55", nombre: "Premia2 3:00 PM (HN)" },
        { id: "hn_premia_21", juego: "Premia2", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "Premia2 9:00 PM (HN)" },
        { id: "hn_pega3_11", juego: "Pega 3", hora_sorteo: "11:00", hora_cierre: "10:55", nombre: "Pega 3 11:00 AM (HN)" },
        { id: "hn_pega3_15", juego: "Pega 3", hora_sorteo: "15:00", hora_cierre: "14:55", nombre: "Pega 3 3:00 PM (HN)" },
        { id: "hn_pega3_21", juego: "Pega 3", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "Pega 3 9:00 PM (HN)" },
        { id: "hn_super_21", juego: "Súper Premio", hora_sorteo: "21:00", hora_cierre: "20:55", nombre: "Súper Premio 9:00 PM (HN)" }
      ],
      limites_numeros: [],
      resultados: [],
      cobros: []
    },
    ventas: [],
    cierres_caja: [],
    resumenes_diarios: [],
    cobros_admin: [],
    pagos_comision: [],
    fcm_tokens: []
  };

  return initialDB;
}

let db: ServerDB = initDatabase();
// Ensure dynamic backward compatibility
db.resumenes_diarios = db.resumenes_diarios || [];
db.cobros_admin = db.cobros_admin || [];
db.pagos_comision = db.pagos_comision || [];
db.fcm_tokens = db.fcm_tokens || [];

async function saveToDB() {
  const isReady = initFirebaseAdmin();
  if (isReady) {
    try {
      const firestoreDb = getFirestoreInstance();

      await firestoreDb.collection("configuracion").doc("general").set(db.configuracion);
      await firestoreDb.collection("configuracion").doc("fcm").set({ tokens: db.fcm_tokens || [] });

      for (const u of db.usuarios) {
        const { id, ...userData } = u;
        if (userData.rol === "administrador") {
          userData.configuracion = db.configuracion;
        }
        await firestoreDb.collection("usuarios").doc(id).set(userData);
      }

      // NOTE: tickets (db.ventas) are NO longer bulk-written here.
      // Each endpoint (POST /api/ventas, POST /api/ventas/:id/pagar, etc.)
      // writes directly to Firestore "tickets" collection atomically.
      // This prevents deleted tickets from being re-inserted by residual
      // in-memory state during unrelated saves (config, users, closures).

      for (const c of db.cierres_caja) {
        const { id, ...closureData } = c;
        await firestoreDb.collection("cierres_caja").doc(id).set(closureData);
      }
    } catch (err) {
      console.error("[Firestore Sync] Error al sincronizar base de datos con Firestore:", err);
    }
  }
}

async function syncFromFirestore() {
  const isReady = initFirebaseAdmin();
  if (!isReady) {
    console.log("[Firestore Sync] Firebase Admin no está configurado. Usando base de datos local.");
    return;
  }

  try {
    console.log("[Firestore Sync] Cargando datos en tiempo real desde Firestore...");
    const firestoreDb = getFirestoreInstance();

    const fetchPromise = (async () => {
      const configDoc = await firestoreDb.collection("configuracion").doc("general").get();
      if (configDoc.exists) {
        db.configuracion = configDoc.data() as ServerConfiguracion;
        console.log("[Firestore Sync] Configuración cargada desde Firestore.");
      } else {
        console.log("[Firestore Sync] Guardando configuración predeterminada en Firestore...");
        await firestoreDb.collection("configuracion").doc("general").set(db.configuracion);
      }

      const usersSnapshot = await firestoreDb.collection("usuarios").get();
      if (!usersSnapshot.empty) {
        const usersList: any[] = [];
        usersSnapshot.forEach((doc: any) => {
          usersList.push({ id: doc.id, ...doc.data() });
        });
        db.usuarios = usersList;
        console.log(`[Firestore Sync] ${usersList.length} usuarios cargados desde Firestore.`);
      } else {
        console.log("[Firestore Sync] Guardando usuario administrador por defecto en Firestore...");
        for (const u of db.usuarios) {
          const { id, ...userData } = u;
          await firestoreDb.collection("usuarios").doc(id).set(userData);
        }
      }

      const salesSnapshot = await firestoreDb.collection("tickets").get();
      const salesList: any[] = [];
      salesSnapshot.forEach((doc: any) => {
        salesList.push({ id: doc.id, ...doc.data() });
      });
      db.ventas = salesList;
      console.log(`[Firestore Sync] ${salesList.length} ventas cargadas desde Firestore (tickets).`);

      const closuresSnapshot = await firestoreDb.collection("cierres_caja").get();
      const closuresList: any[] = [];
      closuresSnapshot.forEach((doc: any) => {
        closuresList.push({ id: doc.id, ...doc.data() });
      });
      db.cierres_caja = closuresList;
      console.log(`[Firestore Sync] ${closuresList.length} cierres de caja cargados desde Firestore.`);

      const fcmDoc = await firestoreDb.collection("configuracion").doc("fcm").get();
      if (fcmDoc.exists) {
        db.fcm_tokens = fcmDoc.data().tokens || [];
      } else {
        await firestoreDb.collection("configuracion").doc("fcm").set({ tokens: db.fcm_tokens || [] });
      }
    })();

    // Timeout de 6 segundos para abortar si la petición se cuelga
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("FIRESTORE_TIMEOUT")), 6000);
    });

    await Promise.race([fetchPromise, timeoutPromise]);

    console.log("[Firestore Sync] Sincronización inicial completada con éxito.");
  } catch (err: any) {
    if (err.message === "FIRESTORE_TIMEOUT") {
      console.warn("⚠️ Firestore tardó demasiado en responder. Usando caché local temporal...");
    } else {
      console.error("[Firestore Sync] Error al obtener datos iniciales de Firestore:", err);
    }
  }
}

// Live real-time notification subscribers (SSE)
let sseClients: any[] = [];

// ─── FIREBASE ADMIN INITIALIZATION ──────────────────────────────────
// FIREBASE_CONFIG_JSON (Secret Manager) → applicationDefault() fallback
function initFirebaseAdminAtStartup(): boolean {
  if (!firebaseAdmin) {
    console.error("[Firebase Admin] Módulo no disponible. Firestore/FCM deshabilitados.");
    return false;
  }

  if (firebaseAdmin.apps?.length > 0) {
    console.log("[Firebase Admin] Ya inicializado previamente.");
    return true;
  }

  // 1. FIREBASE_CONFIG_JSON desde Secret Manager
  const configJson = process.env.FIREBASE_CONFIG_JSON;
  if (configJson) {
    try {
      const serviceAccount = JSON.parse(configJson);
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID
      });
      console.log(`[Firebase Admin] OK (FIREBASE_CONFIG_JSON) → Proyecto: ${FIREBASE_PROJECT_ID} | Database: ${FIRESTORE_DATABASE_ID}`);
      return true;
    } catch (error: any) {
      console.error(`[Firebase Admin] Error con FIREBASE_CONFIG_JSON: ${error.message}`);
    }
  }

  // 2. Application Default Credentials (Cloud Run / App Hosting automático)
  try {
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential?.applicationDefault?.() || undefined,
      projectId: FIREBASE_PROJECT_ID
    });
    console.log(`[Firebase Admin] OK (ADC) → Proyecto: ${FIREBASE_PROJECT_ID} | Database: ${FIRESTORE_DATABASE_ID}`);
    return true;
  } catch (error: any) {
    console.error(`[Firebase Admin] Error con Application Default Credentials: ${error.message}`);
  }

  console.error("[Firebase Admin] ERROR CRÍTICO: No se encontraron credenciales válidas.");
  return false;
}

let firebaseReady = initFirebaseAdminAtStartup();

// Safe wrapper — returns true only if initialized
function initFirebaseAdmin(): boolean {
  if (firebaseReady) return true;
  if (firebaseAdmin?.apps?.length > 0) {
    firebaseReady = true;
    return true;
  }
  return false;
}

// Broadcast to active SSE clients
function broadcastToSSE(notification: any) {
  const dataString = `data: ${JSON.stringify(notification)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(dataString);
    } catch (err) {
      console.error("Error al transmitir por SSE:", err);
    }
  });
}

// Send real FCM message to registered tokens if FCM is initialized
async function sendFCMPushNotification(title: string, body: string, data: any) {
  const isReady = initFirebaseAdmin();
  if (!isReady) {
    console.log("[FCM Push Bypass] Firebase Admin no está configurado. Alerta transmitida vía SSE.");
    return;
  }

  const tokens = db.fcm_tokens || [];
  if (tokens.length === 0) {
    console.log("[FCM Push] No hay tokens de dispositivos registrados.");
    return;
  }

  // Use sendEachForMulticast to target all registered tokens
  const message = {
    notification: { title, body },
    data: {
      ...data,
      click_action: "FLUTTER_NOTIFICATION_CLICK"
    },
    tokens: tokens
  };

  try {
    const response = await getMessaging().sendEachForMulticast(message);
    console.log(`[FCM Push] Enviadas ${response.successCount} notificaciones push. Fallidas: ${response.failureCount}`);
  } catch (error) {
    console.error("[FCM Push] Error al enviar notificaciones push:", error);
  }
}

// Generate human-friendly 6-character unique ticket signatures (e.g., A9X-2M)
function generateDigitalSignature(ticketId: string, timestamp: string, juego: string, numero: string, monto: number, moneda: string) {
  const payload = `${ticketId}-${timestamp}-${juego}-${numero}-${monto}-${moneda}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  const code = Math.abs(hash).toString(36).toUpperCase().substring(0, 5).padEnd(5, "X");
  return `${code.substring(0, 3)}-${code.substring(3, 5)}`;
}

// REST API Endpoints

// NOTIFICATIONS: SSE stream for real-time dashboard events
app.get("/api/notifications/subscribe", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  // Prevent connection timeout by sending a ping
  res.write("data: {\"type\":\"ping\"}\n\n");

  sseClients.push(res);

  const keepAliveInterval = setInterval(() => {
    try {
      res.write("data: {\"type\":\"ping\"}\n\n");
    } catch (e) {
      // client dropped
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAliveInterval);
    sseClients = sseClients.filter((c) => c !== res);
  });
});

// NOTIFICATIONS: Register FCM registration token (Web Push / Mobile device)
app.post("/api/notifications/register-token", (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Token es requerido." });
  }

  // Avoid duplicates
  if (!db.fcm_tokens.includes(token)) {
    db.fcm_tokens.push(token);
    saveToDB();
    console.log(`[FCM Token] Nuevo token registrado: ${token.substring(0, 10)}...`);
  }

  res.status(200).json({ success: true, message: "Token registrado con éxito." });
});

// Server Reloj
app.get("/api/reloj", (req, res) => {
  res.json({
    timestamp_servidor: new Date().toISOString(),
    local_time_readable: new Date().toLocaleTimeString("es-ES")
  });
});

// ─── LOGIN ENDPOINT (Firestore-direct con logs garantizados) ──────────
app.post("/api/login", async (req, res) => {
  const ts = new Date().toISOString();
  const { email, password } = req.body || {};

  // Logs con process.stdout.write para garantizar que aparecen en Cloud Logging
  const log = (msg: string) => {
    const line = `[Login][${ts}] ${msg}\n`;
    process.stdout.write(line);
    console.log(line.trimEnd());
  };

  log(`════════════════════════════════════════`);
  log(`Buscando en colección: 'usuarios', email: "${email}"`);

  if (!email || !password) {
    log(`RECHAZADO 400: campos vacíos (email=${!!email}, password=${!!password})`);
    return res.status(400).json({ error: "Email y contraseña son requeridos." });
  }

  const emailLower = email.toLowerCase().trim();

  // ─── PASO 1: Intentar Firebase Admin ──────────────────────────────
  const adminReady = initFirebaseAdmin();
  log(`Firebase Admin inicializado: ${adminReady}`);

  if (!adminReady) {
    log(`ERROR FATAL: Firebase Admin NO inicializado. SIN ACCESO A FIRESTORE.`);
    log(`Causa probable: variable de entorno FIREBASE_CONFIG_JSON no configurada.`);
    log(`════════════════════════════════════════`);
    return res.status(503).json({ error: "Servidor sin conexión a base de datos. Contacte al administrador." });
  }

  // ─── PASO 2: Buscar en Firestore por campo 'email' ───────────────
  const firestoreDb = getFirestoreInstance();
  let userDoc: any = null;
  let user: any = null;
  let sourceField = "";

  try {
    log(`Consultando Firestore: collection('usuarios').where('email','==','${emailLower}')`);
    const byEmail = await firestoreDb.collection('usuarios').where('email', '==', emailLower).get();
    log(`¿Documento encontrado?: ${!byEmail.empty} (${byEmail.size} resultado(s))`);

    if (!byEmail.empty) {
      userDoc = byEmail.docs[0];
      sourceField = "email";
    }
  } catch (err: any) {
    log(`ERROR en query Firestore (email): ${err.message}`);
  }

  // ─── PASO 3: Si no encontró por email, buscar por campo 'usuario' ─
  if (!userDoc) {
    try {
      log(`Consultando Firestore: collection('usuarios').where('usuario','==','${emailLower}')`);
      const byUsuario = await firestoreDb.collection('usuarios').where('usuario', '==', emailLower).get();
      log(`¿Documento encontrado?: ${!byUsuario.empty} (${byUsuario.size} resultado(s))`);

      if (!byUsuario.empty) {
        userDoc = byUsuario.docs[0];
        sourceField = "usuario";
      }
    } catch (err: any) {
      log(`ERROR en query Firestore (usuario): ${err.message}`);
    }
  }

  // ─── PASO 4: Listar todos los documentos para diagnóstico ─────────
  if (!userDoc) {
    log(`USUARIO NO ENCONTRADO por ningún campo. Listando TODOS los documentos de 'usuarios':`);
    try {
      const allDocs = await firestoreDb.collection('usuarios').get();
      log(`Total documentos en colección 'usuarios': ${allDocs.size}`);
      allDocs.forEach((d: any) => {
        const data = d.data();
        log(`  → doc ${d.id}: email="${data.email || "N/A"}", usuario="${data.usuario || "N/A"}", activo=${data.activo}, password=${data.password ? "SÍ" : "NO"}`);
      });
    } catch (err: any) {
      log(`ERROR listando documentos: ${err.message}`);
    }
    log(`════════════════════════════════════════`);
    return res.status(401).json({ error: "Credenciales incorrectas o usuario no encontrado." });
  }

  // ─── PASO 5: Usuario encontrado — preparar datos ─────────────────
  user = { id: userDoc.id, ...userDoc.data() };
  log(`Usuario encontrado. Validando password...`);
  log(`Estructura de usuario recibida: ${JSON.stringify({ ...user, password: "***" })}`);

  if (!user.activo) {
    log(`USUARIO DESACTIVADO (activo=false) → 403`);
    log(`════════════════════════════════════════`);
    return res.status(403).json({ error: "Acceso denegado. Su cuenta se encuentra suspendida." });
  }

  // ─── PASO 6: Comparación de contraseña ────────────────────────────
  if (!user.password) {
    log(`Campo password: ${user.password === undefined ? "UNDEFINED" : "NULL/vacío"}`);
    log(`Error: El usuario NO tiene campo 'password' en Firestore.`);
    log(`════════════════════════════════════════`);
    return res.status(401).json({ error: "Credenciales incorrectas." });
  }

  const isBcrypt = user.password.startsWith("$2");
  log(`Hash stored: "${user.password.substring(0, 24)}..." (len=${user.password.length}, tipo=${isBcrypt ? "bcrypt" : "texto_plano"})`);

  let isMatch = false;
  let wasPlaintext = false;

  if (isBcrypt) {
    isMatch = bcrypt.compareSync(password, user.password);
    log(`bcrypt.compareSync("${password}", "${user.password.substring(0, 20)}...") → ${isMatch}`);
  } else {
    isMatch = user.password === password;
    wasPlaintext = isMatch;
    log(`Comparación directa === → ${isMatch}`);
  }

  if (!isMatch) {
    log(`Error: La comparación de password devolvió false.`);
    log(`════════════════════════════════════════`);
    return res.status(401).json({ error: "Credenciales incorrectas." });
  }

  // ─── PASO 7: Migración texto plano → bcrypt ──────────────────────
  if (wasPlaintext) {
    try {
      log(`Migrando contraseña texto plano → bcrypt...`);
      const hashed = bcrypt.hashSync(password, 10);
      await firestoreDb.collection("usuarios").doc(user.id).update({ password: hashed });
      user.password = hashed;
      log(`Migración completada.`);
    } catch (err: any) {
      log(`Error en migración: ${err.message}`);
    }
  }

  // ─── PASO 8: Login exitoso ───────────────────────────────────────
  const { password: _, ...safeUser } = user;
  const sessionToken = createSession(safeUser);
  log(`LOGIN EXITOSO → id=${user.id}, email=${user.email}, rol=${user.rol}`);
  log(`════════════════════════════════════════`);

  res.json({ success: true, user: safeUser, localToken: sessionToken, message: "Autenticación exitosa" });
});

// ─── AUTH ENDPOINTS (Custom auth with bcrypt + Firestore) ────────────

// Validar sesión actual — usado por el frontend para rehidratación
app.get("/api/auth/me", checkAuth(), (req, res) => {
  try {
    const sessionUser = (req as any).user;
    // Re-validar que el usuario sigue existiendo y activo en la DB
    const freshUser = db.usuarios.find((u: any) => u.id === sessionUser.id);
    if (!freshUser) {
      const token = req.headers.authorization?.split(" ")[1];
      if (token) destroySession(token);
      return res.status(401).json({ error: "Usuario no encontrado. Sesión cerrada." });
    }
    if (!freshUser.activo) {
      const token = req.headers.authorization?.split(" ")[1];
      if (token) destroySession(token);
      return res.status(403).json({ error: "Cuenta desactivada. Sesión cerrada." });
    }
    const { password: _, ...safeUser } = freshUser;
    res.json({ success: true, user: safeUser });
  } catch (err) {
    console.error("[Auth Me] Error:", err);
    res.status(500).json({ error: "Error al validar sesión." });
  }
});

// Registro protegido — solo administradores pueden crear usuarios
app.post("/api/auth/register", requireAdmin, async (req, res) => {
  try {
    const { nombre, usuario, email, password, rol, region, id_supervisor } = req.body;

    if (!nombre || !usuario || !email || !password) {
      return res.status(400).json({ error: "Nombre, usuario, email y contraseña son requeridos." });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres." });
    }

    const usernameLower = usuario.trim().toLowerCase();
    if (db.usuarios.some((u: any) => u.usuario.toLowerCase() === usernameLower)) {
      return res.status(400).json({ error: `El nickname "${usuario}" ya está en uso.` });
    }

    if (db.usuarios.some((u: any) => u.email && u.email.toLowerCase() === email.trim().toLowerCase())) {
      return res.status(400).json({ error: `El email "${email}" ya está registrado.` });
    }

    const prefix = "U-";
    let nextNum = 1;
    while (db.usuarios.some((u: any) => u.id === `${prefix}${String(nextNum).padStart(3, "0")}`)) {
      nextNum++;
    }
    const id = `${prefix}${String(nextNum).padStart(3, "0")}`;

    const resolvedRol = rol === "admin" || rol === "administrador" ? "administrador" : (rol === "supervisor" ? "supervisor" : "vendedor");

    const newUser: ServerUsuario = {
      id,
      nombre: nombre.trim(),
      usuario: usernameLower,
      rol: resolvedRol,
      email: email.trim(),
      password: bcrypt.hashSync(password, 10),
      estado: "activo" as const,
      conexion: "offline" as const,
      activo: true,
      region: region || "Nicaragua" as const,
      id_supervisor: id_supervisor || "",
      vendedoresAsignados: [],
      requiereCambioPassword: true
    };

    db.usuarios.push(newUser);

    // Sync to Firestore
    if (initFirebaseAdmin()) {
      const { password: _, ...firestoreUser } = newUser;
      getFirestoreInstance().collection("usuarios").doc(id).set(firestoreUser).catch((err: any) => {
        console.error(`[Firestore Sync] Error al crear usuario ${id} en Firestore:`, err);
      });
    }

    saveToDB();
    const { password: _, ...safeUser } = newUser;
    res.status(201).json({ success: true, user: safeUser });
  } catch (err) {
    console.error("[Auth Register] Error creando usuario:", err);
    res.status(500).json({ error: "Error interno al crear usuario." });
  }
});

app.post("/api/auth/change-password", checkAuth(), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = (req as any).user?.uid || (req as any).user?.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Contraseña actual y nueva contraseña son requeridas." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "La nueva contraseña debe tener al menos 6 caracteres." });
    }

    const user = db.usuarios.find((u: any) => u.id === userId);
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado." });
    }

    let isMatch = false;
    if (user.password) {
      if (user.password.startsWith("$2")) {
        isMatch = bcrypt.compareSync(currentPassword, user.password);
      } else {
        isMatch = user.password === currentPassword;
      }
    }

    if (!isMatch) {
      return res.status(401).json({ error: "La contraseña actual es incorrecta." });
    }

    user.password = bcrypt.hashSync(newPassword, 10);
    saveToDB();

    // Invalidate all existing sessions for this user except the current one
    const currentToken = req.headers.authorization?.split(" ")[1];
    for (const [token, session] of sessions.entries()) {
      if (session.user.id === userId && token !== currentToken) {
        destroySession(token);
      }
    }

    res.json({ success: true, message: "Contraseña actualizada correctamente." });
  } catch (err) {
    console.error("[Auth ChangePassword] Error:", err);
    res.status(500).json({ error: "Error interno al cambiar contraseña." });
  }
});

app.post("/api/auth/logout", checkAuth(), (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      destroySession(token);
    }
    res.json({ success: true, message: "Sesión cerrada correctamente." });
  } catch (err) {
    console.error("[Auth Logout] Error:", err);
    res.status(500).json({ error: "Error al cerrar sesión." });
  }
});

// ─────────────────────────────────────────────────────────────────────

// Setup Administrator Account Route (Temporary / Recovery utility)
app.post("/api/setup-admin", async (req, res) => {
  const hasAdmin = db.usuarios.some((u: any) => u.rol === "administrador");
  if (hasAdmin) {
    return res.status(403).json({ success: false, message: "Ya existe un administrador en el sistema." });
  }

  const adminEmail = req.body.email || "admin@sistema.com";
  const adminPassword = req.body.password || "Admin123456!";

  let userInDb = db.usuarios.find((u: any) => u.email.toLowerCase() === adminEmail.toLowerCase());

  if (!userInDb) {
    userInDb = {
      id: "admin_1",
      nombre: "Administrador Global",
      usuario: "admin",
      rol: "administrador",
      estado: "activo",
      conexion: "online",
      activo: true,
      region: "Nicaragua",
      email: adminEmail,
      id_supervisor: "",
      vendedoresAsignados: [],
      password: bcrypt.hashSync(adminPassword, 10),
      requiereCambioPassword: true
    };
    db.usuarios.push(userInDb);
    saveToDB();
  }

  const { password: _, ...safeUser } = userInDb;
  res.json({
    success: true,
    dbUser: safeUser,
    message: "Administrador inicializado correctamente. Ya puede iniciar sesión."
  });
});

// Users
app.get("/api/usuarios", (req, res) => {
  const safeUsers = db.usuarios.map((u: any) => {
    const { password, ...safeUser } = u;
    return safeUser;
  });
  res.json(safeUsers);
});

app.post("/api/usuarios", requireAdmin, (req, res) => {
  const { nombre, usuario, rol, email, password, estado, region, id_supervisor, vendedoresAsignados } = req.body;
  if (!nombre || !rol || !email || !usuario || !password) {
    return res.status(400).json({ error: "Nombre, Usuario (nickname), Contraseña, Rol y Correo son campos obligatorios." });
  }

  // Ensure unique username (usuario)
  const usernameLower = usuario.trim().toLowerCase();
  if (db.usuarios.some((u: any) => u.usuario.toLowerCase() === usernameLower)) {
    return res.status(400).json({ error: `El nickname de acceso "${usuario}" ya está en uso.` });
  }

  // Auto-generate U-001 format ID
  const prefix = "U-";
  let nextNum = 1;
  while (db.usuarios.some((u: any) => u.id === `${prefix}${String(nextNum).padStart(3, "0")}`)) {
    nextNum++;
  }
  const id = `${prefix}${String(nextNum).padStart(3, "0")}`;

  const resolvedRol = rol === "admin" || rol === "administrador" ? "administrador" : (rol === "supervisor" ? "supervisor" : "vendedor");
  const isActivo = estado !== "inactivo";

  const newUser: ServerUsuario = {
    id,
    nombre: nombre.trim(),
    usuario: usernameLower,
    rol: resolvedRol,
    email: email.trim(),
    password: password.trim(),
    estado: isActivo ? "activo" : "inactivo",
    conexion: "offline",
    activo: isActivo,
    region: region || "Nicaragua",
    id_supervisor: id_supervisor || "",
    vendedoresAsignados: (resolvedRol === "supervisor" && Array.isArray(vendedoresAsignados)) ? vendedoresAsignados : [],
    requiereCambioPassword: true
  };

  if (newUser.password) { newUser.password = bcrypt.hashSync(newUser.password, 10); }
  db.usuarios.push(newUser);

  // If this is a supervisor and has assigned vendors, update those vendors' supervisor ID
  if (newUser.rol === "supervisor" && newUser.vendedoresAsignados.length > 0) {
    db.usuarios.forEach((u: any) => {
      if (u.rol === "vendedor" && newUser.vendedoresAsignados.includes(u.id)) {
        u.id_supervisor = id;
      }
    });
  }

  saveToDB();
  res.status(201).json(newUser);
});

app.put("/api/usuarios/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const user = db.usuarios.find((u: any) => u.id === id);

  if (!user) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  const { nombre, usuario, rol, email, password, estado, region, id_supervisor, vendedoresAsignados, activo } = req.body;

  if (usuario !== undefined) {
    const usernameLower = usuario.trim().toLowerCase();
    if (usernameLower !== user.usuario.toLowerCase() && db.usuarios.some((u: any) => u.id !== id && u.usuario.toLowerCase() === usernameLower)) {
      return res.status(400).json({ error: `El nickname de acceso "${usuario}" ya está en uso.` });
    }
    user.usuario = usernameLower;
  }

  if (nombre !== undefined) user.nombre = nombre.trim();
  if (email !== undefined) user.email = email.trim();
  if (rol !== undefined) {
    user.rol = rol === "admin" || rol === "administrador" ? "administrador" : (rol === "supervisor" ? "supervisor" : "vendedor");
  }

  if (estado !== undefined) {
    user.estado = estado === "activo" ? "activo" : "inactivo";
    user.activo = (estado === "activo");
  } else if (activo !== undefined) {
    user.activo = activo;
    user.estado = activo ? "activo" : "inactivo";
  }

  if (region !== undefined) user.region = region;

  if (id_supervisor !== undefined && user.rol === "vendedor") {
    user.id_supervisor = id_supervisor;
  }

  if (vendedoresAsignados !== undefined && user.rol === "supervisor") {
    user.vendedoresAsignados = vendedoresAsignados;
    // Sync id_supervisor for vendors
    db.usuarios.forEach((u: any) => {
      if (u.rol === "vendedor") {
        if (vendedoresAsignados.includes(u.id)) {
          u.id_supervisor = id;
        } else if (u.id_supervisor === id) {
          u.id_supervisor = "";
        }
      }
    });
  }

  // Also sync bidirectional updates (if vendedor's supervisor changed, update that supervisor's list)
  db.usuarios.forEach((u: any) => {
    if (u.rol === "supervisor") {
      u.vendedoresAsignados = db.usuarios
        .filter((v: any) => v.rol === "vendedor" && v.id_supervisor === u.id)
        .map((v: any) => v.id);
    }
  });

  saveToDB();
  res.json(user);
});

app.delete("/api/usuarios/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const index = db.usuarios.findIndex((u: any) => u.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }

  const deletedUser = db.usuarios[index];
  db.usuarios.splice(index, 1);

  // Clean supervisor references
  if (deletedUser.rol === "supervisor") {
    db.usuarios.forEach((u: any) => {
      if (u.rol === "vendedor" && u.id_supervisor === id) {
        u.id_supervisor = "";
      }
    });
  } else if (deletedUser.rol === "vendedor") {
    db.usuarios.forEach((u: any) => {
      if (u.rol === "supervisor" && u.vendedoresAsignados) {
        u.vendedoresAsignados = u.vendedoresAsignados.filter((vId: string) => vId !== id);
      }
    });
  }

  saveToDB();
  if (initFirebaseAdmin()) {
    getFirestoreInstance().collection("usuarios").doc(id).delete().catch((err: any) => {
      console.error(`[Firestore Sync] Error al eliminar usuario ${id} de Firestore:`, err);
    });
  }
  res.json({ success: true, message: `Usuario "${deletedUser.nombre}" eliminado.` });
});

// Number Limits Management
app.get("/api/limites-numeros", (req, res) => {
  res.json(db.configuracion.limites_numeros || []);
});

app.post("/api/limites-numeros", requireAdmin, (req, res) => {
  const {
    juego,
    numero,
    max_monto,
    id_vendedor,
    vendedorId,
    pais,
    sorteo,
    hora,
    montoMaximo,
    hora_limite,
    numero_jugado,
    techo_dinero
  } = req.body;

  const resolvedJuego = juego || sorteo || "TODOS";
  const resolvedNumero = numero !== undefined ? numero : (numero_jugado !== undefined ? numero_jugado : "TODOS");
  const resolvedMonto = max_monto !== undefined ? Number(max_monto) : (montoMaximo !== undefined ? Number(montoMaximo) : (techo_dinero !== undefined ? Number(techo_dinero) : 0));
  const resolvedVendedor = id_vendedor || vendedorId || "";

  const newLimit = {
    id: "lim_" + Math.random().toString(36).substring(2, 9),
    juego: resolvedJuego,
    numero: resolvedNumero,
    max_monto: resolvedMonto,
    id_vendedor: resolvedVendedor,

    // extra granular keys
    vendedorId: resolvedVendedor,
    pais: pais || "",
    sorteo: sorteo || resolvedJuego,
    hora: hora || hora_limite || "TODOS",
    montoMaximo: resolvedMonto,
    techo_dinero: resolvedMonto,
    numero_jugado: resolvedNumero,
    hora_limite: hora || hora_limite || "TODOS"
  };

  db.configuracion.limites_numeros = db.configuracion.limites_numeros || [];
  db.configuracion.limites_numeros.push(newLimit);
  saveToDB();
  res.status(201).json(newLimit);
});

app.delete("/api/limites-numeros", requireAdmin, (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).json({ error: "Límite ID es requerido." });
  }
  db.configuracion.limites_numeros = (db.configuracion.limites_numeros || []).filter((l: any) => l.id !== id);
  saveToDB();
  res.json({ success: true, message: "Límite eliminado." });
});

app.delete("/api/limites-numeros/:id", requireAdmin, (req, res) => {
  const id = req.params.id || req.query.id;
  db.configuracion.limites_numeros = (db.configuracion.limites_numeros || []).filter((l: any) => l.id !== id);
  saveToDB();
  res.json({ success: true, message: "Límite eliminado." });
});

// ─── ESCRUTINIO DE TICKETS ──────────────────────────────────────────────────────
// Escrutates all Firestore tickets for a given sorteo+fecha against a winning number.
// Marks each ticket with es_premiado (bool) and monto_premio (number in C$).
// Supports batched writes (>500 tickets) and re-scrutinio (clears stale state).
async function escrutarTickets(id_sorteo: string, sorteoName: string, fecha: string, numero_ganador: string) {
  const sorteoObj = db.configuracion.sorteos.find((s: any) => s.id === id_sorteo);
  if (!sorteoObj) {
    console.log("[Escrutinio] Sorteo no encontrado:", id_sorteo);
    return { scrutinized: 0, winners: 0 };
  }

  const juego = sorteoObj.juego;
  const multiplicador = calculatePrizeMultiplier(juego, sorteoName);

  if (!initFirebaseAdmin()) {
    console.log("[Escrutinio] Firebase Admin no disponible.");
    return { scrutinized: 0, winners: 0 };
  }

  try {
    const firestoreDb = getFirestoreInstance();

    // Query all tickets for this date (avoid composite index; filter sorteo in-memory)
    const ticketsSnap = await firestoreDb.collection("tickets")
      .where("fecha_venta", "==", fecha)
      .get();

    let scrutinized = 0;
    let winners = 0;
    const batchOps: { ref: any; data: any }[] = [];

    for (const ticketDoc of ticketsSnap.docs) {
      const ticket = ticketDoc.data();
      if (ticket.estado === "anulado") continue;
      if (ticket.id_sorteo !== sorteoName) continue;

      scrutinized++;
      let ticketPrize = 0;

      // Multi-jugada support
      if (ticket.jugadas && ticket.jugadas.length > 0) {
        for (const jugada of ticket.jugadas) {
          if (String(jugada.numero).trim().toLowerCase() === String(numero_ganador).trim().toLowerCase()) {
            const montoInCs = ticket.moneda === "USD"
              ? jugada.monto * (db.configuracion.tasa_cambio || 36.5)
              : jugada.monto;
            ticketPrize += montoInCs * multiplicador;
          }
        }
      } else if (ticket.numero_jugado) {
        if (String(ticket.numero_jugado).trim().toLowerCase() === String(numero_ganador).trim().toLowerCase()) {
          const montoInCs = ticket.moneda === "USD"
            ? (ticket.monto_pago || 0) * (db.configuracion.tasa_cambio || 36.5)
            : (ticket.monto_pago || 0);
          ticketPrize = montoInCs * multiplicador;
        }
      }

      batchOps.push({
        ref: ticketDoc.ref,
        data: {
          es_premiado: ticketPrize > 0,
          monto_premio: ticketPrize,
          escrutinio_timestamp: new Date().toISOString()
        }
      });
      if (ticketPrize > 0) winners++;
    }

    // Commit in chunks of 500 (Firestore batch limit)
    for (let i = 0; i < batchOps.length; i += 500) {
      const chunk = batchOps.slice(i, i + 500);
      const batch = firestoreDb.batch();
      for (const op of chunk) {
        batch.update(op.ref, op.data);
      }
      await batch.commit();
    }

    // Also update local ventas array for consistency
    for (const venta of db.ventas) {
      if (venta.anulado) continue;
      if (venta.sorteo !== sorteoName) continue;
      const ventaDate = venta.timestamp_servidor.split("T")[0];
      if (ventaDate !== fecha) continue;

      let prize = 0;
      if (venta.jugadas && venta.jugadas.length > 0) {
        for (const j of venta.jugadas) {
          if (String(j.numero).trim().toLowerCase() === String(numero_ganador).trim().toLowerCase()) {
            const montoInCs = venta.moneda === "USD"
              ? j.monto * (db.configuracion.tasa_cambio || 36.5)
              : j.monto;
            prize += montoInCs * multiplicador;
          }
        }
      } else if (venta.numero_jugado) {
        if (String(venta.numero_jugado).trim().toLowerCase() === String(numero_ganador).trim().toLowerCase()) {
          const montoInCs = venta.moneda === "USD"
            ? venta.monto_pago * (db.configuracion.tasa_cambio || 36.5)
            : venta.monto_pago;
          prize = montoInCs * multiplicador;
        }
      }

      venta.es_premiado = prize > 0;
      venta.monto_premio = prize;
    }

    saveToDB();
    console.log(`[Escrutinio] Completado: ${scrutinized} tickets escrutados, ${winners} ganadores.`);
    return { scrutinized, winners };
  } catch (err) {
    console.error("[Escrutinio] Error durante escrutinio:", err);
    return { scrutinized: 0, winners: 0 };
  }
}

// Standalone escrutinio endpoint (re-escrutable)
app.post("/api/escrutar", requireAdmin, async (req, res) => {
  const { id_sorteo, fecha, numero_ganador } = req.body;
  if (!id_sorteo || !fecha || !numero_ganador) {
    return res.status(400).json({ error: "id_sorteo, fecha y numero_ganador son requeridos." });
  }

  const sorteoObj = db.configuracion.sorteos.find((s: any) => s.id === id_sorteo);
  const sorteoName = sorteoObj ? sorteoObj.nombre : "";

  try {
    const result = await escrutarTickets(id_sorteo, sorteoName, fecha, numero_ganador);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[Escrutinio] Error endpoint:", err);
    res.status(500).json({ error: "Error durante el escrutinio." });
  }
});

// ─── RESULTADOS (Winning Numbers) ──────────────────────────────────────────────
app.get("/api/resultados", (req, res) => {
  res.json(db.configuracion.resultados || []);
});

app.post("/api/resultados", requireAdmin, async (req, res) => {
  const { id_sorteo, fecha, numero_ganador, sorteo, pais } = req.body;
  if (!id_sorteo || !fecha || !numero_ganador) {
    return res.status(400).json({ error: "Sorteo, Fecha y Número ganador son requeridos." });
  }

  const newResult = {
    id: "res_" + Math.random().toString(36).substring(2, 9),
    id_sorteo,
    sorteo: sorteo || "",
    pais: pais || "",
    fecha, // YYYY-MM-DD
    numero_ganador,
    timestamp: new Date().toISOString()
  };

  db.configuracion.resultados = db.configuracion.resultados || [];
  db.configuracion.resultados.push(newResult);
  saveToDB();

  // Auto-trigger escrutinio after saving the result
  try {
    await escrutarTickets(id_sorteo, newResult.sorteo, fecha, numero_ganador);
  } catch (err) {
    console.error("[Escrutinio] Error post-resultado:", err);
  }

  res.status(201).json(newResult);
});

app.put("/api/resultados/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { id_sorteo, fecha, numero_ganador, sorteo, pais } = req.body;
  if (!id_sorteo || !fecha || !numero_ganador) {
    return res.status(400).json({ error: "Sorteo, Fecha y Número ganador son requeridos." });
  }

  db.configuracion.resultados = db.configuracion.resultados || [];
  const idx = db.configuracion.resultados.findIndex((r: any) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Resultado no encontrado." });
  }

  db.configuracion.resultados[idx].id_sorteo = id_sorteo;
  db.configuracion.resultados[idx].sorteo = sorteo || "";
  db.configuracion.resultados[idx].pais = pais || "";
  db.configuracion.resultados[idx].fecha = fecha;
  db.configuracion.resultados[idx].numero_ganador = numero_ganador;

  saveToDB();
  res.json(db.configuracion.resultados[idx]);
});

app.delete("/api/resultados/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.configuracion.resultados = (db.configuracion.resultados || []).filter((r: any) => r.id !== id);
  saveToDB();
  res.json({ success: true, message: "Resultado de sorteo eliminado." });
});

// Cobros / Collections
app.get("/api/cobros", (req, res) => {
  res.json(db.configuracion.cobros || []);
});

app.post("/api/cobros", checkAuth(), (req, res) => {
  const { id_vendedor, id_supervisor, monto_cs, monto_usd, comentario } = req.body;
  if (!id_vendedor || !id_supervisor || monto_cs === undefined || monto_usd === undefined) {
    return res.status(400).json({ error: "Vendedor, Supervisor, monto en C$ y monto en USD son obligatorios." });
  }

  const user = db.usuarios.find((u: any) => u.id === id_vendedor);
  const newCobro = {
    id: "cob_" + Math.random().toString(36).substring(2, 9),
    id_vendedor,
    nombre_vendedor: user ? user.nombre : "Vendedor Desconocido",
    id_supervisor,
    monto_cs: Number(monto_cs),
    monto_usd: Number(monto_usd),
    fecha: getLocalDateString(),
    timestamp: new Date().toISOString(),
    comentario: comentario || ""
  };

  db.configuracion.cobros = db.configuracion.cobros || [];
  db.configuracion.cobros.push(newCobro);

  // We can automatically mark all previous uncollected closures of this seller as collected!
  if (db.cierres_caja) {
    db.cierres_caja.forEach((cc: any) => {
      if (cc.id_vendedor === id_vendedor) {
        cc.cobrado = true;
      }
    });
  }

  saveToDB();
  res.status(201).json(newCobro);
});

// ─── INGRESOS (Supervisor entrega dinero al vendedor) ──────────────────────
app.get("/api/ingresos", (req, res) => {
  res.json((db.configuracion as any).ingresos || []);
});

app.post("/api/ingresos", checkAuth(), (req, res) => {
  const { id_vendedor, id_supervisor, monto_cs, monto_usd, comentario } = req.body;
  if (!id_vendedor || !id_supervisor) {
    return res.status(400).json({ error: "Vendedor y Supervisor son obligatorios." });
  }

  const user = db.usuarios.find((u: any) => u.id === id_vendedor);
  const newIngreso = {
    id: "ing_" + Math.random().toString(36).substring(2, 9),
    id_vendedor,
    nombre_vendedor: user ? user.nombre : "Vendedor Desconocido",
    id_supervisor,
    monto_cs: Number(monto_cs) || 0,
    monto_usd: Number(monto_usd) || 0,
    fecha: getLocalDateString(),
    timestamp: new Date().toISOString(),
    comentario: comentario || ""
  };

  (db.configuracion as any).ingresos = (db.configuracion as any).ingresos || [];
  (db.configuracion as any).ingresos.push(newIngreso);

  saveToDB();
  res.status(201).json(newIngreso);
});

// Mark closure as collected manually
app.put("/api/cierres/:id/cobrar", requireAdmin, (req, res) => {
  const { id } = req.params;
  const cc = db.cierres_caja.find((c: any) => c.id === id);
  if (!cc) {
    return res.status(404).json({ error: "Cierre de caja no encontrado." });
  }
  cc.cobrado = true;
  saveToDB();
  res.json({ success: true, message: "Cierre de caja marcado como cobrado.", closure: cc });
});

// Configuration
app.get("/api/configuracion", (req, res) => {
  res.json(db.configuracion);
});

app.put("/api/configuracion", requireAdmin, (req, res) => {
  const { tasa_cambio, formato_ticket, sorteos } = req.body;

  if (tasa_cambio !== undefined) {
    db.configuracion.tasa_cambio = Number(tasa_cambio);
  }
  if (formato_ticket !== undefined) {
    db.configuracion.formato_ticket = {
      ...db.configuracion.formato_ticket,
      ...formato_ticket
    };
  }
  if (sorteos !== undefined) {
    db.configuracion.sorteos = sorteos;
  }

  saveToDB();
  res.json(db.configuracion);
});

// Verification public route
app.get("/verificar", (req, res) => {
  const ticketId = req.query.ticket as string || "";
  const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Verificación de Boleto</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; text-align: center; background-color: #f3f4f6; color: #1f2937; }
        .ticket { background: white; border: 1px solid #d1d5db; padding: 20px; border-radius: 12px; max-width: 400px; margin: 20px auto; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); }
        .success { color: #059669; font-weight: bold; padding: 8px; background: #d1fae5; border-radius: 8px; margin-top: 15px;}
        .error { color: #dc2626; font-weight: bold; padding: 8px; background: #fee2e2; border-radius: 8px; margin-top: 15px;}
        .details { text-align: left; margin-top: 15px; border-top: 1px dashed #ccc; padding-top: 15px; }
        .details p { margin: 5px 0; font-size: 14px; }
      </style>
    </head>
    <body>
      <h2>Sistema de Verificación</h2>
      <div id="content">
        <p>Verificando boleto <strong>${ticketId}</strong>...</p>
      </div>
      <script>
        fetch('/api/ventas?ticket=${ticketId}')
          .then(res => res.json())
          .then(data => {
            if (data && data.length > 0) {
              const ticket = data[0];
              const estadoHtml = ticket.anulado 
                ? '<div class="error">❌ BOLETO ANULADO</div>'
                : '<div class="success">✅ BOLETO VÁLIDO</div>';
                
              document.getElementById('content').innerHTML = \`
                <div class="ticket">
                  <h3 style="margin-top:0;">\${ticket.juego}</h3>
                  <h1 style="font-size: 3rem; margin: 10px 0;">\${ticket.numero_jugado}</h1>
                  \${estadoHtml}
                  <div class="details">
                    <p><strong>Sorteo:</strong> \${ticket.sorteo}</p>
                    <p><strong>Inversión:</strong> \${ticket.moneda} \${ticket.monto_pago.toFixed(2)}</p>
                    <p><strong>Fecha:</strong> \${new Date(ticket.timestamp_servidor).toLocaleString('es-ES')}</p>
                    <p><strong>Vendedor:</strong> \${ticket.nombre_vendedor.substring(0,15)}</p>
                  </div>
                </div>
              \`;
            } else {
              document.getElementById('content').innerHTML = '<div class="ticket error">❌ BOLETO NO ENCONTRADO O INVÁLIDO</div>';
            }
          })
          .catch(err => {
            document.getElementById('content').innerHTML = '<div class="ticket error">⚠️ Error de conexión al verificar el boleto</div>';
          });
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// Ping
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Sales (Ventas)
app.get("/api/ventas", (req, res) => {
  if (req.query.ticket) {
    const ticketId = (req.query.ticket as string).toUpperCase();
    const found = db.ventas.find((v: any) =>
      v.id === ticketId ||
      v.numero_ticket === ticketId ||
      v.id_ticket === ticketId ||
      (v.firma_digital && v.firma_digital.toUpperCase() === ticketId)
    );
    return res.json(found ? [found] : []);
  }
  res.json(db.ventas);
});

app.post("/api/ventas", checkAuth(), async (req, res) => {
  const { juego, sorteo, numero_jugado, monto_pago, moneda, id_vendedor, nombre_cliente, premio_posible_cs, jugadas, fecha_venta } = req.body;

  if (!juego || !sorteo || !numero_jugado || !monto_pago || !moneda || !id_vendedor) {
    console.log("Validación de venta fallida, detalles:", { juego, sorteo, numero_jugado, monto_pago, moneda, id_vendedor, nombre_cliente });
    return res.status(400).json({ error: "Faltan datos obligatorios para registrar la venta." });
  }

  // 1. Verify seller is active & online
  const user = db.usuarios.find((u: any) => u.id === id_vendedor);
  if (!user) {
    return res.status(403).json({ error: "Vendedor no registrado." });
  }
  if (!user.activo) {
    return res.status(403).json({ error: "Su cuenta de vendedor está inactiva. Comuníquese con el administrador." });
  }

  // 2. Bloqueo por Tiempo de Sorteo (Server-Side Validation)
  // Let's locate the selected draw schedule
  const selectedSorteo = db.configuracion.sorteos.find((s: any) => s.nombre === sorteo && s.juego === juego);
  const now = new Date();

  if (selectedSorteo) {
    const [cierreHour, cierreMin] = selectedSorteo.hora_cierre.split(":").map(Number);
    const [sorteoHour, sorteoMin] = selectedSorteo.hora_sorteo.split(":").map(Number);

    // We convert current server clock time to compare hours/minutes
    const currentHour = now.getHours();
    const currentMin = now.getMinutes();
    const currentSec = now.getSeconds();

    // Check if we are past the draw closure time for TODAY'S draw
    const isPastCierre = (currentHour > cierreHour) || (currentHour === cierreHour && currentMin >= cierreMin);

    // If it's after closure, it is BLOCKED (anti-fraude)
    if (isPastCierre) {
      return res.status(400).json({
        error: `VENTA RECHAZADA (ANTI-FRAUDE): El sorteo ${sorteo} cerró a las ${selectedSorteo.hora_cierre} (Hora Servidor: ${now.toLocaleTimeString("es-ES")}).`
      });
    }

    // Check day-of-week restriction
    if (selectedSorteo.dias_habilitados && selectedSorteo.dias_habilitados.length > 0) {
      const currentDay = now.getDay(); // 0=Sun..6=Sat
      if (!selectedSorteo.dias_habilitados.includes(currentDay)) {
        const diasNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        const diasStr = selectedSorteo.dias_habilitados.map((d: number) => diasNames[d]).join(", ");
        return res.status(400).json({
          error: `VENTA RECHAZADA: El sorteo ${sorteo} solo está habilitado los días ${diasStr}.`
        });
      }
    }
  }

  // 2.5 LIMIT CHECK (Techo de venta granular)
  const limits = db.configuracion.limites_numeros || [];

  // Helper to format 24h string to standard AM/PM format
  const formatHourToAmPm = (timeStr: string): string => {
    if (!timeStr) return "";
    const parts = timeStr.split(":");
    let hour = parseInt(parts[0], 10);
    const min = parts[1] || "00";
    if (isNaN(hour)) return timeStr;
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${min} ${ampm}`;
  };

  const applicableLimits = limits.filter((l: any) => {
    // 1. Match Game
    const limitJuego = l.juego || "";
    const gameMatch = !limitJuego || limitJuego === "TODOS" || limitJuego.toLowerCase() === juego.toLowerCase();
    if (!gameMatch) return false;

    // 2. Match Number
    const limitNum = l.numero ?? l.numero_jugado ?? "TODOS";
    const numMatch = limitNum === "TODOS" || String(limitNum) === String(numero_jugado);
    if (!numMatch) return false;

    // 3. Match Seller
    const limitSellerId = l.id_vendedor || l.vendedorId || "";
    const sellerMatch = !limitSellerId || limitSellerId === "TODOS" || limitSellerId === id_vendedor;
    if (!sellerMatch) return false;

    // 4. Match Country/Pais
    let transPais = req.body.pais || "";
    if (!transPais && selectedSorteo) {
      if (selectedSorteo.nombre.includes("(NI)")) transPais = "Nicaragua";
      else if (selectedSorteo.nombre.includes("(HN)")) transPais = "Honduras";
      else if (selectedSorteo.nombre.includes("(LP)")) transPais = "La Primera";
      else if (selectedSorteo.nombre.includes("(CR)")) transPais = "Costa Rica";
    }
    const limitPais = l.pais || "";
    const paisMatch = !limitPais || limitPais === "TODOS" || limitPais.toLowerCase() === transPais.toLowerCase();
    if (!paisMatch) return false;

    // 5. Match Sorteo
    const limitSorteoName = l.sorteo || "";
    const sorteoMatch = !limitSorteoName || limitSorteoName === "TODOS" ||
      sorteo.toLowerCase().includes(limitSorteoName.toLowerCase()) ||
      limitSorteoName.toLowerCase().includes(sorteo.toLowerCase());
    if (!sorteoMatch) return false;

    // 6. Match Sorteo Hour
    if (selectedSorteo) {
      const limitHora = (l.hora || l.hora_limite || "").trim().toUpperCase();
      const transHora = formatHourToAmPm(selectedSorteo.hora_sorteo).toUpperCase();
      const horaMatch = !limitHora || limitHora === "TODOS" || limitHora === "CUALQUIERA" || limitHora === transHora;
      if (!horaMatch) return false;
    }

    return true;
  });

  for (const applicableLimit of applicableLimits) {
    const limitMontoCs = Number(applicableLimit.max_monto ?? applicableLimit.montoMaximo ?? applicableLimit.techo_dinero);
    const todayStr = now.toISOString().split("T")[0];

    // Sum previous active sales of this number matching this limit today
    const matchingSales = db.ventas.filter((v: any) => {
      if (v.anulado) return false;

      // Match criteria of the limit
      const limitJuego = applicableLimit.juego || "";
      if (limitJuego && limitJuego !== "TODOS" && v.juego.toLowerCase() !== limitJuego.toLowerCase()) return false;

      const limitNum = applicableLimit.numero ?? applicableLimit.numero_jugado ?? "TODOS";
      if (limitNum !== "TODOS" && String(v.numero_jugado) !== String(limitNum)) return false;

      const limitSorteoName = applicableLimit.sorteo || "";
      if (limitSorteoName && limitSorteoName !== "TODOS" &&
        !v.sorteo.toLowerCase().includes(limitSorteoName.toLowerCase()) &&
        !limitSorteoName.toLowerCase().includes(v.sorteo.toLowerCase())) return false;

      const limitSellerId = applicableLimit.id_vendedor || applicableLimit.vendedorId || "";
      if (limitSellerId && limitSellerId !== "TODOS" && v.id_vendedor !== limitSellerId) return false;

      const limitHora = (applicableLimit.hora || applicableLimit.hora_limite || "").trim().toUpperCase();
      if (limitHora && limitHora !== "TODOS" && limitHora !== "CUALQUIERA") {
        const vSorteoObj = db.configuracion.sorteos.find((s: any) => s.nombre === v.sorteo && s.juego === v.juego);
        if (vSorteoObj) {
          const vHora = formatHourToAmPm(vSorteoObj.hora_sorteo).toUpperCase();
          if (vHora !== limitHora) return false;
        }
      }

      if (!v.timestamp_servidor.startsWith(todayStr)) return false;
      return true;
    });

    const totalPrevSalesCs = matchingSales.reduce((sum: number, v: any) => {
      const amtInCs = v.moneda === "C$" ? v.monto_pago : v.monto_pago * db.configuracion.tasa_cambio;
      return sum + amtInCs;
    }, 0);

    const requestedMontoCs = moneda === "C$" ? Number(monto_pago) : Number(monto_pago) * db.configuracion.tasa_cambio;

    if (totalPrevSalesCs + requestedMontoCs > limitMontoCs) {
      const availableCs = Math.max(0, limitMontoCs - totalPrevSalesCs);
      const availableMsg = moneda === "C$"
        ? `C$ ${availableCs.toFixed(2)}`
        : `$ ${(availableCs / db.configuracion.tasa_cambio).toFixed(2)}`;

      const limitTypeMsg = (!applicableLimit.id_vendedor || applicableLimit.id_vendedor === "TODOS")
        ? "GLOBAL" : "INDIVIDUAL (Vendedor)";

      return res.status(400).json({
        error: `VENTA RECHAZADA (LÍMITE ${limitTypeMsg}): El número "${numero_jugado}" en "${juego}" para el sorteo "${sorteo}" tiene un techo de venta asignado de C$ ${limitMontoCs.toFixed(2)}. Ya vendido hoy: C$ ${totalPrevSalesCs.toFixed(2)}. Cupo restante: ${availableMsg}.`
      });
    }
  }

  // 3. ATOMIC COUNTER: Firestore transaction to get sequential ticket ID
  const serverTimeStr = now.toISOString();
  let numero_ticket = "";
  let firestoreCreated = false;

  try {
    const firestoreDb = getFirestoreInstance();
    const configRef = firestoreDb.collection("configuracion").doc("general");

    await firestoreDb.runTransaction(async (transaction) => {
      const configSnap = await transaction.get(configRef);

      if (!configSnap.exists) {
        throw new Error("configuracion/general no existe en Firestore");
      }

      const configData = configSnap.data()!;
      const currentCounter = configData.contador_global_tickets || 0;
      const newCounter = currentCounter + 1;
      numero_ticket = String(newCounter).padStart(6, "0");

      // Atomically increment the counter
      transaction.update(configRef, { contador_global_tickets: newCounter });

      // Create the ticket document with sequential ID as the document ID
      const ticketRef = firestoreDb.collection("tickets").doc(numero_ticket);
      const signature = generateDigitalSignature(numero_ticket, serverTimeStr, juego, numero_jugado, monto_pago, moneda);

      transaction.set(ticketRef, {
        // ── New canonical fields ──
        id_ticket: numero_ticket,
        id_vendedor,
        fecha_emision: serverTimeStr,
        fecha_venta: fecha_venta || "",
        id_juego: juego,
        id_sorteo: sorteo,
        juego_sorteo: `${juego} ${sorteo}`,
        jugadas: Array.isArray(jugadas) ? jugadas : [{ numero: numero_jugado, monto: Number(monto_pago) }],
        estado: "pendiente",
        total_apostado: Number(monto_pago),
        nombre_vendedor: user.nombre,
        nombre_cliente: nombre_cliente || "Genérico",
        premio_posible_cs: Number(premio_posible_cs) || 0,
        firma_digital: signature,
        anulado: false,
        // ── Legacy compat aliases (frontend Venta type expects these) ──
        timestamp_servidor: serverTimeStr,
        numero_ticket,
        numero_jugado: numero_jugado,
        monto_pago: Number(monto_pago),
        moneda,
        juego,
        sorteo,
      });
    });

    firestoreCreated = true;
    // Sync counter to local DB
    db.configuracion.contador_global_tickets = parseInt(numero_ticket, 10);
    console.log(`[Ventas] Ticket ${numero_ticket} creado en Firestore (transacción atómica)`);
  } catch (txErr: any) {
    console.error("[Ventas] FALLO transacción Firestore — ticket NO creado:", txErr.message);
    return res.status(500).json({
      error: `No se pudo generar el ticket. Error de transacción: ${txErr.message}. Intente nuevamente.`,
      retryable: true
    });
  }

  const ticketId = numero_ticket;
  const signature = generateDigitalSignature(ticketId, serverTimeStr, juego, numero_jugado, monto_pago, moneda);

  const newSale: any = {
    id: ticketId,
    id_ticket: ticketId,
    numero_ticket: ticketId,
    timestamp_servidor: serverTimeStr,
    fecha_venta: fecha_venta || "",
    juego,
    sorteo,
    numero_jugado,
    monto_pago: Number(monto_pago),
    moneda,
    id_vendedor,
    nombre_vendedor: user.nombre,
    nombre_cliente: nombre_cliente || "Genérico",
    premio_posible_cs: Number(premio_posible_cs) || 0,
    firma_digital: signature,
    anulado: false,
    estado: "pendiente",
    // Multi-número: persistir jugadas si vienen
    ...(Array.isArray(jugadas) && jugadas.length > 0 ? { jugadas } : {})
  };

  db.ventas.push(newSale);
  saveToDB();

  // NOTIFICATION TRIGGER: Send live real-time and FCM alerts
  const notifTitle = "Nuevo Ticket Generado";
  const notifBody = `Vendedor: ${user.nombre} • Juego: ${juego} • Núm: ${numero_jugado} • Pago: ${moneda} ${monto_pago}`;
  const notifPayload = {
    id: `notif_${Math.random().toString(36).substring(2, 9)}`,
    title: notifTitle,
    body: notifBody,
    vendedor: user.nombre,
    monto: `${moneda} ${monto_pago}`,
    juego,
    sorteo,
    numero_jugado,
    ticketNum: numero_ticket,
    timestamp: serverTimeStr
  };

  broadcastToSSE(notifPayload);
  sendFCMPushNotification(notifTitle, notifBody, notifPayload).catch((err) => {
    console.error("FCM dispatch error (silent):", err);
  });

  res.status(201).json(newSale);
});

// Anulación de Tickets (Basado en Hora de Cierre o Admin)
app.post("/api/ventas/:id/anular", checkAuth(), async (req, res) => {
  const { id } = req.params;
  const { userRole } = req.body;
  const sale = db.ventas.find((v: any) => v.id === id);

  if (!sale) {
    return res.status(404).json({ error: "Ticket no encontrado." });
  }

  if (sale.anulado) {
    return res.status(400).json({ error: "Este ticket ya se encuentra anulado." });
  }

  // If not admin, validate against hora_cierre
  if (userRole !== "admin" && userRole !== "administrador") {
    const selectedSorteo = db.configuracion.sorteos.find((s: any) => s.nombre === sale.sorteo && s.juego === sale.juego);
    if (selectedSorteo) {
      const now = new Date();
      const [cierreHour, cierreMin] = selectedSorteo.hora_cierre.split(":").map(Number);
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();

      const isPastCierre = (currentHour > cierreHour) || (currentHour === cierreHour && currentMin >= cierreMin);

      if (isPastCierre) {
        return res.status(400).json({
          error: `VENTA BLOQUEADA: El sorteo ${sale.sorteo} ya cerró a las ${selectedSorteo.hora_cierre}. No se puede anular.`
        });
      }
    }
  }

  sale.anulado = true;
  sale.estado = "anulado";

  // Direct Firestore write to tickets collection for real-time vendor notification
  if (initFirebaseAdmin()) {
    try {
      const firestoreDb = getFirestoreInstance();
      await firestoreDb.collection("tickets").doc(id).update({
        anulado: true,
        estado: "anulado"
      });
      console.log(`[Anulación] Ticket ${id} anulado en Firestore`);
    } catch (fireErr: any) {
      console.error("[Anulación] Firestore direct write failed:", fireErr.message);
    }
  }

  saveToDB();
  res.json({ message: "Ticket anulado con éxito.", ticket: sale });
});

// Validación y Pago de Tickets con QR
app.post("/api/ventas/:id/pagar", requireAdmin, async (req, res) => {
  const { id } = req.params;

  if (activePaymentLocks.has(id)) {
    return res.status(409).json({ error: "Transacción en proceso, por favor espere." });
  }
  activePaymentLocks.add(id);

  try {
    const sale = db.ventas.find((v: any) => v.id === id || v.numero_ticket === id || v.id_ticket === id || (v.firma_digital && v.firma_digital.toUpperCase() === id.toUpperCase()));

    if (!sale) {
      return res.status(404).json({ error: "Ticket no encontrado." });
    }

    if (sale.anulado || sale.estado === "anulado") {
      return res.status(400).json({ error: "Este ticket está anulado." });
    }

    if (sale.estado === "pagado") {
      return res.status(400).json({ error: "Este ticket ya ha sido pagado." });
    }

    if (sale.estado === "perdedor") {
      return res.status(400).json({ error: "Este ticket ya fue procesado y no resultó ganador." });
    }

    const saleDateStr = sale.timestamp_servidor.split("T")[0];

    // Find resultado: first try in-memory cache, then Firestore
    let resultado = (db.configuracion.resultados || []).find((r: any) => {
      if (r.fecha !== saleDateStr) return false;
      const sorteoObj = db.configuracion.sorteos.find((s: any) => s.id === r.id_sorteo);
      return sorteoObj && sorteoObj.nombre === sale.sorteo && sorteoObj.juego === sale.juego;
    });

    if (!resultado && initFirebaseAdmin()) {
      try {
        const firestoreDb = getFirestoreInstance();
        const snap = await firestoreDb.collection("resultados")
          .where("fecha", "==", saleDateStr)
          .get();
        for (const d of snap.docs) {
          const r = d.data();
          const sorteoObj = db.configuracion.sorteos.find((s: any) => s.id === r.id_sorteo);
          if (sorteoObj && sorteoObj.nombre === sale.sorteo && sorteoObj.juego === sale.juego) {
            resultado = r;
            break;
          }
        }
      } catch (err) {
        console.error("[Escrutinio] Error leyendo resultados de Firestore:", err);
      }
    }

    if (!resultado) {
      return res.status(400).json({ error: "Aún no hay resultados registrados para este sorteo." });
    }

    if (String(resultado.numero_ganador) === String(sale.numero_jugado)) {
      // Calcular el premio real del lado del servidor
      const multiplicador = calculatePrizeMultiplier(sale.juego, sale.sorteo);
      const montoInCs = sale.moneda === "USD" ? sale.monto_pago * (db.configuracion.tasa_cambio || 36.5) : sale.monto_pago;
      const premioReal = montoInCs * multiplicador;

      sale.estado = "pagado";
      sale.premio_posible_cs = premioReal; // Sobrescribir con el calculado por el servidor

      // Direct Firestore write to tickets collection for real-time vendor notification
      if (initFirebaseAdmin()) {
        try {
          const firestoreDb = getFirestoreInstance();
          await firestoreDb.collection("tickets").doc(id).update({
            estado: "pagado",
            monto_premio: premioReal
          });
          console.log(`[Pago] Ticket ${id} actualizado en Firestore (pagado)`);
        } catch (fireErr: any) {
          console.error("[Pago] Firestore direct write failed (fallback to saveToDB):", fireErr.message);
        }
      }

      saveToDB();
      return res.json({
        message: "¡Ganador!",
        ganador: true,
        ticket: sale,
        monto_ganado_cs: premioReal
      });
    } else {
      sale.estado = "perdedor";

      // Direct Firestore write to tickets collection for real-time vendor notification
      if (initFirebaseAdmin()) {
        try {
          const firestoreDb = getFirestoreInstance();
          await firestoreDb.collection("tickets").doc(id).update({
            estado: "perdedor"
          });
          console.log(`[Pago] Ticket ${id} actualizado en Firestore (perdedor)`);
        } catch (fireErr: any) {
          console.error("[Pago] Firestore direct write failed:", fireErr.message);
        }
      }

      saveToDB();
      return res.json({
        message: "Ticket No Premiado.",
        ganador: false,
        ticket: sale
      });
    }
  } finally {
    activePaymentLocks.delete(id);
  }
});

// Cash Closure (Cierre de Caja)
app.get("/api/cierres", (req, res) => {
  res.json(db.cierres_caja);
});

app.post("/api/cierres", requireAdmin, (req, res) => {
  const { id_vendedor, denominaciones, monto_entregado_cs, monto_entregado_usd } = req.body;

  if (!id_vendedor || !denominaciones) {
    return res.status(400).json({ error: "Datos de arqueo incompletos." });
  }

  const user = db.usuarios.find((u: any) => u.id === id_vendedor);
  if (!user) {
    return res.status(404).json({ error: "Vendedor no encontrado." });
  }

  // Calculate system sales for this seller today that are not voided (anulado)
  const sellerSales = db.ventas.filter(
    (v: any) => v.id_vendedor === id_vendedor && !v.anulado
  );

  let systemCs = 0;
  let systemUsd = 0;

  sellerSales.forEach((v: any) => {
    if (v.moneda === "C$") systemCs += v.monto_pago;
    if (v.moneda === "USD") systemUsd += v.monto_pago;
  });

  const entregadoCs = Number(monto_entregado_cs) || 0;
  const entregadoUsd = Number(monto_entregado_usd) || 0;

  const descuadreCs = entregadoCs - systemCs;
  const descuadreUsd = entregadoUsd - systemUsd;

  const cierreId = "cierre_" + Math.random().toString(36).substring(2, 9);
  const newCierre = {
    id: cierreId,
    id_vendedor,
    nombre_vendedor: user.nombre,
    fecha: getLocalDateString(),
    denominaciones,
    monto_entregado_cs: entregadoCs,
    monto_entregado_usd: entregadoUsd,
    monto_sistema_cs: systemCs,
    monto_sistema_usd: systemUsd,
    descuadre_cs: descuadreCs,
    descuadre_usd: descuadreUsd,
    timestamp: new Date().toISOString()
  };

  db.cierres_caja.push(newCierre);
  saveToDB();
  res.status(201).json(newCierre);
});

// Marcar cierre como cobrado
app.patch("/api/cierres/:id", (req, res) => {
  const { id } = req.params;
  const cc = db.cierres_caja.find((c: any) => c.id === id);
  if (!cc) {
    return res.status(404).json({ error: "Cierre de caja no encontrado." });
  }
  cc.cobrado = true;
  saveToDB();
  res.json({ success: true, message: "Cierre marcado como cobrado exitosamente.", closure: cc });
});

// FASE 2: API de Resumen Diario, Cobros y Pagos

// ============================================================================
// FASE 3: STARTUP SYNC, BACKFILL Y AUDITORÍA
// ============================================================================

// Sincronización robusta "Get or Create" para el Resumen Diario
function getOrCreateResumenDiario(id_vendedor: string, nombre_vendedor: string, dateStr: string) {
  const resumenId = `${id_vendedor}_${dateStr}`;
  let resumen = db.resumenes_diarios.find((r: any) => r.id === resumenId);

  if (!resumen) {
    resumen = {
      id: resumenId,
      id_vendedor,
      nombre_vendedor,
      fecha: dateStr,
      vendido: 0,
      pagado: 0,
      cierre: 'pendiente',
      egreso: 0,
      timestamp_creacion: new Date().toISOString(),
      timestamp_actualizacion: new Date().toISOString()
    };
    db.resumenes_diarios.push(resumen);
    saveToDB();
  }
  return resumen;
}

// Endpoint invocado desde App.tsx (Login) para inicializar el día
app.post("/api/resumen-diario/init", checkAuth(), (req, res) => {
  const { id_vendedor, nombre_vendedor } = req.body;
  if (!id_vendedor || !nombre_vendedor) {
    return res.status(400).json({ error: "Faltan datos." });
  }

  const today = new Date();
  const dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-" + String(today.getDate()).padStart(2, '0');

  const resumen = getOrCreateResumenDiario(id_vendedor, nombre_vendedor, dateStr);
  res.json({ success: true, resumen });
});

// Endpoint de migración histórica (Backfill)
app.post("/api/admin/backfill-resumenes", requireAdmin, (req, res) => {
  const { default_status = 'pagado' } = req.body; // Puede ser 'pagado' o 'pendiente'

  // 1. Obtener todas las ventas no anuladas
  const ventasValidas = db.ventas.filter((v: any) => v.estado !== 'anulado');

  // 2. Agrupar por vendedor y fecha
  const groups: Record<string, { id_vendedor: string, nombre_vendedor: string, fecha: string, vendido: number, pagado: number }> = {};

  ventasValidas.forEach((v: any) => {
    const d = new Date(v.timestamp);
    const dateStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
    const key = `${v.id_vendedor}_${dateStr}`;

    if (!groups[key]) {
      groups[key] = {
        id_vendedor: v.id_vendedor,
        nombre_vendedor: v.nombre_vendedor || "Vendedor",
        fecha: dateStr,
        vendido: 0,
        pagado: 0
      };
    }

    groups[key].vendido += v.total_cs || 0;
    if (v.estado === 'pagado') {
      groups[key].pagado += v.monto_ganado_cs || 0;
    }
  });

  // 3. Upsert en resumenes_diarios
  let migrados = 0;
  for (const key in groups) {
    const g = groups[key];
    let resumen = db.resumenes_diarios.find((r: any) => r.id === key);

    if (!resumen) {
      resumen = {
        id: key,
        id_vendedor: g.id_vendedor,
        nombre_vendedor: g.nombre_vendedor,
        fecha: g.fecha,
        vendido: g.vendido,
        pagado: g.pagado,
        cierre: default_status, // Estado por defecto elegido por el admin
        egreso: default_status === 'pagado' ? (g.vendido - g.pagado) : 0,
        timestamp_creacion: new Date().toISOString(),
        timestamp_actualizacion: new Date().toISOString()
      };
      db.resumenes_diarios.push(resumen);
      migrados++;
    } else {
      // Solo actualizamos los montos si ya existe, no tocamos el estado para no corromper cobros actuales
      resumen.vendido = g.vendido;
      resumen.pagado = g.pagado;
      resumen.timestamp_actualizacion = new Date().toISOString();
      migrados++;
    }
  }

  saveToDB();
  res.json({ success: true, message: `Migración completada. ${migrados} resúmenes diarios actualizados/creados.` });
});

// Endpoint de Anulación de Cobro
app.post("/api/cobros/:id/anular", requireAdmin, (req, res) => {
  const { id } = req.params;

  const cobro = db.cobros_admin.find((c: any) => c.id === id);
  if (!cobro) {
    return res.status(404).json({ error: "Cobro no encontrado." });
  }

  if (cobro.estado === 'anulado') {
    return res.status(400).json({ error: "El cobro ya se encuentra anulado." });
  }

  // 1. Anular el cobro
  cobro.estado = 'anulado';

  // 2. Revertir los resumenes_diarios asociados
  let resumenesRevertidos = 0;
  db.resumenes_diarios.forEach((r: any) => {
    if (r.id_cobro === id) {
      r.cierre = 'pendiente';
      r.egreso = 0;
      delete r.id_cobro;
      delete r.timestamp_cobro;
      delete r.procesado_por;
      r.timestamp_actualizacion = new Date().toISOString();
      resumenesRevertidos++;
    }
  });

  // 3. Anular pagos de comisión relacionados
  let comisionesAnuladas = 0;
  db.pagos_comision.forEach((p: any) => {
    if (p.id_cobro_relacionado === id && p.estado !== 'anulado') {
      p.estado = 'anulado';
      comisionesAnuladas++;
    }
  });

  saveToDB();
  res.json({
    success: true,
    message: "Cobro anulado exitosamente.",
    resumenes_revertidos: resumenesRevertidos,
    comisiones_anuladas: comisionesAnuladas
  });
});


app.get("/api/resumen-diario/pendientes", (req, res) => {
  const { id_vendedor, fecha_inicio, fecha_fin } = req.query;
  if (!id_vendedor || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: "Faltan parámetros" });
  }

  const start = new Date(fecha_inicio as string).getTime();
  const end = new Date(fecha_fin as string).getTime() + 86400000;

  const ventasPeriodo = db.ventas.filter((v: any) =>
    v.id_vendedor === id_vendedor &&
    new Date(v.timestamp).getTime() >= start &&
    new Date(v.timestamp).getTime() < end
  );

  const grouped: Record<string, any> = {};
  ventasPeriodo.forEach((v: any) => {
    const d = new Date(v.timestamp);
    const dateStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
    if (!grouped[dateStr]) {
      grouped[dateStr] = { vendido: 0, pagado: 0 };
    }
    if (v.estado !== 'anulado') {
      grouped[dateStr].vendido += v.total_cs || 0;
    }
    if (v.estado === 'pagado') {
      grouped[dateStr].pagado += v.monto_ganado_cs || 0;
    }
  });

  const resumenes = [];
  let hayVentas = Object.keys(grouped).length > 0;

  for (const dateStr of Object.keys(grouped)) {
    const id = `${id_vendedor}_${dateStr}`;
    const existente = db.resumenes_diarios.find((r: any) => r.id === id);
    if (existente && existente.cierre === 'pagado') {
      continue;
    }

    const vendedorInfo = db.usuarios.find((u: any) => u.id === id_vendedor);

    resumenes.push({
      id,
      id_vendedor,
      nombre_vendedor: vendedorInfo ? vendedorInfo.nombre : "Desconocido",
      fecha: dateStr,
      vendido: grouped[dateStr].vendido,
      pagado: grouped[dateStr].pagado,
      cierre: 'pendiente',
      egreso: 0,
      timestamp_creacion: new Date().toISOString(),
      timestamp_actualizacion: new Date().toISOString()
    });
  }

  if (hayVentas && resumenes.length === 0) {
    return res.json({ resumenes: [], mensaje: "Los días dentro de este rango ya han sido liquidados y cobrados anteriormente." });
  }

  res.json({ resumenes, mensaje: "" });
});

app.post("/api/cobros/procesar", requireAdmin, (req, res) => {
  const { id_admin, id_supervisor, id_vendedor, rango_inicio, rango_fin, dias_cerrados, total_vendido, total_pagado, total_neto } = req.body;

  const procesadorId = id_admin || id_supervisor;
  const admin = db.usuarios.find((u: any) => u.id === procesadorId);
  const vendedor = db.usuarios.find((u: any) => u.id === id_vendedor);

  const id_cobro = `cobro_${Date.now()}`;
  const timestamp = new Date().toISOString();

  const nuevoCobro = {
    id: id_cobro,
    id_admin: procesadorId, // backward compatible, stores who processed it
    nombre_admin: admin ? admin.nombre : (id_supervisor ? "Supervisor" : "Admin"),
    id_vendedor,
    nombre_vendedor: vendedor ? vendedor.nombre : "Vendedor",
    rango_inicio,
    rango_fin,
    total_vendido,
    total_pagado,
    total_neto,
    dias_cerrados: dias_cerrados.map((d: any) => d.id),
    timestamp
  };

  db.cobros_admin.push(nuevoCobro);

  for (const dia of dias_cerrados) {
    let rd = db.resumenes_diarios.find((r: any) => r.id === dia.id);
    if (!rd) {
      rd = { ...dia };
      db.resumenes_diarios.push(rd);
    }
    rd.cierre = 'pagado';
    rd.egreso = rd.vendido - rd.pagado;
    rd.id_cobro = id_cobro;
    rd.timestamp_cobro = timestamp;
    rd.procesado_por = procesadorId;
    rd.timestamp_actualizacion = timestamp;
  }

  saveToDB();
  res.json({ success: true, cobro: nuevoCobro });
});

app.post("/api/pagos/registrar", requireAdmin, (req, res) => {
  const { id_admin, id_vendedor, monto_pago, concepto, id_cobro_relacionado } = req.body;
  const vendedor = db.usuarios.find((u: any) => u.id === id_vendedor);

  const nuevoPago = {
    id: `pago_${Date.now()}`,
    id_admin,
    id_vendedor,
    nombre_vendedor: vendedor ? vendedor.nombre : "Vendedor",
    monto_pago,
    concepto,
    id_cobro_relacionado,
    timestamp: new Date().toISOString()
  };

  db.pagos_comision.push(nuevoPago);
  saveToDB();
  res.json({ success: true, pago: nuevoPago });
});

// ─── STARTUP: listen FIRST, sync Firestore in background ───────────
function startServer() {
  if (process.env.NODE_ENV !== "production") {
    // Dynamic import so Vite is NOT bundled into the production build
    import("vite").then(({ createServer: createViteServer }) => {
      createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      }).then((vite) => {
        app.use(vite.middlewares);
        registerCatchAllRoutes();
        listen();
      });
    });
  } else {
    registerCatchAllRoutes();
    listen();
  }
}

function registerCatchAllRoutes() {
  const distPath = path.join(process.cwd(), "dist");

  if (process.env.NODE_ENV === "production") {
    app.use(express.static(distPath));
    app.use('/assets', express.static(path.join(distPath, "assets")));
    app.use('/assets', (_req, res) => { res.status(404).send('Asset no encontrado'); });
    app.get("*", (_req, res) => { res.sendFile(path.join(distPath, "index.html")); });
  }
}

function listen() {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Express API] Servidor escuchando en puerto ${PORT} — listo para recibir tráfico`);
    // Sync Firestore en background — NO bloquea el arranque
    syncFromFirestore().then(() => {
      console.log(`[Express API] Firestore sincronizado. Usuarios en memoria: ${db.usuarios.length}`);
    }).catch((err) => {
      console.error(`[Express API] Error sincronizando Firestore:`, err.message);
    });
  });
}

startServer();
