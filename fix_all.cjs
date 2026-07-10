const fs = require('fs');

let code = fs.readFileSync('src/components/AdminInterface.tsx', 'utf8');

// 1. Remove Cierres Button
code = code.replace(/<button\s+id="sidebar-cierres"[\s\S]*?<\/button>\s*/m, '');

// 2. Remove Cierres Headings
code = code.replace(/\{activeSection === "cierres" && "Bandeja de Cierres de Caja"\}\s*/g, '');
code = code.replace(/\{activeSection === "cierres" && "Auditoría de arqueos reportados por vendedores en calle comparados con balances de sistema\."\}\s*/g, '');

// 3. Main block Cierres
const startIdx = code.indexOf('{/* SECTION 2: BANDERA DE CIERRES */}');
const endIdx = code.indexOf('{/* SECTION 3: CONFIGURACIÓN SISTEMA */}');
if (startIdx !== -1 && endIdx !== -1) {
  code = code.substring(0, startIdx) + code.substring(endIdx);
}

// 4. Remove widget
const widgetStart = code.indexOf('{/* Widget 3: Arqueos Pendientes */}');
const widgetEnd = code.indexOf('{/* Widget 4: Tickets Emitidos */}');
if (widgetStart !== -1 && widgetEnd !== -1) {
  code = code.substring(0, widgetStart) + code.substring(widgetEnd);
}

// 5. Fix handleAplicarCobro
const cobroTarget = `      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Cobro aplicado exitosamente");
      setShowCobroModal(false);
      setFinanzasResumenes([]); // Reset UI
      setFinanzasMensajeInfo("Cobro procesado correctamente. Caja saldada.");
      
      // Auto-fill commission module with 10%
      setComisionVendedor(finanzasVendedor);
      setComisionMonto((totalVendido * 0.10).toFixed(2));
    } catch (e: any) {
      toast.error(e.message || "Error al aplicar cobro");
    } finally {`;

const cobroRepl = `      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Extract new cobro ID and store it for related commision payment
      if (data.cobro && data.cobro.id) {
        setLastCobroId(data.cobro.id);
      }

      toast.success("Cobro aplicado exitosamente");
      setShowCobroModal(false);
      setFinanzasResumenes([]); // Reset UI immediately to C$ 0.00
      setFinanzasMensajeInfo("Cobro procesado correctamente. Caja saldada.");
      
      // Auto-fill commission module with dynamic % based on seller's profile
      const seller = users.find(u => u.id === finanzasVendedor);
      const comisionPorcentaje = seller?.porcentaje_comision ? parseFloat(seller.porcentaje_comision as string) / 100 : 0.10;
      
      setComisionVendedor(finanzasVendedor);
      setComisionMonto((totalVendido * comisionPorcentaje).toFixed(2));

      // Refresh history immediately
      fetchHistorialCobros();
    } catch (e: any) {
      toast.error(e.message || "Error al aplicar cobro");
    } finally {`;
code = code.replace(cobroTarget, cobroRepl);

// 6. Fix Aplicar Cobro button UI
const btnTarget = `                      <button
                        onClick={() => setShowCobroModal(true)}
                        className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-wider rounded-xl cursor-pointer shadow-md transition-all active:translate-y-0.5"
                      >
                        Aplicar Cobro
                      </button>`;
const btnRepl = `                      <button
                        onClick={() => setShowCobroModal(true)}
                        disabled={finanzasResumenes.length === 0 || finanzasResumenes.reduce((a, b) => a + b.vendido, 0) - finanzasResumenes.reduce((a, b) => a + b.pagado, 0) <= 0}
                        className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-black uppercase tracking-wider rounded-xl cursor-pointer shadow-md transition-all active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Aplicar Cobro
                      </button>`;
code = code.replace(btnTarget, btnRepl);

// 7. Fix Modal details UI
const modalTarget = `              <p className="text-gray-600 font-sans text-sm leading-relaxed mb-6">
                ¿Confirmas que estás retirando físicamente <strong className="text-gray-900 font-black font-mono">C$ {(finanzasResumenes.reduce((a, b) => a + b.vendido, 0) - finanzasResumenes.reduce((a, b) => a + b.pagado, 0)).toFixed(2)}</strong> a este vendedor por el corte del {finanzasFechaInicio} al {finanzasFechaFin}?
              </p>
              <div className="flex gap-3">`;
const modalRepl = `              <p className="text-gray-600 font-sans text-sm leading-relaxed mb-4">
                ¿Confirmas que estás retirando físicamente <strong className="text-gray-900 font-black font-mono">C$ {(finanzasResumenes.reduce((a, b) => a + b.vendido, 0) - finanzasResumenes.reduce((a, b) => a + b.pagado, 0)).toFixed(2)}</strong> a este vendedor por el corte del {finanzasFechaInicio} al {finanzasFechaFin}?
              </p>
              <div className="mb-6 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-gray-600">
                <span className="font-bold uppercase text-gray-800 block mb-1">Días a saldar ({finanzasResumenes.length}):</span>
                {finanzasResumenes.map(r => (
                  <div key={r.id}>- {r.id.split('_')[1] || r.id}</div>
                ))}
              </div>
              <div className="flex gap-3">`;
code = code.replace(modalTarget, modalRepl);

// 8. Add Historial Table
const tableTarget = `              </div>

            </div>
          </div>
        )}

      {/* Modal de Cobro */}`;
const tableRepl = `              </div>

            </div>

            {/* Renderizado Visual del Historial y Anulación de Cobros (Auditoría) */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200 shadow-sm mt-6">
              <div className="flex items-center space-x-3 mb-6">
                <div className="p-2 bg-slate-100 rounded-xl">
                  <FileText className="w-5 h-5 text-slate-700" />
                </div>
                <h3 className="font-display font-black text-sm uppercase text-gray-800">Historial de Cobros Recientes</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-[10px] uppercase font-bold text-gray-500 tracking-wider">
                      <th className="p-3 border-b border-gray-200 rounded-tl-xl">Fecha de Cobro</th>
                      <th className="p-3 border-b border-gray-200">Rango Evaluado</th>
                      <th className="p-3 border-b border-gray-200">Vendedor</th>
                      <th className="p-3 border-b border-gray-200 text-right">Total Neto</th>
                      <th className="p-3 border-b border-gray-200 rounded-tr-xl text-center">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs font-sans">
                    {historialCobros.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-gray-400 font-medium">No hay cobros registrados.</td>
                      </tr>
                    ) : (
                      historialCobros.map(cobro => (
                        <tr key={cobro.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="p-3 text-gray-800 font-semibold">{new Date(cobro.timestamp).toLocaleString("es-NI")}</td>
                          <td className="p-3 text-gray-500 font-mono text-[10px]">{cobro.rango_inicio} a {cobro.rango_fin}</td>
                          <td className="p-3 font-bold text-blue-900">{cobro.nombre_vendedor}</td>
                          <td className="p-3 text-right font-black text-green-700">C$ {cobro.total_neto.toFixed(2)}</td>
                          <td className="p-3 text-center">
                            <button
                              onClick={async () => {
                                if (window.confirm("¿Seguro que desea anular este cobro? Esta acción revertirá el balance del vendedor.")) {
                                  await handleAnularCobro(cobro.id);
                                  await fetchHistorialCobros();
                                }
                              }}
                              className="p-1.5 bg-red-100 text-red-600 hover:bg-red-200 rounded-lg transition-colors inline-flex items-center justify-center cursor-pointer"
                              title="Anular Cobro"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

      {/* Modal de Cobro */}`;
code = code.replace(tableTarget, tableRepl);

fs.writeFileSync('src/components/AdminInterface.tsx', code);
console.log('Done refactoring');
