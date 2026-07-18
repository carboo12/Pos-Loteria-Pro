import { useMemo } from "react";
import type { Venta, Configuracion, CobroVendedor } from "../types";
import { calculateAllSellerSummaries } from "../lib/finance-engine";
import type { SellerSummary } from "../lib/finance-engine";

/**
 * @deprecated Use SellerSummary from finance-engine.ts directly.
 * This interface is kept for backward compatibility during migration.
 */
export type VendedorFacturacionData = SellerSummary;

export function useFacturacion(
  vendedores: { id: string; nombre: string }[],
  fechaInicio: string,
  fechaFin: string,
  tickets: Venta[],
  config: Configuracion,
  cobros: CobroVendedor[],
): SellerSummary[] {
  return useMemo(() => {
    if (!config || !tickets) return [];
    return calculateAllSellerSummaries(vendedores, fechaInicio, fechaFin, tickets, config, cobros);
  }, [vendedores, fechaInicio, fechaFin, tickets, config, cobros]);
}
