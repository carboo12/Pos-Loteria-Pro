import { useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { firestore } from "../lib/firebase";
import { getTicketDate, toDateSafe } from "../lib/date-utils";
import { AlertCircle, CalendarClock, CheckCircle, Edit2, Hash, Loader2, Save, Search } from "lucide-react";
import toast from "react-hot-toast";

interface FoundTicket {
  id: string;
  data: any;
  matchedBy: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

function toDateTimeLocal(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
    }
  }
  const date = toDateSafe(value, new Date(0));
  if (isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateLocal(value: unknown): string {
  if (!value) return "";
  const ticketDate = getTicketDate({ fecha_venta: value as string });
  return /^\d{4}-\d{2}-\d{2}$/.test(ticketDate) ? ticketDate : "";
}

function buildEmisionISO(value: string): string {
  if (!value) return "";
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return `${withSeconds}.000-06:00`;
}

export default function TicketEditSection() {
  const [ticketNumber, setTicketNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [foundTicket, setFoundTicket] = useState<FoundTicket | null>(null);
  const [fechaEmision, setFechaEmision] = useState("");
  const [fechaVenta, setFechaVenta] = useState("");
  const [originalFechaEmision, setOriginalFechaEmision] = useState("");
  const [originalFechaVenta, setOriginalFechaVenta] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resetResult = () => {
    setFoundTicket(null);
    setFechaEmision("");
    setFechaVenta("");
    setOriginalFechaEmision("");
    setOriginalFechaVenta("");
    setError(null);
    setSuccess(null);
  };

  const handleSearch = async () => {
    const cleanNum = ticketNumber.trim().replace(/^#/, "");
    if (!cleanNum) {
      setError("Ingrese el número de ticket a consultar.");
      return;
    }

    setLoading(true);
    resetResult();

    try {
      let snap: any = null;
      let matchedBy = "";

      const directSnap = await getDoc(doc(firestore, "tickets", cleanNum));
      if (directSnap.exists()) {
        snap = directSnap;
        matchedBy = "ID de documento";
      }

      if (!snap) {
        const byIdTicket = await getDocs(
          query(collection(firestore, "tickets"), where("id_ticket", "==", cleanNum), limit(1))
        );
        if (!byIdTicket.empty) {
          snap = byIdTicket.docs[0];
          matchedBy = "campo id_ticket";
        }
      }

      if (!snap) {
        const byNumeroTicket = await getDocs(
          query(collection(firestore, "tickets"), where("numero_ticket", "==", cleanNum), limit(1))
        );
        if (!byNumeroTicket.empty) {
          snap = byNumeroTicket.docs[0];
          matchedBy = "campo numero_ticket";
        }
      }

      if (!snap) {
        setError(`No se encontró ningún ticket con número "${cleanNum}".`);
        return;
      }

      const data = snap.data() as any;
      setFoundTicket({ id: snap.id, data, matchedBy });
      const emisionValue = toDateTimeLocal(data.fecha_emision || data.timestamp_servidor || data.timestamp);
      const ventaValue = toDateLocal(data.fecha_venta);
      setFechaEmision(emisionValue);
      setFechaVenta(ventaValue);
      setOriginalFechaEmision(emisionValue);
      setOriginalFechaVenta(ventaValue);
    } catch (err: any) {
      console.error("[TicketEditSection] Error buscando ticket:", err);
      setError(err?.message || "Error al consultar el ticket en Firestore.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!foundTicket) return;

    const emissionChanged = !!fechaEmision && fechaEmision !== originalFechaEmision;
    const saleDateChanged = !!fechaVenta && fechaVenta !== originalFechaVenta;
    if (!emissionChanged && !saleDateChanged) {
      setError("Modifique al menos una de las fechas antes de guardar.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const updates: Record<string, string> = {};

      if (fechaEmision) {
        const emissionISO = buildEmisionISO(fechaEmision);
        updates.fecha_emision = emissionISO;
        updates.timestamp_servidor = emissionISO;
        updates.timestamp = emissionISO;
        updates.created_at = emissionISO;
      }

      if (saleDateChanged) {
        updates.fecha_venta = fechaVenta;
      } else if (emissionChanged) {
        updates.fecha_venta = fechaEmision.substring(0, 10);
      }

      await updateDoc(doc(firestore, "tickets", foundTicket.id), updates);

      setFoundTicket({
        ...foundTicket,
        data: { ...foundTicket.data, ...updates },
      });
      setOriginalFechaEmision(fechaEmision);
      setOriginalFechaVenta(updates.fecha_venta || fechaVenta);

      window.dispatchEvent(
        new CustomEvent("ticket-updated", { detail: { id: foundTicket.id, updates } })
      );

      const message = `Ticket ${ticketNumber.trim().replace(/^#/, "")} actualizado correctamente.`;
      setSuccess(message);
      toast.success(message, { position: "top-center" });
    } catch (err: any) {
      console.error("[TicketEditSection] Error actualizando ticket:", err);
      setError(err?.message || "No se pudieron guardar los cambios.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div className="bg-white rounded-3xl border border-gray-300 shadow-sm p-6">
        <div className="flex items-start space-x-3 mb-5">
          <div className="p-3 bg-blue-100 text-blue-900 rounded-2xl">
            <Edit2 className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-display font-black text-gray-900 uppercase tracking-wide">Edición de Ticket</h3>
            <p className="text-xs text-gray-500 font-sans mt-1">
              Consulte un ticket por su número y corrija la fecha/hora de emisión o la fecha de venta.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Hash className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="Número de ticket (ej. 040850)"
              className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-300 rounded-xl font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading}
            className="px-6 py-3.5 bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white font-black uppercase text-xs rounded-xl shadow-md transition-colors flex items-center justify-center space-x-2 cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>{loading ? "Consultando..." : "Consultar"}</span>
          </button>
        </div>

        {error && (
          <div className="mt-4 flex items-start space-x-2 p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-sans">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-4 flex items-start space-x-2 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs font-sans">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}
      </div>

      {foundTicket && (
        <div className="bg-white rounded-3xl border border-gray-300 shadow-sm p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-900 bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg">
                Ticket encontrado
              </span>
              <h4 className="font-display font-black text-lg text-gray-900 mt-2">
                #{foundTicket.data.id_ticket || foundTicket.data.numero_ticket || foundTicket.id}
              </h4>
            </div>
            <div className="text-right text-[10px] font-mono text-gray-500">
              <div>Documento: {foundTicket.id}</div>
              <div>Búsqueda: {foundTicket.matchedBy}</div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <label className="block">
              <span className="flex items-center space-x-1.5 text-[10px] font-black uppercase tracking-wider text-gray-600 mb-1.5">
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Fecha / Hora de Emisión</span>
              </span>
              <input
                type="datetime-local"
                step="1"
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="flex items-center space-x-1.5 text-[10px] font-black uppercase tracking-wider text-gray-600 mb-1.5">
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Fecha de Venta</span>
              </span>
              <input
                type="date"
                value={fechaVenta}
                onChange={(e) => setFechaVenta(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl font-mono text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-4">
            <p className="text-[10px] text-gray-500 font-sans">
              Los cambios se guardan directamente en el documento de Firestore.
            </p>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-black uppercase text-xs rounded-xl shadow-md transition-colors flex items-center justify-center space-x-2 cursor-pointer"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{saving ? "Guardando..." : "Guardar Cambios"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
