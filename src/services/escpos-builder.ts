import { Venta, Configuracion } from "../types";

export const ESCPOS = {
  INIT: [0x1B, 0x40],

  ALIGN_LEFT: [0x1B, 0x61, 0x00],
  ALIGN_CENTER: [0x1B, 0x61, 0x01],
  ALIGN_RIGHT: [0x1B, 0x61, 0x02],

  BOLD_ON: [0x1B, 0x45, 0x01],
  BOLD_OFF: [0x1B, 0x45, 0x00],

  DOUBLE_HEIGHT_ON: [0x1B, 0x21, 0x10],
  DOUBLE_WIDTH_ON: [0x1B, 0x21, 0x20],
  DOUBLE_BOTH_ON: [0x1B, 0x21, 0x30],
  CHAR_SIZE_NORMAL: [0x1B, 0x21, 0x00],

  FONT_B: [0x1B, 0x4D, 0x01],
  FONT_A: [0x1B, 0x4D, 0x00],

  LINE_FEED: [0x0A],
  FEED_N_LINES: [0x1B, 0x64, 0x03],
  FEED_3: [0x1B, 0x64, 0x03],
  FEED_5: [0x1B, 0x64, 0x05],

  CUT_PARTIAL: [0x1D, 0x56, 0x00],
  CUT_FULL: [0x1D, 0x56, 0x01],

  CODE_PAGE: [0x1B, 0x74, 0x02],

  H_LINE: [0x1B, 0x2D, 0x01],
  H_LINE_OFF: [0x1B, 0x2D, 0x00],
};

const CP850_MAP: Record<string, number> = {
  "á": 0xA0, "é": 0x82, "í": 0xA1, "ó": 0xA2, "ú": 0xA3,
  "ñ": 0xA4, "ü": 0x81, "Á": 0xB5, "É": 0x90, "Í": 0xD6,
  "Ó": 0xE0, "Ú": 0xE9, "Ñ": 0xA5, "Ü": 0x9A, "¡": 0xA8,
  "¿": 0xA8, "°": 0xF8, "º": 0xA7, "ª": 0x97, "Ç": 0x80,
  "ç": 0x87, "à": 0x85, "è": 0x8A, "ì": 0x8D, "ò": 0x95,
  "ù": 0x97, "À": 0xB7, "È": 0xD4, "Ì": 0xDE, "Ò": 0xE3,
  "Ù": 0xEB, "€": 0x63,
};

const encoder = (text: string): number[] => {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 128) {
      bytes.push(code);
    } else if (CP850_MAP[ch] !== undefined) {
      bytes.push(CP850_MAP[ch]);
    } else {
      bytes.push(0x3F);
    }
  }
  return bytes;
};

const formatTicketDate = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    const weekday = date.toLocaleDateString("es-ES", { weekday: "long" });
    const day = String(date.getDate()).padStart(2, "0");
    const month = date.toLocaleDateString("es-ES", { month: "long" }).toUpperCase();
    const year = date.getFullYear();
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${weekday} ${day} ${month} del ${year}, hora del registro del ticket: ${hours}:${minutes} ${ampm}`;
  } catch {
    return isoString;
  }
};

const justifyLine = (left: string, right: string, maxLen: number = 32): string => {
  const spaceNeeded = maxLen - left.length - right.length;
  if (spaceNeeded <= 0) {
    return left + " " + right;
  }
  return left + " ".repeat(spaceNeeded) + right;
};

const justify3Columns = (col1: string, col2: string, col3: string, maxLen: number = 32): string => {
  const c1 = col1.padEnd(6);
  const c3 = col3.padStart(12);
  const remainingSpace = maxLen - c1.length - c3.length;
  const c2Len = col2.length;
  const padLeft = Math.max(0, Math.floor((remainingSpace - c2Len) / 2));
  const padRight = Math.max(0, remainingSpace - c2Len - padLeft);
  const c2 = " ".repeat(padLeft) + col2 + " ".repeat(padRight);
  return c1 + c2 + c3;
};

const qrCode = (text: string): number[] => {
  const cmds: number[] = [];
  const dataBytes = encoder(text);
  const len = dataBytes.length + 3;
  const pL = len & 0xFF;
  const pH = (len >> 8) & 0xFF;

  // 1. Set model (Model 2)
  cmds.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
  // 2. Set module size (size 6)
  cmds.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x06);
  // 3. Set error correction level M (0x31)
  cmds.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31);
  // 4. Store data
  cmds.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
  cmds.push(...dataBytes);
  // 5. Print QR code
  cmds.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);

  return cmds;
};

const line = (text: string = "", align: "L" | "C" | "R" = "L", bold: boolean = false): number[] => {
  const cmds: number[] = [];
  if (align === "C") cmds.push(...ESCPOS.ALIGN_CENTER);
  else if (align === "R") cmds.push(...ESCPOS.ALIGN_RIGHT);
  else cmds.push(...ESCPOS.ALIGN_LEFT);
  if (bold) cmds.push(...ESCPOS.BOLD_ON);
  cmds.push(...encoder(text));
  if (bold) cmds.push(...ESCPOS.BOLD_OFF);
  cmds.push(...ESCPOS.LINE_FEED);
  return cmds;
};

const separator = (char: string = "-", length: number = 32): number[] => {
  return line(char.repeat(length), "C");
};

const doubleLine = (text: string, align: "L" | "C" | "R" = "C"): number[] => {
  const cmds: number[] = [];
  cmds.push(...ESCPOS.DOUBLE_BOTH_ON);
  cmds.push(...ESCPOS.ALIGN_CENTER);
  cmds.push(...encoder(text));
  cmds.push(...ESCPOS.CHAR_SIZE_NORMAL);
  cmds.push(...ESCPOS.LINE_FEED);
  return cmds;
};

const emptyLine = (): number[] => {
  return [...ESCPOS.LINE_FEED];
};

const cut = (): number[] => {
  return [...ESCPOS.FEED_5, ...ESCPOS.CUT_PARTIAL];
};

export interface TicketPrintData {
  negocio: string;
  ruc: string;
  direccion?: string;
  numero_ticket: string;
  fecha_completa: string;
  vendedor: string;
  cliente: string;
  juego: string;
  sorteo: string;
  moneda: string;
  jugadas: { numero: string; monto: number; premio_posible: number }[];
  total_apostado: number;
  total_premio: number;
  firma_digital: string;
  mensaje_pie: string;
  qr_url: string;
}

export function buildTicketBuffer(data: TicketPrintData): Uint8Array {
  const bytes: number[] = [];

  bytes.push(...ESCPOS.INIT);
  bytes.push(...ESCPOS.CODE_PAGE);
  bytes.push(...emptyLine());

  // Cabecera del negocio
  bytes.push(...doubleLine(data.negocio));
  bytes.push(...line(data.ruc, "C", true));
  if (data.direccion) bytes.push(...line(data.direccion, "C"));
  bytes.push(...separator("="));

  // Datos del ticket justificados
  bytes.push(...line(justifyLine("Nº TICKET:", `#${data.numero_ticket}`), "L", true));
  
  // Imprimir fecha en múltiples líneas justificadas si es necesario
  bytes.push(...line("FECHA:", "L", true));
  bytes.push(...line(data.fecha_completa, "L"));
  
  bytes.push(...line(justifyLine("VENDEDOR:", data.vendedor.toUpperCase()), "L", true));
  if (data.cliente) {
    bytes.push(...line(justifyLine("CLIENTE:", data.cliente.toUpperCase()), "L", true));
  }
  bytes.push(...separator("-"));

  // Juego y sorteo
  bytes.push(...line(data.juego.toUpperCase(), "C", true));
  bytes.push(...line(data.sorteo, "C", true));
  bytes.push(...separator("-"));

  // Encabezado de la tabla de jugadas
  bytes.push(...line(justify3Columns("NÚM.", "MONTO", "PREMIO"), "L", true));
  bytes.push(...separator("-"));

  // Lista de jugadas (3 columnas)
  if (data.jugadas.length > 0) {
    for (const j of data.jugadas) {
      const num = j.numero;
      const monto = `${data.moneda} ${j.monto.toFixed(2)}`;
      const premio = `C$ ${j.premio_posible.toFixed(0)}`;
      bytes.push(...line(justify3Columns(num, monto, premio), "L"));
    }
  } else {
    bytes.push(...line("(sin jugadas)", "C"));
  }

  bytes.push(...separator("-"));

  // Totales
  bytes.push(...line(justifyLine("TOTAL:", `${data.moneda} ${data.total_apostado.toFixed(2)}`), "L", true));
  bytes.push(...line(justifyLine("PREMIO POSIBLE:", `C$ ${data.total_premio.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`), "L", true));
  bytes.push(...separator("="));

  // Firma
  bytes.push(...line("FIRMA DIGITAL:", "C", true));
  bytes.push(...line(data.firma_digital, "C", true));
  bytes.push(...separator("-"));

  // Mensaje de pie
  bytes.push(...line(data.mensaje_pie, "C", true));
  bytes.push(...separator("="));
  bytes.push(...emptyLine());

  // Código QR nativo
  bytes.push(...ESCPOS.ALIGN_CENTER);
  bytes.push(...qrCode(data.qr_url));
  bytes.push(...line("Verificación Digital QR", "C", true));
  bytes.push(...emptyLine());

  bytes.push(...cut());

  return new Uint8Array(bytes);
}

export function ticketDataFromVenta(venta: Venta, config: Configuracion): TicketPrintData {
  const multiplier = (() => {
    const cleanJuego = venta.juego.trim();
    if (cleanJuego === "Premia2" && venta.sorteo.includes("(NI)")) {
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
  })();

  const montoInCs = venta.moneda === "USD"
    ? venta.monto_pago * (config.tasa_cambio || 36.50)
    : venta.monto_pago;
  const potentialPrizeCs = venta.premio_posible_cs ?? (montoInCs * multiplier);

  const jugadasFromVenta = venta.jugadas && venta.jugadas.length > 0
    ? venta.jugadas.map(j => ({
        numero: j.numero,
        monto: j.monto,
        premio_posible: j.premio_posible || 0
      }))
    : [{ numero: venta.numero_jugado || "?", monto: venta.monto_pago || 0, premio_posible: potentialPrizeCs }];

  const origin = typeof window !== "undefined" ? window.location.origin : "https://loteria-pro.web.app";
  const numTicket = venta.numero_ticket || venta.id.substring(0, 7).toUpperCase();

  return {
    negocio: config.formato_ticket?.titulo || "LA NUEVA ERA",
    ruc: config.formato_ticket?.ruc || "",
    numero_ticket: numTicket,
    fecha_completa: venta.timestamp_servidor
      ? formatTicketDate(venta.timestamp_servidor)
      : formatTicketDate(new Date().toISOString()),
    vendedor: venta.nombre_vendedor || "",
    cliente: venta.nombre_cliente || "Genérico",
    juego: venta.juego,
    sorteo: venta.sorteo,
    moneda: venta.moneda,
    jugadas: jugadasFromVenta,
    total_apostado: venta.monto_pago,
    total_premio: potentialPrizeCs,
    firma_digital: venta.firma_digital || "",
    mensaje_pie: config.formato_ticket?.mensaje_pie || "Gracias por su compra",
    qr_url: `${origin}/verificar?ticket=${numTicket}&firma=${venta.firma_digital || ""}`
  };
}
