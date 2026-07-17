import { useState, useEffect, FormEvent, useMemo } from "react";
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, serverTimestamp, onSnapshot, where, limit } from "firebase/firestore";
import { firestore } from "../lib/firebase";
import { 
  LayoutDashboard, 
  Users, 
  Settings, 
  Briefcase, 
  RefreshCw, 
  DollarSign, 
  FileText, 
  Sliders, 
  UserPlus, 
  ShieldAlert, 
  CheckCircle, 
  TrendingUp, 
  TrendingDown, 
  AlertCircle,
  Bell,
  Clock,
  Unlock,
  Lock,
  Plus,
  Trash2,
  Search,
  QrCode,
  Edit2,
  Check,
  User,
  Filter,
  Link,
  X,
  Shield,
  MapPin,
  Globe,
  Menu,
  Eye,
  EyeOff
} from "lucide-react";
import { Usuario, Configuracion, Venta, CierreCaja, Sorteo } from "../types";
import { toDateStr, getTicketDate, getLocalTodayStr, getNicaraguaISOString, parseISOTimeParts, getNicaraguaNow } from "../lib/date-utils";

import { useFacturacion } from "../hooks/useFacturacion";
import { createPortal } from "react-dom";
import { jsPDF } from "jspdf";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import TicketPreviewModal from "./TicketPreviewModal";
import { QrScannerModal } from "./QrScannerModal";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from "recharts";

// Helper to format 24h string to standard AM/PM format
const formatTo12Hour = (time24: string): string => {
  if (!time24) return "";
  const parts = time24.split(":");
  if (parts.length < 2) return time24;
  let hour = parseInt(parts[0], 10);
  const min = parts[1];
  if (isNaN(hour)) return time24;
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  const hourStr = String(hour).padStart(2, "0");
  return `${hourStr}:${min} ${ampm}`;
};


const formatTo12HourTime = (dateInput: Date | string | number, includeSeconds: boolean = true): string => {
  try {
    const isoStr = typeof dateInput === "string" ? dateInput : 
                   dateInput instanceof Date ? getNicaraguaISOString(dateInput) : String(dateInput);
    
    // For ISO strings from server (with -06:00 offset), parse directly to avoid timezone drift
    if (typeof isoStr === "string" && isoStr.includes("T")) {
      const { hours, minutes, seconds } = (() => {
        try {
          const m = isoStr.match(/T(\d{2}):(\d{2}):(\d{2})/);
          if (m) return { hours: parseInt(m[1], 10), minutes: parseInt(m[2], 10), seconds: parseInt(m[3], 10) };
        } catch { /* fallback */ }
        const d = new Date(isoStr);
        return { hours: d.getHours(), minutes: d.getMinutes(), seconds: d.getSeconds() };
      })();
      
      const ampm = hours >= 12 ? "PM" : "AM";
      let h12 = hours % 12;
      if (h12 === 0) h12 = 12;
      const hStr = String(h12).padStart(2, "0");
      const mStr = String(minutes).padStart(2, "0");
      
      if (includeSeconds) {
        return `${hStr}:${mStr}:${String(seconds).padStart(2, "0")} ${ampm}`;
      }
      return `${hStr}:${mStr} ${ampm}`;
    }
    
    // Fallback for non-ISO inputs
    const date = typeof dateInput === "object" ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return String(dateInput);
    
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
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

const getCountryFromSorteo = (nombre: string): string => {
  if (nombre.includes("(NI)")) return "Nicaragua";
  if (nombre.includes("(HN)")) return "Honduras";
  if (nombre.includes("(SV)")) return "El Salvador";
  if (nombre.includes("(LP)")) return "La Primera";
  if (nombre.includes("(CR)")) return "Costa Rica";
  const n = nombre.toLowerCase();
  if (n.includes("nicaragua")) return "Nicaragua";
  if (n.includes("honduras")) return "Honduras";
  if (n.includes("salvador")) return "El Salvador";
  if (n.includes("primera")) return "La Primera";
  if (n.includes("costa rica") || n.includes("tica")) return "Costa Rica";
  return "Nicaragua";
};

interface AdminInterfaceProps {
  user: Usuario;
  config: Configuracion;
  onRefreshConfig: () => Promise<void>;
  onRefreshSales: () => Promise<void>;
  onRefreshUsers: () => Promise<void>;
  users: Usuario[];
  sales: Venta[];
  closures: CierreCaja[];
  onUpdateConfig: (newConfig: Partial<Configuracion>) => Promise<boolean>;
  onUpdateUser: (userId: string, updates: Partial<Usuario>) => Promise<boolean>;
  onCreateUser: (newUser: any) => Promise<{ success: boolean; error: string | null }>;
  onDeleteUser: (userId: string) => Promise<boolean>;
  simulatedSupervisorId?: string;
}

export default function AdminInterface({
  user,
  config,
  onRefreshConfig,
  onRefreshSales,
  onRefreshUsers,
  users,
  sales,
  closures,
  onUpdateConfig,
  onUpdateUser,
  onCreateUser,
  onDeleteUser,
  simulatedSupervisorId
}: AdminInterfaceProps) {
  const [activeSection, setActiveSection] = useState<"dashboard" | "cierres" | "config" | "usuarios" | "resultados" | "limites" | "reportes" | "finanzas" | "buscador">("dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Local form states
  const [exchangeRateInput, setExchangeRateInput] = useState(String(config.tasa_cambio));
  const [ticketTitleInput, setTicketTitleInput] = useState(config.formato_ticket.titulo);
  const [ticketRucInput, setTicketRucInput] = useState(
    config.formato_ticket.ruc === "RUC-J0310000123456" || config.formato_ticket.ruc.includes("RUC")
      ? "pida su ticket en su compra."
      : config.formato_ticket.ruc
  );
  const [ticketFooterInput, setTicketFooterInput] = useState(config.formato_ticket.mensaje_pie);

  // Advanced User CRUD states
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Usuario | null>(null);
  
  const [userFormName, setUserFormName] = useState("");
  const [userFormEmail, setUserFormEmail] = useState("");
  const [userFormUsername, setUserFormUsername] = useState("");
  const [userFormPassword, setUserFormPassword] = useState("");
  const [showUserFormPassword, setShowUserFormPassword] = useState(false);
  const [userFormRole, setUserFormRole] = useState<"vendedor" | "administrador" | "supervisor">("vendedor");
  const [userFormStatus, setUserFormStatus] = useState<"activo" | "inactivo">("activo");
  const [userFormRegion, setUserFormRegion] = useState<"Nicaragua" | "Costa Rica" | "Honduras" | "El Salvador">("Nicaragua");
  const [userFormVendedoresAsignados, setUserFormVendedoresAsignados] = useState<string[]>([]);

  // Filtering
  const [userFilterRole, setUserFilterRole] = useState<string>("TODOS");
  const [userFilterRegion, setUserFilterRegion] = useState<string>("TODOS");

  // Deletion Custom Modal
  const [deletingUser, setDeletingUser] = useState<Usuario | null>(null);

  // Supervisor Assignment Interactive Panel
  const [selectedSupervisorForAssignment, setSelectedSupervisorForAssignment] = useState<Usuario | null>(null);

  // New Sorteo form
  const [newSorteoPais, setNewSorteoPais] = useState("Nicaragua");
  const [newSorteoJuego, setNewSorteoJuego] = useState("Diaria");
  const [newSorteoNombre, setNewSorteoNombre] = useState("");
  const [newSorteoHourDraw, setNewSorteoHourDraw] = useState("11");
  const [newSorteoMinDraw, setNewSorteoMinDraw] = useState("00");
  const [newSorteoAmPmDraw, setNewSorteoAmPmDraw] = useState("AM");
  const [newSorteoHourCierre, setNewSorteoHourCierre] = useState("10");
  const [newSorteoMinCierre, setNewSorteoMinCierre] = useState("55");
  const [newSorteoAmPmCierre, setNewSorteoAmPmCierre] = useState("AM");
  const [newSorteoDias, setNewSorteoDias] = useState<number[]>([]);
  const [sorteoEditando, setSorteoEditando] = useState<any>(null);

  // Results (Resultados) Section States
  const [resultsList, setResultsList] = useState<any[]>([]);
  const [selectedPaisResultados, setSelectedPaisResultados] = useState("Nicaragua");
  const [selectedSorteoResultados, setSelectedSorteoResultados] = useState("");
  const [winningNumberInput, setWinningNumberInput] = useState("");
  const [resultFechasDia, setResultFechasDia] = useState("01");
  const [resultFechasMes, setResultFechasMes] = useState("Enero");
  const [fechaResultadosInput, setFechaResultadosInput] = useState(getLocalTodayStr());
  const [resultadoEditando, setResultadoEditando] = useState<any>(null);

  // Limits (Límites) Section States
  const [limitsList, setLimitsList] = useState<any[]>([]);
  const [selectedVendedorLimite, setSelectedVendedorLimite] = useState("TODOS");
  const [selectedPaisLimite, setSelectedPaisLimite] = useState("TODOS");
  const [selectedJuegoLimite, setSelectedJuegoLimite] = useState("TODOS");
  const [selectedSorteoLimite, setSelectedSorteoLimite] = useState("TODOS");
  const [numeroLimiteInput, setNumeroLimiteInput] = useState("");
  const [limiteDineroInput, setLimiteDineroInput] = useState("");
  const [selectedHoraLimite, setSelectedHoraLimite] = useState("TODOS");
  const [editingLimitId, setEditingLimitId] = useState<string | null>(null);

  // Optimized Ticket Search States
  const [searchSellerId, setSearchSellerId] = useState("TODOS");
  const [searchStartDate, setSearchStartDate] = useState(getLocalTodayStr());
  const [searchEndDate, setSearchEndDate] = useState(getLocalTodayStr());
  const [searchTicketQuery, setSearchTicketQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Reports (Reportes) Section States
  const [reportFilterVendedor, setReportFilterVendedor] = useState("TODOS");
  const [reportFilterFechaInicio, setReportFilterFechaInicio] = useState(getLocalTodayStr());
  const [reportFilterFechaFin, setReportFilterFechaFin] = useState(getLocalTodayStr());
  const vendedoresReporte = useMemo(() => users.filter(u => u.rol === "vendedor"), [users]);
  const facturacionData = useFacturacion(
    vendedoresReporte,
    reportFilterFechaInicio,
    reportFilterFechaFin,
    sales,
    config,
    config.cobros || []
  );

  // Finanzas / Cobros states
  const [finanzasVendedor, setFinanzasVendedor] = useState("");
  const [finanzasFechaInicio, setFinanzasFechaInicio] = useState(getLocalTodayStr());
  const [finanzasFechaFin, setFinanzasFechaFin] = useState(getLocalTodayStr());
  const [finanzasResumenes, setFinanzasResumenes] = useState<any[]>([]);
  const [finanzasMensajeInfo, setFinanzasMensajeInfo] = useState("");
  const [finanzasLoading, setFinanzasLoading] = useState(false);
  const [showCobroModal, setShowCobroModal] = useState(false);
  
  // Finanzas / Pagos Comision states
  const [comisionVendedor, setComisionVendedor] = useState("");
  const [comisionMonto, setComisionMonto] = useState("");
  const [comisionConcepto, setComisionConcepto] = useState("Pago de comisión por ventas");
  const [comisionLoading, setComisionLoading] = useState(false);
  const [lastCobroId, setLastCobroId] = useState("");
  const [historialCobros, setHistorialCobros] = useState<any[]>([]);

  // Fetch lists
  // Real-time Firestore listener for resultados (handles added/modified/removed)
  useEffect(() => {
    const q = query(collection(firestore, "resultados"), orderBy("timestamp", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let changed = false;
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added" || change.type === "modified" || change.type === "removed") {
          changed = true;
        }
      });
      if (changed) {
        const data = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setResultsList(data);
      }
    }, (err) => {
      console.error("[onSnapshot resultados] Error:", err);
    });
    return () => unsubscribe();
  }, []);


  const fetchHistorialCobros = async () => {
    try {
      const res = await fetch("/api/cobros");
      if (res.ok) {
        const data = await res.json();
        setHistorialCobros(data);
      }
    } catch (e) {
      console.error("Error loading historial", e);
    }
  };

  useEffect(() => {
    if (activeSection === "finanzas") {
      fetchHistorialCobros();
    }
  }, [activeSection]);

  const handleAnularCobro = async (id: string) => {
    if (!window.confirm("ATENCIÓN: ¿Estás completamente seguro de anular este cobro? Esto revertirá los balances y cancelará comisiones pagadas.")) return;
    try {
      const res = await fetch(`/api/cobros/${id}/anular`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Cobro anulado. Se revirtieron ${data.resumenes_revertidos} días y ${data.comisiones_anuladas} pagos de comisión.`);
      fetchHistorialCobros();
    } catch (e: any) {
      toast.error(e.message || "Error al anular cobro");
    }
  };
  const handleAnularTicket = async (ticketId: string) => {
    if (!window.confirm("¿Está seguro que desea anular este ticket? Esta acción es irreversible.")) {
      return;
    }
    try {
      const res = await fetch(`/api/ventas/${ticketId}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userRole: "administrador" })
      });
      if (res.ok) {
        toast.success("Ticket anulado correctamente.");
        setActiveTicket(null);
        await onRefreshSales();
      } else {
        const errData = await res.json();
        toast.error(errData.error || "Error al anular el ticket.");
      }
    } catch (err) {
      toast.error("Error de red al anular el ticket.");
    }
  };

  const handleExecuteSearch = async (e: FormEvent) => {
    e.preventDefault();
    setAlertText(null);
    setSuccessText(null);

    const userRoleStr = user.rol as string;
    const canAccessSearch = userRoleStr === "admin" || userRoleStr === "admin_1" || userRoleStr === "administrador";
    if (!canAccessSearch) {
      setAlertText("Acceso Denegado: Su rol no cuenta con permisos para buscar boletos.");
      return;
    }

    setSearchLoading(true);
    try {
      // 1. Build optimized Firestore query
      const ticketsRef = collection(firestore, "tickets");
      const conditions: any[] = [
        where("fecha_venta", ">=", searchStartDate),
        where("fecha_venta", "<=", searchEndDate)
      ];

      if (searchSellerId !== "TODOS") {
        conditions.push(where("id_vendedor", "==", searchSellerId));
      }

      // Query with limit to avoid overloading client-side rendering
      const q = query(ticketsRef, ...conditions, limit(500));
      const querySnapshot = await getDocs(q);

      const rawTickets: any[] = [];
      querySnapshot.forEach((docSnap) => {
        rawTickets.push({
          id: docSnap.id,
          ...docSnap.data()
        });
      });

      // 2. Perform stitch (combine with real name of the seller) and search query string filter (stitch local)
      const queryClean = searchTicketQuery.trim().toLowerCase();
      const processedResults = rawTickets
        .map((t) => {
          const matchedSeller = users.find((u) => u.id === t.id_vendedor);
          return {
            ...t,
            nombre_vendedor: matchedSeller ? matchedSeller.nombre : (t.nombre_vendedor || "Vendedor")
          };
        })
        .filter((t) => {
          if (!queryClean) return true;
          const numTicket = (t.numero_ticket || "").toLowerCase();
          const ticketId = (t.id || "").toLowerCase();
          return numTicket.includes(queryClean) || ticketId.includes(queryClean);
        });

      setSearchResults(processedResults);
      if (processedResults.length === 0) {
        setSuccessText("No se encontraron resultados para la búsqueda actual.");
      } else {
        setSuccessText(`Se encontraron ${processedResults.length} resultados.`);
      }
    } catch (err: any) {
      console.error("Error al buscar tickets:", err);
      setAlertText(err.message || "Error al consultar la base de datos.");
    } finally {
      setSearchLoading(false);
    }
  };


  const handleBackfill = async () => {
    if (!window.confirm("¿Ejecutar migración de ventas históricas? (Backfill)")) return;
    try {
      const res = await fetch("/api/admin/backfill-resumenes", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_status: "pagado" }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
    } catch (e: any) {
      toast.error(e.message || "Error al ejecutar migración");
    }
  };

  const fetchLimitsList = async () => {
    try {
      const res = await fetch("/api/limites-numeros");
      if (res.ok) {
        const data = await res.json();
        setLimitsList(data);
      }
    } catch (e) {
      console.error("Error loading limits", e);
    }
  };

  // Finanzas Functions
  const handleConsultarBalance = async () => {
    if (!finanzasVendedor) {
      toast.error("Seleccione un vendedor primero");
      return;
    }
    setFinanzasLoading(true);
    setFinanzasMensajeInfo("");
    setFinanzasResumenes([]);
    try {
      const res = await fetch(`/api/resumen-diario/pendientes?id_vendedor=${finanzasVendedor}&fecha_inicio=${finanzasFechaInicio}&fecha_fin=${finanzasFechaFin}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error");
      setFinanzasResumenes(data.resumenes || []);
      setFinanzasMensajeInfo(data.mensaje || "");
    } catch (e: any) {
      toast.error(e.message || "Error al consultar balance");
    } finally {
      setFinanzasLoading(false);
    }
  };

  const handleAplicarCobro = async () => {
    setFinanzasLoading(true);
    try {
      const totalVendido = finanzasResumenes.reduce((acc, r) => acc + r.vendido, 0);
      const totalPagado = finanzasResumenes.reduce((acc, r) => acc + r.pagado, 0);
      const totalNeto = totalVendido - totalPagado;

      const res = await fetch("/api/cobros/procesar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_admin: user.id,
          id_vendedor: finanzasVendedor,
          rango_inicio: finanzasFechaInicio,
          rango_fin: finanzasFechaFin,
          dias_cerrados: finanzasResumenes,
          total_vendido: totalVendido,
          total_pagado: totalPagado,
          total_neto: totalNeto
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Cobro aplicado exitosamente");
      setShowCobroModal(false);
      setFinanzasResumenes([]); // Reset UI
      setFinanzasMensajeInfo("Cobro procesado correctamente. Caja saldada.");
      
      // Auto-fill commission module with 10%
      setComisionVendedor(finanzasVendedor);
      setComisionMonto((totalVendido * 0.10).toFixed(2));
    } catch (e: any) {
      toast.error(e.message || "Error al aplicar cobro");
    } finally {
      setFinanzasLoading(false);
    }
  };

  const handleRegistrarPago = async () => {
    if (!comisionVendedor || !comisionMonto) {
      toast.error("Complete los campos de comisión");
      return;
    }
    setComisionLoading(true);
    try {
      const res = await fetch("/api/pagos/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_admin: user.id,
          id_vendedor: comisionVendedor,
          monto_pago: parseFloat(comisionMonto),
          concepto: comisionConcepto,
          id_cobro_relacionado: lastCobroId
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Pago de comisión registrado");
      setLastCobroId("");
      setComisionMonto("");
    } catch (e: any) {
      toast.error(e.message || "Error al registrar pago");
    } finally {
      setComisionLoading(false);
    }
  };

  useEffect(() => {
    fetchLimitsList();
  }, []);

  useEffect(() => {
    const PAISES_GAMES: Record<string, string[]> = {
      Nicaragua: ["Diaria", "Fechas", "Jugá 3", "Premia2", "Terminación 2", "Sabadito"],
      Honduras: ["La Diaria", "Premia2", "Pega 3", "Súper Premio"],
      "El Salvador": ["Diaria"],
      "La Primera": ["La Primera"],
      "Costa Rica": ["3 Monazos", "Tica"]
    };
    const games = PAISES_GAMES[newSorteoPais] || [];
    if (games.length > 0 && !games.includes(newSorteoJuego)) {
      setNewSorteoJuego(games[0]);
    }
  }, [newSorteoPais]);

  // Ticket QR/ID Search states for Admin Dashboard
  const [activeTicket, setActiveTicket] = useState<Venta | null>(null);
  const [qrSearchInput, setQrSearchInput] = useState("");
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [qrSearchError, setQrSearchError] = useState<string | null>(null);

  const handleTicketQrSearch = (e: FormEvent) => {
    e.preventDefault();
    setQrSearchError(null);
    const query = qrSearchInput.trim();
    if (!query) return;

    let targetNum = query;
    let targetFirma = "";

    // Parse URL verification pattern if scanned or pasted:
    // https://lanuevaera.net/verificar?ticket=00001&firma=ABC
    if (query.includes("ticket=")) {
      try {
        const urlObj = new URL(query);
        const ticketParam = urlObj.searchParams.get("ticket");
        const firmaParam = urlObj.searchParams.get("firma");
        if (ticketParam) targetNum = ticketParam;
        if (firmaParam) targetFirma = firmaParam;
      } catch (err) {
        const tMatch = query.match(/[?&]ticket=([^&]+)/);
        const fMatch = query.match(/[?&]firma=([^&]+)/);
        if (tMatch) targetNum = tMatch[1];
        if (fMatch) targetFirma = fMatch[1];
      }
    }

    const cleanNum = targetNum.replace(/^#/, "").trim();

    // Look up in global sales list
    const found = sales.find(s => 
      s.id === cleanNum || 
      s.numero_ticket === cleanNum ||
      s.numero_ticket === targetNum ||
      (s.firma_digital && s.firma_digital.toUpperCase() === cleanNum.toUpperCase()) ||
      (targetFirma && s.firma_digital && s.firma_digital.toUpperCase() === targetFirma.toUpperCase())
    );

    if (found) {
      setActiveTicket(found);
      setQrSearchInput("");
    } else {
      setQrSearchError(`No se encontró ningún ticket con ID, número o firma: "${query}"`);
    }
  };

  // Feedback notifications
  const alertText = null;
  const setAlertText = (text: string | null) => { if (text) toast.error(text, { position: 'bottom-center' }); };
  const successText = null;
  const setSuccessText = (text: string | null) => { if (text) toast.success(text, { position: 'bottom-center' }); };
  const [submitting, setSubmitting] = useState(false);

  // Notifications Hub State
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifHub, setShowNotifHub] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const [activeToast, setActiveToast] = useState<any | null>(null);
  const [notifPermission, setNotifPermission] = useState<string>("default");

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const el = document.getElementById("navbar-notification-slot");
    if (el) {
      setPortalTarget(el);
      return;
    }

    const interval = setInterval(() => {
      const targetEl = document.getElementById("navbar-notification-slot");
      if (targetEl) {
        setPortalTarget(targetEl);
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Load Notification Permission State
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  // Request native permission
  const requestNotificationPermission = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      try {
        const result = await Notification.requestPermission();
        setNotifPermission(result);
        if (result === "granted") {
          new Notification("Notificaciones Activadas", {
            body: "Recibirás alertas en tiempo real cuando se emita un ticket.",
            icon: "/favicon.ico"
          });
        }
      } catch (err) {
        console.error("Error pidiendo permisos de notificación:", err);
      }
    }
  };

  // SSE Real-time Updates Listener
  useEffect(() => {
    const sseUrl = "/api/notifications/subscribe";
    console.log("[SSE] Suscribiendo a alertas en tiempo real...", sseUrl);
    const eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (event) => {
      try {
        if (!event.data) return;
        const data = JSON.parse(event.data);
        
        // Skip ping heartbeats
        if (data.type === "ping") return;

        console.log("[SSE] Notificación recibida en tiempo real:", data);

        // Add to history
        setNotifications((prev) => [data, ...prev].slice(0, 50)); // keep last 50
        setUnseenCount((prev) => prev + 1);
        
        // Show in-app custom floating toast
        setActiveToast(data);
        
        // Trigger native notification if permission is granted
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
          new Notification(data.title || "Nuevo Ticket", {
            body: data.body,
            icon: "/favicon.ico"
          });
        }

        // Auto refresh sales statistics/lists dynamically!
        onRefreshSales();
        onRefreshUsers(); // Also refresh users since seller states might update
      } catch (e) {
        console.error("[SSE] Error parsing SSE message:", e);
      }
    };

    eventSource.onerror = (err) => {
      // EventSource automatically handles reconnection. We use console.log instead of console.error
      // to avoid false-positive error flags during standard serverless connection timeouts.
      console.log("[SSE] Conexión SSE interrumpida temporalmente. El navegador reintentará de forma automática.");
    };

    return () => {
      eventSource.close();
    };
  }, [onRefreshSales, onRefreshUsers]);

  // Clear toast helper after timeout
  useEffect(() => {
    if (activeToast) {
      const timer = setTimeout(() => {
        setActiveToast(null);
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [activeToast]);

  // Sync inputs with config changes
  useEffect(() => {
    setExchangeRateInput(String(config.tasa_cambio));
    setTicketTitleInput(config.formato_ticket.titulo);
    setTicketRucInput(config.formato_ticket.ruc);
    setTicketFooterInput(config.formato_ticket.mensaje_pie);
  }, [config]);

  // General statistics (Dynamically filtered when simulating a supervisor role)
  const activeSellers = users.filter(u => {
    const isVendedor = u.rol === "vendedor";
    if (!isVendedor) return false;
    if (simulatedSupervisorId) {
      return u.id_supervisor === simulatedSupervisorId;
    }
    return true;
  });
  const totalSellersCount = activeSellers.length;
  const onlineSellersCount = activeSellers.filter(u => u.conexion === "online").length;

  const today = getLocalTodayStr();

  const ticketMatchesToday = (s: Venta) => getTicketDate(s) === today;

  const ticketMatchesSupervisor = (s: Venta) => {
    if (!simulatedSupervisorId) return true;
    const seller = users.find(u => u.id === s.id_vendedor);
    return seller && seller.id_supervisor === simulatedSupervisorId;
  };

  const activeSales = sales.filter(s => {
    if (s.anulado) return false;
    if (!ticketMatchesToday(s)) return false;
    return ticketMatchesSupervisor(s);
  });
  
  const voidedSales = sales.filter(s => {
    if (!s.anulado) return false;
    if (!ticketMatchesToday(s)) return false;
    return ticketMatchesSupervisor(s);
  });

  // Aggregate currency revenue (converting USD to C$ where appropriate to get Grand Total)
  const totalSalesCs = activeSales.filter(s => s.moneda === "C$").reduce((sum, s) => sum + s.monto_pago, 0);
  const totalSalesUsd = activeSales.filter(s => s.moneda === "USD").reduce((sum, s) => sum + s.monto_pago, 0);
  const grandTotalCs = totalSalesCs + (totalSalesUsd * config.tasa_cambio);

  // Game specific statistics
  const gameStats = activeSales.reduce((acc: Record<string, { cs: number; usd: number; count: number }>, sale) => {
    if (!acc[sale.juego]) {
      acc[sale.juego] = { cs: 0, usd: 0, count: 0 };
    }
    acc[sale.juego].count += 1;
    if (sale.moneda === "C$") acc[sale.juego].cs += sale.monto_pago;
    else acc[sale.juego].usd += sale.monto_pago;
    return acc;
  }, {});

  // Helper to format Date as YYYY-MM-DD
  const getTodayString = () => {
    return getLocalTodayStr();
  };

  // Aggregated sales by hour for the current day
  const todayStr = getTodayString();
  const todaySales = activeSales.filter(s => s.timestamp_servidor.startsWith(todayStr));
  
  const hourlyData = Array.from({ length: 24 }, (_, i) => {
    const hourStr = String(i).padStart(2, "0");
    const hourSales = todaySales.filter(s => {
      try {
        const { hours } = parseISOTimeParts(s.timestamp_servidor);
        return hours === i;
      } catch (e) {
        return false;
      }
    });

    const totalInCs = hourSales.reduce((sum, s) => {
      const amt = s.monto_pago;
      return sum + (s.moneda === "C$" ? amt : amt * config.tasa_cambio);
    }, 0);

    return {
      hora: `${hourStr}:00`,
      "Ventas C$": Number(totalInCs.toFixed(2)),
      Tickets: hourSales.length
    };
  });

  // Generate and download an 80mm thermal receipt PDF
  const downloadThermalReportPDF = () => {
    try {
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [80, Math.max(180, 100 + activeSales.length * 12)]
      });

      // Monospace setup
      doc.setFont("courier", "bold");
      doc.setFontSize(9);

      let y = 8;
      const xLeft = 4;
      const xRight = 76;
      const xCenter = 40;

      const printCenter = (text: string, size = 9, isBold = true) => {
        doc.setFont("courier", isBold ? "bold" : "normal");
        doc.setFontSize(size);
        const textWidth = doc.getTextWidth(text);
        doc.text(text, xCenter - (textWidth / 2), y);
        y += size * 0.45;
      };

      const printRow = (left: string, right: string, size = 8, isBold = false) => {
        doc.setFont("courier", isBold ? "bold" : "normal");
        doc.setFontSize(size);
        doc.text(left, xLeft, y);
        const rightWidth = doc.getTextWidth(right);
        doc.text(right, xRight - rightWidth, y);
        y += size * 0.45;
      };

      const drawSeparator = (char = "-") => {
        doc.setFont("courier", "normal");
        doc.setFontSize(8);
        const line = char.repeat(38);
        printCenter(line, 8, false);
      };

      // Header block
      const mainTitle = config?.formato_ticket?.titulo?.toUpperCase() || "SISTEMA DE VENTAS";
      printCenter(mainTitle, 14, true);
      printCenter("MONITOR REPORTE DIARIO", 10, true);
      printCenter("--- IMPRESORA TÉRMICA 80MM ---", 7, false);
      y += 1;
      drawSeparator("=");
      
      const nowNic = getNicaraguaISOString();
      const nicParts = parseISOTimeParts(nowNic);
      const printDate = `${String(nicParts.day).padStart(2,"0")}/${String(nicParts.month).padStart(2,"0")}/${nicParts.year}`;
      printRow("FECHA REPORTE:", printDate, 8, true);
      printRow("HORA:", formatTo12HourTime(nowNic), 8, false);
      printRow("TASA CAMBIO:", `C$ ${config.tasa_cambio.toFixed(2)}`, 8, false);
      printRow("GENERADO POR:", user.nombre.substring(0, 18).toUpperCase(), 8, false);
      drawSeparator("-");

      // Summary totals
      printCenter("RESUMEN DE CAJA", 9, true);
      y += 1;
      printRow("TICKETS ACTIVOS:", String(activeSales.length), 8, false);
      printRow("TICKETS ANULADOS:", String(voidedSales.length), 8, false);
      printRow("VENTAS CORDOBAS:", `C$ ${totalSalesCs.toFixed(2)}`, 8, false);
      printRow("VENTAS DOLARES:", `$ ${totalSalesUsd.toFixed(2)}`, 8, false);
      drawSeparator("-");
      printRow("RECAUDACIÓN TOTAL:", `C$ ${grandTotalCs.toFixed(2)}`, 9, true);
      drawSeparator("=");

      // Sales by Game
      printCenter("VENTAS POR TIPO DE JUEGO", 9, true);
      y += 1;
      ["Diaria", "La Diaria", "Premia2", "Jugá 3", "Fechas", "Pega 3", "Súper Premio", "3 Monazos", "Tica", "Terminación 2", "Sabadito", "La Primera"].forEach((juego) => {
        const stats = gameStats[juego] || { cs: 0, usd: 0, count: 0 };
        if (stats.count === 0) return; // skip games with no sales
        const totalGameCs = stats.cs + (stats.usd * config.tasa_cambio);
        printRow(`${juego.toUpperCase()} (${stats.count} tks):`, `C$ ${totalGameCs.toFixed(2)}`, 8, false);
      });
      drawSeparator("-");

      // Detailed Transactions
      printCenter("DETALLE DE TRANSACCIONES", 9, true);
      y += 2;

      // Print table header
      printRow("TKT/H/VEND    JUEGO/NUM", "MONTO", 7, true);
      drawSeparator("-");

      activeSales.forEach((sale) => {
        const timePart = formatTo12HourTime(sale.timestamp_servidor, false);
        const sellerPart = sale.nombre_vendedor.substring(0, 10);
        const ticketIdPart = sale.numero_ticket.substring(sale.numero_ticket.length - 6);
        const gamePart = sale.juego.substring(0, 8);
        const numPart = sale.numero_jugado;
        const amtPart = `${sale.moneda} ${sale.monto_pago.toFixed(2)}`;

        doc.setFont("courier", "normal");
        doc.setFontSize(7.5);
        doc.text(`#${ticketIdPart} ${timePart} ${sellerPart}`, xLeft, y);
        y += 3.2;
        doc.text(`   ${gamePart} [${numPart}]`, xLeft, y);
        const amtWidth = doc.getTextWidth(amtPart);
        doc.text(amtPart, xRight - amtWidth, y - 1.6);
        y += 4.5;
      });

      if (activeSales.length === 0) {
        printCenter("NO SE REGISTRAN VENTAS HOY", 8, false);
        y += 4;
      }

      drawSeparator("=");
      printCenter("FIN DEL REPORTE", 8, true);
      const ticketFooter = config?.formato_ticket?.mensaje_pie || "¡Gracias por su preferencia!";
      printCenter(ticketFooter, 7, false);
      const nowObj = getNicaraguaNow();
      printCenter(nowObj.toLocaleDateString("es-ES") + " " + nowObj.toLocaleTimeString("es-ES"), 6, false);

      // Save PDF
      doc.save(`reporte_termico_80mm_${getLocalTodayStr()}.pdf`);
    } catch (error) {
      console.error("Error generando PDF térmico:", error);
      alert("Error al generar el reporte en PDF: " + error);
    }
  };

  // Update Exchange Rate
  const handleSaveExchangeRate = async () => {
    setAlertText(null);
    setSuccessText(null);
    const val = Number(exchangeRateInput);
    if (isNaN(val) || val <= 0) {
      setAlertText("Por favor ingrese una tasa de cambio válida mayor a cero.");
      return;
    }

    setSubmitting(true);
    const success = await onUpdateConfig({ tasa_cambio: val });
    setSubmitting(false);
    if (success) {
      setSuccessText("Tasa de cambio actualizada globalmente con éxito.");
    } else {
      setAlertText("Error al actualizar la tasa de cambio.");
    }
  };

  // Update Ticket Template
  const handleSaveTicketTemplate = async () => {
    setAlertText(null);
    setSuccessText(null);

    if (!ticketRucInput.trim()) {
      setAlertText("Las indicaciones del ticket son requeridas.");
      return;
    }

    setSubmitting(true);
    const success = await onUpdateConfig({
      formato_ticket: {
        titulo: ticketTitleInput,
        ruc: ticketRucInput,
        mensaje_pie: ticketFooterInput
      }
    });
    setSubmitting(false);

    if (success) {
      setSuccessText("Diseño del Ticket guardado con éxito.");
    } else {
      setAlertText("Error al guardar el diseño.");
    }
  };

  // Open Create Modal
  const openCreateUserModal = () => {
    setEditingUser(null);
    setUserFormName("");
    setUserFormEmail("");
    setUserFormUsername("");
    setUserFormPassword("");
    setShowUserFormPassword(false);
    setUserFormRole("vendedor");
    setUserFormStatus("activo");
    setUserFormRegion("Nicaragua");
    setUserFormVendedoresAsignados([]);
    setIsUserModalOpen(true);
  };

  // Open Create Modal pre-filled for Admin
  const openCreateAdminModal = () => {
    setEditingUser(null);
    setUserFormName("");
    setUserFormEmail("");
    setUserFormUsername("");
    setUserFormPassword("");
    setShowUserFormPassword(false);
    setUserFormRole("administrador");
    setUserFormStatus("activo");
    setUserFormRegion("Nicaragua");
    setUserFormVendedoresAsignados([]);
    setIsUserModalOpen(true);
  };

  // Open Edit Modal
  const openEditUserModal = (targetUser: Usuario) => {
    setEditingUser(targetUser);
    setUserFormName(targetUser.nombre);
    setUserFormEmail(targetUser.email);
    setUserFormUsername(targetUser.usuario || "");
    setUserFormPassword("");
    setShowUserFormPassword(false);
    setUserFormRole(targetUser.rol === "administrador" || targetUser.rol === "admin" ? "administrador" : targetUser.rol);
    setUserFormStatus(targetUser.estado || "activo");
    setUserFormRegion(targetUser.region || "Nicaragua");
    setUserFormVendedoresAsignados(targetUser.vendedoresAsignados || []);
    setIsUserModalOpen(true);
  };

  // Save/Update user form submission
  const handleSaveUserSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAlertText(null);
    setSuccessText(null);

    if (!userFormName.trim() || !userFormEmail.trim() || !userFormUsername.trim()) {
      setAlertText("Por favor complete todos los campos obligatorios: Nombre, Nickname (usuario) y Correo Electrónico.");
      return;
    }

    // Force password on creation
    if (!editingUser && !userFormPassword.trim()) {
      setAlertText("La contraseña es requerida para el registro de nuevos usuarios.");
      return;
    }

    const payload: any = {
      nombre: userFormName.trim(),
      usuario: userFormUsername.trim().toLowerCase(),
      rol: userFormRole,
      email: userFormEmail.trim(),
      estado: userFormStatus,
      activo: userFormStatus === "activo",
      region: userFormRegion,
      vendedoresAsignados: userFormVendedoresAsignados
    };

    if (userFormPassword.trim()) {
      payload.password = userFormPassword.trim();
    }

    if (editingUser) {
      const ok = await onUpdateUser(editingUser.id, payload);
      setSubmitting(false);
      if (ok) {
        setSuccessText(`Usuario "${userFormName}" actualizado con éxito.`);
        setIsUserModalOpen(false);
        setEditingUser(null);
        onRefreshUsers();
      } else {
        setAlertText("Ocurrió un error al actualizar el usuario.");
      }
    } else {
      const result = await onCreateUser(payload);
      setSubmitting(false);
      if (result.success) {
        setSuccessText(`Usuario "${userFormName}" registrado con éxito.`);
        setIsUserModalOpen(false);
        setEditingUser(null);
        onRefreshUsers();
      } else {
        setAlertText(result.error || "Ocurrió un error al guardar el usuario.");
      }
    }
  };

  // Toggle user active/inactive status
  const handleToggleUserActive = async (targetUser: Usuario) => {
    setAlertText(null);
    setSuccessText(null);
    const nextEstado = targetUser.estado === "activo" ? "inactivo" : "activo";
    const nextActivo = nextEstado === "activo";

    const success = await onUpdateUser(targetUser.id, { 
      estado: nextEstado, 
      activo: nextActivo 
    });
    if (success) {
      setSuccessText(`El estado de "${targetUser.nombre}" ahora es ${nextEstado.toUpperCase()}.`);
      onRefreshUsers();
    } else {
      setAlertText("No se pudo actualizar el estado del usuario.");
    }
  };

  // Custom Deletion Confirmation Handler
  const handleDeleteUserConfirm = async () => {
    if (!deletingUser) return;
    setAlertText(null);
    setSuccessText(null);

    const success = await onDeleteUser(deletingUser.id);
    if (success) {
      setSuccessText(`Usuario "${deletingUser.nombre}" eliminado permanentemente.`);
      setDeletingUser(null);
      onRefreshUsers();
    } else {
      setAlertText("Error al eliminar el usuario.");
    }
  };

  // Mark closure as collected (cobrado)
  const handleMarkClosureCollected = async (closureId: string) => {
    setAlertText(null);
    setSuccessText(null);
    try {
      const res = await fetch(`/api/cierres/${closureId}`, {
        method: "PATCH"
      });
      if (res.ok) {
        setSuccessText("El cierre de caja ha sido marcado como cobrado exitosamente.");
      } else {
        const data = await res.json();
        setAlertText(data.error || "Error al marcar el cierre como cobrado.");
      }
    } catch (err) {
      setAlertText("Error de red al marcar el cierre como cobrado.");
    }
  };

  // Assign/unassign vendor to/from a supervisor (updates list immediately in local DB)
  const handleToggleSellerToSupervisor = async (supervisor: Usuario, sellerId: string, isChecked: boolean) => {
    setAlertText(null);
    setSuccessText(null);
    
    let currentAsignados = [...(supervisor.vendedoresAsignados || [])];
    if (isChecked) {
      if (!currentAsignados.includes(sellerId)) {
        currentAsignados.push(sellerId);
      }
    } else {
      currentAsignados = currentAsignados.filter(id => id !== sellerId);
    }

    const success = await onUpdateUser(supervisor.id, { vendedoresAsignados: currentAsignados });
    if (success) {
      setSuccessText(`Vendedores asignados al supervisor "${supervisor.nombre}" actualizados.`);
      // Update selected supervisor assignment local state if active to reflect live checks
      if (selectedSupervisorForAssignment && selectedSupervisorForAssignment.id === supervisor.id) {
        setSelectedSupervisorForAssignment(prev => prev ? { ...prev, vendedoresAsignados: currentAsignados } : null);
      }
      onRefreshUsers();
    } else {
      setAlertText("No se pudo actualizar la asignación de vendedores.");
    }
  };

  // Add draw schedule
  // Edit draw schedule
  const handleEditSorteoClick = (sorteo: Sorteo) => {
    setSorteoEditando(sorteo);
    // Extract the name without game prefix and suffix
    const parts = sorteo.nombre.split(" ");
    const gamePrefix = parts[0];
    parts.shift(); // remove game
    let remaining = parts.join(" ");
    remaining = remaining.replace(/ \((NI|HN|SV|LP|CR)\)$/, "");
    setNewSorteoNombre(remaining);
    setNewSorteoJuego(sorteo.juego);
    setNewSorteoPais(getCountryFromSorteo(sorteo.nombre));
    // Parse hora_sorteo
    const [hStr, mStr] = sorteo.hora_sorteo.split(":");
    let hNum = parseInt(hStr, 10);
    const isPM = hNum >= 12;
    setNewSorteoHourDraw(isPM && hNum > 12 ? String(hNum - 12) : isPM && hNum === 12 ? "12" : hNum === 0 ? "12" : String(hNum));
    setNewSorteoMinDraw(mStr.padStart(2, "0"));
    setNewSorteoAmPmDraw(isPM ? "PM" : "AM");
    // Parse hora_cierre
    const [chStr, cmStr] = sorteo.hora_cierre.split(":");
    let chNum = parseInt(chStr, 10);
    const isCPM = chNum >= 12;
    setNewSorteoHourCierre(isCPM && chNum > 12 ? String(chNum - 12) : isCPM && chNum === 12 ? "12" : chNum === 0 ? "12" : String(chNum));
    setNewSorteoMinCierre(cmStr.padStart(2, "0"));
    setNewSorteoAmPmCierre(isCPM ? "PM" : "AM");
    setNewSorteoDias(sorteo.dias_habilitados || []);
  };

  const cancelEditSorteo = () => {
    setSorteoEditando(null);
    setNewSorteoNombre("");
    setNewSorteoHourDraw("11");
    setNewSorteoMinDraw("00");
    setNewSorteoAmPmDraw("AM");
    setNewSorteoHourCierre("10");
    setNewSorteoMinCierre("55");
    setNewSorteoAmPmCierre("AM");
    setNewSorteoDias([]);
  };

  // Add or update draw schedule
  const handleAddSorteo = async () => {
    setAlertText(null);
    setSuccessText(null);

    if (!newSorteoNombre.trim()) {
      setAlertText("Complete todos los campos del sorteo (Nombre de Horario es requerido).");
      return;
    }

    const convert12To24 = (hour: string, min: string, ampm: string): string => {
      let h = parseInt(hour, 10);
      if (ampm === "PM" && h < 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      const hStr = String(h).padStart(2, "0");
      const mStr = String(min).padStart(2, "0");
      return `${hStr}:${mStr}`;
    };

    const horaSorteo24 = convert12To24(newSorteoHourDraw, newSorteoMinDraw, newSorteoAmPmDraw);
    const horaCierre24 = convert12To24(newSorteoHourCierre, newSorteoMinCierre, newSorteoAmPmCierre);

    let suffix = "(NI)";
    if (newSorteoPais === "Honduras") suffix = "(HN)";
    else if (newSorteoPais === "El Salvador") suffix = "(SV)";
    else if (newSorteoPais === "La Primera") suffix = "(LP)";
    else if (newSorteoPais === "Costa Rica") suffix = "(CR)";

    if (sorteoEditando) {
      // UPDATE existing
      const updatedSorteos = config.sorteos.map(s => {
        if (s.id === sorteoEditando.id) {
          return {
            ...s,
            juego: newSorteoJuego,
            nombre: `${newSorteoJuego} ${newSorteoNombre} ${suffix}`,
            hora_sorteo: horaSorteo24,
            hora_cierre: horaCierre24,
            dias_habilitados: newSorteoDias.length > 0 ? newSorteoDias : undefined
          };
        }
        return s;
      });
      setSubmitting(true);
      const success = await onUpdateConfig({ sorteos: updatedSorteos });
      setSubmitting(false);
      if (success) {
        setSuccessText(`Sorteo "${newSorteoJuego} ${newSorteoNombre}" actualizado con éxito.`);
        cancelEditSorteo();
      } else {
        setAlertText("Error al actualizar el sorteo.");
      }
    } else {
      // CREATE new
      const newSorteoObj: Sorteo = {
        id: "sort_" + Math.random().toString(36).substring(2, 9),
        juego: newSorteoJuego,
        nombre: `${newSorteoJuego} ${newSorteoNombre} ${suffix}`,
        hora_sorteo: horaSorteo24,
        hora_cierre: horaCierre24,
        ...(newSorteoDias.length > 0 ? { dias_habilitados: newSorteoDias } : {})
      };

      const updatedSorteos = [...config.sorteos, newSorteoObj];

      setSubmitting(true);
      const success = await onUpdateConfig({ sorteos: updatedSorteos });
      setSubmitting(false);

      if (success) {
        setSuccessText(`Sorteo "${newSorteoObj.nombre}" agregado con éxito.`);
        setNewSorteoNombre("");
        setNewSorteoHourDraw("11");
        setNewSorteoMinDraw("00");
        setNewSorteoAmPmDraw("AM");
        setNewSorteoHourCierre("10");
        setNewSorteoMinCierre("55");
        setNewSorteoAmPmCierre("AM");
      } else {
        setAlertText("Error al agregar el sorteo.");
      }
    }
  };

  // Delete draw schedule
  const handleDeleteSorteo = async (sortId: string) => {
    if (!window.confirm("¿Está seguro que desea eliminar este sorteo? Esta acción es irreversible.")) {
      return;
    }

    const updatedSorteos = config.sorteos.filter(s => s.id !== sortId);

    const success = await onUpdateConfig({ sorteos: updatedSorteos });
    if (success) {
      setSuccessText("Sorteo eliminado de la programación.");
    } else {
      setAlertText("Error al eliminar el sorteo.");
    }
  };

  // Save winning number (Resultado)
  const handleSaveResultado = async (e: FormEvent) => {
    e.preventDefault();
    setAlertText(null);
    setSuccessText(null);

    console.log("🔍 DEBUG handleSaveResultado:", {
      selectedSorteoResultados,
      fechaResultadosInput,
      winningNumberInput,
      resultFechasDia,
      resultFechasMes,
    });

    const matchedSorteo = config.sorteos.find(s => s.id === selectedSorteoResultados);
    const matchedJuego = matchedSorteo ? matchedSorteo.juego : "";

    const winningNum = matchedJuego === "Fechas" 
      ? `${resultFechasDia}-${resultFechasMes}` 
      : winningNumberInput.trim();

    if (!selectedSorteoResultados || !fechaResultadosInput || (!winningNum && matchedJuego !== "Fechas")) {
      setAlertText("Por favor seleccione un sorteo e ingrese el número ganador.");
      return;
    }

    // Check if there is already a result for this sorteo and date (excluding the one being edited, if any)
    const activeResultados = config?.resultados || [];
    const alreadyExists = activeResultados.some(
      (r: any) =>
        r.id_sorteo === selectedSorteoResultados &&
        r.fecha === fechaResultadosInput &&
        (!resultadoEditando || r.id !== resultadoEditando.id)
    );
    if (alreadyExists) {
      setAlertText("Ya existe un resultado registrado para este sorteo en la fecha seleccionada.");
      return;
    }

    // Dynamic validations by Game type
    if (matchedJuego === "Diaria" || matchedJuego === "La Diaria" || matchedJuego === "Terminación 2" || matchedJuego === "La Primera" || matchedJuego === "Tica") {
      if (!/^\d{2}$/.test(winningNum)) {
        setAlertText(`El juego ${matchedJuego} requiere exactamente un número de 2 dígitos (00-99).`);
        return;
      }
    } else if (matchedJuego === "Jugá 3" || matchedJuego === "3 Monazos") {
      if (!/^\d{3}$/.test(winningNum)) {
        setAlertText(`${matchedJuego} requiere exactamente un número de 3 dígitos (000-999).`);
        return;
      }
    } else if (matchedJuego === "Premia2") {
      if (!/^\d{4}$/.test(winningNum)) {
        setAlertText("Premia2 requiere ingresar exactamente dos números de 2 dígitos (total 4 dígitos).");
        return;
      }
    } else if (matchedJuego === "Pega 3") {
      if (!/^\d{3}$/.test(winningNum)) {
        setAlertText("Pega 3 requiere ingresar exactamente un número de 3 dígitos.");
        return;
      }
    } else if (matchedJuego === "Súper Premio") {
      if (!/^\d{12}$/.test(winningNum)) {
        setAlertText("Súper Premio requiere ingresar exactamente 6 números de 2 dígitos (total 12 dígitos).");
        return;
      }
      for (let i = 0; i < 12; i += 2) {
        const val = Number(winningNum.substring(i, i + 2));
        if (val < 1 || val > 33) {
          setAlertText("Cada número del Súper Premio debe estar entre el rango 01 y 33.");
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      // Call server API which writes to Firestore on backend
      const res = await fetch("/api/resultados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_sorteo: selectedSorteoResultados,
          sorteo: matchedSorteo ? matchedSorteo.nombre : "",
          pais: selectedPaisResultados,
          fecha: fechaResultadosInput,
          numero_ganador: winningNum
        })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Error al guardar el resultado.");
      }

      setSuccessText("Resultado del sorteo guardado y publicado exitosamente.");
      setWinningNumberInput("");
    } catch (err: any) {
      console.error("Error guardando resultado:", err);
      setAlertText(err.message || "Error al guardar el resultado.");
    } finally {
      setSubmitting(false);
    }
  };

  // Delete winning number from Firestore via API
  const handleDeleteResultado = async (resId: string) => {
    if (!window.confirm("¿Está seguro que desea eliminar este resultado? Esta acción es irreversible.")) {
      return;
    }
    setAlertText(null);
    setSuccessText(null);

    try {
      const res = await fetch(`/api/resultados/${resId}`, {
        method: "DELETE"
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Error al eliminar el resultado.");
      }

      console.log("Resultado eliminado:", resId);
      setSuccessText("Resultado eliminado correctamente.");
    } catch (err: any) {
      console.error("Error eliminando resultado:", err);
      setAlertText(err.message || "Error al eliminar el resultado.");
    }
  };

  // Save number sales limit (Límite)
  const handleSaveLimite = async (e: FormEvent) => {
    e.preventDefault();
    setAlertText(null);
    setSuccessText(null);

    const limitAmt = Number(limiteDineroInput);
    if (isNaN(limitAmt) || limitAmt <= 0) {
      setAlertText("Por favor ingrese un techo de dinero válido mayor a cero.");
      return;
    }

    setSubmitting(true);
    try {
      const url = editingLimitId ? `/api/limites-numeros/${editingLimitId}` : "/api/limites-numeros";
      const method = editingLimitId ? "PUT" : "POST";
      const res = await fetch(url, {
        method: method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingLimitId || "lim_" + Math.random().toString(36).substring(2, 9),
          id_vendedor: selectedVendedorLimite,
          vendedorId: selectedVendedorLimite,
          pais: selectedPaisLimite,
          juego: selectedJuegoLimite,
          sorteo: selectedSorteoLimite,
          hora: selectedHoraLimite,
          hora_limite: selectedHoraLimite,
          numero: numeroLimiteInput.trim() || "TODOS",
          numero_jugado: numeroLimiteInput.trim() || "TODOS",
          max_monto: limitAmt,
          montoMaximo: limitAmt,
          techo_dinero: limitAmt
        })
      });

      if (res.ok) {
        setSuccessText(editingLimitId ? "Límite de venta actualizado con éxito." : "Límite de venta guardado con éxito.");
        setNumeroLimiteInput("");
        setLimiteDineroInput("");
        setEditingLimitId(null);
        // Reset dropdowns to defaults
        setSelectedVendedorLimite("TODOS");
        setSelectedPaisLimite("TODOS");
        setSelectedJuegoLimite("TODOS");
        setSelectedSorteoLimite("TODOS");
        setSelectedHoraLimite("TODOS");
        await fetchLimitsList();
      } else {
        const data = await res.json();
        setAlertText(data.error || "Error al guardar el límite.");
      }
    } catch (err) {
      setAlertText("Error de red al guardar el límite.");
    } finally {
      setSubmitting(false);
    }
  };

  // Start editing a number sales limit
  const handleStartEditLimite = (lim: any) => {
    setEditingLimitId(lim.id);
    setSelectedVendedorLimite(lim.id_vendedor || "TODOS");
    setSelectedPaisLimite(lim.pais || "TODOS");
    setSelectedJuegoLimite(lim.juego || "TODOS");
    setSelectedSorteoLimite(lim.sorteo || "TODOS");
    setSelectedHoraLimite(lim.hora_limite || lim.hora || "TODOS");
    
    const limitNum = lim.numero ?? lim.numero_jugado ?? "TODOS";
    setNumeroLimiteInput(limitNum === "TODOS" ? "" : String(limitNum));
    
    const limitAmt = lim.max_monto ?? lim.techo_dinero ?? 0;
    setLimiteDineroInput(String(limitAmt));

    // Scroll to the configuration form to ensure visibility
    const formElement = document.querySelector("form");
    if (formElement) {
      formElement.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Delete number sales limit (Límite)
  const handleDeleteLimite = async (limId: string) => {
    setAlertText(null);
    setSuccessText(null);

    try {
      const res = await fetch(`/api/limites-numeros?id=${limId}`, {
        method: "DELETE"
      });

      if (res.ok) {
        setSuccessText("Límite eliminado correctamente.");
        await fetchLimitsList();
      } else {
        setAlertText("Error al eliminar el límite.");
      }
    } catch (err) {
      setAlertText("Error de red al eliminar el límite.");
    }
  };

  // Toggle seller simulated status (Online/Offline) to demonstrate Realtime DB presence
  const handleToggleSimulatedPresence = async (vendedor: Usuario) => {
    const nextStatus = vendedor.conexion === "online" ? "offline" : "online";
    await onUpdateUser(vendedor.id, { conexion: nextStatus });
    onRefreshUsers();
  };

  return (
    <div id="admin-container" className="flex flex-col lg:flex-row bg-[#F3F4F6] flex-1 w-full relative min-h-screen">
      
      {/* Floating Custom Live Notification Toast */}
      {activeToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm w-[90%] bg-slate-950 border border-slate-800 text-white rounded-2xl shadow-2xl p-4 flex items-start space-x-3.5 animate-bounce">
          <div className="p-2.5 bg-emerald-500 text-white rounded-xl shrink-0">
            <Bell className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-display font-black text-xs uppercase tracking-wider text-emerald-400">¡Alerta de Venta!</h4>
            <p className="text-xs text-white font-medium mt-1">
              <strong className="text-gray-100 font-bold">{activeToast.vendedor}</strong> vendió <strong className="text-yellow-400 font-black">{activeToast.monto}</strong> en {activeToast.juego}
            </p>
            <div className="flex justify-between items-center mt-2.5 text-[10px] text-gray-400 font-mono border-t border-slate-800 pt-1.5">
              <span>Boleto #{activeToast.ticketNum}</span>
              <span>{activeToast.hora ? (activeToast.hora.includes(":") ? formatTo12Hour(activeToast.hora) : activeToast.hora) : formatTo12HourTime(activeToast.timestamp)}</span>
            </div>
          </div>
          <button 
            onClick={() => setActiveToast(null)} 
            className="text-gray-400 hover:text-white text-sm font-bold p-1 cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>
      )}
      
      {/* Backdrop overlay for sidebar drawer */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 transition-opacity duration-300 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar Drawer Panel */}
      <aside className={`
        fixed top-0 bottom-0 left-0 w-72 bg-[#1E3A8A] text-white flex flex-col justify-between border-r border-blue-950 z-50
        lg:static lg:translate-x-0 lg:z-0 lg:shadow-none
        transform transition-transform duration-300 ease-in-out shadow-2xl shrink-0
        ${isSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        
        {/* Brand & Stats info */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 bg-blue-950 border-b border-blue-900 flex justify-between items-center">
            <div>
              <span className="font-display font-black text-lg tracking-wider text-white uppercase block">PANEL ADMIN</span>
              <div className="flex items-center space-x-1.5 mt-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 block animate-ping"></span>
                <span className="text-[10px] text-emerald-300 font-mono font-bold tracking-widest uppercase">Monitoreo en Vivo</span>
              </div>
            </div>
            
            {/* Close button for drawer */}
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-blue-900 text-white hover:bg-blue-800 active:scale-95 transition-all cursor-pointer border border-blue-800 shrink-0 lg:hidden"
              title="Cerrar Menú"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="p-4 space-y-1">
            <button
              id="sidebar-dashboard"
              onClick={() => { setActiveSection("dashboard"); setAlertText(null); setSuccessText(null); setIsSidebarOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 min-h-[44px] rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-left cursor-pointer ${
                activeSection === "dashboard" ? "bg-white text-blue-900 shadow-md scale-102" : "hover:bg-blue-800 text-blue-100"
              }`}
            >
              <LayoutDashboard className="w-4 h-4 stroke-[2]" />
              <span>Monitor en Vivo</span>
            </button>

            <button
              id="sidebar-config"
              onClick={() => { setActiveSection("config"); setAlertText(null); setSuccessText(null); setIsSidebarOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 min-h-[44px] rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-left cursor-pointer ${
                activeSection === "config" ? "bg-white text-blue-900 shadow-md scale-102" : "hover:bg-blue-800 text-blue-100"
              }`}
            >
              <Settings className="w-4 h-4 stroke-[2]" />
              <span>Configuración</span>
            </button>

            <button
              id="sidebar-usuarios"
              onClick={() => { setActiveSection("usuarios"); setAlertText(null); setSuccessText(null); setIsSidebarOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 min-h-[44px] rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-left cursor-pointer ${
                activeSection === "usuarios" ? "bg-white text-blue-900 shadow-md scale-102" : "hover:bg-blue-800 text-blue-100"
              }`}
            >
              <Users className="w-4 h-4 stroke-[2]" />
              <span>Gestión Usuarios</span>
            </button>

            <button
              id="sidebar-resultados"
              onClick={() => { setActiveSection("resultados"); setAlertText(null); setSuccessText(null); setIsSidebarOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 min-h-[44px] rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-left cursor-pointer ${
                activeSection === "resultados" ? "bg-white text-blue-900 shadow-md scale-102" : "hover:bg-blue-800 text-blue-100"
              }`}
            >
              <CheckCircle className="w-4 h-4 stroke-[2]" />
              <span>Resultados Sorteos</span>
            </button>

            <button
              id="sidebar-limites"
              onClick={() => { setActiveSection("limites"); setAlertText(null); setSuccessText(null); setIsSidebarOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 min-h-[44px] rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-left cursor-pointer ${
                activeSection === "limites" ? "bg-white text-blue-900 shadow-md scale-102" : "hover:bg-blue-800 text-blue-100"
              }`}
            >
              <Sliders className="w-4 h-4 stroke-[2]" />
              <span>Límites de Números</span>
            </button>

            <button
              id="sidebar-reportes"
              onClick={() => { setActiveSection("reportes"); setAlertText(null); setSuccessText(null); setIsSidebarOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 min-h-[44px] rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-left cursor-pointer ${
                activeSection === "reportes" ? "bg-white text-blue-900 shadow-md scale-102" : "hover:bg-blue-800 text-blue-100"
              }`}
            >
              <FileText className="w-4 h-4 stroke-[2]" />
              <span>Reportes de Ventas</span>
            </button>

            <button
              id="sidebar-finanzas"
              onClick={() => { setActiveSection("finanzas"); setAlertText(null); setSuccessText(null); setIsSidebarOpen(false); }}
              className={`w-full flex items-center space-x-3 px-4 py-3.5 min-h-[44px] rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-left cursor-pointer ${
                activeSection === "finanzas" ? "bg-white text-blue-900 shadow-md scale-102" : "hover:bg-blue-800 text-blue-100"
              }`}
            >
              <DollarSign className="w-4 h-4 stroke-[2]" />
              <span>Finanzas y Cobros</span>
            </button>

            {((user.rol as string) === "admin" || (user.rol as string) === "admin_1" || (user.rol as string) === "administrador") && (
              <button
                id="sidebar-buscador"
                onClick={() => { setActiveSection("buscador"); setAlertText(null); setSuccessText(null); setIsSidebarOpen(false); }}
                className={`w-full flex items-center space-x-3 px-4 py-3.5 min-h-[44px] rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-left cursor-pointer ${
                  activeSection === "buscador" ? "bg-white text-blue-900 shadow-md scale-102" : "hover:bg-blue-800 text-blue-100"
                }`}
              >
                <Search className="w-4 h-4 stroke-[2]" />
                <span>Buscador de Boletos</span>
              </button>
            )}
          </nav>
        </div>

        {/* Global info footer */}
        <div className="p-4 pb-16 md:pb-24 bg-blue-950/50 border-t border-blue-900 text-[10px] font-sans text-blue-200">
          <div className="flex justify-between items-center py-1">
            <span>Tasa de Cambio:</span>
            <span className="text-white font-black font-mono">C$ {config.tasa_cambio.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-t border-slate-900/40">
            <span>Tickets de Hoy:</span>
            <span className="text-white font-black font-mono">{config.contador_global_tickets}</span>
          </div>
          <div className="flex justify-between items-center py-1 border-t border-slate-900/40">
            <span>Vendedores Activos:</span>
            <span className="text-white font-black font-mono">{onlineSellersCount} / {totalSellersCount}</span>
          </div>
        </div>

      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-8 pb-24 md:pb-32 overflow-y-auto max-h-screen">
        
        {/* Unified Top Header Bar with Hamburger Menu Trigger */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between border-b border-gray-300 pb-5 mb-6 gap-4 bg-white md:bg-transparent p-4 md:p-0 rounded-2xl shadow-xs md:shadow-none">
          <div className="flex items-center space-x-3.5">
            {/* Hamburger Toggle Button (overlays sidebar drawer when clicked) */}
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="w-12 h-12 flex items-center justify-center bg-[#1E3A8A] text-white rounded-xl hover:bg-blue-900 active:scale-95 transition-all cursor-pointer shadow-md border border-blue-950 shrink-0 lg:hidden"
              title="Abrir Menú de Navegación"
            >
              <Menu className="w-5.5 h-5.5" />
            </button>
            
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-blue-900 font-sans font-black tracking-wider uppercase bg-blue-100/80 border border-blue-200 px-2.5 py-0.5 rounded-lg">Panel de Administración</span>
              </div>
              <h2 className="font-display font-black text-lg md:text-xl text-gray-900 uppercase tracking-tight mt-0.5">
                {activeSection === "dashboard" && "Dashboard de Control Vivo"}
                {activeSection === "config" && "Configuración Global del Sistema"}
                {activeSection === "usuarios" && "Gestión de Usuarios y Accesos"}
                {activeSection === "resultados" && "Resultados Oficiales Sorteos"}
                {activeSection === "limites" && "Techos y Límites de Ventas"}
                {activeSection === "reportes" && "Reportería de Facturación General"}
                {activeSection === "finanzas" && "Módulo de Finanzas y Cobros"}
                {activeSection === "buscador" && "Buscador y Recuperación de Boletos"}
              </h2>
              <p className="text-xs text-gray-500 font-sans mt-0.5 line-clamp-1">
                {activeSection === "dashboard" && "Monitoreo en tiempo real de transacciones, estados de presencia de vendedores y auditoría."}
                {activeSection === "config" && "Actualización de tasas de cambio, programación de sorteos y plantillas de impresión."}
                {activeSection === "usuarios" && "Registro de nuevos vendedores, supervisores y asignación de dependencias."}
                {activeSection === "resultados" && "Ingrese los números ganadores oficiales de cada sorteo diario para realizar el escrutinio automático."}
                {activeSection === "limites" && "Gestione el techo máximo de venta acumulada por número, sorteo y vendedor."}
                {activeSection === "reportes" && "Estadísticas y reportes de facturación detallada por vendedor, por número de juego, o general."}
                {activeSection === "finanzas" && "Consultar balances de vendedores, aplicar cobros y registrar pagos de comisiones."}
                {activeSection === "buscador" && "Localice boletos dañados mediante filtros optimizados y visualice su representación oficial."}
              </p>
            </div>
          </div>

          {/* Quick Action Controls */}
          <div className="flex flex-wrap items-center gap-2 relative">
            {/* Bell Icon Notification Button */}
            <div className="relative">
              <button
                id="bell-notifications-btn"
                onClick={() => {
                  setShowNotifHub(!showNotifHub);
                  setUnseenCount(0); // clear unseen count on view
                }}
                className={`w-11 h-11 flex items-center justify-center rounded-xl border cursor-pointer transition-all relative ${
                  showNotifHub
                    ? "bg-blue-900 text-white border-blue-900"
                    : "bg-white text-gray-700 hover:bg-gray-100 border-gray-300 shadow-xs"
                }`}
                title="Notificaciones en Vivo"
              >
                <Bell className={`w-4 h-4 ${unseenCount > 0 ? "animate-pulse" : ""}`} />
                {unseenCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-[#EF4444] text-white text-[9px] font-black rounded-full h-5 w-5 flex items-center justify-center border-2 border-white shadow-xs">
                    {unseenCount}
                  </span>
                )}
              </button>

              {/* Notification Hub Dropdown Panel */}
              {showNotifHub && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl border border-gray-300 shadow-xl z-50 text-gray-800 overflow-hidden animate-fade-in">
                  <div className="p-3.5 bg-blue-950 text-white flex justify-between items-center border-b border-blue-900">
                    <div className="flex items-center space-x-1.5">
                      <Bell className="w-4 h-4 text-emerald-400" />
                      <span className="font-display font-black text-xs tracking-wider uppercase">Alertas de Venta ({notifications.length})</span>
                    </div>
                    <button
                      onClick={() => setNotifications([])}
                      className="text-[10px] text-gray-300 hover:text-white font-bold cursor-pointer underline"
                    >
                      Limpiar
                    </button>
                  </div>

                  {/* Browser Notification request banner if permission is default */}
                  {notifPermission === "default" && (
                    <div className="p-2.5 bg-blue-50 border-b border-blue-100 flex flex-col items-center text-center">
                      <p className="text-[10px] text-blue-900 font-semibold mb-1.5">¿Habilitar alertas de escritorio del navegador?</p>
                      <button
                        onClick={requestNotificationPermission}
                        className="py-1 px-3 bg-blue-900 hover:bg-blue-800 text-white text-[10px] font-bold rounded-lg cursor-pointer shadow-xs transition-colors"
                      >
                        Habilitar Notificaciones
                      </button>
                    </div>
                  )}

                  <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-xs text-gray-400 font-medium">
                        No hay nuevas alertas registradas. Se mostrarán aquí conforme se emitan boletos.
                      </div>
                    ) : (
                      notifications.map((notif) => (
                        <div key={notif.id} className="p-3 hover:bg-gray-50 flex items-start space-x-2.5 transition-colors">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shrink-0"></span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-900">
                              <span className="font-black text-blue-950">{notif.vendedor}</span> vendió <strong className="text-emerald-700">{notif.monto}</strong>
                            </p>
                            <div className="flex justify-between items-center mt-1 text-[10px] text-gray-400 font-mono">
                              <span>Juego: {notif.juego} • Ticket #{notif.ticketNum}</span>
                              <span>{notif.hora ? (notif.hora.includes(":") ? formatTo12Hour(notif.hora) : notif.hora) : formatTo12HourTime(notif.timestamp)}</span>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  
                  <div className="p-2 bg-gray-50 text-center border-t border-gray-100">
                    <span className="text-[9px] text-gray-400 font-mono tracking-widest uppercase font-bold">FCM / SSE en Vivo</span>
                  </div>
                </div>
              )}
            </div>

            <button
              id="download-thermal-report-btn"
              onClick={downloadThermalReportPDF}
              className="flex items-center space-x-2 py-2 px-4 min-h-[44px] bg-blue-900 hover:bg-blue-800 text-white rounded-xl border border-blue-950 shadow-md font-sans font-black text-xs uppercase tracking-wider cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0"
              title="Descargar reporte formateado para impresora térmica de 80mm"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Reporte PDF (80mm)</span>
            </button>

            <button
              id="refresh-all-btn"
              onClick={async () => {
                setSubmitting(true);
                await Promise.all([onRefreshConfig(), onRefreshSales(), onRefreshUsers()]);
                setSubmitting(false);
              }}
              className="flex items-center space-x-2 py-2 px-4 min-h-[44px] bg-white hover:bg-gray-100 text-gray-700 rounded-xl border border-gray-300 shadow-xs font-sans font-bold text-xs uppercase tracking-wider cursor-pointer transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${submitting ? "animate-spin" : ""}`} />
              <span>Sincronizar</span>
            </button>
          </div>
        </div>

        {/* Feedback Messages */}
        {alertText && (
          <div className="mb-6 p-4 bg-red-100 border-l-4 border-[#EF4444] rounded-xl text-red-900 font-sans text-xs flex items-start space-x-2.5 shadow-xs">
            <AlertCircle className="w-4.5 h-4.5 text-[#EF4444] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-sm mb-0.5">Alerta de error</span>
              <span className="font-medium">{alertText}</span>
            </div>
          </div>
        )}

        {successText && (
          <div className="mb-6 p-4 bg-emerald-100 border-l-4 border-[#10B981] rounded-xl text-emerald-900 font-sans text-xs flex items-start space-x-2.5 shadow-xs animate-bounce">
            <CheckCircle className="w-4.5 h-4.5 text-[#10B981] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold block text-sm mb-0.5">Proceso completado</span>
              <span className="font-medium">{successText}</span>
            </div>
          </div>
        )}

        {/* Búsqueda Global de Tickets por QR / ID */}
        <div className="bg-white p-4 rounded-2xl border border-gray-300 shadow-xs mb-6 space-y-3">
          <div className="flex items-center space-x-2">
            <QrCode className="w-5 h-5 text-blue-900 shrink-0" />
            <h3 className="font-display font-black text-sm text-gray-900 uppercase tracking-wider">
              Motor de Búsqueda Centralizado de Tickets
            </h3>
          </div>
          <p className="text-[11px] text-gray-500 font-sans">
            Busque e investigue instantáneamente un ticket ingresando su ID único (ej. <code className="bg-gray-100 px-1 py-0.5 rounded font-mono font-bold text-blue-900">T-00001</code>), código de firma, o pegando/escaneando la URL del código QR de verificación.
          </p>
          <form onSubmit={handleTicketQrSearch} className="flex gap-2 max-w-2xl">
            <div className="relative flex-1">
              <input
                type="text"
                value={qrSearchInput}
                onChange={(e) => setQrSearchInput(e.target.value)}
                placeholder="Ingrese ID de ticket o enlace del código QR (Presione Enter)..."
                className="w-full pl-9 pr-10 py-2.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-xl text-xs font-sans font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
              />
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-[14px]" />
              {/* Lupa para forzar submit si no quieren presionar enter */}
              <button type="submit" className="absolute right-2 top-2 p-1.5 text-gray-400 hover:text-blue-600 transition-colors cursor-pointer">
                <Search className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="px-5 py-2.5 min-h-[44px] bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-display font-black tracking-wider uppercase transition-colors flex items-center justify-center space-x-2 cursor-pointer shadow-sm shrink-0"
            >
              <QrCode className="w-4 h-4" />
              <span>Verificar QR / ID</span>
            </button>
          </form>
          {qrSearchError && (
            <div className="text-xs text-red-600 font-sans font-medium animate-pulse">
              ⚠️ {qrSearchError}
            </div>
          )}
        </div>

        {/* SECTION 1: MONITOR EN VIVO */}
        {activeSection === "dashboard" && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Summary Dashboard Section (2x2 Grid) */}
            <div id="summary-dashboard" className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              {/* Widget 1: Recaudación de Hoy */}
              <button
                onClick={() => {
                  const el = document.getElementById("live-feed-card");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
                className="w-full text-left bg-white p-5 rounded-2xl border border-gray-300 shadow-xs flex items-center justify-between hover:border-blue-500 hover:shadow-md active:scale-99 transition-all cursor-pointer min-h-[120px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <div className="space-y-1">
                  <span className="text-[10px] font-display font-black text-gray-400 uppercase tracking-widest block">Recaudación Total Hoy</span>
                  <span className="font-display font-black text-2xl text-blue-900 block">
                    C$ {(grandTotalCs || 0).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono block">
                    Incluye USD calculados a C$ {config.tasa_cambio}
                  </span>
                </div>
                <div className="p-3.5 bg-blue-50 text-blue-900 rounded-xl shrink-0">
                  <TrendingUp className="w-6 h-6 stroke-[2.5]" />
                </div>
              </button>

              {/* Widget 2: Vendedores Activos */}
              <button
                onClick={() => {
                  setActiveSection("usuarios");
                  setIsSidebarOpen(false);
                }}
                className="w-full text-left bg-white p-5 rounded-2xl border border-gray-300 shadow-xs flex items-center justify-between hover:border-emerald-500 hover:shadow-md active:scale-99 transition-all cursor-pointer min-h-[120px] focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <div className="space-y-1">
                  <span className="text-[10px] font-display font-black text-gray-400 uppercase tracking-widest block">Presencia de Ventas</span>
                  <span className="font-display font-black text-2xl text-emerald-700 block">
                    {onlineSellersCount} / {totalSellersCount} En Línea
                  </span>
                  <span className="text-[10px] text-gray-500 font-sans block">
                    {activeSellers.length} vendedores registrados. Administrar accesos ➔
                  </span>
                </div>
                <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-xl shrink-0">
                  <Users className="w-6 h-6 stroke-[2.5]" />
                </div>
              </button>

              {/* Widget 4: Tickets Emitidos */}
              <button
                onClick={() => {
                  const el = document.getElementById("live-feed-card");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                }}
                className="w-full text-left bg-white p-5 rounded-2xl border border-gray-300 shadow-xs flex items-center justify-between hover:border-purple-500 hover:shadow-md active:scale-99 transition-all cursor-pointer min-h-[120px] focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <div className="space-y-1">
                  <span className="text-[10px] font-display font-black text-gray-400 uppercase tracking-widest block">Tickets Emitidos</span>
                  <span className="font-display font-black text-2xl text-purple-700 block">
                    {activeSales.length} Activos
                  </span>
                  <span className="text-[10px] text-red-600 font-sans block font-semibold">
                    {voidedSales.length} Anulados (pérdidas prevenidas)
                  </span>
                </div>
                <div className="p-3.5 bg-purple-50 text-purple-600 rounded-xl shrink-0">
                  <FileText className="w-6 h-6 stroke-[2.5]" />
                </div>
              </button>

            </div>

            {/* Split Grid: Presence Monitor & Custom SVG Analytics Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Column: Presence grid (simulating Realtime DB live indicators) */}
              <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-gray-300 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-4 pb-2 border-b border-gray-100">
                    <span className="font-display font-black text-xs text-gray-800 uppercase tracking-wider block">Estado de Presencia</span>
                    <span className="text-[9px] font-mono bg-blue-100 text-blue-900 px-2 py-0.5 rounded uppercase font-bold">Tiempo Real</span>
                  </div>
                  
                  <div className="space-y-3">
                    {activeSellers.map((v) => (
                      <div key={v.id} className="flex justify-between items-center p-2.5 hover:bg-gray-50 rounded-xl border border-gray-200 transition-colors">
                        <div className="flex items-center space-x-2.5">
                          {/* Seller status bullet indicator */}
                          <button
                            id={`presence-bubble-${v.id}`}
                            onClick={() => handleToggleSimulatedPresence(v)}
                            className="w-11 h-11 flex items-center justify-center relative cursor-pointer group shrink-0"
                            title="Haz clic para alternar estado simulado en tiempo real"
                          >
                            <span className={`w-3.5 h-3.5 rounded-full block border border-white ${
                              v.conexion === "online" ? "bg-[#10B981]" : "bg-gray-400"
                            }`}></span>
                            <span className="absolute left-0 top-10 hidden group-hover:block bg-gray-900 text-white text-[8px] py-0.5 px-1 rounded whitespace-nowrap z-10 font-mono">
                              Alternar Estado
                            </span>
                          </button>

                          <div>
                            <span className={`text-xs font-display font-black block tracking-tight ${v.activo ? "text-gray-900" : "text-gray-400 line-through"}`}>
                              {v.nombre}
                            </span>
                            <span className="text-[9px] text-gray-400 font-mono uppercase block mt-0.5">
                              {v.conexion === "online" ? "● EN LÍNEA" : "○ DESCONECTADO"}
                            </span>
                          </div>
                        </div>

                        <div>
                          {v.activo ? (
                            <span className="text-[9px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-black uppercase">Activo</span>
                          ) : (
                            <span className="text-[9px] bg-red-50 text-[#EF4444] px-2 py-0.5 rounded font-black uppercase">Suspendido</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 text-[10px] text-gray-500 leading-tight">
                  <span className="font-bold text-blue-900 uppercase">💡 Consejos de Simulación:</span> Al hacer clic en los puntitos verde/gris de los vendedores, puedes simular su conexión, lo que se refleja automáticamente en el sistema de presencia estilo WhatsApp.
                </div>
              </div>

              {/* Right Column: Custom SVG High-Contrast Charts */}
              <div id="live-feed-card" className="lg:col-span-8 bg-white p-5 rounded-2xl border border-gray-300 shadow-xs space-y-6">
                <div>
                  <span className="font-display font-black text-xs text-gray-800 uppercase tracking-wider block mb-4">Ventas Recaudadas por Tipo de Juego (C$)</span>
                  
                  {/* Custom High-Contrast SVG Bar Chart */}
                  <div className="space-y-4">
                    {["Diaria", "Premia2", "La Grande"].map((juego) => {
                      const stats = gameStats[juego] || { cs: 0, usd: 0, count: 0 };
                      const totalInCs = stats.cs + (stats.usd * config.tasa_cambio);
                      const percentage = grandTotalCs > 0 ? (totalInCs / grandTotalCs) * 100 : 0;

                      return (
                        <div key={juego} className="space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-display font-black text-gray-900 uppercase">{juego} ({stats.count} tks)</span>
                            <span className="font-mono font-black text-blue-900">
                              C$ {(totalInCs || 0).toLocaleString("es-NI", { maximumFractionDigits: 2 })} ({percentage.toFixed(0)}%)
                            </span>
                          </div>
                          
                          {/* Custom SVG horizontal bar acting as progress */}
                          <div className="h-4 w-full bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                            <div 
                              className={`h-full transition-all duration-1000 ${
                                juego === "Diaria" ? "bg-blue-900" : juego === "Premia2" ? "bg-emerald-600" : "bg-yellow-500"
                              }`}
                              style={{ width: `${Math.max(3, percentage)}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <span className="font-display font-black text-xs text-gray-800 uppercase tracking-wider block mb-3">Live Feed de Transacciones</span>
                  
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {activeSales.slice().reverse().map((sale) => (
                      <div key={sale.id} className="flex justify-between items-center text-[11px] p-2 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-center space-x-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
                          <span><strong>{sale.nombre_vendedor}</strong> vendió el <strong>[{sale.numero_jugado}]</strong> ({sale.juego})</span>
                        </div>
                        <span className="font-mono font-bold text-gray-900">{sale.moneda} {sale.monto_pago.toFixed(2)}</span>
                      </div>
                    ))}
                    {activeSales.length === 0 && (
                      <div className="text-center py-4 text-xs text-gray-400">Sin transacciones recientes en el feed.</div>
                    )}
                  </div>
                </div>

              </div>

            </div>

            {/* Hourly Trend Chart using Recharts */}
            <div className="bg-white p-6 rounded-2xl border border-gray-300 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-gray-100 pb-3 gap-2">
                <div>
                  <span className="font-display font-black text-xs text-gray-800 uppercase tracking-wider block">Tendencia de Ventas por Hora (Hoy)</span>
                  <p className="text-[10px] text-gray-400 font-sans mt-0.5">Muestra el volumen de ventas en C$ y cantidad de tickets emitidos durante el día actual por hora.</p>
                </div>
                <div className="flex items-center space-x-3 text-[10px] font-mono">
                  <span className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-[#1E3A8A] block"></span>
                    <span className="text-gray-600 font-bold">Ventas (C$)</span>
                  </span>
                  <span className="flex items-center space-x-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-[#10B981] block"></span>
                    <span className="text-gray-600 font-bold">Tickets</span>
                  </span>
                </div>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={hourlyData}
                    margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1E3A8A" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#1E3A8A" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorTickets" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                    <XAxis 
                      dataKey="hora" 
                      stroke="#9CA3AF" 
                      fontSize={9}
                      tickLine={false}
                      axisLine={false}
                      dy={5}
                    />
                    <YAxis 
                      yAxisId="left"
                      stroke="#1E3A8A" 
                      fontSize={9}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `C$ ${val}`}
                    />
                    <YAxis 
                      yAxisId="right"
                      orientation="right"
                      stroke="#10B981" 
                      fontSize={9}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => `${val} tks`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1E293B', border: 'none', borderRadius: '12px', color: '#FFF', fontSize: '11px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      labelStyle={{ fontWeight: 'black', color: '#93C5FD' }}
                    />
                    <Area 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="Ventas C$" 
                      stroke="#1E3A8A" 
                      strokeWidth={2.5}
                      fillOpacity={1} 
                      fill="url(#colorSales)" 
                    />
                    <Area 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="Tickets" 
                      stroke="#10B981" 
                      strokeWidth={1.5}
                      fillOpacity={1} 
                      fill="url(#colorTickets)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        )}

        {/* SECTION 3: CONFIGURACIÓN SISTEMA */}
        {activeSection === "config" && (
          <div className="space-y-6 animate-fade-in">
            
            {/* Global parameters / Tasa de Cambio */}
            <div className="bg-white p-6 rounded-2xl border border-gray-300 shadow-xs space-y-4">
              <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2">1. Parámetros Económicos Globales</span>
              
              <div className="max-w-md space-y-3">
                <div>
                  <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Tasa de Cambio Global (C$ por 1.00 USD)</label>
                  <p className="text-[11px] text-gray-400 font-sans mb-2">Este valor se propaga automáticamente a los vendedores para realizar cálculos de caja y ventas en tiempo real.</p>
                  
                  <div className="flex space-x-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-bold text-gray-400">C$</span>
                      <input
                        id="exchange-rate-config"
                        type="number"
                        step="0.01"
                        value={exchangeRateInput}
                        onChange={(e) => setExchangeRateInput(e.target.value)}
                        className="w-full pl-10 pr-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl font-mono text-sm font-bold text-gray-900 focus:outline-none focus:border-blue-900"
                      />
                    </div>
                    <button
                      id="save-exchange-btn"
                      onClick={handleSaveExchangeRate}
                      disabled={submitting}
                      className="py-2.5 px-5 min-h-[44px] flex items-center justify-center bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-display font-bold text-xs uppercase tracking-wider cursor-pointer transition-all border-b-2 border-blue-950 disabled:opacity-50"
                    >
                      Actualizar Tasa
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Ticket printing template builder */}
            <div className="bg-white p-6 rounded-2xl border border-gray-300 shadow-xs space-y-4">
              <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2">2. Constructor de Diseño de Ticket de Lotería</span>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Form fields */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Título de la Empresa <span className="text-gray-400 normal-case">(Opcional)</span></label>
                    <input
                      id="ticket-title-config"
                      type="text"
                      value={ticketTitleInput}
                      onChange={(e) => setTicketTitleInput(e.target.value)}
                      className="w-full px-3 py-2.5 min-h-[44px] bg-white border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Indicaciones del Ticket</label>
                    <input
                      id="ticket-ruc-config"
                      type="text"
                      value={ticketRucInput}
                      onChange={(e) => setTicketRucInput(e.target.value)}
                      className="w-full px-3 py-2.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Pie de Página (Mensaje)</label>
                    <textarea
                      id="ticket-footer-config"
                      rows={2}
                      value={ticketFooterInput}
                      onChange={(e) => setTicketFooterInput(e.target.value)}
                      className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl font-sans text-xs font-medium text-gray-900 focus:outline-none focus:border-blue-900"
                    />
                  </div>

                  <button
                    id="save-ticket-config-btn"
                    onClick={handleSaveTicketTemplate}
                    disabled={submitting}
                    className="py-2.5 px-5 min-h-[44px] flex items-center justify-center bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-display font-bold text-xs uppercase tracking-wider cursor-pointer transition-all border-b-2 border-blue-950 disabled:opacity-50"
                  >
                    Guardar Diseño
                  </button>
                </div>

                {/* Preview Card */}
                <div className="bg-gray-100 p-4 rounded-2xl flex flex-col items-center justify-center border border-gray-200">
                  <span className="text-[10px] font-display font-black text-gray-400 uppercase tracking-wider mb-2">Vista Previa Impresión Térmica</span>
                  <div className="bg-white border border-gray-300 shadow-sm p-4 rounded-md w-64 font-mono text-[9px] text-gray-700 relative select-none">
                    <div className="flex justify-center mb-1">
                      <img src="/logo.png" alt={config?.formato_ticket?.titulo || "Logo del Sistema"} className="h-8 w-auto object-contain" />
                    </div>
                    {ticketTitleInput?.trim() && (
                      <div className="text-center font-bold text-gray-950 mb-0.5 uppercase tracking-wide">{ticketTitleInput.toUpperCase()}</div>
                    )}
                    <div className="text-center text-[8px] text-gray-500 font-sans mb-2">{ticketRucInput || "INDICACIONES DEL TICKET"}</div>
                    <div className="border-t border-dashed border-gray-300 my-1.5"></div>
                    <div>TICKET: #0001045</div>
                    <div>VENDEDOR: Diana Martínez</div>
                    <div className="flex justify-between items-center text-[7px] text-gray-600 mt-0.5 font-bold">
                      <span>Lunes 06 de Julio del 2026</span>
                      <span>15:00:23</span>
                    </div>
                    <div className="border-t border-dashed border-gray-300 my-1.5"></div>
                    <div className="text-center bg-gray-50 p-1.5 border border-gray-100 rounded">
                      <div className="font-bold">DIARIA 3:00 PM</div>
                      <div className="text-sm font-black text-gray-950 my-1">NUM: [ 45 ]</div>
                      <div>MONTO: C$ 100.00</div>
                    </div>
                    <div className="border-t border-dashed border-gray-300 my-1.5"></div>
                    <div className="text-center text-[7.5px] italic text-gray-500 mb-2">{ticketFooterInput || "Gracias por su compra."}</div>
                    
                    {/* Fake QR Code */}
                    <div className="flex flex-col items-center justify-center mt-1">
                      <QrCode className="w-10 h-10 text-gray-900" strokeWidth={1.2} />
                      <span className="text-[6px] text-gray-400 font-mono tracking-widest mt-0.5">0001045-987654</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Lottery Draws scheduling */}
            <div className="bg-white p-6 rounded-2xl border border-gray-300 shadow-xs space-y-4">
              <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2">3. Programación de Sorteos y Cierre de Tiempo</span>
              <p className="text-xs text-gray-400 font-sans">
                Determine los horarios límites en que los sorteos bloquean automáticamente las ventas. Los servidores rechazan cualquier ticket ingresado después de la hora de cierre de manera infranqueable.
              </p>

              {/* List of active draws grouped by country */}
              <div className="space-y-4">
                {config.sorteos.length === 0 ? (
                  <p className="text-xs text-gray-400 font-semibold text-center py-6">No hay sorteos programados.</p>
                ) : (
                  ["Nicaragua", "Honduras", "El Salvador", "Costa Rica", "La Primera"]
                    .filter((pais) => config.sorteos.some((s) => getCountryFromSorteo(s.nombre) === pais))
                    .map((pais) => (
                      <div key={pais} className="border border-gray-200 bg-gray-50/40 p-4 rounded-2xl space-y-3">
                        <div className="flex items-center space-x-2 border-b border-gray-100 pb-2">
                          <span className="text-[11px] font-display font-black text-blue-900 uppercase tracking-widest">{pais}</span>
                          <span className="text-[9px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded-full font-black">
                            {config.sorteos.filter((s) => getCountryFromSorteo(s.nombre) === pais).length}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {config.sorteos
                            .filter((s) => getCountryFromSorteo(s.nombre) === pais)
                            .map((s) => (
                              <div key={s.id} className="p-3 bg-white rounded-xl border border-gray-200 flex justify-between items-center shadow-xs">
                                <div>
                                  <span className="font-display font-black text-xs text-gray-950 block">{s.nombre}</span>
                                  <span className="text-[10px] text-gray-500 font-mono block mt-0.5">
                                    Juego: {s.juego} | Sorteo: {formatTo12Hour(s.hora_sorteo)}
                                  </span>
                                  <span className="text-[10px] text-[#EF4444] font-mono block font-bold">
                                    Cierre de Ventas: {formatTo12Hour(s.hora_cierre)}
                                  </span>
                                </div>
                                
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => handleEditSorteoClick(s)}
                                    className="w-9 h-9 flex items-center justify-center bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200 cursor-pointer shrink-0"
                                    title="Editar Sorteo"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    id={`delete-sorteo-${s.id}`}
                                    onClick={() => handleDeleteSorteo(s.id)}
                                    className="w-9 h-9 flex items-center justify-center bg-red-50 text-[#EF4444] hover:bg-red-100 rounded-lg transition-colors border border-red-150 cursor-pointer shrink-0"
                                    title="Eliminar Sorteo"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))
                )}
              </div>

              {/* Form to add drawing */}
              <div className="pt-4 border-t border-gray-100 space-y-3">
                <span className="font-display font-black text-xs text-gray-700 uppercase tracking-wider block">
                  {sorteoEditando ? "Editar Sorteo" : "Agregar Nuevo Sorteo"}
                  {sorteoEditando && (
                    <button onClick={cancelEditSorteo} className="ml-2 text-[10px] text-blue-600 hover:text-blue-800 underline align-baseline" type="button">Cancelar</button>
                  )}
                </span>
                
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                  <div>
                    <label className="block text-[10px] font-sans font-bold text-gray-500 uppercase mb-1">País</label>
                    <select
                      id="new-sorteo-pais"
                      value={newSorteoPais}
                      onChange={(e) => setNewSorteoPais(e.target.value)}
                      className="w-full px-2 py-2 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-semibold focus:outline-none"
                    >
                      <option value="Nicaragua">Nicaragua</option>
                      <option value="Honduras">Honduras</option>
                      <option value="El Salvador">El Salvador</option>
                      <option value="La Primera">La Primera</option>
                      <option value="Costa Rica">Costa Rica (La Tica)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-sans font-bold text-gray-500 uppercase mb-1">Juego</label>
                    <select
                      id="new-sorteo-juego"
                      value={newSorteoJuego}
                      onChange={(e) => setNewSorteoJuego(e.target.value)}
                      className="w-full px-2 py-2 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-semibold focus:outline-none"
                    >
                      {((newSorteoPais === "Nicaragua" ? ["Diaria", "Fechas", "Jugá 3", "Premia2", "Terminación 2", "Sabadito"] :
                         newSorteoPais === "Honduras" ? ["La Diaria", "Premia2", "Pega 3", "Súper Premio"] :
                         newSorteoPais === "El Salvador" ? ["Diaria"] :
                         newSorteoPais === "La Primera" ? ["La Primera"] :
                         newSorteoPais === "Costa Rica" ? ["3 Monazos", "Tica"] : ["Diaria"]) as string[]).map((game) => (
                        <option key={game} value={game}>{game}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-sans font-bold text-gray-500 uppercase mb-1">Nombre Horario</label>
                    <input
                      id="new-sorteo-nombre"
                      type="text"
                      placeholder="E.G. TARDE 3:00 PM"
                      value={newSorteoNombre}
                      onChange={(e) => setNewSorteoNombre(e.target.value.toUpperCase())}
                      className="w-full px-2 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-bold text-gray-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-sans font-bold text-gray-500 uppercase mb-1">Hora Sorteo</label>
                    <div className="flex space-x-1">
                      <select
                        value={newSorteoHourDraw}
                        onChange={(e) => setNewSorteoHourDraw(e.target.value)}
                        className="w-1/3 px-1 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-bold focus:outline-none"
                      >
                        {["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <select
                        value={newSorteoMinDraw}
                        onChange={(e) => setNewSorteoMinDraw(e.target.value)}
                        className="w-1/3 px-1 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-bold focus:outline-none"
                      >
                        {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        value={newSorteoAmPmDraw}
                        onChange={(e) => setNewSorteoAmPmDraw(e.target.value)}
                        className="w-1/3 px-1 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-bold focus:outline-none"
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-sans font-bold text-gray-500 uppercase mb-1">Hora de Cierre</label>
                    <div className="flex space-x-1">
                      <select
                        value={newSorteoHourCierre}
                        onChange={(e) => setNewSorteoHourCierre(e.target.value)}
                        className="w-1/3 px-1 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-bold focus:outline-none"
                      >
                        {["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"].map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      <select
                        value={newSorteoMinCierre}
                        onChange={(e) => setNewSorteoMinCierre(e.target.value)}
                        className="w-1/3 px-1 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-bold focus:outline-none"
                      >
                        {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <select
                        value={newSorteoAmPmCierre}
                        onChange={(e) => setNewSorteoAmPmCierre(e.target.value)}
                        className="w-1/3 px-1 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-lg text-xs font-bold focus:outline-none"
                      >
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="mt-2">
                  <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Días Habilitados (vacío = todos)</label>
                  <div className="flex flex-wrap gap-1">
                    {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((dia, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setNewSorteoDias(prev => prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx])}
                        className={`px-2 py-1 min-h-[32px] text-[10px] font-bold rounded-lg border transition-all ${
                          newSorteoDias.includes(idx)
                            ? "bg-indigo-600 text-white border-indigo-700"
                            : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        {dia}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  id="add-sorteo-btn"
                  onClick={handleAddSorteo}
                  className="flex items-center justify-center space-x-1 py-2 px-4 min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-bold text-xs rounded-xl border-b-2 border-emerald-700 cursor-pointer shadow-xs"
                >
                  {sorteoEditando ? (
                    <>
                      <Edit2 className="w-4 h-4 stroke-[2.5]" />
                      <span>Actualizar Sorteo</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                      <span>Agregar Sorteo</span>
                    </>
                  )}
                </button>
              </div>

            </div>

          </div>
        )}

        {/* SECTION 4: GESTIÓN DE USUARIOS */}
        {activeSection === "usuarios" && (
          <div className="space-y-6 animate-fade-in">
            {/* Top Bar Actions & Filters */}
            <div className="bg-white p-5 rounded-2xl border border-gray-300 shadow-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* Role Filter */}
                <div className="flex items-center space-x-1.5">
                  <Filter className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-[10px] font-sans font-bold text-gray-500 uppercase">Rol:</span>
                  <select
                    value={userFilterRole}
                    onChange={(e) => setUserFilterRole(e.target.value)}
                    className="px-2.5 py-1.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-lg text-xs font-bold text-gray-900 focus:outline-none"
                  >
                    <option value="TODOS">Todos los Roles</option>
                    <option value="administrador">Administradores</option>
                    <option value="supervisor">Supervisores</option>
                    <option value="vendedor">Vendedores</option>
                  </select>
                </div>

                {/* Region Filter */}
                <div className="flex items-center space-x-1.5">
                  <Globe className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-[10px] font-sans font-bold text-gray-500 uppercase">Región:</span>
                  <select
                    value={userFilterRegion}
                    onChange={(e) => setUserFilterRegion(e.target.value)}
                    className="px-2.5 py-1.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-lg text-xs font-bold text-gray-900 focus:outline-none"
                  >
                    <option value="TODOS">Todas las Regiones</option>
                    <option value="Nicaragua">Nicaragua</option>
                    <option value="Honduras">Honduras</option>
                    <option value="Costa Rica">Costa Rica</option>
                    <option value="El Salvador">El Salvador</option>
                  </select>
                </div>
              </div>

              {/* Add User Buttons */}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  id="open-create-user-modal-btn"
                  onClick={openCreateUserModal}
                  className="w-full sm:w-auto px-5 py-3 min-h-[44px] bg-[#10B981] hover:bg-emerald-500 text-white font-display font-black text-xs uppercase tracking-wider rounded-xl border-b-2 border-emerald-700 shadow-xs flex items-center justify-center space-x-2 cursor-pointer transition-all active:translate-y-0.5 font-bold"
                >
                  <UserPlus className="w-4 h-4 stroke-[2.5]" />
                  <span>Registrar Nuevo Usuario</span>
                </button>
                <button
                  onClick={openCreateAdminModal}
                  className="w-full sm:w-auto px-5 py-3 min-h-[44px] bg-blue-600 hover:bg-blue-500 text-white font-display font-black text-xs uppercase tracking-wider rounded-xl border-b-2 border-blue-800 shadow-xs flex items-center justify-center space-x-2 cursor-pointer transition-all active:translate-y-0.5 font-bold"
                >
                  <Shield className="w-4 h-4 stroke-[2.5]" />
                  <span>Crear Nuevo Admin</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Directory (8 Cols) */}
              <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-gray-300 shadow-xs space-y-4">
                <div className="flex justify-between items-center border-b border-gray-100 pb-3">
                  <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider">Directorio de Personal Autorizado</span>
                  <span className="text-[10px] font-mono font-bold bg-blue-50 text-blue-900 px-2 py-0.5 rounded-md">
                    Total: {users.length}
                  </span>
                </div>

                <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                  {users
                    .filter((u) => {
                      const matchRole = userFilterRole === "TODOS" || u.rol === userFilterRole || (userFilterRole === "administrador" && (u.rol === "admin" || u.rol === "administrador"));
                      const matchRegion = userFilterRegion === "TODOS" || u.region === userFilterRegion;
                      return matchRole && matchRegion;
                    })
                    .map((u) => {
                      const isVendedor = u.rol === "vendedor";
                      const isSupervisor = u.rol === "supervisor";
                      const isOnline = u.conexion === "online";
                      const isActivo = u.estado === "activo" || u.activo;

                      return (
                        <div
                          key={u.id}
                          className={`p-4 rounded-xl border transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 ${
                            isActivo ? "bg-gray-50 border-gray-200 hover:bg-gray-100/50" : "bg-red-50/20 border-red-200/50 grayscale-[20%]"
                          }`}
                        >
                          {/* Left Details */}
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center space-x-2">
                              {/* Connection Bubble */}
                              <span
                                className={`w-2.5 h-2.5 rounded-full inline-block border border-white ${
                                  isOnline ? "bg-[#10B981]" : "bg-gray-400"
                                }`}
                                title={isOnline ? "En Línea" : "Desconectado"}
                              ></span>
                              <span className="font-display font-black text-sm text-gray-950 uppercase tracking-tight">
                                {u.nombre}
                              </span>
                              <span className="text-[9px] font-mono text-gray-400 bg-gray-200/60 px-1.5 py-0.5 rounded">
                                {u.id}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 font-sans">
                              <span className="font-mono font-bold text-blue-950">@{u.usuario || u.email.split("@")[0]}</span>
                              <span className="text-gray-300">|</span>
                              <span className="font-mono">{u.email}</span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <span
                                className={`text-[9px] px-2 py-0.5 rounded font-black uppercase tracking-wider ${
                                  u.rol === "admin" || u.rol === "administrador"
                                    ? "bg-blue-100 text-blue-900 border border-blue-200"
                                    : isSupervisor
                                    ? "bg-purple-100 text-purple-900 border border-purple-200"
                                    : "bg-teal-100 text-teal-900 border border-teal-200"
                                }`}
                              >
                                {u.rol === "admin" || u.rol === "administrador" ? "Administrador" : u.rol}
                              </span>

                              <span className="flex items-center space-x-1 text-[10px] font-bold text-gray-600 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
                                <MapPin className="w-3 h-3 text-red-500 shrink-0" />
                                <span>{u.region || "Nicaragua"}</span>
                              </span>

                              {isVendedor && u.id_supervisor && (
                                <span className="text-[9px] bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded font-bold">
                                  Supervisado por: {users.find((x) => x.id === u.id_supervisor)?.nombre || u.id_supervisor}
                                </span>
                              )}
                              
                              {isSupervisor && (
                                <span className="text-[9px] bg-indigo-50 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded font-bold">
                                  Vendedores Asignados: {u.vendedoresAsignados?.length || 0}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Right Controls */}
                          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-100">
                            {/* Manage Team Button (Only for Supervisors) */}
                            {isSupervisor && (
                              <button
                                onClick={() => setSelectedSupervisorForAssignment(u)}
                                className={`px-2.5 py-1.5 min-h-[44px] flex items-center justify-center rounded-lg text-[10px] font-sans font-bold uppercase tracking-wider cursor-pointer space-x-1 border ${
                                  selectedSupervisorForAssignment?.id === u.id
                                    ? "bg-purple-900 text-white border-purple-900"
                                    : "bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100"
                                }`}
                                title="Gestionar vendedores asignados a este supervisor"
                              >
                                <Link className="w-3.5 h-3.5 shrink-0" />
                                <span>Asignar</span>
                              </button>
                            )}

                            {/* Active/Inactive Status Switch */}
                            {u.id !== user.id && (
                              <button
                                onClick={() => handleToggleUserActive(u)}
                                className={`px-3 py-1.5 min-h-[44px] flex items-center justify-center rounded-lg text-[10px] font-display font-black uppercase tracking-wider transition-all cursor-pointer space-x-1.5 border shadow-xs ${
                                  isActivo
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                                    : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                                }`}
                              >
                                {isActivo ? (
                                  <>
                                    <Unlock className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                                    <span>Activo</span>
                                  </>
                                ) : (
                                  <>
                                    <Lock className="w-3.5 h-3.5 stroke-[2.5] shrink-0" />
                                    <span>Bloqueado</span>
                                  </>
                                )}
                              </button>
                            )}

                            {/* Edit Button */}
                            <button
                              onClick={() => openEditUserModal(u)}
                              className="w-11 h-11 flex items-center justify-center bg-gray-50 text-gray-700 hover:bg-gray-200 border border-gray-300 rounded-lg transition-colors cursor-pointer shrink-0"
                              title="Editar Usuario"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>

                            {/* Delete Button */}
                            {u.id !== user.id && (
                              <button
                                onClick={() => setDeletingUser(u)}
                                className="w-11 h-11 flex items-center justify-center bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-lg transition-colors cursor-pointer shrink-0"
                                title="Eliminar Usuario de Producción"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                  {users.filter((u) => {
                    const matchRole = userFilterRole === "TODOS" || u.rol === userFilterRole || (userFilterRole === "administrador" && (u.rol === "admin" || u.rol === "administrador"));
                    const matchRegion = userFilterRegion === "TODOS" || u.region === userFilterRegion;
                    return matchRole && matchRegion;
                  }).length === 0 && (
                    <div className="text-center py-12 text-sm text-gray-400 font-medium border border-dashed border-gray-300 rounded-2xl">
                      No se encontraron usuarios activos con los filtros indicados.
                    </div>
                  )}
                </div>
              </div>

              {/* Assignment (4 Cols) */}
              <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-gray-300 shadow-xs flex flex-col justify-between min-h-[40vh] space-y-4">
                <div>
                  <div className="flex items-center space-x-2 border-b border-gray-100 pb-3 mb-4">
                    <Link className="w-4 h-4 text-purple-700 stroke-[2.5]" />
                    <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider">
                      Asignación de Vendedores
                    </span>
                  </div>

                  {selectedSupervisorForAssignment ? (
                    <div className="space-y-4">
                      {/* Active Supervisor Bio */}
                      <div className="p-3 bg-purple-50 rounded-xl border border-purple-200">
                        <span className="text-[10px] font-sans font-bold text-purple-800 uppercase block">Supervisor Seleccionado</span>
                        <span className="font-display font-black text-sm text-purple-950 block mt-0.5">{selectedSupervisorForAssignment.nombre}</span>
                        <span className="text-[9px] font-mono text-purple-700 block mt-0.5">Región: {selectedSupervisorForAssignment.region || "Nicaragua"}</span>
                      </div>

                      {/* List of Vendors for Assignment */}
                      <span className="text-[10px] font-sans font-bold text-gray-500 uppercase tracking-wider block">Marque para vincular a este supervisor:</span>
                      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                        {users
                          .filter((u) => {
                            if (u.rol !== "vendedor") return false;
                            const isCurrentlyAssigned = selectedSupervisorForAssignment.vendedoresAsignados?.includes(u.id);
                            const hasNoSupervisor = !u.id_supervisor || u.id_supervisor === "";
                            return isCurrentlyAssigned || hasNoSupervisor;
                          })
                          .map((seller) => {
                            const isChecked = selectedSupervisorForAssignment.vendedoresAsignados?.includes(seller.id);

                            return (
                              <label
                                key={seller.id}
                                className="flex items-center justify-between p-2.5 min-h-[44px] bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer"
                              >
                                <div className="flex items-center space-x-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked || false}
                                    onChange={(e) => handleToggleSellerToSupervisor(selectedSupervisorForAssignment, seller.id, e.target.checked)}
                                    className="w-4.5 h-4.5 text-purple-600 border-gray-300 rounded focus:ring-purple-500 cursor-pointer"
                                  />
                                  <div>
                                    <span className="text-xs font-bold text-gray-900 block">{seller.nombre}</span>
                                    {seller.id_supervisor && seller.id_supervisor !== selectedSupervisorForAssignment.id && (
                                      <span className="text-[9px] text-amber-600 font-semibold block">Tiene otro supervisor</span>
                                    )}
                                    <span className="text-[9px] text-gray-400 font-mono block">@{seller.usuario}</span>
                                  </div>
                                </div>
                                {isChecked && (
                                  <span className="text-[9px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-black uppercase">
                                    Vinculado
                                  </span>
                                )}
                              </label>
                            );
                          })}

                        {users.filter((u) => {
                          if (u.rol !== "vendedor") return false;
                          const isCurrentlyAssigned = selectedSupervisorForAssignment.vendedoresAsignados?.includes(u.id);
                          const hasNoSupervisor = !u.id_supervisor || u.id_supervisor === "";
                          return isCurrentlyAssigned || hasNoSupervisor;
                        }).length === 0 && (
                          <p className="text-xs text-gray-400 text-center py-6 font-semibold">
                            No hay vendedores registrados sin supervisor asignado en el sistema.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center text-center py-16 space-y-3">
                      <div className="p-3 bg-purple-50 text-purple-700 rounded-full border border-purple-100">
                        <User className="w-8 h-8" />
                      </div>
                      <div>
                        <span className="font-display font-black text-xs text-gray-800 uppercase block">Sin Selección</span>
                        <p className="text-[11px] text-gray-400 max-w-[200px] mt-1">
                          Haga clic en el botón <strong className="text-purple-700 uppercase">Asignar</strong> de cualquier supervisor en el directorio para gestionar su equipo.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-gray-100 text-[10px] text-gray-400 font-sans leading-tight">
                  <span className="font-bold text-purple-700 block uppercase mb-0.5">VINCULACIÓN BIDIRECCIONAL:</span>
                  Al marcar un vendedor, se asignará al supervisor y el vendedor se actualizará con el supervisor de forma recíproca.
                </div>
              </div>

            </div>

          </div>
        )}

        {/* SECTION 5: RESULTADOS DE SORTEOS */}
        {activeSection === "resultados" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left side: Enter new winning number */}
              <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-300 shadow-xs">
                <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2 mb-4">Registrar Número Ganador</span>
                
                <form onSubmit={handleSaveResultado} className="space-y-4">
                  <div>
                    <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">1. Seleccionar País</label>
                    <select
                      value={selectedPaisResultados}
                      onChange={(e) => {
                        setSelectedPaisResultados(e.target.value);
                        setSelectedSorteoResultados(""); // reset
                      }}
                      className="w-full px-3 py-2.5 min-h-[44px] bg-white border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900"
                    >
                      <option value="Nicaragua">Nicaragua (NI)</option>
                      <option value="Honduras">Honduras (HN)</option>
                      <option value="El Salvador">El Salvador (SV)</option>
                      <option value="La Primera">La Primera (LP)</option>
                      <option value="Costa Rica">Costa Rica (CR)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">2. Sorteo</label>
                    <select
                      value={selectedSorteoResultados}
                      onChange={(e) => setSelectedSorteoResultados(e.target.value)}
                      className="w-full px-3 py-2.5 min-h-[44px] bg-white border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900"
                    >
                      <option value="">-- Seleccione Sorteo --</option>
                      {config.sorteos
                        .filter((s) => {
                          if (selectedPaisResultados === "Nicaragua") return s.nombre.includes("(NI)");
                          if (selectedPaisResultados === "Honduras") return s.nombre.includes("(HN)");
                          if (selectedPaisResultados === "El Salvador") return s.nombre.includes("(SV)");
                          if (selectedPaisResultados === "La Primera") return s.nombre.includes("(LP)");
                          if (selectedPaisResultados === "Costa Rica") return s.nombre.includes("(CR)");
                          return false;
                        })
                        .map((s) => (
                          <option key={s.id} value={s.id}>{s.nombre}</option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Fecha</label>
                      <input
                        type="date"
                        value={fechaResultadosInput}
                        onChange={(e) => setFechaResultadosInput(e.target.value)}
                        className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none font-mono"
                      />
                    </div>

                    <div>
                      {(() => {
                        const matchedSorteo = config.sorteos.find(s => s.id === selectedSorteoResultados);
                        const matchedJuego = matchedSorteo ? matchedSorteo.juego : "";

                        if (matchedJuego === "Fechas") {
                          return (
                            <div className="flex flex-col space-y-1">
                              <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider">Número Ganador</label>
                              <div className="flex space-x-1">
                                <select
                                  value={resultFechasDia}
                                  onChange={(e) => setResultFechasDia(e.target.value)}
                                  className="w-1/2 px-2 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:outline-none"
                                >
                                  {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map(day => (
                                    <option key={day} value={day}>{day}</option>
                                  ))}
                                </select>
                                <select
                                  value={resultFechasMes}
                                  onChange={(e) => setResultFechasMes(e.target.value)}
                                  className="w-1/2 px-2 py-1.5 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:outline-none"
                                >
                                  {["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"].map(mes => (
                                    <option key={mes} value={mes}>{mes}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        }

                        // Determine placeholder and help texts
                        let placeholder = "ej: 45";
                        if (matchedJuego === "Premia2") {
                          placeholder = "ej: 4588 (4 digitos)";
                        } else if (matchedJuego === "Pega 3") {
                          placeholder = "ej: 123456 (6 digitos)";
                        } else if (matchedJuego === "Súper Premio") {
                          placeholder = "ej: 12 dígitos (rango 01-33)";
                        } else if (matchedJuego === "Jugá 3" || matchedJuego === "3 Monazos") {
                          placeholder = "ej: 456 (3 dígitos)";
                        }

                        return (
                          <>
                            <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Número Ganador</label>
                            <input
                              type="text"
                              placeholder={placeholder}
                              value={winningNumberInput}
                              onChange={(e) => setWinningNumberInput(e.target.value)}
                              className="w-full px-3 py-2.5 min-h-[44px] bg-white border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none font-mono"
                            />
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3 min-h-[44px] flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white font-display font-black text-xs uppercase tracking-wider rounded-xl border-b-2 border-emerald-800 shadow-xs cursor-pointer space-x-2"
                  >
                    <span>{submitting ? "PUBLICANDO..." : "PUBLICAR RESULTADO"}</span>
                  </button>
                </form>
              </div>

              {/* Right side: Published winners registry list */}
              <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-300 shadow-xs">
                <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2 mb-4">Registro Histórico de Resultados</span>
                
                {resultsList.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400 font-medium">No se han registrado números ganadores oficialmente todavía.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-sans">
                      <thead>
                        <tr className="bg-gray-150 text-gray-600 uppercase text-[10px] font-mono tracking-wider">
                          <th className="p-2.5 rounded-l-lg">Fecha</th>
                          <th className="p-2.5">País</th>
                          <th className="p-2.5">Sorteo</th>
                          <th className="p-2.5">Nº Ganador</th>
                          <th className="p-2.5 rounded-r-lg text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {resultsList.map((res: any) => (
                          <tr key={res.id} className="hover:bg-gray-50">
                            <td className="p-2.5 font-mono text-gray-500">{res.fecha}</td>
                            <td className="p-2.5 font-semibold text-gray-700 uppercase">{res.pais}</td>
                            <td className="p-2.5 font-bold text-indigo-900 uppercase text-[10px]">{res.sorteo}</td>
                            <td className="p-2.5">
                              <span className="bg-amber-100 border border-amber-300 text-amber-900 font-mono font-black text-xs px-2.5 py-0.5 rounded-lg">
                                {res.numero_ganador}
                              </span>
                            </td>
                            <td className="p-2.5 text-right">
                              <button
                                onClick={() => handleDeleteResultado(res.id)}
                                className="w-11 h-11 inline-flex items-center justify-center text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200 transition-all cursor-pointer shrink-0"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* SECTION 6: LIMITES DE NUMEROS */}
        {activeSection === "limites" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left side: Create limit rule form */}
              <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-300 shadow-xs">
                <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2 mb-4">
                  {editingLimitId ? "Editar Techo o Límite" : "Configurar Techo o Límite"}
                </span>
                
                <form onSubmit={handleSaveLimite} className="space-y-4 font-sans">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Vendedor</label>
                      <select
                        value={selectedVendedorLimite}
                        onChange={(e) => setSelectedVendedorLimite(e.target.value)}
                        className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:outline-none"
                      >
                        <option value="TODOS">-- TODOS (Global) --</option>
                        {users.filter(u => u.rol === "vendedor").map(u => (
                          <option key={u.id} value={u.id}>{u.nombre}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">País</label>
                      <select
                        value={selectedPaisLimite}
                        onChange={(e) => {
                          const newPais = e.target.value;
                          setSelectedPaisLimite(newPais);
                          // Reset juego and sorteo if they are incompatible
                          setSelectedJuegoLimite("TODOS");
                          setSelectedSorteoLimite("TODOS");
                        }}
                        className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:outline-none"
                      >
                        <option value="TODOS">-- TODOS --</option>
                        <option value="Nicaragua">Nicaragua</option>
                        <option value="Honduras">Honduras</option>
                        <option value="El Salvador">El Salvador</option>
                        <option value="La Primera">La Primera</option>
                        <option value="Costa Rica">Costa Rica</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Juego</label>
                      <select
                        value={selectedJuegoLimite}
                        onChange={(e) => {
                          setSelectedJuegoLimite(e.target.value);
                          setSelectedSorteoLimite("TODOS");
                        }}
                        className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:outline-none"
                      >
                        {((selectedPaisLimite === "Nicaragua" ? ["TODOS", "Diaria", "Fechas", "Jugá 3", "Premia2", "Terminación 2", "Sabadito"] :
                           selectedPaisLimite === "Honduras" ? ["TODOS", "La Diaria", "Premia2", "Pega 3", "Súper Premio"] :
                           selectedPaisLimite === "El Salvador" ? ["TODOS", "Diaria"] :
                           selectedPaisLimite === "La Primera" ? ["TODOS", "La Primera"] :
                           selectedPaisLimite === "Costa Rica" ? ["TODOS", "3 Monazos", "Tica"] :
                           ["TODOS", "Diaria", "La Diaria", "Jugá 3", "3 Monazos", "Premia2", "Pega 3", "Súper Premio", "La Primera", "Tica", "Fechas", "Terminación 2", "Sabadito"])).map(j => (
                          <option key={j} value={j}>{j}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Hora Sorteo</label>
                      <select
                        value={selectedHoraLimite}
                        onChange={(e) => setSelectedHoraLimite(e.target.value)}
                        className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:outline-none"
                      >
                        <option value="TODOS">CUALQUIERA</option>
                        <option value="11:00 AM">11:00 AM</option>
                        <option value="3:00 PM">3:00 PM</option>
                        <option value="9:00 PM">9:00 PM</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Sorteo Específico</label>
                    <select
                      value={selectedSorteoLimite}
                      onChange={(e) => setSelectedSorteoLimite(e.target.value)}
                      className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 focus:outline-none"
                    >
                      <option value="TODOS">CUALQUIERA</option>
                      {config.sorteos.filter(s => {
                        if (selectedPaisLimite !== "TODOS") {
                          const paisSuffix = selectedPaisLimite === "Nicaragua" ? "(NI)" :
                                             selectedPaisLimite === "Honduras" ? "(HN)" :
                                             selectedPaisLimite === "El Salvador" ? "(SV)" :
                                             selectedPaisLimite === "La Primera" ? "(LP)" :
                                             selectedPaisLimite === "Costa Rica" ? "(CR)" : "";
                          if (paisSuffix && !s.nombre.includes(paisSuffix)) return false;
                        }
                        if (selectedJuegoLimite !== "TODOS" && s.juego !== selectedJuegoLimite) return false;
                        return true;
                      }).map(s => (
                        <option key={s.id} value={s.nombre}>{s.nombre}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider">Número Restringido</label>
                        <span className="text-[9px] text-[#EF4444] font-bold font-mono">
                          {selectedJuegoLimite === "Premia2" ? "4 dig." :
                           selectedJuegoLimite === "Jugá 3" || selectedJuegoLimite === "3 Monazos" ? "3 dig." :
                           selectedJuegoLimite === "Pega 3" ? "6 dig." :
                           selectedJuegoLimite === "Súper Premio" ? "12 dig." : "2 dig."}
                        </span>
                      </div>
                      <input
                        type="text"
                        placeholder="TODOS o ej: 45"
                        value={numeroLimiteInput}
                        onChange={(e) => setNumeroLimiteInput(e.target.value)}
                        className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 font-mono focus:outline-none focus:border-blue-900"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Techo Máximo (Cordobas)</label>
                      <input
                        type="number"
                        placeholder="Monto C$ (ej: 200)"
                        value={limiteDineroInput}
                        onChange={(e) => setLimiteDineroInput(e.target.value)}
                        className="w-full px-3 py-2 min-h-[44px] bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 font-mono focus:outline-none focus:border-blue-900"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full py-3 min-h-[44px] flex items-center justify-center bg-[#1E3A8A] hover:bg-blue-800 text-white font-display font-black text-xs uppercase tracking-wider rounded-xl border-b-2 border-blue-950 shadow-xs cursor-pointer space-x-2"
                    >
                      <span>
                        {submitting 
                          ? (editingLimitId ? "ACTUALIZANDO..." : "CONFIGURANDO...") 
                          : (editingLimitId ? "ACTUALIZAR TECHO DE VENTA" : "GUARDAR TECHO DE VENTA")}
                      </span>
                    </button>

                    {editingLimitId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingLimitId(null);
                          setNumeroLimiteInput("");
                          setLimiteDineroInput("");
                          setSelectedVendedorLimite("TODOS");
                          setSelectedPaisLimite("TODOS");
                          setSelectedJuegoLimite("TODOS");
                          setSelectedSorteoLimite("TODOS");
                          setSelectedHoraLimite("TODOS");
                        }}
                        className="w-full py-3 min-h-[44px] flex items-center justify-center bg-gray-200 hover:bg-gray-300 text-gray-800 font-display font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer"
                      >
                        Cancelar Edición
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Right side: Limits list */}
              <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-300 shadow-xs">
                <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2 mb-4">Techos de Venta de Números Activos</span>
                
                {limitsList.length === 0 ? (
                  <div className="p-8 text-center text-xs text-gray-400 font-medium">No se registran techos de venta de números programados. El sistema permitirá ventas ilimitadas.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs font-sans">
                      <thead>
                        <tr className="bg-gray-150 text-gray-600 uppercase text-[10px] font-mono tracking-wider">
                          <th className="p-2.5 rounded-l-lg">Vendedor</th>
                          <th className="p-2.5">País</th>
                          <th className="p-2.5">Sorteo / Juego</th>
                          <th className="p-2.5">Número</th>
                          <th className="p-2.5">Monto Límite</th>
                          <th className="p-2.5">Hora</th>
                          <th className="p-2.5 rounded-r-lg text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {limitsList.map((lim: any) => {
                          const matchedUser = users.find(u => u.id === lim.id_vendedor);
                          const limitNum = lim.numero ?? lim.numero_jugado ?? "TODOS";
                          const limitAmt = lim.max_monto ?? lim.techo_dinero ?? 0;
                          return (
                            <tr key={lim.id} className="hover:bg-gray-50">
                              <td className="p-2.5 font-bold text-gray-700 uppercase">
                                {lim.id_vendedor === "TODOS" ? (
                                  <span className="bg-indigo-100 text-indigo-800 border border-indigo-200 px-2 py-0.5 rounded text-[10px]">GLOBAL (TODOS)</span>
                                ) : (
                                  <div className="flex flex-col">
                                    <span className="bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded text-[10px] w-fit mb-0.5">INDIVIDUAL</span>
                                    <span className="text-[11px] truncate max-w-[120px]" title={matchedUser?.nombre || "Vendedor"}>{matchedUser?.nombre || "Vendedor"}</span>
                                  </div>
                                )}
                              </td>
                              <td className="p-2.5 font-mono text-gray-600 font-bold uppercase">
                                {lim.pais || "TODOS"}
                              </td>
                              <td className="p-2.5">
                                <div className="font-bold text-gray-900">{lim.juego}</div>
                                <div className="text-[10px] text-gray-400 uppercase font-mono">{lim.sorteo || "TODOS"}</div>
                              </td>
                              <td className="p-2.5 font-mono">
                                <span className="bg-red-50 border border-red-200 text-[#EF4444] px-1.5 py-0.5 rounded font-black">
                                  {limitNum}
                                </span>
                              </td>
                              <td className="p-2.5 font-mono font-black text-indigo-950">
                                C$ {limitAmt.toLocaleString("es-ES")}
                              </td>
                              <td className="p-2.5 font-mono text-gray-500 uppercase">{lim.hora_limite || lim.hora || "CUALQUIERA"}</td>
                              <td className="p-2.5 text-right flex items-center justify-end gap-1">
                                <button
                                  onClick={() => handleStartEditLimite(lim)}
                                  className="w-11 h-11 inline-flex items-center justify-center text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-200 transition-all cursor-pointer shrink-0"
                                  title="Editar"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteLimite(lim.id)}
                                  className="w-11 h-11 inline-flex items-center justify-center text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-200 transition-all cursor-pointer shrink-0"
                                  title="Eliminar"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          </div>
        )}

        {/* SECTION 7: REPORTERIA DE FACTURACION */}
        {activeSection === "reportes" && (
          <div className="space-y-6 font-sans">
            
            {/* Filter bar */}
            <div className="bg-white p-5 rounded-2xl border border-gray-300 shadow-xs flex flex-wrap gap-4 items-center justify-between">
              <div className="flex flex-wrap gap-4 items-center">
                <div>
                  <label className="block text-[9px] font-black uppercase font-mono text-gray-500 mb-1">Filtrar Vendedor</label>
                  <select
                    value={reportFilterVendedor}
                    onChange={(e) => setReportFilterVendedor(e.target.value)}
                    className="bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 min-h-[44px] text-xs font-bold text-gray-800 focus:outline-none"
                  >
                    <option value="TODOS">TODOS LOS VENDEDORES</option>
                    {users.filter(u => u.rol === "vendedor").map(u => (
                      <option key={u.id} value={u.id}>{u.nombre}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[9px] font-black uppercase font-mono text-gray-500 mb-1">Fecha Inicio</label>
                  <input
                    type="date"
                    value={reportFilterFechaInicio}
                    onChange={(e) => setReportFilterFechaInicio(e.target.value)}
                    className="bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 min-h-[44px] text-xs font-bold text-gray-800 font-mono focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[9px] font-black uppercase font-mono text-gray-500 mb-1">Fecha Fin</label>
                  <input
                    type="date"
                    value={reportFilterFechaFin}
                    onChange={(e) => setReportFilterFechaFin(e.target.value)}
                    className="bg-gray-50 border border-gray-300 rounded-xl px-3 py-1.5 min-h-[44px] text-xs font-bold text-gray-800 font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    const today = getLocalTodayStr();
                    setReportFilterFechaInicio(today);
                    setReportFilterFechaFin(today);
                    setReportFilterVendedor("TODOS");
                  }}
                  className="px-3.5 py-2 min-h-[44px] flex items-center justify-center border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 text-xs font-black uppercase tracking-wider rounded-xl cursor-pointer transition-all"
                >
                  Limpiar Filtros
                </button>
              </div>
            </div>

            {/* Main reports grid */}
            <div className="space-y-4">
              <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block">Facturación por Vendedor</span>
              
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {vendedoresReporte
                  .filter(u => reportFilterVendedor === "TODOS" || u.id === reportFilterVendedor)
                  .map(seller => {
                    const fd = facturacionData.find(d => d.id === seller.id) || {
                      vendido: 0, pagado: 0, ingresos: 0, aPagar: 0, cobrado: 0, ganancia: 0, total: 0, totalPremios: 0,
                      id: seller.id, nombre: seller.nombre
                    };

                    return (
                      <div key={seller.id} className="bg-white p-6 rounded-2xl border border-gray-300 shadow-xs flex flex-col justify-between font-sans">
                        {/* Card Header */}
                        <div className="flex justify-between items-start border-b border-gray-100 pb-3 mb-4">
                          <div>
                            <h3 className="font-display font-black text-base text-gray-900 uppercase leading-none">{seller.nombre}</h3>
                            <span className="text-[10px] text-gray-400 font-mono tracking-tight block mt-1">ID: {seller.id}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-xs font-mono text-gray-500 block">Vendido:</span>
                            <span className="text-base font-mono font-black text-gray-900">C$ {fd.vendido.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</span>
                          </div>
                        </div>

                        {/* Card Body Grid */}
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          {/* Left Column */}
                          <div className="space-y-1.5 text-gray-600">
                            <div>
                              <span>Pagado: </span>
                              <span className="font-mono font-bold text-gray-950">C$ {fd.pagado.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div>
                              <span>Ingresos: </span>
                              <span className="font-mono font-bold text-gray-950">C$ {fd.ingresos.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div>
                              <span>Total a pagar: </span>
                              <span className="font-mono font-bold text-gray-950">C$ {fd.aPagar.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div>
                              <span>Cobrado: </span>
                              <span className="font-mono font-bold text-gray-950">C$ {fd.cobrado.toLocaleString("es-ES", { minimumFractionDigits: 2 })}</span>
                            </div>
                          </div>

                          {/* Right Column */}
                          <div className="flex flex-col justify-end items-end space-y-1">
                            <div className="text-right">
                              <span className="text-[10px] text-gray-400 block">Ganancia:</span>
                              <span className="text-sm font-mono font-black text-blue-900">
                                C$ {fd.ganancia.toLocaleString("es-ES", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="text-right pt-1 border-t border-gray-100 w-full">
                              <span className="text-[10px] text-gray-400 block">Total:</span>
                              <span className="text-sm font-mono font-black text-blue-900">
                                C$ {fd.total.toLocaleString("es-ES", { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
              {/* Box 2: Facturación por Número Jugado */}
              <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-gray-300 shadow-xs">
                <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2 mb-4">Facturación por Número Jugado</span>
                <p className="text-[10px] text-gray-400 mb-4">Arqueo clasificado de números más jugados y montos acumulados en el rango seleccionado</p>

                <div className="overflow-y-auto max-h-96">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100 text-gray-600 uppercase text-[9px] font-mono tracking-wider">
                        <th className="p-2.5 rounded-l-lg">Número</th>
                        <th className="p-2.5">Juego / Sorteo</th>
                        <th className="p-2.5">Boletos</th>
                        <th className="p-2.5 rounded-r-lg text-right">Total Vendido (C$ Eq)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(() => {
                        // Group active sales of chosen date & user by number and game
                        const filteredDaySales = sales.filter(s => {
                          const saleDateStr = getTicketDate(s);
                          const dateMatch = saleDateStr >= reportFilterFechaInicio && saleDateStr <= reportFilterFechaFin;
                          const sellerMatch = reportFilterVendedor === "TODOS" || s.id_vendedor === reportFilterVendedor;
                          const activeMatch = !s.anulado;
                          return dateMatch && sellerMatch && activeMatch;
                        });

                        const grouped: { [key: string]: { number: string; juego: string; sorteo: string; tickets: number; totalCs: number } } = {};
                        
                        filteredDaySales.forEach(s => {
                          const key = `${s.numero_jugado}-${s.juego}`;
                          const equivalentAmountCs = s.moneda === "C$" ? s.monto_pago : (s.monto_pago * config.tasa_cambio);
                          if (!grouped[key]) {
                            grouped[key] = {
                              number: s.numero_jugado,
                              juego: s.juego,
                              sorteo: s.sorteo,
                              tickets: 0,
                              totalCs: 0
                            };
                          }
                          grouped[key].tickets += 1;
                          grouped[key].totalCs += equivalentAmountCs;
                        });

                        const sorted = Object.values(grouped).sort((a, b) => b.totalCs - a.totalCs);

                        if (sorted.length === 0) {
                          return (
                            <tr>
                              <td colSpan={4} className="p-6 text-center text-gray-400">No se registran ventas para estos filtros.</td>
                            </tr>
                          );
                        }

                        return sorted.map((item, idx) => (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="p-2.5">
                              <span className="bg-blue-50 border border-blue-200 text-blue-900 font-mono font-black text-xs px-2 py-0.5 rounded">
                                {item.number}
                              </span>
                            </td>
                            <td className="p-2.5">
                              <div className="font-bold text-gray-700">{item.juego}</div>
                              <div className="text-[9px] text-gray-400 font-mono uppercase">{item.sorteo}</div>
                            </td>
                            <td className="p-2.5 font-mono">{item.tickets} tks</td>
                            <td className="p-2.5 font-mono text-right font-black text-indigo-950">
                              C$ {item.totalCs.toLocaleString("es-ES")}
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Box 3: Facturación General / Resumen de Países */}
              <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-gray-300 shadow-xs">
                <span className="font-display font-black text-sm text-gray-900 uppercase tracking-wider block border-b border-gray-100 pb-2 mb-4">Facturación por Sorteo y País</span>
                <p className="text-[10px] text-gray-400 mb-4">Rendimiento y participación de mercado por cada catálogo en el rango seleccionado</p>

                {(() => {
                  const filteredDaySales = sales.filter(s => {
                    const saleDateStr = getTicketDate(s);
                    const dateMatch = saleDateStr >= reportFilterFechaInicio && saleDateStr <= reportFilterFechaFin;
                    const sellerMatch = reportFilterVendedor === "TODOS" || s.id_vendedor === reportFilterVendedor;
                    const activeMatch = !s.anulado;
                    return dateMatch && sellerMatch && activeMatch;
                  });

                  const countryRevenue: { [key: string]: number } = {
                    "Nicaragua (NI)": 0,
                    "Honduras (HN)": 0,
                    "El Salvador (SV)": 0,
                    "La Primera (LP)": 0,
                    "Costa Rica (CR)": 0
                  };

                  filteredDaySales.forEach(s => {
                    const eqCs = s.moneda === "C$" ? s.monto_pago : (s.monto_pago * config.tasa_cambio);
                    if (s.sorteo.includes("(NI)")) countryRevenue["Nicaragua (NI)"] += eqCs;
                    else if (s.sorteo.includes("(HN)")) countryRevenue["Honduras (HN)"] += eqCs;
                    else if (s.sorteo.includes("(SV)")) countryRevenue["El Salvador (SV)"] += eqCs;
                    else if (s.sorteo.includes("(LP)")) countryRevenue["La Primera (LP)"] += eqCs;
                    else if (s.sorteo.includes("(CR)")) countryRevenue["Costa Rica (CR)"] += eqCs;
                  });

                  const totalDayEqCs = Object.values(countryRevenue).reduce((sum, val) => sum + val, 0);

                  return (
                    <div className="space-y-4">
                      {Object.keys(countryRevenue).map(country => {
                        const val = countryRevenue[country];
                        const pct = totalDayEqCs > 0 ? (val / totalDayEqCs) * 100 : 0;
                        return (
                          <div key={country} className="space-y-1">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-black text-gray-800 uppercase tracking-tight">{country}</span>
                              <span className="font-mono font-bold text-indigo-950">
                                C$ {(val || 0).toLocaleString("es-ES")} ({pct.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-900 rounded-full transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              ></div>
                            </div>
                          </div>
                        );
                      })}

                      <div className="border-t border-gray-100 pt-3 mt-4 flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-200">
                        <span className="text-xs font-display font-black text-gray-900 uppercase">Facturación Total del Período:</span>
                        <span className="font-mono font-black text-lg text-emerald-800">
                          C$ {(totalDayEqCs || 0).toLocaleString("es-ES")}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>

            </div>
          </div>
        )}


        {/* TAB FINANZAS */}
        {activeSection === "finanzas" && (
          <div className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Facturación por Usuario */}
              <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="p-2 bg-blue-50 rounded-xl">
                    <DollarSign className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-display font-black text-sm uppercase text-gray-800">Facturación por Usuario</h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Vendedor</label>
                    <select
                      value={finanzasVendedor}
                      onChange={(e) => setFinanzasVendedor(e.target.value)}
                      className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-50"
                    >
                      <option value="">Seleccione un vendedor</option>
                      {users.filter(u => u.rol === 'vendedor').map(v => (
                        <option key={v.id} value={v.id}>{v.nombre} ({v.usuario})</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Fecha Inicio</label>
                      <input
                        type="date"
                        value={finanzasFechaInicio}
                        onChange={(e) => setFinanzasFechaInicio(e.target.value)}
                        className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Fecha Fin</label>
                      <input
                        type="date"
                        value={finanzasFechaFin}
                        onChange={(e) => setFinanzasFechaFin(e.target.value)}
                        className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-50"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleConsultarBalance}
                    disabled={finanzasLoading || !finanzasVendedor}
                    className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white font-bold rounded-xl cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    Consultar Balance
                  </button>

                  {/* Resultados Inteligentes */}
                  {finanzasMensajeInfo && finanzasResumenes.length === 0 && (
                    <div className="bg-blue-50 text-blue-800 p-4 rounded-xl border border-blue-200 text-sm mt-4 animate-fade-in flex items-start space-x-2">
                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                      <p>{finanzasMensajeInfo}</p>
                    </div>
                  )}

                  {finanzasResumenes.length > 0 && (
                    <div className="mt-6 space-y-4 animate-fade-in">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                          <span className="text-[10px] uppercase font-bold text-gray-500 block">Vendido</span>
                          <span className="text-lg font-black text-gray-800">C$ {finanzasResumenes.reduce((a, b) => a + b.vendido, 0).toFixed(2)}</span>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                          <span className="text-[10px] uppercase font-bold text-gray-500 block">Pagado (Premios)</span>
                          <span className="text-lg font-black text-gray-800">C$ {finanzasResumenes.reduce((a, b) => a + b.pagado, 0).toFixed(2)}</span>
                        </div>
                      </div>
                      
                      <div className="bg-green-50 p-5 rounded-2xl border border-green-200 text-center relative overflow-hidden">
                        <span className="text-xs uppercase font-black tracking-widest text-green-800 block mb-1">Ganancia / Total a Pagar</span>
                        <span className="text-4xl font-black text-green-700 tracking-tighter">
                          C$ {(finanzasResumenes.reduce((a, b) => a + b.vendido, 0) - finanzasResumenes.reduce((a, b) => a + b.pagado, 0)).toFixed(2)}
                        </span>
                      </div>

                      <button
                        onClick={() => setShowCobroModal(true)}
                        disabled={finanzasResumenes.length === 0 || finanzasResumenes.reduce((a, b) => a + b.vendido, 0) - finanzasResumenes.reduce((a, b) => a + b.pagado, 0) <= 0}
                        className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-wider rounded-xl cursor-pointer shadow-md transition-all active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Aplicar Cobro
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Pagos de Comisión */}
              <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="p-2 bg-amber-50 rounded-xl">
                    <Briefcase className="w-5 h-5 text-amber-600" />
                  </div>
                  <h3 className="font-display font-black text-sm uppercase text-gray-800">Pagos de Comisión</h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Vendedor</label>
                    <select
                      value={comisionVendedor}
                      onChange={(e) => setComisionVendedor(e.target.value)}
                      className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-amber-500 bg-gray-50"
                    >
                      <option value="">Seleccione un vendedor</option>
                      {users.filter(u => u.rol === 'vendedor').map(v => (
                        <option key={v.id} value={v.id}>{v.nombre}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Monto a Pagar (C$)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={comisionMonto}
                      onChange={(e) => setComisionMonto(e.target.value)}
                      placeholder="0.00"
                      className="w-full text-lg font-black p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-amber-500 bg-gray-50 text-gray-800"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Concepto</label>
                    <input
                      type="text"
                      value={comisionConcepto}
                      onChange={(e) => setComisionConcepto(e.target.value)}
                      className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-amber-500 bg-gray-50 text-gray-800"
                    />
                  </div>

                  <button
                    onClick={handleRegistrarPago}
                    disabled={comisionLoading || !comisionVendedor || !comisionMonto}
                    className="w-full mt-4 py-4 bg-amber-500 hover:bg-amber-600 text-white font-black uppercase tracking-wider rounded-xl cursor-pointer shadow-md transition-all active:translate-y-0.5 disabled:opacity-50"
                  >
                    Registrar Pago
                  </button>
                </div>
              </div>

            </div>

            {/* Renderizado Visual del Historial y Anulación de Cobros (Auditoría) */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm mt-6">
              <div className="flex items-center space-x-3 mb-6">
                <div className="p-2 bg-slate-100 rounded-xl">
                  <FileText className="w-5 h-5 text-slate-700" />
                </div>
                <h3 className="font-display font-black text-sm uppercase text-gray-800">Historial de Cobros Recientes</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                      <th className="p-3 border-b border-gray-200 rounded-tl-xl">Fecha de Cobro</th>
                      <th className="p-3 border-b border-gray-200">Rango Evaluado</th>
                      <th className="p-3 border-b border-gray-200">Vendedor</th>
                      <th className="p-3 border-b border-gray-200 text-right">Total Neto</th>
                      <th className="p-3 border-b border-gray-200 rounded-tr-xl text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-sans">
                    {historialCobros.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-gray-400 font-medium">No hay cobros registrados.</td>
                      </tr>
                    ) : (
                      historialCobros.map(cobro => (
                        <tr key={cobro.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="p-3 text-gray-800 font-semibold">{new Date(cobro.timestamp).toLocaleString("es-NI")}</td>
                          <td className="p-3 text-gray-500 font-mono text-[10px]">{cobro.rango_inicio} a {cobro.rango_fin}</td>
                          <td className="p-3 font-bold text-blue-900">{cobro.nombre_vendedor}</td>
                          <td className="p-3 text-right font-black text-green-700">C$ {cobro.total_neto.toFixed(2)}</td>
                          <td className="p-3 text-center">
                            <button
                              onClick={async () => {
                                if (window.confirm("¿Seguro que desea anular este cobro? Esta acción revertirá el balance del vendedor.")) {
                                  await handleAnularCobro(cobro.id);
                                  await fetchHistorialCobros();
                                }
                              }}
                              className="p-1.5 bg-red-100 text-red-600 hover:bg-red-200 rounded-lg transition-colors inline-flex items-center justify-center cursor-pointer"
                              title="Anular Cobro"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {activeSection === "buscador" && (
          <div className="space-y-6">
            {/* Filtros de Búsqueda */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center space-x-3 mb-6">
                <div className="p-2 bg-blue-100 rounded-xl">
                  <Search className="w-5 h-5 text-blue-900" />
                </div>
                <h3 className="font-display font-black text-sm uppercase text-gray-800">Filtros de Búsqueda de Boletos</h3>
              </div>

              <form onSubmit={handleExecuteSearch} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Vendedor</label>
                  <select
                    value={searchSellerId}
                    onChange={(e) => setSearchSellerId(e.target.value)}
                    className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-900 bg-gray-50 text-gray-800"
                  >
                    <option value="TODOS">-- TODOS --</option>
                    {users.filter(u => u.rol === 'vendedor').map(v => (
                      <option key={v.id} value={v.id}>{v.nombre}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Fecha Inicio</label>
                  <input
                    type="date"
                    value={searchStartDate}
                    onChange={(e) => setSearchStartDate(e.target.value)}
                    className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-900 bg-gray-50 text-gray-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Fecha Fin</label>
                  <input
                    type="date"
                    value={searchEndDate}
                    onChange={(e) => setSearchEndDate(e.target.value)}
                    className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-900 bg-gray-50 text-gray-800"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Número de Ticket (Búsqueda Parcial)</label>
                  <input
                    type="text"
                    value={searchTicketQuery}
                    onChange={(e) => setSearchTicketQuery(e.target.value)}
                    placeholder="Ej. 114"
                    className="w-full text-sm p-3 border border-gray-300 rounded-xl focus:outline-none focus:border-blue-900 bg-gray-50 text-gray-800"
                  />
                </div>

                <div className="md:col-span-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={searchLoading}
                    className="py-3 px-6 bg-blue-900 hover:bg-blue-800 text-white font-black uppercase text-xs rounded-xl shadow-md transition-colors cursor-pointer flex items-center space-x-2"
                  >
                    <Search className="w-4 h-4" />
                    <span>{searchLoading ? "Buscando..." : "Buscar Boletos"}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Resultados de Búsqueda */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm">
              <div className="flex items-center space-x-3 mb-6">
                <div className="p-2 bg-slate-100 rounded-xl">
                  <FileText className="w-5 h-5 text-slate-700" />
                </div>
                <h3 className="font-display font-black text-sm uppercase text-gray-800">Resultados de la Búsqueda</h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                      <th className="p-3 border-b border-gray-200 rounded-tl-xl">Fecha Emisión</th>
                      <th className="p-3 border-b border-gray-200">ID / Ticket</th>
                      <th className="p-3 border-b border-gray-200">Vendedor</th>
                      <th className="p-3 border-b border-gray-200">Juego / Sorteo</th>
                      <th className="p-3 border-b border-gray-200">Jugadas</th>
                      <th className="p-3 border-b border-gray-200 text-right">Monto</th>
                      <th className="p-3 border-b border-gray-200">Estado</th>
                      <th className="p-3 border-b border-gray-200 rounded-tr-xl text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-sans">
                    {searchResults.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-6 text-center text-gray-400 font-medium">
                          Realice una búsqueda para ver los resultados.
                        </td>
                      </tr>
                    ) : (
                      searchResults.map((ticket) => {
                        const isAnulado = ticket.estado === "anulado" || ticket.anulado;
                        return (
                          <tr key={ticket.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="p-3 text-gray-800 font-semibold">{ticket.timestamp_servidor ? new Date(ticket.timestamp_servidor).toLocaleString("es-NI") : ticket.fecha_venta}</td>
                            <td className="p-3 text-gray-600 font-mono font-bold">{ticket.numero_ticket || ticket.id.substring(0, 8).toUpperCase()}</td>
                            <td className="p-3 font-bold text-blue-900">{ticket.nombre_vendedor}</td>
                            <td className="p-3 text-gray-700">
                              <span className="font-semibold block">{ticket.juego}</span>
                              <span className="text-[10px] text-gray-400 font-medium">{ticket.sorteo}</span>
                            </td>
                            <td className="p-3 font-mono text-[11px] text-gray-600">
                              {ticket.jugadas && ticket.jugadas.length > 0 ? (
                                <div className="max-w-[200px] truncate">
                                  {ticket.jugadas.map((j: any) => `${j.numero} (C$${j.monto})`).join(", ")}
                                </div>
                              ) : (
                                `${ticket.numero_jugado} (C$${ticket.monto_pago})`
                              )}
                            </td>
                            <td className="p-3 text-right font-black text-slate-800">
                              {ticket.moneda || "C$"} {(ticket.monto_pago || 0).toFixed(2)}
                            </td>
                            <td className="p-3">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase font-display border ${
                                isAnulado 
                                  ? "bg-red-50 text-red-700 border-red-200" 
                                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
                              }`}>
                                {isAnulado ? "Anulado" : "Válido"}
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              <button
                                onClick={() => setActiveTicket(ticket)}
                                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold uppercase rounded-lg border border-blue-200 transition-colors text-[9px] cursor-pointer"
                              >
                                Visualizar
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      {/* Modal de Cobro */}
      <AnimatePresence>
        {showCobroModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl p-6 shadow-2xl max-w-md w-full border border-gray-200"
            >
              <div className="flex items-center space-x-3 text-green-600 mb-4">
                <div className="p-3 bg-green-100 rounded-full">
                  <DollarSign className="w-8 h-8" />
                </div>
                <h3 className="font-display font-black text-lg uppercase tracking-wider text-green-900">
                  Confirmar Cobro
                </h3>
              </div>
              <p className="text-gray-600 font-sans text-sm leading-relaxed mb-4">
                ¿Confirmas que estás retirando físicamente <strong className="text-gray-900 font-black font-mono">C$ {(finanzasResumenes.reduce((a, b) => a + b.vendido, 0) - finanzasResumenes.reduce((a, b) => a + b.pagado, 0)).toFixed(2)}</strong> a este vendedor por el corte del {finanzasFechaInicio} al {finanzasFechaFin}?
              </p>
              <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-gray-600">
                <span className="font-bold uppercase text-gray-800 block mb-1">Días a saldar ({finanzasResumenes.length}):</span>
                {finanzasResumenes.map(r => (
                  <div key={r.id}>- {r.id.split('_')[1] || r.id}</div>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCobroModal(false)}
                  className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold uppercase text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAplicarCobro}
                  disabled={finanzasLoading}
                  className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-black uppercase text-xs rounded-xl shadow-md transition-colors cursor-pointer flex justify-center items-center"
                >
                  {finanzasLoading ? "Procesando..." : "SÍ, CONFIRMAR COBRO"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      </main>

      {/* Qr Scanner Modal */}
      {isScannerOpen && (
        <QrScannerModal
          onScan={(data) => {
            setQrSearchInput(data);
            setIsScannerOpen(false);
          }}
          onClose={() => setIsScannerOpen(false)}
        />
      )}

      {/* Ticket Viewer Modal */}
      {activeTicket && (
        <TicketPreviewModal 
          ticket={activeTicket} 
          config={config} 
          onClose={() => setActiveTicket(null)} 
          userRole="administrador"
          onAnular={handleAnularTicket}
        />
      )}

      {/* Advanced User Create/Edit Modal with backdrop-blur */}
      {isUserModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-gray-300 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="p-6 bg-blue-900 text-white flex justify-between items-center">
              <div className="flex items-center space-x-2.5">
                <UserPlus className="w-5 h-5 text-emerald-400" />
                <h3 className="font-display font-black text-sm uppercase tracking-wider">
                  {editingUser ? `Editar Datos de Usuario` : "Registrar Nuevo Usuario"}
                </h3>
              </div>
              <button
                onClick={() => setIsUserModalOpen(false)}
                className="w-11 h-11 flex items-center justify-center text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveUserSubmit} className="p-6 space-y-4 overflow-y-auto flex-1 text-left">
              {editingUser && (
                <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 text-xs font-mono font-bold rounded-xl">
                  Código de Identificación: {editingUser.id}
                </div>
              )}

              {/* Full Name */}
              <div>
                <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Nombre Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Juan Pérez"
                  value={userFormName}
                  onChange={(e) => setUserFormName(e.target.value)}
                  className="w-full px-4 py-2.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900 focus:bg-white transition-all"
                />
              </div>

              {/* Username / Nickname */}
              <div>
                <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Nickname de Acceso (Usuario Único) *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. juanperez"
                  value={userFormUsername}
                  onChange={(e) => setUserFormUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
                  className="w-full px-4 py-2.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-xl font-mono text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900 focus:bg-white transition-all"
                />
                <span className="text-[10px] text-gray-400 font-sans block mt-1">
                  Este es el identificador único para iniciar sesión en la app. Sin espacios ni caracteres especiales.
                </span>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Correo Electrónico *</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. juan@empresa.com"
                  value={userFormEmail}
                  onChange={(e) => setUserFormEmail(e.target.value)}
                  className="w-full px-4 py-2.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900 focus:bg-white transition-all font-mono"
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">
                  {editingUser ? "Contraseña (Opcional)" : "Contraseña de Acceso *"}
                </label>
                <div className="relative">
                  <input
                    type={showUserFormPassword ? "text" : "password"}
                    required={!editingUser}
                    placeholder={editingUser ? "Dejar en blanco para no modificar" : "Mínimo 6 caracteres"}
                    value={userFormPassword}
                    onChange={(e) => setUserFormPassword(e.target.value)}
                    className="w-full pl-4 pr-11 py-2.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900 focus:bg-white transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUserFormPassword(!showUserFormPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300 cursor-pointer"
                  >
                    {showUserFormPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                  </button>
                </div>
              </div>

              {/* Roles selection */}
              <div>
                <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1">Rol / Permiso *</label>
                <select
                  value={userFormRole}
                  onChange={(e: any) => setUserFormRole(e.target.value)}
                  className="w-full px-4 py-2.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-xl font-sans text-xs font-bold text-gray-900 focus:outline-none focus:border-blue-900 focus:bg-white transition-all"
                >
                  <option value="vendedor">Vendedor de Calle</option>
                  <option value="supervisor">Supervisor de Red</option>
                  <option value="administrador">Administrador</option>
                </select>
              </div>

              {/* Account Status Toggle Switch */}
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex justify-between items-center">
                <div>
                  <span className="text-xs font-display font-black text-gray-800 uppercase tracking-wider block">Estado de Cuenta de Producción</span>
                  <p className="text-[10px] text-gray-400 mt-0.5">Si se inactiva, el usuario perderá acceso inmediato a la terminal de ventas.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setUserFormStatus(userFormStatus === "activo" ? "inactivo" : "activo")}
                  className={`px-4 py-2 min-h-[44px] flex items-center justify-center rounded-xl text-xs font-display font-black uppercase tracking-wider transition-all border cursor-pointer ${
                    userFormStatus === "activo"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-red-50 text-red-800 border-red-200"
                  }`}
                >
                  {userFormStatus === "activo" ? "● ACTIVO" : "○ INACTIVO"}
                </button>
              </div>

              {/* Action Buttons (Large, Solar Readable) */}
              <div className="pt-4 border-t border-gray-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="flex-1 py-3 min-h-[44px] flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 font-display font-black text-xs uppercase tracking-wider rounded-xl border border-gray-300 cursor-pointer text-center transition-colors font-bold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-3 min-h-[44px] bg-blue-900 hover:bg-blue-800 text-white font-display font-black text-xs uppercase tracking-wider rounded-xl border-b-2 border-blue-950 cursor-pointer shadow-md flex items-center justify-center space-x-2 transition-all active:translate-y-0.5 font-bold"
                >
                  <Check className="w-4.5 h-4.5 stroke-[2.5]" />
                  <span>{submitting ? "GUARDANDO..." : "GUARDAR USUARIO"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Deletion Warning Modal (Replaces browser confirm) */}
      {deletingUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full border border-gray-300 shadow-2xl p-6 space-y-4 text-left">
            <div className="flex items-center space-x-3 text-red-600">
              <Shield className="w-8 h-8 shrink-0" />
              <div>
                <h3 className="font-display font-black text-sm uppercase tracking-wider text-red-900">
                  ¿Confirmar Eliminación Permanente?
                </h3>
                <p className="text-[10px] text-red-500 font-mono mt-0.5">ID: {deletingUser.id}</p>
              </div>
            </div>

            <div className="text-xs text-gray-600 space-y-2 leading-relaxed">
              <p>
                Está a punto de eliminar al usuario <strong className="text-gray-900">{deletingUser.nombre}</strong> (Nickname: <code className="bg-gray-100 px-1 py-0.5 rounded font-mono font-bold text-red-900">@{deletingUser.usuario}</code>) de forma irreversible de la base de datos de producción.
              </p>
              <p className="font-bold text-gray-800">
                ⚠️ Consecuencias de la operación:
              </p>
              <ul className="list-disc pl-4 space-y-1 text-gray-500 font-sans">
                {deletingUser.rol === "supervisor" && (
                  <li>Todos los vendedores asignados a este supervisor se quedarán sin supervisión de forma automática.</li>
                )}
                {deletingUser.rol === "vendedor" && (
                  <li>El vendedor será desvinculado de su supervisor de red inmediatamente.</li>
                )}
                <li>Se mantendrá el registro de transacciones históricas por integridad contable.</li>
              </ul>
            </div>

            {/* Action Buttons (Large, High contrast) */}
            <div className="pt-2 flex gap-3">
              <button
                onClick={() => setDeletingUser(null)}
                className="flex-1 py-3 min-h-[44px] flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-700 font-display font-bold text-xs uppercase tracking-wider rounded-xl border border-gray-300 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteUserConfirm}
                className="flex-1 py-3 min-h-[44px] flex items-center justify-center bg-red-600 hover:bg-red-500 text-white font-display font-black text-xs uppercase tracking-wider rounded-xl border-b-2 border-red-800 cursor-pointer shadow-md font-bold"
              >
                SÍ, ELIMINAR
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
