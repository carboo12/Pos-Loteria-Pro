import { useMemo } from "react";
import type { Venta, Configuracion, CobroVendedor } from "../types";
import { getTicketDate, getTicketAmount } from "../lib/date-utils";
import { getTicketTheoreticalPrize } from "../lib/prize-utils";

export interface VendedorFacturacionData {
  id: string;
  nombre: string;
  vendido: number;
  pagado: number;
  ingresos: number;
  aPagar: number;
  cobrado: number;
  ganancia: number;
  total: number;
  totalPremios: number;
}

export function useFacturacion(
  vendedores: { id: string; nombre: string }[],
  fechaInicio: string,
  fechaFin: string,
  tickets: Venta[],
  config: Configuracion,
  cobros: CobroVendedor[]
): VendedorFacturacionData[] {
  return useMemo(() => {
    if (!config || !tickets) return [];

    return vendedores.map(v => {
      const sellerTickets = tickets.filter(s => {
        const ticketDateStr = getTicketDate(s);
        const dateMatch = ticketDateStr >= fechaInicio && ticketDateStr <= fechaFin;
        const activeMatch = !s.anulado;
        const sellerMatch = s.id_vendedor === v.id;
        return dateMatch && activeMatch && sellerMatch;
      });

      const vendido = sellerTickets.reduce((sum, s) => sum + getTicketAmount(s), 0);

      let aPagar = 0;
      let totalPremios = 0;
      sellerTickets.forEach(s => {
        const theoreticalPrize = getTicketTheoreticalPrize(s, config);
        if (theoreticalPrize > 0) {
          aPagar += theoreticalPrize;
        }
        if (typeof s.monto_premio === "number" && s.monto_premio > 0) {
          totalPremios += s.monto_premio;
        }
      });

      const pagado = sellerTickets
        .filter(s => s.estado === "pagado" || s.estado === "cobrado")
        .reduce((sum, s) => sum + ((typeof s.monto_premio === "number" && s.monto_premio > 0) ? s.monto_premio : getTicketTheoreticalPrize(s, config)), 0);

      const sellerIngresos = ((config as any).ingresos || []).filter((i: any) => {
        const isSeller = i.id_vendedor === v.id;
        const inRange = i.fecha >= fechaInicio && i.fecha <= fechaFin;
        return isSeller && inRange;
      });
      const ingresos = sellerIngresos.reduce((sum: number, i: any) => sum + i.monto_cs + (i.monto_usd * (config.tasa_cambio || 36.5)), 0);

      const sellerCobros = (cobros || []).filter((c: any) => {
        const isSeller = c.id_vendedor === v.id;
        const inRange = c.fecha >= fechaInicio && c.fecha <= fechaFin;
        return isSeller && inRange;
      });
      const cobrado = sellerCobros.reduce((sum: number, c: any) => sum + c.monto_cs + (c.monto_usd * (config.tasa_cambio || 36.5)), 0);

      const ganancia = (vendido - aPagar) + ingresos;
      const total = (vendido - pagado) + ingresos - cobrado;

      return {
        id: v.id,
        nombre: v.nombre,
        vendido,
        pagado,
        ingresos,
        aPagar,
        cobrado,
        ganancia,
        total,
        totalPremios,
      };
    });
  }, [vendedores, fechaInicio, fechaFin, tickets, config, cobros]);
}
