vamos a estandarizar la vista del Supervisor para que utilice la misma lógica financiera que el Administrador. Actualmente, el Supervisor está usando una lógica divergente, lo que causa disparidad en los datos.

Migración a finance-engine.ts:

Localiza el componente donde el Supervisor visualiza los reportes.

Sustituye cualquier lógica de cálculo local o llamada directa a server.ts por la función calculateSellerSummary importada desde nuestro nuevo src/lib/finance-engine.ts.

Paridad con el Administrador:

Asegúrate de que el Supervisor pase los mismos parámetros (lista de ventas, ingresos, cobros) que utiliza el Administrador.

Aplica la misma fórmula: Ganancia = Vendido - Premios y Balance = Ganancia + Ingresos - Cobros.

Eliminación de Sesgos de Usuario:

La vista del Supervisor no debe tener fórmulas "propias". Si el Administrador ve un balance neto de C$ 4990,00 para un vendedor, el Supervisor debe ver exactamente la misma cifra.

Elimina cualquier filtro de "estado" que el Supervisor pudiera estar aplicando de forma distinta a la del Administrador