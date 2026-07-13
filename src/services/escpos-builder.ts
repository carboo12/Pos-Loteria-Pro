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

const keyValue = (key: string, value: string, align: "L" | "C" | "R" = "L", bold: boolean = false): number[] => {
  const cmds: number[] = [];
  cmds.push(...ESCPOS.ALIGN_LEFT);
  if (bold) cmds.push(...ESCPOS.BOLD_ON);
  cmds.push(...encoder(`${key}: ${value}`));
  if (bold) cmds.push(...ESCPOS.BOLD_OFF);
  cmds.push(...ESCPOS.LINE_FEED);
  return cmds;
};

export interface TicketPrintData {
  negocio: string;
  ruc: string;
  direccion?: string;
  numero_ticket: string;
  fecha: string;
  hora: string;
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
}

export function buildTicketBuffer(data: TicketPrintData): Uint8Array {
  const bytes: number[] = [];

  bytes.push(...ESCPOS.INIT);
  bytes.push(...ESCPOS.CODE_PAGE);
  bytes.push(...emptyLine());

  bytes.push(...doubleLine(data.negocio));
  bytes.push(...line(`RUC: ${data.ruc}`, "C"));
  if (data.direccion) bytes.push(...line(data.direccion, "C"));
  bytes.push(...separator("="));
  bytes.push(...emptyLine());

  bytes.push(...keyValue("Ticket", data.numero_ticket, "C", true));
  bytes.push(...emptyLine());

  bytes.push(...keyValue("Fecha", data.fecha));
  bytes.push(...keyValue("Hora", data.hora));
  bytes.push(...keyValue("Vendedor", data.vendedor));
  bytes.push(...keyValue("Cliente", data.cliente));
  bytes.push(...separator("-"));
  bytes.push(...keyValue("Juego", data.juego));
  bytes.push(...keyValue("Sorteo", data.sorteo));
  bytes.push(...separator("-"));
  bytes.push(...emptyLine());

  bytes.push(...line("JUGADA(S)", "C", true));
  bytes.push(...separator("-"));

  for (const j of data.jugadas) {
    bytes.push(...line(`${j.numero.padEnd(12)} ${data.moneda} ${j.monto.toFixed(2).padStart(8)}`, "L"));
  }

  bytes.push(...separator("-"));
  bytes.push(...emptyLine());
  bytes.push(...keyValue("Total Apostado", `${data.moneda} ${data.total_apostado.toFixed(2)}`, "L", true));
  bytes.push(...keyValue("Premio Posible", `C$ ${data.total_premio.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "L", true));
  bytes.push(...emptyLine());
  bytes.push(...separator("="));
  bytes.push(...emptyLine());

  bytes.push(...line(`Firma: ${data.firma_digital}`, "C"));
  bytes.push(...emptyLine());

  bytes.push(...line(data.mensaje_pie, "C"));
  bytes.push(...separator("="));
  bytes.push(...emptyLine());

  bytes.push(...cut());

  return new Uint8Array(bytes);
}

export function ticketDataFromVenta(venta: Venta, config: Configuracion): TicketPrintData {
  return {
    negocio: config.formato_ticket?.titulo || "LA NUEVA ERA",
    ruc: config.formato_ticket?.ruc || "",
    numero_ticket: venta.numero_ticket || venta.id.substring(0, 7).toUpperCase(),
    fecha: venta.timestamp_servidor
      ? new Date(venta.timestamp_servidor).toLocaleDateString("es-ES")
      : new Date().toLocaleDateString("es-ES"),
    hora: venta.timestamp_servidor
      ? new Date(venta.timestamp_servidor).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
      : new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
    vendedor: venta.nombre_vendedor || "",
    cliente: venta.nombre_cliente || "Genérico",
    juego: venta.juego,
    sorteo: venta.sorteo,
    moneda: venta.moneda,
    jugadas: venta.jugadas?.map(j => ({
      numero: j.numero,
      monto: j.monto,
      premio_posible: j.premio_posible || 0
    })) || [{ numero: venta.numero_jugado, monto: venta.monto_pago, premio_posible: venta.premio_posible_cs || 0 }],
    total_apostado: venta.monto_pago,
    total_premio: venta.premio_posible_cs || 0,
    firma_digital: venta.firma_digital || "",
    mensaje_pie: config.formato_ticket?.mensaje_pie || "Gracias por su compra"
  };
}
