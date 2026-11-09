# Plan inicial de migración a Supabase

Estado: diseño, no desplegar todavía. La app sigue usando Firebase y esta documentación no cambia producción.

## Inventario observado

- Firestore Admin y backend: `usuarios`, `tickets`, `configuracion/general`, `configuracion/fcm`, `resultados`, `cierres_caja`, `resumenes_diarios`, `cobros_admin`, `pagos_comision`, `logs_auditoria`.
- La UI también accede directamente a Firestore en `App.tsx`, `AdminInterface.tsx`, `SupervisorInterface.tsx`, `VendedorInterface.tsx`, `TicketEditSection.tsx` y `useFacturacion.ts`.
- Firebase Auth solo aparece en `App.tsx` (restauración de sesión / logout); el login y los roles de negocio se resuelven actualmente por endpoints propios en Express consultando `usuarios`. No se observa un flujo `signInWithEmailAndPassword` en el código inspeccionado.
- `sorteos`, `limites_numeros`, `cobros`, `ingresos` y parte de resultados están embebidos en `configuracion/general`; se normalizan a tablas separadas. El formato de impresión puede seguir como JSONB.

## Identificador público de ticket

`id_ticket` es una referencia pública y única para buscar, anular, pagar y editar. Debe seguir siendo texto (`varchar(7)` en el esquema): al ser una secuencia de `000001` a `1000000`, el valor máximo tiene siete caracteres. Guardarlo como entero perdería los ceros iniciales. Se recomienda `UNIQUE NOT NULL` tanto para `id_ticket` como para `numero_ticket` mientras el contrato legado mantenga ambos campos; una migración debe verificar que coincidan para registros nuevos y registrar excepciones históricas antes de aplicar esa regla. La clave interna de relaciones es `tickets.id UUID`, nunca el número impreso.

## Relaciones y estrategia de identidad

- `profiles.id` referencia `auth.users.id`; `legacy_firestore_id` conserva el ID antiguo y es único para poder resolver relaciones durante la carga.
- Convertir referencias legadas en dos pasos: importar perfiles y construir el mapa `{legacy_firestore_id -> UUID}`; después insertar tickets/cierres/cobros con las referencias UUID. Rechazar y reportar referencias sin padre; no inventar usuarios.
- `draws.legacy_id` y demás `legacy_id` permiten trazabilidad e importación idempotente. IDs de documentos con significado de negocio (como resumen diario) se guardan en `legacy_id`, mientras la clave relacional es UUID.
- `ticket_plays` descompone `jugadas[]`; denominaciones de cierre y formato de impresión quedan como JSONB por ser estructuras variables/documentales.
- Los vendedores asignados se modelan por el FK `profiles.id_supervisor`; no hace falta duplicar listas en supervisor.
- Configuración global se separa en `app_settings`, `draws`, `number_limits`, `draw_results`, `seller_receipts` (pendiente de definir forma exacta de `cobros`), `incomes` (pendiente de forma exacta) y notificaciones. No se deben aplanar `cobros`/`ingresos` hasta revisar sus campos reales.

## Autenticación

1. El login visible usa `usuario`/username. Supabase Auth recibe automáticamente `${username}@app.local`; ese correo es interno, no corresponde a una bandeja real y no se presenta al usuario.
2. No copiar hashes bcrypt/planos de Firebase a `auth.users`. La provisión crea cuentas Supabase Auth por username; la contraseña inicial del administrador se configura como secreto de migración y las demás se pueden restablecer desde el panel.
3. El cliente nunca asigna roles ni llama a Auth Admin. Endpoints de Express validan el JWT Supabase y el rol del perfil; solo entonces usan `SUPABASE_SERVICE_ROLE_KEY` para crear usuarios, actualizar el perfil, desactivar cuentas o cambiar cualquier contraseña. La clave nunca se expone al navegador.
4. RLS limita lecturas de perfiles/datos asociados; no se habilitan escrituras directas de cliente. Completar las mutaciones de ventas/finanzas antes de activar Supabase para toda la operación.

Los endpoints protegidos de gestión de cuentas necesitan `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` solo en el entorno del servidor (en producción, Secret Manager/App Hosting). Nunca definir la clave de servicio con prefijo `VITE_`. El panel usa una sesión JWT de Supabase y el servidor valida rol antes de crear/desactivar cuentas o actualizar contraseñas.

## Capa de acceso

Servicios iniciales en `src/services/` encapsulan ticket, auth y configuración actuales para que las vistas dependan de contratos de servicio. Todavía son adaptadores Firestore, no una conexión Supabase. Siguiente extracción recomendada: usuarios, cierres y reportes; reemplazar todos los `onSnapshot` restantes con Realtime de Supabase o SSE/WebSocket del backend antes de retirar Firebase. El backend Express debe usar un repositorio server-side con service role; el secreto solo vive en Secret Manager.

### Estado del modo dual

`VITE_USE_SUPABASE=true` enruta autenticación del formulario, búsqueda/edición de ticket, lista/listener global de tickets, cierres globales, configuración y resultados a Supabase; `false` mantiene las implementaciones Firebase/API. Esto todavía no es un modo Supabase completo: las ventas, pagos/anulaciones, CRUD de usuarios/configuración, reportes y varios listeners específicos de las vistas siguen usando endpoints Express o Firestore directamente. No activar el flag para usuarios reales hasta terminar esos repositorios, el middleware JWT del backend, las políticas RLS, la habilitación de Realtime y el esquema SQL.

### Exportación e importación implementadas

- `npm run export:firestore` exporta colecciones a `exports/firestore/*.jsonl`; requiere `FIREBASE_CONFIG_JSON` y `FIRESTORE_DATABASE_ID` en el entorno local seguro.
- `npm run migrate:supabase:dry-run` valida el export, relaciones y mapeos sin hacer conexiones/escrituras a Supabase. `npm run migrate:supabase` escribe con `SUPABASE_SERVICE_ROLE_KEY`, solo desde entorno seguro.
- La carga asigna correos sintéticos `username@app.local`; nunca importa los correos reales de Firestore. Se requiere `MIGRATION_ADMIN_INITIAL_PASSWORD` para crear la cuenta administrativa inicial si todavía no existe; las claves aleatorias temporales de otros usuarios no se exportan y el administrador las cambia desde la interfaz.
- Configuración de límites, cobros e ingresos se preserva en `legacy_config_items` JSONB para normalización posterior. Las reglas de acceso y RLS se deben crear antes de probar la app con datos reales.
- En Supabase Dashboard, añade `tickets`, `ticket_plays`, `cash_closures`, `app_settings`, `draws`, `number_limits` y `draw_results` a la publicación Realtime. Revisa RLS; el cliente usa la anon key.

## Migración histórica propuesta

Implementar un comando Node/TypeScript separado con modo `--dry-run` y pasos:

1. Exportar cada colección completa a JSONL/JSON con IDs de documento y campos serializados explícitamente (Timestamp a ISO UTC). Guardar conteos, fecha de corte y checksum; proteger el archivo porque usuarios pueden contener credenciales antiguas.
2. Validar y normalizar: strings numéricas, fechas Managua, monedas, estados, duplicados de `id_ticket`/`numero_ticket`/firma, usuarios huérfanos, sorteos referenciados faltantes y arrays `jugadas` malformados. Emitir reporte de errores y no cargar si existen conflictos críticos.
3. Crear cuentas/perfiles Auth y el mapa de IDs; cargar sorteos/configuración/resultados; cargar tickets y luego jugadas; finalmente cierres, resúmenes, cobros, comisiones y auditoría en transacción/lotes con `legacy_id` como clave de upsert.
4. Usar `INSERT ... ON CONFLICT` por IDs legados para reanudar de forma idempotente. Verificar conteos, suma de importes por día/vendedor, referencias FK, unicidad de ticket y muestras de búsquedas por ticket.
5. Ensayar con copia de Firestore y proyecto Supabase de prueba. Hacer corte final con escrituras pausadas o una ventana de solo lectura, exportar delta, validar y recién entonces cambiar configuración. Definir rollback antes de corte.

La carga no se ha ejecutado: faltan las credenciales del proyecto y debe prepararse la contraseña inicial del administrador en el entorno seguro.
