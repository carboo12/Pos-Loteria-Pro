#!/usr/bin/env node
/**
 * Test de multiplicadores — verifica que todos los juegos/sorteos conocidos
 * tengan un multiplicador definido en calculatePrizeMultiplier.
 *
 * USO:
 *   node test-multipliers.cjs
 */

// ─── Copia exacta de la función (debe coincidir con prize-utils.ts y server.ts) ──
function calculatePrizeMultiplier(juego, sorteo) {
  const cleanJuego = (juego || "").trim();

  if (cleanJuego === "Súper Premio (HN)") throw new Error("Sorteo eliminado de la plataforma");

  const multipliers = {
    "Jugá 3": 610,
    "Pega 3": 600,
    "Premia2": 4000,
    "Fechas": 210,
    "3 Monazos": 650,
    "Diaria": 80,
    "La Diaria": 80,
    "Tica": 80,
    "Terminación 2": 80,
    "Sabadito": 80,
    "La Primera": 80,
  };

  if (cleanJuego in multipliers) return multipliers[cleanJuego];
  throw new Error(`Sorteo no definido: juego="${juego}" sorteo="${sorteo}"`);
}

// ─── Casos de prueba ───────────────────────────────────────────────────
// Formato: [juego, sorteo, multiplicador_esperado, descripcion]
// null = se espera que lance Error
const casos = [
  // Nicaragua
  ["Jugá 3",         "Jugá 3 11:00 AM (NI)",     610,  "Jugá 3 Nicaragua"],
  ["Jugá 3",         "Jugá 3 9:00 PM (NI)",      610,  "Jugá 3 Nicaragua (2do turno)"],
  ["Premia2",        "Premia2 (NI)",              4000, "Premia2 Nicaragua"],
  ["Premia2",        "Premia2 (HN)",              4000, "Premia2 Honduras"],
  ["Fechas",         "Fechas (NI)",               210,  "Fechas Nicaragua"],
  ["Diaria",         "Diaria (NI)",               80,   "Diaria Nicaragua"],

  // Honduras
  ["Pega 3",         "Pega 3 11:00 AM (HN)",     600,  "Pega 3 Honduras"],
  ["Pega 3",         "Pega 3 6:00 PM (HN)",      600,  "Pega 3 Honduras (2do turno)"],
  ["La Diaria",      "La Diaria (HN)",            80,   "La Diaria Honduras"],

  // Costa Rica
  ["3 Monazos",      "3 Monazos (CR)",            650,  "3 Monazos Costa Rica"],
  ["Tica",           "Tica (CR)",                 80,   "Tica Costa Rica"],

  // Otros
  ["Terminación 2",  "Terminación 2 (NI)",        80,   "Terminación 2 Nicaragua"],
  ["Sabadito",       "Sabadito (NI)",             80,   "Sabadito Nicaragua"],
  ["La Primera",     "La Primera",                80,   "La Primera"],

  // Casos que deben lanzar error
  ["Súper Premio",   "Súper Premio (HN)",         null, "Súper Premio Honduras (no está en el mapa)"],
  ["Súper Premio (HN)", "cualquiera",             null, "Súper Premio (HN) literal (eliminado)"],
  ["Juego Inventado","cualquiera",                null, "Juego inexistente"],
  ["",               "",                          null, "Juego vacío"],
];

let pasaron = 0;
let fallaron = 0;

console.log("Verificando multiplicadores...\n");

for (const [juego, sorteo, esperado, desc] of casos) {
  try {
    const resultado = calculatePrizeMultiplier(juego, sorteo);

    if (esperado === null) {
      fallaron++;
      console.log(`✗ ${desc}`);
      console.log(`  juego="${juego}" sorteo="${sorteo}" → ${resultado}x (DEBERÍA LANZAR ERROR)\n`);
    } else if (resultado === esperado) {
      pasaron++;
      console.log(`✓ ${desc}: ${resultado}x`);
    } else {
      fallaron++;
      console.log(`✗ ${desc}: esperado ${esperado}x, obtenido ${resultado}x`);
    }
  } catch (e) {
    if (esperado === null) {
      pasaron++;
      console.log(`✓ ${desc}: ${e.message}`);
    } else {
      fallaron++;
      console.log(`✗ ${desc}: Error INESPERADO → ${e.message}`);
    }
  }
}

console.log("\n" + "=".repeat(60));
console.log(`Resultados: ${pasaron} pasaron, ${fallaron} fallaron de ${casos.length} total`);
console.log("=".repeat(60));

process.exit(fallaron > 0 ? 1 : 0);
