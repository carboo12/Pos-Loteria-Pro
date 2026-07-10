<div align="center">
  <img src="/logo.png" alt="La Nueva Era" width="200" />
  <h1 align="center">Punto de Venta — Lotería</h1>
  <p align="center">
    Sistema POS multi-país para la venta de números de lotería en <strong>Nicaragua</strong> y <strong>Honduras</strong>
  </p>
  <p align="center">
    <strong>React 19</strong> · <strong>TypeScript</strong> · <strong>Express</strong> · <strong>Firebase Auth</strong> · <strong>Tailwind CSS v4</strong>
  </p>
  <p align="center">
    <a href="#características">Características</a> •
    <a href="#tecnologías">Tecnologías</a> •
    <a href="#empezar">Empezar</a> •
    <a href="#estructura">Estructura</a> •
    <a href="#seguridad">Seguridad</a>
  </p>
</div>

---

## Características

- **Multi-país**: Soporte para Nicaragua y Honduras con sus respectivos juegos y formatos
- **Gestión de usuarios**: Roles de Administrador, Supervisor y Vendedor
- **Catálogo de juegos**: Diaria, Fechas, Jugá 3, Premia2, Terminación 2, La Diaria, Pega 3, Súper Premio
- **Validación anti-fraude**: Bloqueo automático de ventas 5 minutos antes del sorteo usando timestamp del servidor
- **Límites por número**: Techos de dinero configurables por juego, sorteo y vendedor
- **Sincronización en tiempo real**: Polling cada 4 segundos con el backend Express
- **Cierre de caja**: Gestión de denominaciones en C$ y USD con cálculo de descuadre
- **Notificaciones**: SSE (Server-Sent Events) y Firebase Cloud Messaging
- **Reportes**: Dashboard con gráficos (Recharts), exportación a PDF
- **PWA**: Instalable como aplicación, service worker con estrategia de caché
- **Sesión segura**: Timeout por inactividad de 30 minutos con advertencia previa

## Tecnologías

| Frontend | Backend | Infraestructura |
|---|---|---|
| React 19 | Express 4 | Vite 6 |
| TypeScript | Firebase Admin SDK | Tailwind CSS v4 |
| Recharts (gráficos) | Firebase Auth | PWA (Service Worker) |
| Lucide React (iconos) | Firestore (sync) | dotenv |
| Motion (animaciones) | Almacenamiento JSON local | esbuild (build server) |
| jsPDF (reportes) | SSE + FCM (notificaciones) | tsx (dev server) |

## Empezar

### Prerrequisitos

- **Node.js** >= 18
- **npm**
- Una cuenta de **Firebase** con Authentication habilitado (email/contraseña)

### Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/punto-de-venta-de-loteria.git
cd punto-de-venta-de-loteria

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env.local
```

Edita `.env.local` con tus credenciales:

```env
GEMINI_API_KEY="tu-gemini-api-key"
APP_URL="http://localhost:3000"
FIREBASE_SERVICE_ACCOUNT_PATH="ruta/a/tu-service-account.json"
FIREBASE_DATABASE_URL="https://tu-proyecto.firebaseio.com"
```

### Ejecutar en desarrollo

```bash
npm run dev
```

El servidor se inicia en `http://localhost:3000`. La app sincroniza los usuarios locales con Firebase Auth automáticamente al arrancar.

### Construir para producción

```bash
npm run build
```

Esto genera:
- `dist/` — Frontend estático (Vite)
- `dist/server.cjs` — Backend empaquetado con esbuild

```bash
npm start
```

### Credenciales por defecto

Al iniciar, el sistema crea usuarios demo. Puedes inicializar el administrador desde la pantalla de login con el botón **"Inicializar Admin"**.

| Rol | Email | Contraseña |
|---|---|---|
| Administrador | `carboo12@gmail.com` | `Loto123456!` |
| Supervisor | `supervisor@loteria.com` | `Loto123456!` |
| Vendedor | (según configuración) | `Loto123456!` |

## Estructura del proyecto

```
punto-de-venta-de-lotería/
├── server.ts                     # Backend Express (API REST, Firebase Admin, Sincronización)
├── vite.config.ts                # Configuración de Vite
├── index.html                    # Entry point HTML
├── package.json
├── tsconfig.json
├── .env.example                  # Template de variables de entorno
├── firebase-applet-config.json   # Configuración de Firebase
├── data-store.json               # Base de datos local (auto-generada)
├── public/
│   ├── sw.js                     # Service Worker PWA
│   ├── manifest.json             # Manifest PWA
│   └── logo.png                  # Logo de la aplicación
├── src/
│   ├── main.tsx                  # Punto de entrada React + registro SW
│   ├── App.tsx                   # Componente raíz: auth, routing, sesión
│   ├── types.ts                  # Tipos TypeScript
│   ├── index.css                 # Estilos globales Tailwind
│   ├── lib/
│   │   └── firebase.ts           # Inicialización Firebase (Auth + Firestore)
│   └── components/
│       ├── Login.tsx             # Pantalla de inicio de sesión
│       ├── RoleSelector.tsx      # Header con info de usuario y botón Salir
│       ├── VendedorInterface.tsx # Interfaz de punto de venta
│       ├── SupervisorInterface.tsx # Panel de supervisión
│       ├── AdminInterface.tsx    # Dashboard de administración
│       └── TicketPreviewModal.tsx # Previsualización e impresión de tickets
```

## Seguridad

### Autenticación
- Firebase Authentication con email/contraseña
- Sincronización automática de usuarios entre base de datos local y Firebase Auth
- Cuentas inactivables de forma remota por el administrador

### Sesión
- Timeout automático por inactividad: **30 minutos** con ventana de advertencia de 1 minuto
- Protección contra restauración de sesión mediante el botón atrás del navegador (bfcache)
- Todas las transacciones usan el timestamp del servidor (no del cliente)

### Validación de ventas
- Bloqueo dual (cliente + servidor) de ventas fuera del horario permitido
- Verificación de formato de número según el juego seleccionado
- Límites de monto configurables por juego, sorteo y vendedor
- Firma digital en cada ticket (`A9X-2M`)

### Roles de acceso
- **Administrador**: Control total, gestión de usuarios, configuración, reportes
- **Supervisor**: Gestión de equipo, cierres, cobros
- **Vendedor**: Venta de números, historial, cierre de caja

## Scripts disponibles

| Comando | Descripción |
|---|---|
| `npm run dev` | Inicia servidor de desarrollo con hot-reload |
| `npm run build` | Compila frontend + backend para producción |
| `npm start` | Inicia servidor en producción |
| `npm run lint` | Verifica tipos con TypeScript |
| `npm run clean` | Elimina archivos de build |

---

<div align="center">
  <sub>Desarrollado para Lotería La Nueva Era · Nicaragua y Honduras</sub>
  <br />
  <sub>PWA Multi-País · Sistema de Alta Confiabilidad</sub>
</div>
