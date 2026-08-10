import dotenv from "dotenv";
import { createRequire } from "node:module";
import { getFirestore } from "firebase-admin/firestore";

// Cargar .env.local si existe
dotenv.config({ path: ".env.local" });

let _require: ReturnType<typeof createRequire>;
try {
  _require = createRequire(import.meta.url);
} catch {
  _require = createRequire(process.cwd() + "/server.ts");
}

const firebaseAdmin: any = (() => {
  try {
    const mod = _require("firebase-admin");
    return mod?.default || mod;
  } catch {
    return null;
  }
})();

if (!firebaseAdmin) {
  console.error("❌ Módulo firebase-admin no encontrado. Ejecute `npm install` primero.");
  process.exit(1);
}

const FIREBASE_PROJECT_ID = "rapigestion-2";
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "ai-studio-puntodeventadelo-99bc134f-793f-40a0-acdb-49f626766fdc";

function initFirebaseAdmin(): boolean {
  if (firebaseAdmin.apps?.length > 0) return true;

  const configJson = process.env.FIREBASE_CONFIG_JSON;
  if (configJson) {
    try {
      const serviceAccount = JSON.parse(configJson);
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID
      });
      console.log("✅ Firebase Admin inicializado vía FIREBASE_CONFIG_JSON");
      return true;
    } catch (e: any) {
      console.error("❌ Error al parsear FIREBASE_CONFIG_JSON:", e.message);
    }
  }

  try {
    firebaseAdmin.initializeApp({
      credential: firebaseAdmin.credential?.applicationDefault?.(),
      projectId: FIREBASE_PROJECT_ID
    });
    console.log("✅ Firebase Admin inicializado vía ADC");
    return true;
  } catch (e: any) {
    console.error("❌ Error al inicializar Firebase Admin:", e.message);
    return false;
  }
}

if (!initFirebaseAdmin()) {
  console.error("❌ No se pudo conectar a Firebase Admin.");
  process.exit(1);
}

const db = getFirestore(FIRESTORE_DATABASE_ID);

async function restaurarTickets() {
  console.log("🚀 Iniciando restauración segura de 3 tickets perdidos...");

  // 1. Obtener los vendedores de Firestore para extraer sus IDs verdaderos
  const usersSnap = await db.collection("usuarios").get();
  const usersMap = new Map<string, { id: string; nombre: string }>();
  usersSnap.forEach((doc) => {
    const data = doc.data();
    const cleanNombre = (data.nombre || "").toUpperCase().trim();
    usersMap.set(cleanNombre, { id: doc.id, nombre: data.nombre });
  });

  const natalId = usersMap.get("NATALIA VEGA")?.id || "usr_natalia_vega";
  const esmaylingId = usersMap.get("ESMAYLING JIRON")?.id || "usr_esmayling_jiron";

  // 2. Definición de los 3 tickets perdidos
  const ticketsToRestore = [
    {
      label: "Ticket A (Natalia Vega)",
      numero_ticket_propuesto: "008001",
      id_vendedor: natalId,
      nombre_vendedor: "NATALIA VEGA",
      fecha_emision: "2026-08-09T10:52:00.000-06:00",
      fecha_venta: "2026-08-09",
      id_juego: "Diaria",
      juego: "Diaria",
      id_sorteo: "ni_diaria_11",
      sorteo: "Diaria 11:00 AM (NI)",
      juego_sorteo: "Diaria Diaria 11:00 AM (NI)",
      firma_digital: "BT8-CB",
      moneda: "C$",
      monto_pago: 50,
      total_apostado: 50,
      numero_jugado: "14",
      nombre_cliente: "Genérico",
      premio_posible_cs: 4000, // 50 * 80
      estado: "pendiente",
      anulado: false,
      timestamp_servidor: "2026-08-09T10:52:00.000-06:00",
      jugadas: [
        { numero: "14", monto: 5 },
        { numero: "41", monto: 5 },
        { numero: "06", monto: 5 },
        { numero: "60", monto: 5 },
        { numero: "19", monto: 10 },
        { numero: "91", monto: 10 },
        { numero: "95", monto: 5 },
        { numero: "59", monto: 5 }
      ]
    },
    {
      label: "Ticket B (Esmayling Jiron - 10:55 AM)",
      numero_ticket_propuesto: "008002",
      id_vendedor: esmaylingId,
      nombre_vendedor: "ESMAYLING JIRON",
      fecha_emision: "2026-08-09T10:55:00.000-06:00",
      fecha_venta: "2026-08-09",
      id_juego: "Diaria",
      juego: "Diaria",
      id_sorteo: "ni_diaria_11",
      sorteo: "Diaria 11:00 AM (NI)",
      juego_sorteo: "Diaria Diaria 11:00 AM (NI)",
      firma_digital: "JD-9R",
      moneda: "C$",
      monto_pago: 70,
      total_apostado: 70,
      numero_jugado: "04",
      nombre_cliente: "Genérico",
      premio_posible_cs: 5600, // 70 * 80
      estado: "pendiente",
      anulado: false,
      timestamp_servidor: "2026-08-09T10:55:00.000-06:00",
      jugadas: [
        { numero: "04", monto: 5 },
        { numero: "40", monto: 5 },
        { numero: "05", monto: 5 },
        { numero: "50", monto: 5 },
        { numero: "06", monto: 5 },
        { numero: "60", monto: 5 },
        { numero: "07", monto: 5 },
        { numero: "70", monto: 5 },
        { numero: "08", monto: 5 },
        { numero: "80", monto: 5 },
        { numero: "09", monto: 5 },
        { numero: "90", monto: 5 },
        { numero: "19", monto: 5 },
        { numero: "91", monto: 5 }
      ]
    },
    {
      label: "Ticket C (Esmayling Jiron - 2:21 PM)",
      numero_ticket_propuesto: "008003",
      id_vendedor: esmaylingId,
      nombre_vendedor: "ESMAYLING JIRON",
      fecha_emision: "2026-08-09T14:21:00.000-06:00",
      fecha_venta: "2026-08-09",
      id_juego: "Diaria",
      juego: "Diaria",
      id_sorteo: "ni_diaria_15",
      sorteo: "Diaria 3:00 PM (NI)",
      juego_sorteo: "Diaria Diaria 3:00 PM (NI)",
      firma_digital: "DJ3-TT",
      moneda: "C$",
      monto_pago: 70,
      total_apostado: 70,
      numero_jugado: "04",
      nombre_cliente: "Genérico",
      premio_posible_cs: 5600, // 70 * 80
      estado: "pendiente",
      anulado: false,
      timestamp_servidor: "2026-08-09T14:21:00.000-06:00",
      jugadas: [
        { numero: "04", monto: 5 },
        { numero: "40", monto: 5 },
        { numero: "05", monto: 5 },
        { numero: "50", monto: 5 },
        { numero: "06", monto: 5 },
        { numero: "60", monto: 5 },
        { numero: "07", monto: 5 },
        { numero: "70", monto: 5 },
        { numero: "08", monto: 5 },
        { numero: "80", monto: 5 },
        { numero: "09", monto: 5 },
        { numero: "90", monto: 5 },
        { numero: "19", monto: 5 },
        { numero: "91", monto: 5 }
      ]
    }
  ];

  // 3. Determinar número consecutivo libre en el rango seguro (>= 008001)
  const existingTicketsSnap = await db.collection("tickets").get();
  const existingNums = new Set<string>();
  existingTicketsSnap.forEach((doc) => {
    const data = doc.data();
    if (data.numero_ticket) existingNums.add(String(data.numero_ticket));
    if (data.id_ticket) existingNums.add(String(data.id_ticket));
  });

  let currentSafeCounter = 8001;
  const getNextSafeTicketNum = (): string => {
    while (existingNums.has(String(currentSafeCounter).padStart(6, "0"))) {
      currentSafeCounter++;
    }
    const numStr = String(currentSafeCounter).padStart(6, "0");
    existingNums.add(numStr);
    currentSafeCounter++;
    return numStr;
  };

  const insertedCount = [];

  for (const item of ticketsToRestore) {
    const { label, numero_ticket_propuesto, ...ticketData } = item;
    const finalTicketNum = getNextSafeTicketNum();

    // Auto-ID de Firestore
    const docRef = db.collection("tickets").doc();

    const fullTicket = {
      id: docRef.id,
      id_ticket: finalTicketNum,
      numero_ticket: finalTicketNum,
      ...ticketData
    };

    await docRef.set(fullTicket);
    console.log(`✅ [INSERTADO] ${label} | Auto-ID: ${docRef.id} | Numero Ticket: ${finalTicketNum} | Firma: ${ticketData.firma_digital} | Total: C$ ${ticketData.monto_pago}`);
    insertedCount.push({ label, id: docRef.id, numero_ticket: finalTicketNum });
  }

  console.log("\n🎉 Restauration finalizada con éxito.");
  console.log("Resumen de inserciones:", JSON.stringify(insertedCount, null, 2));
}

restaurarTickets().catch((err) => {
  console.error("❌ Error ejecutando script de restauración:", err);
  process.exit(1);
});
