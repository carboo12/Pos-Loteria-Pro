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
          // Scope query directly to this seller ID and date range for 100% accuracy & performance
          q = query(
            ticketsRef,
            where("id_vendedor", "==", sellerIds[0]),
            where("fecha_venta", ">=", fechaInicio),
            where("fecha_venta", "<=", fechaFin)
          );
        } else {
          // Multi-seller or All sellers:
          // Query by date range for complete coverage
          q = query(
            ticketsRef,
            where("fecha_venta", ">=", fechaInicio),
            where("fecha_venta", "<=", fechaFin)
          );
        }

        const snapshot = await getDocs(q);
        if (!isMounted) return;

        let docs: Venta[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Record<string, any>;
          return {
            id: docSnap.id,
            ...data,
          } as Venta;
        });

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
