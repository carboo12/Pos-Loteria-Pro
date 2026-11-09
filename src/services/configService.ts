import { collection, doc, getDoc, onSnapshot, orderBy, query, type Unsubscribe } from "firebase/firestore";
import { firestore } from "../lib/firebase";
import { isSupabaseEnabled } from "../lib/dataBackend";
import { restoreSupabaseSession, supabase } from "../lib/supabaseClient";
import type { Configuracion, SorteoResultado } from "../types";

export async function getGeneralConfig(): Promise<Partial<Configuracion>> {
  if (!isSupabaseEnabled) {
    const snapshot = await getDoc(doc(firestore, "configuracion", "general"));
    return snapshot.exists() ? snapshot.data() as Partial<Configuracion> : {};
  }
  await restoreSupabaseSession();
  const [{ data: settings, error: settingsError }, { data: draws, error: drawsError }, { data: limits, error: limitsError }] = await Promise.all([
    supabase.from("app_settings").select("*").eq("id", "general").maybeSingle(),
    supabase.from("draws").select("*").eq("activo", true),
    supabase.from("number_limits").select("*"),
  ]);
  const error = settingsError || drawsError || limitsError;
  if (error) throw error;
  return {
    tasa_cambio: Number(settings?.tasa_cambio || 36.5),
    contador_global_tickets: Number(settings?.contador_global_tickets || 0),
    formato_ticket: settings?.formato_ticket || {},
    sorteos: (draws || []).map((d: any) => ({ id: d.legacy_id || d.id, juego: d.juego, hora_sorteo: d.hora_sorteo, hora_cierre: d.hora_cierre, nombre: d.nombre, dias_habilitados: d.dias_habilitados })),
    limites_numeros: (limits || []).map((l: any) => ({ ...l, id: l.legacy_id || l.id, id_vendedor: l.seller_id, max_monto: Number(l.max_monto) })),
  };
}

export function subscribeToGeneralConfig(callback: (config: Partial<Configuracion>) => void, onError?: (error: Error) => void): Unsubscribe {
  if (isSupabaseEnabled) {
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      try { await restoreSupabaseSession(); } catch (error) { onError?.(error as Error); return; }
      try {
        const config = await getGeneralConfig();
        if (!disposed) callback(config);
      } catch (error) { onError?.(error as Error); }
    };
    void restoreSupabaseSession().then(() => {
      if (disposed) return;
      void load();
      channel = supabase.channel("app-config-live")
        .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => { void load(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "draws" }, () => { void load(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "number_limits" }, () => { void load(); })
        .subscribe((status, err) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(err || new Error(`Supabase Realtime: ${status}`)); });
    }).catch((error) => onError?.(error as Error));
    return () => { disposed = true; if (channel) void supabase.removeChannel(channel); };
  }
  return onSnapshot(doc(firestore, "configuracion", "general"), (snapshot) => {
    if (snapshot.exists()) callback(snapshot.data() as Partial<Configuracion>);
  }, onError);
}

export function subscribeToResults(callback: (results: SorteoResultado[]) => void, onError?: (error: Error) => void): Unsubscribe {
  if (isSupabaseEnabled) {
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      try { await restoreSupabaseSession(); } catch (error) { onError?.(error as Error); return; }
      const { data, error } = await supabase.from("draw_results").select("*, draws(*)").order("timestamp", { ascending: false });
      if (error) { onError?.(error); return; }
      if (!disposed) callback((data || []).map((r: any) => ({ id: r.legacy_id || r.id, id_sorteo: r.draws?.legacy_id || r.draw_id, sorteo: r.draws?.nombre || "", pais: r.draws?.pais || "", fecha: r.fecha, numero_ganador: r.numero_ganador, timestamp: r.timestamp })));
    };
    void restoreSupabaseSession().then(() => {
      if (disposed) return;
      void load();
      channel = supabase.channel("draw-results-live").on("postgres_changes", { event: "*", schema: "public", table: "draw_results" }, () => { void load(); })
        .subscribe((status, err) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(err || new Error(`Supabase Realtime: ${status}`)); });
    }).catch((error) => onError?.(error as Error));
    return () => { disposed = true; if (channel) void supabase.removeChannel(channel); };
  }
  return onSnapshot(query(collection(firestore, "resultados"), orderBy("timestamp", "desc")), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SorteoResultado));
  }, onError);
}
