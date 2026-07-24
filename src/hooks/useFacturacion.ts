import { useState, useEffect, useMemo } from "react";
import { collection, query, where, getDocs } from "firebase/firestore";
import { firestore } from "../lib/firebase";
import type { Venta, Configuracion, CobroVendedor } from "../types";
import { calculateAllSellerSummaries } from "../lib/finance-engine";
import type { SellerSummary } from "../lib/finance-engine";

export type VendedorFacturacionData = SellerSummary;

/**
 * Custom hook to calculate seller billing summaries for a date range.
 * Dynamically queries Firestore for tickets within [fechaInicio, fechaFin]
 * and merges them with live tickets from client state (`tickets`),
 * ensuring full historical data is included even if total tickets exceed the 500 in-memory limit.
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

  useEffect(() => {
    if (!fechaInicio || !fechaFin) return;

    let isMounted = true;
    const fetchRangeTickets = async () => {
      try {
        const ticketsRef = collection(firestore, "tickets");
        const q = query(
          ticketsRef,
          where("fecha_venta", ">=", fechaInicio),
          where("fecha_venta", "<=", fechaFin)
        );
        const snapshot = await getDocs(q);
        if (!isMounted) return;

        const docs: Venta[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        } as Venta));

        setRangeTickets(docs);
      } catch (err) {
        console.error("[useFacturacion] Error al consultar tickets de Firestore:", err);
      }
    };

    fetchRangeTickets();

    return () => {
      isMounted = false;
    };
  }, [fechaInicio, fechaFin]);

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
