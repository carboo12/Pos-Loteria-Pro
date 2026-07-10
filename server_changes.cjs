const fs = require('fs');

let lines = fs.readFileSync('server.ts', 'utf-8').split('\n');

const resumenDiarioIndex = lines.findIndex(l => l.includes('app.get("/api/resumen-diario/pendientes"'));

if (resumenDiarioIndex !== -1) {
  const insertText = `
// ============================================================================
// FASE 3: STARTUP SYNC, BACKFILL Y AUDITORÍA
// ============================================================================

// Sincronización robusta "Get or Create" para el Resumen Diario
function getOrCreateResumenDiario(id_vendedor: string, nombre_vendedor: string, dateStr: string) {
  const resumenId = \`\${id_vendedor}_\${dateStr}\`;
  let resumen = db.resumenes_diarios.find((r: any) => r.id === resumenId);
  
  if (!resumen) {
    resumen = {
      id: resumenId,
      id_vendedor,
      nombre_vendedor,
      fecha: dateStr,
      vendido: 0,
      pagado: 0,
      cierre: 'pendiente',
      egreso: 0,
      timestamp_creacion: new Date().toISOString(),
      timestamp_actualizacion: new Date().toISOString()
    };
    db.resumenes_diarios.push(resumen);
    saveToDB();
  }
  return resumen;
}

// Endpoint invocado desde App.tsx (Login) para inicializar el día
app.post("/api/resumen-diario/init", (req, res) => {
  const { id_vendedor, nombre_vendedor } = req.body;
  if (!id_vendedor || !nombre_vendedor) {
    return res.status(400).json({ error: "Faltan datos." });
  }
  
  const today = new Date();
  const dateStr = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, '0') + "-" + String(today.getDate()).padStart(2, '0');
  
  const resumen = getOrCreateResumenDiario(id_vendedor, nombre_vendedor, dateStr);
  res.json({ success: true, resumen });
});

// Endpoint de migración histórica (Backfill)
app.post("/api/admin/backfill-resumenes", (req, res) => {
  const { default_status = 'pagado' } = req.body; // Puede ser 'pagado' o 'pendiente'
  
  // 1. Obtener todas las ventas no anuladas
  const ventasValidas = db.ventas.filter((v: any) => v.estado !== 'anulado');
  
  // 2. Agrupar por vendedor y fecha
  const groups: Record<string, { id_vendedor: string, nombre_vendedor: string, fecha: string, vendido: number, pagado: number }> = {};
  
  ventasValidas.forEach((v: any) => {
    const d = new Date(v.timestamp);
    const dateStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
    const key = \`\${v.id_vendedor}_\${dateStr}\`;
    
    if (!groups[key]) {
      groups[key] = {
        id_vendedor: v.id_vendedor,
        nombre_vendedor: v.nombre_vendedor || "Vendedor",
        fecha: dateStr,
        vendido: 0,
        pagado: 0
      };
    }
    
    groups[key].vendido += v.total_cs || 0;
    if (v.estado === 'pagado') {
      groups[key].pagado += v.monto_ganado_cs || 0;
    }
  });
  
  // 3. Upsert en resumenes_diarios
  let migrados = 0;
  for (const key in groups) {
    const g = groups[key];
    let resumen = db.resumenes_diarios.find((r: any) => r.id === key);
    
    if (!resumen) {
      resumen = {
        id: key,
        id_vendedor: g.id_vendedor,
        nombre_vendedor: g.nombre_vendedor,
        fecha: g.fecha,
        vendido: g.vendido,
        pagado: g.pagado,
        cierre: default_status, // Estado por defecto elegido por el admin
        egreso: default_status === 'pagado' ? (g.vendido - g.pagado) : 0,
        timestamp_creacion: new Date().toISOString(),
        timestamp_actualizacion: new Date().toISOString()
      };
      db.resumenes_diarios.push(resumen);
      migrados++;
    } else {
      // Solo actualizamos los montos si ya existe, no tocamos el estado para no corromper cobros actuales
      resumen.vendido = g.vendido;
      resumen.pagado = g.pagado;
      resumen.timestamp_actualizacion = new Date().toISOString();
      migrados++;
    }
  }
  
  saveToDB();
  res.json({ success: true, message: \`Migración completada. \${migrados} resúmenes diarios actualizados/creados.\` });
});

// Endpoint de Anulación de Cobro
app.post("/api/cobros/:id/anular", (req, res) => {
  const { id } = req.params;
  
  const cobro = db.cobros_admin.find((c: any) => c.id === id);
  if (!cobro) {
    return res.status(404).json({ error: "Cobro no encontrado." });
  }
  
  if (cobro.estado === 'anulado') {
    return res.status(400).json({ error: "El cobro ya se encuentra anulado." });
  }
  
  // 1. Anular el cobro
  cobro.estado = 'anulado';
  
  // 2. Revertir los resumenes_diarios asociados
  let resumenesRevertidos = 0;
  db.resumenes_diarios.forEach((r: any) => {
    if (r.id_cobro === id) {
      r.cierre = 'pendiente';
      r.egreso = 0;
      delete r.id_cobro;
      delete r.timestamp_cobro;
      delete r.procesado_por;
      r.timestamp_actualizacion = new Date().toISOString();
      resumenesRevertidos++;
    }
  });
  
  // 3. Anular pagos de comisión relacionados
  let comisionesAnuladas = 0;
  db.pagos_comision.forEach((p: any) => {
    if (p.id_cobro_relacionado === id && p.estado !== 'anulado') {
      p.estado = 'anulado';
      comisionesAnuladas++;
    }
  });
  
  saveToDB();
  res.json({ 
    success: true, 
    message: "Cobro anulado exitosamente.", 
    resumenes_revertidos: resumenesRevertidos,
    comisiones_anuladas: comisionesAnuladas
  });
});

`;
  lines.splice(resumenDiarioIndex, 0, insertText);
}

const ventasIndex = lines.findIndex(l => l.includes('// 5. Build Object'));
if (ventasIndex !== -1) {
  const updateVentaLogic = `
  // [FASE 3] Get-or-create resumen diario for today before saving the sale
  const todayForSale = new Date();
  const dateStrForSale = todayForSale.getFullYear() + "-" + String(todayForSale.getMonth() + 1).padStart(2, '0') + "-" + String(todayForSale.getDate()).padStart(2, '0');
  const resumen = getOrCreateResumenDiario(id_vendedor, user.nombre, dateStrForSale);
  
  // Actualizar los valores del resumen diario de hoy
  resumen.vendido += parseFloat(monto_pago);
  resumen.timestamp_actualizacion = new Date().toISOString();
`;
  lines.splice(ventasIndex, 0, updateVentaLogic);
}

// Ahora modificar el patch de /api/ventas/:id/pagar para actualizar el resumen diario cuando se paga un premio
const pagarIndex = lines.findIndex(l => l.includes('v.estado = "pagado";'));
if (pagarIndex !== -1) {
  const updatePagarLogic = `
  // [FASE 3] Actualizar resumen diario con el pago
  const d = new Date(v.timestamp);
  const dateStrForPago = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
  const resumenPago = getOrCreateResumenDiario(v.id_vendedor, v.nombre_vendedor || "Vendedor", dateStrForPago);
  resumenPago.pagado += (v.monto_ganado_cs || 0);
  resumenPago.timestamp_actualizacion = new Date().toISOString();
`;
  lines.splice(pagarIndex + 1, 0, updatePagarLogic);
}

fs.writeFileSync('server.ts', lines.join('\n'));
console.log('server.ts updated');
