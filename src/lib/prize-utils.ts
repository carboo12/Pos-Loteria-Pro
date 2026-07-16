/**
 * Shared prize calculation logic used by VendedorInterface, SupervisorInterface,
 * AdminInterface, and TicketPreviewModal. Single source of truth for
 * multiplier tables, theoretical prize computation, and game/draw parsing.
 */

import { getTicketDate } from "./date-utils";

/** Game/draw display names (used for matching sorteo config). */
export interface ParsedGameDraw {
  game: string;
  draw: string;
}

/**
 * Extract game and draw strings from a ticket, trying new fields first,
 * then falling back to parsing the legacy `juego_sorteo` compound string.
 */
export function parseGameDraw(ticket: {
  id_juego?: string;
  id_sorteo?: string;
  juego_sorteo?: string;
  [key: string]: unknown;
}): ParsedGameDraw {
  let game = ticket.id_juego || "";
  let draw = ticket.id_sorteo || "";
  if (game && draw) return { game, draw };

  const js = ticket.juego_sorteo || "";
  const prefixes = [
    "La Diaria", "Premia2", "Pega 3", "Jugá 3", "Diaria",
    "Fechas", "Terminación 2", "Súper Premio", "3 Monazos",
  ];
  for (const p of prefixes) {
    if (js.startsWith(p)) {
      return { game: p, draw: js.substring(p.length).trim() };
    }
  }
  const parts = js.split(" ");
  return { game: parts[0] || "", draw: parts.slice(1).join(" ") };
}

/** Prize multiplier table — the authoritative rules for all games. */
export function calculatePrizeMultiplier(juego: string, sorteo: string): number {
  const cleanJuego = juego.trim();

  if (cleanJuego === "Súper Premio (HN)") throw new Error("Sorteo eliminado de la plataforma");

  const multipliers: Record<string, number> = {
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

/**
 * Convert any date-like value to a YYYY-MM-DD string in CST (UTC-6),
 * matching the server's local date convention for sorteo matching.
 */
function toLocalDateStr(dateInput: unknown): string {
  if (!dateInput) return "";
  let date: Date;
  if (dateInput instanceof Date) {
    date = dateInput;
  } else if (typeof dateInput === "string") {
    date = new Date(dateInput);
  } else if (dateInput && typeof (dateInput as any).toDate === "function") {
    date = (dateInput as any).toDate();
  } else {
    date = new Date(dateInput as any);
  }
  if (isNaN(date.getTime())) return "";
  const offset = -6;
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const local = new Date(utc + 3600000 * offset);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Compute the theoretical prize a ticket would pay based on official draw results.
 * Returns 0 if the ticket is annulled, the draw hasn't happened yet, or no numbers match.
 *
 * This is the SINGLE function used by Vendedor, Supervisor, and Admin for
 * "A Pagar" calculations — it handles both single-jugada and multi-jugada tickets.
 */
export function getTicketTheoreticalPrize(
  ticket: {
    estado?: string;
    id_juego?: string;
    id_sorteo?: string;
    juego_sorteo?: string;
    jugadas?: { numero: string; monto: number }[];
    numero_jugado?: string;
    monto_pago?: number;
    moneda?: string;
    fecha_emision_date?: Date | string;
    timestamp_servidor?: string;
    fecha_emision?: string;
    fecha_venta?: string;
    [key: string]: unknown;
  },
  config: {
    sorteos?: { id: string; nombre: string; juego: string }[];
    resultados?: { id_sorteo: string; fecha: string; numero_ganador: string }[];
    tasa_cambio?: number;
  },
): number {
  if (!config || !config.sorteos) return 0;
  if (ticket.estado === "anulado") return 0;

  const { game, draw } = parseGameDraw(ticket);
  if (!game || !draw) return 0;

  // Date in CST to match sorteo result dates
  const tDate = toLocalDateStr(
    (ticket as any).fecha_emision_date || ticket.timestamp_servidor || ticket.fecha_venta
  );
  if (!tDate) return 0;

  const sObj = config.sorteos?.find((d) => (d.nombre === draw && d.juego === game) || d.id === draw);
  const rObj = sObj
    ? (config.resultados || []).find((r: any) => r.id_sorteo === sObj.id && r.fecha === tDate)
    : null;

  if (!rObj) return 0;

  const winnerNum = rObj.numero_ganador.trim().toLowerCase();
  const multiplier = calculatePrizeMultiplier(game, draw);
  let prize = 0;

  if (ticket.jugadas && ticket.jugadas.length > 0) {
    for (const j of ticket.jugadas) {
      if (j.numero.trim().toLowerCase() === winnerNum) {
        let p = j.monto * multiplier;
        if (ticket.moneda === "USD") p *= config.tasa_cambio || 36.5;
        prize += p;
      }
    }
  } else if (ticket.numero_jugado) {
    if (ticket.numero_jugado.trim().toLowerCase() === winnerNum) {
      let p = (ticket.monto_pago || 0) * multiplier;
      if (ticket.moneda === "USD") p *= config.tasa_cambio || 36.5;
      prize += p;
    }
  }

  return prize;
}
