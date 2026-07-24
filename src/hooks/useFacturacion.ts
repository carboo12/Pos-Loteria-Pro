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

        let q;
        if (sellerIds.length === 1) {
          // Single seller (Vendedor interface or Admin filtered by 1 seller):
          // Scope query directly to this seller ID for 100% security, isolation & performance
          q = query(ticketsRef, where("id_vendedor", "==", sellerIds[0]));
        } else if (sellerIds.length > 1 && sellerIds.length <= 30) {
          // Supervisor or multi-seller filter (<= 30 sellers):
          // Scope query strictly to the list of assigned/linked seller IDs
          q = query(ticketsRef, where("id_vendedor", "in", sellerIds));
        } else {
          // All sellers (Admin global view with >30 sellers):
          // Query by date range
          q = query(
            ticketsRef,
            where("fecha_venta", ">=", fechaInicio),
            where("fecha_venta", "<=", fechaFin)
          );
        }

        const snapshot = await getDocs(q);
        if (!isMounted) return;

        const docs: Venta[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        } as Venta));

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
