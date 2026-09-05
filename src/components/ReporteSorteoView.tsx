import { useMemo, useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import {
  CalendarDays,
  Gamepad2,
  Search,
  Loader2,
  BarChart3,
  FileSearch,
  AlertCircle,
  Trophy,
} from "lucide-react";
import { Configuracion } from "../types";
import { getLocalTodayStr } from "../lib/date-utils";

export interface ReporteSorteoDetalle {
  numero: string;
  monto_total_cs: number;
  cantidad_jugadas: number;
  cantidad_boletos: number;
}

export interface ReporteSorteoData {
  vendedorId: string;
  fecha: string;
  juego: string;
  sorteo: string;
  idSorteo: string | null;
  total_vendido_cs: number;
  total_boletos: number;
  total_jugadas: number;
  detalles: ReporteSorteoDetalle[];
}

export interface ReporteSorteoViewProps {
  userId: string;
  config: Configuracion;
}

interface SorteoOption {
  id: string;
  nombre: string;
}

const formatCurrency = (val: number) => {
  return `C$ ${val.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function ReporteSorteoView({ userId, config }: ReporteSorteoViewProps) {
  const [fecha, setFecha] = useState(() => getLocalTodayStr());
  const [selectedJuego, setSelectedJuego] = useState("");
  const [selectedSorteoId, setSelectedSorteoId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReporteSorteoData | null>(null);
  const [consultado, setConsultado] = useState(false);

  const juegos = useMemo(() => {
    const juegosSet = new Set<string>();
    (config?.sorteos || []).forEach((s) => {
      if (s && s.juego) juegosSet.add(s.juego);
    });
    return Array.from(juegosSet).sort((a, b) => a.localeCompare(b, "es"));
  }, [config?.sorteos]);

  const sorteos = useMemo<SorteoOption[]>(() => {
    return (config?.sorteos || [])
      .filter((s) => !selectedJuego || s.juego === selectedJuego)
      .map((s) => ({ id: s.id, nombre: s.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [config?.sorteos, selectedJuego]);

  const selectedSorteo = useMemo(() => {
    return sorteos.find((s) => s.id === selectedSorteoId) || null;
  }, [sorteos, selectedSorteoId]);

  const consultar = useCallback(async () => {
    if (!fecha) {
      toast.error("Seleccione una fecha.", { position: "top-center" });
      return;
    }
    if (!selectedJuego || !selectedSorteo) {
      toast.error("Seleccione el Juego y el Sorteo a consultar.", { position: "top-center" });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        vendedorId: userId,
        fecha,
        juego: selectedJuego,
        sorteo: selectedSorteo.nombre,
        idSorteo: selectedSorteo.id,
      });
      const response = await fetch(`/api/vendedor/reporte-sorteo?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || `Error del servidor (HTTP ${response.status})`);
      }
      setData(body as ReporteSorteoData);
      setConsultado(true);
    } catch (err: any) {
      console.error("[ReporteSorteoView] Error al consultar:", err);
      setError(err.message || "Ocurrió un error al consultar el reporte.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fecha, selectedJuego, selectedSorteo, userId]);

  // Consulta automática cuando se completan todos los filtros
  useEffect(() => {
    if (fecha && selectedJuego && selectedSorteo) {
      const t = setTimeout(() => consultar(), 250);
      return () => clearTimeout(t);
    }
  }, [fecha, selectedJuego, selectedSorteo, consultar]);

  const handleJuegoChange = (juegoVal: string) => {
    setSelectedJuego(juegoVal);
    setSelectedSorteoId("");
    setData(null);
    setConsultado(false);
  };

  const handleSorteoChange = (id: string) => {
    setSelectedSorteoId(id);
    setData(null);
    setConsultado(false);
  };

  const handleFechaChange = (d: string) => {
    setFecha(d);
    setData(null);
    setConsultado(false);
  };

  const topNumero = data?.detalles?.[0];

  return (
    <div className="space-y-4 animate-fade-in text-left">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-gray-200 pb-2">
        <div>
          <h3 className="font-display font-black text-sm text-gray-800 uppercase tracking-wider">Desglose por Sorteo</h3>
          <p className="text-[10px] text-gray-400 font-sans mt-0.5">
            Consulta los números vendidos y montos recaudados por sorteo y fecha.
          </p>
        </div>
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200">
          <BarChart3 className="w-3 h-3 text-blue-600" />
          <span className="text-[9px] font-black text-blue-700 uppercase tracking-wider">POR NÚMERO</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-3 rounded-2xl border border-gray-200 shadow-xs space-y-2.5">
        <div>
          <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">
            Fecha a Consultar
          </label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <CalendarDays className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={fecha}
                onChange={(e) => handleFechaChange(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-gray-200 rounded-xl text-xs font-mono font-bold focus:outline-none focus:border-blue-900"
              />
            </div>
            <button
              onClick={consultar}
              disabled={loading}
              className="px-3 py-2 bg-blue-900 hover:bg-blue-800 disabled:bg-blue-400 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors flex items-center space-x-1 cursor-pointer shrink-0"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              <span>Consultar</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">
              Juego
            </label>
            <select
              value={selectedJuego}
              onChange={(e) => handleJuegoChange(e.target.value)}
              className="w-full p-2 text-xs font-sans font-bold bg-slate-50 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-900 cursor-pointer"
            >
              <option value="">TODOS</option>
              {juegos.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">
              Sorteo
            </label>
            <select
              value={selectedSorteoId}
              onChange={(e) => handleSorteoChange(e.target.value)}
              disabled={!selectedJuego}
              className="w-full p-2 text-xs font-sans font-bold bg-slate-50 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-900 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">SELECCIONAR</option>
              {sorteos.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Mensaje de error */}
      {error && (
        <div className="p-3 bg-red-100 border-l-4 border-[#EF4444] rounded-lg text-red-900 font-sans text-xs flex items-start space-x-2 shadow-sm">
          <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
          <span className="font-bold tracking-tight">{error}</span>
        </div>
      )}

      {/* Estado de cliente sin consulta previa */}
      {!loading && !data && !error && !consultado && (
        <div className="text-center py-8 bg-white border border-dashed border-gray-300 rounded-2xl text-gray-400">
          <FileSearch className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="text-xs font-bold uppercase tracking-wider">
            Seleccione fecha, juego y sorteo para ver el desglose.
          </p>
        </div>
      )}

      {/* Cargando */}
      {loading && (
        <div className="text-center py-10">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-800 rounded-full animate-spin mx-auto mb-2"></div>
          <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">
            Consultando Firestore...
          </span>
        </div>
      )}

      {/* Resultado */}
      {!loading && data && (
        <div className="space-y-3">
          {/* Resumen */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-900 border border-blue-200 text-[10px] font-black uppercase tracking-wider">
              {data.juego}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-black uppercase tracking-wider">
              {data.sorteo}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-gray-100 text-gray-500 border border-gray-200 text-[10px] font-bold font-mono">
              {data.fecha}
            </span>
            <span className="ml-auto px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase tracking-wider">
              {data.detalles.length} Números
            </span>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white rounded-2xl p-3 border border-gray-200 shadow-xs text-center">
              <span className="text-[9px] text-gray-400 font-black uppercase tracking-wider block">Total Vendido</span>
              <span className="text-sm font-black text-blue-900 block mt-1 break-all">
                {formatCurrency(data.total_vendido_cs)}
              </span>
            </div>
            <div className="bg-white rounded-2xl p-3 border border-gray-200 shadow-xs text-center">
              <span className="text-[9px] text-gray-400 font-black uppercase tracking-wider block">Boletos</span>
              <span className="text-sm font-black text-gray-800 block mt-1">{data.total_boletos}</span>
            </div>
            <div className="bg-white rounded-2xl p-3 border border-gray-200 shadow-xs text-center">
              <span className="text-[9px] text-gray-400 font-black uppercase tracking-wider block">Jugadas</span>
              <span className="text-sm font-black text-gray-800 block mt-1">{data.total_jugadas}</span>
            </div>
          </div>

          {/* Número más jugado */}
          {topNumero && (
            <div className="flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-2xl p-3 shadow-sm">
              <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-[9px] text-amber-700 font-black uppercase tracking-wider block">
                  Número Más Recaudado
                </span>
                <span className="text-sm font-mono font-black text-amber-800 block">
                  {topNumero.numero}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[9px] text-amber-600 font-black uppercase tracking-wider block">
                  {topNumero.cantidad_jugadas} Jugadas
                </span>
                <span className="text-sm font-mono font-black text-amber-900 block">
                  {formatCurrency(topNumero.monto_total_cs)}
                </span>
              </div>
            </div>
          )}

          {/* Tabla de desglose */}
          {data.detalles.length === 0 ? (
            <div className="text-center py-10 bg-white border border-gray-200 rounded-2xl text-gray-400 text-xs">
              No se encontraron ventas para el juego, sorteo y fecha seleccionados.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
              {/* Tabla Header */}
              <div className="grid grid-cols-12 gap-1 px-3 py-2.5 bg-slate-100 border-b border-gray-200 text-[9px] font-display font-black uppercase tracking-wider text-gray-500">
                <span className="col-span-1 text-center">#</span>
                <span className="col-span-4">Número</span>
                <span className="col-span-2 text-center">Jugadas</span>
                <span className="col-span-2 text-center">Boletos</span>
                <span className="col-span-3 text-right">Monto C$</span>
              </div>

              {/* Filas */}
              <div className="max-h-[380px] overflow-y-auto divide-y divide-gray-100">
                {data.detalles.map((d, idx) => (
                  <div
                    key={d.numero}
                    className="grid grid-cols-12 gap-1 px-3 py-2 items-center text-xs hover:bg-blue-50/40 transition-colors"
                  >
                    <span className="col-span-1 text-center text-[10px] font-mono font-bold text-gray-400">
                      {idx + 1}
                    </span>
                    <span className="col-span-4">
                      <span className="font-mono font-black text-gray-900 text-sm">{d.numero}</span>
                    </span>
                    <span className="col-span-2 text-center font-sans font-bold text-gray-600">
                      {d.cantidad_jugadas}
                    </span>
                    <span className="col-span-2 text-center font-sans font-bold text-gray-600">
                      {d.cantidad_boletos}
                    </span>
                    <span className="col-span-3 text-right font-mono font-black text-blue-900">
                      {d.monto_total_cs.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="grid grid-cols-12 gap-1 px-3 py-2.5 bg-blue-900 border-t border-blue-950 text-[10px] font-black uppercase tracking-wider text-white">
                <span className="col-span-7">Total</span>
                <span className="col-span-2 text-center">{data.total_jugadas}</span>
                <span className="col-span-3 text-right font-mono">
                  {data.total_vendido_cs.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          {/* Icono de juego en cabecera (referencia visual) */}
          <div className="flex items-center justify-center py-1 text-[9px] text-gray-300 uppercase tracking-widest font-bold">
            <Gamepad2 className="w-3 h-3 mr-1" />
            Reporte generado al momento de la consulta
          </div>
        </div>
      )}
    </div>
  );
}