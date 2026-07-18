/// <reference types="web-bluetooth" />

export type PrinterStatus = "disconnected" | "connecting" | "connected" | "printing" | "error";

type StatusCallback = (status: PrinterStatus, message?: string) => void;

const STORAGE_KEY_BT_DEVICE = "bt_printer_device_id";
const STORAGE_KEY_BT_NAME = "bt_printer_name";
const HEARTBEAT_INTERVAL_MS = 8000;
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 6000, 8000];
const MAX_RECONNECT_ATTEMPTS = 10;

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
    return this.device?.name || localStorage.getItem(STORAGE_KEY_BT_NAME) || null;
  }

  isConnected(): boolean {
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
    if (this.device) {
      try {
        localStorage.setItem(STORAGE_KEY_BT_DEVICE, this.device.id);
        if (this.device.name) {
          localStorage.setItem(STORAGE_KEY_BT_NAME, this.device.name);
        }
      } catch { /* localStorage full or blocked */ }
    }
  }

  private _clearSavedDevice() {
    try {
      localStorage.removeItem(STORAGE_KEY_BT_DEVICE);
      localStorage.removeItem(STORAGE_KEY_BT_NAME);
    } catch { /* ignore */ }
  }

  private _getSavedDeviceId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY_BT_DEVICE);
    } catch {
      return null;
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────

  async connect(onlyPrinters: boolean = false): Promise<boolean> {
    if (this.device && this.device.gatt?.connected) {
      this.setStatus("connected", "Ya conectado");
      return true;
    }

    if (!navigator.bluetooth) {
      this.setStatus("error", "Web Bluetooth no soportado en este navegador");
      return false;
    }

    this._destroyed = false;
    this.setStatus("connecting", "Solicitando dispositivo...");

    try {
      const options: RequestDeviceOptions = onlyPrinters
        ? {
            filters: [
              { namePrefix: "Printer" },
              { namePrefix: "printer" },
              { namePrefix: "Impresora" },
              { namePrefix: "impresora" },
              { namePrefix: "PT" },
              { namePrefix: "MTP" },
              { namePrefix: "POS" },
              { namePrefix: "GP" },
              { namePrefix: "RT" }
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
    const savedId = this._getSavedDeviceId();
    if (!savedId) return false;

    if (this.device && this.device.gatt?.connected) {
      this.setStatus("connected", "Ya conectado");
      return true;
    }

    if (!navigator.bluetooth) return false;

    this._destroyed = false;
    this._silentReconnect = true;
    this.setStatus("connecting", "Reconectando impresora guardada...");

    try {
      if (navigator.bluetooth.getDevices) {
        const devices = await navigator.bluetooth.getDevices();
        const matchedDevice = devices.find(d => d.id === savedId);
        if (matchedDevice) {
          this.device = matchedDevice;
          this._attachDisconnectListener();
          const ok = await this.connectInternal();
          if (ok) this._saveDeviceId();
          this._silentReconnect = false;
          return ok;
        }
      }
      this._silentReconnect = false;
      this.setStatus("disconnected");
      return false;
    } catch {
      this._silentReconnect = false;
      this.setStatus("disconnected");
      return false;
    }
  }

  private async connectInternal(): Promise<boolean> {
    if (!this.device?.gatt) {
      this.setStatus("error", "Dispositivo sin GATT");
      return false;
    }

    this.setStatus("connecting", "Conectando GATT...");

    try {
      this.server = await this.device.gatt.connect();
      this.setStatus("connecting", "Descubriendo servicios...");

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
              this.setStatus("connected", `Conectado: ${this.device?.name || "PT-210"}`);
              return true;
            }
          }
        } catch {
          continue;
        }
      }

      this.setStatus("error", "No se encontró característica de escritura");
      return false;
    } catch (err: any) {
      this.setStatus("error", err.message || "Error en conexión GATT");
      return false;
    }
  }

  async print(data: Uint8Array): Promise<boolean> {
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
    this._clearSavedDevice();
    this.setStatus("disconnected", "Desconectado");
  }

  async desvincularImpresora(): Promise<void> {
    this._destroyed = true;
    this._stopHeartbeat();
    this._releaseWakeLock();

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
