/**
 * Shared prize calculation logic used by VendedorInterface, SupervisorInterface,
 * AdminInterface, and TicketPreviewModal. Single source of truth for
 * multiplier tables, theoretical prize computation, and game/draw parsing.
 */

import { getTicketDate } from "./date-utils";

/**
 * Techo general de venta: máximo monto apostable por un número individual
 * (jugada) expresado en Córdobas (C$). Se aplica a TODOS los vendedores,
 * en todos los juegos y todos los sorteos. Es un techo rígido.
 */
export const MAX_MONTO_POR_NUMERO_CS = 500;

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

export function calculatePrizeMultiplier(juego: string, sorteo: string = ""): number {
  if (!juego) return 80;
  // Limpiar el nombre del juego eliminando sufijos regionales o paréntesis (ej: "DIARIA (NI)" -> "DIARIA")
  const cleanJuego = juego
    .replace(/\s*\([^)]*\)/g, "") // Remueve todo dentro de paréntesis ej "(NI)", "(HN)"
    .trim();

  const cleanJuegoUpper = cleanJuego.toUpperCase();

  const multipliers: Record<string, number> = {
    "JUGÁ 3": 610,
    "JUGA 3": 610,
    "PEGA 3": 600,
    "PREMIA2": 4000,
    "FECHAS": 210,
    "3 MONAZOS": 650,
    "DIARIA": 80,
    "LA DIARIA": 80,
    "SALVADOR": 80,
    "SALVADOREÑA": 80,
    "TICA": 80,
    "TERMINACIÓN 2": 80,
    "TERMINACION 2": 80,
    "SABADITO": 80,
    "LA PRIMERA": 80,
  };

  // Coincidencia exacta limpia
  if (cleanJuegoUpper in multipliers) {
    return multipliers[cleanJuegoUpper];
  }

  // Coincidencia parcial si contiene palabras clave específicas
  if (cleanJuegoUpper.includes("JUGA 3") || cleanJuegoUpper.includes("JUGÁ 3")) return 610;
  if (cleanJuegoUpper.includes("PEGA 3")) return 600;
  if (cleanJuegoUpper.includes("PREMIA")) return 4000;
  if (cleanJuegoUpper.includes("FECHA")) return 210;
  if (cleanJuegoUpper.includes("MONAZO")) return 650;

  // Fallback seguro a 80x (multiplicador estándar de Diaria) para evitar crashes
  return 80;
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
 * Normaliza el valor de un número o fecha (ej: "08-AGO" <-> "08-Agosto" <-> "08-08")
 * para determinar si una jugada coincide con el número ganador oficial.
 */
export function isMatchingWinner(jugadoStr: string, ganadorStr: string, juegoName?: string): boolean {
  if (!jugadoStr || !ganadorStr) return false;
  const j = jugadoStr.trim().toLowerCase();
  const g = ganadorStr.trim().toLowerCase();
  if (j === g) return true;

  // Normalizador especial para el juego Fechas
  const normalizeMonth = (m: string) => {
    const lower = m.toLowerCase().trim();
    if (/^(1|01|enero|ene)$/.test(lower)) return "01";
    if (/^(2|02|febrero|feb)$/.test(lower)) return "02";
    if (/^(3|03|marzo|mar)$/.test(lower)) return "03";
    if (/^(4|04|abril|abr)$/.test(lower)) return "04";
    if (/^(5|05|mayo|may)$/.test(lower)) return "05";
    if (/^(6|06|junio|jun)$/.test(lower)) return "06";
    if (/^(7|07|julio|jul)$/.test(lower)) return "07";
    if (/^(8|08|agosto|ago)$/.test(lower)) return "08";
    if (/^(9|09|septiembre|setiembre|sep|set)$/.test(lower)) return "09";
    if (/^(10|octubre|oct)$/.test(lower)) return "10";
    if (/^(11|noviembre|nov)$/.test(lower)) return "11";
    if (/^(12|diciembre|dic)$/.test(lower)) return "12";
    return lower;
  };

  const parseDayMonth = (str: string): { dia: string; mes: string } | null => {
    const clean = str.trim().replace(/[/._]/g, "-");
    const parts = clean.split("-");
    if (parts.length < 2) return null;
    const dia = String(parseInt(parts[0], 10) || "").padStart(2, "0");
    const mes = normalizeMonth(parts[1]);
    return { dia, mes };
  };

  if (juegoName === "Fechas" || j.includes("-") || g.includes("-")) {
    const parsedJ = parseDayMonth(j);
    const parsedG = parseDayMonth(g);
    if (parsedJ && parsedG) {
      return parsedJ.dia === parsedG.dia && parsedJ.mes === parsedG.mes;
    }
  }

  return false;
}

/**
 * Busca de forma universal e infalible el objeto resultado oficial para un ticket en la lista config.resultados.
 */
export function findResultadoForTicket(
  ticket: {
    id_sorteo?: string;
    juego_sorteo?: string;
    juego?: string;
    sorteo?: string;
    fecha_venta?: string;
    timestamp_servidor?: string;
    fecha_emision_date?: any;
    [key: string]: unknown;
  },
  config: {
    sorteos?: { id: string; nombre: string; juego: string }[];
    resultados?: { id_sorteo: string; sorteo?: string; fecha: string; numero_ganador: string }[];
  }
): { id_sorteo: string; fecha: string; numero_ganador: string } | null {
  if (!config || !config.resultados || config.resultados.length === 0) return null;

  const { game, draw } = parseGameDraw(ticket);
  const sorteoObj = config.sorteos?.find(
    (s) =>
      (ticket.id_sorteo && s.id === ticket.id_sorteo) ||
      (s.nombre === draw && s.juego === game) ||
      s.nombre === ticket.sorteo
  );

  const ticketDateStr = (ticket.fecha_venta || getTicketDate(ticket as any) || "").trim();
  const ticketLocalStr = toLocalDateStr(
    ticket.fecha_emision_date || ticket.timestamp_servidor || ticket.fecha_venta
  );

  return (
    config.resultados.find((r: any) => {
      const sorteoMatches =
        (sorteoObj && r.id_sorteo === sorteoObj.id) ||
        (ticket.id_sorteo && r.id_sorteo === ticket.id_sorteo) ||
        r.id_sorteo === draw ||
        r.id_sorteo === ticket.sorteo ||
        (r.sorteo && ticket.sorteo && r.sorteo.trim().toLowerCase() === ticket.sorteo.trim().toLowerCase());

      if (!sorteoMatches) return false;

      const dateMatches =
        r.fecha === ticketDateStr ||
        r.fecha === ticketLocalStr ||
        (ticketDateStr && r.fecha && r.fecha.slice(0, 10) === ticketDateStr.slice(0, 10)) ||
        (ticketLocalStr && r.fecha && r.fecha.slice(0, 10) === ticketLocalStr.slice(0, 10));

      return dateMatches;
    }) || null
  );
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
  if (!game && !ticket.juego) return 0;

  const rObj = findResultadoForTicket(ticket, config);
  if (!rObj) return 0;

  const winnerNum = rObj.numero_ganador;
  const gameName = (ticket.juego as string) || game;
  const drawName = (ticket.sorteo as string) || draw;
  const multiplier = calculatePrizeMultiplier(gameName, drawName);
  let prize = 0;

  if (ticket.jugadas && ticket.jugadas.length > 0) {
    for (const j of ticket.jugadas) {
      if (isMatchingWinner(j.numero, winnerNum, gameName)) {
        let p = j.monto * multiplier;
        if (ticket.moneda === "USD") p *= config.tasa_cambio || 36.5;
        prize += p;
      }
    }
  } else if (ticket.numero_jugado) {
    if (isMatchingWinner(ticket.numero_jugado, winnerNum, gameName)) {
      let p = (ticket.monto_pago || 0) * multiplier;
      if (ticket.moneda === "USD") p *= config.tasa_cambio || 36.5;
      prize += p;
    }
  }

  return prize;
}
