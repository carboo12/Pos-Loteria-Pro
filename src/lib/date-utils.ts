/**
 * Safe date utilities for handling Firestore Timestamps, ISO strings, and Date objects.
 * Firestore SDK returns Timestamp objects (with .toDate()) via onSnapshot,
 * but the Admin SDK serializes dates as ISO strings via REST. This module
 * normalizes both formats safely without crashing.
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

/** Extract YYYY-MM-DD string from any date-like value safely. */
export function toDateStr(value: unknown): string {
  return toDateSafe(value).toISOString().substring(0, 10);
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
