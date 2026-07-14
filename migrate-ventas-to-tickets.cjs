/**
 * MIGRATION SCRIPT: Move all documents from Firestore "ventas" → "tickets"
 *
 * Usage:  node migrate-ventas-to-tickets.cjs
 *
 * What it does:
 *   1. Reads every document in the "ventas" collection
 *   2. For each document, writes it to "tickets" (using the same doc ID)
 *   3. Skips documents that already exist in "tickets" (idempotent)
 *   4. Reports what was migrated, skipped, or failed
 *   5. Does NOT delete from "ventas" (safe — you can delete manually after validation)
 *
 * Requires: service-account.json in project root, google-adminsdk installed.
 */

const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");

// ─── INIT FIREBASE ADMIN ────────────────────────────────────────────
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "service-account.json");

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error("ERROR: service-account.json no encontrado en la raíz del proyecto.");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf-8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const VENTAS_REF = db.collection("ventas");
const TICKETS_REF = db.collection("tickets");

// ─── MIGRATION ──────────────────────────────────────────────────────
async function migrate() {
  console.log("=== MIGRACIÓN: ventas → tickets ===\n");

  // 1. Count docs in both collections
  const ventasSnap = await VENTAS_REF.limit(1).get();
  const ventasCount = (await VENTAS_REF.count().get()).data().count;
  const ticketsCount = (await TICKETS_REF.count().get()).data().count;
  console.log(`Documentos en "ventas":   ${ventasCount}`);
  console.log(`Documentos en "tickets":  ${ticketsCount}`);
  console.log("");

  if (ventasCount === 0) {
    console.log("No hay documentos en "ventas". Nada que migrar.");
    process.exit(0);
  }

  // 2. Read ALL docs from ventas
  const allVentas = await VENTAS_REF.get();
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const doc of allVentas.docs) {
    const docId = doc.id;
    const data = doc.data();

    try {
      // Check if already exists in tickets
      const existing = await TICKETS_REF.doc(docId).get();
      if (existing.exists) {
        skipped++;
        continue;
      }

      // Write to tickets
      await TICKETS_REF.doc(docId).set(data);
      migrated++;

      if (migrated % 50 === 0) {
        process.stdout.write(`  ... migrados ${migrated} documentos\n`);
      }
    } catch (err) {
      failed++;
      errors.push({ id: docId, error: err.message });
      console.error(`  ERROR migrando ${docId}: ${err.message}`);
    }
  }

  // 3. Report
  console.log("\n=== RESULTADO ===");
  console.log(`  Migrados:   ${migrated}`);
  console.log(`  Omitidos:   ${skipped} (ya existían en tickets)`);
  console.log(`  Fallidos:   ${failed}`);

  if (errors.length > 0) {
    console.log("\nErrores:");
    errors.forEach(e => console.log(`  - ${e.id}: ${e.error}`));
  }

  console.log('\nLa colección "ventas" NO fue eliminada. Puedes borrarla manualmente después de verificar.');
  console.log("=== MIGRACIÓN COMPLETA ===");
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
