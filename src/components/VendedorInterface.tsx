import { useState, useEffect, FormEvent, useRef } from "react";
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
  TrendingDown,
  TrendingUp,
  AlertCircle,
  Search,
  QrCode,
  CheckCircle,
  AlertTriangle,
  Ticket
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Html5QrcodeScanner } from "html5-qrcode";
import { Usuario, Configuracion, Venta, Sorteo, Jugada } from "../types";
import TicketPreviewModal from "./TicketPreviewModal";

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

function calculatePrizeMultiplier(juego: string, sorteo: string): number {
  const cleanJuego = juego.trim();
  if (cleanJuego === "Premia2" && sorteo.includes("(NI)")) return 4000;
  if (cleanJuego === "Jugá 3") return 600;
  if (cleanJuego === "Fechas") return 210;
  if (cleanJuego === "3 Monazos") return 650;
  return 80;
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
  const [activeTab, setActiveTab] = useState<"venta" | "historial" | "pagos">("venta");
  
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
  const [activeTicket, setActiveTicket] = useState<Venta | null>(null);

  // Ticket QR/ID Search states
  // Hardware and Permission states
  const [cameraStatus, setCameraStatus] = useState<'idle'|'loading'|'ready'|'denied'|'error'>('idle');

  const [qrSearchInput, setQrSearchInput] = useState("");
  const [qrSearchError, setQrSearchError] = useState<string | null>(null);

  // Payment states
  const [paymentResult, setPaymentResult] = useState<{ganador: boolean, message: string, monto: number} | null>(null);

  // --- NEW MULTI-NUMBER CART STATE ---
  const [jugadas, setJugadas] = useState<Jugada[]>([]);
  const montoInputRef = useRef<HTMLInputElement>(null);
  const totalTicketMonto = jugadas.reduce((acc, j) => acc + j.monto, 0);
  const totalTicketPremio = jugadas.reduce((acc, j) => acc + j.premio_posible, 0);

  // --- NEW BOLETO SEARCH STATE ---
  const [boletoSearchInput, setBoletoSearchInput] = useState("");
  const [boletoLoading, setBoletoLoading] = useState(false);
  const [boletoError, setBoletoError] = useState<string | null>(null);
  const [boletoFound, setBoletoFound] = useState<Venta | null>(null);

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

    const multiplier = calculatePrizeMultiplier(selectedJuego, selectedSorteo);
    const montoInCs = moneda === "USD" ? numericAmount * (config.tasa_cambio || 36.50) : numericAmount;
    const premioPosibleCs = montoInCs * multiplier;

    const nuevaJugada = {
      numero: numeroJugado,
      monto: numericAmount,
      premio_posible: premioPosibleCs
    };

    setJugadas([...jugadas, nuevaJugada]);
    setNumeroJugado("");
    setMontoPago("");
    if (montoInputRef.current) montoInputRef.current.focus();
  };

  const handleBoletoSearch = async (query: string) => {
    setBoletoError(null);
    setBoletoFound(null);
    if (!query.trim()) return;

    setBoletoLoading(true);
    let targetNum = query;
    let targetFirma = "";

    if (query.includes("ticket=")) {
      try {
        const urlObj = new URL(query);
        targetNum = urlObj.searchParams.get("ticket") || targetNum;
        targetFirma = urlObj.searchParams.get("firma") || targetFirma;
      } catch (err) {
        const tMatch = query.match(/[?&]ticket=([^&]+)/);
        const fMatch = query.match(/[?&]firma=([^&]+)/);
        if (tMatch) targetNum = tMatch[1];
        if (fMatch) targetFirma = fMatch[1];
      }
    }
    const cleanNum = targetNum.replace(/^#/, "").trim();

    try {
      const foundInCache = sales.find(s => 
        s.id === cleanNum || s.numero_ticket === cleanNum || 
        (s.firma_digital && s.firma_digital.toUpperCase() === cleanNum.toUpperCase()) ||
        (targetFirma && s.firma_digital && s.firma_digital.toUpperCase() === targetFirma.toUpperCase())
      );

      if (foundInCache) {
        setBoletoFound(foundInCache);
      } else {
        const res = await fetch(`/api/ventas?ticket=${cleanNum}`);
        if (!res.ok) throw new Error("Error en red");
        const data = await res.json();
        if (data && data.length > 0) {
          setBoletoFound(data[0]);
        } else {
          setBoletoError(`No se encontró boleto con el ID/Firma: "${query}"`);
        }
      }
    } catch (err) {
      setBoletoError(`Error al buscar boleto: ${query}`);
    } finally {
      setBoletoLoading(false);
    }
  };

  const handleVolverAJugar = (boleto: Venta) => {
    // Clone logic: switch to Venta tab and clone game/sorteo/numbers
    setActiveTab("venta");
    setSelectedPais(boleto.juego === "Sabadito" ? "Nicaragua" : "Nicaragua"); // Simplified mapping for cloned
    setSelectedJuego(boleto.juego);
    setMoneda(boleto.moneda);
    setNombreCliente(boleto.nombre_cliente || "Genérico");
    
    // Attempt to set Sorteo if it's still available
    const sorteosActivos = getSorteosByGame(boleto.juego);
    const todaviaAbierto = sorteosActivos.some(s => s.nombre === boleto.sorteo && !isSorteoCerrado(s));
    if (todaviaAbierto) {
      setSelectedSorteo(boleto.sorteo);
    } else if (sorteosActivos.length > 0) {
      // Pick first open if previous is closed
      setSelectedSorteo(sorteosActivos[0].nombre);
    }

    if (boleto.jugadas && boleto.jugadas.length > 0) {
      setJugadas([...boleto.jugadas]);
    } else {
      // Legacy single number clone
      setJugadas([{
        numero: boleto.numero_jugado,
        monto: boleto.monto_pago,
        premio_posible: boleto.premio_posible_cs || 0
      }]);
    }
  };


  // QR Scanner Effect

  useEffect(() => {
    if (activeTab !== "pagos") {
      setPaymentResult(null);
      setCameraStatus('idle');
      return;
    }

    let scanner: Html5QrcodeScanner | null = null;
    let isMounted = true;
    let localStream: MediaStream | null = null;

    const initializeCamera = async () => {
      setCameraStatus('loading');
      try {
        // 1. Solicitar permisos explicitamente primero (forzando cámara trasera)
        localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        
        if (!isMounted) {
          // Si el usuario cambió de pestaña rápido, apagar la cámara de inmediato
          localStream.getTracks().forEach(track => track.stop());
          return;
        }
        
        setCameraStatus('ready');
        
        // 2. Montar el escáner si hay permisos
        scanner = new Html5QrcodeScanner(
          "reader",
          { 
            fps: 10, 
            qrbox: { width: 250, height: 250 },
            videoConstraints: { facingMode: "environment" } 
          },
          false
        );

        scanner.render(
          (decodedText) => {
            scanner?.pause(true);
            processPayment(decodedText);
          },
          (error) => {} // ignorar errores de frame vacío
        );
      } catch (err: any) {
        console.error("Camera error:", err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraStatus('denied');
        } else {
          setCameraStatus('error');
        }
      }
    };

    initializeCamera();

    // 3. Limpieza Segura (Evitar fugas de memoria y batería)
    return () => {
      isMounted = false;
      if (scanner) {
        scanner.clear().catch(e => console.error("Error clearing scanner", e));
      }
      if (localStream) {
        // Force stop all hardware tracks immediately
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [activeTab]);


  const processPayment = async (query: string) => {
    setLoading(true);
    setPaymentResult(null);
    try {
      let targetNum = query.trim();
      if (query.includes("ticket=")) {
        const tMatch = query.match(/[?&]ticket=([^&]+)/);
        if (tMatch) targetNum = tMatch[1];
      }
      
      const cleanNum = targetNum.replace(/^#/, "").trim();
      const response = await fetch(`/api/ventas/${cleanNum}/pagar`, {
        method: "POST"
      });
      const data = await response.json();
      
      if (!response.ok) {
        setPaymentResult({
          ganador: false,
          message: data.error || "Error al validar el ticket.",
          monto: 0
        });
      } else {
        setPaymentResult({
          ganador: data.ganador,
          message: data.message,
          monto: data.monto_ganado_cs || 0
        });
        if (data.ganador) {
          onRefreshSales();
        }
      }
    } catch (err) {
      setPaymentResult({
        ganador: false,
        message: "Error de conexión con el servidor.",
        monto: 0
      });
    } finally {
      setLoading(false);
      setQrSearchInput("");
      
      // Try to resume scanner if possible
      try {
        const scannerEl = document.getElementById("reader");
        if (scannerEl) {
          // If the library supports resuming, we can do it here, but usually it's better to just let the user re-open the tab.
        }
      } catch (e) {}
    }
  };

  const handleTicketQrSearch = async (e: FormEvent) => {
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
      try {
        const response = await fetch(`/api/ventas?ticket=${cleanNum}`);
        if (!response.ok) throw new Error("Error en red");
        const data = await response.json();
        if (data && data.length > 0) {
          setActiveTicket(data[0]);
          setQrSearchInput("");
        } else {
          setQrSearchError(`No se encontró ningún ticket con ID, número o firma: "${query}"`);
        }
      } catch (err) {
        setQrSearchError(`No se encontró ningún ticket con ID, número o firma: "${query}"`);
      }
    }
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
  const isSorteoCerrado = (s: Sorteo) => {
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
    return config.sorteos.filter(s => s.juego === game && s.nombre.includes(suffix));
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
    
    // Set default value for Fechas
    if (selectedJuego === "Fechas") {
      setNumeroJugado("01-Enero");
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
    const saleDateStr = s.timestamp_servidor.substring(0, 10); // YYYY-MM-DD
    const dateMatches = filterDate ? (saleDateStr === filterDate) : true;
    
    // Check search query (by Ticket # or Number played or Game)
    const query = searchQuery.trim().toLowerCase();
    const searchMatches = query
      ? (s.numero_ticket.toLowerCase().includes(query) || s.numero_jugado.includes(query) || s.juego.toLowerCase().includes(query))
      : true;
      
    return dateMatches && searchMatches;
  });

  // Calculations for current cashier (based on today's active sales)
  const myTodaySales = allMySales.filter(s => s.timestamp_servidor.substring(0, 10) === getTodayString());
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
  const getRealTimeLimitCheck = () => {
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

  const limitCheckResult = getRealTimeLimitCheck();
  const isLimitBlocked = limitCheckResult?.isExceeded || false;

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

  // Submit sale handler
  const handleGenerarTicket = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    // Validation
    if (!numeroJugado) {
      setErrorMessage("Por favor ingrese un número para jugar.");
      return;
    }

    // Format & validate based on Game
    if (selectedJuego === "Diaria" || selectedJuego === "La Diaria" || selectedJuego === "Terminación 2" || selectedJuego === "La Primera" || selectedJuego === "Tica") {
      if (!/^\d{2}$/.test(numeroJugado)) {
        setErrorMessage(`El juego ${selectedJuego} requiere exactamente un número de 2 dígitos (00-99).`);
        return;
      }
    } else if (selectedJuego === "Jugá 3" || selectedJuego === "3 Monazos") {
      if (!/^\d{3}$/.test(numeroJugado)) {
        setErrorMessage(`${selectedJuego} requiere exactamente un número de 3 dígitos (000-999).`);
        return;
      }
    } else if (selectedJuego === "Premia2") {
      if (!/^\d{4}$/.test(numeroJugado)) {
        setErrorMessage("Premia2 requiere ingresar exactamente dos números de 2 dígitos (ej: 45 y 88, en total 4 dígitos).");
        return;
      }
    } else if (selectedJuego === "Pega 3") {
      if (!/^\d{6}$/.test(numeroJugado)) {
        setErrorMessage("Pega 3 requiere ingresar exactamente tres números de 2 dígitos (en total 6 dígitos).");
        return;
      }
    } else if (selectedJuego === "Súper Premio") {
      if (!/^\d{12}$/.test(numeroJugado)) {
        setErrorMessage("Súper Premio requiere ingresar exactamente 6 números de 2 dígitos (en total 12 dígitos).");
        return;
      }
      for (let i = 0; i < 12; i += 2) {
        const val = Number(numeroJugado.substring(i, i + 2));
        if (val < 1 || val > 33) {
          setErrorMessage("Cada número del Súper Premio debe estar entre el rango 01 y 33.");
          return;
        }
      }
    } else if (selectedJuego === "Fechas") {
      const parts = numeroJugado.split("-");
      if (parts.length !== 2 || isNaN(Number(parts[0])) || Number(parts[0]) < 1 || Number(parts[0]) > 31) {
        setErrorMessage("Selección de fecha no válida. Debe contener un día (1-31) y un mes.");
        return;
      }
    }

    const numericAmount = Number(montoPago);
    if (!montoPago || isNaN(numericAmount) || numericAmount <= 0) {
      setErrorMessage("Ingrese un monto de jugada válido mayor a cero.");
      return;
    }

    if (!selectedSorteo) {
      setErrorMessage("No hay sorteos activos seleccionados.");
      return;
    }

    if (isLimitBlocked && limitCheckResult) {
      setErrorMessage(`NÚMERO BLOQUEADO: Límite de C$ ${limitCheckResult.limitMontoCs.toLocaleString("es-ES")} alcanzado para este vendedor en este sorteo. Vendido hoy: C$ ${limitCheckResult.totalPrevSalesCs.toLocaleString("es-ES")}.`);
      return;
    }

    // Verify if selected drawing is closed (anti-fraude block)
    const matchingSorteo = config.sorteos.find(s => s.nombre === selectedSorteo);
    if (matchingSorteo && isSorteoCerrado(matchingSorteo)) {
      setErrorMessage(`VENTA BLOQUEADA: El sorteo ${selectedSorteo} ya cerró (${formatTo12Hour(matchingSorteo.hora_cierre)}).`);
      return;
    }

    const multiplier = calculatePrizeMultiplier(selectedJuego, selectedSorteo);
    const montoInCs = moneda === "USD" ? numericAmount * (config.tasa_cambio || 36.50) : numericAmount;
    const premioPosibleCs = montoInCs * multiplier;

    // Offline simulation behavior
    if (!isOnline) {
      setErrorMessage("ERROR DE CONEXIÓN: No se puede conectar con el servidor. Ticket guardado en cola local offline.");
      // Simulated offline ticket
      const tempId = "off_" + Math.random().toString(36).substring(2, 9);
      const offlineTicket: Venta = {
        id: tempId,
        numero_ticket: "PENDIENTE",
        timestamp_servidor: new Date().toISOString(),
        juego: selectedJuego,
        sorteo: selectedSorteo,
        numero_jugado: numeroJugado,
        monto_pago: numericAmount,
        moneda: moneda,
        id_vendedor: user.id,
        nombre_vendedor: user.nombre,
        nombre_cliente: nombreCliente.trim() || "Genérico",
        premio_posible_cs: premioPosibleCs,
        firma_digital: "OFFLINE-QUEUED",
        anulado: false
      };
      
      // Delay response to look real
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        onNewSaleCreated(offlineTicket);
        setSuccessMessage("¡Ticket guardado fuera de línea! Se sincronizará al recuperar señal.");
        // reset forms
        setNumeroJugado("");
        setMontoPago("");
        setNombreCliente("Genérico");
      }, 800);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          juego: selectedJuego,
          sorteo: selectedSorteo,
          numero_jugado: numeroJugado,
          monto_pago: numericAmount,
          moneda: moneda,
          id_vendedor: user.id,
          nombre_cliente: nombreCliente.trim() || "Genérico",
          premio_posible_cs: premioPosibleCs
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Error al generar venta");
      }

      // Success
      onNewSaleCreated(data);
      setActiveTicket(data);
      setSuccessMessage(`Ticket #${data.numero_ticket} emitido con éxito.`);
      setNumeroJugado("");
      setMontoPago("");
      setNombreCliente("Genérico");
      onRefreshSales();
    } catch (err: any) {
      setErrorMessage(err.message || "Ocurrió un error inesperado al emitir el ticket.");
    } finally {
      setLoading(false);
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
    <div id="vendedor-container" className="flex flex-col bg-[#F3F4F6] h-full w-full overflow-hidden">
      
      {/* Vendedor Bar */}
      <div className="bg-[#1E3A8A] text-white px-4 py-3 flex flex-col justify-between border-b border-blue-950">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="relative">
              <span className="text-sm font-display font-black tracking-wide uppercase">{user.nombre}</span>
              <span className="block text-[10px] text-blue-200 uppercase font-mono tracking-wider font-bold">Vendedor POS</span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
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
              type="submit"
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
          <div className="space-y-4 animate-fade-in">
            
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

            {/* Play Form Details (Split View) */}
            <div className="grid grid-cols-12 gap-3 items-end">
              
              {/* Display of number */}
              <div className="col-span-6">
                <label className="block text-[10px] font-display font-black text-gray-700 uppercase tracking-wider mb-1">NÚMERO JUGADO</label>
                <div 
                  onClick={() => setActiveField('numero')}
                  className={`h-16 border-2 rounded-2xl flex items-center justify-center relative font-mono shadow-inner px-2 overflow-hidden cursor-pointer transition-colors ${
                  isLimitBlocked 
                    ? 'border-[#EF4444] text-[#EF4444] bg-red-50' 
                    : activeField === 'numero'
                    ? 'border-blue-500 text-blue-900 bg-blue-50 shadow-md'
                    : 'border-gray-400 text-gray-900 bg-white'
                }`}>
                  {selectedJuego === "Fechas" ? (
                    <span className="text-blue-900 text-xs font-black tracking-tight">{numeroJugado.replace("-", " de ")}</span>
                  ) : selectedJuego === "Premia2" ? (
                    <span className="flex items-center space-x-1.5 text-lg">
                      <span className="bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg text-blue-900 font-black">{numeroJugado.substring(0, 2) || "--"}</span>
                      <span className="text-gray-300 font-bold">-</span>
                      <span className="bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-lg text-blue-900 font-black">{numeroJugado.substring(2) || "--"}</span>
                    </span>
                  ) : selectedJuego === "Pega 3" ? (
                    <span className="flex items-center space-x-1 text-xs">
                      <span className="bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-lg text-blue-900 font-black">{numeroJugado.substring(0, 2) || "--"}</span>
                      <span className="text-gray-300 font-bold">-</span>
                      <span className="bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-lg text-blue-900 font-black">{numeroJugado.substring(2, 4) || "--"}</span>
                      <span className="text-gray-300 font-bold">-</span>
                      <span className="bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-lg text-blue-900 font-black">{numeroJugado.substring(4) || "--"}</span>
                    </span>
                  ) : selectedJuego === "Súper Premio" ? (
                    <div className="grid grid-cols-6 gap-0.5 text-[9px] w-full text-center">
                      {Array.from({ length: 6 }).map((_, idx) => {
                        const val = numeroJugado.substring(idx * 2, idx * 2 + 2);
                        return (
                          <span key={idx} className="bg-amber-50 border border-amber-200 py-1.5 rounded text-amber-900 font-black font-mono">
                            {val || "--"}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-3xl font-black tracking-widest">{numeroJugado || <span className="text-gray-300">--</span>}</span>
                  )}
                  
                  {numeroJugado && selectedJuego !== "Fechas" && (
                    <button 
                      id="clear-num-btn"
                      onClick={() => setNumeroJugado("")}
                      className="absolute right-1.5 top-1.5 p-0.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-500 hover:text-gray-800 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Monto de jugada */}
              <div className="col-span-6">
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
                    inputMode="none"
                    value={montoPago}
                    onFocus={() => setActiveField('monto')}
                    onChange={(e) => setMontoPago(e.target.value)}
                    placeholder="0"
                    className={`w-full h-16 pl-10 pr-2 rounded-2xl font-mono text-2xl font-black shadow-inner focus:outline-none border-2 transition-colors ${
                      isLimitBlocked 
                        ? 'border-[#EF4444] text-[#EF4444] bg-red-50 focus:border-red-600' 
                        : activeField === 'monto'
                        ? 'border-blue-500 text-blue-900 bg-blue-50 shadow-md'
                        : 'border-gray-400 text-gray-900 bg-white'
                    }`}
                  />
                </div>
              </div>

              {/* Nombre del Cliente */}
              <div className="col-span-12 mt-2">
                <label className="block text-[10px] font-display font-black text-gray-700 uppercase tracking-wider mb-1">Nombre del Cliente</label>
                <input
                  type="text"
                  value={nombreCliente}
                  onChange={(e) => setNombreCliente(e.target.value)}
                  placeholder="Genérico"
                  className="w-full p-2.5 rounded-xl border-2 border-gray-300 text-sm font-semibold focus:outline-none focus:border-blue-900 bg-white text-gray-900 shadow-inner"
                />
              </div>

              {/* Posible Premio Indicator */}
              <div className="col-span-12 mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3 flex justify-between items-center">
                <span className="text-xs font-display font-black text-blue-900 uppercase tracking-wider">Premio Posible:</span>
                <span className="font-mono text-lg font-black text-emerald-600">
                  C$ {(() => {
                    const amt = Number(montoPago) || 0;
                    const amtCs = moneda === "USD" ? amt * (config.tasa_cambio || 36.50) : amt;
                    return (amtCs * calculatePrizeMultiplier(selectedJuego, selectedSorteo)).toFixed(2);
                  })()}
                </span>
              </div>
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

            {/* If game is "Fechas", display dropdown selects instead of standard keypad */}
            {selectedJuego === "Fechas" ? (
              <div className="bg-white p-3.5 rounded-2xl border-2 border-gray-300 shadow-xs space-y-3">
                <span className="block text-[10px] font-display font-black text-gray-500 uppercase tracking-wider">Selección de Día y Mes para Sorteo Fechas</span>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-mono font-bold text-gray-500 uppercase mb-1">DÍA (1-31)</label>
                    <select
                      id="fechas-dia-select"
                      value={numeroJugado.split("-")[0] || "01"}
                      onChange={(e) => {
                        const month = numeroJugado.split("-")[1] || "Enero";
                        setNumeroJugado(`${e.target.value.padStart(2, "0")}-${month}`);
                      }}
                      className="w-full p-2 border-2 border-gray-300 rounded-xl bg-gray-50 font-mono text-sm font-bold text-gray-800 focus:outline-none focus:border-blue-900 cursor-pointer"
                    >
                      {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map(day => (
                        <option key={day} value={day}>{day}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono font-bold text-gray-500 uppercase mb-1">MES</label>
                    <select
                      id="fechas-mes-select"
                      value={numeroJugado.split("-")[1] || "Enero"}
                      onChange={(e) => {
                        const day = numeroJugado.split("-")[0] || "01";
                        setNumeroJugado(`${day}-${e.target.value}`);
                      }}
                      className="w-full p-2 border-2 border-gray-300 rounded-xl bg-gray-50 font-sans text-sm font-bold text-gray-800 focus:outline-none focus:border-blue-900 cursor-pointer"
                    >
                      {["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"].map(mes => (
                        <option key={mes} value={mes}>{mes}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              /* On-screen Large Numeric Keyboard */
              <div className="bg-gray-800/95 p-3 rounded-2xl border border-gray-700 shadow-md">
                <div className="grid grid-cols-3 gap-2 text-white">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
                    <button
                      key={key}
                      id={`numkey-${key}`}
                      onClick={() => handleKeypadPress(key)}
                      className="py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl font-display font-black text-2xl border-b-2 border-gray-900 select-none cursor-pointer text-center"
                    >
                      {key}
                    </button>
                  ))}
                  
                  <button
                    id="numkey-borrar"
                    onClick={() => handleKeypadPress("BORRAR")}
                    className="py-3 bg-red-800/90 hover:bg-red-700 active:bg-red-600 text-white rounded-xl font-display font-bold text-xs uppercase tracking-wider border-b-2 border-red-950 select-none cursor-pointer flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4 mr-1" /> Borrar
                  </button>
                  
                  <button
                    id="numkey-0"
                    onClick={() => handleKeypadPress("0")}
                    className="py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl font-display font-black text-2xl border-b-2 border-gray-900 select-none cursor-pointer text-center"
                  >
                    0
                  </button>
                  
                  <button
                    id="numkey-back"
                    onClick={() => handleKeypadPress("BACKSPACE")}
                    className="py-3 bg-gray-600 hover:bg-gray-500 active:bg-gray-400 text-white rounded-xl font-display font-black text-lg border-b-2 border-gray-900 select-none cursor-pointer flex items-center justify-center"
                  >
                    ←
                  </button>
                  
                  <button
                    id="numkey-enter"
                    onClick={() => handleKeypadPress("ENTER")}
                    className="col-span-3 py-3 mt-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-400 text-white rounded-xl font-display font-black text-sm uppercase tracking-widest border-b-4 border-blue-800 select-none cursor-pointer flex items-center justify-center shadow-md transition-all"
                  >
                    {activeField === 'numero' ? 'Siguiente ➡' : 'Agregar Jugada ➕'}
                  </button>
                </div>
              </div>
            )}

            {/* Giant Emerald Action Button */}
            <button
              id="vender-submit-btn"
              onClick={handleGenerarTicket}
              disabled={loading || isLimitBlocked}
              className={`w-full py-4.5 rounded-2xl bg-[#10B981] hover:bg-[#0E9F6E] text-white font-display font-black text-lg tracking-widest uppercase border-b-4 border-emerald-950 shadow-md flex items-center justify-center space-x-2 select-none active:translate-y-0.5 active:border-b-2 transition-all cursor-pointer ${
                loading ? "opacity-70 cursor-not-allowed" : ""
              }`}
            >
              <span>{loading ? "GENERANDO..." : "GENERAR TICKET"}</span>
              <ArrowRight className="w-6 h-6 stroke-[3]" />
            </button>

          </div>
        )}

        {/* TAB 2: HISTORIAL Y ANULACIONES */}
        {activeTab === "historial" && (
          <div className="space-y-4 animate-fade-in">
            {/* Header and Refresh */}
            <div className="flex justify-between items-center border-b border-gray-200 pb-2">
              <div>
                <h3 className="font-display font-black text-sm text-gray-800 uppercase tracking-wider">Historial de Ventas</h3>
                <p className="text-[10px] text-gray-400 font-sans mt-0.5">Consulta de boletos emitidos y estados de anulación.</p>
              </div>
              <button
                id="refresh-history-btn"
                onClick={onRefreshSales}
                className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded text-gray-600 flex items-center space-x-1 text-xs font-bold transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Actualizar</span>
              </button>
            </div>

            {/* Filter and Search Bar */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 bg-gray-50 p-3 rounded-2xl border border-gray-200">
              {/* Date Filter */}
              <div>
                <label className="block text-[9px] font-display font-bold text-gray-500 uppercase tracking-wider mb-1">Filtrar por Fecha</label>
                <div className="relative">
                  <input
                    id="history-date-filter"
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                    className="w-full p-2 text-xs font-mono font-bold bg-white border border-gray-300 rounded-xl focus:outline-none focus:border-blue-900"
                  />
                  {filterDate && (
                    <button
                      onClick={() => setFilterDate("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              {/* Search Query */}
              <div>
                <label className="block text-[9px] font-display font-bold text-gray-500 uppercase tracking-wider mb-1">Buscar Ticket o Número</label>
                <div className="relative">
                  <input
                    id="history-search-input"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Ej. 0001041 o número jugado..."
                    className="w-full p-2 text-xs bg-white border border-gray-300 rounded-xl focus:outline-none focus:border-blue-900 pr-8"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Stats / Summary of Filtered Items */}
            <div className="bg-[#1E3A8A]/5 p-3 rounded-xl border border-[#1E3A8A]/10 flex flex-wrap justify-between items-center gap-2 text-xs font-semibold text-gray-700">
              <div>
                Tickets: <span className="font-bold text-[#1E3A8A]">{displayedSales.length}</span> {filterDate ? "este día" : "en total"}
              </div>
              <div className="flex space-x-3">
                <span>Total C$: <strong className="text-gray-950">C$ {displayedSales.filter(s => !s.anulado && s.moneda === "C$").reduce((sum, s) => sum + s.monto_pago, 0).toFixed(2)}</strong></span>
                <span>Total USD: <strong className="text-emerald-700">$ {displayedSales.filter(s => !s.anulado && s.moneda === "USD").reduce((sum, s) => sum + s.monto_pago, 0).toFixed(2)}</strong></span>
              </div>
            </div>

            {displayedSales.length === 0 ? (
              <div className="text-center py-10 bg-white border border-gray-300 rounded-2xl text-gray-500 text-sm font-sans font-medium">
                No se encontraron ventas para los filtros seleccionados.
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                {displayedSales.map((sale) => {
                  const saleSorteo = config?.sorteos?.find(s => s.nombre === sale.sorteo && s.juego === sale.juego);
                  const isClosed = saleSorteo ? isSorteoCerrado(saleSorteo) : true;
                  const canVoid = !isClosed && !sale.anulado;

                  return (
                    <div 
                      key={sale.id} 
                      className={`p-3 rounded-2xl border bg-white shadow-xs relative flex flex-col justify-between transition-all ${
                        sale.anulado 
                          ? "border-red-200 bg-red-50/20 opacity-75" 
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {/* Ticket top tag */}
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-mono text-xs font-black text-gray-950 bg-gray-100 px-2 py-0.5 rounded">
                            Ticket #{sale.numero_ticket}
                          </span>
                          <span className="text-[10px] text-gray-400 block font-mono mt-1">
                            {new Date(sale.timestamp_servidor).toLocaleDateString("es-ES")} {formatTo12HourTime(sale.timestamp_servidor)}
                          </span>
                        </div>

                        <div className="text-right">
                          <span className="font-display font-black text-lg text-blue-950 block">
                            {sale.moneda} {sale.monto_pago.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-gray-400 block font-mono uppercase">
                            Firma: {sale.firma_digital}
                          </span>
                        </div>
                      </div>

                      {/* Info Row */}
                      <div className="flex justify-between items-center py-1.5 border-t border-b border-dashed border-gray-200 text-xs font-semibold text-gray-700">
                        <div>
                          Juego: <span className="font-bold text-gray-950 uppercase">{sale.juego}</span>
                        </div>
                        <div>
                          Número: <span className="font-mono font-black text-gray-950 bg-yellow-100 px-2 py-0.5 rounded text-sm">{sale.numero_jugado}</span>
                        </div>
                      </div>

                      {/* Footer & Anular button */}
                      <div className="mt-2.5 flex justify-between items-center">
                        <div>
                          {sale.anulado ? (
                            <span className="inline-flex items-center space-x-1 bg-[#EF4444] text-white px-2 py-0.5 rounded text-[10px] font-black uppercase">
                              <X className="w-3 h-3 stroke-[3]" />
                              <span>Anulado</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded font-black uppercase">
                              ✓ Emitido
                            </span>
                          )}
                        </div>

                        <div className="flex space-x-2">
                          <button
                            id={`view-ticket-${sale.id}`}
                            onClick={() => setActiveTicket(sale)}
                            className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-[#1E3A8A] font-sans font-bold text-xs rounded-lg border border-blue-200 cursor-pointer transition-colors"
                          >
                            Ver Ticket
                          </button>
                          
                          {canVoid ? (
                            <button
                              id={`void-ticket-${sale.id}`}
                              onClick={() => handleAnularTicket(sale.id)}
                              className="px-2.5 py-1 bg-[#EF4444] hover:bg-[#D83A3A] text-white font-sans font-bold text-xs rounded-lg flex items-center space-x-1 cursor-pointer shadow-xs animate-pulse"
                            >
                              <X className="w-3.5 h-3.5 stroke-[2.5]" />
                              <span>Anular</span>
                            </button>
                          ) : (
                            !sale.anulado && (
                              <span className="text-[10px] text-gray-400 font-sans italic self-center">
                                Sorteo Cerrado
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PAGOS (QR SCANNERS) */}
        {activeTab === "pagos" && (
          <div className="space-y-4 animate-fade-in">
            <div className="border-b border-gray-200 pb-2">
              <h3 className="font-display font-black text-sm text-gray-800 uppercase tracking-wider">Validar y Pagar Premios</h3>
              <p className="text-[10px] text-gray-400 font-sans mt-0.5">Escanea el código QR del ticket o ingresa el ID manualmente.</p>
            </div>

            {/* QR Scanner Section */}
            <div className="bg-white rounded-2xl p-4 border border-gray-300 shadow-sm flex flex-col items-center">

              {cameraStatus === 'loading' && (
                <div className="w-full h-48 flex flex-col items-center justify-center bg-gray-50 rounded-xl border border-gray-200">
                  <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-900 rounded-full animate-spin mb-2"></div>
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Iniciando Cámara...</p>
                </div>
              )}
              
              {cameraStatus === 'denied' && (
                <div className="w-full p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-center mb-4">
                  <AlertTriangle className="w-6 h-6 mx-auto mb-1 opacity-80" />
                  <p className="text-[11px] font-bold uppercase">Acceso Denegado</p>
                  <p className="text-[10px] mt-1">Para escanear tickets, debes permitir el acceso a la cámara en los ajustes de tu navegador.</p>
                </div>
              )}
              
              {cameraStatus === 'error' && (
                <div className="w-full p-4 bg-orange-50 text-orange-700 rounded-xl border border-orange-200 text-center mb-4">
                  <AlertTriangle className="w-6 h-6 mx-auto mb-1 opacity-80" />
                  <p className="text-[11px] font-bold uppercase">Error de Cámara</p>
                  <p className="text-[10px] mt-1">No se detectó cámara o hardware no compatible.</p>
                </div>
              )}

              <div className={`w-full max-w-sm overflow-hidden rounded-xl ${cameraStatus === 'ready' ? 'border border-gray-200' : 'hidden'}`} id="reader"></div>

              
              <div className="mt-4 w-full">
                <label className="text-[10px] font-bold text-gray-500 uppercase block mb-1">O ingresar ID manualmente</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    placeholder="Ej. A9X-2M o 0001045"
                    value={qrSearchInput}
                    onChange={(e) => setQrSearchInput(e.target.value)}
                    className="flex-1 text-sm p-2.5 border border-gray-300 rounded-lg font-mono font-bold text-gray-800 focus:outline-none focus:border-[#1E3A8A]"
                  />
                  <button
                    onClick={() => {
                      if(qrSearchInput) processPayment(qrSearchInput);
                    }}
                    disabled={loading || !qrSearchInput}
                    className="px-4 bg-[#1E3A8A] hover:bg-blue-800 text-white rounded-lg font-bold flex items-center justify-center cursor-pointer disabled:opacity-50"
                  >
                    Validar
                  </button>
                </div>
              </div>
            </div>
            
            {/* Payment Animation Modals */}
            <AnimatePresence>
              {paymentResult && paymentResult.ganador && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 50 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 50 }}
                  className="bg-emerald-500 rounded-3xl p-6 text-white text-center shadow-2xl relative overflow-hidden"
                >
                  <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent mix-blend-overlay"></div>
                  <CheckCircle className="w-16 h-16 mx-auto mb-2 text-emerald-100" />
                  <h2 className="text-2xl font-black uppercase tracking-widest mb-1">¡Ganador!</h2>
                  <p className="text-emerald-100 text-xs mb-4">El ticket ha sido premiado.</p>
                  
                  <div className="bg-white/20 rounded-2xl p-4 backdrop-blur-sm border border-white/30">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-100 mb-1">Monto a Entregar</span>
                    <span className="text-4xl font-black tracking-tighter">
                      C$ {paymentResult.monto.toFixed(2)}
                    </span>
                  </div>
                  
                  <button 
                    onClick={() => setPaymentResult(null)}
                    className="mt-6 w-full py-3 bg-white text-emerald-600 rounded-xl font-bold uppercase tracking-wider hover:bg-emerald-50 transition-colors cursor-pointer"
                  >
                    Aceptar y Cerrar
                  </button>
                </motion.div>
              )}

              {paymentResult && !paymentResult.ganador && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 50 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 50 }}
                  className="bg-red-500 rounded-3xl p-6 text-white text-center shadow-2xl relative overflow-hidden"
                >
                  <X className="w-16 h-16 mx-auto mb-2 text-red-100" />
                  <h2 className="text-2xl font-black uppercase tracking-widest mb-1">Sin Premio</h2>
                  <p className="text-red-100 text-sm mb-4">{paymentResult.message}</p>
                  <button 
                    onClick={() => setPaymentResult(null)}
                    className="mt-6 w-full py-3 bg-white text-red-600 rounded-xl font-bold uppercase tracking-wider hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    Cerrar
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

      </div>

      
        {/* TAB 4: BOLETO */}
        {activeTab === "boleto" && (
          <div className="space-y-4 animate-fade-in">
            <div className="border-b border-gray-200 pb-2">
              <h3 className="font-display font-black text-sm text-gray-800 uppercase tracking-wider">Gestión de Boletos</h3>
              <p className="text-[10px] text-gray-400 font-sans mt-0.5">Busca, verifica y reutiliza tickets anteriores.</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-3 shadow-xs">
              <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-2">ID, Número o Firma</label>
              <div className="flex space-x-2">
                <input type="text" value={boletoSearchInput}
                  onChange={(e) => setBoletoSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleBoletoSearch(boletoSearchInput); }}
                  placeholder="Ej. 0001045 o A9X-2M..."
                  className="flex-1 text-sm p-2.5 border-2 border-gray-200 rounded-xl font-mono font-bold text-gray-800 focus:outline-none focus:border-blue-900" />
                <button onClick={() => handleBoletoSearch(boletoSearchInput)}
                  disabled={boletoLoading || !boletoSearchInput.trim()}
                  className="px-4 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold flex items-center space-x-1 cursor-pointer disabled:opacity-50">
                  <Search className="w-4 h-4" /><span className="text-xs">Buscar</span>
                </button>
              </div>
              {boletoError && (
                <div className="mt-2 text-[10px] text-red-600 font-medium flex items-center space-x-1">
                  <AlertCircle className="w-3 h-3" /><span>{boletoError}</span>
                </div>
              )}
              {boletoLoading && (
                <div className="mt-3 flex items-center space-x-2 text-blue-700 text-xs">
                  <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-700 rounded-full animate-spin"></div>
                  <span>Buscando boleto...</span>
                </div>
              )}
            </div>

            {boletoFound && (
              <div className="bg-white border-2 border-blue-100 rounded-2xl overflow-hidden shadow-sm">
                <div className={`px-4 py-3 flex justify-between items-start ${boletoFound.anulado ? 'bg-red-800' : 'bg-blue-900'}`}>
                  <div>
                    <span className="text-white font-display font-black text-sm">Ticket #{boletoFound.numero_ticket}</span>
                    <span className="block text-blue-200 text-[10px] font-mono mt-0.5">{new Date(boletoFound.timestamp_servidor).toLocaleString("es-ES")}</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${boletoFound.anulado ? 'bg-red-600 text-white' : 'bg-emerald-500 text-white'}`}>
                      {boletoFound.anulado ? "ANULADO" : "ACTIVO"}
                    </span>
                    <span className="block text-blue-200 text-[10px] font-mono mt-1">Firma: {boletoFound.firma_digital}</span>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-gray-50 p-2 rounded-lg">
                      <span className="block text-[9px] text-gray-500 uppercase font-black tracking-wider">Juego</span>
                      <span className="font-mono font-black text-gray-900">{boletoFound.juego}</span>
                    </div>
                    <div className="bg-gray-50 p-2 rounded-lg">
                      <span className="block text-[9px] text-gray-500 uppercase font-black tracking-wider">Monto</span>
                      <span className="font-mono font-black text-blue-900">{boletoFound.moneda} {boletoFound.monto_pago.toFixed(2)}</span>
                    </div>
                  </div>

                  {boletoFound.jugadas && boletoFound.jugadas.length > 0 ? (
                    <div>
                      <span className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">Jugadas ({boletoFound.jugadas.length})</span>
                      <table className="w-full text-xs border border-gray-200 rounded-xl overflow-hidden">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-3 py-1.5 font-black text-gray-500 uppercase text-[9px]">Número</th>
                            <th className="text-right px-3 py-1.5 font-black text-gray-500 uppercase text-[9px]">Monto</th>
                            <th className="text-right px-3 py-1.5 font-black text-gray-500 uppercase text-[9px]">Premio</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {boletoFound.jugadas.map((j, i) => (
                            <tr key={i}><td className="px-3 py-2 font-mono font-black text-blue-900">{j.numero}</td><td className="px-3 py-2 text-right font-mono text-gray-800">{boletoFound.moneda} {j.monto.toFixed(2)}</td><td className="px-3 py-2 text-right font-mono text-emerald-600">C$ {j.premio_posible.toFixed(2)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 flex justify-between items-center">
                      <span className="text-[9px] font-black text-yellow-700 uppercase">Número</span>
                      <span className="font-mono font-black text-yellow-900 text-sm">{boletoFound.numero_jugado}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                    <button onClick={() => setActiveTicket(boletoFound)}
                      className="flex flex-col items-center justify-center py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 rounded-xl text-[9px] font-black uppercase tracking-wide cursor-pointer space-y-1">
                      <QrCode className="w-4 h-4" /><span>Reimprimir</span>
                    </button>
                    <button onClick={() => handleVolverAJugar(boletoFound)}
                      className="flex flex-col items-center justify-center py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-xl text-[9px] font-black uppercase tracking-wide cursor-pointer space-y-1">
                      <ArrowRight className="w-4 h-4" /><span>Volver Jugar</span>
                    </button>
                  </div>

                  {!boletoFound.anulado && (() => {
                    const sorteoObj = config.sorteos.find(s => s.nombre === boletoFound.sorteo && s.juego === boletoFound.juego);
                    return (sorteoObj && !isSorteoCerrado(sorteoObj)) ? (
                      <button onClick={() => { handleAnularTicket(boletoFound.id); setBoletoFound(null); }}
                        className="w-full mt-1 py-2.5 bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 rounded-xl text-xs font-black uppercase tracking-wide flex items-center justify-center space-x-2 cursor-pointer">
                        <X className="w-4 h-4 stroke-[3]" /><span>Anular Boleto</span>
                      </button>
                    ) : null;
                  })()}
                </div>
              </div>
            )}

          </div>
        )}

      {/* Bottom Navigation Bar */}
      <div className="bg-white border-t border-gray-300 py-1 px-2 flex justify-between items-center z-10">
        <button id="nav-venta" onClick={() => { setActiveTab("venta"); setErrorMessage(null); setSuccessMessage(null); }} className={`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer ${activeTab === "venta" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}`}>
          <Gamepad2 className={`w-5 h-5 stroke-[2.5] ${activeTab === "venta" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Venta</span>
        </button>
        <button id="nav-boleto" onClick={() => { setActiveTab("boleto"); setErrorMessage(null); setSuccessMessage(null); }} className={`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer ${activeTab === "boleto" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}`}>
          <Ticket className={`w-5 h-5 stroke-[2.5] ${activeTab === "boleto" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Boleto</span>
        </button>
        <button id="nav-historial" onClick={() => { setActiveTab("historial"); setErrorMessage(null); setSuccessMessage(null); onRefreshSales(); }} className={`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer ${activeTab === "historial" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}`}>
          <History className={`w-5 h-5 stroke-[2.5] ${activeTab === "historial" ? "text-[#1E3A8A]" : ""}`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Historial</span>
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
        />
      )}

    </div>
  );
}
