# Blueprint de Arquitectura y Funcionalidades: Sistema POS de Lotería***

Este documento detalla la arquitectura completa, el stack tecnológico y las funcionalidades implementadas en el **Punto de Venta de Lotería**, un sistema SaaS diseñado para operar en Nicaragua y Honduras..

---

## 1. Stack Tecnológico

*   **Frontend**: React 19, TypeScript, Vite 6
*   **Estilos**: Tailwind CSS v4, Lucide React (Iconos), Motion (Animaciones)
*   **Gráficos y Reportes**: Recharts, jsPDF (Generación de tickets en PDF)
*   **Backend**: Node.js, Express 4, TypeScript (ejecutado con `tsx` en desarrollo y compilado con `esbuild` en producción).
*   **Base de Datos y Sincronización**: 
    *   Local: Archivo JSON (`data-store.json`) para operaciones rápidas.
    *   Nube: Firebase Auth (Autenticación), Firestore (Sincronización de datos), Firebase Cloud Messaging (Notificaciones).

---c

## 2. Arquitectura del Sistema

El sistema utiliza una arquitectura híbrida cliente-servidor con capacidades offline-first y sincronización en tiempo real.

### 2.1 Backend (`server.ts`)
El servidor Express actúa como la fuente única de verdad para el reloj del sistema (previniendo fraudes de zona horaria en los clientes) y maneja:
*   **API RESTful**: Endpoints para gestión de usuarios, ventas, tickets, configuraciones y cierres.
*   **Integración con Firebase Admin SDK**: Gestión de usuarios (Firebase Auth), base de datos en la nube (Firestore) y envío de mensajes (FCM).
*   **Almacenamiento Local**: Lectura y escritura atómica en `data-store.json`.
*   **Sincronización**: Lógica para mantener sincronizados a los clientes mediante Server-Sent Events (SSE) o polling.

### 2.2 Frontend (React)
El frontend es una Single Page Application (SPA) que se puede instalar como PWA.
*   **Routing y Sesión**: Manejado en `App.tsx`, con un estricto control de inactividad (30 minutos) que cierra la sesión automáticamente.
*   **Interfaces por Rol**: El sistema renderiza diferentes componentes principales dependiendo del rol del usuario autenticado (Administrador, Supervisor, Vendedor).

---

## 3. Interfaces y Módulos Principales (`src/components/`)

### 3.1 `App.tsx` (Enrutador Principal y Gestor de Sesión)
*   Verifica el estado de autenticación a través de Firebase Auth.
*   Mantiene la sesión activa y gestiona el temporizador de inactividad.
*   Renderiza `Login`, `AdminInterface`, `SupervisorInterface` o `VendedorInterface` según el rol.

### 3.2 `Login.tsx` (Autenticación)
*   Integrado con Firebase Authentication.
*   Permite inicializar el usuario Administrador si el sistema está vacío.

### 3.3 `VendedorInterface.tsx` (Punto de Venta - POS)
*   **Selección de País y Juego**: Interfaz dinámica que se adapta a las reglas de Nicaragua (Diaria, Fechas, Jugá 3, etc.) y Honduras (La Diaria, Súper Premio, etc.).
*   **Motor Anti-Fraude**: Oculta y bloquea los sorteos que ya han pasado o que están a menos de 5 minutos de realizarse, **consultando estrictamente la hora del servidor**.
*   **Validación de Formatos**: Restringe la entrada de números según el juego (ej. solo 2 dígitos para la Diaria).
*   **Carrito de Compras**: Agrega múltiples jugadas a un solo ticket.
*   **Historial y Cierre de Caja**: Permite al vendedor ver sus ventas del día y realizar el arqueo de caja separando denominaciones en C$ (Córdobas) y USD (Dólares).

### 3.4 `SupervisorInterface.tsx` (Gestión de Vendedores)
*   **Dashboard de Equipo**: Visión general de las ventas de todos los vendedores asignados a este supervisor.
*   **Cobros y Cuadres**: Herramienta para registrar los cobros realizados a los vendedores, calculando diferencias (descuadres).
*   **Reportes de Zona**: Estadísticas filtradas por los vendedores bajo su cargo.

### 3.5 `AdminInterface.tsx` (Centro de Control)
*   **Dashboard Global**: Gráficos interactivos de ventas, ganancias y estadísticas globales.
*   **Gestión de Usuarios (CRUD)**: Creación, edición, activación/desactivación de usuarios. Asignación de vendedores a supervisores. Sincronización bidireccional con Firebase Auth.
*   **Configuración del Sistema**: 
    *   Definición de formatos de ticket (RUC, Mensajes).
    *   Gestión de Límites: Establecer techos de dinero por número, por juego, por sorteo y por vendedor.
*   **Gestión de Resultados**: Ingreso de los números ganadores para calcular premios a pagar.
*   **Reportes Avanzados**: Exportación de datos y análisis de rentabilidad.

### 3.6 `TicketPreviewModal.tsx` (Impresión)
*   Generador de PDF usando `jsPDF`.
*   Diseñado para impresoras térmicas (formato ticket).
*   Incluye firma digital/código de seguridad único por ticket y detalles completos de la compra.

---

## 4. Reglas de Negocio Implementadas (Anti-Fraude)

1.  **Regla del Reloj del Servidor**: El frontend nunca confía en el reloj local del dispositivo (PC o móvil) del vendedor. Todas las validaciones de "Hora del Sorteo" se cruzan con el timestamp del backend en `server.ts`.
2.  **Ventana de Bloqueo Automático**: Las ventas para un sorteo específico (ej. 11:00 AM) se inhabilitan automáticamente 5 minutos antes (10:55 AM).
3.  **Límites de Venta (Techos)**: El sistema valida en tiempo real que una jugada no exceda el límite global configurado por el administrador para un número específico en un sorteo determinado.
4.  **Integridad de Tipos de Juego**:
    *   **Nicaragua**: Diaria (00-99), Fechas (1-31, Mes), Jugá 3 (000-999), Premia2 (dos pares), Terminación 2.
    *   **Honduras**: La Diaria (00-99), Premia2 (dos pares), Pega 3 (tres pares), Súper Premio (6 números del 01-33).

---

## 5. Modelos de Datos Centrales (`src/types.ts`)

*   **Usuario**: `id`, `nombre`, `usuario`, `rol` (administrador, supervisor, vendedor), `estado` (activo/inactivo), `region`, `email`, `id_supervisor` (si aplica), `vendedoresAsignados` (para supervisores).
*   **Ticket**: `id`, `fecha`, `hora`, `vendedorId`, `cliente`, `juegos` (Array de jugadas), `total`, `estado` (valido, anulado).
*   **Jugada**: `juego` (tipo de juego), `numero` (el número jugado), `monto`, `sorteo` (11:00 AM, 3:00 PM, etc.).
*   **Límite de Número**: `numero`, `juego`, `sorteo`, `monto_maximo`, `vendedorId` (opcional).
*   **Cierre de Caja**: Registro de denominaciones (billetes/monedas), `total_sistema`, `total_fisico`, `diferencia`, `estado` (cuadrado, sobrante, faltante).

---

## 6. Flujos de Trabajo (Workflows)

### Flujo de Venta
1. El vendedor inicia sesión. Selecciona País -> Juego -> Sorteo (Solo muestra sorteos disponibles basados en la hora del servidor).
2. Ingresa números y montos. El sistema valida contra los límites (Techos) establecidos.
3. Se agrega al "Carrito".
4. Al "Imprimir", el frontend envía el payload al backend.
5. El backend re-valida la hora y los límites. Si es exitoso, guarda en `data-store.json`, sincroniza en Firestore y devuelve el OK.
6. El frontend genera el PDF térmico (`TicketPreviewModal`).

### Flujo de Cierre
1. El vendedor realiza su "Cierre de Caja" ingresando la cantidad de billetes y monedas que tiene físicamente.
2. El sistema calcula la diferencia entre lo vendido (según sistema) y lo físico.
3. El supervisor revisa el cierre del vendedor, recauda el dinero y registra un "Cobro" en su panel, marcando el monto como saldado.

### Flujo de Administración
1. El administrador ingresa resultados de sorteos pasados.
2. Ajusta techos de números "calientes" para mitigar riesgo financiero.
3. Gestiona accesos (desactiva vendedores morosos).

---
*Fin del Blueprint.*
