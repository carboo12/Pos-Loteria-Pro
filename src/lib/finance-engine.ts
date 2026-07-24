/**
 * Finance Engine — Single source of truth for all financial calculations.
 *
 * Used by AdminInterface, SupervisorInterface, and VendedorInterface.
 * Every view MUST import calculateSellerSummary from here to guarantee parity.
 *
 * Formulas (standardized):
 *   Ganancia = Vendido - Premios
 *   Balance  = Ganancia + Ingresos - Cobros
 */

import type { Venta, Configuracion, CobroVendedor } from "../types";
import { getTicketDate, getTicketAmount } from "./date-utils";
import { getTicketTheoreticalPrize } from "./prize-utils";

export interface SellerSummary {
  id: string;
  nombre: string;
  vendido: number;
  pagado: number;
  ingresos: number;
  premios: number;
  cobrado: number;
  ganancia: number;
  balance: number;
  totalPremios: number;
}

/**
 * Calculate the financial summary for a single seller within a date range.
 *
 * @param seller      - The seller { id, nombre }
 * @param fechaInicio - Start date YYYY-MM-DD (inclusive)
 * @param fechaFin    - End date YYYY-MM-DD (inclusive)
 * @param tickets     - All tickets (filtered by caller for date range)
 * @param config      - Global configuration (sorteos, resultados, ingresos, tasa_cambio)
 * @param cobros      - All cobros (filtered by caller for date range)
 */
export function calculateSellerSummary(
  seller: { id: string; nombre: string },
  fechaInicio: string,
  fechaFin: string,
  tickets: Venta[],
  config: Configuracion,
  cobros: CobroVendedor[],
): SellerSummary {
  const vNameNorm = (seller.nombre || "").toUpperCase().trim();

  const sellerTickets = tickets.filter((s) => {
    const ticketDateStr = getTicketDate(s);
    const dateMatch = ticketDateStr >= fechaInicio && ticketDateStr <= fechaFin;
    const activeMatch = !s.anulado;
    const idMatch = s.id_vendedor && s.id_vendedor.toLowerCase() === (seller.id || "").toLowerCase();
    const nameMatch = s.nombre_vendedor && s.nombre_vendedor.toUpperCase().trim() === vNameNorm;
    const sellerMatch = idMatch || nameMatch;
    return dateMatch && activeMatch && sellerMatch;
  });

  const vendido = sellerTickets.reduce((sum, s) => sum + getTicketAmount(s), 0);

  let premios = 0;
  let totalPremios = 0;
  sellerTickets.forEach((s) => {
    const prize =
      typeof s.monto_premio === "number" && s.monto_premio > 0
        ? s.monto_premio
        : getTicketTheoreticalPrize(s, config);
    if (prize > 0) {
      premios += prize;
    }
    if (typeof s.monto_premio === "number" && s.monto_premio > 0) {
      totalPremios += s.monto_premio;
    }
  });

  const pagado = sellerTickets
    .filter((s) => s.estado === "pagado" || s.estado === "cobrado")
    .reduce(
      (sum, s) =>
        sum +
        (typeof s.monto_premio === "number" && s.monto_premio > 0
          ? s.monto_premio
          : getTicketTheoreticalPrize(s, config)),
      0,
    );

  const sellerIngresos = ((config as any).ingresos || []).filter((i: any) => {
    const isSeller = i.id_vendedor === seller.id;
    const inRange = i.fecha >= fechaInicio && i.fecha <= fechaFin;
    return isSeller && inRange;
  });
  const ingresos = sellerIngresos.reduce(
    (sum: number, i: any) => sum + i.monto_cs + i.monto_usd * (config.tasa_cambio || 36.5),
    0,
  );

  const sellerCobros = (cobros || []).filter((c: any) => {
    const isSeller = c.id_vendedor === seller.id;
    const inRange = c.fecha >= fechaInicio && c.fecha <= fechaFin;
    return isSeller && inRange;
  });
  const cobrado = sellerCobros.reduce(
    (sum: number, c: any) => sum + c.monto_cs + c.monto_usd * (config.tasa_cambio || 36.5),
    0,
  );

  // Standardized formulas: aqui se aplica las formulas
  const ganancia = (vendido + ingresos) - (premios + cobrado);
  const balance = (vendido + ingresos) - (pagado + cobrado);
  //no tocar esta parte del codigo, alteraria las formulas y los pagos
  return {
    id: seller.id,
    nombre: seller.nombre,
    vendido,
    pagado,
    ingresos,
    premios,
    cobrado,
    ganancia,
    balance,
    totalPremios,
  };
}

/**
 * Calculate summaries for multiple sellers. Returns an array of SellerSummary
 * in the same order as the input sellers array.
 */
export function calculateAllSellerSummaries(
  sellers: { id: string; nombre: string }[],
  fechaInicio: string,
  fechaFin: string,
  tickets: Venta[],
  config: Configuracion,
  cobros: CobroVendedor[],
): SellerSummary[] {
  return sellers.map((s) =>
    calculateSellerSummary(s, fechaInicio, fechaFin, tickets, config, cobros),
  );
}

/**
 * Get the accumulated sales grouped by played number, game, and draw for a specific seller on a selected date.
 * Returns an array of { numero: string, juego: string, sorteo: string, total: number } sorted by total descending.
 */
export function getVendedorReporteAcumulado(
  vendedorId: string,
  fecha: string, // YYYY-MM-DD
  tickets: Venta[]
): { numero: string; juego: string; sorteo: string; total: number }[] {
  const sellerTickets = tickets.filter((t) => {
    if (t.anulado) return false;
    const ticketDateStr = getTicketDate(t);
    const dateMatch = ticketDateStr === fecha;
    const sellerMatch = !vendedorId || (t.id_vendedor && t.id_vendedor.toLowerCase() === vendedorId.toLowerCase());
    return dateMatch && sellerMatch;
  });

  const totalsByKey: Record<string, { numero: string; juego: string; sorteo: string; total: number }> = {};

  sellerTickets.forEach((t) => {
    const juego = t.juego || "";
    const sorteo = t.sorteo || "";
    if (t.jugadas && t.jugadas.length > 0) {
      t.jugadas.forEach((j) => {
        const num = String(j.numero).padStart(2, "0");
        const amount = Number(j.monto) || 0;
        const key = `${num}-${juego}-${sorteo}`;
        if (!totalsByKey[key]) {
          totalsByKey[key] = { numero: num, juego, sorteo, total: 0 };
        }
        totalsByKey[key].total += amount;
      });
    } else if (t.numero_jugado) {
      // Fallback for legacy single-play tickets without jugadas[]
      const num = String(t.numero_jugado).padStart(2, "0");
      const amount = Number(t.total_apostado ?? t.monto_pago ?? 0);
      const key = `${num}-${juego}-${sorteo}`;
      if (!totalsByKey[key]) {
        totalsByKey[key] = { numero: num, juego, sorteo, total: 0 };
      }
      totalsByKey[key].total += amount;
    }
  });

  return Object.values(totalsByKey).sort((a, b) => {
    const comp = a.sorteo.localeCompare(b.sorteo);
    if (comp !== 0) return comp;
    return a.numero.localeCompare(b.numero);
  });
}
