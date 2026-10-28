/**
 * Utilidades de juegos. Centraliza el reconocimiento de "Juega 4" para que
 * pueda habilitarse desde el panel admin (creando sus sorteos en Firestore)
 * sin necesidad de parches adicionales en el POS.
 */

export const JUEGA4_GAME_NAME = "Juega 4";

function cleanGameName(juego?: string): string {
  return String(juego || "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function isJuega4(juego?: string): boolean {
  const clean = cleanGameName(juego);
  return (
    clean === "JUEGA 4" ||
    clean === "JUEGA4" ||
    clean.startsWith("JUEGA 4 ") ||
    clean.startsWith("JUEGA4 ")
  );
}

/**
 * Cantidad de dígitos esperada por juego para la entrada del POS.
 * Los juegos no contemplados mantienen el comportamiento histórico (2 dígitos).
 */
export function getMaxDigitsForGame(juego?: string): number {
  const clean = cleanGameName(juego);
  if (isJuega4(clean)) return 4;
  if (clean === "PREMIA2") return 4;
  if (clean === "JUGÁ 3" || clean === "JUGA 3" || clean === "3 MONAZOS" || clean === "PEGA 3") return 3;
  if (clean === "SÚPER PREMIO" || clean === "SUPER PREMIO") return 12;
  return 2;
}

/**
 * Normaliza un número para compararlo/almacenarlo según el juego.
 * Para Juega 4 rellena a 4 dígitos (ej: "5" -> "0005"); para el resto
 * conserva la normalización histórica de 2 dígitos.
 */
export function normalizeNumeroForGame(numero: string | number, juego?: string): string {
  // Solo Juega 4 cambia la longitud de normalización. El resto conserva
  // exactamente el padStart(2) histórico para no alterar juegos existentes.
  const digits = isJuega4(juego) ? 4 : 2;
  return String(numero ?? "").padStart(digits, "0");
}

export function numbersMatchForGame(a: string | number, b: string | number, juego?: string): boolean {
  if (isJuega4(juego)) {
    return normalizeNumeroForGame(a, juego) === normalizeNumeroForGame(b, juego);
  }
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}
