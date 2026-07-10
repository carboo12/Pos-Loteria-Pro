export interface Usuario {
  id: string;
  nombre: string;
  usuario: string; // Nickname único de acceso al sistema
  rol: "vendedor" | "administrador" | "admin" | "supervisor";
  estado: "activo" | "inactivo"; // Estado activo ('activo' o 'inactivo')
  conexion: "online" | "offline"; // Estado de conexión
  activo: boolean; // Keep in sync with (estado === 'activo')
  region: "Nicaragua" | "Costa Rica" | "Honduras" | "El Salvador";
  email: string;
  id_supervisor?: string; // Links a vendedor to their supervisor
  vendedoresAsignados?: string[]; // Array of IDs of vendedores under their charge (for supervisor)
}

export interface FormatoTicket {
  titulo: string;
  ruc: string;
  mensaje_pie: string;
}

export interface Sorteo {
  id: string;
  juego: string;
  hora_sorteo: string; // "11:00", "15:00", "21:00"
  hora_cierre: string; // "10:55", "14:55", "20:55"
  nombre: string; // e.g. "Diaria 11:00 AM (NI)"
}

export interface SorteoResultado {
  id: string;
  id_sorteo: string;
  fecha: string; // YYYY-MM-DD
  numero_ganador: string;
  timestamp: string;
}

export interface LimiteNumero {
  id?: string;
  id_vendedor?: string; // Optional: specific seller limit (techo por vendedor). If empty, applies globally.
  vendedorId?: string;
  pais?: string;
  juego: string;
  sorteo?: string;
  hora?: string;
  hora_limite?: string;
  numero: string;
  numero_jugado?: string;
  max_monto: number; // in C$ (or general currency equivalent)
  montoMaximo?: number;
  techo_dinero?: number;
}

export interface CobroVendedor {
  id: string;
  id_vendedor: string;
  nombre_vendedor: string;
  id_supervisor: string;
  monto_cs: number;
  monto_usd: number;
  fecha: string; // YYYY-MM-DD
  timestamp: string;
  comentario?: string;
}

export interface Configuracion {
  tasa_cambio: number;
  contador_global_tickets: number;
  formato_ticket: FormatoTicket;
  sorteos: Sorteo[];
  limites_numeros: LimiteNumero[];
  resultados: SorteoResultado[];
  cobros: CobroVendedor[];
}

export interface Venta {
  id: string;
  numero_ticket: string; // e.g. "0001045"
  timestamp_servidor: string; // ISO String
  juego: string; // "Diaria", "Premia2", etc.
  sorteo: string; // Name of the draw
  numero_jugado: string;
  monto_pago: number;
  moneda: "C$" | "USD";
  id_vendedor: string;
  nombre_vendedor: string;
  firma_digital: string; // e.g. "A9X-2M"
  anulado: boolean;
}

export interface CierreCaja {
  id: string;
  id_vendedor: string;
  nombre_vendedor: string;
  fecha: string; // YYYY-MM-DD
  denominaciones: {
    cs: Record<string, number>; // "1000", "500", "200", "100", "50", "20", "10" -> count
    usd: Record<string, number>; // "100", "50", "20", "10", "5", "1" -> count
  };
  monto_entregado_cs: number;
  monto_entregado_usd: number;
  monto_sistema_cs: number;
  monto_sistema_usd: number;
  descuadre_cs: number;
  descuadre_usd: number;
  timestamp: string; // ISO String
  cobrado?: boolean; // True if supervisor or admin has collected this cash
}
