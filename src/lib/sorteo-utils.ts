import { Sorteo } from "../types";

const DIA_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/**
 * Returns true if the sorteo is enabled for the given date.
 * If dias_habilitados is undefined/empty, the sorteo runs every day.
 */
export function isSorteoHabilitado(sorteo: Sorteo, date?: Date): boolean {
  if (!sorteo.dias_habilitados || sorteo.dias_habilitados.length === 0) return true;
  const dayOfWeek = (date || new Date()).getDay(); // 0=Sun..6=Sat
  return sorteo.dias_habilitados.includes(dayOfWeek);
}

/**
 * Returns true if a specific YYYY-MM-DD date string is valid for the sorteo.
 */
export function isDateValidForSorteo(sorteo: Sorteo, dateStr: string): boolean {
  if (!sorteo.dias_habilitados || sorteo.dias_habilitados.length === 0) return true;
  const d = new Date(dateStr + "T12:00:00");
  return sorteo.dias_habilitados.includes(d.getDay());
}

/**
 * Returns the next valid date (YYYY-MM-DD) starting from `from` (inclusive).
 * If `from` itself is valid, returns it.
 */
export function getNextValidDate(sorteo: Sorteo, from?: Date): string {
  const base = from || new Date();
  const d = new Date(base);
  for (let i = 0; i < 8; i++) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    if (isDateValidForSorteo(sorteo, dateStr)) return dateStr;
    d.setDate(d.getDate() + 1);
  }
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns a human-readable label for the enabled days.
 * e.g. "Solo: Martes" or "Solo: Lunes, Miércoles, Viernes"
 */
export function getDiasHabilitadosLabel(sorteo: Sorteo): string {
  if (!sorteo.dias_habilitados || sorteo.dias_habilitados.length === 0) return "";
  const names = sorteo.dias_habilitados.map((d) => DIA_NAMES[d]);
  return `Solo: ${names.join(", ")}`;
}

/**
 * Returns short labels for the enabled days.
 * e.g. "SOLO MARTES" or "LU, MI, VI"
 */
export function getDiasHabilitadosShortLabel(sorteo: Sorteo): string {
  if (!sorteo.dias_habilitados || sorteo.dias_habilitados.length === 0) return "";
  const short = ["DO", "LU", "MA", "MI", "JU", "VI", "SA"];
  const names = sorteo.dias_habilitados.map((d) => short[d]);
  return `SOLO ${names.join(", ")}`;
}
