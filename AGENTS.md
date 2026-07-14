# Blueprint — Punto de Venta de Lotería

## Stack
- **Frontend**: React 19 + TypeScript + Vite + TailwindCSS v4
- **Backend**: Express (server.ts) → esbuild → `dist/server.cjs`
- **Database**: Firestore (named DB `ai-studio-puntodeventadelo-99bc134f-793f-40a0-acdb-49f626766fdc`, project `rapigestion-2`)
- **Deploy**: Firebase App Hosting (`apphosting.yaml` + Secret Manager)

## Comandos
```bash
npm run dev          # tsx watch server.ts (Vite HMR on 5173, Express on 3000)
npm run build        # vite build + esbuild server.ts → dist/
npm run start        # node dist/server.cjs
npx tsc server.ts --noEmit --esModuleInterop --resolveJsonModule --moduleResolution node --target ES2022 --module ESNext --skipLibCheck
npx vite build       # Build solo frontend
```

## Arquitectura de Datos
- **Firestore 100%**, sin fallback a archivos locales. `data-store.json` eliminado.
- `saveToDB()` escribe SOLO `configuracion`, `usuarios` y `cierres_caja`. Tickets se escriben atómicamente por endpoint.
- Colecciones Firestore: `usuarios`, `configuracion`, `tickets`, `cierres_caja`
- `configuracion/general` contiene: sorteos, tasa_cambio, cobros, ingresos, resultados

## Firebase Admin (server.ts)
```typescript
// Init eager al arrancar — solo FIREBASE_CONFIG_JSON, sin file fallback
if (!firebaseAdmin.apps.length) {
  const configJson = process.env.FIREBASE_CONFIG_JSON;
  if (!configJson) throw new Error("FIREBASE_CONFIG_JSON no definida");
  const serviceAccount = JSON.parse(configJson);
  firebaseAdmin.initializeApp({
    credential: firebaseAdmin.cert(serviceAccount),
    projectId: "rapigestion-2"
  });
}
function initFirebaseAdmin(): boolean {
  return !!(firebaseAdmin.apps && firebaseAdmin.apps.length > 0);
}
```
- **NO** `applicationDefault()`, **NO** `service-account.json`, **NO** rutas de archivos
- `getFirestoreInstance()` usa DB nombrada: `getFirestore("ai-studio-puntodeventadelo-...")`
- `FIREBASE_CONFIG_JSON` se inyecta vía Secret Manager en App Hosting

## CORS (server.ts)
```typescript
app.use(cors({ origin: "*", methods: ["GET","POST","PUT","DELETE","PATCH","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"] }));
```
- Request logger: `process.stdout.write` en cada petición para Cloud Logging

## Login (POST /api/login)
- **Firestore-directo**: query `collection('usuarios').where('email','==',...)` + fallback por campo `usuario`
- Logs con `process.stdout.write` para garantizar salida en Cloud Logging
- Búsqueda dual: email y usuario
- Migración automática texto plano → bcrypt
- Sesiones: crypto token + TTL 24h en Map en memoria

## TypeScript Interfaces (server.ts)
```typescript
interface ServerSorteo { id: string; juego: string; hora_sorteo: string; hora_cierre: string; nombre: string; dias_habilitados?: number[]; }
interface ServerConfiguracion { tasa_cambio: number; contador_global_tickets: number; formato_ticket: any; sorteos: ServerSorteo[]; limites_numeros: any[]; resultados: any[]; cobros: any[]; ingresos?: any[]; }
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
  - variable: NODE_ENV
    value: production
    availability: [RUNTIME]
```
- Secret Manager vinculado a `FIREBASE_CONFIG_JSON`

## Frontend — Data Flow
- **App.tsx**: 4 `onSnapshot` listeners con `docChanges()` pattern: tickets, cierres_caja, usuarios, configuracion/general
- Config inicial `{ sorteos: [] }` (nunca null) para evitar crash en render
- `config?.sorteos?.find/filter` (optional chaining en todo VendedorInterface)

## Prize Logic
- **Fuente única**: `src/lib/prize-utils.ts` → `calculatePrizeMultiplier()`, `getTicketTheoreticalPrize(ticket, config)`, `parseGameDraw()`
- Guard en `getTicketTheoreticalPrize`: `if (!config || !config.sorteos) return 0;`
- Server.ts tiene su propia copia de `calculatePrizeMultiplier` (runtime separado)
- Usado por: VendedorInterface, SupervisorInterface, AdminInterface, TicketPreviewModal

## Date Utils
- `src/lib/date-utils.ts` → `toDateSafe()`, `toDateStr()`, `getTicketDate()`, `getTicketAmount()`

## Componentes Clave
| Archivo | Función |
|---------|---------|
| `server.ts` | Express backend, auth, CORS, Firebase Admin, endpoints |
| `src/App.tsx` | Login gate, 4 onSnapshot listeners, routing por rol |
| `src/components/Login.tsx` | Email+password → POST /api/login → sesión |
| `src/components/VendedorInterface.tsx` | Venta de tickets, historial, facturación vendedor |
| `src/components/SupervisorInterface.tsx` | Arqueo, cierres, ingresos, cobros |
| `src/components/AdminInterface.tsx` | CRUD sorteos, usuarios, resultados, escrutinio |
| `src/components/QrScannerModal.tsx` | Scanner QR con beep Web Audio + overlay éxito |
| `src/components/TicketPreviewModal.tsx` | Preview/imprimir ticket con prize calc |
| `src/components/FacturacionVendedorCard.tsx` | Resumen facturación por vendedor |
| `src/lib/prize-utils.ts` | Lógica centralizada de premios |
| `src/lib/date-utils.ts` | Normalización de fechas |
| `src/lib/firebase.ts` | Firebase client init (named DB) |
| `firestore.rules` | `allow read, write: if request.auth != null;` |

## Reglas de Negocio (Anti-Fraude)
- Cada venta usa timestamp del servidor (no del cliente)
- Cierre automático 5 min antes del sorteo
- Selector de hora deshabilita opciones pasadas
- Formato de entrada validado por juego (2 dígitos Diaria, 3 Jugá 3, etc.)
- País → Tipo de Sorteo → Hora del Sorteo (flujo obligatorio)

## .gitignore
```
service-account.json
data-store.json
*firebase-adminsdk*.json
```
