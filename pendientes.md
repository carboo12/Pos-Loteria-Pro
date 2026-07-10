# 📋 Pendientes y Recomendaciones — Punto de Venta Lotería

> Fecha de análisis: 2026-07-09  
> Estado: **En revisión** — Marcar cada ítem con la prioridad que desees implementar.

---

## 🔴 CRÍTICO — Existe en UI pero no funciona correctamente

### ✅ P-01 · `isTimePast()` usa reloj local en el Modal del Ticket — **IMPLEMENTADO**
- **Archivo**: [TicketPreviewModal.tsx L38–44](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/TicketPreviewModal.tsx#L38-L44)
- **Problema**: La función que decide si un boleto "ya jugó" usa `new Date()` del cliente. Si el celular tiene el reloj mal, el estado (🔒 Bloqueado / Activo) se muestra incorrectamente.
- **Solución**: ~~Pasar `serverTime` como prop al modal y sincronizar el reloj igual que en `VendedorInterface`.~~ ✅ Resuelto — `isTimePast()` ahora recibe `syncedNow: Date` calculado desde `serverTime` del servidor. El vendedor pasa `serverTime={serverTime}` al modal.
- **Impacto**: Seguridad del boleto / experiencia de usuario

---

### ✅ P-02 · Premio en USD no convierte en el Modal — **IMPLEMENTADO**
- **Archivo**: [TicketPreviewModal.tsx L94](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/TicketPreviewModal.tsx#L94)
- **Problema**: `potentialPrize = monto_pago × multiplier` muestra el resultado en la misma moneda del boleto. Si alguien apostó `USD 5.00` en Jugá 3, el premio se muestra como `USD 3,000` cuando debería ser `C$ 108,000` (con tasa de cambio).
- **Solución**: ~~Si la moneda es USD, multiplicar también por `config.tasa_cambio` y mostrar en C$.~~ ✅ Resuelto — `potentialPrizeCs` siempre se calcula en C$. Si el boleto fue en USD, convierte con `monto × tasa_cambio` antes del multiplicador. Se muestra el desglose de conversión al cliente.
- **Impacto**: Presentación de premios al cliente

---

### P-03 · `getTodayString()` en Vendedor usa reloj no sincronizado
- **Archivo**: [VendedorInterface.tsx L201–206](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/VendedorInterface.tsx#L201-L206)
- **Problema**: La función que calcula qué ventas son "de hoy" para el resumen de caja usa el reloj local, no el servidor. Si el reloj está desfasado, el vendedor ve datos del día equivocado.
- **Solución**: Reemplazar con una versión que use `getSyncedNow()`.
- **Impacto**: Exactitud del cierre de caja

---

## 🟠 INCOMPLETAS — Existen pero les falta lógica

### P-04 · Endpoint para marcar cierre como "Cobrado" no existe
- **Archivo**: `server.ts` — Sección de cierres de caja
- **Problema**: El botón "Marcar como Cobrado" en la tabla de cierres del admin actualiza el estado visualmente pero no hay un `PATCH /api/cierres/:id` que persista `cobrado: true` en Firestore.
- **Solución**: Crear endpoint `PATCH /api/cierres/:id` que actualice el campo `cobrado` en Firestore y en la BD local.
- **Impacto**: Integridad contable

---

### P-05 · Dashboard del Admin no filtra por fecha
- **Archivo**: [AdminInterface.tsx L430](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/AdminInterface.tsx#L430)
- **Problema**: Las métricas KPI del dashboard principal (`activeSales`, `totalSalesCs`, etc.) suman **todas las ventas históricas**, no solo las de hoy. El total acumulado crece indefinidamente.
- **Solución**: Filtrar `activeSales` por la fecha de hoy usando `timestamp_servidor.startsWith(today)`.
- **Impacto**: Precisión del dashboard

---

### P-06 · "Caja por Liquidar" del Supervisor ignora cobros directos
- **Archivo**: [SupervisorInterface.tsx L215](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/SupervisorInterface.tsx#L215)
- **Problema**: `getSellerSummary()` suma solo los `monto_entregado_cs` de cierres de caja no marcados como `cobrado`. No descuenta los cobros directos registrados en `/api/cobros`, por lo que el saldo puede aparecer inflado si ya se cobró de forma directa.
- **Solución**: Restar el `sumCobros` (cobros registrados del mismo vendedor) al saldo pendiente.
- **Impacto**: Exactitud financiera por vendedor

---

### P-07 · Hub de Notificaciones sin botón de acceso en el sidebar
- **Archivo**: [AdminInterface.tsx L319–398](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/AdminInterface.tsx#L319-L398)
- **Problema**: El sistema SSE recibe notificaciones en tiempo real y las almacena en `notifications[]` con `unseenCount`, pero no hay botón de campana 🔔 en el header/sidebar del admin para acceder al historial. Solo se ven como toast flotante por 7 segundos.
- **Solución**: Agregar icono de campana con badge de número en el header del admin que abra el panel de notificaciones.
- **Impacto**: UX del administrador

---

### P-08 · Búsqueda QR solo busca en ventas cargadas en memoria
- **Archivo**: [VendedorInterface.tsx L133–140](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/VendedorInterface.tsx#L133-L140)
- **Problema**: Cuando el cliente llega a verificar un boleto, la búsqueda solo consulta `sales` (cargadas en RAM). Boletos muy antiguos que no estén en cache no se encontrarán aunque existan en Firestore.
- **Solución**: Si no se encuentra localmente, hacer una petición al servidor: `GET /api/ventas?ticket={id}`.
- **Impacto**: Verificación de boletos por cliente

---

## 🟡 DECORATIVO — Aparece en pantalla pero no hace nada

### P-09 · Indicador WiFi siempre verde (Vendedor y Supervisor)
- **Archivos**: [VendedorInterface.tsx L77](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/VendedorInterface.tsx#L77) · [SupervisorInterface.tsx L91](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/SupervisorInterface.tsx#L91)
- **Problema**: `isOnline` nunca cambia de `true`. El ícono de Wifi/WifiOff es decorativo — no escucha `navigator.onLine` ni hace pings al servidor.
- **Solución**: Suscribirse a `window.addEventListener('online'/'offline')` y agregar un ping periódico cada 30 segundos a `/api/ping`.
- **Impacto**: Feedback al vendedor en campo

---

### P-10 · QR del ticket impreso apunta a dominio que no existe
- **Archivo**: [TicketPreviewModal.tsx L239](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/TicketPreviewModal.tsx#L239)
- **Problema**: El código QR generado apunta a `https://lanuevaera.net/verificar?ticket=...` — ese sitio no existe. Si el cliente escanea el QR del ticket físico, llega a una página muerta.
- **Solución**: O apuntar al dominio real del sistema desplegado, o crear una ruta pública `GET /verificar` en el servidor.
- **Impacto**: Confianza del cliente / verificación de boletos

---

### P-11 · Marca "RAPIGESTION" en el PDF Térmico
- **Archivo**: [AdminInterface.tsx L543–544](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/AdminInterface.tsx#L543-L544)
- **Problema**: El PDF dice "RAPIGESTION" y "SISTEMA RAPIGESTION PRO" en el encabezado — nombre diferente al del sistema real.
- **Solución**: Reemplazar con `config.formato_ticket.titulo` o "LA NUEVA ERA".
- **Impacto**: Imagen corporativa del reporte

---

## 💡 IDEAS NUEVAS RECOMENDADAS

### R-01 · Página pública de verificación de boletos (QR funcional)
- Crear una ruta pública `GET /verificar?ticket=XXXXX&firma=YYY` que devuelva una página HTML sencilla con el estado del boleto (ganador, pendiente, anulado), sin necesidad de login.
- **Impacto**: Alto — hace funcionar el QR de cada boleto impreso

### R-02 · Contador regresivo hasta cierre del sorteo
- En el POS del vendedor, mostrar un temporizador `MM:SS` que cuente los minutos que faltan para que cierre el próximo sorteo activo.
- **Impacto**: Alto — reduce ventas tardías y genera urgencia positiva

### R-03 · Notificaciones push en celular (FCM)
- El servidor ya registra tokens FCM. Falta que el frontend del vendedor solicite permiso de notificaciones push y registre el token, para recibir alertas de resultados ganadores directamente en el celular.
- **Impacto**: Medio — útil para notificar al vendedor cuando hay ganador en sus boletos

### R-04 · Anulación administrativa con justificación
- El admin debería poder anular cualquier ticket fuera del plazo de 5 minutos, pero requiriendo un campo de justificación que quede registrado en Firestore.
- **Impacto**: Alto — control de auditoría y fraude

### R-05 · Exportar reporte de facturación a CSV
- Botón "Exportar CSV" en la sección de Reportes del admin que descargue los datos del período filtrado (vendedor, fechas, boletos) como archivo `.csv` compatible con Excel.
- **Impacto**: Medio — muy solicitado en negocios de lotería para contabilidad

### R-06 · Límites globales vs por vendedor
- Hoy los límites suman ventas de todos los vendedores juntos. Separar en: **Límite Global** (techo de la casa para ese número) y **Límite por Vendedor** (cupo individual).
- **Impacto**: Alto — control financiero más granular

---

## ✅ BUGS YA CORREGIDOS (referencia)
- ~~Bug de `new Date()` en `isSorteoCerrado` del Vendedor~~ → Resuelto con `getSyncedNow()`
- ~~Formatos dinámicos para ingreso de resultado (Fechas, Premia2, etc.)~~ → Resuelto
- ~~Zona horaria UTC en cobros y cierres~~ → Resuelto con `getLocalDateString()`
- ~~"La Grande" en lista de juegos del PDF~~ → Corregido a catálogo completo real
