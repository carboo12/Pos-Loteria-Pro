#!/usr/bin/env node
/**
 * Recalcular premio_posible_cs en tickets "pendiente" — Dry Run + Escritura
 * 
 * USO:
 *   set FIREBASE_CONFIG_JSON=<json> && node dry-run-recalcular-premios.cjs
 * 
 * Fase 1: Analiza y muestra diferencias sin escribir.
 * Fase 2: Actualiza en Firestore los tickets con diferencias.
 */

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

// ─── Init Firebase Admin ──────────────────────────────────────────────
const FIREBASE_PROJECT_ID = "rapigestion-2";
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID
  || "ai-studio-puntodeventadelo-99bc134f-793f-40a0-acdb-49f626766fdc";
const TASA_CAMBIO_DEFAULT = 36.5;

let serviceAccount;
const configJson = process.env.FIREBASE_CONFIG_JSON;
if (configJson) {
  serviceAccount = JSON.parse(configJson);
} else {
  // Fallback: leer service-account.json local
  const fs = require("fs");
  const path = require("path");
  const localPath = path.join(__dirname, "service-account.json");
  if (fs.existsSync(localPath)) {
    console.log("INFO: Usando service-account.json local (fallback).");
    const raw = fs.readFileSync(localPath, "utf8");
    serviceAccount = JSON.parse(raw);
  } else {
    console.error("ERROR: FIREBASE_CONFIG_JSON no definida y no se encontró service-account.json.");
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.cert(serviceAccount),
  projectId: FIREBASE_PROJECT_ID,
});
const firestoreDb = getFirestore(FIRESTORE_DATABASE_ID);

// ─── Multiplier (misma lógica corregida que server.ts) ────────────────
function calculatePrizeMultiplier(juego, sorteo) {
  const cleanJuego = (juego || "").trim();

  // Sorteo Nicaragua
  if (cleanJuego === "Premia2" && (sorteo || "").includes("(NI)")) return 4000;
  if (cleanJuego === "Jugá 3") return 610;

  // Sorteo Honduras
  if (cleanJuego === "Pega 3") return 600;

  // Otros
  if (cleanJuego === "Fechas") return 210;
  if (cleanJuego === "3 Monazos") return 650;

  return 80;
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  // 1. Leer configuración (tasa de cambio)
  const configSnap = await firestoreDb.collection("configuracion").doc("general").get();
  if (!configSnap.exists) {
    console.error("ERROR: configuracion/general no existe en Firestore.");
    process.exit(1);
  }
  const config = configSnap.data();
  const tasaCambio = config.tasa_cambio || TASA_CAMBIO_DEFAULT;
  console.log(`Tasa de cambio: C$ ${tasaCambio} / USD\n`);

  // 2. Query tickets pendientes
  const ticketsSnap = await firestoreDb
    .collection("tickets")
    .where("estado", "==", "pendiente")
    .get();

  const tickets = ticketsSnap.docs;
  console.log(`Total tickets "pendiente": ${tickets.length}\n`);

  let necesitanUpdate = 0;
  let sinCambio = 0;
  const detalles = [];

  for (const doc of tickets) {
    const t = doc.data();
    const id = doc.id;
    const juego = t.juego || t.id_juego || "";
    const sorteo = t.sorteo || "";
    const moneda = t.moneda || "C$";
    const totalApostado = t.total_apostado ?? t.monto_pago ?? 0;
    const premioViejo = t.premio_posible_cs ?? 0;

    // Recalcular premio_posible_cs
    const multiplicador = calculatePrizeMultiplier(juego, sorteo);
    let premioNuevo = 0;

    if (t.jugadas && Array.isArray(t.jugadas) && t.jugadas.length > 0) {
      for (const j of t.jugadas) {
        const montoInCs = moneda === "USD"
          ? (j.monto || 0) * tasaCambio
          : (j.monto || 0);
        premioNuevo += montoInCs * multiplicador;
      }
    } else {
      const montoInCs = moneda === "USD"
        ? totalApostado * tasaCambio
        : totalApostado;
      premioNuevo = montoInCs * multiplicador;
    }

    // Redondear a 2 decimales para comparación
    premioNuevo = Math.round(premioNuevo * 100) / 100;

    const diff = Math.abs(premioNuevo - premioViejo);
    if (diff > 0.01) {
      necesitanUpdate++;
      detalles.push({
        id,
        juego,
        sorteo,
        moneda,
        monto: totalApostado,
        multiplicador,
        premioViejo,
        premioNuevo,
      });
      console.log(
        `ID: ${id.padEnd(8)} | Juego: ${(juego || "?").padEnd(10)} | Sorteo: ${(sorteo || "?").padEnd(20)} | ` +
        `Monto: C$ ${totalApostado.toFixed(2).padStart(8)} | Mult: ${String(multiplicador).padStart(4)}x | ` +
        `Premio Actual: C$ ${premioViejo.toFixed(2).padStart(10)} → Premio Nuevo: C$ ${premioNuevo.toFixed(2).padStart(10)}`
      );
    } else {
      sinCambio++;
    }
  }

  // ─── Resumen ───
  console.log("\n" + "=".repeat(100));
  console.log(`RESUMEN:`);
  console.log(`  Total tickets analizados:  ${tickets.length}`);
  console.log(`  Sin cambios:               ${sinCambio}`);
  console.log(`  Necesitan actualización:   ${necesitanUpdate}`);

  if (necesitanUpdate > 0) {
    console.log("\nDETALLE POR JUEGO:");
    const porJuego = {};
    for (const d of detalles) {
      const key = d.juego || "?";
      if (!porJuego[key]) porJuego[key] = { total: 0, diffTotal: 0 };
      porJuego[key].total++;
      porJuego[key].diffTotal += d.premioNuevo - d.premioViejo;
    }
    for (const [juego, info] of Object.entries(porJuego)) {
      console.log(`  ${juego.padEnd(12)}: ${info.total} tickets | Diferencia total: C$ ${info.diffTotal.toFixed(2)}`);
    }
  }

  console.log("=".repeat(100));
  console.log("Modo DRY RUN — No se escribió nada en Firestore.\n");

  // ─── FASE DE ESCRITURA ─────────────────────────────────────────────
  if (necesitanUpdate === 0) {
    console.log("No hay tickets que actualizar. Saliendo.");
    return;
  }

  console.log("═".repeat(100));
  console.log("FASE DE ESCRITURA — Actualizando Firestore...\n");

  let exitos = 0;
  let errores = 0;

  for (const d of detalles) {
    console.log(`Actualizando ticket ${d.id}...`);
    console.log(`  premio_posible_cs: C$ ${d.premioViejo.toFixed(2)} → C$ ${d.premioNuevo.toFixed(2)}`);
    try {
      await firestoreDb.collection("tickets").doc(d.id).update({
        premio_posible_cs: d.premioNuevo,
      });
      console.log(`  ✓ Éxito`);
      exitos++;
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
      errores++;
    }
    console.log("");
  }

  console.log("═".repeat(100));
  console.log(`Migración completada con éxito. ${exitos} tickets actualizados.`);
  if (errores > 0) {
    console.log(`ATENCIÓN: ${errores} ticket(s) fallaron. Revisar logs.`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
