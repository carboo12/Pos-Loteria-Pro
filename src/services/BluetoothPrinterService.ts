/// <reference types="web-bluetooth" />

export type PrinterStatus = "disconnected" | "connecting" | "connected" | "printing" | "error";

type StatusCallback = (status: PrinterStatus, message?: string) => void;

const STORAGE_KEY_BT_DEVICE = "bt_printer_device_id";
const STORAGE_KEY_BT_NAME = "bt_printer_name";
// Web Bluetooth NO expone dirección MAC por privacidad. `device.id` es el
// identificador más estable disponible, pero puede derivar entre sesiones en
// algunos navegadores. Guardamos un set de alias + el nombre para casar de
// forma tolerante y lograr "vincular una vez, reconectar para siempre".
const STORAGE_KEY_BT_ALIASES = "bt_printer_id_aliases";
const STORAGE_KEY_BT_CONNECTED_AT = "bt_printer_connected_at";
const HEARTBEAT_INTERVAL_MS = 8000;
// Delays para reconexión de sesión activa (pérdida de señal)
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 6000, 8000];
const MAX_RECONNECT_ATTEMPTS = 10;
// Delays para reconexión al arranque (dispositivo guardado en localStorage)
// Más agresivo al inicio (BT puede tardar en inicializarse), luego más espaciado
const SAVED_RECONNECT_DELAYS_MS = [800, 1500, 3000, 5000, 8000, 12000, 15000, 20000, 25000, 30000];
const MAX_SAVED_RECONNECT_ATTEMPTS = 15;

// ESC/POS NOP — non-printing command used as heartbeat
const ESCPOS_NOP = new Uint8Array([0x1B, 0x40]);

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
  // Auto-reconexión al dispositivo guardado. Se desactiva SOLO cuando el
  // usuario elige "Solo Desconectar (Conservar)" o "Desvincular".
  autoReconnectEnabled = true;
  private _savedReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _savedReconnectAttempts = 0;
  private _savedReconnectInFlight: Promise<boolean> | null = null;
  private _isMockMode = false;

  private static readonly SERVICE_UUIDS = [
    "000018f0-0000-1000-8000-00805f9b34fb",
    "0000ff00-0000-1000-8000-00805f9b34fb",
    "00001810-0000-1000-8000-00805f9b34fb"
  ];

  constructor(onStatus?: StatusCallback) {
    this.onStatusChange = onStatus || null;
  }

  onStatus(cb: StatusCallback) {
    this.onStatusChange = cb;
  }

  getDeviceName(): string | null {
    if (this._isMockMode) return "Impresora Térmica (Mock Dev)";
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

  // ─── Wake Lock ───────────────────────────────────────────────────────

  private async _acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this._wakeLock = await (navigator as any).wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => {
          this._wakeLock = null;
        });
      }
    } catch {
      // Wake Lock no soportado o denegado — no es crítico
    }
  }

  private _releaseWakeLock() {
    if (this._wakeLock) {
      try {
        this._wakeLock.release();
      } catch { /* ignore */ }
      this._wakeLock = null;
    }
  }

  // ─── Heartbeat ───────────────────────────────────────────────────────

  private _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(async () => {
      if (!this.device?.gatt?.connected || !this.characteristic) {
        // Conexión muerta entre heartbeats — disparar reconexión
        if (!this._destroyed && !this.connectionLost) {
          this.connectionLost = true;
          this._stopHeartbeat();
          this.setStatus("disconnected", "Conexión perdida (heartbeat)");
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
          this.setStatus("disconnected", "Conexión perdida (heartbeat)");
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

  // ─── Disconnect listener ─────────────────────────────────────────────

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

  // ─── Reconnect con lazo de reintentos ───────────────────────────────

  private _scheduleReconnect() {
    if (this._destroyed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus("error", "No se pudo reconectar tras múltiples intentos");
      return;
    }

    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts++;
    this.setStatus("connecting", `Reconectando en ${delay / 1000}s... (intento ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._destroyed) return;

      const ok = await this.connectInternal();
      if (!ok && !this._destroyed) {
        // Lazo: si falla, programa el siguiente intento con backoff
        this._scheduleReconnect();
      }
    }, delay);
  }

  // ─── Device persistence ──────────────────────────────────────────────

  private _saveDeviceId() {
    if (!this.device) return;
    try {
      localStorage.setItem(STORAGE_KEY_BT_DEVICE, this.device.id);
      if (this.device.name) {
        localStorage.setItem(STORAGE_KEY_BT_NAME, this.device.name);
      }
      // Acumular alias: tolera cambios de device.id entre sesiones
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
    } catch { /* localStorage full or blocked */ }
  }

  private _clearSavedDevice() {
    try {
      localStorage.removeItem(STORAGE_KEY_BT_DEVICE);
      localStorage.removeItem(STORAGE_KEY_BT_NAME);
      localStorage.removeItem(STORAGE_KEY_BT_ALIASES);
      localStorage.removeItem(STORAGE_KEY_BT_CONNECTED_AT);
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

  // ─── Public API ──────────────────────────────────────────────────────

  private isLocalDev(): boolean {
    if (typeof window === "undefined") return false;
    const host = window.location.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1" || /^192\.168\.\d+\.\d+$/.test(host) || /^10\.\d+\.\d+\.\d+$/.test(host);
    const isDevEnv = !!(import.meta as any).env?.DEV;
    return isDevEnv || isLocalHost;
  }

  async connect(onlyPrinters: boolean = false): Promise<boolean> {
    if (this.device && this.device.gatt?.connected) {
      this.setStatus("connected", "Ya conectado");
      return true;
    }

    if (!navigator.bluetooth) {
      if (this.isLocalDev()) {
        console.warn("[BluetoothPrinterService] Local Dev Mode: Simulando conexión Bluetooth mock en IP local/dev.");
        this._isMockMode = true;
        this.setStatus("connecting", "Modo Simulación Dev: Conectando...");
        await new Promise((resolve) => setTimeout(resolve, 500));
        this.setStatus("connected", "Conectado (Simulación local)");
        return true;
      }
      this.setStatus("error", "Web Bluetooth no soportado en este navegador");
      return false;
    }

    // El usuario elige dispositivo manualmente: habilitar auto-reconexión futura
    this._stopSavedReconnect();
    this._silentReconnect = false;
    this.autoReconnectEnabled = true;
    this._destroyed = false;
    this.setStatus("connecting", "Solicitando dispositivo...");

    try {
      const options: RequestDeviceOptions = onlyPrinters
        ? {
            filters: [
              // Genéricos
              { namePrefix: "Printer" },
              { namePrefix: "printer" },
              { namePrefix: "PRINTER" },
              { namePrefix: "Impresora" },
              { namePrefix: "impresora" },
              { namePrefix: "BT Printer" },
              { namePrefix: "Bluetooth Printer" },
              // Series numéricas populares
              { namePrefix: "PT" },
              { namePrefix: "POS" },
              { namePrefix: "pos" },
              // MTP / MPT (Milestone, iDPRT, etc.)
              { namePrefix: "MTP" },
              { namePrefix: "MPT" },
              { namePrefix: "MTP-II" },
              // XP / XPrinter
              { namePrefix: "XP" },
              { namePrefix: "XPrinter" },
              // RP (Rongta, SEWOO, etc.)
              { namePrefix: "RP" },
              { namePrefix: "RG" },
              // GP (GoDEX, POS)
              { namePrefix: "GP" },
              { namePrefix: "GR" },
              // RT / R series
              { namePrefix: "RT" },
              // Zjiang / ZJ
              { namePrefix: "Zjiang" },
              { namePrefix: "ZJ" },
              { namePrefix: "zj" },
              // Gainscha
              { namePrefix: "Gainscha" },
              { namePrefix: "GS" },
              // Epson (TM-series BT)
              { namePrefix: "Epson" },
              { namePrefix: "TM-" },
              // Bixolon
              { namePrefix: "Bixolon" },
              { namePrefix: "SPP" },
              // Star Micronics
              { namePrefix: "Star" },
              { namePrefix: "TSP" },
              { namePrefix: "mPOP" },
              // iDPRT
              { namePrefix: "iDPRT" },
              { namePrefix: "iD" },
              // Citizen
              { namePrefix: "CT-" },
              { namePrefix: "CMP" },
              // Sewoo
              { namePrefix: "LK" },
              { namePrefix: "SLK" },
              // Hoin / HOIN
              { namePrefix: "HOP" },
              { namePrefix: "HOIN" },
              // Códigos de serie comunes sin marca
              { namePrefix: "BTP" },
              { namePrefix: "IMP" },
              { namePrefix: "TP" }
            ],
            optionalServices: BluetoothPrinterService.SERVICE_UUIDS
          }
        : {
            acceptAllDevices: true,
            optionalServices: BluetoothPrinterService.SERVICE_UUIDS
          };

      this.device = await navigator.bluetooth.requestDevice(options);

      this._attachDisconnectListener();
      const ok = await this.connectInternal();
      if (ok) this._saveDeviceId();
      return ok;
    } catch (err: any) {
      this.setStatus("error", err.message || "Error al conectar");
      return false;
    }
  }

  async reconnectSaved(): Promise<boolean> {
    // Si ya hay un intento en vuelo, reutilizarlo (evita duplicar loops)
    if (this._savedReconnectInFlight) {
      return this._savedReconnectInFlight;
    }

    const saved = this._getSavedDevice();
    if (!saved.id && !saved.name) return false;

    if (this.device?.gatt?.connected && this.characteristic) {
      this.setStatus("connected", "Ya conectado");
      return true;
    }

    if (!navigator.bluetooth) {
      this.setStatus("error", "Web Bluetooth no soportado en este navegador");
      return false;
    }

    // Sin getDevices() es imposible reconectar sin gesto del usuario
    if (typeof navigator.bluetooth.getDevices !== "function") {
      this.setStatus("disconnected", "Reconexión automática no disponible en este navegador");
      return false;
    }

    if (!this.autoReconnectEnabled) return false;

    this._destroyed = false;
    this._silentReconnect = true;
    this._savedReconnectAttempts = 0;

    const attempt = async (): Promise<boolean> => {
      try {
        const ok = await this._runSavedReconnectAttempt();
        if (ok) {
          this._silentReconnect = false;
        } else if (!this._destroyed && this.autoReconnectEnabled) {
          // Falla transitoria (BT aún inicializándose, dispositivo apagado...):
          // reintentar con backoff en segundo plano.
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

  // Intento único: getDevices() + match por id/alias/nombre + conexión GATT
  private async _runSavedReconnectAttempt(): Promise<boolean> {
    const saved = this._getSavedDevice();
    try {
      const devices = await navigator.bluetooth.getDevices();
      const list = Array.isArray(devices) ? devices : [];

      // 1. Match por device.id o alias conocidos (tolera id derivado)
      const knownIds = new Set<string>([saved.id, ...saved.aliases].filter(Boolean) as string[]);
      let match = list.find(d => d.id && knownIds.has(d.id));

      // 2. Fallback: match por nombre (exacto → contiene)
      if (!match && saved.name) {
        const norm = saved.name.trim().toLowerCase();
        match = list.find(d => (d.name || "").trim().toLowerCase() === norm)
          || list.find(d => {
              const dn = (d.name || "").trim().toLowerCase();
              return dn.length > 0 && (dn.includes(norm) || norm.includes(dn));
            });
      }

      if (!match) {
        this.setStatus("disconnected", "Impresora guardada no disponible aún");
        return false;
      }

      this.device = match;
      this._attachDisconnectListener();
      const ok = await this.connectInternal();
      if (ok) {
        this._saveDeviceId(); // refresca id/alias si cambió
        this._stopSavedReconnect();
      }
      return ok;
    } catch {
      this.setStatus("disconnected", "Error al buscar impresora guardada");
      return false;
    }
  }

  // Lazo de reintentos con backoff para la reconexión al guardado (arranque)
  // Usa delays y límites propios (más tolerante que la reconexión por pérdida de señal)
  private _scheduleSavedReconnect() {
    if (this._destroyed || !this.autoReconnectEnabled) return;

    if (this._savedReconnectAttempts >= MAX_SAVED_RECONNECT_ATTEMPTS) {
      this._silentReconnect = false;
      this._savedReconnectAttempts = 0;
      // No emitir error — simplemente quedarse en disconnected; el usuario puede
      // pulsar manualmente el botón de conectar en cualquier momento.
      this.setStatus("disconnected", "");
      return;
    }

    const delay = SAVED_RECONNECT_DELAYS_MS[Math.min(this._savedReconnectAttempts, SAVED_RECONNECT_DELAYS_MS.length - 1)];
    this._savedReconnectAttempts++;
    // No tocar el status para que la UI no parpadee durante la reconexión silenciosa
    // Solo marcar silentReconnect = true (visible en isSilentReconnecting())
    this._silentReconnect = true;

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

  private async connectInternal(): Promise<boolean> {
    if (!this.device?.gatt) {
      if (!this._silentReconnect) this.setStatus("error", "Dispositivo sin GATT");
      return false;
    }

    // Durante reconexión silenciosa en segundo plano, no cambiar el status de la UI
    // para evitar parpadeos. El usuario verá "connected" cuando se logre la conexión.
    if (!this._silentReconnect) {
      this.setStatus("connecting", "Conectando GATT...");
    }

    try {
      this.server = await this.device.gatt.connect();
      if (!this._silentReconnect) {
        this.setStatus("connecting", "Descubriendo servicios...");
      }

      for (const uuid of BluetoothPrinterService.SERVICE_UUIDS) {
        try {
          const service = await this.server.getPrimaryService(uuid);
          const characteristics = await service.getCharacteristics();

          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              this.characteristic = char;
              this.reconnectAttempts = 0;
              this.connectionLost = false;
              this._startHeartbeat();
              this._acquireWakeLock();
              // Siempre emitir "connected" — tanto en silencioso como en manual
              this.setStatus("connected", `Conectado: ${this.device?.name || "PT-210"}`);
              return true;
            }
          }
        } catch {
          continue;
        }
      }

      if (!this._silentReconnect) {
        this.setStatus("error", "No se encontró característica de escritura");
      }
      return false;
    } catch (err: any) {
      if (!this._silentReconnect) {
        this.setStatus("error", err.message || "Error en conexión GATT");
      }
      return false;
    }
  }

  async print(data: Uint8Array): Promise<boolean> {
    if (this._isMockMode) {
      this.setStatus("printing", "Imprimiendo en modo simulación...");
      await new Promise((resolve) => setTimeout(resolve, 600));
      console.log(`[BluetoothPrinterService Mock Dev] Impresión simulada con éxito (${data.length} bytes)`);
      this.setStatus("connected", "Impresión simulada completada");
      return true;
    }

    if (!this.characteristic || !this.device?.gatt?.connected) {
      if (this.connectionLost && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.setStatus("connecting", "Reconectando antes de imprimir...");
        const ok = await this.connectInternal();
        if (!ok) {
          const fullOk = await this.connect();
          if (!fullOk) {
            this.setStatus("error", "No se pudo reconectar para imprimir");
            return false;
          }
        }
      } else if (this.autoReconnectEnabled && this.hasSavedDevice()) {
        // Reconexión silenciosa desde el dispositivo guardado (sin gesto de usuario)
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
      const mtu = 200; // Bloques de 200 bytes para evitar desborde de búfer
      for (let i = 0; i < data.length; i += mtu) {
        const chunk = data.slice(i, Math.min(i + mtu, data.length));
        if (this.characteristic?.properties.writeWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else if (this.characteristic?.properties.write) {
          await this.characteristic.writeValueWithResponse(chunk);
        } else {
          await (this.characteristic as any).writeValue(chunk);
        }
        await new Promise((resolve) => setTimeout(resolve, 20)); // Espera de 20ms
      }
      this.setStatus("connected", "Impresión completada");
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
    // "Solo Desconectar (Conservar)": NO borrar la persistencia para que la
    // próxima apertura de la app reconecte automáticamente.
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

    // A. Olvidar permiso Bluetooth del navegador
    try {
      if (this.device && typeof this.device.forget === "function") {
        await this.device.forget();
      }
    } catch { /* forget puede no estar soportado en todos los navegadores */ }

    // B. Limpiar localStorage
    this._clearSavedDevice();

    // C. Limpiar estado interno
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.reconnectAttempts = 0;
    this.connectionLost = false;
    this._silentReconnect = false;
    this.setStatus("disconnected", "Impresora desvinculada");

    // D. Recargar para limpiar estado en memoria
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
