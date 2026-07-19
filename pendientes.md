# Pendientes

## TicketPreviewModal.tsx — Limpiar código muerto RawBT
- Eliminar `generarTextoTicketRaw()` (líneas 222-288)
- Eliminar `handlePrintRaw()` (líneas 290-310)
- Eliminar fallback `onPrint ? onPrint : handlePrintRaw` en el botón Imprimir → dejar solo `onPrint`
- Verificar que no queden referencias a RawBT en el archivo
