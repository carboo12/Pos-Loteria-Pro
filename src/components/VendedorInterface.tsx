import { useState, useEffect, FormEvent, useRef, useMemo } from "react";
import toast from "react-hot-toast";
import { 
  Gamepad2, 
  History, 
  Calculator, 
  Wifi, 
  WifiOff, 
  DollarSign, 
  FileText, 
  RotateCcw, 
  Trash2, 
  Check, 
  X, 
  ArrowRight,
  ArrowLeft,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  AlertCircle,
  Search,
  QrCode,
  CheckCircle,
  AlertTriangle,
  Ticket,
  Plus,
  Printer
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { Usuario, Configuracion, Venta, Sorteo, Jugada } from "../types";
import TicketPreviewModal from "./TicketPreviewModal";
import { QrScannerModal } from "./QrScannerModal";
import ResumenFacturacionCard from "./ResumenFacturacionCard";
import FacturacionVendedorCard from "./FacturacionVendedorCard";
import { collection, query, where, getDocs, doc, updateDoc, getDoc, onSnapshot, orderBy } from "firebase/firestore";
import { firestore } from "../lib/firebase";
import { BluetoothPrinterService, PrinterStatus } from "../services/BluetoothPrinterService";
import { buildTicketBuffer, ticketDataFromVenta, loadLogoBitmap } from "../services/escpos-builder";
import { isSorteoHabilitado, getDiasHabilitadosShortLabel, isDateValidForSorteo, getNextValidDate } from "../lib/sorteo-utils";
import { toDateSafe, toDateStr, getTicketDate, getTicketAmount } from "../lib/date-utils";
import { calculatePrizeMultiplier, getTicketTheoreticalPrize } from "../lib/prize-utils";

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

interface VendedorInterfaceProps {
  user: Usuario;
  config: Configuracion;
  onRefreshSales: () => Promise<void>;
  sales: Venta[];
  onNewSaleCreated: (sale: Venta) => void;
  serverTime: string;
}


const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function fechaVentaToDateStr(fecha: { dia: string; mes: string; anio: number }): string {
  const monthIdx = MESES.indexOf(fecha.mes);
  if (monthIdx === -1) return `${fecha.anio}-01-01`;
  return `${fecha.anio}-${String(monthIdx + 1).padStart(2, "0")}-${fecha.dia.padStart(2, "0")}`;
}

function parseDateStrToFechaVenta(dateStr: string): { dia: string; mes: string; anio: number } {
  const d = new Date(dateStr + "T12:00:00");
  return {
    dia: String(d.getDate()).padStart(2, "0"),
    mes: MESES[d.getMonth()],
    anio: d.getFullYear()
  };
}

export default function VendedorInterface({
  user,
  config,
  onRefreshSales,
  sales,
  onNewSaleCreated,
  serverTime
}: VendedorInterfaceProps) {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<"venta" | "reportes" | "pagos">("venta");
  
  // Filtros y estados de Firestore para Reportes
  const [reportFilterFechaInicio, setReportFilterFechaInicio] = useState(() => new Date().toISOString().split("T")[0]);
  const [reportFilterFechaFin, setReportFilterFechaFin] = useState(() => new Date().toISOString().split("T")[0]);
  const [reportTickets, setReportTickets] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  
  // País state
  const [selectedPais, setSelectedPais] = useState<"Nicaragua" | "Honduras" | "El Salvador" | "La Primera" | "Costa Rica">("Nicaragua");
  
  // Venta Form State
  const [selectedJuego, setSelectedJuego] = useState("Diaria");
  const [selectedSorteo, setSelectedSorteo] = useState("");
  const [numeroJugado, setNumeroJugado] = useState("");
  const [montoPago, setMontoPago] = useState("");
  const [activeField, setActiveField] = useState<'numero' | 'monto'>('numero');
  const [moneda, setMoneda] = useState<"C$" | "USD">("C$");
  const [nombreCliente, setNombreCliente] = useState("Genérico");
  const [fechaVenta, setFechaVenta] = useState<{ dia: string; mes: string; anio: number }>(() => {
    const now = new Date();
    return { dia: String(now.getDate()).padStart(2, "0"), mes: MESES[now.getMonth()], anio: now.getFullYear() };
  });
  
  // Connection state
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    
    const pingInterval = setInterval(async () => {
      if (!navigator.onLine) return;
      try {
        const res = await fetch("/api/ping");
        setIsOnline(res.ok);
      } catch (e) {
        setIsOnline(false);
      }
    }, 30000);
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(pingInterval);
    };
  }, []);

  // (diagnostic U-001 test removed — system is production-ready)

  // Time synchronization offset
  const [clockOffset, setClockOffset] = useState(0);
  useEffect(() => {
    if (serverTime) {
      const serverMs = new Date(serverTime).getTime();
      const localMs = Date.now();
      if (!isNaN(serverMs)) {
        setClockOffset(serverMs - localMs);
      }
    }
  }, [serverTime]);

  const getSyncedNow = () => {
    return new Date(Date.now() + clockOffset);
  };
  
  // Error / Success message banner
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSubmittingTicket, setIsSubmittingTicket] = useState(false);
  const [activeTicket, setActiveTicket] = useState<Venta | null>(null);

  // Bluetooth printer state
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>("disconnected");
  const printerRef = useRef<BluetoothPrinterService | undefined>(undefined);

  if (!printerRef.current) {
    printerRef.current = new BluetoothPrinterService((status) => setPrinterStatus(status));
  }

  useEffect(() => {
    return () => {
      printerRef.current?.disconnect();
      printerRef.current = undefined;
    };
  }, []);

  // Logo bytes for ESC/POS printing (loaded once)
  const logoBytesRef = useRef<number[]>([]);

  useEffect(() => {
    loadLogoBitmap("/logo.png", 48).then((bytes) => {
      logoBytesRef.current = bytes;
    });
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        printerRef.current &&
        printerStatus !== "connected" &&
        printerStatus !== "connecting" &&
        printerStatus !== "printing"
      ) {
        printerRef.current.connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [printerStatus]);

  // Ticket QR/ID Search states
  // Hardware and Permission states
  const [cameraStatus, setCameraStatus] = useState<'idle'|'loading'|'ready'|'denied'|'error'>('idle');
  const [cameraRetry, setCameraRetry] = useState(0);

  const [qrSearchInput, setQrSearchInput] = useState("");
  const [qrSearchError, setQrSearchError] = useState<string | null>(null);
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [prizeResult, setPrizeResult] = useState<{
    show: boolean;
    type: 'winner' | 'loser' | 'pending' | 'already_paid' | 'not_found' | 'sorteo_abierto' | 'error';
    ticket: Venta | null;
    monto_premio?: number;
    message: string;
  }>({ show: false, type: 'error', ticket: null, message: '' });

  // Payment states
  const [paymentResult, setPaymentResult] = useState<{ganador: boolean, message: string, monto: number} | null>(null);

  // --- NEW MULTI-NUMBER CART STATE ---
  const [jugadas, setJugadas] = useState<Jugada[]>([]);
  const montoInputRef = useRef<HTMLInputElement>(null);
  const totalTicketMonto = jugadas.reduce((acc, j) => acc + j.monto, 0);
  const totalTicketPremio = jugadas.reduce((acc, j) => acc + j.premio_posible, 0);

  // Pre-declared variables to avoid temporal dead zone compile errors
  let limitCheckResult: any = null;
  let isLimitBlocked = false;



  const addJugadaAlCarrito = () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!numeroJugado) {
      setErrorMessage("Ingrese un número válido para jugar.");
      return;
    }
    const numericAmount = Number(montoPago);
    if (!montoPago || isNaN(numericAmount) || numericAmount <= 0) {
      setErrorMessage("Ingrese un monto válido mayor a cero.");
      return;
    }
    if (!selectedSorteo) {
      setErrorMessage("No hay sorteos activos seleccionados.");
      return;
    }

    if (isLimitBlocked && limitCheckResult) {
      setErrorMessage(`NÚMERO BLOQUEADO: Límite de C$ ${limitCheckResult.limitMontoCs.toLocaleString("es-ES")} alcanzado.`);
      return;
    }

    const matchingSorteo = config.sorteos.find(s => s.nombre === selectedSorteo);
    if (matchingSorteo && isSorteoCerrado(matchingSorteo)) {
      setErrorMessage(`BLOQUEADO: El sorteo ${selectedSorteo} ya cerró.`);
      return;
    }

    if (matchingSorteo && !isSorteoHabilitado(matchingSorteo, getSyncedNow())) {
      setErrorMessage(`BLOQUEADO: El sorteo ${selectedSorteo} no está habilitado hoy. ${getDiasHabilitadosShortLabel(matchingSorteo)}.`);
      return;
    }

    if (matchingSorteo && !isDateValidForSorteo(matchingSorteo, fechaVentaToDateStr(fechaVenta))) {
      setErrorMessage(`FECHA INVÁLIDA: ${selectedSorteo} no opera el ${fechaVentaToDateStr(fechaVenta)}. ${getDiasHabilitadosShortLabel(matchingSorteo)}.`);
      return;
    }

    const multiplier = calculatePrizeMultiplier(selectedJuego, selectedSorteo);
    const montoInCs = moneda === "USD" ? numericAmount * (config.tasa_cambio || 36.50) : numericAmount;
    const premioPosibleCs = montoInCs * multiplier;

    const nuevaJugada = {
      numero: numeroJugado,
      monto: numericAmount,
      premio_posible: premioPosibleCs,
      fecha_venta: fechaVentaToDateStr(fechaVenta)
    };

    setJugadas([...jugadas, nuevaJugada]);
    setNumeroJugado("");
    setMontoPago("");
    setActiveField("numero");
    toast.success("¡Número añadido con éxito!", { position: 'top-center' });
  };

  const removeJugada = (index: number) => {
    setJugadas(jugadas.filter((_, i) => i !== index));
  };

  const clearForm = () => {
    setNumeroJugado("");
    setMontoPago("");
    const now = new Date();
    setFechaVenta({ dia: String(now.getDate()).padStart(2, "0"), mes: MESES[now.getMonth()], anio: now.getFullYear() });
    setErrorMessage(null);
    setSuccessMessage(null);
    setActiveField("numero");
  };




  // QR Scanner Effect

  // QR Scanner Effect is now handled dynamically through QrScannerModal without auto-activating camera on tab change.
  useEffect(() => {
    if (activeTab !== "pagos") {
      setPaymentResult(null);
    }
  }, [activeTab]);


  const processPayment = async (queryStr: string) => {
    setLoading(true);
    setPaymentResult(null);
    try {
      let targetNum = queryStr.trim();
      if (queryStr.includes("ticket=")) {
        const tMatch = queryStr.match(/[?&]ticket=([^&]+)/);
        if (tMatch) targetNum = tMatch[1];
      }
      
      const cleanNum = targetNum.replace(/^#/, "").trim();
      
      // 1. Fetch from Firestore tickets collection (multi-strategy legacy lookup)
      const docRef = doc(firestore, "tickets", cleanNum);
      let docSnap = await getDoc(docRef);
      let ticketId = cleanNum;
      
      // 2. Fallback: query by id_ticket field (old tickets)
      if (!docSnap.exists()) {
        const q = query(collection(firestore, "tickets"), where("id_ticket", "==", cleanNum));
        const qSnap = await getDocs(q);
        if (!qSnap.empty) {
          docSnap = qSnap.docs[0];
          ticketId = docSnap.id;
        }
      }

      // 3. Fallback: query by numero_ticket field (legacy server-created tickets)
      if (!docSnap.exists()) {
        const q2 = query(collection(firestore, "tickets"), where("numero_ticket", "==", cleanNum));
        const q2Snap = await getDocs(q2);
        if (!q2Snap.empty) {
          docSnap = q2Snap.docs[0];
          ticketId = docSnap.id;
        }
      }

      if (!docSnap.exists()) {
        setPaymentResult({
          ganador: false,
          estado: "error",
          message: `No se encontró ningún ticket con ID o Firma: "${cleanNum}"`,
          monto: 0
        } as any);
        return;
      }

      const ticket = docSnap.data() as any;
      ticket.id = ticketId;
      ticket.fecha_emision_date = toDateSafe(ticket.fecha_emision);

      // 2. Check if already cobrado or anulado
      if (ticket.estado === "anulado") {
        setPaymentResult({
          ganador: false,
          estado: "anulado",
          message: "Este ticket está ANULADO y no puede cobrarse.",
          monto: 0
        } as any);
        return;
      }

      if (ticket.estado === "cobrado") {
        setPaymentResult({
          ganador: false,
          estado: "cobrado",
          message: "Ticket ya pagado anteriormente.",
          monto: 0
        } as any);
        return;
      }

      // 3. Find draw result
      let game = ticket.id_juego || "";
      let draw = ticket.id_sorteo || "";
      if (!game || !draw) {
        // Legacy fallback: parse from juego_sorteo string
        const js = ticket.juego_sorteo || "";
        if (js.startsWith("La Diaria")) {
          game = "La Diaria";
          draw = js.substring("La Diaria".length).trim();
        } else if (js.startsWith("Premia2")) {
          game = "Premia2";
          draw = js.substring("Premia2".length).trim();
        } else if (js.startsWith("Pega 3")) {
          game = "Pega 3";
          draw = js.substring("Pega 3".length).trim();
        } else if (js.startsWith("Jugá 3")) {
          game = "Jugá 3";
          draw = js.substring("Jugá 3".length).trim();
        } else if (js.startsWith("Diaria")) {
          game = "Diaria";
          draw = js.substring("Diaria".length).trim();
        } else if (js.startsWith("Fechas")) {
          game = "Fechas";
          draw = js.substring("Fechas".length).trim();
        } else if (js.startsWith("Terminación 2")) {
          game = "Terminación 2";
          draw = js.substring("Terminación 2".length).trim();
        } else if (js.startsWith("Súper Premio")) {
          game = "Súper Premio";
          draw = js.substring("Súper Premio".length).trim();
        } else if (js.startsWith("3 Monazos")) {
          game = "3 Monazos";
          draw = js.substring("3 Monazos".length).trim();
        } else {
          const parts = js.split(" ");
          game = parts[0] || "";
          draw = parts.slice(1).join(" ");
        }
      }

      const tDate = ticket.fecha_emision_date.toISOString().substring(0, 10);
      const sObj = config.sorteos?.find(d => d.nombre === draw && d.juego === game);
      const rObj = sObj
        ? (config.resultados || []).find((r: any) => r.id_sorteo === sObj.id && r.fecha === tDate)
        : null;

      if (!rObj) {
        setPaymentResult({
          ganador: false,
          estado: "pendiente_sorteo",
          message: `El sorteo ${game} ${draw} del ${tDate} aún no se ha realizado o no tiene resultados oficiales cargados.`,
          monto: 0
        } as any);
        return;
      }

      const officialWinnerNum = rObj.numero_ganador;
      let prizeAmount = 0;
      
      // Calculate prize
      if (ticket.jugadas && ticket.jugadas.length > 0) {
        ticket.jugadas.forEach((j: any) => {
          if (j.numero.trim().toLowerCase() === officialWinnerNum.trim().toLowerCase()) {
            const multiplier = calculatePrizeMultiplier(game, draw);
            let p = j.monto * multiplier;
            if (ticket.moneda === "USD") p *= (config.tasa_cambio || 36.50);
            prizeAmount += p;
          }
        });
      } else if (ticket.numero_jugado) {
        if (ticket.numero_jugado.trim().toLowerCase() === officialWinnerNum.trim().toLowerCase()) {
          const multiplier = calculatePrizeMultiplier(game, draw);
          let p = (ticket.monto_pago || 0) * multiplier;
          if (ticket.moneda === "USD") p *= (config.tasa_cambio || 36.50);
          prizeAmount += p;
        }
      }

      if (prizeAmount > 0) {
        setPaymentResult({
          ganador: true,
          estado: "pendiente",
          ticketId: ticketId,
          juegoSorteo: ticket.juego_sorteo,
          numGanador: officialWinnerNum,
          message: `El número ganador del sorteo ${ticket.juego_sorteo} fue: ${officialWinnerNum}`,
          monto: prizeAmount
        } as any);
      } else {
        setPaymentResult({
          ganador: false,
          estado: "pendiente",
          message: `El número ganador del sorteo ${ticket.juego_sorteo} fue: ${officialWinnerNum}. El ticket no coincide.`,
          monto: 0
        } as any);
      }

    } catch (err) {
      console.error("Error checking ticket prize:", err);
      setPaymentResult({
        ganador: false,
        estado: "error",
        message: "Error al validar el ticket en Firestore.",
        monto: 0
      } as any);
    } finally {
      setLoading(false);
      setQrSearchInput("");
    }
  };

  const handleEfectuarPago = async (tId: string) => {
    setLoading(true);
    try {
      const docRef = doc(firestore, "tickets", tId);
      await updateDoc(docRef, { estado: "cobrado" });
      
      try {
        await fetch(`/api/ventas/${tId}/pagar`, {
          method: "POST"
        });
      } catch (errSync) {
        console.warn("REST API sync failed (possibly offline). Ticket is marked as cobrado in Firestore.", errSync);
      }

      toast.success("¡Pago registrado con éxito!");
      setPaymentResult(null);
      onRefreshSales();
    } catch (err) {
      console.error("Error registering ticket payment:", err);
      toast.error("Error al registrar el pago");
    } finally {
      setLoading(false);
    }
  };

  const isSorteoPasado = (ticket: any): boolean => {
    let game = ticket.id_juego || "";
    let draw = ticket.id_sorteo || "";
    if (!game || !draw) {
      const js = ticket.juego_sorteo || "";
      if (js.startsWith("La Diaria")) {
        game = "La Diaria";
        draw = js.substring("La Diaria".length).trim();
      } else if (js.startsWith("Premia2")) {
        game = "Premia2";
        draw = js.substring("Premia2".length).trim();
      } else if (js.startsWith("Pega 3")) {
        game = "Pega 3";
        draw = js.substring("Pega 3".length).trim();
      } else if (js.startsWith("Jugá 3")) {
        game = "Jugá 3";
        draw = js.substring("Jugá 3".length).trim();
      } else if (js.startsWith("Diaria")) {
        game = "Diaria";
        draw = js.substring("Diaria".length).trim();
      } else if (js.startsWith("Fechas")) {
        game = "Fechas";
        draw = js.substring("Fechas".length).trim();
      } else if (js.startsWith("Terminación 2")) {
        game = "Terminación 2";
        draw = js.substring("Terminación 2".length).trim();
      } else if (js.startsWith("Súper Premio")) {
        game = "Súper Premio";
        draw = js.substring("Súper Premio".length).trim();
      } else if (js.startsWith("3 Monazos")) {
        game = "3 Monazos";
        draw = js.substring("3 Monazos".length).trim();
      }
    }
    const ticketDate = ticket.timestamp_servidor ? ticket.timestamp_servidor.substring(0, 10) : new Date().toISOString().substring(0, 10);
    const sObj = config.sorteos?.find(s => s.nombre === draw && s.juego === game);
    if (!sObj) return true;

    const rObj = sObj
      ? (config.resultados || []).find((r: any) => r.id_sorteo === sObj.id && r.fecha === ticketDate)
      : null;
    if (rObj) return true;

    const todayStr = getSyncedNow().toISOString().substring(0, 10);
    if (ticketDate < todayStr) return true;
    if (ticketDate === todayStr) {
      return isSorteoCerrado(sObj);
    }
    return false;
  };

  // Real-time Firestore listener for this vendor's tickets (replaces one-shot fetchReportTickets)
  // This ensures the "A Pagar" total updates instantly when the server runs escrutinio after
  // the admin publishes a winning number.
  useEffect(() => {
    setReportLoading(true);
    const q = query(
      collection(firestore, "tickets"),
      where("id_vendedor", "==", user.id)
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      // Process docChanges to handle added/modified/removed correctly
      let changed = false;
      querySnapshot.docChanges().forEach((change) => {
        if (change.type === "added" || change.type === "modified") {
          changed = true;
        }
        if (change.type === "removed") {
          changed = true;
        }
      });

      if (changed) {
        // Rebuild full list from current snapshot (excludes deleted docs)
        const tickets = querySnapshot.docs.map(docVal => {
          const data = docVal.data();
          return {
            id: docVal.id,
            ...data,
            fecha_emision_date: toDateSafe(data.fecha_emision)
          };
        });
        // Sort descending by emission date
        tickets.sort((a, b) => b.fecha_emision_date.getTime() - a.fecha_emision_date.getTime());
        setReportTickets(tickets);
      }
      setReportLoading(false);
    }, (err) => {
      console.error("Error in onSnapshot tickets:", err);
      toast.error("Error de conexión en tiempo real con Firestore");
      setReportLoading(false);
    });

    return () => unsubscribe();
  }, [user.id]);

  // Reactive "A Pagar" total computed from real-time ticket data
  const liveAPagar = useMemo(() => {
    const now = new Date();
    return reportTickets
      .filter(t => t.estado !== "anulado")
      .reduce((acc, t) => {
        return acc + ((typeof t.monto_premio === "number" && t.es_premiado) ? t.monto_premio : getTicketTheoreticalPrize(t, config));
      }, 0);
  }, [reportTickets]);

  // Toast notification when totalAPagar transitions from 0 to >0
  const prevAPagarRef = useRef(0);
  useEffect(() => {
    if (liveAPagar > 0 && prevAPagarRef.current === 0) {
      toast.success("¡Tienes tickets premiados! Revisa tu reporte de caja.", { duration: 6000, position: "top-center" });
    }
    prevAPagarRef.current = liveAPagar;
  }, [liveAPagar]);

  // Verificar premio de un ticket contra resultados oficiales
  const verificarPremioTicket = async (ticket: Venta) => {
    // 1. Verificar si ya fue pagado
    if (ticket.estado === 'pagado') {
      setPrizeResult({
        show: true,
        type: 'already_paid',
        ticket,
        message: 'Este ticket ya fue pagado anteriormente.'
      });
      return;
    }
    if (ticket.anulado) {
      setPrizeResult({
        show: true,
        type: 'error',
        ticket,
        message: 'Este ticket está anulado y no puede cobrarse.'
      });
      return;
    }

    // 2. Buscar el sorteo en config para verificar si tiene resultados
    const sorteoObj = config.sorteos.find(s => s.nombre === ticket.sorteo);
    const ticketDate = toDateStr(ticket.timestamp_servidor);

    // 3. Buscar resultado oficial para ese sorteo y fecha
    const resultado = (config.resultados || []).find(r =>
      r.id_sorteo === (sorteoObj?.id || '') && r.fecha === ticketDate
    );

    if (!resultado) {
      setPrizeResult({
        show: true,
        type: 'sorteo_abierto',
        ticket,
        message: 'El sorteo de este ticket aún no se ha realizado o no tiene resultados cargados.'
      });
      return;
    }

    // 4. Cruzar cada jugada contra el número ganador
    const jugadas = ticket.jugadas || [];
    let premioTotal = 0;
    let aciertos: { numero: string; monto: number; premio: number }[] = [];

    if (jugadas.length === 0 && ticket.numero_jugado) {
      // Fallback para tickets antiguos sin jugadas[]
      const ganador = resultado.numero_ganador.trim().toLowerCase();
      const jugado = ticket.numero_jugado.trim().toLowerCase();

      if (ganador === jugado) {
        const multiplier = calculatePrizeMultiplier(ticket.juego, ticket.sorteo);
        premioTotal = ticket.moneda === "C$"
          ? (ticket.monto_pago * multiplier)
          : (ticket.monto_pago * multiplier * config.tasa_cambio);
        aciertos.push({ numero: ticket.numero_jugado, monto: ticket.monto_pago, premio: premioTotal });
      }
    } else {
      for (const jugada of jugadas) {
        const ganador = resultado.numero_ganador.trim().toLowerCase();
        const jugado = jugada.numero.trim().toLowerCase();

        if (jugado === ganador) {
          const multiplier = calculatePrizeMultiplier(ticket.juego, ticket.sorteo);
          let premioJugada = jugada.monto * multiplier;
          if (ticket.moneda === "USD") premioJugada *= config.tasa_cambio;
          premioTotal += premioJugada;
          aciertos.push({ numero: jugada.numero, monto: jugada.monto, premio: premioJugada });
        }
      }
    }

    if (premioTotal > 0) {
      setPrizeResult({
        show: true,
        type: 'winner',
        ticket,
        monto_premio: premioTotal,
        message: `¡Ticket premiado por C$ ${premioTotal.toFixed(2)}!`
      });
    } else {
      setPrizeResult({
        show: true,
        type: 'loser',
        ticket,
        message: 'Ticket no premiado. Ningún número coincide con los resultados oficiales.'
      });
    }
  };

  const executeTicketSearch = async (queryVal: string) => {
    setQrSearchError(null);
    const query = queryVal.trim();
    if (!query) return;

    let targetNum = query;
    let targetFirma = "";

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

    const found = sales.find(s => 
      s.id === cleanNum || 
      s.numero_ticket === cleanNum ||
      s.numero_ticket === targetNum ||
      (s.firma_digital && s.firma_digital.toUpperCase() === cleanNum.toUpperCase()) ||
      (targetFirma && s.firma_digital && s.firma_digital.toUpperCase() === targetFirma.toUpperCase())
    );

    if (found) {
      verificarPremioTicket(found);
      setQrSearchInput("");
    } else {
      try {
        const response = await fetch(`/api/ventas?ticket=${cleanNum}`);
        if (!response.ok) throw new Error("Error en red");
        const data = await response.json();
        if (data && data.length > 0) {
          verificarPremioTicket(data[0]);
          setQrSearchInput("");
        } else {
          setQrSearchError(`No se encontró ningún ticket con ID, número o firma: "${query}"`);
        }
      } catch (err) {
        setQrSearchError(`No se encontró ningún ticket con ID, número o firma: "${query}"`);
      }
    }
  };

  const handleTicketQrSearch = async (e: FormEvent) => {
    e.preventDefault();
    executeTicketSearch(qrSearchInput);
  };

  // Mappings of games by country
  const PAISES_GAMES = {
    Nicaragua: ["Diaria", "Fechas", "Jugá 3", "Premia2", "Terminación 2", "Sabadito"],
    Honduras: ["La Diaria", "Premia2", "Pega 3", "Súper Premio"],
    "El Salvador": ["Diaria"],
    "La Primera": ["La Primera"],
    "Costa Rica": ["3 Monazos", "Tica"]
  };

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

  // Helper to check if a draw is closed based on serverTime or local clock
  function isSorteoCerrado(s: Sorteo) {
    try {
      const now = getSyncedNow();
      const [cierreHour, cierreMin] = s.hora_cierre.split(":").map(Number);
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      
      const passedCierre = (currentHour > cierreHour) || (currentHour === cierreHour && currentMin >= cierreMin);
      return passedCierre;
    } catch (e) {
      return false;
    }
  };

  // Cash closure (Cierre) state
  const [denominacionesCs, setDenominacionesCs] = useState<Record<string, number>>({
    "1000": 0, "500": 0, "200": 0, "100": 0, "50": 0, "20": 0, "10": 0
  });
  const [denominacionesUsd, setDenominacionesUsd] = useState<Record<string, number>>({
    "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "1": 0
  });
  const [declaradoCsManual, setDeclaradoCsManual] = useState<string>("");
  const [declaradoUsdManual, setDeclaradoUsdManual] = useState<string>("");
  const [cierreEnviado, setCierreEnviado] = useState(false);

  // Helper to format Date as YYYY-MM-DD
  const getTodayString = () => {
    const d = getSyncedNow();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [filterDate, setFilterDate] = useState<string>(getTodayString());
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Time remaining tracker (just to show active feedback)
  const [timeText, setTimeText] = useState("");

  const getSorteosByGame = (game: string) => {
    let suffix = "(NI)";
    if (selectedPais === "Honduras") suffix = "(HN)";
    else if (selectedPais === "El Salvador") suffix = "(SV)";
    else if (selectedPais === "La Primera") suffix = "(LP)";
    else if (selectedPais === "Costa Rica") suffix = "(CR)";
    const now = getSyncedNow();
    return config.sorteos.filter(s =>
      s.juego === game && s.nombre.includes(suffix) && isSorteoHabilitado(s, now)
    );
  };

  // Synchronize game selection when country changes
  useEffect(() => {
    const games = PAISES_GAMES[selectedPais as keyof typeof PAISES_GAMES] || [];
    if (games.length > 0 && !games.includes(selectedJuego)) {
      setSelectedJuego(games[0]);
    }
  }, [selectedPais]);

  useEffect(() => {
    // Select default draw when game or drawings change
    const filteredSorteos = getSorteosByGame(selectedJuego);
    const activeDraw = filteredSorteos.find(s => !isSorteoCerrado(s));
    if (activeDraw) {
      setSelectedSorteo(activeDraw.nombre);
    } else if (filteredSorteos.length > 0) {
      setSelectedSorteo(filteredSorteos[0].nombre);
    } else {
      setSelectedSorteo("");
    }
    
    // Reset fecha to valid date for the selected sorteo
    const newActiveDraw = getSorteosByGame(selectedJuego).find(s => !isSorteoCerrado(s)) || getSorteosByGame(selectedJuego)[0];
    if (newActiveDraw) {
      setFechaVenta(parseDateStrToFechaVenta(getNextValidDate(newActiveDraw, new Date())));
    } else {
      const now = new Date();
      setFechaVenta({ dia: String(now.getDate()).padStart(2, "0"), mes: MESES[now.getMonth()], anio: now.getFullYear() });
    }
    
    // Set default value for Fechas
    if (selectedJuego === "Fechas") {
      const fechaStr = newActiveDraw ? getNextValidDate(newActiveDraw, new Date()) : new Date().toISOString().split("T")[0];
      const d = new Date(fechaStr + "T12:00:00");
      const diaF = String(d.getDate()).padStart(2, "0");
      setNumeroJugado(`${diaF}-${MESES[d.getMonth()]}`);
    } else {
      setNumeroJugado("");
    }
  }, [selectedJuego, selectedPais, config.sorteos]);

  // Keep simulated clock updated
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setTimeText(formatTo12HourTime(now));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter vendor sales
  const allMySales = sales
    .filter(s => s.id_vendedor === user.id)
    .sort((a, b) => new Date(b.timestamp_servidor).getTime() - new Date(a.timestamp_servidor).getTime());

  // Filtered list based on Search and Date
  const displayedSales = allMySales.filter(s => {
    // Check Date match
    const saleDateStr = getTicketDate(s); // YYYY-MM-DD
    const dateMatches = filterDate ? (saleDateStr === filterDate) : true;
    
    // Check search query (by Ticket # or Number played or Game)
    const query = searchQuery.trim().toLowerCase();
    const searchMatches = query
      ? (s.numero_ticket.toLowerCase().includes(query) || s.numero_jugado.includes(query) || s.juego.toLowerCase().includes(query))
      : true;
      
    return dateMatches && searchMatches;
  });

  // Calculations for current cashier (based on today's active sales)
  const myTodaySales = allMySales.filter(s => getTicketDate(s) === getTodayString());
  const systemCs = myTodaySales.filter(s => !s.anulado && s.moneda === "C$").reduce((sum, s) => sum + s.monto_pago, 0);
  const systemUsd = myTodaySales.filter(s => !s.anulado && s.moneda === "USD").reduce((sum, s) => sum + s.monto_pago, 0);

  // Helper to format 24h string to standard AM/PM format
  const formatHourToAmPm = (timeStr: string): string => {
    if (!timeStr) return "";
    const parts = timeStr.split(":");
    let hour = parseInt(parts[0], 10);
    const min = parts[1] || "00";
    if (isNaN(hour)) return timeStr;
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${hour}:${min} ${ampm}`;
  };

  // Perform granular limit check in real-time
  function getRealTimeLimitCheck() {
    if (!numeroJugado || !selectedSorteo) return null;

    const limits = config?.limites_numeros || [];
    
    // Find the selected Sorteo object to get its details
    const activeSorteoObj = config?.sorteos?.find(s => s.nombre === selectedSorteo);
    const transHora = activeSorteoObj ? formatHourToAmPm(activeSorteoObj.hora_sorteo).toUpperCase() : "";

    // Search for a matching limit rule
    const matchedLimit = limits.find((l: any) => {
      // 1. Match Game
      const limitJuego = l.juego || "";
      const gameMatch = !limitJuego || limitJuego === "TODOS" || limitJuego.toLowerCase() === selectedJuego.toLowerCase();
      if (!gameMatch) return false;

      // 2. Match Number
      const limitNum = l.numero ?? l.numero_jugado ?? "TODOS";
      const numMatch = limitNum === "TODOS" || String(limitNum) === String(numeroJugado);
      if (!numMatch) return false;

      // 3. Match Seller
      const limitSellerId = l.id_vendedor || l.vendedorId || "";
      const sellerMatch = !limitSellerId || limitSellerId === "TODOS" || limitSellerId === user.id;
      if (!sellerMatch) return false;

      // 4. Match Country/Pais
      const limitPais = l.pais || "";
      const paisMatch = !limitPais || limitPais === "TODOS" || limitPais.toLowerCase() === selectedPais.toLowerCase();
      if (!paisMatch) return false;

      // 5. Match Sorteo
      const limitSorteoName = l.sorteo || "";
      const sorteoMatch = !limitSorteoName || limitSorteoName === "TODOS" ||
                          selectedSorteo.toLowerCase().includes(limitSorteoName.toLowerCase()) ||
                          limitSorteoName.toLowerCase().includes(selectedSorteo.toLowerCase());
      if (!sorteoMatch) return false;

      // 6. Match Hour
      const limitHora = (l.hora || l.hora_limite || "").trim().toUpperCase();
      const horaMatch = !limitHora || limitHora === "TODOS" || limitHora === "CUALQUIERA" || limitHora === transHora;
      if (!horaMatch) return false;

      return true;
    });

    if (!matchedLimit) return null;

    // We found a matching rule! Calculate already sold accumulated today in C$
    const limitMontoCs = Number(matchedLimit.max_monto ?? matchedLimit.montoMaximo ?? matchedLimit.techo_dinero);
    const todayStr = getTodayString();

    const matchingSales = sales.filter((v: any) => {
      if (v.anulado) return false;

      // Match game
      const limitJuego = matchedLimit.juego || "";
      if (limitJuego && limitJuego !== "TODOS" && v.juego.toLowerCase() !== limitJuego.toLowerCase()) return false;

      // Match number
      const limitNum = matchedLimit.numero ?? matchedLimit.numero_jugado ?? "TODOS";
      if (limitNum !== "TODOS" && String(v.numero_jugado) !== String(limitNum)) return false;

      // Match Sorteo
      const limitSorteoName = matchedLimit.sorteo || "";
      if (limitSorteoName && limitSorteoName !== "TODOS" && 
          !v.sorteo.toLowerCase().includes(limitSorteoName.toLowerCase()) &&
          !limitSorteoName.toLowerCase().includes(v.sorteo.toLowerCase())) return false;

      // Match Seller
      const limitSellerId = matchedLimit.id_vendedor || matchedLimit.vendedorId || "";
      if (limitSellerId && limitSellerId !== "TODOS" && v.id_vendedor !== limitSellerId) return false;

      // Match Hour
      const limitHora = (matchedLimit.hora || matchedLimit.hora_limite || "").trim().toUpperCase();
      if (limitHora && limitHora !== "TODOS" && limitHora !== "CUALQUIERA") {
        const vSorteoObj = config?.sorteos?.find((s: any) => s.nombre === v.sorteo && s.juego === v.juego);
        if (vSorteoObj) {
          const vHora = formatHourToAmPm(vSorteoObj.hora_sorteo).toUpperCase();
          if (vHora !== limitHora) return false;
        }
      }

      // Today only
      if (!v.timestamp_servidor.startsWith(todayStr)) return false;

      return true;
    });

    const totalPrevSalesCs = matchingSales.reduce((sum: number, v: any) => {
      const amtInCs = v.moneda === "C$" ? v.monto_pago : v.monto_pago * (config?.tasa_cambio || 36);
      return sum + amtInCs;
    }, 0);

    const numericAmount = Number(montoPago) || 0;
    const requestedMontoCs = moneda === "C$" ? numericAmount : numericAmount * (config?.tasa_cambio || 36);
    const isExceeded = (totalPrevSalesCs + requestedMontoCs) > limitMontoCs;

    return {
      limitMontoCs,
      totalPrevSalesCs,
      requestedMontoCs,
      isExceeded,
      rule: matchedLimit
    };
  };

  limitCheckResult = getRealTimeLimitCheck();
  isLimitBlocked = limitCheckResult?.isExceeded || false;

  // Numeric keyboard handler
  const handleKeypadPress = (val: string) => {
    setErrorMessage(null);
    setSuccessMessage(null);
    
    if (val === "ENTER") {
      if (activeField === "numero") {
        setActiveField("monto");
      } else {
        addJugadaAlCarrito();
      }
      return;
    }

    if (activeField === "numero") {
      // Determine maximum digits based on the game
      let maxDigits = 2;
      if (selectedJuego === "Premia2") maxDigits = 4;
      else if (selectedJuego === "Jugá 3" || selectedJuego === "3 Monazos") maxDigits = 3;
      else if (selectedJuego === "Pega 3") maxDigits = 6;
      else if (selectedJuego === "Súper Premio") maxDigits = 12;

      if (val === "BORRAR") {
        setNumeroJugado("");
      } else if (val === "BACKSPACE") {
        setNumeroJugado(prev => prev.slice(0, -1));
      } else {
        if (numeroJugado.length < maxDigits) {
          setNumeroJugado(prev => prev + val);
        }
      }
    } else {
      // activeField === 'monto'
      if (val === "BORRAR") {
        setMontoPago("");
      } else if (val === "BACKSPACE") {
        setMontoPago(prev => prev.slice(0, -1));
      } else {
        setMontoPago(prev => {
          if (prev === "0") return val;
          return prev + val;
        });
      }
    }
  };

  // Preset Amount triggers
  const presetAmountsCs = [10, 20, 50, 100, 200, 500];
  const presetAmountsUsd = [1, 5, 10, 20, 50, 100];

  const handlePresetAmount = (amount: number) => {
    setMontoPago(String(amount));
  };

  // --- DRAFT STATE COMMIT: Green button commits entire cart ---
  const handleGenerarTicket = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    // 1. Validate cart is not empty
    if (jugadas.length === 0) {
      if (numeroJugado && montoPago) {
        toast.error("Primero presione el botón azul (+) para añadir la jugada al carrito antes de generar el ticket.", { duration: 3000, position: 'top-center' });
      } else {
        toast.error("El carrito está vacío. Ingrese un número y monto, luego agréguelo con el botón azul (+).", { duration: 3000, position: 'top-center' });
      }
      return;
    }

    // 2. Validate sorteo is active
    if (!selectedSorteo) {
      toast.error("No hay sorteos activos seleccionados.", { duration: 3000, position: 'top-center' });
      return;
    }

    // 3. Validate sorteo is not closed (anti-fraude)
    const matchingSorteo = config.sorteos.find(s => s.nombre === selectedSorteo);
    if (matchingSorteo && isSorteoCerrado(matchingSorteo)) {
      toast.error(`VENTA BLOQUEADA: El sorteo ${selectedSorteo} ya cerró (${formatTo12Hour(matchingSorteo.hora_cierre)}).`, { duration: 4000, position: 'top-center' });
      return;
    }

    // 3b. Validate sorteo is enabled today
    if (matchingSorteo && !isSorteoHabilitado(matchingSorteo, getSyncedNow())) {
      toast.error(`BLOQUEADO: El sorteo ${selectedSorteo} no está habilitado hoy. ${getDiasHabilitadosShortLabel(matchingSorteo)}.`, { duration: 4000, position: 'top-center' });
      return;
    }

    // 3c. Validate fecha_venta matches sorteo day restriction
    if (matchingSorteo && !isDateValidForSorteo(matchingSorteo, fechaVentaToDateStr(fechaVenta))) {
      toast.error(`FECHA INVÁLIDA: ${selectedSorteo} no opera el ${fechaVentaToDateStr(fechaVenta)}. ${getDiasHabilitadosShortLabel(matchingSorteo)}.`, { duration: 4000, position: 'top-center' });
      return;
    }

    // 4. Validate limit not exceeded for this batch
    if (isLimitBlocked && limitCheckResult) {
      toast.error(`NÚMERO BLOQUEADO: Límite de C$ ${limitCheckResult.limitMontoCs.toLocaleString("es-ES")} alcanzado para este vendedor en este sorteo. Vendido hoy: C$ ${limitCheckResult.totalPrevSalesCs.toLocaleString("es-ES")}.`, { duration: 5000, position: 'top-center' });
      return;
    }

    // 5. Compute totals from draft cart
    const totalMontoCs = jugadas.reduce((sum, j) => {
      return sum + (moneda === "USD" ? j.monto * (config.tasa_cambio || 36.50) : j.monto);
    }, 0);
    const totalPremioCs = jugadas.reduce((sum, j) => sum + j.premio_posible, 0);

    // 6. Server-side atomic ticket creation (sequential ID via Firestore transaction)
      setIsSubmittingTicket(true);
      try {
        // Send ticket data to server — server creates atomically in Firestore + local DB
      const response = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          juego: selectedJuego,
          sorteo: selectedSorteo,
          numero_jugado: jugadas[0].numero,
          monto_pago: totalMontoCs,
          moneda,
          id_vendedor: user.id,
          nombre_cliente: nombreCliente.trim() || "Genérico",
          premio_posible_cs: totalPremioCs,
          jugadas: jugadas.map(j => ({ numero: j.numero, monto: j.monto })),
          fecha_venta: fechaVentaToDateStr(fechaVenta),
          pais: ""
        })
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `Error del servidor (HTTP ${response.status})`);
      }

      const createdSale = await response.json();
      const syncedTicket: Venta = {
        id: createdSale.id,
        id_ticket: createdSale.numero_ticket,
        numero_ticket: createdSale.numero_ticket,
        timestamp_servidor: createdSale.timestamp_servidor,
        fecha_venta: createdSale.fecha_venta || fechaVentaToDateStr(fechaVenta),
        juego: selectedJuego,
        sorteo: selectedSorteo,
        numero_jugado: jugadas[0].numero,
        monto_pago: totalMontoCs,
        moneda,
        id_vendedor: user.id,
        nombre_vendedor: user.nombre,
        nombre_cliente: nombreCliente.trim() || "Genérico",
        premio_posible_cs: totalPremioCs,
        firma_digital: createdSale.firma_digital,
        anulado: false,
        estado: "pendiente",
        jugadas: jugadas.map(j => ({ numero: j.numero, monto: j.monto, premio_posible: j.premio_posible, fecha_venta: j.fecha_venta || fechaVentaToDateStr(fechaVenta) }))
      };

      onNewSaleCreated(syncedTicket);
      setActiveTicket(syncedTicket);
      setSuccessMessage(`Ticket #${syncedTicket.numero_ticket} emitido con éxito.`);
      toast.success(`Ticket #${syncedTicket.numero_ticket} emitido con éxito`, { position: 'top-center' });
      // Full cleanup: cart + form + nombre
      setJugadas([]);
      setNumeroJugado("");
      setMontoPago("");
      setNombreCliente("Genérico");
      setActiveField("numero");
      onRefreshSales();
    } catch (err: any) {
      console.error("Error al crear ticket:", err);
      toast.error(err.message || "Error al crear el ticket", { duration: 5000, position: 'top-center' });
      setErrorMessage(err.message || "Ocurrió un error al crear el ticket.");
    } finally {
      setIsSubmittingTicket(false);
    }
  };

  // Void/Anular ticket handler
  const handleAnularTicket = async (ticketId: string) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!isOnline) {
      setErrorMessage("No se pueden anular tickets mientras esté fuera de línea.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/ventas/${ticketId}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userRole: user.rol })
      });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "No se pudo anular el ticket.");
      }

      setSuccessMessage(`Ticket #${data.ticket.numero_ticket} ANULADO con éxito.`);
      onRefreshSales();
    } catch (err: any) {
      setErrorMessage(err.message || "Error al anular el ticket.");
    } finally {
      setLoading(false);
    }
  };

  // Cash Closure Calculations
  const calculatedCs = Object.entries(denominacionesCs).reduce((sum: number, [den, qty]) => sum + (Number(den) * (qty as number)), 0);
  const calculatedUsd = Object.entries(denominacionesUsd).reduce((sum: number, [den, qty]) => sum + (Number(den) * (qty as number)), 0);

  const finalDeclaradoCs = declaradoCsManual !== "" ? Number(declaradoCsManual) : calculatedCs;
  const finalDeclaradoUsd = declaradoUsdManual !== "" ? Number(declaradoUsdManual) : calculatedUsd;

  const descuadreCs = finalDeclaradoCs - systemCs;
  const descuadreUsd = finalDeclaradoUsd - systemUsd;

  const handleCerrarCaja = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!isOnline) {
      setErrorMessage("Se requiere conexión para poder transmitir el cierre de caja.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/cierres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_vendedor: user.id,
          denominaciones: {
            cs: denominacionesCs,
            usd: denominacionesUsd
          },
          monto_entregado_cs: finalDeclaradoCs,
          monto_entregado_usd: finalDeclaradoUsd
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Error al enviar cierre.");
      }

      setCierreEnviado(true);
      setSuccessMessage("¡CIERRE DE CAJA ENVIADO! Reporte transmitido al administrador en vivo.");
      
      // Reset after 5 seconds
      setTimeout(() => {
        setCierreEnviado(false);
        setDenominacionesCs({ "1000": 0, "500": 0, "200": 0, "100": 0, "50": 0, "20": 0, "10": 0 });
        setDenominacionesUsd({ "100": 0, "50": 0, "20": 0, "10": 0, "5": 0, "1": 0 });
        setDeclaradoCsManual("");
        setDeclaradoUsdManual("");
      }, 5000);

    } catch (err: any) {
      setErrorMessage(err.message || "Error al procesar el cierre de caja.");
    } finally {
      setLoading(false);
    }
  };

  // Helper to test void 5-minute limit
  const getSecondsRemaining = (createdAtStr: string) => {
    const elapsedMs = Date.now() - new Date(createdAtStr).getTime();
    const remainingMs = (5 * 60 * 1000) - elapsedMs;
    if (remainingMs <= 0) return 0;
    return Math.ceil(remainingMs / 1000);
  };

  return (
    <div id="vendedor-container" className="flex flex-col bg-[#F3F4F6] w-full h-full">
      
      {/* Vendedor Bar — fixed, never shrinks */}
      <div className="bg-[#1E3A8A] text-white px-4 py-3 flex flex-col justify-between border-b border-blue-950 shrink-0">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="relative">
              <span className="text-sm font-display font-black tracking-wide uppercase">{user.nombre}</span>
              <span className="block text-[10px] text-blue-200 uppercase font-mono tracking-wider font-bold">Vendedor POS</span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Bluetooth Printer Button */}
            <button
              id="printer-connect-btn"
              onClick={() => {
                if (printerStatus === "connected") {
                  printerRef.current?.disconnect();
                } else {
                  printerRef.current?.connect();
                }
              }}
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all shadow-inner border cursor-pointer ${
                printerStatus === "connected"
                  ? "bg-[#10B981] border-[#0F9F6F] text-white"
                  : printerStatus === "connecting" || printerStatus === "printing"
                  ? "bg-[#F59E0B] border-[#D97706] text-white animate-pulse"
                  : printerStatus === "error"
                  ? "bg-[#EF4444] border-[#D83A3A] text-white"
                  : "bg-gray-600 border-gray-500 text-white"
              }`}
            >
              <Printer className="w-3 h-3" />
              <span>
                {printerStatus === "connected" ? "Impresora" :
                 printerStatus === "connecting" ? "Conectando..." :
                 printerStatus === "printing" ? "Imprimiendo..." :
                 printerStatus === "error" ? "Error BT" :
                 "BT Off"}
              </span>
            </button>
            {/* Live simulator connection switch */}
            <button
              id="conn-toggle"
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all shadow-inner border ${
                isOnline 
                  ? "bg-[#10B981] border-[#0F9F6F] text-white" 
                  : "bg-[#EF4444] border-[#D83A3A] text-white"
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3 h-3 animate-pulse" />
                  <span>Conectado</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3 h-3" />
                  <span>Sin Red</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Live Rate and clock display */}
        <div className="mt-2 pt-2 border-t border-blue-800 flex justify-between items-center text-[11px] font-mono font-bold text-blue-200">
          <span>T. CAMBIO: C$ {config.tasa_cambio.toFixed(2)}</span>
          <span className="bg-blue-950 px-2 py-0.5 rounded text-white animate-pulse">Reloj: {timeText}</span>
        </div>
      </div>

      {/* Main Area / Scrollable Screens */}
      <div className="flex-1 p-4 overflow-y-auto">
        
        {/* Error and Success banners */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-red-100 border-l-4 border-[#EF4444] rounded-lg text-red-900 font-sans text-xs flex items-start space-x-2 shadow-sm">
            <AlertCircle className="w-4 h-4 text-[#EF4444] shrink-0 mt-0.5" />
            <span className="font-bold tracking-tight">{errorMessage}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3 bg-emerald-100 border-l-4 border-[#10B981] rounded-lg text-emerald-900 font-sans text-xs flex items-center space-x-2 shadow-sm">
            <Check className="w-4 h-4 text-[#10B981] shrink-0 stroke-[3]" />
            <span className="font-bold tracking-tight">{successMessage}</span>
          </div>
        )}

        {/* Búsqueda de Ticket QR / ID (Anti-Fraude) */}
        <div className="bg-white p-3 rounded-2xl border border-gray-300 shadow-xs mb-4 space-y-2">
          <form onSubmit={handleTicketQrSearch} className="flex space-x-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={qrSearchInput}
                onChange={(e) => setQrSearchInput(e.target.value)}
                placeholder="ID del Ticket (ej: T-00001, o escanee QR)..."
                className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-xs font-sans font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
              />
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
            </div>
             <button
              type="button"
              onClick={() => setIsQrScannerOpen(true)}
              className="px-3 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-display font-black tracking-wider uppercase transition-colors flex items-center space-x-1 cursor-pointer shrink-0"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Buscar QR</span>
            </button>
          </form>
          {qrSearchError && (
            <div className="text-[10px] text-red-600 font-sans font-medium animate-pulse">
              ⚠️ {qrSearchError}
            </div>
          )}
        </div>

        {/* TAB 1: PANTALLA DE VENTA */}
        {activeTab === "venta" && (
          <div className="space-y-4 animate-fade-in pb-6">
            
            {/* 0. Country Selector */}
            <div>
              <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1.5">0. Seleccione País</label>
              <div className="grid grid-cols-5 gap-1">
                <button
                  id="pais-select-ni"
                  onClick={() => {
                    setSelectedPais("Nicaragua");
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`py-2 px-1 rounded-xl text-[9px] font-display font-black transition-all border flex flex-col items-center justify-center space-y-1 cursor-pointer shadow-xs ${
                    selectedPais === "Nicaragua"
                      ? "bg-blue-900 text-white border-blue-950 font-bold"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  <span className="text-sm">🇳🇮</span>
                  <span>NICARAGUA</span>
                </button>
                <button
                  id="pais-select-hn"
                  onClick={() => {
                    setSelectedPais("Honduras");
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`py-2 px-1 rounded-xl text-[9px] font-display font-black transition-all border flex flex-col items-center justify-center space-y-1 cursor-pointer shadow-xs ${
                    selectedPais === "Honduras"
                      ? "bg-blue-900 text-white border-blue-950 font-bold"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  <span className="text-sm">🇭🇳</span>
                  <span>HONDURAS</span>
                </button>
                <button
                  id="pais-select-sv"
                  onClick={() => {
                    setSelectedPais("El Salvador");
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`py-2 px-1 rounded-xl text-[9px] font-display font-black transition-all border flex flex-col items-center justify-center space-y-1 cursor-pointer shadow-xs ${
                    selectedPais === "El Salvador"
                      ? "bg-blue-900 text-white border-blue-950 font-bold"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  <span className="text-sm">🇸🇻</span>
                  <span>LOTO SV</span>
                </button>
                <button
                  id="pais-select-lp"
                  onClick={() => {
                    setSelectedPais("La Primera");
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`py-2 px-1 rounded-xl text-[9px] font-display font-black transition-all border flex flex-col items-center justify-center space-y-1 cursor-pointer shadow-xs ${
                    selectedPais === "La Primera"
                      ? "bg-blue-900 text-white border-blue-950 font-bold"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  <span className="text-sm">🎰</span>
                  <span>PRIMERA</span>
                </button>
                <button
                  id="pais-select-cr"
                  onClick={() => {
                    setSelectedPais("Costa Rica");
                    setErrorMessage(null);
                    setSuccessMessage(null);
                  }}
                  className={`py-2 px-1 rounded-xl text-[9px] font-display font-black transition-all border flex flex-col items-center justify-center space-y-1 cursor-pointer shadow-xs ${
                    selectedPais === "Costa Rica"
                      ? "bg-blue-900 text-white border-blue-950 font-bold"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                  }`}
                >
                  <span className="text-sm">🇨🇷</span>
                  <span>LA TICA</span>
                </button>
              </div>
            </div>

            {/* 1. Dynamic Game Selector */}
            <div>
              <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1.5">1. Seleccione Juego ({selectedPais})</label>
              <div className="grid grid-cols-3 gap-1.5">
                {PAISES_GAMES[selectedPais as keyof typeof PAISES_GAMES]?.map((juego) => {
                  const isSabadito = juego === "Sabadito";
                  const isWeekend = [0, 6].includes(getSyncedNow().getDay());
                  const disabled = isSabadito && !isWeekend;

                  return (
                    <button
                      key={juego}
                      id={`game-select-${juego.replace(/\s+/g, "-")}`}
                      onClick={() => {
                        if (disabled) {
                          setErrorMessage("Sabadito solo está disponible Sábados y Domingos.");
                          return;
                        }
                        setSelectedJuego(juego);
                        setErrorMessage(null);
                        setSuccessMessage(null);
                      }}
                      disabled={disabled}
                      className={`py-2.5 px-1 rounded-xl text-[10px] font-display font-black transition-all border text-center truncate shadow-xs ${
                        disabled ? "opacity-50 cursor-not-allowed bg-gray-200 text-gray-500 border-gray-300" : "cursor-pointer"
                      } ${
                        !disabled && selectedJuego === juego
                          ? "bg-[#1E3A8A] text-white border-blue-900 font-bold"
                          : !disabled ? "bg-white text-gray-800 border-gray-300 hover:bg-gray-100" : ""
                      }`}
                    >
                      {juego.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Sorteo Selector with automatic locking */}
            <div>
              <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1.5">2. Horario del Sorteo</label>
              <div className="flex flex-col space-y-1.5">
                {getSorteosByGame(selectedJuego).length === 0 ? (
                  <div className="text-xs text-red-500 bg-red-50 p-2 rounded border border-red-200">No hay sorteos programados para este juego hoy.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {getSorteosByGame(selectedJuego).map((s) => {
                      const cerrado = isSorteoCerrado(s);
                      const isSelected = selectedSorteo === s.nombre;
                      return (
                        <button
                          key={s.id}
                          id={`sorteo-select-${s.id}`}
                          disabled={cerrado}
                          onClick={() => {
                            if (!cerrado) {
                              setSelectedSorteo(s.nombre);
                            }
                          }}
                          className={`py-2.5 px-2 rounded-xl text-center font-sans text-xs transition-all border relative overflow-hidden ${
                            cerrado
                              ? "bg-gray-150 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed"
                              : isSelected
                              ? "bg-blue-900 text-white border-blue-950 font-bold cursor-pointer"
                              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 cursor-pointer"
                          }`}
                        >
                          <div className="font-bold flex items-center justify-center space-x-1">
                            <span>{s.nombre.replace(/\s*\(NI\)|\s*\(HN\)|\s*\(SV\)|\s*\(LP\)|\s*\(CR\)/g, "")}</span>
                            {cerrado && <span className="text-[9px] bg-red-100 text-red-700 px-1 py-0.2 rounded font-black">CERRADO</span>}
                          </div>
                          {s.dias_habilitados && s.dias_habilitados.length > 0 && (
                            <div className="text-[8px] bg-orange-100 text-orange-700 px-1 py-0.2 rounded font-black mt-0.5">
                              {getDiasHabilitadosShortLabel(s)}
                            </div>
                          )}
                          <div className={`text-[9px] font-mono mt-0.5 ${isSelected && !cerrado ? "text-blue-200" : "text-gray-400"}`}>
                            Cierre: {formatTo12Hour(s.hora_cierre)}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Play Form — NÚMERO | FECHA | MONTO inline row */}
            <div className="flex gap-2 items-end">
              
              {/* NÚMERO JUGADO */}
              <div className="flex-1 min-w-0">
                <label className="block text-[10px] font-display font-black text-gray-700 uppercase tracking-wider mb-1">NÚMERO JUGADO</label>
                <input
                  id="numero-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={
                    selectedJuego === "Premia2" ? 4 :
                    selectedJuego === "Jugá 3" || selectedJuego === "3 Monazos" ? 3 :
                    selectedJuego === "Pega 3" ? 6 :
                    selectedJuego === "Súper Premio" ? 12 : 2
                  }
                  value={numeroJugado}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, "");
                    const maxLen =
                      selectedJuego === "Premia2" ? 4 :
                      selectedJuego === "Jugá 3" || selectedJuego === "3 Monazos" ? 3 :
                      selectedJuego === "Pega 3" ? 6 :
                      selectedJuego === "Súper Premio" ? 12 : 2;
                    setNumeroJugado(val.slice(0, maxLen));
                  }}
                  onFocus={() => setActiveField("numero")}
                  placeholder={selectedJuego === "Fechas" ? "DD-MM" : "00"}
                  className={`w-full h-12 px-2 rounded-xl border-2 font-mono text-lg font-black text-center shadow-inner transition-colors focus:outline-none ${
                    isLimitBlocked
                      ? "border-[#EF4444] text-[#EF4444] bg-red-50 focus:border-red-600"
                      : activeField === "numero"
                      ? "border-blue-500 text-blue-900 bg-blue-50 shadow-md focus:border-blue-600"
                      : "border-gray-300 text-gray-900 bg-white focus:border-blue-500"
                  }`}
                />
              </div>

              {/* FECHA DEL SORTEO — Día + Mes calculator-style (solo para juego Fechas) */}
              {selectedJuego === "Fechas" && (() => {
                const currentSorteo = config.sorteos.find(s => s.nombre === selectedSorteo);
                const hasDiasRestriction = currentSorteo?.dias_habilitados && currentSorteo.dias_habilitados.length > 0;
                const diaNum = parseInt(fechaVenta.dia, 10);
                const isInvalidDay = fechaVenta.dia.length > 0 && (isNaN(diaNum) || diaNum < 1 || diaNum > 31);
                return (
                  <div className="flex gap-1 flex-shrink-0">
                    {/* DÍA */}
                    <div className="w-12">
                      <label className="block text-[10px] font-display font-black text-gray-700 uppercase tracking-wider mb-1">DÍA</label>
                      <input
                        id="fecha-dia-input"
                        type="number"
                        inputMode="numeric"
                        min="1"
                        max="31"
                        placeholder="DD"
                        value={fechaVenta.dia}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, "").slice(0, 2);
                          setFechaVenta(prev => ({ ...prev, dia: val }));
                          if (val.length === 2 && parseInt(val, 10) >= 1 && parseInt(val, 10) <= 31) {
                            const mesSelect = document.getElementById("fecha-mes-select") as HTMLSelectElement;
                            if (mesSelect) mesSelect.focus();
                          }
                        }}
                        onFocus={() => setActiveField("fecha")}
                        className={`w-full h-12 px-1 rounded-xl border-2 font-mono text-lg font-black text-center shadow-inner transition-colors focus:outline-none ${
                          isInvalidDay
                            ? "border-[#EF4444] text-[#EF4444] bg-red-50"
                            : activeField === "fecha"
                            ? "border-blue-500 text-blue-900 bg-blue-50 shadow-md focus:border-blue-600"
                            : "border-gray-300 text-gray-900 bg-white focus:border-blue-500"
                        }`}
                      />
                    </div>

                    {/* MES */}
                    <div className="w-[72px]">
                      <label className="block text-[10px] font-display font-black text-gray-700 uppercase tracking-wider mb-1">MES</label>
                      <select
                        id="fecha-mes-select"
                        value={fechaVenta.mes}
                        onChange={(e) => {
                          setFechaVenta(prev => ({ ...prev, mes: e.target.value }));
                          setNumeroJugado(`${fechaVenta.dia.padStart(2, "0")}-${e.target.value}`);
                          const montoInput = document.getElementById("monto-input") as HTMLInputElement;
                          if (montoInput) montoInput.focus();
                        }}
                        onFocus={() => setActiveField("fecha")}
                        className="w-full h-12 px-0.5 rounded-xl border-2 border-gray-300 bg-white font-sans text-[11px] font-bold text-gray-900 text-center focus:outline-none focus:border-blue-500 cursor-pointer transition-colors"
                      >
                        {MESES.map(m => (
                          <option key={m} value={m}>{m.slice(0, 3).toUpperCase()}</option>
                        ))}
                      </select>
                    </div>

                    {/* Year badge + restriction hint */}
                    <div className="flex flex-col items-center justify-end pb-1 gap-0.5">
                      <span className="text-[10px] font-mono font-black text-gray-400">{String(fechaVenta.anio).slice(2)}</span>
                      {isInvalidDay && (
                        <span className="text-[8px] font-black text-red-500">1-31</span>
                      )}
                      {hasDiasRestriction && !isInvalidDay && (
                        <span className="text-[7px] font-black text-orange-600 leading-tight text-center">{getDiasHabilitadosShortLabel(currentSorteo!).replace("SOLO ", "")}</span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* MONTO */}
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-[10px] font-display font-black text-gray-700 uppercase tracking-wider">MONTO</label>
                  
                  {/* Currency Toggle */}
                  <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-gray-150">
                    <button
                      id="curr-toggle-cs"
                      onClick={() => setMoneda("C$")}
                      className={`px-1.5 py-0.5 rounded text-[8px] font-black transition-all cursor-pointer ${
                        moneda === "C$" 
                          ? "bg-blue-900 text-white font-bold shadow-xs" 
                          : "text-gray-600"
                      }`}
                    >
                      C$
                    </button>
                    <button
                      id="curr-toggle-usd"
                      onClick={() => setMoneda("USD")}
                      className={`px-1.5 py-0.5 rounded text-[8px] font-black transition-all cursor-pointer ${
                        moneda === "USD" 
                          ? "bg-blue-900 text-white font-bold shadow-xs" 
                          : "text-gray-600"
                      }`}
                    >
                      USD
                    </button>
                  </div>
                </div>

                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono font-bold text-gray-400 text-sm">{moneda}</span>
                  <input
                    id="monto-input"
                    type="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    min="1"
                    value={montoPago}
                    onFocus={() => setActiveField('monto')}
                    onChange={(e) => setMontoPago(e.target.value)}
                    placeholder="0"
                    className={`w-full h-12 pl-10 pr-4 rounded-xl font-mono text-lg font-black shadow-inner focus:outline-none border-2 transition-colors ${
                      isLimitBlocked 
                        ? 'border-[#EF4444] text-[#EF4444] bg-red-50 focus:border-red-600' 
                        : activeField === 'monto'
                        ? 'border-blue-500 text-blue-900 bg-blue-50 shadow-md focus:border-blue-600'
                        : 'border-gray-300 text-gray-900 bg-white focus:border-blue-500'
                    }`}
                  />
                </div>
              </div>
            </div>

            {/* Nombre del Cliente — standalone row */}
            <div>
              <label className="block text-[10px] font-display font-black text-gray-700 uppercase tracking-wider mb-1">Nombre del Cliente</label>
              <input
                type="text"
                value={nombreCliente}
                onChange={(e) => setNombreCliente(e.target.value)}
                placeholder="Genérico"
                className="w-full p-2.5 rounded-xl border-2 border-gray-300 text-sm font-semibold focus:outline-none focus:border-blue-900 bg-white text-gray-900 shadow-inner"
              />
            </div>

            {/* Posible Premio Indicator — shows current input + accumulated cart */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex justify-between items-center">
              <span className="text-xs font-display font-black text-blue-900 uppercase tracking-wider">Premio Posible:</span>
              <span className="font-mono text-lg font-black text-emerald-600">
                C$ {(() => {
                  const currentPremio = (() => {
                    const amt = Number(montoPago) || 0;
                    const amtCs = moneda === "USD" ? amt * (config.tasa_cambio || 36.50) : amt;
                    return amtCs * calculatePrizeMultiplier(selectedJuego, selectedSorteo);
                  })();
                  const total = totalTicketPremio + currentPremio;
                  return total.toFixed(2);
                })()}
              </span>
            </div>

            {/* Dynamic Alarm for Granular Risk Control */}
            {isLimitBlocked && limitCheckResult && (
              <div id="monto-max-alerta" className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-2 text-xs text-red-950 font-sans font-bold shadow-xs animate-pulse">
                <AlertCircle className="w-4.5 h-4.5 text-[#EF4444] shrink-0 mt-0.5" />
                <span>
                  NÚMERO BLOQUEADO: Límite de C$ {limitCheckResult.limitMontoCs.toLocaleString("es-ES")} alcanzado para este vendedor en este sorteo. Vendido hoy: C$ {limitCheckResult.totalPrevSalesCs.toLocaleString("es-ES")}.
                </span>
              </div>
            )}

            {/* Quick Presets / Monedas */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[9px] font-display font-black text-gray-500 uppercase tracking-wider">Montos Rápidos ({moneda})</span>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {(moneda === "C$" ? presetAmountsCs : presetAmountsUsd).map((amount) => (
                  <button
                    key={amount}
                    id={`preset-${amount}`}
                    onClick={() => handlePresetAmount(amount)}
                    className="py-1.5 rounded-lg bg-gray-200 border border-gray-300 hover:bg-gray-300 font-mono font-black text-xs text-gray-800 transition-all cursor-pointer shadow-xs"
                  >
                    {amount}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons — Stitch 3-Button Control Bar */}
            <div className="flex flex-row gap-3 w-full mt-4">
              {/* BORRAR — Stitch Red */}
              <button
                type="button"
                onClick={clearForm}
                disabled={loading}
                className="h-14 px-4 rounded-xl bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-display font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-all duration-200 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4 stroke-[2.5]" />
                <span>Borrar</span>
              </button>

              {/* AÑADIR JUGADA — Stitch Blue */}
              <button
                type="button"
                onClick={addJugadaAlCarrito}
                disabled={loading}
                className={`flex-1 h-14 rounded-xl flex items-center justify-center font-bold text-white shadow-sm transition-all duration-200 active:scale-95 cursor-pointer ${
                  loading
                    ? "bg-blue-300 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 active:bg-blue-700"
                }`}
              >
                <Plus className="w-6 h-6 stroke-[2.5]" />
              </button>

              {/* GENERAR TICKET — Stitch Green */}
              <button
                type="button"
                id="vender-submit-btn"
                onClick={handleGenerarTicket}
                disabled={isSubmittingTicket}
                className={`flex-1 h-14 rounded-xl flex items-center justify-center font-bold text-white shadow-sm transition-all duration-200 active:scale-95 cursor-pointer ${
                  isSubmittingTicket
                    ? "bg-emerald-300 cursor-not-allowed"
                    : "bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700"
                }`}
              >
                {isSubmittingTicket ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Printer className="w-6 h-6 stroke-[2.5]" />
                )}
              </button>
            </div>

            {/* Cart de Jugadas Acumuladas — DRAFT STATE, scrollable */}
            {jugadas.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
                <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex justify-between items-center shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-display font-black text-gray-600 uppercase tracking-wider">
                      Carrito ({jugadas.length} jugada{jugadas.length > 1 ? "s" : ""})
                    </span>
                    <span className="text-[9px] font-mono font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full uppercase">
                      Preparación
                    </span>
                  </div>
                  <span className="text-[10px] font-mono font-black text-blue-900">
                    Total: {moneda} {totalTicketMonto.toFixed(2)}
                  </span>
                </div>
                <div className="max-h-[300px] overflow-y-auto divide-y divide-gray-100">
                  {jugadas.map((j, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-1.5 text-[11px]">
                      <span className="font-mono font-black text-blue-900 w-12">{j.numero}</span>
                      <span className="font-mono text-gray-700 flex-1 text-right">
                        {moneda} {j.monto.toFixed(2)}
                      </span>
                      <span className="font-mono text-emerald-600 w-24 text-right text-[10px]">
                        C$ {j.premio_posible.toFixed(0)}
                      </span>
                      <button
                        onClick={() => removeJugada(i)}
                        className="ml-2 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: REPORTES */}
        {activeTab === "reportes" && (() => {
          // Filter tickets by fecha_venta string (YYYY-MM-DD) — String vs String
          const rangeTickets = reportTickets.filter(t => {
            const ticketDateStr = getTicketDate(t);
            return ticketDateStr >= reportFilterFechaInicio && ticketDateStr <= reportFilterFechaFin;
          });

          // Calculate totals (normalize field names: total_apostado or monto_pago)
          const facturado = rangeTickets.filter(t => t.estado !== "anulado").reduce((sum, t) => sum + getTicketAmount(t), 0);
          const sellerIngresos = ((config as any).ingresos || []).filter((i: any) => {
            const isSeller = i.id_vendedor === user.id;
            const inRange = i.fecha >= reportFilterFechaInicio && i.fecha <= reportFilterFechaFin;
            return isSeller && inRange;
          });
          const ingresos = sellerIngresos.reduce((sum: number, i: any) => sum + i.monto_cs + (i.monto_usd * config.tasa_cambio), 0);
          
          // Calculate theoretical prizes (A Pagar) — prefer persisted monto_premio from escrutinio
          let aPagar = 0;
          rangeTickets.forEach(t => {
            aPagar += (typeof t.monto_premio === "number" && t.es_premiado) ? t.monto_premio : getTicketTheoreticalPrize(t, config);
          });

          // Calculate actually paid/cobrado prizes (Pagado)
          const pagado = rangeTickets
            .filter(t => t.estado === "cobrado")
            .reduce((sum, t) => sum + ((typeof t.monto_premio === "number" && t.es_premiado) ? t.monto_premio : getTicketTheoreticalPrize(t, config)), 0);

          // Calculate withdrawals made by supervisor (Cobro)
          const sellerCobros = (config.cobros || []).filter(c => {
            const isSeller = c.id_vendedor === user.id;
            const inRange = c.fecha >= reportFilterFechaInicio && c.fecha <= reportFilterFechaFin;
            return isSeller && inRange;
          });
          const cobro = sellerCobros.reduce((sum, c) => sum + c.monto_cs + (c.monto_usd * config.tasa_cambio), 0);

          const total = (facturado - pagado) + ingresos - cobro;
          const ganancia = (facturado - aPagar) + ingresos;

          const formatCurrency = (val: number) => {
            return `C$ ${val.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          };

          return (
            <div className="space-y-4 animate-fade-in text-left">
              {/* Header and Refresh */}
              <div className="flex justify-between items-center border-b border-gray-200 pb-2">
                <div>
                  <h3 className="font-display font-black text-sm text-gray-800 uppercase tracking-wider">Reporte de Caja</h3>
                  <p className="text-[10px] text-gray-400 font-sans mt-0.5">Consulta tu arqueo de caja y boletos emitidos.</p>
                </div>
                <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="text-[9px] font-black text-emerald-700 uppercase tracking-wider">EN VIVO</span>
                </div>
              </div>

              {/* Rango de Fechas */}
              <div className="grid grid-cols-2 gap-3 bg-white p-3 rounded-2xl border border-gray-200 shadow-xs">
                <div>
                  <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">Fecha Inicio</label>
                  <input
                    type="date"
                    value={reportFilterFechaInicio}
                    onChange={(e) => setReportFilterFechaInicio(e.target.value)}
                    className="w-full p-2 text-xs font-mono font-bold bg-slate-50 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-900"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">Fecha Fin</label>
                  <input
                    type="date"
                    value={reportFilterFechaFin}
                    onChange={(e) => setReportFilterFechaFin(e.target.value)}
                    className="w-full p-2 text-xs font-mono font-bold bg-slate-50 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-900"
                  />
                </div>
              </div>

              <ResumenFacturacionCard
                facturado={facturado}
                ingresos={ingresos}
                aPagar={aPagar}
                cobro={cobro}
                pagado={pagado}
                total={total}
              />


              {/* Lista de Boletos (UI Stitch) */}
              <div className="space-y-3">
                <span className="block text-[10px] font-display font-black text-gray-500 uppercase tracking-wider">
                  Boletos Emitidos ({rangeTickets.length})
                </span>
                
                {reportLoading ? (
                  <div className="text-center py-10">
                    <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-800 rounded-full animate-spin mx-auto mb-2"></div>
                    <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">Cargando de Firestore...</span>
                  </div>
                ) : rangeTickets.length === 0 ? (
                  <div className="text-center py-10 bg-white border border-gray-200 rounded-2xl text-gray-400 text-xs">
                    No se encontraron boletos en el rango seleccionado.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                    {rangeTickets.map((t) => {
                      // Parse game and draw
                      let game = "";
                      let draw = "";
                      const js = t.juego_sorteo || "";
                      if (js.startsWith("La Diaria")) {
                        game = "La Diaria";
                        draw = js.substring("La Diaria".length).trim();
                      } else if (js.startsWith("Premia2")) {
                        game = "Premia2";
                        draw = js.substring("Premia2".length).trim();
                      } else if (js.startsWith("Pega 3")) {
                        game = "Pega 3";
                        draw = js.substring("Pega 3".length).trim();
                      } else if (js.startsWith("Jugá 3")) {
                        game = "Jugá 3";
                        draw = js.substring("Jugá 3".length).trim();
                      } else if (js.startsWith("Diaria")) {
                        game = "Diaria";
                        draw = js.substring("Diaria".length).trim();
                      } else if (js.startsWith("Fechas")) {
                        game = "Fechas";
                        draw = js.substring("Fechas".length).trim();
                      } else if (js.startsWith("Terminación 2")) {
                        game = "Terminación 2";
                        draw = js.substring("Terminación 2".length).trim();
                      } else if (js.startsWith("Súper Premio")) {
                        game = "Súper Premio";
                        draw = js.substring("Súper Premio".length).trim();
                      } else if (js.startsWith("3 Monazos")) {
                        game = "3 Monazos";
                        draw = js.substring("3 Monazos".length).trim();
                      } else {
                        const parts = js.split(" ");
                        game = parts[0] || "";
                        draw = parts.slice(1).join(" ");
                      }

                      const ticketPrize = (typeof t.monto_premio === "number" && t.es_premiado) ? t.monto_premio : getTicketTheoreticalPrize(t, config);
                      const isWinner = t.es_premiado === true || ticketPrize > 0;

                      return (
                        <div key={t.id} className={`bg-white rounded-xl p-4 shadow-sm border flex flex-col justify-between relative overflow-hidden ${isWinner && t.estado !== "anulado" ? "border-amber-400 bg-gradient-to-br from-amber-50/40 to-yellow-50/30 shadow-md shadow-amber-200/50" : "border-gray-200"} ${t.estado === "anulado" ? "opacity-60 bg-gray-50" : ""}`}>
                          {/* Winner Watermark Stamp */}
                          {isWinner && t.estado !== "anulado" && (
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 -rotate-12 opacity-10 border-4 border-amber-500 text-amber-600 rounded-2xl px-4 py-1.5 font-display font-black text-4xl tracking-widest uppercase pointer-events-none select-none">
                              PREMIADO
                            </div>
                          )}

                          <div className="flex justify-between items-start mb-2 relative z-10">
                            <div>
                              <span className="font-bold text-gray-800 uppercase block">{user.nombre}</span>
                              <span className="text-[10px] text-blue-600 font-mono font-black mt-0.5 block">
                                #{t.numero_ticket || t.id_ticket || 'N/A'}
                              </span>
                              <span className="text-[9px] text-gray-400 font-mono mt-0.5 block">
                                {t.fecha_emision_date.toLocaleDateString("es-ES")} {formatTo12HourTime(t.fecha_emision_date)}
                              </span>
                            </div>
                            <div className="flex items-center space-x-2">
                              {isWinner && t.estado !== "anulado" && (
                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-lg bg-amber-500 text-white animate-pulse shadow-xs">
                                  PREMIADO
                                </span>
                              )}
                              <span className={`text-[9px] font-black uppercase px-2.5 py-0.5 rounded ${
                                t.estado === "cobrado" ? "bg-emerald-100 text-emerald-800" :
                                t.estado === "anulado" ? "bg-red-100 text-red-800" :
                                "bg-amber-100 text-amber-800"
                              }`}>
                                {t.estado}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 mb-3">
                            <span className="bg-blue-50 text-blue-700 rounded-md px-2.5 py-0.5 text-xs font-bold font-sans">
                              {game}
                            </span>
                            <span className="bg-slate-100 text-slate-700 rounded-md px-2.5 py-0.5 text-xs font-bold font-sans">
                              {draw}
                            </span>
                          </div>

                          <div className="border-t border-gray-100 pt-2.5 flex justify-between items-center text-xs">
                            <span className="text-gray-500 font-medium">Total Apostado:</span>
                            <span className="font-mono font-black text-gray-900 text-sm">
                              C$ {getTicketAmount(t).toFixed(2)}
                            </span>
                          </div>

                          {isWinner && t.estado !== "anulado" && ticketPrize > 0 && (
                            <div className="flex justify-between items-center text-xs mt-1.5 bg-amber-50 -mx-4 px-4 py-1.5 border-t border-amber-100">
                              <span className="text-amber-700 font-bold uppercase">A Pagar:</span>
                              <span className="font-mono font-black text-amber-600 text-sm">
                                C$ {ticketPrize.toFixed(2)}
                              </span>
                            </div>
                          )}

                          {/* Action Options Group */}
                          <div className="border-t border-gray-100 pt-3 mt-3 grid grid-cols-4 gap-1">
                            <button
                              onClick={() => {
                                if (isSorteoPasado(t)) {
                                  toast.error("No se puede visualizar el ticket porque el sorteo ya se realizó.", { position: 'top-center' });
                                } else {
                                  const tempVenta: Venta = {
                                    id: t.id,
                                    numero_ticket: t.numero_ticket || t.id_ticket || t.id.substring(0, 7).toUpperCase(),
                                    timestamp_servidor: t.fecha_emision_date ? t.fecha_emision_date.toISOString() : new Date().toISOString(),
                                    juego: game,
                                    sorteo: draw,
                                    numero_jugado: t.jugadas && t.jugadas[0] ? t.jugadas[0].numero : (t.numero_jugado || "?"),
                                    monto_pago: getTicketAmount(t),
                                    moneda: t.moneda || "C$",
                                    id_vendedor: t.id_vendedor,
                                    nombre_vendedor: user.nombre,
                                    nombre_cliente: t.nombre_cliente || "Genérico",
                                    premio_posible_cs: t.total_premio || t.premio_posible_cs || 0,
                                    firma_digital: t.firma_digital || t.id.substring(0, 7).toUpperCase(),
                                    anulado: t.estado === "anulado",
                                    estado: t.estado,
                                    jugadas: t.jugadas || []
                                  };
                                  setActiveTicket(tempVenta);
                                }
                              }}
                              className={`py-1.5 px-0.5 rounded-lg text-[9px] font-black uppercase transition-all border text-center flex items-center justify-center cursor-pointer ${
                                isSorteoPasado(t)
                                  ? "bg-gray-100 text-gray-400 border-gray-200"
                                  : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                              }`}
                            >
                              Visualizar
                            </button>

                            <button
                              onClick={() => {
                                if (t.estado === "anulado") {
                                  toast.error("No se puede reimprimir un ticket anulado.", { position: 'top-center' });
                                  return;
                                }
                                if (printerStatus !== "connected" || !printerRef.current) {
                                  toast.error("La impresora Bluetooth no está conectada.", { position: 'top-center' });
                                  return;
                                }
                                const tempVenta: Venta = {
                                  id: t.id,
                                  numero_ticket: t.numero_ticket || t.id_ticket || t.id.substring(0, 7).toUpperCase(),
                                  timestamp_servidor: t.fecha_emision_date ? t.fecha_emision_date.toISOString() : new Date().toISOString(),
                                  juego: game,
                                  sorteo: draw,
                                  numero_jugado: t.jugadas && t.jugadas[0] ? t.jugadas[0].numero : (t.numero_jugado || "?"),
                                  monto_pago: getTicketAmount(t),
                                  moneda: t.moneda || "C$",
                                  id_vendedor: t.id_vendedor,
                                  nombre_vendedor: user.nombre,
                                  nombre_cliente: t.nombre_cliente || "Genérico",
                                  premio_posible_cs: t.total_premio || 0,
                                  firma_digital: t.firma_digital || t.id.substring(0, 7).toUpperCase(),
                                  anulado: t.estado === "anulado",
                                  estado: t.estado,
                                  jugadas: t.jugadas || []
                                };
                                const printData = ticketDataFromVenta(tempVenta, config);
                                printData.logo_bytes = logoBytesRef.current;
                                const buffer = buildTicketBuffer(printData);
                                printerRef.current.print(buffer).then((ok) => {
                                  if (ok) {
                                    toast.success("Ticket reimpreso", { position: 'top-center' });
                                  } else {
                                    toast.error("Error al reimprimir", { position: 'top-center' });
                                  }
                                }).catch((err) => {
                                  console.error("Print error:", err);
                                  toast.error("Error inesperado al imprimir", { position: 'top-center' });
                                });
                              }}
                              className={`py-1.5 px-0.5 rounded-lg text-[9px] font-black uppercase transition-all border text-center flex items-center justify-center cursor-pointer ${
                                t.estado === "anulado"
                                  ? "bg-gray-100 text-gray-400 border-gray-200"
                                  : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                              }`}
                            >
                              Imprimir
                            </button>

                            <button
                              onClick={() => {
                                if (t.estado === "anulado") {
                                  toast.error("El ticket ya está anulado.", { position: 'top-center' });
                                  return;
                                }
                                // Client side validation: 5-minute void time limit
                                const createdTime = t.fecha_emision_date ? t.fecha_emision_date.getTime() : new Date().toISOString();
                                const elapsedMin = (Date.now() - new Date(createdTime).getTime()) / (60 * 1000);
                                if (elapsedMin > 5) {
                                  toast.error("Solo se pueden anular boletos dentro de los primeros 5 minutos de su emisión.", { position: 'top-center', duration: 4000 });
                                  return;
                                }
                                handleAnularTicket(t.id);
                              }}
                              className={`py-1.5 px-0.5 rounded-lg text-[9px] font-black uppercase transition-all border text-center flex items-center justify-center cursor-pointer ${
                                t.estado === "anulado"
                                  ? "bg-gray-100 text-gray-400 border-gray-200"
                                  : "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                              }`}
                            >
                              Anular
                            </button>

                            <button
                              onClick={() => {
                                // Repeat logic
                                setSelectedJuego(game);
                                setSelectedSorteo(draw);
                                setMoneda(t.moneda || "C$");
                                if (t.jugadas && t.jugadas.length > 0) {
                                  setJugadas(t.jugadas.map((j: any) => ({
                                    numero: j.numero,
                                    monto: j.monto,
                                    premio_posible: j.premio_posible || (j.monto * calculatePrizeMultiplier(game, draw))
                                  })));
                                } else if (t.numero_jugado) {
                                  const mult = calculatePrizeMultiplier(game, draw);
                                  const amtInCs = t.moneda === "USD" ? t.monto_pago * (config.tasa_cambio || 36.50) : t.monto_pago;
                                  setJugadas([{
                                    numero: t.numero_jugado,
                                    monto: t.monto_pago,
                                    premio_posible: amtInCs * mult
                                  }]);
                                }
                                setActiveTab("venta");
                                toast.success("Jugada repetida cargada en el formulario", { position: 'top-center' });
                              }}
                              className="py-1.5 px-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-[9px] font-black uppercase transition-all text-center flex items-center justify-center cursor-pointer"
                            >
                              Repetir
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
        {/* TAB 3: PAGOS (QR SCANNERS) */}
        {activeTab === "pagos" && (
          <div className="space-y-4 animate-fade-in">
            <div className="border-b border-gray-200 pb-2">
              <h3 className="font-display font-black text-sm text-gray-800 uppercase tracking-wider">Validar y Pagar Premios</h3>
              <p className="text-[10px] text-gray-400 font-sans mt-0.5">Escanea el código QR del ticket o ingresa el ID manualmente.</p>
            </div>


            {/* QR Scanner Activation */}
            <button
              onClick={() => setIsQrScannerOpen(true)}
              className="w-full py-4 bg-blue-900 hover:bg-blue-800 text-white rounded-2xl flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-md"
            >
              <QrCode className="w-5 h-5" />
              <span className="text-xs font-black uppercase tracking-wider">Abrir Escáner de Cámara</span>
            </button>

            {/* Manual ID Input Section */}
            <div className="bg-white rounded-2xl p-4 border border-gray-300 shadow-sm">
              <div className="w-full">
                <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">Ingresar ID del Ticket</label>
                <form onSubmit={(e) => { e.preventDefault(); processPayment(qrSearchInput); }} className="flex space-x-2">
                  <input
                    type="text"
                    value={qrSearchInput}
                    onChange={(e) => setQrSearchInput(e.target.value)}
                    placeholder="ID del ticket (ej: ZNH9H02)..."
                    className="flex-1 p-2 text-xs font-mono font-bold bg-slate-50 border border-gray-200 rounded-xl focus:outline-none focus:border-blue-900"
                  />
                  <button
                    type="submit"
                    disabled={loading || !qrSearchInput}
                    className="px-4 bg-[#1E3A8A] hover:bg-blue-800 text-white rounded-lg font-bold flex items-center justify-center cursor-pointer disabled:opacity-50"
                  >
                    Validar
                  </button>
                </form>
              </div>
            </div>
            
            {/* Payment Animation Modals */}
            <AnimatePresence>
              {paymentResult && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
                  {/* Confetti particles for winners */}
                  {paymentResult.ganador && paymentResult.estado === "pendiente" && (
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                      {Array.from({ length: 35 }).map((_, i) => {
                        const randomLeft = Math.random() * 100;
                        const randomDelay = Math.random() * 2.5;
                        const randomDuration = 2.5 + Math.random() * 2.5;
                        const randomSize = 6 + Math.random() * 8;
                        return (
                          <motion.div
                            key={i}
                            initial={{ y: -50, x: `${randomLeft}vw`, rotate: 0 }}
                            animate={{ y: "100vh", rotate: 720 }}
                            transition={{
                              duration: randomDuration,
                              repeat: Infinity,
                              delay: randomDelay,
                              ease: "linear"
                            }}
                            className="absolute rounded-xs pointer-events-none"
                            style={{
                              width: randomSize,
                              height: randomSize * 1.5,
                              backgroundColor: ["#10B981", "#F59E0B", "#3B82F6", "#EF4444", "#EC4899", "#8B5CF6"][i % 6]
                            }}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* 1. YA COBRADO (RED ALERT LOCK SCREEN) */}
                  {paymentResult.estado === "cobrado" && (
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="bg-red-600 rounded-3xl p-6 text-white text-center shadow-2xl max-w-sm w-full border border-red-700 relative"
                    >
                      <AlertCircle className="w-16 h-16 mx-auto mb-3 text-red-100 animate-bounce" />
                      <h2 className="text-2xl font-black uppercase tracking-wider mb-2">¡Bloqueado!</h2>
                      <p className="text-red-100 text-sm font-semibold mb-6">
                        Ticket ya pagado anteriormente. No se permite realizar otro desembolso para este documento.
                      </p>
                      <button
                        onClick={() => setPaymentResult(null)}
                        className="w-full py-3 bg-white hover:bg-red-50 text-red-700 rounded-xl font-bold uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Aceptar y Cerrar
                      </button>
                    </motion.div>
                  )}

                  {/* 2. ANULADO */}
                  {paymentResult.estado === "anulado" && (
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="bg-slate-700 rounded-3xl p-6 text-white text-center shadow-2xl max-w-sm w-full border border-slate-800"
                    >
                      <AlertTriangle className="w-16 h-16 mx-auto mb-3 text-slate-200" />
                      <h2 className="text-xl font-black uppercase tracking-wider mb-2">Ticket Anulado</h2>
                      <p className="text-slate-200 text-xs mb-6">
                        {paymentResult.message}
                      </p>
                      <button
                        onClick={() => setPaymentResult(null)}
                        className="w-full py-3 bg-white hover:bg-slate-100 text-slate-700 rounded-xl font-bold uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Cerrar
                      </button>
                    </motion.div>
                  )}

                  {/* 3. PENDIENTE DE SORTEO (SIN RESULTADOS OFICIALES AUN) */}
                  {paymentResult.estado === "pendiente_sorteo" && (
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="bg-amber-500 rounded-3xl p-6 text-white text-center shadow-2xl max-w-sm w-full border border-amber-600"
                    >
                      <AlertTriangle className="w-16 h-16 mx-auto mb-3 text-amber-100" />
                      <h2 className="text-xl font-black uppercase tracking-wider mb-2">Sorteo Abierto</h2>
                      <p className="text-amber-100 text-xs mb-6">
                        {paymentResult.message}
                      </p>
                      <button
                        onClick={() => setPaymentResult(null)}
                        className="w-full py-3 bg-white hover:bg-amber-50 text-amber-600 rounded-xl font-bold uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Cerrar
                      </button>
                    </motion.div>
                  )}

                  {/* 4. ERROR */}
                  {paymentResult.estado === "error" && (
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="bg-red-500 rounded-3xl p-6 text-white text-center shadow-2xl max-w-sm w-full border border-red-600"
                    >
                      <AlertCircle className="w-16 h-16 mx-auto mb-3 text-red-100" />
                      <h2 className="text-xl font-black uppercase tracking-wider mb-2">Error de Verificación</h2>
                      <p className="text-red-100 text-xs mb-6">
                        {paymentResult.message}
                      </p>
                      <button
                        onClick={() => setPaymentResult(null)}
                        className="w-full py-3 bg-white hover:bg-red-50 text-red-600 rounded-xl font-bold uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Cerrar
                      </button>
                    </motion.div>
                  )}

                  {/* 5. GANADOR (PENDIENTE DE PAGO) */}
                  {paymentResult.ganador && paymentResult.estado === "pendiente" && (
                    <motion.div
                      initial={{ scale: 0.9, y: 50, opacity: 0 }}
                      animate={{ scale: 1, y: 0, opacity: 1 }}
                      exit={{ scale: 0.9, y: 50, opacity: 0 }}
                      className="bg-emerald-600 rounded-3xl p-6 text-white text-center shadow-2xl max-w-sm w-full relative overflow-hidden border border-emerald-700"
                    >
                      <CheckCircle className="w-16 h-16 mx-auto mb-2 text-emerald-100 animate-pulse" />
                      <h2 className="text-2xl font-black uppercase tracking-wider mb-1">¡Premio Detectado!</h2>
                      <p className="text-emerald-100 text-xs mb-4">
                        El número ganador del sorteo {paymentResult.juegoSorteo} fue: <strong className="bg-white/20 px-2 py-0.5 rounded text-sm font-mono">{paymentResult.numGanador}</strong>
                      </p>

                      <div className="bg-white/10 rounded-2xl p-4 backdrop-blur-xs border border-white/20 mb-6">
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-100 mb-1">Total a Entregar</span>
                        <span className="text-4xl font-mono font-black tracking-tight">
                          C$ {paymentResult.monto.toLocaleString("es-ES", { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      <div className="space-y-2">
                        <button
                          onClick={() => handleEfectuarPago(paymentResult.ticketId)}
                          disabled={loading}
                          className="w-full py-3 bg-white hover:bg-emerald-50 text-emerald-700 rounded-xl font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-2"
                        >
                          {loading ? (
                            <div className="w-5 h-5 border-2 border-emerald-700 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <span>Efectuar Pago de Premio</span>
                          )}
                        </button>
                        <button
                          onClick={() => setPaymentResult(null)}
                          className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-800 text-emerald-100 rounded-xl font-bold uppercase tracking-wider text-xs transition-colors cursor-pointer"
                        >
                          Cerrar sin pagar
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* 6. NO GANADOR */}
                  {!paymentResult.ganador && paymentResult.estado === "pendiente" && (
                    <motion.div
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      className="bg-gray-700 rounded-3xl p-6 text-white text-center shadow-2xl max-w-sm w-full border border-gray-800"
                    >
                      <X className="w-16 h-16 mx-auto mb-3 text-gray-400" />
                      <h2 className="text-xl font-black uppercase tracking-wider mb-2">Boleto sin Premio</h2>
                      <p className="text-gray-200 text-xs mb-6">
                        {paymentResult.message}
                      </p>
                      <button
                        onClick={() => setPaymentResult(null)}
                        className="w-full py-3 bg-white hover:bg-gray-100 text-gray-700 rounded-xl font-bold uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        Cerrar
                      </button>
                    </motion.div>
                  )}
                </div>
              )}
            </AnimatePresence>
          </div>
        )}

      </div>

      
      {/* Bottom Navigation Bar — fixed, never shrinks */}
      <div className="bg-white border-t border-gray-300 py-1 px-2 flex justify-between items-center z-10 shrink-0">
        <button id="nav-venta" onClick={() => { setActiveTab("venta"); setErrorMessage(null); setSuccessMessage(null); }} className={`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer ${activeTab === "venta" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}`}>
          <Gamepad2 className={`w-5 h-5 stroke-[2.5] ${activeTab === "venta" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Venta</span>
        </button>
        <button id="nav-reportes" onClick={() => { setActiveTab("reportes"); setErrorMessage(null); setSuccessMessage(null); }} className={`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer ${activeTab === "reportes" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}`}>
          <History className={`w-5 h-5 stroke-[2.5] ${activeTab === "reportes" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Reportes</span>
        </button>
        <button id="nav-pagos" onClick={() => { setActiveTab("pagos"); setErrorMessage(null); setSuccessMessage(null); }} className={`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer ${activeTab === "pagos" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}`}>
          <CheckCircle className={`w-5 h-5 stroke-[2.5] ${activeTab === "pagos" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Pagos</span>
        </button>
      </div>

      {/* Ticket Viewer Modal */}
      {activeTicket && (
        <TicketPreviewModal 
          ticket={activeTicket} 
          config={config} 
          onClose={() => setActiveTicket(null)} 
          userRole={user.rol}
          serverTime={serverTime}
          onPrint={printerRef.current && printerStatus === "connected" ? () => {
            const printData = ticketDataFromVenta(activeTicket, config);
            printData.logo_bytes = logoBytesRef.current;
            const buffer = buildTicketBuffer(printData);
            printerRef.current.print(buffer).then((ok) => {
              if (ok) {
                toast.success("Ticket impreso en Bluetooth", { position: 'top-center', duration: 2000 });
              } else {
                toast.error("No se pudo imprimir el ticket. Verifique la impresora.", {
                  position: 'top-center',
                  duration: 4000
                });
              }
            }).catch((err) => {
              console.error("Bluetooth print error:", err);
              toast.error("Error inesperado al imprimir", { position: 'top-center', duration: 4000 });
            });
          } : undefined}
        />
      )}

      {/* QR Scanner Modal */}
      {isQrScannerOpen && (
        <QrScannerModal
          onScan={(data) => {
            setIsQrScannerOpen(false);
            if (activeTab === "pagos") {
              processPayment(data);
            } else {
              executeTicketSearch(data);
            }
          }}
          onClose={() => setIsQrScannerOpen(false)}
        />
      )}

      {/* Prize Verification Result Modal */}
      <AnimatePresence>
        {prizeResult.show && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4"
            onClick={() => setPrizeResult(p => ({ ...p, show: false }))}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={`w-full max-w-sm rounded-3xl p-6 shadow-2xl border text-center ${
                prizeResult.type === 'winner' ? 'bg-emerald-50 border-emerald-300' :
                prizeResult.type === 'already_paid' ? 'bg-red-50 border-red-300' :
                prizeResult.type === 'loser' ? 'bg-gray-50 border-gray-300' :
                'bg-amber-50 border-amber-300'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {prizeResult.type === 'winner' && (
                <div className="text-emerald-600 mb-2">
                  <CheckCircle className="w-16 h-16 mx-auto stroke-[1.5]" />
                </div>
              )}
              {prizeResult.type === 'already_paid' && (
                <div className="text-red-600 mb-2">
                  <AlertCircle className="w-16 h-16 mx-auto stroke-[1.5]" />
                </div>
              )}

              <h2 className={`text-lg font-display font-black uppercase tracking-wider mb-2 ${
                prizeResult.type === 'winner' ? 'text-emerald-800' :
                prizeResult.type === 'already_paid' ? 'text-red-800' :
                prizeResult.type === 'loser' ? 'text-gray-700' :
                'text-amber-800'
              }`}>
                {prizeResult.type === 'winner' && '¡Ticket Premiado!'}
                {prizeResult.type === 'loser' && 'Ticket No Premiado'}
                {prizeResult.type === 'already_paid' && 'Ya Pagado'}
                {prizeResult.type === 'sorteo_abierto' && 'Sorteo Pendiente'}
                {prizeResult.type === 'not_found' && 'No Encontrado'}
                {prizeResult.type === 'error' && 'Error'}
              </h2>

              <p className="text-sm font-sans text-gray-600 mb-3">{prizeResult.message}</p>

              {prizeResult.ticket && (
                <div className="text-xs font-mono text-gray-500 mb-4 space-y-1">
                  <p>Ticket: #{prizeResult.ticket.numero_ticket}</p>
                  <p>Cliente: {prizeResult.ticket.nombre_cliente || 'Genérico'}</p>
                  <p>Sorteo: {prizeResult.ticket.sorteo}</p>
                </div>
              )}

              {prizeResult.type === 'winner' && prizeResult.monto_premio && (
                <div className="bg-emerald-100 rounded-2xl p-4 mb-4">
                  <p className="text-[10px] uppercase font-display font-black text-emerald-700 tracking-wider">Monto a Pagar</p>
                  <p className="text-2xl font-display font-black text-emerald-900">C$ {prizeResult.monto_premio.toFixed(2)}</p>
                </div>
              )}

              <button
                onClick={async () => {
                  if (prizeResult.type === 'winner' && prizeResult.ticket?.id) {
                    await handleEfectuarPago(prizeResult.ticket.id);
                  }
                  setPrizeResult(p => ({ ...p, show: false }));
                }}
                className={`w-full py-3 rounded-xl font-display font-black text-sm uppercase tracking-wider cursor-pointer transition-all ${
                  prizeResult.type === 'winner'
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    : prizeResult.type === 'already_paid'
                      ? 'bg-red-600 hover:bg-red-500 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-white'
                }`}
              >
                {prizeResult.type === 'winner' ? 'Cobrar Premio' : 'Cerrar'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
