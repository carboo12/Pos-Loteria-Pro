import { X, Share2, Printer, CheckCircle, Smartphone, Lock } from "lucide-react";
import { useState } from "react";
import html2canvas from "html2canvas";
import { Venta, Configuracion } from "../types";

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

export default function TicketPreviewModal({ ticket, config, onClose, userRole = "vendedor", serverTime }: TicketPreviewModalProps) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

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

  const ejecutarFallbackWhatsApp = () => {
    const textoCodificado = encodeURIComponent(ticketText);
    window.open(`https://api.whatsapp.com/send?text=${textoCodificado}`, '_blank');
  };

  const shareTicketImage = async () => {
    setSharing(true);
    try {
      const ticketElement = document.getElementById("thermal-ticket-render");
      if (!ticketElement) {
        ejecutarFallbackWhatsApp();
        setSharing(false);
        return;
      }
      
      // Use html2canvas to capture the ticket UI
      const canvas = await html2canvas(ticketElement, { scale: 2, useCORS: true, logging: false });
      canvas.toBlob(async (blob) => {
        if (!blob) {
          ejecutarFallbackWhatsApp();
          setSharing(false);
          return;
        }
        
        const file = new File([blob], `ticket_${ticket.numero_ticket}.png`, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'Ticket de Lotería',
              text: 'Aquí está su ticket de juego.'
            });
          } catch (error) {
            console.error("Error al usar Share API nativo, activando fallback:", error);
            ejecutarFallbackWhatsApp();
          }
        } else {
          // Si el navegador de Android no soporta compartir imágenes, usar el plan B de texto
          ejecutarFallbackWhatsApp();
        }
        setSharing(false);
      }, "image/png");
    } catch (err) {
      console.error("Error generating ticket image:", err);
      ejecutarFallbackWhatsApp();
      setSharing(false);
    }
  };

  const handlePrint = () => {
    shareTicketImage();
  };

  const handleShare = () => {
    shareTicketImage();
  };

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
          <div id="thermal-ticket-render" className="bg-white px-6 py-6 w-full font-mono text-xs text-[#1f2937] relative">
            
            {/* Ticket Brand Header */}
            <div className="flex justify-center mb-1">
              <img 
                src="/logo.png" 
                alt={config?.formato_ticket?.titulo || "Logo"} 
                className="h-12 w-auto object-contain filter drop-shadow-xs"
              />
            </div>
            <div className="text-center font-bold text-[#030712] text-xs uppercase tracking-wide mb-0.5">
              {config.formato_ticket.titulo}
            </div>
            <div className="text-center text-[10px] text-[#6b7280] font-sans tracking-wide mb-3">
              {config.formato_ticket.ruc}
            </div>

            <div className="border-t border-dashed border-[#d1d5db] my-2" />

            {/* Ticket Info */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>Nº TICKET:</span>
                <span className="font-bold text-[#030712]">#{ticket.numero_ticket}</span>
              </div>
              <div className="flex justify-between">
                <span>FECHA:</span>
                <span className="text-[#030712]">{formatTicketDate(ticket.timestamp_servidor)}</span>
              </div>
              <div className="flex justify-between">
                <span>VENDEDOR:</span>
                <span className="text-[#030712] uppercase truncate max-w-[150px]">{ticket.nombre_vendedor}</span>
              </div>
              {ticket.nombre_cliente && (
                <div className="flex justify-between">
                  <span>CLIENTE:</span>
                  <span className="text-[#030712] uppercase truncate max-w-[150px]">{ticket.nombre_cliente}</span>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-[#d1d5db] my-2" />

            {/* Game & Pick Detail — Multi-Jugada Table */}
            <div className="py-2 my-2">
              <div className="font-display font-bold text-xs text-[#1e3a8a] uppercase tracking-wider text-center">{ticket.juego}</div>
              <div className="text-[10px] text-[#6b7280] mt-0.5 text-center">{ticket.sorteo}</div>
              
              {(() => {
                const jugadas = ticket.jugadas && ticket.jugadas.length > 0
                  ? ticket.jugadas
                  : [{ numero: ticket.numero_jugado, monto: ticket.monto_pago, premio_posible: potentialPrizeCs }];

                return (
                  <div className="mt-2 bg-transparent">
                    {/* Línea Divisoria Térmica Superior */}
                    <div className="border-t border-dashed border-gray-300 my-2" />
                    
                    {/* Table Header */}
                    <div className="flex justify-between text-[9px] font-bold text-[#6b7280] uppercase tracking-wider pb-1 mb-1">
                      <span className="w-12 text-left">NÚM.</span>
                      <span className="flex-1 text-center">MONTO</span>
                      <span className="w-24 text-right">PREMIO</span>
                    </div>
                    
                    {/* Dynamic Rows */}
                    {jugadas.map((j, i) => (
                      <div key={i} className="flex justify-between text-[11px] font-mono py-0.5">
                        <span className="w-12 text-left font-bold text-[#030712]">{j.numero}</span>
                        <span className="flex-1 text-center text-[#374151]">{ticket.moneda} {j.monto.toFixed(2)}</span>
                        <span className="w-24 text-right font-bold text-emerald-600">C$ {j.premio_posible.toFixed(0)}</span>
                      </div>
                    ))}
                    
                    {/* Línea Divisoria Térmica Inferior */}
                    <div className="border-b border-dashed border-gray-300 my-2" />
                    
                    {/* Total */}
                    <div className="flex justify-between text-xs font-black text-[#030712] pt-1 mt-1 uppercase">
                      <span>Total:</span>
                      <span>{ticket.moneda} {ticket.monto_pago.toFixed(2)}</span>
                    </div>
                    <div className="text-[10px] font-black text-emerald-600 mt-2 text-center">
                      PREMIO POSIBLE TOTAL: C$ {potentialPrizeCs.toFixed(2)}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Winner Evaluation Result */}
            {(() => {
              const sorteoObj = config.sorteos?.find(s => s.nombre === ticket.sorteo);
              const ticketDate = ticket.timestamp_servidor.substring(0, 10);
              const resultObj = sorteoObj 
                ? (config.resultados || []).find((r: any) => r.id_sorteo === sorteoObj.id && r.fecha === ticketDate)
                : null;

              if (ticket.anulado) {
                return (
                  <div className="my-3 p-3 bg-[#f3f4f6] border border-[#d1d5db] rounded-xl text-center">
                    <span className="text-[10px] font-sans font-bold text-[#6b7280] uppercase block">ESTADO DEL TICKET</span>
                    <span className="text-sm font-display font-black text-[#9ca3af] uppercase tracking-wider block mt-0.5">ANULADO</span>
                  </div>
                );
              }

              if (!resultObj) {
                return (
                  <div className="my-3 p-3 bg-[#fffbeb] border border-[#fde68a] rounded-xl text-center">
                    <span className="text-[10px] font-sans font-bold text-[#b45309] uppercase block">ESTADO DEL TICKET</span>
                    <span className="text-sm font-display font-black text-[#78350f] uppercase tracking-wider block mt-0.5">⏳ PENDIENTE DE JUGAR</span>
                    <span className="text-[9px] text-[#d97706] block mt-1 leading-normal font-sans font-medium">El número ganador para este sorteo del {ticketDate} aún no ha sido registrado.</span>
                  </div>
                );
              }

              const cleanJugado = ticket.numero_jugado.trim().toLowerCase();
              const cleanGanador = resultObj.numero_ganador.trim().toLowerCase();
              const isWinner = cleanJugado === cleanGanador;

              if (isWinner) {
                return (
                  <div className="my-3 p-4 bg-[#ecfdf5] border-2 border-[#10b981] rounded-xl text-center animate-pulse">
                    <span className="text-[10px] font-sans font-bold text-[#15803d] uppercase block">RESULTADO DEL SORTEO: {cleanGanador}</span>
                    <span className="text-base font-display font-black text-[#14532d] uppercase tracking-widest block mt-0.5">🎉 ¡BOLETO PREMIADO!</span>
                    <div className="mt-2.5 pt-2 border-t border-[#d1fae5]">
                      <span className="text-[9px] font-sans font-bold text-[#16a34a] uppercase block">CANTIDAD A PAGAR AL CLIENTE (C$)</span>
                      <span className="text-lg font-mono font-black text-[#166534]">
                        C$ {potentialPrizeCs.toLocaleString("es-ES", { minimumFractionDigits: 2 })}
                      </span>
                      {ticket.moneda === "USD" && (
                        <span className="text-[9px] text-[#16a34a] block mt-0.5 font-sans">
                          (Apuesta: USD {ticket.monto_pago.toFixed(2)} × tasa C$ {(config.tasa_cambio || 36.50).toFixed(2)})
                        </span>
                      )}
                    </div>
                  </div>
                );
              } else {
                return (
                  <div className="my-3 p-3 bg-[#fef2f2] border border-[#fecaca] rounded-xl text-center">
                    <span className="text-[10px] font-sans font-bold text-[#b91c1c] uppercase block">RESULTADO DEL SORTEO: {cleanGanador}</span>
                    <span className="text-sm font-display font-black text-[#7f1d1d] uppercase tracking-wider block mt-0.5">❌ NO PREMIADO</span>
                    <span className="text-[9px] text-[#dc2626] block mt-1 leading-normal font-sans font-medium">Su número jugado no coincide con el número ganador.</span>
                  </div>
                );
              }
            })()}

            <div className="border-t border-dashed border-[#d1d5db] my-2" />

            {/* Digital Anti-Photoshop Signature */}
            <div className="text-center py-1">
              <div className="text-[8px] text-[#6b7280] tracking-wider font-sans uppercase font-bold">Firma Digital (Anti-Photoshop)</div>
              <div className="font-mono text-sm font-black text-[#111827] tracking-widest mt-0.5 select-all">
                {ticket.firma_digital}
              </div>
            </div>

            <div className="border-t border-dashed border-[#d1d5db] my-2" />

            {/* Footer message */}
            <div className="text-center text-[10px] text-[#6b7280] font-sans leading-tight italic">
              {config.formato_ticket.mensaje_pie}
            </div>

            {/* Simulated Barcode & Real scannable QR Code */}
            <div className="mt-4 flex flex-col items-center border-t border-[#e5e7eb] pt-3 space-y-3">
              <div className="flex flex-col items-center w-full">
                <div className="h-7 w-4/5 bg-repeat-x bg-contain opacity-75" style={{ backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"10\"><rect x=\"0\" width=\"2\" height=\"10\" fill=\"black\"/><rect x=\"3\" width=\"1\" height=\"10\" fill=\"black\"/><rect x=\"6\" width=\"3\" height=\"10\" fill=\"black\"/><rect x=\"11\" width=\"2\" height=\"10\" fill=\"black\"/><rect x=\"15\" width=\"1\" height=\"10\" fill=\"black\"/><rect x=\"18\" width=\"2\" height=\"10\" fill=\"black\"/></svg>')" }} />
                <span className="text-[8px] text-[#9ca3af] mt-1 font-mono">TK-{ticket.id}</span>
              </div>
              
              <div className="flex flex-col items-center p-2">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${window.location.origin}/verificar?ticket=${ticket.numero_ticket}%26firma=${ticket.firma_digital}`}
                  alt="QR Verificación"
                  className="w-20 h-20 p-1"
                  referrerPolicy="no-referrer"
                />
                <span className="text-[7px] text-[#6b7280] font-mono mt-1 uppercase tracking-wider">Verificación Digital QR</span>
              </div>
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
            onClick={handlePrint}
            disabled={isBlocked}
            className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-center cursor-pointer shadow-sm border-b-2 ${
              isBlocked 
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
            disabled={isBlocked || sharing}
            className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-center shadow-sm border-b-2 ${
              isBlocked || sharing
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed border-b-0" 
                : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 border-emerald-700 cursor-pointer"
            }`}
          >
            {sharing ? (
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <Share2 className="w-4 h-4" />
            )}
            <span>{sharing ? "Cargando..." : "WhatsApp"}</span>
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
