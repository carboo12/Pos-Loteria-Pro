/**
 * Safe date utilities for handling Firestore Timestamps, ISO strings, and Date objects.
 * Firestore SDK returns Timestamp objects (with .toDate()) via onSnapshot,
 * but the Admin SDK serializes dates as ISO strings via REST. This module
 * normalizes both formats safely without crashing.
 *
 * TIMEZONE NOTE: All date extraction uses the browser's local timezone
 * (America/Managua, UTC-6 for Nicaraguan users). We NEVER use toISOString()
 * for date extraction because it returns UTC which can shift the date by +1
 * near midnight local time.
 */

/** Convert any date-like value to a JS Date. Returns `fallback` if unparseable. */
export function toDateSafe(value: unknown, fallback: Date = new Date()): Date {
  if (!value) return fallback;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? fallback : d;
  }
  // Firestore Timestamp duck-typing: has .toDate() method
  if (typeof value === "object" && value !== null && typeof (value as any).toDate === "function") {
    try {
      const d = (value as any).toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : fallback;
    } catch {
      return fallback;
    }
  }
  // Firestore Timestamp serialized as { seconds, nanoseconds }
  if (typeof value === "object" && value !== null && "seconds" in (value as any)) {
    try {
      const ts = value as { seconds: number; nanoseconds?: number };
      return new Date(ts.seconds * 1000 + ((ts.nanoseconds || 0) / 1e6));
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/** Extract YYYY-MM-DD in the browser's LOCAL timezone (not UTC). */
function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Extract YYYY-MM-DD string from any date-like value in LOCAL timezone. */
export function toDateStr(value: unknown): string {
  return localDateStr(toDateSafe(value));
}

/** Extract ISO string from any date-like value safely. */
export function toISOString(value: unknown): string {
  return toDateSafe(value).toISOString();
}

/**
 * Extract the YYYY-MM-DD date string from a ticket, normalizing across formats.
 * Priority: fecha_venta (YYYY-MM-DD string) > timestamp_servidor > fecha_emision.
 * This ensures filtering works regardless of which field the ticket was written with.
 */
export function getTicketDate(ticket: { fecha_venta?: string; timestamp_servidor?: string; fecha_emision?: string; [key: string]: unknown }): string {
  if (ticket.fecha_venta && typeof ticket.fecha_venta === "string" && ticket.fecha_venta.length >= 10) {
    return ticket.fecha_venta.substring(0, 10);
  }
  return toDateStr(ticket.timestamp_servidor || ticket.fecha_emision);
}

/**
 * Extract the monetary amount from a ticket, normalizing across field names.
 * Priority: total_apostado (new) > monto_pago (legacy).
 */
export function getTicketAmount(ticket: { total_apostado?: number; monto_pago?: number; [key: string]: unknown }): number {
  return (ticket.total_apostado ?? ticket.monto_pago ?? 0) as number;
}

/** Returns today's YYYY-MM-DD in the browser's local timezone. */
export function getLocalTodayStr(): string {
  return localDateStr(new Date());
}

/**
 * Returns an ISO-8601 string with -06:00 offset (Nicaragua timezone).
 * Client-side equivalent of server.ts getNicaraguaISOString().
 * Use this instead of new Date().toISOString() for Firestore writes.
 */
export function getNicaraguaISOString(date: Date = new Date()): string {
  const nic = getNicaraguaNow(date);
  const y = nic.getFullYear();
  const m = String(nic.getMonth() + 1).padStart(2, "0");
  const d = String(nic.getDate()).padStart(2, "0");
  const hh = String(nic.getHours()).padStart(2, "0");
  const mm = String(nic.getMinutes()).padStart(2, "0");
  const ss = String(nic.getSeconds()).padStart(2, "0");
  const ms = String(nic.getMilliseconds()).padStart(3, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${ms}-06:00`;
}

/**
 * Returns a Date whose getHours()/getMinutes()/getDay() return Nicaragua local time.
 * Client-side equivalent of server.ts getNicaraguaNow().
 */
function getNicaraguaNow(date: Date = new Date()): Date {
  const utcMs = date.getTime() + (date.getTimezoneOffset() * 60000);
  return new Date(utcMs + (-6 * 3600000));
}
