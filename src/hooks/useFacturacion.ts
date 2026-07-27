import { useState, useEffect, useMemo } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { firestore } from "../lib/firebase";
import type { Venta, Configuracion, CobroVendedor } from "../types";
import { calculateAllSellerSummaries } from "../lib/finance-engine";
import type { SellerSummary } from "../lib/finance-engine";

export type VendedorFacturacionData = SellerSummary;

/**
 * Custom hook to calculate seller billing summaries for a date range.
 * Dynamically queries Firestore for tickets scoped by seller ID(s) or date range,
 * merging with real-time client tickets (`tickets`), guaranteeing full historical
 * coverage for Admin, Supervisor, and Vendedor interfaces without scope leakage.
 */
export function useFacturacion(
  vendedores: { id: string; nombre: string }[],
  fechaInicio: string,
  fechaFin: string,
  tickets: Venta[],
  config: Configuracion,
  cobros: CobroVendedor[],
): SellerSummary[] {
  const [rangeTickets, setRangeTickets] = useState<Venta[]>([]);

  const sellerIdsKey = useMemo(() => {
    return (vendedores || []).map((v) => v.id).sort().join(",");
  }, [vendedores]);

  useEffect(() => {
    if (!fechaInicio || !fechaFin || !vendedores || vendedores.length === 0) {
      setRangeTickets([]);
      return;
    }

    let isMounted = true;
    const fetchRangeTickets = async () => {
      try {
        const ticketsRef = collection(firestore, "tickets");
        const sellerIds = vendedores.map((v) => v.id).filter(Boolean);

        // ── Query 1: Tickets EMITIDOS en el rango (fecha_venta) ──────────────
        // Necesarios para calcular: vendido, premios (A Pagar)
        let qEmitidos;
        if (sellerIds.length === 1) {
          qEmitidos = query(
            ticketsRef,
            where("id_vendedor", "==", sellerIds[0]),
            where("fecha_venta", ">=", fechaInicio),
            where("fecha_venta", "<=", fechaFin)
          );
        } else {
          qEmitidos = query(
            ticketsRef,
            where("fecha_venta", ">=", fechaInicio),
            where("fecha_venta", "<=", fechaFin)
          );
        }

        // ── Query 2: Tickets PAGADOS en el rango (fecha_pago) ─────────────────
        // Necesarios para calcular: pagado (el día real del desembolso del premio)
        // Esto captura tickets emitidos en otros días pero pagados dentro del rango.
        let qPagados;
        if (sellerIds.length === 1) {
          qPagados = query(
            ticketsRef,
            where("id_vendedor", "==", sellerIds[0]),
            where("fecha_pago", ">=", fechaInicio),
            where("fecha_pago", "<=", fechaFin)
          );
        } else {
          qPagados = query(
            ticketsRef,
            where("fecha_pago", ">=", fechaInicio),
            where("fecha_pago", "<=", fechaFin)
          );
        }

        const [snapEmitidos, snapPagados] = await Promise.all([
          getDocs(qEmitidos),
          getDocs(qPagados),
        ]);

        if (!isMounted) return;

        // Merge y deduplicar por ID (los tickets live de props tienen prioridad)
        const map = new Map<string, Venta>();

        const toVenta = (docSnap: any): Venta => ({
          id: docSnap.id,
          ...docSnap.data(),
        } as Venta);

        snapEmitidos.docs.forEach((d) => map.set(d.id, toVenta(d)));
        snapPagados.docs.forEach((d) => {
          if (!map.has(d.id)) map.set(d.id, toVenta(d));
        });

        let docs = Array.from(map.values());

        // Filtrar por vendedores en modo multi-seller
        if (sellerIds.length > 1) {
          const sellerSet = new Set(sellerIds);
          docs = docs.filter((d) => d.id_vendedor && sellerSet.has(d.id_vendedor));
        }

        setRangeTickets(docs);
      } catch (err) {
        console.warn("[useFacturacion] Consulta Firestore advertencia, usando tickets locales:", err);
      }
    };

    fetchRangeTickets();

    return () => {
      isMounted = false;
    };
  }, [fechaInicio, fechaFin, sellerIdsKey]);

  // Combine fetched range tickets with live tickets from props, deduplicating by ID
  const combinedTickets = useMemo(() => {
    const map = new Map<string, Venta>();

    // 1. Add range tickets fetched directly from Firestore
    rangeTickets.forEach((t) => {
      if (t.id) map.set(t.id, t);
    });

    // 2. Add/override with live tickets from real-time state
    (tickets || []).forEach((t) => {
      if (t.id) map.set(t.id, t);
    });

    return Array.from(map.values());
  }, [tickets, rangeTickets]);

  return useMemo(() => {
    if (!config) return [];
    return calculateAllSellerSummaries(vendedores, fechaInicio, fechaFin, combinedTickets, config, cobros);
  }, [vendedores, fechaInicio, fechaFin, combinedTickets, config, cobros]);
}
