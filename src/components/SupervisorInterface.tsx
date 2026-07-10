import { useState, useEffect, FormEvent } from "react";
import { 
  Users, 
  History, 
  DollarSign, 
  FileText, 
  CheckCircle, 
  Check, 
  X, 
  ArrowRight,
  TrendingUp,
  AlertCircle,
  UserCheck,
  Building,
  RefreshCw,
  Search,
  ChevronRight,
  Smartphone,
  Activity,
  BarChart3,
  MapPin,
  Plus,
  Wifi,
  WifiOff
} from "lucide-react";
import { Usuario, Configuracion, Venta, CierreCaja, CobroVendedor } from "../types";

const formatTo12HourTime = (dateInput: Date | string | number, includeSeconds: boolean = true): string => {
  try {
    const date = typeof dateInput === "object" ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return String(dateInput);
    
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    const hoursStr = String(hours).padStart(2, "0");
    
    if (includeSeconds) {
      const seconds = String(date.getSeconds()).padStart(2, "0");
      return `${hoursStr}:${minutes}:${seconds} ${ampm}`;
    }
    return `${hoursStr}:${minutes} ${ampm}`;
  } catch (e) {
    return String(dateInput);
  }
};

interface SupervisorInterfaceProps {
  user: Usuario;
  config: Configuracion;
  onRefreshSales: () => Promise<void>;
  onRefreshUsers: () => Promise<void>;
  users: Usuario[];
  sales: Venta[];
  closures: CierreCaja[];
  onUpdateUser: (userId: string, updates: Partial<Usuario>) => Promise<boolean>;
}

export default function SupervisorInterface({
  user,
  config,
  onRefreshSales,
  onRefreshUsers,
  users,
  sales,
  closures,
  onUpdateUser
}: SupervisorInterfaceProps) {
  const [activeTab, setActiveTab] = useState<"vendedores" | "arqueos" | "ventas" | "cobros">("vendedores");
  const [selectedSellerForCobro, setSelectedSellerForCobro] = useState<Usuario | null>(null);
  
  // Search and Filter States for Mobile-First Dashboard
  const [searchQuery, setSearchQuery] = useState("");
  const [subTab, setSubTab] = useState<"equipo" | "disponibles">("equipo");
  const [arqueosFilter, setArqueosFilter] = useState<"todos" | "pendientes" | "cobrados">("todos");
  const [monitoreoFilter, setMonitoreoFilter] = useState<"todos" | "validos" | "anulados">("todos");

  // Form values for register cobro
  const [montoCobroCs, setMontoCobroCs] = useState("");
  const [montoCobroUsd, setMontoCobroUsd] = useState("");
  const [comentarioCobro, setComentarioCobro] = useState("");
  
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [allCobros, setAllCobros] = useState<CobroVendedor[]>([]);
  
  // Simulated connection and live clock to match Vendedor POS visual identity
  const [isOnline, setIsOnline] = useState(true);
  const [timeText, setTimeText] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setTimeText(formatTo12HourTime(now));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchCobros = async () => {
    try {
      const res = await fetch("/api/cobros");
      if (res.ok) {
        const data = await res.json();
        setAllCobros(data);
      }
    } catch (e) {
      console.error("Error loading cobros", e);
    }
  };

  useEffect(() => {
    fetchCobros();
  }, []);

  const handleRefreshAll = async () => {
    setLoading(true);
    await Promise.all([
      onRefreshSales(),
      onRefreshUsers(),
      fetchCobros()
    ]);
    setLoading(false);
  };

  // 1. Linked sellers list
  const linkedSellers = users.filter(u => u.rol === "vendedor" && u.id_supervisor === user.id);
  const otherSellers = users.filter(u => u.rol === "vendedor" && (!u.id_supervisor || u.id_supervisor === ""));

  // Toggle seller association
  const handleToggleAssociation = async (sellerId: string, isAssociated: boolean) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    const updated = await onUpdateUser(sellerId, { 
      id_supervisor: isAssociated ? "" : user.id 
    });
    if (updated) {
      setSuccessMessage(isAssociated ? "Vendedor desvinculado con éxito." : "Vendedor vinculado a su supervisión con éxito.");
    } else {
      setErrorMessage("No se pudo actualizar la vinculación del vendedor.");
    }
  };

  // 2. Transactions of linked vendedores
  const linkedSellersIds = linkedSellers.map(s => s.id);
  const linkedSales = sales
    .filter(s => linkedSellersIds.includes(s.id_vendedor))
    .sort((a, b) => new Date(b.timestamp_servidor).getTime() - new Date(a.timestamp_servidor).getTime());

  // 3. Closures of linked vendedores
  const linkedClosures = closures
    .filter(c => linkedSellersIds.includes(c.id_vendedor))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // My supervisors cobros list
  const myCobros = allCobros
    .filter(cob => cob.id_supervisor === user.id)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Submit collection handler
  const handleRegisterCobro = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedSellerForCobro) return;

    const amtCs = Number(montoCobroCs);
    const amtUsd = Number(montoCobroUsd);

    if (isNaN(amtCs) || amtCs < 0 || isNaN(amtUsd) || amtUsd < 0 || (amtCs === 0 && amtUsd === 0)) {
      setErrorMessage("Por favor, ingrese un monto válido en C$ o USD.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/cobros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_vendedor: selectedSellerForCobro.id,
          id_supervisor: user.id,
          monto_cs: amtCs,
          monto_usd: amtUsd,
          comentario: comentarioCobro
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Fallo al registrar el cobro.");
      }

      setSuccessMessage(`Cobro registrado exitosamente para ${selectedSellerForCobro.nombre}.`);
      setSelectedSellerForCobro(null);
      setMontoCobroCs("");
      setMontoCobroUsd("");
      setComentarioCobro("");
      
      // Refresh
      await handleRefreshAll();
    } catch (err: any) {
      setErrorMessage(err.message || "Error al procesar cobro.");
    } finally {
      setLoading(false);
    }
  };

  // Helper to calculate total pending debt for a seller
  const getSellerSummary = (sellerId: string) => {
    // Sum of all active non-null closures from this seller that are NOT marked cobrado
    const pendingClosures = closures.filter(c => c.id_vendedor === sellerId && !c.cobrado);
    
    const pendingCs = pendingClosures.reduce((sum, c) => sum + c.monto_entregado_cs, 0);
    const pendingUsd = pendingClosures.reduce((sum, c) => sum + c.monto_entregado_usd, 0);

    return {
      pendingCs,
      pendingUsd,
      count: pendingClosures.length
    };
  };

  // Flag helper for each region
  const getFlag = (regionName: string) => {
    switch (regionName?.toLowerCase()) {
      case "nicaragua": return "🇳🇮";
      case "honduras": return "🇭🇳";
      case "costa rica": return "🇨🇷";
      case "el salvador": return "🇸🇻";
      default: return "🇳🇮";
    }
  };

  // 1. Filtered and searched data selectors
  const filteredLinkedSellers = linkedSellers.filter(s => {
    const sTerm = searchQuery.toLowerCase();
    return s.nombre.toLowerCase().includes(sTerm) || 
           s.email.toLowerCase().includes(sTerm) ||
           (s.usuario && s.usuario.toLowerCase().includes(sTerm));
  });

  const filteredOtherSellers = otherSellers.filter(s => {
    const sTerm = searchQuery.toLowerCase();
    return s.nombre.toLowerCase().includes(sTerm) || 
           s.email.toLowerCase().includes(sTerm) ||
           (s.usuario && s.usuario.toLowerCase().includes(sTerm));
  });

  const searchedClosures = linkedClosures.filter(c => {
    const sTerm = searchQuery.toLowerCase();
    const matchSearch = c.nombre_vendedor.toLowerCase().includes(sTerm) || c.fecha.toLowerCase().includes(sTerm);
    if (arqueosFilter === "pendientes") return matchSearch && !c.cobrado;
    if (arqueosFilter === "cobrados") return matchSearch && c.cobrado;
    return matchSearch;
  });

  const searchedSales = linkedSales.filter(sale => {
    const sTerm = searchQuery.toLowerCase();
    const matchSearch = 
      sale.numero_ticket.toLowerCase().includes(sTerm) ||
      sale.nombre_vendedor.toLowerCase().includes(sTerm) ||
      sale.numero_jugado.toLowerCase().includes(sTerm) ||
      sale.juego.toLowerCase().includes(sTerm);
    
    if (monitoreoFilter === "validos") return matchSearch && !sale.anulado;
    if (monitoreoFilter === "anulados") return matchSearch && sale.anulado;
    return matchSearch;
  });

  const searchedCobros = myCobros.filter(cob => {
    const sTerm = searchQuery.toLowerCase();
    return cob.nombre_vendedor.toLowerCase().includes(sTerm) || 
           (cob.comentario && cob.comentario.toLowerCase().includes(sTerm));
  });

  // Portfolio total outstanding sums
  const totalPendingCs = linkedSellers.reduce((sum, s) => sum + getSellerSummary(s.id).pendingCs, 0);
  const totalPendingUsd = linkedSellers.reduce((sum, s) => sum + getSellerSummary(s.id).pendingUsd, 0);

  return (
    <div id="supervisor-container" className="flex flex-col bg-[#F3F4F6] flex-1 w-full">
      
      {/* Premium Deep Blue Header matching the Vendedor POS Visual Identity */}
      <div className="bg-[#1E3A8A] text-white px-4 py-3 flex flex-col justify-between border-b border-blue-950 shrink-0">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="relative">
              <span className="text-sm font-display font-black tracking-wide uppercase">{user.nombre}</span>
              <span className="block text-[10px] text-blue-200 uppercase font-mono tracking-wider font-bold">Supervisor Regional</span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            {/* Live synchronizer button - integrated cleanly into header */}
            <button
              onClick={handleRefreshAll}
              disabled={loading}
              className="w-11 h-11 rounded-lg bg-blue-950 text-white hover:bg-blue-900 border border-blue-800 transition-all cursor-pointer flex items-center justify-center shrink-0"
              title="Sincronizar Datos"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>

            {/* Simulated Live Connection indicators */}
            <button
              onClick={() => {
                setIsOnline(!isOnline);
                setErrorMessage(null);
                setSuccessMessage(null);
              }}
              className={`flex items-center space-x-1 px-3 min-h-[44px] rounded-full text-[9px] font-black uppercase transition-all shadow-inner border cursor-pointer ${
                isOnline 
                  ? "bg-[#10B981] border-[#0F9F6F] text-white" 
                  : "bg-[#EF4444] border-[#D83A3A] text-white"
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="w-2.5 h-2.5 animate-pulse" />
                  <span>Conectado</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-2.5 h-2.5" />
                  <span>Sin Red</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Exchange Rate and clock display matching Vendedor */}
        <div className="mt-2 pt-2 border-t border-blue-800 flex justify-between items-center text-[11px] font-mono font-bold text-blue-200">
          <span>T. CAMBIO: C$ {config.tasa_cambio.toFixed(2)}</span>
          <span className="bg-blue-950 px-2 py-0.5 rounded text-white animate-pulse">Reloj: {timeText}</span>
        </div>
      </div>

      {/* Main Viewport Container Scrollable Area */}
      <div className="flex-1 p-4 overflow-y-auto">
        
        {/* 2. COMPACT PORTFOLIO BENTO METRICS */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {/* Metric 1 */}
          <div className="bg-[#1E3A8A] text-white rounded-2xl p-3.5 border border-blue-950 shadow-sm flex flex-col justify-between h-24">
            <span className="text-[9px] uppercase font-mono font-bold text-blue-200 tracking-wider">Mi Cartera</span>
            <div>
              <span className="text-base font-sans font-black block leading-none text-white">
                {linkedSellers.filter(v => v.conexion === "online").length}/{linkedSellers.length} En línea
              </span>
              <span className="text-[9px] text-blue-200/85 block mt-1">Vendedores activos</span>
            </div>
          </div>

          {/* Metric 2 */}
          <div className="bg-white text-gray-900 rounded-2xl p-3.5 border border-gray-200 shadow-xs flex flex-col justify-between h-24">
            <span className="text-[9px] uppercase font-mono font-bold text-gray-400 tracking-wider">Vendido Hoy</span>
            <div>
              <span className="text-base font-sans font-black block leading-none text-gray-950">
                C$ {linkedSales.filter(s => !s.anulado && s.moneda === "C$").reduce((sum, s) => sum + s.monto_pago, 0).toLocaleString("es-ES")}
              </span>
              <span className="text-[9px] text-gray-400 block mt-1">Córdobas del día</span>
            </div>
          </div>

          {/* Metric 3 */}
          <div className="bg-white text-gray-900 rounded-2xl p-3.5 border border-gray-200 shadow-xs flex flex-col justify-between h-24">
            <span className="text-[9px] uppercase font-mono font-bold text-gray-400 tracking-wider">Cobros Hechos</span>
            <div>
              <span className="text-base font-sans font-black block leading-none text-emerald-700">
                C$ {myCobros.reduce((sum, c) => sum + c.monto_cs, 0).toLocaleString("es-ES")}
              </span>
              <span className="text-[9px] text-gray-400 block mt-1">Efectivo recaudado</span>
            </div>
          </div>

          {/* Metric 4 */}
          <div className="bg-white text-gray-900 rounded-2xl p-3.5 border border-gray-200 shadow-xs flex flex-col justify-between h-24">
            <span className="text-[9px] uppercase font-mono font-bold text-gray-400 tracking-wider">Por Recolectar</span>
            <div>
              <span className="text-sm font-sans font-black block leading-none text-amber-700">
                C$ {totalPendingCs.toLocaleString("es-ES")}
              </span>
              <span className="text-[9px] text-gray-400 block mt-1">USD {totalPendingUsd.toLocaleString("es-ES")} pendiente</span>
            </div>
          </div>
        </div>

        {/* 4. DYNAMIC SEARCH BAR WITH CONTEXTUAL PLACEHOLDER (48px Touch optimized) */}
        <div className="bg-white rounded-2xl border border-gray-200 p-2.5 shadow-xs mb-5">
          <div className="relative">
            <Search className="absolute left-3.5 top-3.5 h-4.5 w-4.5 text-gray-400" />
            <input
              id="supervisor-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === "vendedores" 
                  ? "Buscar vendedor por nombre o nick..." 
                  : activeTab === "arqueos" 
                  ? "Buscar arqueo por nombre..." 
                  : activeTab === "ventas" 
                  ? "Buscar ticket, número o vendedor..." 
                  : "Buscar cobro por vendedor o nota..."
              }
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-10 pr-10 py-3 text-xs font-sans font-semibold text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-indigo-900 focus:bg-white transition-all min-h-[48px]"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 p-1.5 rounded-lg"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            )}
          </div>
        </div>

        {/* Notifications Banners */}
      {errorMessage && (
        <div className="mb-5 p-4 bg-red-100 border-l-4 border-red-600 rounded-xl text-red-900 font-sans text-xs flex items-center space-x-2 shadow-xs">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span className="font-bold">{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="mb-5 p-4 bg-emerald-100 border-l-4 border-emerald-600 rounded-xl text-emerald-900 font-sans text-xs flex items-center space-x-2 shadow-xs">
          <Check className="w-5 h-5 text-emerald-600 shrink-0 stroke-[3]" />
          <span className="font-bold">{successMessage}</span>
        </div>
      )}

      {/* TAB 1: VENDEDORES (VINCULACIÓN) */}
      {activeTab === "vendedores" && (
        <div className="space-y-4 animate-fade-in">
          {/* Segmented controls for SubTabs - 44px touch height */}
          <div className="flex bg-gray-200/60 p-1 rounded-xl mb-4">
            <button
              onClick={() => { setSubTab("equipo"); setSearchQuery(""); }}
              className={`flex-1 py-2.5 text-center rounded-lg text-xs font-bold transition-all min-h-[44px] cursor-pointer ${
                subTab === "equipo" ? "bg-indigo-950 text-white shadow-xs font-black" : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              Mi Equipo ({linkedSellers.length})
            </button>
            <button
              onClick={() => { setSubTab("disponibles"); setSearchQuery(""); }}
              className={`flex-1 py-2.5 text-center rounded-lg text-xs font-bold transition-all min-h-[44px] cursor-pointer ${
                subTab === "disponibles" ? "bg-indigo-950 text-white shadow-xs font-black" : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              Vincular Vendedores ({otherSellers.length})
            </button>
          </div>

          {subTab === "equipo" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredLinkedSellers.length === 0 ? (
                <div className="col-span-full bg-white border border-gray-200 p-8 rounded-2xl text-center text-gray-500 text-xs">
                  {searchQuery ? "No se encontraron vendedores con ese nombre." : "No tienes vendedores vinculados actualmente. Cambia a 'Vincular Vendedores' para asociar."}
                </div>
              ) : (
                filteredLinkedSellers.map(seller => {
                  const summary = getSellerSummary(seller.id);
                  const isOnline = seller.conexion === "online";
                  
                  // Calculate today's sales for this seller
                  const sellerSalesCs = sales.filter(s => s.id_vendedor === seller.id && !s.anulado && s.moneda === "C$").reduce((sum, s) => sum + s.monto_pago, 0);
                  const sellerSalesUsd = sales.filter(s => s.id_vendedor === seller.id && !s.anulado && s.moneda === "USD").reduce((sum, s) => sum + s.monto_pago, 0);

                  return (
                    <div key={seller.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs hover:border-gray-300 transition-all space-y-3">
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          {/* Initials Avatar */}
                          <div className="relative">
                            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center font-display font-black text-sm text-gray-800 uppercase border border-gray-200 shadow-2xs">
                              {seller.nombre.split(" ").map(n => n[0]).join("").substring(0,2).toUpperCase()}
                            </div>
                            {/* Live connection dot with pulse */}
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                              {isOnline && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              )}
                              <span className={`relative inline-flex rounded-full h-3.5 w-3.5 border-2 border-white ${isOnline ? "bg-emerald-500" : "bg-gray-400"}`}></span>
                            </span>
                          </div>

                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <h3 className="font-display font-black text-gray-900 uppercase text-xs tracking-tight">{seller.nombre}</h3>
                              <span className="text-[10px] bg-slate-100 text-gray-700 px-1.5 py-0.5 rounded-md font-bold font-mono">
                                {getFlag(seller.region)} {seller.region || "Nicaragua"}
                              </span>
                            </div>
                            <span className="text-[10px] text-gray-400 font-mono block mt-0.5">@{seller.usuario || seller.email.split("@")[0]}</span>
                          </div>
                        </div>

                        <span className={`text-[9px] font-sans font-black uppercase px-2 py-0.5 rounded-md ${isOnline ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-gray-100 text-gray-400"}`}>
                          {isOnline ? "CONECTADO" : "OFFLINE"}
                        </span>
                      </div>

                      {/* Cumulative Sales Highlighted in Bold */}
                      <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-gray-100">
                          <span className="text-[9px] text-gray-400 font-bold uppercase block">Venta acumulada</span>
                          <span className="font-mono font-black text-gray-900 text-sm block mt-0.5">C$ {sellerSalesCs.toLocaleString("es-ES")}</span>
                          {sellerSalesUsd > 0 && (
                            <span className="font-mono text-gray-500 block text-[10px]">USD {sellerSalesUsd.toLocaleString("es-ES")}</span>
                          )}
                        </div>
                        <div className="bg-slate-50 p-2.5 rounded-xl border border-gray-100">
                          <span className="text-[9px] text-gray-400 font-bold uppercase block">Caja por Liquidar</span>
                          {summary.count > 0 ? (
                            <div>
                              <span className="font-mono font-black text-amber-700 text-sm block mt-0.5">C$ {summary.pendingCs.toLocaleString("es-ES")}</span>
                              <span className="text-[9px] text-amber-600 block font-bold font-sans">{summary.count} cierres pendientes</span>
                            </div>
                          ) : (
                            <span className="text-emerald-700 font-black text-[10px] block mt-2.5 uppercase tracking-wider">✓ CAJA AL DÍA</span>
                          )}
                        </div>
                      </div>

                      {/* Compact Touch Targets optimized for thumb reach */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          onClick={() => {
                            setSelectedSellerForCobro(seller);
                            if (summary.count > 0) {
                              setMontoCobroCs(String(summary.pendingCs));
                              setMontoCobroUsd(String(summary.pendingUsd));
                            } else {
                              setMontoCobroCs("");
                              setMontoCobroUsd("");
                            }
                          }}
                          className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-display font-black text-[11px] uppercase tracking-wider rounded-xl cursor-pointer shadow-xs flex items-center justify-center space-x-1 transition-all"
                        >
                          <DollarSign className="w-4 h-4 stroke-[2.5]" />
                          <span>Arqueo / Cobro</span>
                        </button>
                        <button
                          onClick={() => handleToggleAssociation(seller.id, true)}
                          className="w-full h-12 bg-white hover:bg-red-50 border border-gray-200 hover:border-red-100 text-red-600 font-sans font-bold text-[11px] uppercase tracking-wider rounded-xl cursor-pointer transition-all flex items-center justify-center space-x-1"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Desvincular</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            /* pool of other sellers */
            <div className="space-y-3">
              {filteredOtherSellers.length === 0 ? (
                <div className="bg-white border border-gray-200 p-8 rounded-2xl text-center text-gray-500 text-xs">
                  {searchQuery ? "No se encontraron vendedores adicionales." : "No hay más vendedores disponibles para asociar."}
                </div>
              ) : (
                filteredOtherSellers.map(seller => (
                  <div key={seller.id} className="bg-white border border-gray-200 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-xs">
                    <div>
                      <span className="font-bold text-sm text-gray-900 block">{seller.nombre}</span>
                      <span className="text-[10px] text-gray-500 font-mono block mt-0.5">@{seller.usuario || seller.email.split("@")[0]}</span>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="text-[9px] bg-slate-100 text-gray-700 px-1.5 py-0.5 rounded font-bold font-mono">
                          {getFlag(seller.region)} {seller.region || "Nicaragua"}
                        </span>
                        {seller.id_supervisor && (
                          <span className="text-[9px] text-amber-800 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 font-bold font-sans">
                            Supervisado por: {seller.id_supervisor}
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleAssociation(seller.id, false)}
                      className="w-full sm:w-auto h-12 px-5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer flex items-center justify-center space-x-1.5 active:scale-95 shrink-0"
                    >
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                      <span>Asociar a mi Red</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: ARQUEOS (CIERRES DE CAJA) */}
      {activeTab === "arqueos" && (
        <div className="space-y-4 animate-fade-in">
          {/* Segmented status selector - 44px touch height */}
          <div className="flex bg-gray-200/60 p-1 rounded-xl mb-4">
            <button
              onClick={() => setArqueosFilter("todos")}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-bold transition-all min-h-[44px] cursor-pointer ${
                arqueosFilter === "todos" ? "bg-indigo-950 text-white shadow-xs font-black" : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              Todos ({linkedClosures.length})
            </button>
            <button
              onClick={() => setArqueosFilter("pendientes")}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-bold transition-all min-h-[44px] cursor-pointer ${
                arqueosFilter === "pendientes" ? "bg-indigo-950 text-white shadow-xs font-black" : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              Pendientes ({linkedClosures.filter(c => !c.cobrado).length})
            </button>
            <button
              onClick={() => setArqueosFilter("cobrados")}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-bold transition-all min-h-[44px] cursor-pointer ${
                arqueosFilter === "cobrados" ? "bg-indigo-950 text-white shadow-xs font-black" : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              Cobrados ({linkedClosures.filter(c => c.cobrado).length})
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {searchedClosures.length === 0 ? (
              <div className="col-span-full bg-white border border-gray-200 p-8 rounded-2xl text-center text-gray-500 text-xs">
                {searchQuery ? "No se encontraron arqueos con ese criterio." : "No hay cierres de caja registrados en esta categoría."}
              </div>
            ) : (
              searchedClosures.map(c => {
                const hasDiscrepancy = c.descuadre_cs !== 0 || c.descuadre_usd !== 0;
                return (
                  <div key={c.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xs relative border-b-4 border-b-indigo-950 flex flex-col justify-between">
                    {/* Top colored status stripe */}
                    <div className={`h-1.5 ${c.cobrado ? "bg-emerald-500" : "bg-amber-500"}`} />
                    
                    <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                      <div>
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-display font-black text-gray-900 uppercase text-xs tracking-tight">{c.nombre_vendedor}</h4>
                            <span className="text-[9px] text-gray-400 font-mono block mt-0.5">ID Vendedor: {c.id_vendedor}</span>
                          </div>
                          
                          <span className={`text-[9px] font-sans font-black uppercase px-2.5 py-1 rounded-md border ${
                            c.cobrado 
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200" 
                              : "bg-amber-50 text-amber-800 border-amber-200"
                          }`}>
                            {c.cobrado ? "COBRADO" : "PENDIENTE"}
                          </span>
                        </div>

                        {/* Comparative grid - Receipt Style */}
                        <div className="border-t border-dashed border-gray-200 pt-3 grid grid-cols-2 gap-3 text-xs">
                          <div>
                            <span className="text-[9px] text-gray-400 font-bold uppercase block">Declarado en Caja</span>
                            <span className="font-mono font-black text-indigo-950 text-sm block mt-0.5">C$ {c.monto_entregado_cs.toFixed(2)}</span>
                            {c.monto_entregado_usd > 0 && (
                              <span className="font-mono text-gray-500 text-[10px] block">USD {c.monto_entregado_usd.toFixed(2)}</span>
                            )}
                          </div>
                          <div>
                            <span className="text-[9px] text-gray-400 font-bold uppercase block">Saldos de Sistema</span>
                            <span className="font-mono font-bold text-gray-700 text-sm block mt-0.5">C$ {c.monto_sistema_cs.toFixed(2)}</span>
                            {c.monto_sistema_usd > 0 && (
                              <span className="font-mono text-gray-400 text-[10px] block">USD {c.monto_sistema_usd.toFixed(2)}</span>
                            )}
                          </div>
                        </div>

                        {/* Balance Results */}
                        <div className="border-t border-gray-100 pt-3 mt-2">
                          {hasDiscrepancy ? (
                            <div className="bg-red-50 border border-red-100 rounded-xl p-2.5 text-xs">
                              <span className="text-[9px] text-[#EF4444] font-black uppercase tracking-wider block mb-1">DISCREPANCIA / DESFASE ⚠️</span>
                              <div className="flex justify-between font-mono font-black text-[#EF4444]">
                                <span>Diferencia C$:</span>
                                <span>{c.descuadre_cs > 0 ? "+" : ""}{c.descuadre_cs.toFixed(2)}</span>
                              </div>
                              {c.descuadre_usd !== 0 && (
                                <div className="flex justify-between font-mono font-black text-[#EF4444] mt-0.5">
                                  <span>Diferencia USD:</span>
                                  <span>{c.descuadre_usd > 0 ? "+" : ""}{c.descuadre_usd.toFixed(2)}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 text-center text-emerald-800 text-[10px] font-black uppercase tracking-wider">
                              ✓ Caja Cuadrada Perfectamente
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Footer Info */}
                      <div className="flex justify-between items-center text-[9px] text-gray-400 font-mono pt-3 border-t border-gray-100 mt-2 shrink-0">
                        <span>{c.fecha}</span>
                        <span>{formatTo12HourTime(c.timestamp)}</span>
                      </div>

                      {/* thumb-friendly primary collect action */}
                      {!c.cobrado && (
                        <button
                          onClick={() => {
                            const matchedV = users.find(u => u.id === c.id_vendedor);
                            if (matchedV) {
                              setSelectedSellerForCobro(matchedV);
                              setMontoCobroCs(String(c.monto_entregado_cs));
                              setMontoCobroUsd(String(c.monto_entregado_usd));
                            }
                          }}
                          className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-display font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer transition-all flex items-center justify-center space-x-1.5 shadow-sm mt-3"
                        >
                          <DollarSign className="w-4.5 h-4.5 stroke-[2.5]" />
                          <span>Cobrar este Arqueo</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: MONITOREO DE VENTAS */}
      {activeTab === "ventas" && (
        <div className="space-y-4 animate-fade-in">
          {/* Segmented status filter */}
          <div className="flex bg-gray-200/60 p-1 rounded-xl mb-4">
            <button
              onClick={() => setMonitoreoFilter("todos")}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-bold transition-all min-h-[44px] cursor-pointer ${
                monitoreoFilter === "todos" ? "bg-indigo-950 text-white shadow-xs font-black" : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              Todas ({linkedSales.length})
            </button>
            <button
              onClick={() => setMonitoreoFilter("validos")}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-bold transition-all min-h-[44px] cursor-pointer ${
                monitoreoFilter === "validos" ? "bg-indigo-950 text-white shadow-xs font-black" : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              Válidas ({linkedSales.filter(s => !s.anulado).length})
            </button>
            <button
              onClick={() => setMonitoreoFilter("anulados")}
              className={`flex-1 py-2 text-center rounded-lg text-xs font-bold transition-all min-h-[44px] cursor-pointer ${
                monitoreoFilter === "anulados" ? "bg-indigo-950 text-white shadow-xs font-black" : "text-gray-600 hover:bg-gray-200"
              }`}
            >
              Anuladas ({linkedSales.filter(s => s.anulado).length})
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {searchedSales.length === 0 ? (
              <div className="col-span-full bg-white border border-gray-200 p-8 rounded-2xl text-center text-gray-500 text-xs">
                {searchQuery ? "No se encontraron boletos con ese criterio." : "No hay transacciones registradas de sus vendedores hoy."}
              </div>
            ) : (
              searchedSales.map(sale => (
                <div key={sale.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-xs relative overflow-hidden flex items-center space-x-3.5 hover:border-gray-300 transition-all">
                  
                  {/* Left Big Number display circle (Android style) */}
                  <div className={`w-14 h-14 rounded-2xl flex flex-col items-center justify-center shrink-0 border shadow-2xs ${
                    sale.anulado 
                      ? "bg-red-50 border-red-100 text-red-500" 
                      : "bg-indigo-50 border-indigo-100 text-indigo-950"
                  }`}>
                    <span className="text-lg font-mono font-black tracking-tight">{sale.numero_jugado}</span>
                    <span className="text-[8px] uppercase font-mono tracking-wider font-bold leading-none mt-0.5">JUGADO</span>
                  </div>

                  {/* Right Details */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="text-[10px] text-gray-400 font-mono block">Ticket: {sale.numero_ticket}</span>
                        <span className="font-display font-black text-gray-900 text-xs block uppercase tracking-tight mt-0.5">{sale.juego}</span>
                      </div>

                      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${
                        sale.anulado 
                          ? "bg-red-50 text-red-800 border-red-200" 
                          : "bg-emerald-50 text-emerald-800 border-emerald-200"
                      }`}>
                        {sale.anulado ? "ANULADO" : "VÁLIDO"}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs pt-1">
                      <div>
                        <span className="text-[9px] text-gray-400 uppercase font-bold block">Vendedor</span>
                        <span className="font-bold text-gray-700 uppercase tracking-tight text-[11px] block">{sale.nombre_vendedor}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] text-gray-400 uppercase font-bold block">Monto</span>
                        <span className="font-mono font-black text-gray-950 text-sm block">
                          {sale.moneda} {sale.monto_pago.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[9px] text-gray-400 font-mono border-t border-gray-100 pt-1.5 mt-1.5">
                      <span>Sorteo: <strong className="text-indigo-900 uppercase">{sale.sorteo}</strong></span>
                      <span>{formatTo12HourTime(sale.timestamp_servidor)}</span>
                    </div>

                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: HISTORIAL DE COBROS */}
      {activeTab === "cobros" && (
        <div className="space-y-4 animate-fade-in">
          <div className="space-y-3">
            {searchedCobros.length === 0 ? (
              <div className="bg-white border border-gray-200 p-8 rounded-2xl text-center text-gray-500 text-xs">
                {searchQuery ? "No se encontraron cobros." : "No has registrado cobros ni retiros todavía."}
              </div>
            ) : (
              searchedCobros.map(cob => (
                <div key={cob.id} className="bg-white border border-gray-200 p-4 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-xs border-l-4 border-l-emerald-500 hover:border-gray-300 transition-all">
                  <div className="space-y-1">
                    <span className="inline-block text-[9px] bg-emerald-50 border border-emerald-200 text-emerald-800 px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider">
                      ✓ RETIRO COMPLETADO
                    </span>
                    <h3 className="text-xs font-display font-black text-gray-900 uppercase mt-1">Vendedor: {cob.nombre_vendedor}</h3>
                    {cob.comentario && (
                      <p className="text-xs text-gray-500 bg-slate-50 p-2 rounded-xl border border-gray-100 italic mt-1 font-sans">
                        "{cob.comentario}"
                      </p>
                    )}
                    <span className="text-[9px] text-gray-400 font-mono block pt-1">
                      {new Date(cob.timestamp).toLocaleDateString("es-ES")} {formatTo12HourTime(cob.timestamp)}
                    </span>
                  </div>

                  <div className="font-mono font-black text-indigo-950 sm:text-right w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0 shrink-0">
                    <div className="text-base">C$ {cob.monto_cs.toFixed(2)}</div>
                    {cob.monto_usd > 0 && <div className="text-[11px] text-gray-500">USD {cob.monto_usd.toFixed(2)}</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      </div>

      {/* Bottom Navigation Bar inside the container matching VendedorInterface style */}
      <div className="bg-white border-t border-gray-300 py-1.5 px-4 flex justify-between items-center z-10 shrink-0">
        
        {/* Nav Link 1 */}
        <button
          onClick={() => {
            setActiveTab("vendedores");
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 min-h-[48px] text-center transition-all cursor-pointer ${
            activeTab === "vendedores" 
              ? "text-[#1E3A8A] scale-105" 
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <Users className={`w-6 h-6 stroke-[2.5] ${activeTab === "vendedores" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[10px] font-display font-black uppercase tracking-wider mt-0.5">Vendedores</span>
        </button>

        {/* Nav Link 2 */}
        <button
          onClick={() => {
            setActiveTab("arqueos");
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 min-h-[48px] text-center transition-all cursor-pointer ${
            activeTab === "arqueos" 
              ? "text-[#1E3A8A] scale-105" 
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <FileText className={`w-6 h-6 stroke-[2.5] ${activeTab === "arqueos" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[10px] font-display font-black uppercase tracking-wider mt-0.5">Arqueos</span>
        </button>

        {/* Nav Link 3 */}
        <button
          onClick={() => {
            setActiveTab("ventas");
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 min-h-[48px] text-center transition-all cursor-pointer ${
            activeTab === "ventas" 
              ? "text-[#1E3A8A] scale-105" 
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <Activity className={`w-6 h-6 stroke-[2.5] ${activeTab === "ventas" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[10px] font-display font-black uppercase tracking-wider mt-0.5">Monitoreo</span>
        </button>

        {/* Nav Link 4 */}
        <button
          onClick={() => {
            setActiveTab("cobros");
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          className={`flex flex-col items-center justify-center flex-1 py-1 px-1 min-h-[48px] text-center transition-all cursor-pointer ${
            activeTab === "cobros" 
              ? "text-[#1E3A8A] scale-105" 
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          <DollarSign className={`w-6 h-6 stroke-[2.5] ${activeTab === "cobros" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[10px] font-display font-black uppercase tracking-wider mt-0.5">Cobros</span>
        </button>

      </div>

      {/* MODAL COBRO RETIRO DE EFECTIVO (RE-STYLED TO PREMIUM NATIVE BOTTOM SHEET / MODAL) */}
      {selectedSellerForCobro && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-200 max-h-[92vh] flex flex-col transition-all duration-300">
            {/* Top Drag Indicator for Bottom Sheet on mobile */}
            <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto my-3 sm:hidden" />

            <div className="bg-indigo-950 text-white px-6 py-4 flex justify-between items-center shrink-0">
              <div>
                <span className="text-[9px] uppercase font-mono tracking-widest font-bold opacity-85">Procesar Recolecta / Cobro</span>
                <h3 className="font-display font-black text-base uppercase tracking-tight">Retirar Caja a Vendedor</h3>
              </div>
              <button 
                onClick={() => setSelectedSellerForCobro(null)}
                className="text-white hover:text-gray-200 w-11 h-11 flex items-center justify-center rounded-full hover:bg-white/10 cursor-pointer transition-all shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRegisterCobro} className="p-6 space-y-4 overflow-y-auto flex-1 text-left">
              <div>
                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Vendedor a Liquidar</label>
                <span className="block text-xs font-black text-gray-950 uppercase tracking-tight mt-1 bg-slate-50 p-3 rounded-xl border border-gray-200 font-sans">
                  {selectedSellerForCobro.nombre}
                </span>
              </div>

              {/* Outstanding debt suggestion info with quick fill trigger */}
              {(() => {
                const sSummary = getSellerSummary(selectedSellerForCobro.id);
                return (
                  <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-xs text-amber-900 space-y-2">
                    <span className="font-black uppercase text-[10px] tracking-wider block text-amber-800">Cierre de Caja Sugerido</span>
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-sm">
                        C$ {sSummary.pendingCs.toFixed(2)} • USD {sSummary.pendingUsd.toFixed(2)}
                      </span>
                    </div>

                    {/* Quick fill buttons */}
                    {sSummary.count > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {sSummary.pendingCs > 0 && (
                          <button
                            type="button"
                            onClick={() => setMontoCobroCs(String(sSummary.pendingCs))}
                            className="px-3 min-h-[44px] flex items-center justify-center bg-white border border-amber-300 rounded-xl text-[10px] font-bold text-amber-800 hover:bg-amber-100 transition-all cursor-pointer shadow-2xs"
                          >
                            Rellenar C$ {sSummary.pendingCs}
                          </button>
                        )}
                        {sSummary.pendingUsd > 0 && (
                          <button
                            type="button"
                            onClick={() => setMontoCobroUsd(String(sSummary.pendingUsd))}
                            className="px-3 min-h-[44px] flex items-center justify-center bg-white border border-amber-300 rounded-xl text-[10px] font-bold text-amber-800 hover:bg-amber-100 transition-all cursor-pointer shadow-2xs"
                          >
                            Rellenar USD {sSummary.pendingUsd}
                          </button>
                        )}
                      </div>
                    )}

                    <span className="block text-[9px] text-amber-700 leading-tight">
                      * Al registrar este retiro, todos los arqueos de este vendedor se marcarán automáticamente como cobrados/liquidados.
                    </span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Monto C$ *</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={montoCobroCs}
                    onChange={(e) => setMontoCobroCs(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border border-gray-300 rounded-xl px-3.5 py-3 font-mono text-xs focus:outline-none focus:border-indigo-900 focus:bg-white min-h-[48px]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Monto USD</label>
                  <input
                    type="number"
                    step="any"
                    value={montoCobroUsd}
                    onChange={(e) => setMontoCobroUsd(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border border-gray-300 rounded-xl px-3.5 py-3 font-mono text-xs focus:outline-none focus:border-indigo-900 focus:bg-white min-h-[48px]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Comentario o Nota</label>
                <textarea
                  value={comentarioCobro}
                  onChange={(e) => setComentarioCobro(e.target.value)}
                  placeholder="Ej: Retiro vespertino de boletos, cuadre conforme."
                  className="w-full bg-slate-50 border border-gray-300 rounded-xl px-3.5 py-2.5 text-xs focus:outline-none focus:border-indigo-900 focus:bg-white min-h-[70px]"
                  rows={2}
                />
              </div>

              {/* Touch optimized big actions */}
              <div className="flex flex-col gap-2 pt-2 pb-safe">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 text-white font-display font-black uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer text-xs flex items-center justify-center space-x-2"
                >
                  <CheckCircle className="w-5 h-5 shrink-0 stroke-[2.5]" />
                  <span>{loading ? "PROCESANDO RETIRO..." : "GUARDAR RETIRO Y LIQUIDAR"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedSellerForCobro(null)}
                  className="w-full h-12 bg-gray-100 hover:bg-gray-200 text-gray-700 font-sans font-bold uppercase tracking-wider rounded-xl transition-all cursor-pointer text-xs text-center border border-gray-300"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
