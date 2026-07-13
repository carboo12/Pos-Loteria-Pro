import { X, Share2, Printer, CheckCircle, Smartphone, Lock } from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { toBlob } from "html-to-image";

import { Venta, Configuracion } from "../types";
import { QRCodeSVG } from "qrcode.react";


/**
 * Safe helper to parse a time string (can be "11:00 AM", "3:00 PM", "15:00", "11:00")
 * and compare it to a synced reference Date (from the server).
 * Returns true if the reference time is past or equal to the draw time.
 */
function isTimePast(drawTimeStr: string, syncedNow: Date): boolean {
  try {
    if (!drawTimeStr) return false;
    
    let drawHour = 0;
    let drawMin = 0;
    const cleanDraw = drawTimeStr.trim().toUpperCase();
    
    // Check if it's 12-hour format (AM/PM)
    if (cleanDraw.includes("AM") || cleanDraw.includes("PM")) {
      const isPM = cleanDraw.includes("PM");
      const timePart = cleanDraw.replace("AM", "").replace("PM", "").trim();
      const parts = timePart.split(":");
      drawHour = parseInt(parts[0], 10);
      drawMin = parts[1] ? parseInt(parts[1], 10) : 0;
      
      if (isPM && drawHour < 12) {
        drawHour += 12;
      } else if (!isPM && drawHour === 12) {
        drawHour = 0;
      }
    } else {
      // 24-hour format
      const parts = cleanDraw.split(":");
      drawHour = parseInt(parts[0], 10);
      drawMin = parts[1] ? parseInt(parts[1], 10) : 0;
    }
    
    // Use the server-synced reference time — NOT the client local clock
    const currentHour = syncedNow.getHours();
    const currentMin = syncedNow.getMinutes();
    
    if (currentHour > drawHour) return true;
    if (currentHour === drawHour && currentMin >= drawMin) return true;
    return false;
  } catch (err) {
    console.error("Error in isTimePast helper:", err);
    return false;
  }
}

/**
 * Helper to extract the time from a sorteo string (e.g. "La Diaria 11:00 AM (HN)" -> "11:00 AM")
 */
function extractTimeFromSorteo(sorteoStr: string): string {
  if (!sorteoStr) return "11:00 AM";
  const match = sorteoStr.match(/\b\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?\b/);
  return match ? match[0] : "11:00 AM";
}

interface TicketPreviewModalProps {
  ticket: Venta;
  config: Configuracion;
  onClose: () => void;
  userRole?: string;
  serverTime?: string;
  onPrint?: () => void;
}

function calculatePrizeMultiplier(juego: string, sorteo: string): number {
  const cleanJuego = juego.trim();
  if (cleanJuego === "Premia2" && sorteo.includes("(NI)")) {
    return 4000;
  }
  if (cleanJuego === "Jugá 3") {
    return 600;
  }
  if (cleanJuego === "Fechas") {
    return 210;
  }
  if (cleanJuego === "3 Monazos") {
    return 650;
  }
  return 80;
}

export default function TicketPreviewModal({ ticket, config, onClose, userRole = "vendedor", serverTime, onPrint }: TicketPreviewModalProps) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const ticketRenderRef = useRef<HTMLDivElement>(null);

  // Compute server-synced reference time for draw close check
  const syncedNow = (() => {
    if (serverTime) {
      const serverMs = new Date(serverTime).getTime();
      if (!isNaN(serverMs)) {
        // Apply the offset between server and local clock at mount time
        const offset = serverMs - Date.now();
        return new Date(Date.now() + offset);
      }
    }
    return new Date();
  })();

  const isBlocked = (() => {
    if (userRole === "admin" || userRole === "administrador") return false;
    const s = config.sorteos?.find(x => x.nombre === ticket.sorteo && x.juego === ticket.juego);
    if (!s) return false; // Falback if draw not found
    const [cierreHour, cierreMin] = s.hora_cierre.split(":").map(Number);
    const currentHour = syncedNow.getHours();
    const currentMin = syncedNow.getMinutes();
    return (currentHour > cierreHour) || (currentHour === cierreHour && currentMin >= cierreMin);
  })();

  const multiplier = calculatePrizeMultiplier(ticket.juego, ticket.sorteo);
  // Premios siempre en C$ (moneda local). Si el boleto fue en USD, convertir con tasa_cambio.
  const montoInCs = ticket.moneda === "USD"
    ? ticket.monto_pago * (config.tasa_cambio || 36.50)
    : ticket.monto_pago;
  const potentialPrizeCs = ticket.premio_posible_cs ?? (montoInCs * multiplier);

  const formatTicketDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      
      // Get weekday name in Spanish
      const weekday = date.toLocaleDateString("es-ES", { weekday: "long" });
      
      // Get day
      const day = String(date.getDate()).padStart(2, "0");
      
      // Get month name in uppercase
      const month = date.toLocaleDateString("es-ES", { month: "long" }).toUpperCase();
      
      // Get year
      const year = date.getFullYear();
      
      // Get hours and minutes
      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const ampm = hours >= 12 ? "pm" : "am";
      hours = hours % 12;
      hours = hours ? hours : 12; // the hour '0' should be '12'
      
      return `${weekday} ${day} ${month} del ${year}, hora del registro del ticket: ${hours}:${minutes} ${ampm}`;
    } catch {
      return isoString;
    }
  };

  // Determine jugadas list (fallback to single legacy field)
  const jugadasList = ticket.jugadas && ticket.jugadas.length > 0
    ? ticket.jugadas
    : [{ numero: ticket.numero_jugado, monto: ticket.monto_pago, premio_posible: potentialPrizeCs }];

  const padRight = (s: string, len: number) => s.length >= len ? s.substring(0, len) : s + " ".repeat(len - s.length);
  const padLeft = (s: string, len: number) => s.length >= len ? s.substring(0, len) : " ".repeat(len - s.length) + s;

  const jugadasLines = jugadasList.map(j => {
    const num = padRight(j.numero, 10);
    const monto = padLeft(`${ticket.moneda} ${j.monto.toFixed(2)}`, 12);
    const premio = padLeft(`C$ ${j.premio_posible.toFixed(0)}`, 12);
    return `${num}${monto}${premio}`;
  }).join("\n");

  const totalLine = padLeft(`TOTAL: ${ticket.moneda} ${ticket.monto_pago.toFixed(2)}`, 32);

  const ticketText = `
--------------------------------
${config.formato_ticket.titulo}
${config.formato_ticket.ruc}
--------------------------------
  TICKET: #${ticket.numero_ticket}
  FECHA: ${formatTicketDate(ticket.timestamp_servidor)}
  VENDEDOR: ${ticket.nombre_vendedor}
${ticket.nombre_cliente ? `  CLIENTE: ${ticket.nombre_cliente}\n` : ""}  --------------------------------
  JUEGO: ${ticket.juego.toUpperCase()}
SORTEO: ${ticket.sorteo}
--------------------------------
NUM.      MONTO         PREMIO
----------------------------------
${jugadasLines}
----------------------------------
${totalLine}
  PREMIO POSIBLE: C$ ${potentialPrizeCs.toFixed(2)}
  --------------------------------
FIRMA DIGITAL: ${ticket.firma_digital}
--------------------------------
${config.formato_ticket.mensaje_pie}
--------------------------------
  `.trim();

  const generarTextoTicketRaw = (): string => {
    let t = "";
    // Cabecera con logo e información principal de RawBT centrado
    t += "[C]<img>" + window.location.origin + "/logo_print_bw.png</img>\n";
    t += "[C]<b>LA NUEVA ERA</b>\n";
    t += "[C]pida su linea\n";
    t += "[C]--------------------------------\n";
    
    // Información del ticket
    t += `[L]TICKET: [R]#${ticket.numero_ticket}\n`;
    t += `[L]FECHA: [R]${ticket.timestamp_servidor.substring(0, 10)}\n`;
    t += `[L]VEND: ${ticket.nombre_vendedor || 'JOSE'} [R]CLI: ${ticket.nombre_cliente || 'GENERICO'}\n`;
    t += "[C]--------------------------------\n";
    
    // Juego y sorteo en negrita centrado
    t += `[C]<b>${ticket.juego.toUpperCase()}</b>\n`;
    t += `[C]${ticket.sorteo || ''}\n`;
    t += "[C]--------------------------------\n";
    
    // Encabezado de la tabla
    t += "[L]<b>NUM.</b>[C]<b>MONTO</b>[R]<b>PREMIO</b>\n";
    t += "[C]--------------------------------\n";

    const jugadas = ticket.jugadas && ticket.jugadas.length > 0
      ? ticket.jugadas
      : [{ numero: ticket.numero_jugado, monto: ticket.monto_pago, premio_posible: potentialPrizeCs }];

    // Filas alineadas por columnas
    jugadas.forEach((j: any) => {
      const num = j.numero.toString().padStart(2, '0');
      const monto = `${ticket.moneda} ${parseFloat(j.monto).toFixed(0)}`;
      const premio = `C$ ${parseFloat(j.premio_posible).toFixed(0)}`;
      t += `[L]${num}[C]${monto}[R]${premio}\n`;
    });

    t += "[C]--------------------------------\n";
    t += `[L]<b>TOTAL:</b> [R]<b>${ticket.moneda} ${parseFloat(ticket.monto_pago.toString()).toFixed(2)}</b>\n`;
    t += "[C]--------------------------------\n";
    t += `[L]<b>FIRMA:</b> [R]<b>${ticket.firma_digital || 'XXXX-XX'}</b>\n`;
    t += "[C]--------------------------------\n";
    
    // Código QR nativo de RawBT con sintaxis <qrcode>
    t += `\n[C]<qrcode size='8'>${window.location.origin}/verificar?ticket=${ticket.numero_ticket}&firma=${ticket.firma_digital}</qrcode>\n`;
    
    t += "[C]ESTADO DEL TICKET\n";
    
    // Determinar resultado
    const sorteoObj = config.sorteos?.find(s => s.nombre === ticket.sorteo);
    const ticketDate = ticket.timestamp_servidor.substring(0, 10);
    const resultObj = sorteoObj 
      ? (config.resultados || []).find((r: any) => r.id_sorteo === sorteoObj.id && r.fecha === ticketDate)
      : null;

    if (ticket.anulado) {
      t += "[C]<b>ANULADO</b>\n";
    } else if (!resultObj) {
      t += "[C]<b>PENDIENTE DE JUGAR</b>\n";
    } else {
      const cleanJugado = ticket.numero_jugado.trim().toLowerCase();
      const cleanGanador = resultObj.numero_ganador.trim().toLowerCase();
      const isWinner = cleanJugado === cleanGanador;
      if (isWinner) {
        t += "[C]<b>Boleta Premiada</b>\n";
      } else {
        t += "[C]<b>No Premiada</b>\n";
      }
    }
    
    t += "\n\n\n\n\n\n\n\n\n\n\n\n";
    return t;
  };

  const handlePrintRaw = async () => {
    setSharing(true);
    try {
      const textoTicket = generarTextoTicketRaw();
      const blob = new Blob([textoTicket], { type: 'text/plain;charset=utf-8' });
      const file = new File([blob], `ticket_${ticket.numero_ticket}.txt`, { type: 'text/plain' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Imprimir Ticket #${ticket.numero_ticket}`,
        });
      } else {
        alert("Tu navegador no soporta el envío de archivos de texto.");
      }
    } catch (error) {
      console.error("Error al despachar texto plano:", error);
    } finally {
      setSharing(false);
    }
  };

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const el = ticketRenderRef.current;
      if (!el) throw new Error("Elemento del ticket no encontrado");

      const blob = await toBlob(el, {
        pixelRatio: 2,
        cacheBust: true,
        skipAutoScale: true,
        style: { 
          backgroundColor: '#ffffff',
          overflow: 'visible',
        },
        height: el.scrollHeight,
        width: el.offsetWidth,
      });
      if (!blob) throw new Error("No se pudo generar la imagen");

      const file = new File([blob], `ticket_${ticket.numero_ticket}.png`, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Ticket #${ticket.numero_ticket}`,
        });
      } else {
        const textoCodificado = encodeURIComponent(ticketText);
        window.open(`https://api.whatsapp.com/send?text=${textoCodificado}`, '_blank');
      }
    } catch (error) {
      console.error("Error al compartir imagen nativa:", error);
      const textoCodificado = encodeURIComponent(ticketText);
      window.open(`https://api.whatsapp.com/send?text=${textoCodificado}`, '_blank');
    } finally {
      setSharing(false);
    }
  }, [ticket, ticketText]);

  const fallbackCopy = () => {
    navigator.clipboard.writeText(ticketText);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
      setSharing(false);
    }, 2500);
  };

  return (
    <div id="ticket-preview-modal" className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col border border-gray-300">
        
        {/* Modal Header */}
        <div className="bg-blue-900 text-white px-5 py-4 flex justify-between items-center border-b border-blue-950">
          <div className="flex items-center space-x-2">
            <CheckCircle className="text-emerald-400 w-5 h-5 stroke-[2.5]" />
            <span className="font-display font-bold text-lg tracking-tight">¡Ticket Generado!</span>
          </div>
          <button 
            id="close-ticket-btn"
            onClick={onClose}
            className="p-1 hover:bg-blue-800 rounded-lg transition-colors text-white/80 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Thermal Ticket Render */}
        <div className="overflow-y-auto max-h-[60vh] bg-white flex justify-center border-b border-gray-200">
          <div ref={ticketRenderRef} id="thermal-ticket-render" className="bg-white px-6 py-6 w-full font-mono text-sm text-black">
            
            {/* Ticket Brand Header */}
            <div className="flex justify-center mb-1">
              <img 
                src="/logo.png" 
                alt={config?.formato_ticket?.titulo || "Logo"} 
                className="h-12 w-auto object-contain"
              />
            </div>
            <div className="text-center font-black text-black text-sm uppercase tracking-wide mb-0.5">
              {config.formato_ticket.titulo}
            </div>
            <div className="text-center text-xs text-black font-bold tracking-wide mb-3">
              {config.formato_ticket.ruc}
            </div>

            <div className="border-t-2 border-black border-dotted my-2" />

            {/* Ticket Info */}
            <div className="space-y-1 text-xs font-bold text-black">
              <div className="flex justify-between">
                <span>Nº TICKET:</span>
                <span className="font-black text-black">#{ticket.numero_ticket}</span>
              </div>
              <div className="flex justify-between">
                <span>FECHA:</span>
                <span className="text-black">{formatTicketDate(ticket.timestamp_servidor)}</span>
              </div>
              <div className="flex justify-between">
                <span>VENDEDOR:</span>
                <span className="text-black uppercase truncate max-w-[150px]">{ticket.nombre_vendedor}</span>
              </div>
              {ticket.nombre_cliente && (
                <div className="flex justify-between">
                  <span>CLIENTE:</span>
                  <span className="text-black uppercase truncate max-w-[150px]">{ticket.nombre_cliente}</span>
                </div>
              )}
            </div>

            <div className="border-t-2 border-black border-dotted my-2" />

            {/* Game & Pick Detail — Multi-Jugada Table */}
            <div className="py-2 my-2 text-black">
              <div className="font-display font-black text-sm text-black uppercase tracking-wider text-center">{ticket.juego}</div>
              <div className="text-xs text-black font-bold mt-0.5 text-center">{ticket.sorteo}</div>
              
              {(() => {
                const jugadas = ticket.jugadas && ticket.jugadas.length > 0
                  ? ticket.jugadas
                  : [{ numero: ticket.numero_jugado, monto: ticket.monto_pago, premio_posible: potentialPrizeCs }];

                return (
                  <div className="mt-2 bg-transparent">
                    {/* Línea Divisoria Térmica Superior */}
                    <div className="border-t-2 border-black border-dotted my-2" />
                    
                    {/* Table Header */}
                    <div className="flex justify-between text-xs font-black text-black uppercase tracking-wider pb-1 mb-1">
                      <span className="w-12 text-left">NÚM.</span>
                      <span className="flex-1 text-center font-black">MONTO</span>
                      <span className="w-24 text-right font-black">PREMIO</span>
                    </div>
                    
                    {/* Dynamic Rows */}
                    {jugadas.map((j, i) => (
                      <div key={i} className="flex justify-between text-xs font-mono py-0.5 text-black">
                        <span className="w-12 text-left font-black text-black">{j.numero}</span>
                        <span className="flex-1 text-center font-bold text-black">{ticket.moneda} {j.monto.toFixed(2)}</span>
                        <span className="w-24 text-right font-black text-black">C$ {j.premio_posible.toFixed(0)}</span>
                      </div>
                    ))}
                    
                    {/* Línea Divisoria Térmica Inferior */}
                    <div className="border-b-2 border-black border-dotted my-2" />
                    
                    {/* Total */}
                    <div className="flex justify-between text-xs font-black text-black pt-1 mt-1 uppercase">
                      <span>Total:</span>
                      <span>{ticket.moneda} {ticket.monto_pago.toFixed(2)}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="border-t-2 border-black border-dotted my-2" />

            {/* Digital Anti-Photoshop Signature */}
            <div className="text-center py-1">
              <div className="text-xs text-black font-bold uppercase tracking-wider">Firma Digital</div>
              <div className="font-mono text-sm font-black text-black tracking-widest mt-0.5 select-all">
                {ticket.firma_digital}
              </div>
            </div>

            <div className="border-t-2 border-black border-dotted my-2" />

            {/* Footer message */}
            <div className="text-center text-xs text-black font-bold font-sans leading-tight italic uppercase">
              {config.formato_ticket.mensaje_pie}
            </div>

            {/* Simulated Barcode & Real scannable QR Code */}
            <div className="mt-4 flex flex-col items-center border-t-2 border-black border-dotted pt-3 space-y-3">
              <div className="flex flex-col items-center p-2 bg-white border-2 border-black">
                <QRCodeSVG 
                  value={`${window.location.origin}/verificar?ticket=${ticket.numero_ticket}&firma=${ticket.firma_digital}`}
                  size={100}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <span className="text-xs text-black font-bold font-mono mt-1 uppercase tracking-wider">Verificación Digital QR</span>
            </div>
            
          </div>
        </div>

        {/* Lock warning if blocked */}
        {isBlocked && (
          <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-red-900 font-sans text-xs flex items-center space-x-2.5 shadow-xs">
            <Lock className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <span className="font-bold block text-xs">Reimpresión Bloqueada</span>
              <span className="text-[10px] text-red-700 block">El sorteo de este ticket ya ha cerrado.</span>
            </div>
          </div>
        )}

        {/* Action buttons (Large POS-style) */}
        <div className="p-4 bg-white grid grid-cols-2 gap-3 border-t border-gray-100">
          <button
            id="print-ticket-btn"
            onClick={onPrint ? onPrint : handlePrintRaw}
            className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-center cursor-pointer shadow-sm border-b-2 ${
              isBlocked || sharing
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed border-b-0" 
                : "bg-blue-900 text-white hover:bg-blue-800 active:scale-95 border-blue-950"
            }`}
          >
            <Printer className="w-4 h-4" />
            <span>Imprimir</span>
          </button>
          
          <button
            id="share-ticket-btn"
            onClick={handleShare}
            disabled={isBlocked}
            className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-center shadow-sm border-b-2 ${
              isBlocked
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed border-b-0" 
                : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 border-emerald-700 cursor-pointer"
            }`}
          >
            <Share2 className="w-4 h-4" />
            <span>WhatsApp</span>
          </button>
        </div>

        {/* Floating toast notification */}
        {copied && (
          <div className="bg-emerald-800 text-white text-center text-xs py-2 font-sans font-bold flex items-center justify-center space-x-2 animate-bounce">
            <Smartphone className="w-4 h-4 animate-pulse" />
            <span>Copiado al portapapeles. ¡Listo para compartir en WhatsApp!</span>
          </div>
        )}
      </div>
    </div>
  );
}
