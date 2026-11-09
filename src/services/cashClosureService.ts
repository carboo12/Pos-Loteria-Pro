import { collection, getDocs, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { firestore } from "../lib/firebase";
import { isSupabaseEnabled } from "../lib/dataBackend";
import { restoreSupabaseSession, supabase } from "../lib/supabaseClient";
import type { CierreCaja } from "../types";

function mapClosure(row: any): CierreCaja {
  return {
    ...row,
    id: String(row.legacy_id || row.id),
    id_vendedor: String(row.seller_id || row.id_vendedor),
    monto_entregado_cs: Number(row.monto_entregado_cs || 0),
    monto_entregado_usd: Number(row.monto_entregado_usd || 0),
    monto_sistema_cs: Number(row.monto_sistema_cs || 0),
    monto_sistema_usd: Number(row.monto_sistema_usd || 0),
    descuadre_cs: Number(row.descuadre_cs || 0),
    descuadre_usd: Number(row.descuadre_usd || 0),
  } as CierreCaja;
}

export async function listCashClosures(): Promise<CierreCaja[]> {
  if (isSupabaseEnabled) {
    await restoreSupabaseSession();
    const { data, error } = await supabase.from("cash_closures").select("*").order("fecha", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapClosure);
  }
  const snapshot = await getDocs(collection(firestore, "cierres_caja"));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CierreCaja));
}

export function subscribeToCashClosures(onRecords: (closures: CierreCaja[]) => void, onError?: (error: Error) => void): Unsubscribe {
  if (isSupabaseEnabled) {
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      try { await restoreSupabaseSession(); } catch (error) { onError?.(error as Error); return; }
      const { data, error } = await supabase.from("cash_closures").select("*").order("fecha", { ascending: false });
      if (error) { onError?.(error); return; }
      if (!disposed) onRecords((data || []).map(mapClosure));
    };
    void restoreSupabaseSession().then(() => {
      if (disposed) return;
      void load();
      channel = supabase.channel("cash-closures-live").on("postgres_changes", { event: "*", schema: "public", table: "cash_closures" }, () => { void load(); })
        .subscribe((status, err) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(err || new Error(`Supabase Realtime: ${status}`)); });
    }).catch((error) => onError?.(error as Error));
    return () => { disposed = true; if (channel) void supabase.removeChannel(channel); };
  }
  return onSnapshot(collection(firestore, "cierres_caja"), (snapshot) => {
    onRecords(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CierreCaja)));
  }, onError);
}
