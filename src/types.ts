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

// Una jugada individual dentro de un ticket multi-número
export interface Jugada {
  numero: string;          // El número apostado
  monto: number;           // Monto apostado en la moneda del ticket
  premio_posible: number;  // Premio posible en C$ (ya convertido)
  fecha_venta?: string;    // YYYY-MM-DD — fecha del sorteo para el que se apuesta
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
  dias_habilitados?: number[]; // [0-6] 0=Dom,2=Mar. Undefined = todos los días
}

export interface SorteoResultado {
  id: string;
  id_sorteo: string;
  sorteo: string;   // Nombre legible del sorteo (ej. "Diaria 3:00 PM (NI)")
  pais: string;     // País del sorteo (ej. "Nicaragua")
  fecha: string;    // YYYY-MM-DD
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
  id_ticket?: string; // Sequential ticket ID (e.g. "000001") — primary lookup key
  numero_ticket: string; // e.g. "000001" — same as id_ticket for new tickets
  timestamp_servidor: string; // ISO String
  fecha_venta?: string; // YYYY-MM-DD — fecha del sorteo
  juego: string; // "Diaria", "Premia2", etc.
  sorteo: string; // Name of the draw
  numero_jugado: string; // Primera jugada (backward compat) o resumen
  monto_pago: number;    // Monto total del ticket
  moneda: "C$" | "USD";
  id_vendedor: string;
  nombre_vendedor: string;
  nombre_cliente?: string;
  premio_posible_cs?: number; // Premio total del ticket en C$
  firma_digital: string; // e.g. "A9X-2M"
  anulado: boolean;
  estado?: 'pendiente' | 'pagado' | 'anulado' | 'perdedor';
  jugadas?: Jugada[]; // Lista de jugadas individuales (multi-número)
  es_premiado?: boolean;   // Marcado por escrutinio server-side
  monto_premio?: number;   // Monto del premio en C$ calculado por escrutinio
  [key: string]: any; // Firma de índice para compatibilidad con funciones que reciben objetos flexibles
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

export interface ResumenDiario {
  id: string;                    // Formato: "{id_vendedor}_{YYYY-MM-DD}"
  id_vendedor: string;
  nombre_vendedor: string;
  fecha: string;                 // Formato: "YYYY-MM-DD"
  
  // Acumulados monetarios del día
  vendido: number;               // Suma de ventas no anuladas del día en C$
  pagado: number;                // Suma de premios pagados en el día en C$
  
  // Control de Balance y Cobro
  cierre: 'pendiente' | 'pagado';
  egreso: number;                // Monto neto retirado (vendido - pagado) tras el cobro. 0 si está pendiente.
  
  // Metadatos de auditoría
  id_cobro?: string;             // ID del documento CobroAdmin que cerró este día
  timestamp_cobro?: string;      // Timestamp ISO
  procesado_por?: string;        // ID del Administrador que cobró
  
  timestamp_creacion: string;
  timestamp_actualizacion: string;
}

export interface CobroAdmin {
  id: string;                    // Formato: "cobro_{timestamp}"
  id_admin: string;
  nombre_admin: string;
  id_vendedor: string;
  nombre_vendedor: string;
  rango_inicio: string;          // "YYYY-MM-DD"
  rango_fin: string;             // "YYYY-MM-DD"
  
  // Totales consolidados del corte
  total_vendido: number;         // Suma de vendidos de los días cerrados
  total_pagado: number;          // Suma de premios pagados de los días cerrados
  total_neto: number;            // total_vendido - total_pagado
  
  dias_cerrados: string[];       // Array de IDs de resumen_diario incluidos (para auditoría)
  estado?: 'activo' | 'anulado';
  timestamp: string;
}

export interface PagoComision {
  id: string;                    // Formato: "pago_{timestamp}"
  id_admin: string;
  id_vendedor: string;
  nombre_vendedor: string;
  monto_pago: number;            // Comisión entregada al vendedor
  concepto: string;              // Descripción del pago
  id_cobro_relacionado?: string; // ID del CobroAdmin asociado
  estado?: 'activo' | 'anulado';
  timestamp: string;
}
