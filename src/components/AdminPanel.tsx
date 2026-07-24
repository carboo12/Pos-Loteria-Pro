import React, { useState, useMemo } from "react";
import { 
  FileText, 
  Search, 
  Edit2, 
  Trash2, 
  Plus, 
  AlertCircle, 
  RefreshCw, 
  User, 
  Calendar,
  CheckCircle,
  Eye,
  DollarSign
} from "lucide-react";
import toast from "react-hot-toast";
import { Usuario, Venta, Configuracion } from "../types";
import { getLocalTodayStr, getTicketDate } from "../lib/date-utils";

interface AdminPanelProps {
  user: Usuario;
  config: Configuracion;
  onRefreshConfig: () => Promise<void>;
  users: Usuario[];
  sales: Venta[];
  onRefreshSales: () => Promise<void>;
}

export default function AdminPanel({
  user,
  config,
  onRefreshConfig,
  users,
  sales,
  onRefreshSales
}: AdminPanelProps) {
  // ─── SECURITY GUARD ──────────────────────────────────────────────────
  if (user.rol !== "administrador") {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-red-50 border border-red-200 rounded-3xl text-center max-w-lg mx-auto my-10">
        <div className="p-3 bg-red-100 rounded-full text-red-600 mb-4 animate-bounce">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h3 className="font-display font-black text-lg text-red-950 uppercase">Acceso Denegado</h3>
        <p className="text-xs text-red-700 mt-2 font-medium">
          Este módulo está restringido exclusivamente para usuarios con rol de administrador.
        </p>
      </div>
    );
  }

  // Section Selector: 'tickets' (Rescate) or 'ingresos' (Gestión de Ingresos)
  const [activeTab, setActiveTab] = useState<"tickets" | "ingresos">("tickets");

  // ─── RESCATE DE TICKETS STATE ───────────────────────────────────────
  const [rescueSellerId, setRescueSellerId] = useState<string>("TODOS");
  const [rescueDate, setRescueDate] = useState<string>(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  });
  const [rescueTicketQuery, setRescueTicketQuery] = useState("");
  const [selectedRescueTicket, setSelectedRescueTicket] = useState<Venta | null>(null);

  // Filter sellers
  const sellersList = useMemo(() => {
    return users.filter(u => u.rol === "vendedor");
  }, [users]);

  // Filtered tickets matching search criteria
  const filteredRescueTickets = useMemo(() => {
    return sales.filter(ticket => {
      // Filter by seller ID
      if (rescueSellerId !== "TODOS" && ticket.id_vendedor !== rescueSellerId) {
        return false;
      }
      // Filter by date
      if (rescueDate && getTicketDate(ticket) !== rescueDate) {
        return false;
      }
      // Filter by query (ticket number or customer)
      if (rescueTicketQuery) {
        const query = rescueTicketQuery.trim().toLowerCase();
        const numMatch = ticket.numero_ticket?.toLowerCase().includes(query);
        const clientMatch = ticket.nombre_cliente?.toLowerCase().includes(query);
        const gameMatch = ticket.juego?.toLowerCase().includes(query);
        if (!numMatch && !clientMatch && !gameMatch) return false;
      }
      return true;
    });
  }, [sales, rescueSellerId, rescueDate, rescueTicketQuery]);

  // ─── GESTIÓN DE INGRESOS STATE ─────────────────────────────────────
  const [editingIngreso, setEditingIngreso] = useState<any | null>(null);
  const [ingresoSubmitting, setIngresoSubmitting] = useState(false);
  const [showAddIngresoModal, setShowAddIngresoModal] = useState(false);

  // Form states (Add/Edit)
  const [ingresoFormVendedor, setIngresoFormVendedor] = useState("");
  const [ingresoFormMontoCs, setIngresoFormMontoCs] = useState("");
  const [ingresoFormMontoUsd, setIngresoFormMontoUsd] = useState("");
  const [ingresoFormComentario, setIngresoFormComentario] = useState("");
  const [ingresoFormFecha, setIngresoFormFecha] = useState(() => getLocalTodayStr());

  const incomesList = useMemo(() => {
    return [...(config.ingresos || [])].sort((a, b) => {
      return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
    });
  }, [config.ingresos]);

  // Handle Add new Income (acting as Admin/Supervisor)
  const handleAddIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ingresoFormVendedor || (!ingresoFormMontoCs && !ingresoFormMontoUsd)) {
      toast.error("Por favor complete el vendedor y al menos un monto.");
      return;
    }
    setIngresoSubmitting(true);
    try {
      const response = await fetch("/api/ingresos", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token") || ""}`
        },
        body: JSON.stringify({
          id_vendedor: ingresoFormVendedor,
          id_supervisor: user.id, // Admin acts as supervisor
          monto_cs: Number(ingresoFormMontoCs) || 0,
          monto_usd: Number(ingresoFormMontoUsd) || 0,
          comentario: ingresoFormComentario,
          fecha: ingresoFormFecha
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Error al guardar el ingreso");
      
      toast.success("Ingreso registrado correctamente.");
      setShowAddIngresoModal(false);
      resetIngresoForm();
      await onRefreshConfig();
    } catch (err: any) {
      toast.error(err.message || "Error al crear el ingreso");
    } finally {
      setIngresoSubmitting(false);
    }
  };

  // Handle Update Income
  const handleUpdateIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIngreso) return;
    setIngresoSubmitting(true);
    try {
      const response = await fetch(`/api/ingresos/${editingIngreso.id}`, {
        method: "PUT",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token") || ""}`
        },
        body: JSON.stringify({
          monto_cs: Number(ingresoFormMontoCs) || 0,
          monto_usd: Number(ingresoFormMontoUsd) || 0,
          comentario: ingresoFormComentario,
          id_vendedor: ingresoFormVendedor,
          fecha: ingresoFormFecha
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Error al actualizar");
      
      toast.success("Ingreso actualizado con éxito.");
      setEditingIngreso(null);
      resetIngresoForm();
      await onRefreshConfig();
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar ingreso");
    } finally {
      setIngresoSubmitting(false);
    }
  };

  // Handle Delete Income
  const handleDeleteIngreso = async (id: string) => {
    if (!window.confirm("¿Está seguro de que desea eliminar este ingreso de forma permanente? Se registrará en la auditoría.")) {
      return;
    }
    try {
      const response = await fetch(`/api/ingresos/${id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("token") || ""}`
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Error al eliminar");
      
      toast.success("Ingreso eliminado de la base de datos.");
      await onRefreshConfig();
    } catch (err: any) {
      toast.error(err.message || "Error al eliminar ingreso");
    }
  };

  const resetIngresoForm = () => {
    setIngresoFormVendedor("");
    setIngresoFormMontoCs("");
    setIngresoFormMontoUsd("");
    setIngresoFormComentario("");
    setIngresoFormFecha(getLocalTodayStr());
  };

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 bg-gray-50 p-4 md:p-6 font-sans">
      {/* Header and navigation tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h2 className="text-xl font-display font-black uppercase text-gray-900 tracking-wider">Panel Modular Admin</h2>
          <p className="text-xs text-gray-500 font-medium">Gestión de Rescate de Boletos y Control Centralizado de Ingresos</p>
        </div>
        <div className="flex p-1 bg-gray-200/80 backdrop-blur rounded-2xl border border-gray-300 max-w-xs">
          <button
            onClick={() => setActiveTab("tickets")}
            className={`flex-1 text-center py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "tickets" ? "bg-white text-blue-900 shadow-md font-extrabold" : "text-gray-600 hover:text-gray-800"
            }`}
          >
            Rescate Tickets
          </button>
          <button
            onClick={() => setActiveTab("ingresos")}
            className={`flex-1 text-center py-2 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === "ingresos" ? "bg-white text-blue-900 shadow-md font-extrabold" : "text-gray-600 hover:text-gray-800"
            }`}
          >
            Gestión Ingresos
          </button>
        </div>
      </div>

      {/* ─── SECTION 1: RESCATE DE TICKETS ──────────────────────────────── */}
      {activeTab === "tickets" && (
        <div className="flex-1 flex flex-col min-h-0 space-y-6">
          {/* Filter Bar */}
          <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 w-full">
              <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1.5 tracking-wider">Filtrar por Vendedor</label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <select
                  value={rescueSellerId}
                  onChange={(e) => setRescueSellerId(e.target.value)}
                  className="w-full bg-gray-50 pl-10 pr-3 py-2 rounded-xl text-xs font-semibold text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                >
                  <option value="TODOS">Todos los Vendedores</option>
                  {sellersList.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="w-full md:w-48">
              <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1.5 tracking-wider">Fecha de Venta</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="date"
                  value={rescueDate}
                  onChange={(e) => setRescueDate(e.target.value)}
                  className="w-full bg-gray-50 pl-10 pr-3 py-2 rounded-xl text-xs font-semibold text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex-1 w-full">
              <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1.5 tracking-wider">Número de Ticket / Cliente</label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar por ticket, cliente, juego..."
                  value={rescueTicketQuery}
                  onChange={(e) => setRescueTicketQuery(e.target.value)}
                  className="w-full bg-gray-50 pl-10 pr-3 py-2 rounded-xl text-xs font-semibold text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <button
              onClick={async () => {
                const loadToast = toast.loading("Actualizando boletos...");
                await onRefreshSales();
                toast.dismiss(loadToast);
                toast.success("Lista de boletos actualizada");
              }}
              className="bg-blue-50 hover:bg-blue-100 text-blue-900 p-2.5 rounded-xl border border-blue-200 transition-all flex items-center justify-center cursor-pointer"
              title="Refrescar Boletos"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {/* Results Table */}
          <div className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h3 className="font-display font-black text-xs uppercase text-gray-700 tracking-wider">Boletos Coincidentes ({filteredRescueTickets.length})</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto">
              {filteredRescueTickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center text-gray-400 font-medium">
                  <Search className="w-12 h-12 text-gray-300 mb-3 animate-pulse" />
                  <p className="text-sm">No se encontraron tickets con los filtros especificados.</p>
                  <p className="text-[10px] text-gray-400 mt-1">Verifique la fecha de venta o el vendedor seleccionado.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-[9px] uppercase font-black text-gray-500 tracking-wider border-b border-gray-200">
                      <th className="p-3">Ticket</th>
                      <th className="p-3">Vendedor</th>
                      <th className="p-3">Juego / Sorteo</th>
                      <th className="p-3">Número</th>
                      <th className="p-3 text-right">Monto</th>
                      <th className="p-3">Estado</th>
                      <th className="p-3 text-center">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-sans">
                    {filteredRescueTickets.map(ticket => (
                      <tr key={ticket.id} className="border-b border-gray-100 hover:bg-blue-50/30 transition-colors">
                        <td className="p-3 font-mono font-bold text-gray-900">#{ticket.numero_ticket}</td>
                        <td className="p-3 font-bold text-blue-900 uppercase">{ticket.nombre_vendedor}</td>
                        <td className="p-3 text-gray-600 font-semibold">{ticket.juego} - {ticket.sorteo}</td>
                        <td className="p-3 font-mono font-black text-gray-950 bg-gray-100/50 px-2 py-0.5 rounded text-center w-16">{ticket.numero_jugado}</td>
                        <td className="p-3 text-right font-black text-emerald-700">
                          {ticket.moneda} {ticket.monto_pago.toFixed(2)}
                        </td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                            ticket.anulado 
                              ? "bg-red-100 text-red-700" 
                              : ticket.estado === "ganador"
                              ? "bg-emerald-100 text-emerald-700 animate-pulse"
                              : ticket.estado === "pagado"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-amber-100 text-amber-700"
                          }`}>
                            {ticket.anulado ? "Anulado" : ticket.estado}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          <button
                            onClick={() => setSelectedRescueTicket(ticket)}
                            className="p-1 hover:bg-gray-100 rounded text-blue-600 transition-colors inline-flex items-center justify-center cursor-pointer"
                            title="Ver Boleta"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── SECTION 2: GESTIÓN DE INGRESOS ────────────────────────────── */}
      {activeTab === "ingresos" && (
        <div className="flex-1 flex flex-col min-h-0 space-y-6">
          <div className="bg-white rounded-3xl p-5 border border-gray-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="font-display font-black text-xs uppercase text-gray-800">Control de Ingresos Administrativos</h3>
              <p className="text-[10px] text-gray-400 mt-0.5 font-medium">Añada, edite y elimine los ingresos de caja reportados por supervisores.</p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => {
                  resetIngresoForm();
                  setShowAddIngresoModal(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Nuevo Ingreso</span>
              </button>
              <button
                onClick={async () => {
                  const loadToast = toast.loading("Actualizando ingresos...");
                  await onRefreshConfig();
                  toast.dismiss(loadToast);
                  toast.success("Historial de ingresos actualizado");
                }}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 p-2.5 rounded-xl border border-gray-200 transition-all cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Incomes Table */}
          <div className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h3 className="font-display font-black text-xs uppercase text-gray-700 tracking-wider">Historial de Ingresos ({incomesList.length})</h3>
            </div>

            <div className="flex-1 overflow-y-auto">
              {incomesList.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center text-gray-400 font-medium">
                  <FileText className="w-12 h-12 text-gray-300 mb-3" />
                  <p className="text-sm">No hay ingresos registrados en la configuración.</p>
                  <p className="text-[10px] text-gray-400 mt-1">Haga clic en 'Nuevo Ingreso' para añadir el primero.</p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-[9px] uppercase font-black text-gray-500 tracking-wider border-b border-gray-200">
                      <th className="p-3">Fecha</th>
                      <th className="p-3">Vendedor</th>
                      <th className="p-3 text-right">Monto C$</th>
                      <th className="p-3 text-right">Monto USD</th>
                      <th className="p-3">Comentario</th>
                      <th className="p-3 text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-sans">
                    {incomesList.map(ing => (
                      <tr key={ing.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="p-3 text-gray-800 font-semibold">
                          {ing.timestamp ? new Date(ing.timestamp).toLocaleString("es-NI") : ing.fecha}
                        </td>
                        <td className="p-3 font-bold text-blue-900 uppercase">{ing.nombre_vendedor}</td>
                        <td className="p-3 text-right font-black text-emerald-700">C$ {Number(ing.monto_cs).toFixed(2)}</td>
                        <td className="p-3 text-right font-black text-emerald-950">$ {Number(ing.monto_usd).toFixed(2)}</td>
                        <td className="p-3 text-gray-600 truncate max-w-[200px]" title={ing.comentario}>{ing.comentario || "-"}</td>
                        <td className="p-3 text-center space-x-2 w-28">
                          <button
                            onClick={() => {
                              setEditingIngreso(ing);
                              setIngresoFormVendedor(ing.id_vendedor || "");
                              setIngresoFormMontoCs(String(ing.monto_cs));
                              setIngresoFormMontoUsd(String(ing.monto_usd));
                              setIngresoFormComentario(ing.comentario || "");
                              setIngresoFormFecha(ing.fecha || getLocalTodayStr());
                            }}
                            className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-all inline-flex items-center justify-center cursor-pointer"
                            title="Editar"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteIngreso(ing.id)}
                            className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-all inline-flex items-center justify-center cursor-pointer"
                            title="Eliminar"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: NUEVO INGRESO ───────────────────────────────────────── */}
      {showAddIngresoModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleAddIngreso} className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h3 className="font-display font-black text-sm uppercase text-gray-800">Registrar Nuevo Ingreso</h3>
              <button 
                type="button" 
                onClick={() => setShowAddIngresoModal(false)}
                className="p-1.5 hover:bg-gray-200 rounded-lg transition-all text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Vendedor</label>
                <select
                  value={ingresoFormVendedor}
                  onChange={(e) => setIngresoFormVendedor(e.target.value)}
                  className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                  required
                >
                  <option value="">Seleccione Vendedor</option>
                  {sellersList.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Fecha del Ingreso</label>
                <input
                  type="date"
                  value={ingresoFormFecha}
                  onChange={(e) => setIngresoFormFecha(e.target.value)}
                  max={getLocalTodayStr()}
                  className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold border border-gray-200 focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Monto C$ (Córdobas)</label>
                  <input
                    type="number"
                    step="any"
                    value={ingresoFormMontoCs}
                    onChange={(e) => setIngresoFormMontoCs(e.target.value)}
                    className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold border border-gray-200 focus:ring-2 focus:ring-emerald-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Monto USD (Dólares)</label>
                  <input
                    type="number"
                    step="any"
                    value={ingresoFormMontoUsd}
                    onChange={(e) => setIngresoFormMontoUsd(e.target.value)}
                    className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold border border-gray-200 focus:ring-2 focus:ring-emerald-500"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Comentario / Concepto</label>
                <textarea
                  value={ingresoFormComentario}
                  onChange={(e) => setIngresoFormComentario(e.target.value)}
                  className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold border border-gray-200 focus:ring-2 focus:ring-emerald-500 h-20 resize-none"
                  placeholder="Ej: Entrega de base inicial..."
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end space-x-2 bg-gray-50/50">
              <button 
                type="button" 
                onClick={() => setShowAddIngresoModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button 
                type="submit" 
                disabled={ingresoSubmitting}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
              >
                {ingresoSubmitting ? "Guardando..." : "Registrar"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── MODAL: EDITAR INGRESO ───────────────────────────────────────── */}
      {editingIngreso && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <form onSubmit={handleUpdateIngreso} className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <h3 className="font-display font-black text-sm uppercase text-gray-800">Modificar Ingreso</h3>
              <button 
                type="button" 
                onClick={() => setEditingIngreso(null)}
                className="p-1.5 hover:bg-gray-200 rounded-lg transition-all text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Vendedor</label>
                <select
                  value={ingresoFormVendedor}
                  onChange={(e) => setIngresoFormVendedor(e.target.value)}
                  className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold text-gray-800 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  required
                >
                  <option value="">Seleccione Vendedor</option>
                  {sellersList.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre.toUpperCase()}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Fecha del Ingreso</label>
                <input
                  type="date"
                  value={ingresoFormFecha}
                  onChange={(e) => setIngresoFormFecha(e.target.value)}
                  max={getLocalTodayStr()}
                  className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold border border-gray-200 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Monto C$</label>
                  <input
                    type="number"
                    step="any"
                    value={ingresoFormMontoCs}
                    onChange={(e) => setIngresoFormMontoCs(e.target.value)}
                    className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold border border-gray-200 focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Monto USD</label>
                  <input
                    type="number"
                    step="any"
                    value={ingresoFormMontoUsd}
                    onChange={(e) => setIngresoFormMontoUsd(e.target.value)}
                    className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold border border-gray-200 focus:ring-2 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1 tracking-wider">Comentario / Concepto</label>
                <textarea
                  value={ingresoFormComentario}
                  onChange={(e) => setIngresoFormComentario(e.target.value)}
                  className="w-full bg-gray-50 p-2.5 rounded-xl text-xs font-semibold border border-gray-200 focus:ring-2 focus:ring-blue-500 h-20 resize-none"
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end space-x-2 bg-gray-50/50">
              <button 
                type="button" 
                onClick={() => setEditingIngreso(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button 
                type="submit" 
                disabled={ingresoSubmitting}
                className="bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
              >
                {ingresoSubmitting ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── TICKET PREVIEW OVERLAY ────────────────────────────────────── */}
      {selectedRescueTicket && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full border border-gray-200 overflow-hidden p-6 relative">
            <button 
              onClick={() => setSelectedRescueTicket(null)}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 text-sm cursor-pointer"
            >
              ✕
            </button>
            <h3 className="font-display font-black text-sm uppercase text-gray-800 mb-4 tracking-wider">Boleto #{selectedRescueTicket.numero_ticket}</h3>
            
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200 space-y-2 font-mono text-[11px] text-gray-700">
              <div><strong>Vendedor:</strong> {selectedRescueTicket.nombre_vendedor}</div>
              <div><strong>Fecha Emisión:</strong> {new Date(selectedRescueTicket.fecha_emision).toLocaleString("es-NI")}</div>
              <div><strong>Fecha Venta (Raíz):</strong> {selectedRescueTicket.fecha_venta}</div>
              <div><strong>Juego/Sorteo:</strong> {selectedRescueTicket.juego_sorteo || `${selectedRescueTicket.juego} ${selectedRescueTicket.sorteo}`}</div>
              <div><strong>Moneda:</strong> {selectedRescueTicket.moneda}</div>
              <div className="border-t border-dashed border-gray-300 pt-2 my-2">
                <strong>Jugadas:</strong>
                {selectedRescueTicket.jugadas?.map((j, idx) => (
                  <div key={idx} className="flex justify-between pl-2">
                    <span>Num: {j.numero} {j.dia_juego ? `(Día Sorteo: ${j.dia_juego})` : ""}</span>
                    <strong>{selectedRescueTicket.moneda} {j.monto.toFixed(2)}</strong>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-300 pt-2 flex justify-between font-bold text-xs text-gray-900">
                <span>Total Apostado:</span>
                <span>{selectedRescueTicket.moneda} {selectedRescueTicket.total_apostado?.toFixed(2) || selectedRescueTicket.monto_pago.toFixed(2)}</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => setSelectedRescueTicket(null)}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer transition-all"
              >
                Cerrar Vista
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
