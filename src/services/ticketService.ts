import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, updateDoc, where,
  type DocumentData, type Unsubscribe,
} from "firebase/firestore";
import { firestore } from "../lib/firebase";
import { isSupabaseEnabled } from "../lib/dataBackend";
import { restoreSupabaseSession, supabase } from "../lib/supabaseClient";
import type { Venta } from "../types";

export interface TicketRecord { id: string; data: Venta }
export type TicketPatch = Partial<Venta> & Record<string, unknown>;
type TicketListenerFilter = { sellerIds?: string[]; sellerId?: string; fechaInicio?: string; fechaFin?: string; limit?: number };

export async function listRecentTickets(maxRows = 500): Promise<TicketRecord[]> {
  if (isSupabaseEnabled) {
    await restoreSupabaseSession();
    const { data, error } = await supabase.from("tickets").select("*, ticket_plays(*)").order("timestamp_servidor", { ascending: false }).limit(maxRows);
    if (error) throw error;
    return (data || []).map(fromSupabaseTicket);
  }
  const snapshot = await getDocs(query(collection(firestore, "tickets"), orderBy("timestamp_servidor", "desc"), limit(maxRows)));
  return snapshot.docs.map((item) => ({ id: item.id, data: { ...item.data(), id: item.id } as Venta }));
}

function fromSupabaseTicket(row: Record<string, any>): TicketRecord {
  const data = { ...row, id: String(row.id_ticket || row.numero_ticket || row.id) } as Venta;
  data.monto_pago = Number(row.monto_pago ?? row.total_apostado ?? 0);
  data.jugadas = Array.isArray(row.ticket_plays) ? row.ticket_plays.map((play: any) => ({
    numero: play.numero, monto: Number(play.monto), premio_posible: Number(play.premio_posible || 0), dia_juego: play.dia_juego || undefined,
  })) : [];
  return { id: String(row.id), data };
}

export async function findTicketByPublicId(publicId: string): Promise<TicketRecord | null> {
  const key = publicId.trim();
  if (!key) return null;
  if (isSupabaseEnabled) {
    await restoreSupabaseSession();
    const { data, error } = await supabase.from("tickets").select("*, ticket_plays(*)")
      .or(`id_ticket.eq.${key},numero_ticket.eq.${key}`).limit(1).maybeSingle();
    if (error) throw error;
    return data ? fromSupabaseTicket(data) : null;
  }

  const direct = await getDoc(doc(firestore, "tickets", key));
  if (direct.exists()) return { id: direct.id, data: { ...direct.data(), id: direct.id } as Venta };
  for (const field of ["id_ticket", "numero_ticket"] as const) {
    const matches = await getDocs(query(collection(firestore, "tickets"), where(field, "==", key), limit(1)));
    const match = matches.docs[0];
    if (match) return { id: match.id, data: { ...match.data(), id: match.id } as Venta };
  }
  return null;
}

export async function updateTicketByDocumentId(documentId: string, patch: TicketPatch): Promise<void> {
  if (isSupabaseEnabled) {
    await restoreSupabaseSession();
    const allowedColumns = new Set(["id_ticket", "numero_ticket", "timestamp_servidor", "fecha_venta", "juego", "sorteo", "numero_jugado", "monto_pago", "moneda", "nombre_cliente", "premio_posible_cs", "firma_digital", "anulado", "estado", "es_premiado", "monto_premio", "fecha_pago", "created_at"]);
    const safePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowedColumns.has(key)));
    const { error } = await supabase.from("tickets").update(safePatch).eq("id", documentId);
    if (error) throw error;
    return;
  }
  await updateDoc(doc(firestore, "tickets", documentId), patch as DocumentData);
}

export function subscribeToTickets(
  filter: TicketListenerFilter,
  onRecords: (records: TicketRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (isSupabaseEnabled) {
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      try { await restoreSupabaseSession(); } catch (error) { onError?.(error as Error); return; }
      let request = supabase.from("tickets").select("*, ticket_plays(*)").order("timestamp_servidor", { ascending: false });
      if (filter.sellerId) request = request.eq("id_vendedor", filter.sellerId);
      if (filter.sellerIds?.length) request = request.in("id_vendedor", filter.sellerIds);
      if (filter.fechaInicio) request = request.gte("fecha_venta", filter.fechaInicio);
      if (filter.fechaFin) request = request.lte("fecha_venta", filter.fechaFin);
      if (filter.limit) request = request.limit(filter.limit);
      const { data, error } = await request;
      if (error) { onError?.(error); return; }
      if (!disposed) onRecords((data || []).map(fromSupabaseTicket));
    };
    void restoreSupabaseSession().then(() => {
      if (disposed) return;
      void load();
      channel = supabase.channel(`tickets-live-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => { void load(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "ticket_plays" }, () => { void load(); })
        .subscribe((status, err) => { if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(err || new Error(`Supabase Realtime: ${status}`)); });
    }).catch((error) => onError?.(error as Error));
    return () => { disposed = true; if (channel) void supabase.removeChannel(channel); };
  }

  const constraints = [];
  if (filter.sellerId) constraints.push(where("id_vendedor", "==", filter.sellerId));
  if (filter.sellerIds?.length) constraints.push(where("id_vendedor", "in", filter.sellerIds.slice(0, 30)));
  if (filter.fechaInicio) constraints.push(where("fecha_venta", ">=", filter.fechaInicio));
  if (filter.fechaFin) constraints.push(where("fecha_venta", "<=", filter.fechaFin));
  let q = query(collection(firestore, "tickets"), ...constraints);
  if (!filter.sellerId && !filter.sellerIds?.length) q = query(q, orderBy("timestamp_servidor", "desc"), limit(filter.limit || 500));
  return onSnapshot(q, (snapshot) => onRecords(snapshot.docs.map((item) => ({ id: item.id, data: { ...item.data(), id: item.id } as Venta }))), onError);
}
