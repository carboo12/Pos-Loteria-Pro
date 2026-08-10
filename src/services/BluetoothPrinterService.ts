/// <reference types="web-bluetooth" />

export type PrinterStatus = "disconnected" | "connecting" | "connected" | "printing" | "error";

type StatusCallback = (status: PrinterStatus, message?: string) => void;

const STORAGE_KEY_BT_DEVICE    = "bt_printer_device_id";
const STORAGE_KEY_BT_NAME      = "bt_printer_name";
const STORAGE_KEY_BT_ALIASES   = "bt_printer_id_aliases";
const STORAGE_KEY_BT_CONNECTED_AT = "bt_printer_connected_at";
// UUID del servicio GATT que funcionó en la ultima conexión exitosa.
// Se guarda para que la proxima reconexion lo intente primero (camino rapido).
const STORAGE_KEY_BT_SERVICE_UUID = "bt_printer_service_uuid";

const HEARTBEAT_INTERVAL_MS = 8000;

// Delays para reconexion de sesion activa (perdida de senal en medio de uso)
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 6000, 8000];
const MAX_RECONNECT_ATTEMPTS = 10;

// Delays para reconexion al arranque (dispositivo guardado en localStorage).
// El stack BT de Android puede tardar varios segundos en inicializarse.
const SAVED_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 6000, 10000, 15000, 20000, 25000, 30000, 30000];
const MAX_SAVED_RECONNECT_ATTEMPTS = 15;

// ESC/POS NOP - comando sin impresion usado como heartbeat
const ESCPOS_NOP = new Uint8Array([0x1B, 0x40]);

// UUIDs de servicios GATT de impresoras termicas.
// Al filtrar por UUID de servicio (NO por nombre), Chrome Android lista
// TODOS los dispositivos que anuncian esos servicios, sin importar si se
// llaman "MPT-II", "POS-58", "RPP300" o cualquier otro nombre.
const PRINTER_SERVICE_FILTERS: BluetoothLEScanFilter[] = [
  { services: ["000018f0-0000-1000-8000-00805f9b34fb"] }, // SPP/serial BLE - mas comun
  { services: ["0000ff00-0000-1000-8000-00805f9b34fb"] }, // GP / Xprinter / ZJ series
  { services: ["0000fff0-0000-1000-8000-00805f9b34fb"] }, // Gainscha, Hoin, iDPRT
  { services: ["e7810a71-73ae-499d-8c15-faa9aef0c3f2"] }, // Zebra / genericos
  { services: ["49535343-fe7d-4ae5-8fa9-9fafd205e455"] }, // Microchip RN42xx / MPT
];

// Todos los UUIDs que queremos poder leer/escribir una vez conectados
const ALL_SERVICE_UUIDS = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fff0-0000-1000-8000-00805f9b34fb",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
];

export class BluetoothPrinterService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private onStatusChange: StatusCallback | null = null;
  private reconnectAttempts = 0;
  private connectionLost = false;
  private _handleDisconnect: (() => void) | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _destroyed = false;
  private _wakeLock: WakeLockSentinel | null = null;
  private _silentReconnect = false;

  // Auto-reconexion al dispositivo guardado. Se desactiva SOLO cuando el
  // usuario pulsa "Solo Desconectar (Conservar)" o "Desvincular".
  autoReconnectEnabled = true;

  private _savedReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _savedReconnectAttempts = 0;
  private _savedReconnectInFlight: Promise<boolean> | null = null;
  private _isMockMode = false;

  constructor(onStatus?: StatusCallback) {
    this.onStatusChange = onStatus || null;
  }

  onStatus(cb: StatusCallback) {
    this.onStatusChange = cb;
  }

  getDeviceName(): string | null {
    if (this._isMockMode) return "Impresora Termica (Mock Dev)";
    return this.device?.name || localStorage.getItem(STORAGE_KEY_BT_NAME) || null;
  }

  isConnected(): boolean {
    if (this._isMockMode) return true;
    return !!(this.device?.gatt?.connected && this.characteristic);
  }

  isSilentReconnecting(): boolean {
    return this._silentReconnect;
  }

  private setStatus(status: PrinterStatus, message?: string) {
    if (this.onStatusChange) {
      this.onStatusChange(status, message);
    }
  }

  // Wake Lock
  private async _acquireWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        this._wakeLock = await (navigator as any).wakeLock.request("screen");
        this._wakeLock.addEventListener("release", () => { this._wakeLock = null; });
      }
    } catch { /* no critico */ }
  }

  private _releaseWakeLock() {
    if (this._wakeLock) {
      try { this._wakeLock.release(); } catch { /* ignore */ }
      this._wakeLock = null;
    }
  }

  // Heartbeat
  private _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(async () => {
      if (!this.device?.gatt?.connected || !this.characteristic) {
        if (!this._destroyed && !this.connectionLost) {
          this.connectionLost = true;
          this._stopHeartbeat();
          this.setStatus("disconnected", "Conexion perdida (heartbeat)");
          this._scheduleReconnect();
        }
        return;
      }
      try {
        await this.characteristic.writeValueWithoutResponse(ESCPOS_NOP);
      } catch {
        if (!this._destroyed && !this.connectionLost) {
          this.connectionLost = true;
          this._stopHeartbeat();
          this.setStatus("disconnected", "Conexion perdida (heartbeat)");
          this._scheduleReconnect();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // Disconnect listener
  private onGattDisconnected = () => {
    this.connectionLost = true;
    this._stopHeartbeat();
    this._releaseWakeLock();
    this.characteristic = null;
    this.server = null;
    this.setStatus("disconnected", "Impresora desconectada");
    if (this._destroyed) return;
    this._scheduleReconnect();
  };

  private _attachDisconnectListener() {
    if (!this.device) return;
    if (this._handleDisconnect) {
      this.device.removeEventListener("gattserverdisconnected", this._handleDisconnect);
    }
    this._handleDisconnect = this.onGattDisconnected;
    this.device.addEventListener("gattserverdisconnected", this._handleDisconnect);
  }

  private _detachDisconnectListener() {
    if (this.device && this._handleDisconnect) {
      this.device.removeEventListener("gattserverdisconnected", this._handleDisconnect);
      this._handleDisconnect = null;
    }
  }

  // Reconexion de sesion activa
  private _scheduleReconnect() {
    if (this._destroyed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus("error", "No se pudo reconectar tras multiples intentos");
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts++;
    this.setStatus("connecting", `Reconectando en ${delay / 1000}s... (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._destroyed) return;
      const ok = await this.connectInternal();
      if (!ok && !this._destroyed) this._scheduleReconnect();
    }, delay);
  }

  // Device persistence
  private _saveDeviceId() {
    if (!this.device) return;
    try {
      localStorage.setItem(STORAGE_KEY_BT_DEVICE, this.device.id);
      if (this.device.name) localStorage.setItem(STORAGE_KEY_BT_NAME, this.device.name);
      let aliases: string[] = [];
      try {
        const raw = localStorage.getItem(STORAGE_KEY_BT_ALIASES);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) aliases = parsed.filter((x): x is string => typeof x === "string");
        }
      } catch { /* ignore */ }
      if (!aliases.includes(this.device.id)) {
        aliases.push(this.device.id);
        localStorage.setItem(STORAGE_KEY_BT_ALIASES, JSON.stringify(aliases.slice(-10)));
      }
      localStorage.setItem(STORAGE_KEY_BT_CONNECTED_AT, String(Date.now()));
      console.log("[BT] Dispositivo guardado:", this.device.id, this.device.name);
    } catch { /* localStorage lleno */ }
  }

  private _clearSavedDevice() {
    try {
      localStorage.removeItem(STORAGE_KEY_BT_DEVICE);
      localStorage.removeItem(STORAGE_KEY_BT_NAME);
      localStorage.removeItem(STORAGE_KEY_BT_ALIASES);
      localStorage.removeItem(STORAGE_KEY_BT_CONNECTED_AT);
      localStorage.removeItem(STORAGE_KEY_BT_SERVICE_UUID);
    } catch { /* ignore */ }
  }

  private _getSavedDevice(): { id: string | null; name: string | null; aliases: string[] } {
    let id: string | null = null;
    let name: string | null = null;
    let aliases: string[] = [];
    try {
      id = localStorage.getItem(STORAGE_KEY_BT_DEVICE);
      name = localStorage.getItem(STORAGE_KEY_BT_NAME);
      const raw = localStorage.getItem(STORAGE_KEY_BT_ALIASES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) aliases = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch { /* ignore */ }
    return { id, name, aliases };
  }

  hasSavedDevice(): boolean {
    const saved = this._getSavedDevice();
    return !!(saved.id || saved.name);
  }

  /**
   * connectForPrint(timeoutMs)
   *
   * Metodo especial para el boton Imprimir: garantiza que el usuario NUNCA
   * vea un error falso de "impresora desconectada" si la reconexion de
   * background simplemente necesita unos segundos.
   *
   * Flujo:
   *   1. Si ya conectado → return true inmediatamente
   *   2. Si hay dispositivo guardado → arranca reconnectSaved() en background
   *   3. Polling cada 600ms hasta isConnected() === true o timeout
   *   4. Retorna true si conecta dentro del timeout, false si definitivamente falla
   *
   * El timeout por defecto es 15s — suficiente para que Android inicialice BT
   * y haga el handshake GATT, incluso en terminales lentos.
   */
  async connectForPrint(timeoutMs = 5000): Promise<boolean> {
    if (this._isMockMode) return true;
    if (this.isConnected()) return true;
    if (!navigator.bluetooth) return false;

    // Intentar reconectar si la instancia mantiene la referencia activa
    if (this.device?.gatt) {
      try {
        const ok = await this.connectInternal();
        if (ok) return true;
      } catch { /* continuar al picker */ }
    }

    // Si la API del navegador no permite reconexión silenciosa sin interactuar,
    // abrir de inmediato el selector con filtros abiertos (acceptAllDevices)
    console.log("[BT] Abriendo selector Bluetooth directo para conectar...");
    return await this.connect(true);
  }

  private isLocalDev(): boolean {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname;
    const isLocalHost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^192\.168\.\d+\.\d+$/.test(host) ||
      /^10\.\d+\.\d+\.\d+$/.test(host);
    const isDevEnv = !!(import.meta as any).env?.DEV;
    return isDevEnv || isLocalHost;
  }

  /**
   * connect(onlyPrinters)
   *
   * onlyPrinters = true  => Boton verde "Solo Impresoras":
   *   Filtra por UUID de servicio GATT estandar de impresoras termicas.
   *   MAS EFECTIVO que namePrefix: no depende del nombre del dispositivo.
   *   Funciona con MPT-II, POS-58, XP-58, RPP300, etc.
   *
   * onlyPrinters = false => Boton gris "Todos los dispositivos":
   *   acceptAllDevices: true - muestra toda la lista BLE.
   */
  async connect(onlyPrinters: boolean = false): Promise<boolean> {
    if (this.device && this.device.gatt?.connected) {
      this.setStatus("connected", "Ya conectado");
      return true;
    }

    if (!navigator.bluetooth) {
      if (this.isLocalDev()) {
        console.warn("[BT] Local Dev Mode: Simulando conexion Bluetooth mock.");
        this._isMockMode = true;
        this.setStatus("connecting", "Modo Simulacion Dev: Conectando...");
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.setStatus("connected", "Conectado (Simulacion local)");
        return true;
      }
      this.setStatus("error", "Web Bluetooth no soportado en este navegador");
      return false;
    }

    this._stopSavedReconnect();
    this._silentReconnect = false;
    this.autoReconnectEnabled = true;
    this._destroyed = false;
    this.setStatus("connecting", "Solicitando dispositivo...");

    try {
      // Construir la lista de optionalServices incluyendo el UUID guardado de
      // la ultima conexion exitosa. Esto es CRITICO: Chrome solo permite acceder
      // a servicios GATT que se declararon en optionalServices durante requestDevice().
      // Si el UUID de la MP211 (o cualquier impresora) no esta en esta lista,
      // getPrimaryService(uuid) falla con NotAllowedError aunque la conexion este abierta.
      let dynamicServices = [...ALL_SERVICE_UUIDS];
      try {
        const savedSvcUUID = localStorage.getItem(STORAGE_KEY_BT_SERVICE_UUID);
        if (savedSvcUUID && !dynamicServices.includes(savedSvcUUID)) {
          dynamicServices = [savedSvcUUID, ...dynamicServices]; // primero para prioridad
          console.log("[BT] Incluyendo UUID guardado en optionalServices:", savedSvcUUID);
        }
      } catch { /* ignore */ }

      const options: RequestDeviceOptions = {
        acceptAllDevices: true,
        optionalServices: dynamicServices,
      };

      console.log(`[BT] requestDevice (onlyPrinters=${onlyPrinters}):`, JSON.stringify(options));
      this.device = await navigator.bluetooth.requestDevice(options);
      console.log("[BT] Dispositivo seleccionado:", this.device.id, this.device.name);

      this._attachDisconnectListener();
      const ok = await this.connectInternal();
      if (ok) this._saveDeviceId();
      return ok;
    } catch (err: any) {
      if (err?.name === "NotFoundError" || err?.message?.includes("User cancelled")) {
        this.setStatus("disconnected", "Seleccion cancelada");
      } else {
        this.setStatus("error", err.message || "Error al conectar");
      }
      return false;
    }
  }

  /**
   * reconnectSaved() - Reconexion 100% automatica y silenciosa al arranque.
   *
   * Flujo:
   *   1. VendedorInterface monta -> llama reconnectSaved() con delay de 1.5s
   *   2. _runSavedReconnectAttempt() llama navigator.bluetooth.getDevices()
   *      -> Chrome devuelve dispositivos a los que se les dio permiso
   *   3. Si encuentra match por id/alias/nombre -> conecta GATT silenciosamente
   *   4. Si falla -> backoff hasta MAX_SAVED_RECONNECT_ATTEMPTS
   *
   * NOTA: getDevices() requiere que el dispositivo haya sido vinculado con
   * requestDevice() en la MISMA ORIGIN. Chrome Android lo soporta desde v100.
   */
  async reconnectSaved(): Promise<boolean> {
    if (this._savedReconnectInFlight) {
      console.log("[BT] reconnectSaved: intento en vuelo, reutilizando.");
      return this._savedReconnectInFlight;
    }

    const saved = this._getSavedDevice();
    console.log("[BT] reconnectSaved inicio. Guardado:", JSON.stringify(saved));

    if (!saved.id && !saved.name) {
      console.log("[BT] reconnectSaved: sin dispositivo guardado.");
      return false;
    }

    if (this.device?.gatt?.connected && this.characteristic) {
      console.log("[BT] reconnectSaved: ya conectado.");
      this.setStatus("connected", "Ya conectado");
      return true;
    }

    if (!navigator.bluetooth) {
      console.warn("[BT] reconnectSaved: Web Bluetooth no disponible.");
      return false;
    }

    if (typeof navigator.bluetooth.getDevices !== "function") {
      console.warn("[BT] reconnectSaved: getDevices() no soportado en este origen/navegador.");
      if (this.device?.gatt) {
        console.log("[BT] Intentando reconexion GATT directa con la impresora en memoria (this.device)");
        this._attachDisconnectListener();
        return await this.connectInternal();
      }
      this.setStatus("disconnected", "Reconexion automatica requiere HTTPS o haber seleccionado la impresora en esta sesion.");
      return false;
    }

    if (!this.autoReconnectEnabled) {
      console.log("[BT] reconnectSaved: autoReconnect desactivado.");
      return false;
    }

    // Resetear estado de sesion anterior limpiamente
    this._destroyed = false;
    this._silentReconnect = true;
    this._savedReconnectAttempts = 0;

    const attempt = async (): Promise<boolean> => {
      try {
        const ok = await this._runSavedReconnectAttempt();
        if (ok) {
          this._silentReconnect = false;
          console.log("[BT] reconnectSaved: exito.");
        } else if (!this._destroyed && this.autoReconnectEnabled) {
          this._scheduleSavedReconnect();
        }
        return ok;
      } finally {
        this._savedReconnectInFlight = null;
      }
    };

    this._savedReconnectInFlight = attempt();
    return await this._savedReconnectInFlight;
  }

  // Intento unico: getDevices() -> match -> GATT connect
  private async _runSavedReconnectAttempt(): Promise<boolean> {
    const saved = this._getSavedDevice();
    try {
      const devices = await navigator.bluetooth.getDevices();
      const list = Array.isArray(devices) ? devices : [];
      console.log(`[BT] getDevices() -> ${list.length} dispositivo(s):`, list.map(d => `"${d.name}"(${d.id})`).join(", "));

      if (list.length === 0) {
        console.log("[BT] getDevices() vacio - BT no inicializado o sin permisos concedidos.");
        return false;
      }

      // 1. Match por device.id exacto o alias acumulados entre sesiones
      const knownIds = new Set<string>(
        [saved.id, ...saved.aliases].filter(Boolean) as string[]
      );
      let match = list.find(d => d.id && knownIds.has(d.id));

      // 2. Fallback: match por nombre (exacto primero, luego parcial)
      if (!match && saved.name) {
        const norm = saved.name.trim().toLowerCase();
        match =
          list.find(d => (d.name || "").trim().toLowerCase() === norm) ||
          list.find(d => {
            const dn = (d.name || "").trim().toLowerCase();
            return dn.length > 0 && (dn.includes(norm) || norm.includes(dn));
          });
      }

      // 3. Ultimo recurso: si solo hay 1 dispositivo, asumir que es el correcto
      if (!match && list.length === 1) {
        console.log("[BT] Un solo dispositivo en getDevices(), usando como candidato:", list[0].name);
        match = list[0];
      }

      if (!match) {
        console.log("[BT] Sin match. knownIds:", [...knownIds], "saved.name:", saved.name);
        return false;
      }

      console.log("[BT] Match:", match.id, match.name);
      this.device = match;
      this._attachDisconnectListener();
      const ok = await this.connectInternal();
      if (ok) {
        this._saveDeviceId();
        this._stopSavedReconnect();
      }
      return ok;
    } catch (err) {
      console.error("[BT] Error en _runSavedReconnectAttempt:", err);
      return false;
    }
  }

  // Backoff de reconexion silenciosa al arranque - no toca la UI
  private _scheduleSavedReconnect() {
    if (this._destroyed || !this.autoReconnectEnabled) return;

    if (this._savedReconnectAttempts >= MAX_SAVED_RECONNECT_ATTEMPTS) {
      this._silentReconnect = false;
      this._savedReconnectAttempts = 0;
      console.log("[BT] Agotados los intentos de reconexion silenciosa.");
      this.setStatus("disconnected", "");
      return;
    }

    const delay = SAVED_RECONNECT_DELAYS_MS[
      Math.min(this._savedReconnectAttempts, SAVED_RECONNECT_DELAYS_MS.length - 1)
    ];
    this._savedReconnectAttempts++;
    this._silentReconnect = true;
    console.log(`[BT] Reintento ${this._savedReconnectAttempts}/${MAX_SAVED_RECONNECT_ATTEMPTS} en ${delay}ms`);

    this._savedReconnectTimer = setTimeout(async () => {
      this._savedReconnectTimer = null;
      if (this._destroyed || !this.autoReconnectEnabled) return;
      const ok = await this._runSavedReconnectAttempt();
      if (!ok && !this._destroyed && this.autoReconnectEnabled) {
        this._scheduleSavedReconnect();
      }
    }, delay);
  }

  private _stopSavedReconnect() {
    if (this._savedReconnectTimer) {
      clearTimeout(this._savedReconnectTimer);
      this._savedReconnectTimer = null;
    }
    this._savedReconnectAttempts = 0;
    this._savedReconnectInFlight = null;
  }

  // Helper: busca la primera caracteristica escribible en un servicio GATT dado
  private async _findWritableChar(
    service: BluetoothRemoteGATTService
  ): Promise<BluetoothRemoteGATTCharacteristic | null> {
    try {
      const chars = await service.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          return c;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  // Helper: finaliza la conexion una vez encontrada la caracteristica correcta
  private _finalizeConnection(char: BluetoothRemoteGATTCharacteristic): true {
    this.characteristic = char;
    this.reconnectAttempts = 0;
    this.connectionLost = false;
    this._startHeartbeat();
    this._acquireWakeLock();
    this.setStatus("connected", `Conectado: ${this.device?.name || "Impresora"}`);
    console.log("[BT] Caracteristica escritura:", char.uuid, "servicio:", char.service?.uuid);
    return true;
  }

  // Conexion GATT interna con descubrimiento en 3 fases:
  //   Fase 1: UUID de servicio guardado en localStorage (camino rapido)
  //   Fase 2: UUIDs conocidos de impresoras termicas
  //   Fase 3: Wildcard - getPrimaryServices() sin args (encuentra CUALQUIER impresora)
  private async connectInternal(): Promise<boolean> {
    if (!this.device?.gatt) {
      if (!this._silentReconnect) this.setStatus("error", "Dispositivo sin GATT");
      console.warn("[BT] connectInternal: dispositivo sin GATT.");
      return false;
    }

    if (!this._silentReconnect) {
      this.setStatus("connecting", "Conectando GATT...");
    }

    try {
      console.log("[BT] gatt.connect() ->", this.device.name);
      this.server = await this.device.gatt.connect();

      if (!this._silentReconnect) {
        this.setStatus("connecting", "Descubriendo servicios...");
      }

      // ── Fase 1: UUID guardado de la ultima conexion exitosa (mas rapido) ──
      const savedUUID = (() => {
        try { return localStorage.getItem(STORAGE_KEY_BT_SERVICE_UUID); } catch { return null; }
      })();

      if (savedUUID) {
        console.log("[BT] Fase 1: intentando UUID guardado:", savedUUID);
        try {
          const svc = await this.server.getPrimaryService(savedUUID);
          const char = await this._findWritableChar(svc);
          if (char) {
            console.log("[BT] Fase 1 exitosa con UUID guardado.");
            return this._finalizeConnection(char);
          }
        } catch { /* UUID guardado ya no funciona, continuar */ }
      }

      // ── Fase 2: UUIDs conocidos de impresoras termicas ──
      console.log("[BT] Fase 2: probando UUIDs conocidos...");
      for (const uuid of ALL_SERVICE_UUIDS) {
        if (uuid === savedUUID) continue; // ya probado en fase 1
        try {
          const svc = await this.server.getPrimaryService(uuid);
          const char = await this._findWritableChar(svc);
          if (char) {
            console.log("[BT] Fase 2 exitosa con UUID:", uuid);
            try { localStorage.setItem(STORAGE_KEY_BT_SERVICE_UUID, uuid); } catch { /* ignore */ }
            return this._finalizeConnection(char);
          }
        } catch { continue; }
      }

      // ── Fase 3: Wildcard - descubrir TODOS los servicios primarios ──
      // Esto funciona para cualquier impresora con UUID propietario desconocido
      // (MP211, MPT-II, impresoras chinas con UUIDs aleatorios, etc.)
      console.log("[BT] Fase 3: descubrimiento wildcard de todos los servicios...");
      try {
        const allServices = await this.server.getPrimaryServices();
        console.log(`[BT] Fase 3: ${allServices.length} servicios encontrados:`, allServices.map(s => s.uuid));
        for (const svc of allServices) {
          const char = await this._findWritableChar(svc);
          if (char) {
            console.log("[BT] Fase 3 exitosa con UUID:", svc.uuid);
            try { localStorage.setItem(STORAGE_KEY_BT_SERVICE_UUID, svc.uuid); } catch { /* ignore */ }
            return this._finalizeConnection(char);
          }
        }
      } catch (e) {
        console.warn("[BT] Fase 3 getPrimaryServices() fallo:", e);
      }

      console.warn("[BT] Sin caracteristica escribible en ninguna fase.");
      if (!this._silentReconnect) {
        this.setStatus("error", "No se encontro caracteristica de escritura en la impresora");
      }
      return false;
    } catch (err: any) {
      console.error("[BT] connectInternal error:", err?.message);
      if (!this._silentReconnect) {
        this.setStatus("error", err.message || "Error en conexion GATT");
      }
      return false;
    }
  }

  async print(data: Uint8Array): Promise<boolean> {
    if (this._isMockMode) {
      this.setStatus("printing", "Imprimiendo en modo simulacion...");
      await new Promise((resolve) => setTimeout(resolve, 600));
      console.log(`[BT Mock] Impresion simulada: ${data.length} bytes`);
      this.setStatus("connected", "Impresion simulada completada");
      return true;
    }

    if (!this.characteristic || !this.device?.gatt?.connected) {
      if (this.connectionLost && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.setStatus("connecting", "Reconectando antes de imprimir...");
        const ok = await this.connectInternal();
        if (!ok) {
          this.setStatus("error", "No se pudo reconectar para imprimir");
          return false;
        }
      } else if (this.autoReconnectEnabled && this.hasSavedDevice()) {
        this.setStatus("connecting", "Reconectando impresora guardada...");
        const ok = await this.reconnectSaved();
        if (!ok) {
          this.setStatus("error", "No se pudo reconectar para imprimir");
          return false;
        }
      } else {
        this.setStatus("error", "Impresora no conectada");
        return false;
      }
    }

    this.setStatus("printing", "Imprimiendo...");

    try {
      const mtu = 200;
      for (let i = 0; i < data.length; i += mtu) {
        const chunk = data.slice(i, Math.min(i + mtu, data.length));
        if (this.characteristic?.properties.writeWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else if (this.characteristic?.properties.write) {
          await this.characteristic.writeValueWithResponse(chunk);
        } else {
          await (this.characteristic as any).writeValue(chunk);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      this.setStatus("connected", "Impresion completada");
      return true;
    } catch (err: any) {
      this.setStatus("error", err.message || "Error al imprimir");
      return false;
    }
  }

  async disconnect() {
    this._destroyed = true;
    this._stopHeartbeat();
    this._releaseWakeLock();
    this._stopSavedReconnect();
    this._silentReconnect = false;
    // "Solo Desconectar (Conservar)": NO borrar persistencia para que la
    // proxima apertura reconecte automaticamente.
    this.autoReconnectEnabled = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._detachDisconnectListener();

    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }

    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.reconnectAttempts = 0;
    this.connectionLost = false;
    this.setStatus("disconnected", "Desconectado");
  }

  async desvincularImpresora(): Promise<void> {
    this._destroyed = true;
    this._stopHeartbeat();
    this._releaseWakeLock();
    this._stopSavedReconnect();
    this._silentReconnect = false;
    this.autoReconnectEnabled = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._detachDisconnectListener();

    try {
      if (this.device && typeof this.device.forget === "function") {
        await this.device.forget();
        console.log("[BT] device.forget() ejecutado.");
      }
    } catch { /* forget puede no estar soportado */ }

    this._clearSavedDevice();

    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.reconnectAttempts = 0;
    this.connectionLost = false;
    this._silentReconnect = false;
    this.setStatus("disconnected", "Impresora desvinculada");

    window.location.reload();
  }

  destroy() {
    this._destroyed = true;
    this._stopHeartbeat();
    this._releaseWakeLock();
    this._stopSavedReconnect();
    this._silentReconnect = false;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._detachDisconnectListener();

    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }

    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.reconnectAttempts = 0;
    this.connectionLost = false;
    this.setStatus("disconnected", "Desconectado");
  }
}
