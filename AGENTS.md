# Blueprint — Punto de Venta de Lotería

## Stack
- **Frontend**: React 19 + TypeScript + Vite + TailwindCSS v4
- **Backend**: Express (server.ts) → esbuild → `dist/server.cjs`
- **Database**: Firestore (named DB `ai-studio-puntodeventadelo-99bc134f-793f-40a0-acdb-49f626766fdc`, project `rapigestion-2`)
- **Deploy**: Firebase App Hosting (`apphosting.yaml` + Secret Manager)

## Dependencias clave (package.json)
| Paquete | Versión | Uso |
|---------|---------|-----|
| react / react-dom | ^19.0.1 | UI framework |
| firebase | ^12.15.0 | Client SDK |
| firebase-admin | ^14.1.0 | Backend Admin SDK |
| express | ^4.21.2 | API server |
| lucide-react | ^0.546.0 | Iconografía |
| motion | ^12.23.24 | Animaciones |
| recharts | ^3.9.2 | Gráficas financieras |
| react-hot-toast | ^2.6.0 | Notificaciones |
| qrcode.react | ^4.2.0 | Generación QR |
| html5-qrcode + jsqr | — | Escaneo QR |
| @google/genai | ^2.4.0 | Gemini AI integración |
| bcryptjs | ^3.0.3 | Hash de contraseñas |
| jspdf + html2canvas | — | Exportación PDF |

## Comandos
```bash
npm run dev          # concurrently: Express API en :8080 + Vite (HMR) en :5173
npm run dev:api      # solo Express (tsx watch server.ts, puerto 8080)
npm run dev:web      # solo Vite (puerto 5173, proxy /api -> localhost:8080)
npm run build        # vite build + esbuild server.ts -> dist/
npm run start        # node dist/server.cjs
npm run lint         # tsc --noEmit (TypeScript check)
npx tsc server.ts --noEmit --esModuleInterop --resolveJsonModule --moduleResolution node --target ES2022 --module ESNext --skipLibCheck
```
- Frontend local: abrir `http://localhost:5173` (NUNCA :8080 para UI; `/api/*` va por proxy Vite al backend).

## Arquitectura de Datos
- **Firestore 100%**, sin fallback a archivos locales.
- `saveToDB()` escribe SOLO `configuracion` y `usuarios`. Tickets y cierres se escriben atómicamente por endpoint.
- Colecciones Firestore: `usuarios`, `configuracion`, `tickets`, `cierres_caja`, `resumenes_diarios`, `cobros_admin`, `pagos_comision`
- `configuracion/general` contiene: sorteos, tasa_cambio, cobros, ingresos, resultados, pagos_comision
- `configuracion/fcm` contiene: tokens FCM para push notifications
- Índices compuestos en `firestore.indexes.json`:
  - `tickets`: `(id_vendedor ASC, fecha_pago ASC)`
  - `tickets`: `(id_vendedor ASC, fecha_venta ASC)`

## Firebase Admin (server.ts)
```typescript
// Init con createRequire — compatible con ESM (tsx) y CJS (esbuild)
let _require: ReturnType<typeof createRequire>;
try {
  _require = createRequire(import.meta.url);
} catch {
  _require = createRequire(process.cwd() + "/server.ts");
}
const firebaseAdmin: any = (() => {
  try { const mod = _require("firebase-admin"); return mod?.default || mod; }
  catch { return null; }
})();
```
- **NO** `applicationDefault()`, **NO** `service-account.json` en producción, **NO** rutas de archivos
- `getFirestoreInstance()` usa DB nombrada via env: `FIRESTORE_DATABASE_ID` (fallback a DB de producción)
- `FIREBASE_CONFIG_JSON` se inyecta vía Secret Manager en App Hosting
- dotenv carga `.env.local` SOLO en desarrollo (`NODE_ENV !== "production"`)

## CORS (server.ts)
```typescript
app.use(cors({ origin: "*", methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"] }));
app.use(express.json({ limit: "10mb" }));
```
- Request logger: `process.stdout.write` en cada petición para Cloud Logging

## Autenticación y Sesiones
- **Login** (POST /api/login): query `usuarios` por email y por campo `usuario` (búsqueda dual)
- Migración automática contraseña texto plano → bcrypt al primer login exitoso
- Sesiones: `crypto.randomBytes(32)` token + TTL 24h en `Map<string, {user, createdAt}>` en memoria
- Limpieza periódica de sesiones expiradas cada 30 minutos
- `checkAuth(allowedRoles?)`: middleware que valida Bearer token + re-valida usuario en Firestore si no está en caché
- `requireAdmin = checkAuth(["administrador"])` — shortcut para rutas de admin
- Fetch interceptor global en `main.tsx` inyecta sesión en todos los requests y maneja auto-logout en 401

## Service Worker & Versionado
- `main.tsx` gestiona `APP_VERSION = "v12"` con kill switch
- Al detectar versión distinta en localStorage: desregistra todos los SW, purga todos los cachés, recarga
- Permite actualizaciones silenciosas sin que el cliente quede con assets viejos

## TypeScript Interfaces (server.ts)
```typescript
interface ServerSorteo { id: string; juego: string; hora_sorteo: string; hora_cierre: string; nombre: string; dias_habilitados?: number[]; }
interface ServerConfiguracion { tasa_cambio: number; contador_global_tickets: number; formato_ticket: any; sorteos: ServerSorteo[]; limites_numeros: any[]; resultados: any[]; cobros: any[]; ingresos?: any[]; pagos_comision?: any[]; }
interface ServerUsuario { id: string; requiereCambioPassword: boolean; nombre: string; usuario: string; rol: string; estado: string; conexion: string; activo: boolean; region: string; email: string; id_supervisor: string; vendedoresAsignados: any[]; password?: string; configuracion?: ServerConfiguracion; }
interface ServerDB { usuarios: ServerUsuario[]; configuracion: ServerConfiguracion; ventas: any[]; cierres_caja: any[]; resumenes_diarios: any[]; cobros_admin: any[]; pagos_comision: any[]; fcm_tokens: string[]; }
```

## App Hosting (apphosting.yaml)
```yaml
backend:
  runtime: nodejs
runConfig:
  concurrency: 80
  cpu: 1
  memoryMiB: 512
  minInstances: 0
  maxInstances: 2
env:
  - variable: FIREBASE_CONFIG_JSON
    secret: FIREBASE_SERVICE_ACCOUNT_SECRET
```
- `FIRESTORE_DATABASE_ID` se puede sobreescribir en `.env.local` para apuntar a DB de prueba

## Frontend — Data Flow
- **App.tsx**: lazy-load de las 3 interfaces con `React.lazy` + `<Suspense>` (code splitting)
- Carga inicial via `fetchUsers`, `fetchConfig`, `fetchSales`, `fetchClosures` (REST API)
- `onAuthStateChanged` de Firebase Auth + `onSnapshot` para tiempo real de tickets, cierres_caja, usuarios, configuracion/general
- Config inicial `{ sorteos: [], tasa_cambio: 36.50, ... }` (nunca null) para evitar crash en render
- `config?.sorteos?.find/filter` (optional chaining en todo VendedorInterface)
- `simulatedSupervisorId` permite al admin ver la vista de cualquier supervisor

## Finance Engine (src/lib/finance-engine.ts)
**Fuente única de verdad para cálculos financieros**. Importar SIEMPRE desde aquí.

```
Ganancia = (Vendido + Ingresos) - (Premios + Cobrado)
Balance  = (Vendido + Ingresos) - (Pagado + Cobrado)
```
NO modificar estas fórmulas sin revisar AdminInterface, SupervisorInterface y VendedorInterface.

Funciones exportadas:
- `calculateSellerSummary(seller, fechaInicio, fechaFin, tickets, config, cobros)` → `SellerSummary`
- `calculateAllSellerSummaries(sellers, ...)` → `SellerSummary[]`
- `getVendedorReporteAcumulado(vendedorId, fecha, tickets)` → acumulado por número/juego/sorteo

`pagado` usa `fecha_pago` si existe; si no, cae en `fecha_venta` (legado).

## Hook useFacturacion (src/hooks/useFacturacion.ts)
Consulta Firestore directamente para rangos de fecha (histórico completo):
- Query 1: tickets EMITIDOS en el rango por `fecha_venta`
- Query 2: tickets PAGADOS en el rango por `fecha_pago`
- Merge + deduplicación por ID (live tickets tienen prioridad sobre históricos)
- Exporta: `useFacturacion(vendedores, fechaInicio, fechaFin, tickets, config, cobros) → SellerSummary[]`

## Prize Logic
- **Fuente única**: `src/lib/prize-utils.ts` → `calculatePrizeMultiplier()`, `getTicketTheoreticalPrize(ticket, config)`, `parseGameDraw()`
- Guard en `getTicketTheoreticalPrize`: `if (!config || !config.sorteos) return 0;`
- `server.ts` tiene su propia copia de `calculatePrizeMultiplier` (runtime separado — no importa desde src/)
- Multiplicadores: Diaria=80, Jugá3=610, Pega3=600, Premia2=4000, Fechas=210, 3Monazos=650

## Date Utils (src/lib/date-utils.ts)
- `toDateSafe()`, `toDateStr()`, `getTicketDate()`, `getTicketAmount()`
- `getNicaraguaNow()` — tiempo actual en Nicaragua (America/Managua, UTC-6)

## Sorteo Utils (src/lib/sorteo-utils.ts)
- `isSorteoHabilitado(sorteo, date?)` — verifica dias_habilitados vs. día actual
- `isDateValidForSorteo(sorteo, dateStr)` — valida una fecha específica YYYY-MM-DD
- `getNextValidDate(sorteo, from?)` — próxima fecha válida (hasta 8 días adelante)
- `getDiasHabilitadosLabel/ShortLabel(sorteo)` — etiquetas legibles de días activos

## Componentes Clave
| Archivo | Función |
|---------|---------|
| `server.ts` | Express backend, auth, CORS, Firebase Admin, endpoints (3133 líneas) |
| `src/App.tsx` | Login gate, lazy loading, REST + onSnapshot, routing por rol |
| `src/main.tsx` | Entry point, kill switch SW v12, fetch interceptor global (auto-logout 401) |
| `src/types.ts` | Todas las interfaces TypeScript del frontend |
| `src/components/Login.tsx` | Email+password → POST /api/login → sesión |
| `src/components/VendedorInterface.tsx` | Venta de tickets, historial, facturación vendedor |
| `src/components/AdminInterface.tsx` | CRUD sorteos, usuarios, resultados, escrutinio, cobros admin |
| `src/components/AdminPanel.tsx` | Panel admin auxiliar |
| `src/components/SupervisorInterface.tsx` | Arqueo, cierres, ingresos, cobros |
| `src/components/QrScannerModal.tsx` | Scanner QR con beep Web Audio + overlay éxito |
| `src/components/TicketPreviewModal.tsx` | Preview/imprimir ticket con prize calc |
| `src/components/FacturacionVendedorCard.tsx` | Resumen facturación por vendedor |
| `src/components/ResumenFacturacionCard.tsx` | Resumen consolidado de facturación |
| `src/components/ReporteSorteoView.tsx` | Reporte detallado por sorteo |
| `src/components/BoletoVendidoCard.tsx` | Card de boleto vendido |
| `src/components/LiveClock.tsx` | Reloj en tiempo real |
| `src/components/LogoTicket.tsx` | Logo para ticket impreso |
| `src/components/RoleSelector.tsx` | Selector de rol en login |
| `src/services/escpos-builder.ts` | Constructor de buffers ESC/POS para impresora térmica |
| `src/services/BluetoothPrinterService.ts` | Servicio Bluetooth: conexión, reconexión, heartbeat, wake lock |
| `src/lib/prize-utils.ts` | Lógica centralizada de premios |
| `src/lib/date-utils.ts` | Normalización de fechas y timezone Nicaragua |
| `src/lib/finance-engine.ts` | Motor financiero (fuente única de verdad) |
| `src/lib/sorteo-utils.ts` | Utilidades de sorteos y días habilitados |
| `src/lib/firebase.ts` | Firebase client init (named DB) |
| `src/hooks/useFacturacion.ts` | Hook para facturación con consultas Firestore por rango |
| `firestore.rules` | `allow read, write: if request.auth != null;` |
| `firestore.indexes.json` | Índices compuestos en colección tickets |

## Impresión Térmica (ESC/POS)
- **Ancho de papel**: 48mm (384 dots, ~32 chars por línea con FONT_A)
- **Jugadas**: double-height (`0x1B 0x21 0x10`) para mayor legibilidad, reset a normal después del loop
- **Logo**: Canvas → bitmap con ancho múltiplo de 8, centrado, max 256×96 dots
- **QR**: Modelo 2, tamaño 10, corrección Q (25%)
- **Envío**: chunks de 200 bytes con pausa de 20ms entre cada uno
- **Heartbeat**: NOP cada 8s para mantener conexión viva
- **Persistencia**: `localStorage` guarda `bt_printer_device_id` y `bt_printer_name` para reconexión silenciosa via `navigator.bluetooth.getDevices()`
- **Reconexión**: backoff exponencial 1s→2s→4s→6s→8s, máx 10 intentos

## Reglas de Negocio (Anti-Fraude)
- Cada venta usa timestamp del servidor (no del cliente)
- Cierre automático 5 min antes del sorteo (venta bloqueada)
- **Anulación**: bloqueada después de `hora_sorteo` (no `hora_cierre`). Admin siempre puede anular.
- Selector de hora deshabilita opciones pasadas
- Formato de entrada validado por juego (2 dígitos Diaria/Terminación2, 3 Jugá3/Pega3, 4 Premia2, fecha Fechas)
- País → Tipo de Sorteo → Hora del Sorteo (flujo obligatorio)
- Límites de monto configurables por juego, sorteo y vendedor (`LimiteNumero`)
- `activePaymentLocks = new Set<string>()` previene pagos duplicados concurrentes

## Tipos de Datos Frontend (src/types.ts)
- `Usuario`: roles `vendedor | administrador | admin | supervisor`, regiones Nicaragua/Costa Rica/Honduras/El Salvador
- `Venta`: tickets con `jugadas[]` (multi-número), `firma_digital`, `es_premiado`, `fecha_pago`
- `Jugada`: `numero`, `monto`, `premio_posible`, `dia_juego?` (para juego Fechas)
- `CierreCaja`: denominaciones C$/USD, descuadre, `cobrado` flag
- `ResumenDiario`: acumulado diario `vendido/pagado`, estado `pendiente|pagado`
- `CobroAdmin`: corte consolidado de múltiples días (`dias_cerrados[]`)
- `PagoComision`: pago de comisión a vendedor

## Pendientes
- `TicketPreviewModal.tsx`: eliminar código muerto RawBT (`generarTextoTicketRaw`, `handlePrintRaw`, refs a RawBT)

## .gitignore
```
service-account.json
data-store.json
*firebase-adminsdk*.json
```
