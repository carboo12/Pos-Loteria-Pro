# 📋 Pendientes y Recomendaciones — Punto de Venta Lotería

> Fecha de análisis: 2026-07-09  
> Estado: **En revisión** — Marcar cada ítem con la prioridad que desees implementar.

---

## 🟠 INCOMPLETAS — Existen pero les falta lógica

### P-06 · "Caja por Liquidar" del Supervisor ignora cobros directos
- **Archivo**: [SupervisorInterface.tsx L215](file:///c:/Users/carlo/OneDrive/Documents/react/punto-de-venta-de-loter%C3%ADa/src/components/SupervisorInterface.tsx#L215)
- **Problema**: `getSellerSummary()` suma solo los `monto_entregado_cs` de cierres de caja no marcados como `cobrado`. No descuenta los cobros directos registrados en `/api/cobros`, por lo que el saldo puede aparecer inflado si ya se cobró de forma directa.
- **Solución**: Restar el `sumCobros` (cobros registrados del mismo vendedor) al saldo pendiente.
- **Impacto**: Exactitud financiera por vendedor

---

## 💡 IDEAS NUEVAS RECOMENDADAS

### R-02 · Contador regresivo hasta cierre del sorteo
- En el POS del vendedor, mostrar un temporizador `MM:SS` que cuente los minutos que faltan para que cierre el próximo sorteo activo.
- **Impacto**: Alto — reduce ventas tardías y genera urgencia positiva

### R-03 · Notificaciones push en celular (FCM)
- El servidor ya registra tokens FCM. Falta que el frontend del vendedor solicite permiso de notificaciones push y registre el token, para recibir alertas de resultados ganadores directamente en el celular.
- **Impacto**: Medio — útil para notificar al vendedor cuando hay ganador en sus boletos

### R-05 · Exportar reporte de facturación a CSV
- Botón "Exportar CSV" en la sección de Reportes del admin que descargue los datos del período filtrado (vendedor, fechas, boletos) como archivo `.csv` compatible con Excel.
- **Impacto**: Medio — muy solicitado en negocios de lotería para contabilidad
