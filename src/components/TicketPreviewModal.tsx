import { X, Share2, Printer, CheckCircle, Smartphone, Lock } from "lucide-react";
import { useState } from "react";
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
  NÚMERO JUGADO: [ ${ticket.numero_jugado} ]
  MONTO: ${ticket.moneda} ${ticket.monto_pago.toFixed(2)}
  PREMIO POSIBLE: C$ ${potentialPrizeCs.toFixed(2)}
  --------------------------------
FIRMA DIGITAL: ${ticket.firma_digital}
--------------------------------
${config.formato_ticket.mensaje_pie}
--------------------------------
  `.trim();

  const handlePrint = () => {
    // Print window or trigger simulated thermal printing effect
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Imprimir Ticket #${ticket.numero_ticket}</title>
            <style>
              body {
                font-family: 'Courier New', Courier, monospace;
                width: 280px;
                margin: 10px auto;
                padding: 10px;
                border: 1px dashed #000;
                text-align: center;
                font-size: 14px;
                line-height: 1.2;
                color: #000;
              }
              h2 { margin: 5px 0; font-size: 16px; font-weight: bold; }
              hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
              .number { font-size: 24px; font-weight: bold; margin: 5px 0; border: 1px solid #000; display: inline-block; padding: 2px 15px; }
              .signature { font-size: 16px; font-weight: bold; background: #eee; padding: 4px; display: inline-block; margin: 5px 0; }
              @media print {
                body { border: none; margin: 0; padding: 0; }
              }
            </style>
          </head>
          <body>
            <div style="display: flex; justify-content: center; margin-bottom: 8px;">
              <img src="${window.location.origin}/logo.png" alt="${config?.formato_ticket?.titulo || 'Logo'}" style="height: 55px; width: auto; object-fit: contain;" />
            </div>
            <h2>${config.formato_ticket.titulo}</h2>
            <div>${config.formato_ticket.ruc}</div>
            <hr />
              <div style="text-align: left;">
                <div><strong>TICKET:</strong> #${ticket.numero_ticket}</div>
                <div><strong>FECHA:</strong> ${formatTicketDate(ticket.timestamp_servidor)}</div>
                <div><strong>VENDEDOR:</strong> ${ticket.nombre_vendedor}</div>
${ticket.nombre_cliente ? `                <div><strong>CLIENTE:</strong> ${ticket.nombre_cliente}</div>\n` : ""}              </div>
              <hr />
            <div style="font-weight: bold;">${ticket.juego.toUpperCase()}</div>
            <div>Sorteo: ${ticket.sorteo}</div>
            <div style="margin: 8px 0;">
              <div>NÚMERO JUGADO</div>
              <div class="number">${ticket.numero_jugado}</div>
            </div>
            <div><strong>MONTO:</strong> ${ticket.moneda} ${ticket.monto_pago.toFixed(2)}</div>
            ${(() => {
              const sObj = config.sorteos?.find(s => s.nombre === ticket.sorteo);
              const tDate = ticket.timestamp_servidor.substring(0, 10);
              const rObj = sObj 
                ? (config.resultados || []).find((r: any) => r.id_sorteo === sObj.id && r.fecha === tDate)
                : null;

              if (ticket.anulado) {
                return `<div style="margin: 8px 0; padding: 6px; border: 1px solid #ccc; background: #f3f4f6; font-weight: bold; font-size: 12px;">ESTADO: ANULADO</div>`;
              }
              if (!rObj) {
                return `
                  <div style="margin: 8px 0; padding: 6px; border: 1px dashed #d97706; background: #fffbeb; color: #b45309; text-align: center;">
                    <div style="font-size: 10px; font-weight: bold;">SORTEO PENDIENTE</div>
                    <div style="font-size: 12px; font-weight: bold; margin-top: 2px;">⏳ PENDIENTE DE JUGAR</div>
                  </div>
                `;
              }
              const isWin = ticket.numero_jugado.trim().toLowerCase() === rObj.numero_ganador.trim().toLowerCase();
              if (isWin) {
                return `
                  <div style="margin: 8px 0; padding: 8px; border: 2px solid #059669; background: #ecfdf5; color: #065f46; text-align: center; border-radius: 4px;">
                    <div style="font-size: 10px; font-weight: bold;">GANADOR: ${rObj.numero_ganador}</div>
                    <div style="font-size: 14px; font-weight: bold; margin-top: 2px;">🎉 ¡BOLETO PREMIADO!</div>
                    <div style="font-size: 9px; margin-top: 4px; font-weight: bold;">CANTIDAD A PAGAR:</div>
                    <div style="font-size: 18px; font-weight: bold; font-family: monospace;">C$ ${potentialPrizeCs.toFixed(2)}</div>
                  </div>
                `;
              } else {
                return `
                  <div style="margin: 8px 0; padding: 6px; border: 1px solid #f87171; background: #fef2f2; color: #991b1b; text-align: center; border-radius: 4px;">
                    <div style="font-size: 10px;">SORTEO RES: ${rObj.numero_ganador}</div>
                    <div style="font-size: 12px; font-weight: bold; margin-top: 2px;">❌ NO PREMIADO</div>
                  </div>
                `;
              }
            })()}
            <hr />
            <div>FIRMA DIGITAL DE SEGURIDAD</div>
            <div class="signature">${ticket.firma_digital}</div>
            <hr />
            <div style="font-size: 11px;">${config.formato_ticket.mensaje_pie}</div>
            <hr />
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; margin-top: 10px;">
              <img 
                src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${window.location.origin}/verificar?ticket=${ticket.numero_ticket}%26firma=${ticket.firma_digital}"
                alt="Código QR de Verificación"
                style="width: 100px; height: 100px; border: 1px solid #ccc; padding: 4px; background: #fff;"
              />
              <span style="font-size: 8px; color: #555; font-family: monospace; margin-top: 4px; text-transform: uppercase;">Verificación Rápida QR • ${config?.formato_ticket?.titulo || 'SISTEMA'}</span>
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(function() { window.close(); }, 500);
              }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    } else {
      // Fallback
      alert("Por favor habilite las ventanas emergentes para imprimir.");
    }
  };

  const handleShare = async () => {
    setSharing(true);
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Ticket #${ticket.numero_ticket}`,
          text: `Lotería: Juego ${ticket.juego}, Número ${ticket.numero_jugado}, Monto ${ticket.moneda} ${ticket.monto_pago}. Firma: ${ticket.firma_digital}`,
        });
      } catch (err) {
        console.log("Error sharing:", err);
        fallbackCopy();
      } finally {
        setSharing(false);
      }
    } else {
      fallbackCopy();
    }
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
        <div className="p-6 overflow-y-auto max-h-[60vh] bg-gray-50 flex justify-center border-b border-gray-200">
          <div className="bg-white border border-gray-300 shadow-md p-5 rounded-md w-full font-mono text-xs text-gray-800 relative">
            
            {/* Ticket jagged edge top */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-repeat-x" style={{ backgroundImage: "linear-gradient(45deg, transparent 33.333%, #f3f4f6 33.333%, #f3f4f6 66.667%, transparent 66.667%), linear-gradient(-45deg, transparent 33.333%, #f3f4f6 33.333%, #f3f4f6 66.667%, transparent 66.667%)", backgroundSize: "8px 4px" }} />
            
            {/* Ticket Brand Header */}
            <div className="flex justify-center mb-1">
              <img 
                src="/logo.png" 
                alt={config?.formato_ticket?.titulo || "Logo"} 
                className="h-12 w-auto object-contain filter drop-shadow-xs"
              />
            </div>
            <div className="text-center font-bold text-gray-950 text-xs uppercase tracking-wide mb-0.5">
              {config.formato_ticket.titulo}
            </div>
            <div className="text-center text-[10px] text-gray-500 font-sans tracking-wide mb-3">
              {config.formato_ticket.ruc}
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Ticket Info */}
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>Nº TICKET:</span>
                <span className="font-bold text-gray-950">#{ticket.numero_ticket}</span>
              </div>
              <div className="flex justify-between">
                <span>FECHA:</span>
                <span className="text-gray-950">{formatTicketDate(ticket.timestamp_servidor)}</span>
              </div>
              <div className="flex justify-between">
                <span>VENDEDOR:</span>
                <span className="text-gray-950 uppercase truncate max-w-[150px]">{ticket.nombre_vendedor}</span>
              </div>
              {ticket.nombre_cliente && (
                <div className="flex justify-between">
                  <span>CLIENTE:</span>
                  <span className="text-gray-950 uppercase truncate max-w-[150px]">{ticket.nombre_cliente}</span>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Game & Pick Detail */}
            <div className="text-center py-2 bg-gray-50/50 rounded-md my-2 border border-gray-100">
              <div className="font-display font-bold text-xs text-blue-900 uppercase tracking-wider">{ticket.juego}</div>
              <div className="text-[10px] text-gray-500 mt-0.5">{ticket.sorteo}</div>
              
              <div className="my-2.5 flex flex-col items-center">
                <span className="text-[9px] text-gray-400 font-sans uppercase">Número Jugado</span>
                <span className="font-display font-black text-3xl text-gray-950 tracking-tight px-6 py-1 border-2 border-gray-950 rounded-lg bg-white my-1 shadow-sm">
                  {ticket.numero_jugado}
                </span>
              </div>

              <div className="text-sm font-black text-gray-900 mt-1">
                MONTO: <span className="font-mono">{ticket.moneda} {ticket.monto_pago.toFixed(2)}</span>
              </div>
              <div className="text-xs font-black text-blue-900 mt-2 bg-blue-50 py-1 px-3 rounded-lg inline-block border border-blue-200 uppercase">
                PREMIO POSIBLE: <span className="font-mono">C$ {potentialPrizeCs.toFixed(2)}</span>
                {ticket.moneda === "USD" && (
                  <span className="text-[9px] text-blue-600 block font-sans normal-case mt-0.5">(equivalente en C$ al tipo de cambio vigente)</span>
                )}
              </div>
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
                  <div className="my-3 p-3 bg-gray-100 border border-gray-300 rounded-xl text-center">
                    <span className="text-[10px] font-sans font-bold text-gray-500 uppercase block">ESTADO DEL TICKET</span>
                    <span className="text-sm font-display font-black text-gray-400 uppercase tracking-wider block mt-0.5">ANULADO</span>
                  </div>
                );
              }

              if (!resultObj) {
                return (
                  <div className="my-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-center">
                    <span className="text-[10px] font-sans font-bold text-amber-700 uppercase block">ESTADO DEL TICKET</span>
                    <span className="text-sm font-display font-black text-amber-900 uppercase tracking-wider block mt-0.5">⏳ PENDIENTE DE JUGAR</span>
                    <span className="text-[9px] text-amber-600 block mt-1 leading-normal font-sans font-medium">El número ganador para este sorteo del {ticketDate} aún no ha sido registrado.</span>
                  </div>
                );
              }

              const cleanJugado = ticket.numero_jugado.trim().toLowerCase();
              const cleanGanador = resultObj.numero_ganador.trim().toLowerCase();
              const isWinner = cleanJugado === cleanGanador;

              if (isWinner) {
                return (
                  <div className="my-3 p-4 bg-emerald-50 border-2 border-emerald-500 rounded-xl text-center animate-pulse">
                    <span className="text-[10px] font-sans font-bold text-emerald-700 uppercase block">RESULTADO DEL SORTEO: {cleanGanador}</span>
                    <span className="text-base font-display font-black text-emerald-900 uppercase tracking-widest block mt-0.5">🎉 ¡BOLETO PREMIADO!</span>
                    <div className="mt-2.5 pt-2 border-t border-emerald-200/60">
                      <span className="text-[9px] font-sans font-bold text-emerald-600 uppercase block">CANTIDAD A PAGAR AL CLIENTE (C$)</span>
                      <span className="text-lg font-mono font-black text-emerald-800">
                        C$ {potentialPrizeCs.toLocaleString("es-ES", { minimumFractionDigits: 2 })}
                      </span>
                      {ticket.moneda === "USD" && (
                        <span className="text-[9px] text-emerald-600 block mt-0.5 font-sans">
                          (Apuesta: USD {ticket.monto_pago.toFixed(2)} × tasa C$ {(config.tasa_cambio || 36.50).toFixed(2)})
                        </span>
                      )}
                    </div>
                  </div>
                );
              } else {
                return (
                  <div className="my-3 p-3 bg-red-50 border border-red-200 rounded-xl text-center">
                    <span className="text-[10px] font-sans font-bold text-red-700 uppercase block">RESULTADO DEL SORTEO: {cleanGanador}</span>
                    <span className="text-sm font-display font-black text-red-900 uppercase tracking-wider block mt-0.5">❌ NO PREMIADO</span>
                    <span className="text-[9px] text-red-600 block mt-1 leading-normal font-sans font-medium">Su número jugado no coincide con el número ganador.</span>
                  </div>
                );
              }
            })()}

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Digital Anti-Photoshop Signature */}
            <div className="text-center py-1 bg-gray-100 border border-gray-200 rounded">
              <div className="text-[8px] text-gray-500 tracking-wider font-sans uppercase font-bold">Firma Digital (Anti-Photoshop)</div>
              <div className="font-mono text-sm font-black text-gray-900 tracking-widest mt-0.5 select-all">
                {ticket.firma_digital}
              </div>
            </div>

            <div className="border-t border-dashed border-gray-300 my-2" />

            {/* Footer message */}
            <div className="text-center text-[10px] text-gray-500 font-sans leading-tight italic">
              {config.formato_ticket.mensaje_pie}
            </div>

            {/* Simulated Barcode & Real scannable QR Code */}
            <div className="mt-4 flex flex-col items-center border-t border-gray-150 pt-3 space-y-3">
              <div className="flex flex-col items-center w-full">
                <div className="h-7 w-4/5 bg-repeat-x bg-contain opacity-75" style={{ backgroundImage: "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"10\"><rect x=\"0\" width=\"2\" height=\"10\" fill=\"black\"/><rect x=\"3\" width=\"1\" height=\"10\" fill=\"black\"/><rect x=\"6\" width=\"3\" height=\"10\" fill=\"black\"/><rect x=\"11\" width=\"2\" height=\"10\" fill=\"black\"/><rect x=\"15\" width=\"1\" height=\"10\" fill=\"black\"/><rect x=\"18\" width=\"2\" height=\"10\" fill=\"black\"/></svg>')" }} />
                <span className="text-[8px] text-gray-400 mt-1 font-mono">TK-{ticket.id}</span>
              </div>
              
              <div className="flex flex-col items-center bg-gray-50 p-2 rounded-xl border border-gray-200">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${window.location.origin}/verificar?ticket=${ticket.numero_ticket}%26firma=${ticket.firma_digital}`}
                  alt="QR Verificación"
                  className="w-20 h-20 bg-white p-1 rounded-lg border border-gray-200 shadow-xs"
                  referrerPolicy="no-referrer"
                />
                <span className="text-[7px] text-gray-500 font-mono mt-1 uppercase tracking-wider">Verificación Digital QR</span>
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
            disabled={isBlocked}
            className={`flex items-center justify-center space-x-2 py-3 px-4 rounded-xl font-display font-bold text-xs uppercase tracking-wider transition-all text-center cursor-pointer shadow-sm border-b-2 ${
              isBlocked 
                ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed border-b-0" 
                : "bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 border-emerald-700"
            }`}
          >
            <Share2 className="w-4 h-4" />
            <span>{copied ? "¡Copiado!" : "WhatsApp"}</span>
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
