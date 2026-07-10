const fs = require('fs');

let lines = fs.readFileSync('src/components/AdminInterface.tsx', 'utf-8').split('\n');

// 1. Add lastCobroId state
const stateIndex = lines.findIndex(l => l.includes('const [comisionLoading, setComisionLoading] = useState(false);'));
if (stateIndex !== -1) {
  lines.splice(stateIndex + 1, 0, '  const [lastCobroId, setLastCobroId] = useState("");');
  lines.splice(stateIndex + 2, 0, '  const [historialCobros, setHistorialCobros] = useState<any[]>([]);');
}

// 2. Modify handleAplicarCobro
const cobroDataIndex = lines.findIndex(l => l.includes('const data = await res.json();') && lines[l - 3]?.includes('/api/cobros/procesar'));
if (cobroDataIndex !== -1) {
  // Replace the success block
  const successIndex = lines.findIndex((l, i) => i > cobroDataIndex && l.includes('toast.success("Cobro aplicado exitosamente");'));
  if (successIndex !== -1) {
    lines.splice(successIndex, 0, '      if (data.id_cobro) setLastCobroId(data.id_cobro);');
  }
}

// 3. Modify handleRegistrarPago
const pagoBodyIndex = lines.findIndex(l => l.includes('concepto: comisionConcepto'));
if (pagoBodyIndex !== -1) {
  lines[pagoBodyIndex] = lines[pagoBodyIndex] + ',';
  lines.splice(pagoBodyIndex + 1, 0, '          id_cobro_relacionado: lastCobroId');
}
const pagoSuccessIndex = lines.findIndex(l => l.includes('toast.success("Pago de comisión registrado");'));
if (pagoSuccessIndex !== -1) {
  lines.splice(pagoSuccessIndex + 1, 0, '      setLastCobroId("");');
}

// 4. Add Historial and Backfill functions
const fetchLimitsListIndex = lines.findIndex(l => l.includes('const fetchLimitsList = async () => {'));
if (fetchLimitsListIndex !== -1) {
  const historialFunctions = `
  const fetchHistorialCobros = async () => {
    try {
      const res = await fetch("/api/cobros");
      if (res.ok) {
        const data = await res.json();
        setHistorialCobros(data);
      }
    } catch (e) {
      console.error("Error loading historial", e);
    }
  };

  useEffect(() => {
    if (activeSection === "finanzas") {
      fetchHistorialCobros();
    }
  }, [activeSection]);

  const handleAnularCobro = async (id: string) => {
    if (!window.confirm("ATENCIÓN: ¿Estás completamente seguro de anular este cobro? Esto revertirá los balances y cancelará comisiones pagadas.")) return;
    try {
      const res = await fetch(\`/api/cobros/\${id}/anular\`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(\`Cobro anulado. Se revirtieron \${data.resumenes_revertidos} días y \${data.comisiones_anuladas} pagos de comisión.\`);
      fetchHistorialCobros();
    } catch (e: any) {
      toast.error(e.message || "Error al anular cobro");
    }
  };

  const handleBackfill = async () => {
    if (!window.confirm("¿Ejecutar migración de ventas históricas? (Backfill)")) return;
    try {
      const res = await fetch("/api/admin/backfill-resumenes", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_status: "pagado" }) 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
    } catch (e: any) {
      toast.error(e.message || "Error al ejecutar migración");
    }
  };
`;
  lines.splice(fetchLimitsListIndex, 0, historialFunctions);
}

// 5. Add UI for Historial and Backfill
const endFinanzasIndex = lines.findIndex(l => l.includes('</div>') && lines[l + 1]?.includes('</div>') && lines[l + 2]?.includes(')}') && lines[l + 4]?.includes('{/* Modal de Cobro */}'));
if (endFinanzasIndex !== -1) {
  const historialUI = `
            {/* Historial de Cobros y Backfill */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm col-span-1 lg:col-span-2 mt-6">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-slate-100 rounded-xl">
                    <ShieldAlert className="w-5 h-5 text-slate-600" />
                  </div>
                  <h3 className="font-display font-black text-sm uppercase text-gray-800">Auditoría: Historial de Cobros</h3>
                </div>
                
                <button
                  onClick={handleBackfill}
                  className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold text-xs uppercase tracking-wider rounded-xl transition-colors flex items-center space-x-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Ejecutar Backfill Histórico</span>
                </button>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="p-3 text-[10px] font-bold text-gray-500 uppercase">ID Cobro</th>
                      <th className="p-3 text-[10px] font-bold text-gray-500 uppercase">Vendedor</th>
                      <th className="p-3 text-[10px] font-bold text-gray-500 uppercase">Período</th>
                      <th className="p-3 text-[10px] font-bold text-gray-500 uppercase">Neto (C$)</th>
                      <th className="p-3 text-[10px] font-bold text-gray-500 uppercase">Estado</th>
                      <th className="p-3 text-[10px] font-bold text-gray-500 uppercase text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historialCobros.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-4 text-center text-sm text-gray-500">No hay cobros registrados.</td>
                      </tr>
                    ) : (
                      historialCobros.map((cobro: any) => (
                        <tr key={cobro.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="p-3 text-xs font-mono text-gray-600">{cobro.id}</td>
                          <td className="p-3 text-sm font-bold text-gray-800">{cobro.nombre_vendedor}</td>
                          <td className="p-3 text-xs text-gray-600">{cobro.rango_inicio} al {cobro.rango_fin}</td>
                          <td className="p-3 text-sm font-black text-green-700">C$ {cobro.total_neto.toFixed(2)}</td>
                          <td className="p-3">
                            <span className={\`px-2 py-1 rounded text-[10px] font-bold uppercase \${cobro.estado === 'anulado' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}\`}>
                              {cobro.estado || 'ACTIVO'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {(!cobro.estado || cobro.estado !== 'anulado') && (
                              <button
                                onClick={() => handleAnularCobro(cobro.id)}
                                className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-[10px] font-bold uppercase rounded-lg border border-red-200 transition-colors"
                              >
                                Anular
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
`;
  lines.splice(endFinanzasIndex, 0, historialUI);
}

fs.writeFileSync('src/components/AdminInterface.tsx', lines.join('\n'));
console.log('AdminInterface.tsx updated for Phase 3 UI');
