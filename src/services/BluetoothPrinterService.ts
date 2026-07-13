/// <reference types="web-bluetooth" />

export type PrinterStatus = "disconnected" | "connecting" | "connected" | "printing" | "error";

type StatusCallback = (status: PrinterStatus, message?: string) => void;

export class BluetoothPrinterService {
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private characteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private onStatusChange: StatusCallback | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private connectionLost = false;
  private _handleDisconnect: (() => void) | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

  private setStatus(status: PrinterStatus, message?: string) {
    if (this.onStatusChange) {
      this.onStatusChange(status, message);
    }
  }

  private onGattDisconnected = () => {
    this.connectionLost = true;
    this.setStatus("disconnected", "Impresora desconectada");

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.setStatus("connecting", "Reconectando en 1s...");
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.connectInternal();
      }, 1000);
    } else {
      this.setStatus("error", "No se pudo reconectar tras múltiples intentos");
    }
  };

  async connect(): Promise<boolean> {
    if (this.device && this.device.gatt?.connected) {
      this.setStatus("connected", "Ya conectado");
      return true;
    }

    if (!navigator.bluetooth) {
      this.setStatus("error", "Web Bluetooth no soportado en este navegador");
      return false;
    }

    this.setStatus("connecting", "Solicitando dispositivo...");

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: "PT-210" }, { namePrefix: "GOOJPRT" }, { namePrefix: "PT" }],
        optionalServices: BluetoothPrinterService.SERVICE_UUIDS
      });

      this._attachDisconnectListener();
      return await this.connectInternal();
    } catch (err: any) {
      this.setStatus("error", err.message || "Error al conectar");
      return false;
    }
  }

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
    if (!this.characteristic) {
      if (this.connectionLost && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.setStatus("connecting", "Reconectando antes de imprimir...");
        const ok = await this.connect();
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
      const mtu = 64;
      for (let i = 0; i < data.length; i += mtu) {
        const chunk = data.slice(i, Math.min(i + mtu, data.length));
        if (this.characteristic?.properties.writeWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else if (this.characteristic?.properties.write) {
          await this.characteristic.writeValueWithResponse(chunk);
        } else {
          // fallback if writeValue exists but writeWithoutResponse is not set explicitly
          await (this.characteristic as any).writeValue(chunk);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      this.setStatus("connected", "Impresión completada");
      return true;
    } catch (err: any) {
      this.setStatus("error", err.message || "Error al imprimir");
      return false;
    }
  }

  async disconnect() {
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
