import express from "express";
import path from "path";
import fs from "fs";
import * as adminNamespace from "firebase-admin";
import { getAuth } from "firebase-admin/auth";
import bcrypt from "bcryptjs";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
const firebaseAdmin = ((adminNamespace as any).default || adminNamespace) as any;

const app = express();
const activePaymentLocks = new Set<string>();
const localSessions = new Map<string, any>(); // Fallback session storage para cuando falla Firebase Auth (adblockers/offline)

const checkAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided." });
  }
  try {
    const token = authHeader.split(" ")[1];

    // 🛑 BYPASS DE DESARROLLO PARA ADMIN
    if (token === 'bypass-dev-admin-token') {
      (req as any).user = {
        uid: 'admin_1',
        email: 'carboo12@gmail.com',
        rol: 'administrador'
      };
      return next();
    }

    // 1. Fallback local: Si el token existe en sesiones locales, permitir acceso
    if (localSessions.has(token)) {
      (req as any).user = localSessions.get(token);
      return next();
    }

    // 2. Firebase ID Token original
    const decoded = await getAuth().verifyIdToken(token);
    (req as any).user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token." });
  }
};



function calculatePrizeMultiplier(juego: string, sorteo: string): number {
  const cleanJuego = juego.trim();
  if (cleanJuego === "Premia2" && sorteo.includes("(NI)")) return 4000;
  if (cleanJuego === "Jugá 3") return 600;
  if (cleanJuego === "Fechas") return 210;
  if (cleanJuego === "3 Monazos") return 650;
  return 80;
}

const PORT = parseInt(process.env.PORT || "3000", 10);
const DB_PATH = path.join(process.cwd(), "data-store.json");

app.use(express.json());

let firestoreDbId = "";
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const configData = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (configData.firestoreDatabaseId) {
      firestoreDbId = configData.firestoreDatabaseId;
      console.log(`[Firebase Configuration] Base de datos Firestore detectada: ${firestoreDbId}`);
    }
  }
} catch (e) {
  console.error("Error reading firebase-applet-config.json:", e);
}

function getFirestoreInstance() {
  const settings = {
    // KeepAlive settings para evitar drops de conexion de gRPC
    grpc: {
      "grpc.keepalive_time_ms": 30000,
      "grpc.keepalive_timeout_ms": 10000
    }
  };

  const firestoreDb = firestoreDbId ? getFirestore(firestoreDbId) : getFirestore();
  firestoreDb.settings(settings);
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


// Initialize database file if it doesn't exist
function initDatabase() {
  if (fs.existsSync(DB_PATH)) {
    try {
      const content = fs.readFileSync(DB_PATH, "utf-8").trim();
      if (content) {
        const parsed = JSON.parse(content);
        // Ensure backward compatibility on existing databases
        if (!parsed.configuracion) parsed.configuracion = {};
        if (!parsed.configuracion.limites_numeros) parsed.configuracion.limites_numeros = [];
        if (!parsed.configuracion.resultados) parsed.configuracion.resultados = [];
        if (!parsed.configuracion.cobros) parsed.configuracion.cobros = [];

        // Migrate old default "Indicaciones del Ticket" value
        if (parsed.configuracion.formato_ticket?.ruc === "RUC-J0310000123456") {
          parsed.configuracion.formato_ticket.ruc = "exiga su ticket en su compra de su numero.";
        }

        if (!parsed.usuarios) parsed.usuarios = [];

        // Migrate existing users to the full schema
        parsed.usuarios = parsed.usuarios.map((u: any) => {
          const isOnline = u.estado === "online" || u.conexion === "online";
          const isActivo = u.activo !== false && u.estado !== "inactivo";
          return {
            id: u.id,
            nombre: u.nombre,
            usuario: u.usuario || u.nombre.toLowerCase().replace(/\s+/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
            rol: u.rol === "administrador" || u.rol === "admin" ? "administrador" : (u.rol === "supervisor" ? "supervisor" : "vendedor"),
            estado: isActivo ? "activo" : "inactivo",
            conexion: isOnline ? "online" : "offline",
            activo: isActivo,
            region: u.region || "Nicaragua",
            email: u.email || `${u.nombre.toLowerCase().replace(/\s+/g, "")}@loteria.com`,
            id_supervisor: u.id_supervisor || "",
            vendedoresAsignados: u.vendedoresAsignados || [],
            password: u.password // <-- ACCIÓN CRÍTICA: Conservar el password intacto
          };
        });

        // Sync supervisor vendedoresAsignados
        parsed.usuarios.forEach((u: any) => {
          if (u.rol === "supervisor") {
            u.vendedoresAsignados = parsed.usuarios
              .filter((v: any) => v.rol === "vendedor" && v.id_supervisor === u.id)
              .map((v: any) => v.id);
          }
        });

        if (!parsed.usuarios.some((u: any) => u.rol === "supervisor")) {
          parsed.usuarios.push({
            id: "super_1",
            nombre: "Supervisor Managua",
            usuario: "supermanagua",
            rol: "supervisor",
            estado: "activo",
            conexion: "online",
            activo: true,
            region: "Nicaragua",
            email: "supervisor@loteria.com",
            id_supervisor: "",
            vendedoresAsignados: ["vend_1", "vend_2"]
          });
          const vend1 = parsed.usuarios.find((u: any) => u.id === "vend_1");
          if (vend1) vend1.id_supervisor = "super_1";
          const vend2 = parsed.usuarios.find((u: any) => u.id === "vend_2");
          if (vend2) vend2.id_supervisor = "super_1";
        }
        return parsed;
      }
    } catch (e) {
      console.error("Error reading database, resetting...", e);
    }
  }

  const initialDB = {
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
    pagos_comision: []
  };

  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(initialDB, null, 2), "utf-8");
  return initialDB;
}

let db = initDatabase();
// Ensure dynamic backward compatibility
db.fcm_tokens = db.fcm_tokens || [];
db.resumenes_diarios = db.resumenes_diarios || [];
db.cobros_admin = db.cobros_admin || [];
db.pagos_comision = db.pagos_comision || [];

async function saveToDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("[Local Backup] Error al escribir copia de seguridad local:", err);
  }

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

      for (const v of db.ventas) {
        const { id, ...saleData } = v;
        await firestoreDb.collection("ventas").doc(id).set(saleData);
      }

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
        db.configuracion = configDoc.data();
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

      const salesSnapshot = await firestoreDb.collection("ventas").get();
      const salesList: any[] = [];
      salesSnapshot.forEach((doc: any) => {
        salesList.push({ id: doc.id, ...doc.data() });
      });
      db.ventas = salesList;
      console.log(`[Firestore Sync] ${salesList.length} ventas cargadas desde Firestore.`);

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

// Initialize Firebase Admin for real push notifications lazily
let isFirebaseAdminInitialized = false;

function findServiceAccountPath(): string | null {
  const envPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  try {
    const files = fs.readdirSync(process.cwd());
    const svcFile = files.find(f => f.includes("firebase-adminsdk") && f.endsWith(".json"));
    if (svcFile) {
      const fullPath = path.join(process.cwd(), svcFile);
      console.log(`[Firebase Admin] Archivo de credenciales detectado dinámicamente: ${svcFile}`);
      return fullPath;
    }
  } catch (e) {
    console.error("[Firebase Admin] Error al buscar credenciales dinámicamente:", e);
  }
  return null;
}

function initFirebaseAdmin() {
  if (isFirebaseAdminInitialized) return true;

  if (firebaseAdmin.apps && firebaseAdmin.apps.length > 0) {
    isFirebaseAdminInitialized = true;
    console.log("[Firebase Admin] Ya inicializado previamente.");
    return true;
  }

  // 1. Try explicit service account file (local dev)
  const serviceAccountPath = findServiceAccountPath();
  if (serviceAccountPath) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.cert(serviceAccount)
      });
      isFirebaseAdminInitialized = true;
      console.log("[Firebase Admin] Inicializado con éxito mediante Cuenta de Servicio.");
      return true;
    } catch (e) {
      console.error("[Firebase Admin] Error al inicializar con Cuenta de Servicio:", e);
    }
  }

  // 2. Always try Application Default Credentials (works on Cloud Run / App Hosting automatically)
  try {
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.applicationDefault()
    });
    isFirebaseAdminInitialized = true;
    console.log("[Firebase Admin] Inicializado mediante Application Default Credentials (Cloud Run/ADC).");
    return true;
  } catch (e) {
    console.error("[Firebase Admin] Error al inicializar con Application Default Credentials:", e);
  }

  return false;
}

async function syncDatabaseUsersToFirebaseAuth() {
  const isReady = initFirebaseAdmin();
  if (!isReady) {
    console.log("[Firebase Auth Sync] Firebase Admin no está configurado. Omitiendo sincronización de usuarios.");
    return;
  }

  console.log("[Firebase Auth Sync] Sincronizando usuarios con Firebase Auth...");

  const validUsers = db.usuarios.filter((u: any) => !!u.email);

  // Procesamiento paralelo con Promise.allSettled
  await Promise.allSettled(
    validUsers.map(async (u: any) => {
      try {
        await getAuth().getUserByEmail(u.email);
      } catch (error: any) {
        if (error.code === "auth/user-not-found" || error.code === "messaging/invalid-argument") {
          try {
            await getAuth().createUser({
              uid: u.id,
              email: u.email,
              emailVerified: true,
              password: "Loto123456!",
              displayName: u.nombre
            });
          } catch (createError: any) {
            console.error(`[Firebase Auth Sync] Error al crear ${u.email}:`, createError);
          }
        } else {
          console.error(`[Firebase Auth Sync] Error buscando ${u.email}:`, error);
        }
      }
    })
  );
}

async function firebaseCreateUser(u: any) {
  if (!initFirebaseAdmin() || !u.email) return;
  try {
    await getAuth().createUser({
      uid: u.id,
      email: u.email,
      emailVerified: true,
      password: u.password,
      displayName: u.nombre
    });
    console.log(`[Firebase Auth] Creado usuario: ${u.email}`);
  } catch (err) {
    console.error(`[Firebase Auth] Error al crear usuario:`, err);
  }
}

async function firebaseUpdateUser(uid: string, updates: { email?: string; displayName?: string; password?: string; disabled?: boolean }) {
  if (!initFirebaseAdmin()) return;
  try {
    const fbUpdates: any = {};
    if (updates.email) fbUpdates.email = updates.email;
    if (updates.displayName) fbUpdates.displayName = updates.displayName;
    if (updates.password) fbUpdates.password = updates.password;
    if (updates.disabled !== undefined) fbUpdates.disabled = updates.disabled;
    await getAuth().updateUser(uid, fbUpdates);
    console.log(`[Firebase Auth] Actualizado usuario ${uid}`);
  } catch (err) {
    console.error(`[Firebase Auth] Error al actualizar usuario ${uid}:`, err);
  }
}

async function firebaseDeleteUser(uid: string) {
  if (!initFirebaseAdmin()) return;
  try {
    await getAuth().deleteUser(uid);
    console.log(`[Firebase Auth] Eliminado usuario ${uid}`);
  } catch (err) {
    console.error(`[Firebase Auth] Error al eliminar usuario ${uid}:`, err);
  }
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

// Autenticación Híbrida (Login Endpoint)
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email y contraseña son requeridos." });
  }

  const user = db.usuarios.find((u: any) => u.email && u.email.toLowerCase() === email.toLowerCase());

  if (!user) {
    return res.status(401).json({ error: "Credenciales incorrectas o usuario no encontrado." });
  }

  if (!user.activo) {
    return res.status(403).json({ error: "Acceso denegado. Su cuenta se encuentra suspendida temporalmente." });
  }

  // Verificación de Contraseña (Híbrida)
  let isMatch = false;

  // Si la contraseña ingresada es la Master Password, dar acceso directo para testing local
  if (password === "Loto123456!") {
    isMatch = true;
  } else if (user.password) {
    if (user.password.startsWith("$2")) {
      isMatch = bcrypt.compareSync(password, user.password);
    } else {
      isMatch = user.password === password;
    }
  }

  if (!isMatch) {
    return res.status(401).json({ error: "Credenciales incorrectas." });
  }

  // Extraer el usuario seguro para el cliente (sin el campo password)
  const { password: _, ...safeUser } = user;

  // Generate Firebase custom token so the client can obtain an ID token
  let customToken: string | null = null;
  try {
    const isReady = initFirebaseAdmin();
    if (isReady) {
      customToken = await getAuth().createCustomToken(user.id);
    }
  } catch (err) {
    console.error("[Login] Error generating custom token:", err);
  }

  // Generar token local de respaldo para escenarios offline o de adblock
  const localToken = "loc_" + Math.random().toString(36).substring(2) + Date.now().toString(36);
  localSessions.set(localToken, safeUser);

  res.json({ success: true, user: safeUser, customToken, localToken, message: "Autenticación exitosa" });
});

// 🔧 ENDPOINT DE EMERGENCIA: Re-sincronizar Firebase Auth
app.post("/api/resync-auth", async (req, res) => {
  const { userId, email } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId es requerido." });
  }

  // Verificar que el usuario existe en la base de datos
  const user = db.usuarios.find((u: any) => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: "Usuario no encontrado." });
  }

  if (!user.activo) {
    return res.status(403).json({ error: "Usuario inactivo. No se puede re-sincronizar." });
  }

  // Generar un nuevo custom token
  let customToken: string | null = null;
  try {
    const isReady = initFirebaseAdmin();
    if (isReady) {
      customToken = await getAuth().createCustomToken(user.id);
      console.log(`[Resync Auth] Custom token generado para usuario: ${user.id} (${user.email})`);
    } else {
      return res.status(500).json({ error: "Firebase Admin no está inicializado." });
    }
  } catch (err: any) {
    console.error("[Resync Auth] Error generando custom token:", err);
    return res.status(500).json({ error: "Error generando custom token: " + err.message });
  }

  if (!customToken) {
    return res.status(500).json({ error: "No se pudo generar el custom token." });
  }

  res.json({ success: true, customToken, userId: user.id });
});

// Setup Administrator Account Route (Temporary / Recovery utility)
app.post("/api/setup-admin", async (req, res) => {
  const hasAdmin = db.usuarios.some((u: any) => u.rol === "administrador");
  if (hasAdmin) {
    return res.status(403).json({ success: false, message: "Ya existe un administrador en el sistema." });
  }

  const adminEmail = req.body.email || "admin@sistema.com";
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
      vendedoresAsignados: []
    };
    db.usuarios.push(userInDb);
    saveToDB();
  }

  let fbStatus = "";
  const isReady = initFirebaseAdmin();
  if (isReady) {
    try {
      try {
        await getAuth().getUserByEmail(adminEmail);
        fbStatus = "Ya registrado en Firebase Authentication.";
      } catch (err: any) {
        if (err.code === "auth/user-not-found" || err.code === "messaging/invalid-argument") {
          await getAuth().createUser({
            uid: userInDb.id,
            email: adminEmail,
            emailVerified: true,
            password: "Loto123456!",
            displayName: userInDb.nombre
          });
          fbStatus = "Creado exitosamente en Firebase Authentication.";
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      console.error("[Setup Admin Auth Error]", err);
      fbStatus = `Error en Firebase Auth: ${err.message}`;
    }
  } else {
    fbStatus = "Firebase Admin no está inicializado.";
  }

  res.json({
    success: true,
    dbUser: userInDb,
    fbStatus: fbStatus,
    message: "Inicialización completada."
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

app.post("/api/usuarios", checkAuth, (req, res) => {
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

  const newUser = {
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
    vendedoresAsignados: (resolvedRol === "supervisor" && Array.isArray(vendedoresAsignados)) ? vendedoresAsignados : []
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
  firebaseCreateUser(newUser).catch(err => console.error("Error creating Firebase user on POST:", err));
  res.status(201).json(newUser);
});

app.put("/api/usuarios/:id", (req, res) => {
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
  firebaseUpdateUser(id, { email: user.email, displayName: user.nombre, password, disabled: !user.activo }).catch(err => console.error("Error updating Firebase user on PUT:", err));
  res.json(user);
});

app.delete("/api/usuarios/:id", checkAuth, (req, res) => {
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
  firebaseDeleteUser(id).catch(err => console.error("Error deleting Firebase user on DELETE:", err));
  res.json({ success: true, message: `Usuario "${deletedUser.nombre}" eliminado.` });
});

// Number Limits Management
app.get("/api/limites-numeros", (req, res) => {
  res.json(db.configuracion.limites_numeros || []);
});

app.post("/api/limites-numeros", (req, res) => {
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

app.delete("/api/limites-numeros", (req, res) => {
  const id = req.query.id;
  if (!id) {
    return res.status(400).json({ error: "Límite ID es requerido." });
  }
  db.configuracion.limites_numeros = (db.configuracion.limites_numeros || []).filter((l: any) => l.id !== id);
  saveToDB();
  res.json({ success: true, message: "Límite eliminado." });
});

app.delete("/api/limites-numeros/:id", (req, res) => {
  const id = req.params.id || req.query.id;
  db.configuracion.limites_numeros = (db.configuracion.limites_numeros || []).filter((l: any) => l.id !== id);
  saveToDB();
  res.json({ success: true, message: "Límite eliminado." });
});

// Sorteos Winning Numbers Results
app.get("/api/resultados", (req, res) => {
  res.json(db.configuracion.resultados || []);
});

app.post("/api/resultados", (req, res) => {
  const { id_sorteo, fecha, numero_ganador } = req.body;
  if (!id_sorteo || !fecha || !numero_ganador) {
    return res.status(400).json({ error: "Sorteo, Fecha y Número ganador son requeridos." });
  }

  const newResult = {
    id: "res_" + Math.random().toString(36).substring(2, 9),
    id_sorteo,
    fecha, // YYYY-MM-DD
    numero_ganador,
    timestamp: new Date().toISOString()
  };

  db.configuracion.resultados = db.configuracion.resultados || [];
  db.configuracion.resultados.push(newResult);
  saveToDB();
  res.status(201).json(newResult);
});

app.put("/api/resultados/:id", (req, res) => {
  const { id } = req.params;
  const { id_sorteo, fecha, numero_ganador } = req.body;
  if (!id_sorteo || !fecha || !numero_ganador) {
    return res.status(400).json({ error: "Sorteo, Fecha y Número ganador son requeridos." });
  }

  db.configuracion.resultados = db.configuracion.resultados || [];
  const idx = db.configuracion.resultados.findIndex((r: any) => r.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Resultado no encontrado." });
  }

  db.configuracion.resultados[idx].id_sorteo = id_sorteo;
  db.configuracion.resultados[idx].fecha = fecha;
  db.configuracion.resultados[idx].numero_ganador = numero_ganador;

  saveToDB();
  res.json(db.configuracion.resultados[idx]);
});

app.delete("/api/resultados/:id", (req, res) => {
  const { id } = req.params;
  db.configuracion.resultados = (db.configuracion.resultados || []).filter((r: any) => r.id !== id);
  saveToDB();
  res.json({ success: true, message: "Resultado de sorteo eliminado." });
});

// Cobros / Collections
app.get("/api/cobros", (req, res) => {
  res.json(db.configuracion.cobros || []);
});

app.post("/api/cobros", checkAuth, (req, res) => {
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

// Mark closure as collected manually
app.put("/api/cierres/:id/cobrar", (req, res) => {
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

app.put("/api/configuracion", checkAuth, (req, res) => {
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
      (v.firma_digital && v.firma_digital.toUpperCase() === ticketId)
    );
    return res.json(found ? [found] : []);
  }
  res.json(db.ventas);
});

app.post("/api/ventas", checkAuth, (req, res) => {
  const { juego, sorteo, numero_jugado, monto_pago, moneda, id_vendedor, nombre_cliente, premio_posible_cs, jugadas } = req.body;

  if (!juego || !sorteo || !numero_jugado || !monto_pago || !moneda || !id_vendedor) {
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

  // 3. Atomic counter increment for tickets
  db.configuracion.contador_global_tickets += 1;
  const nextTicketNum = String(db.configuracion.contador_global_tickets).padStart(7, "0");

  const ticketId = "ticket_" + Math.random().toString(36).substring(2, 9);
  const serverTimeStr = now.toISOString();

  // 4. Calculate secure anti-photoshop digital signature
  const signature = generateDigitalSignature(
    ticketId,
    serverTimeStr,
    juego,
    numero_jugado,
    monto_pago,
    moneda
  );

  const newSale: any = {
    id: ticketId,
    numero_ticket: nextTicketNum,
    timestamp_servidor: serverTimeStr,
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
    ticketNum: nextTicketNum,
    timestamp: serverTimeStr
  };

  broadcastToSSE(notifPayload);
  sendFCMPushNotification(notifTitle, notifBody, notifPayload).catch((err) => {
    console.error("FCM dispatch error (silent):", err);
  });

  res.status(201).json(newSale);
});

// Anulación de Tickets (Basado en Hora de Cierre o Admin)
app.post("/api/ventas/:id/anular", (req, res) => {
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
  saveToDB();
  res.json({ message: "Ticket anulado con éxito.", ticket: sale });
});

// Validación y Pago de Tickets con QR
app.post("/api/ventas/:id/pagar", (req, res) => {
  const { id } = req.params;

  if (activePaymentLocks.has(id)) {
    return res.status(409).json({ error: "Transacción en proceso, por favor espere." });
  }
  activePaymentLocks.add(id);

  try {
    const sale = db.ventas.find((v: any) => v.id === id || v.numero_ticket === id || (v.firma_digital && v.firma_digital.toUpperCase() === id.toUpperCase()));

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
    const resultado = (db.configuracion.resultados || []).find((r: any) => {
      if (r.fecha !== saleDateStr) return false;
      const sorteoObj = db.configuracion.sorteos.find((s: any) => s.id === r.id_sorteo);
      return sorteoObj && sorteoObj.nombre === sale.sorteo && sorteoObj.juego === sale.juego;
    });

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

      saveToDB();
      return res.json({
        message: "¡Ganador!",
        ganador: true,
        ticket: sale,
        monto_ganado_cs: premioReal
      });
    } else {
      sale.estado = "perdedor";
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

app.post("/api/cierres", (req, res) => {
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
app.post("/api/resumen-diario/init", (req, res) => {
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
app.post("/api/admin/backfill-resumenes", (req, res) => {
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
app.post("/api/cobros/:id/anular", (req, res) => {
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

app.post("/api/cobros/procesar", (req, res) => {
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

app.post("/api/pagos/registrar", (req, res) => {
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

// Mounting Vite middleware in development
async function startServer() {
  // Sync state from Firestore
  // await syncFromFirestore();

  // Sync database users to Firebase Authentication asynchronously on start
  syncDatabaseUsersToFirebaseAuth().catch(err => {
    console.error("[Firebase Auth Sync Error] Failed to sync users on start:", err);
  });

  if (process.env.NODE_ENV !== "production") {
    // Dynamic import so Vite is NOT bundled into the production build
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");

    // Asegurar que Express sirva los assets estáticos con el tipo MIME correcto
    app.use(express.static(distPath));
    app.use('/assets', express.static(path.join(distPath, "assets")));

    // IMPORTANTE: Si un asset no existe, devolver 404, NO el index.html
    app.use('/assets', (req, res) => {
      res.status(404).send('Asset no encontrado');
    });

    // Ruta comodín al final para el enrutamiento de la SPA
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Express API] Servidor corriendo exitosamente en el puerto ${PORT}`);
  });
}

startServer();
