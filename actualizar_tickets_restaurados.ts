import dotenv from "dotenv";
import { createRequire } from "node:module";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

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
  console.error("❌ Módulo firebase-admin no encontrado.");
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

async function actualizarTicketsRestaurados() {
  console.log("🔍 Buscando vendedores en Firestore...");

  const usersSnap = await db.collection("usuarios").get();
  const usersMap = new Map<string, { id: string; nombre: string }>();
  usersSnap.forEach((doc) => {
    const data = doc.data();
    const cleanNombre = (data.nombre || "").toUpperCase().trim();
    usersMap.set(cleanNombre, { id: doc.id, nombre: data.nombre });
    console.log(`👤 Usuario encontrado: ID="${doc.id}" | Nombre="${data.nombre}"`);
  });

  const nataliaUser = usersMap.get("NATALIA VEGA") || usersMap.get("NATALIA") || { id: "usr_natalia_vega", nombre: "Natalia Vega" };
  const esmaylingUser = usersMap.get("ESMAYLING JIRON") || usersMap.get("ESMAYLING JIRÓN") || usersMap.get("ESMAYLING") || { id: "usr_esmayling_jiron", nombre: "Esmayling Jirón" };

  console.log("\n📌 Asignando datos exactos:");
  console.log(`Natalia -> ID: ${nataliaUser.id}, Nombre: ${nataliaUser.nombre}`);
  console.log(`Esmayling -> ID: ${esmaylingUser.id}, Nombre: ${esmaylingUser.nombre}`);

  // Definición de las 3 actualizaciones específicas
  const updates = [
    {
      docId: "P0UnodONTnO6Zr4M4XMR",
      label: "Ticket A (Natalia Vega)",
      user: nataliaUser,
      isoDate: "2026-08-09T10:52:00.000-06:00"
    },
    {
      docId: "5CI2zw1cKoVMRixm0ULW",
      label: "Ticket B (Esmayling Jiron - 10:55 AM)",
      user: esmaylingUser,
      isoDate: "2026-08-09T10:55:00.000-06:00"
    },
    {
      docId: "ac9VHQCJ0hTT7jqvhRWm",
      label: "Ticket C (Esmayling Jiron - 2:21 PM)",
      user: esmaylingUser,
      isoDate: "2026-08-09T14:21:00.000-06:00"
    }
  ];

  for (const item of updates) {
    const docRef = db.collection("tickets").doc(item.docId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      console.error(`❌ Documento ${item.docId} no existe.`);
      continue;
    }

    const jsDate = new Date(item.isoDate);
    const firestoreTs = Timestamp.fromDate(jsDate);

    const updatePayload = {
      // 1. Nombre e ID del Vendedor (Formatos exactos de la interfaz)
      id_vendedor: item.user.id,
      nombre_vendedor: item.user.nombre,
      vendedor: item.user.nombre,
      
      // 2. Estado Válido
      estado: "VALIDO",

      // 3. Formato de Fecha: Firestore Timestamp real + fecha_venta YYYY-MM-DD + ISO string
      timestamp: firestoreTs,
      timestamp_servidor: item.isoDate,
      fecha_emision: firestoreTs,
      fecha_venta: "2026-08-09"
    };

    await docRef.update(updatePayload);
    console.log(`✅ [ACTUALIZADO EN FIRESTORE] ${item.label} (${item.docId})`);
    console.log(`   └─ id_vendedor: "${item.user.id}" | nombre_vendedor/vendedor: "${item.user.nombre}" | estado: "VALIDO" | timestamp: Firestore.Timestamp`);
  }

  console.log("\n🎉 Todos los documentos fueron actualizados exitosamente en Firestore.");
}

actualizarTicketsRestaurados().catch((err) => {
  console.error("❌ Error ejecutando actualización:", err);
  process.exit(1);
});
