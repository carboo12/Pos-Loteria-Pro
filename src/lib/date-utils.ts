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

/** Returns today's YYYY-MM-DD in the Nicaragua timezone. */
export function getLocalTodayStr(): string {
  return localDateStr(getNicaraguaNow());
}

/**
 * Returns an ISO-8601 string with -06:00 offset (Nicaragua timezone).
 * Uses Intl.DateTimeFormat to extract the exact time in America/Managua
 * regardless of the browser's timezone. No manual offset math.
 */
export function getNicaraguaISOString(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Managua",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
  // sv-SE produces "2026-07-14 19:30:00,000" — replace space→T, comma→period, append offset
  return fmt.format(date).replace(" ", "T").replace(",", ".") + "-06:00";
}

/**
 * Returns a Date whose getHours()/getMinutes()/getDay() return Nicaragua local time.
 * Derived from getNicaraguaISOString() for consistency.
 */
export function getNicaraguaNow(date: Date = new Date()): Date {
  const iso = getNicaraguaISOString(date);
  const match = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    return new Date(
      parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]),
      parseInt(match[4]), parseInt(match[5]), parseInt(match[6])
    );
  }
  return date;
}

/**
 * Parse date/time parts DIRECTLY from an ISO string, ignoring the browser's timezone.
 * This is critical because `new Date(iso).getHours()` returns the browser's local hour,
 * NOT the hour encoded in the ISO string. For strings like "2026-07-14T18:29:00.000-06:00",
 * this returns { year:2026, month:7, day:14, hours:18, minutes:29, seconds:0 }.
 */
export function parseISOTimeParts(isoString: string): {
  year: number; month: number; day: number;
  hours: number; minutes: number; seconds: number;
} {
  try {
    const match = isoString.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      return {
        year: parseInt(match[1], 10),
        month: parseInt(match[2], 10),
        day: parseInt(match[3], 10),
        hours: parseInt(match[4], 10),
        minutes: parseInt(match[5], 10),
        seconds: parseInt(match[6], 10),
      };
    }
    // Fallback: use Date object (browser timezone dependent)
    const d = new Date(isoString);
    return {
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
      hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds(),
    };
  } catch {
    return { year: 0, month: 0, day: 0, hours: 0, minutes: 0, seconds: 0 };
  }
}

/** Get 12-hour time parts {h, mm, ampm} from ISO string, timezone-independent. */
export function get12HourFromISO(isoString: string): { h: number; mm: string; ampm: string } {
  const { hours, minutes } = parseISOTimeParts(isoString);
  const ampm = hours >= 12 ? "PM" : "AM";
  let h = hours % 12;
  if (h === 0) h = 12;
  return { h, mm: String(minutes).padStart(2, "0"), ampm };
}
