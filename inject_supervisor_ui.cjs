const fs = require('fs');
let content = fs.readFileSync('src/components/SupervisorInterface.tsx', 'utf8');

const regexCobrosTab = /\{\/\* TAB 4: HISTORIAL DE COBROS \*\/\}[\s\S]*?(?=\{\/\* Bottom Navigation Bar \*\/)/m;

const newCobrosTab = `\{/* TAB 4: LIQUIDACIÓN EN RUTA (MOBILE-FIRST) */\}
      {activeTab === "cobros" && (
        <div className="space-y-4 animate-fade-in relative pb-10">
          <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
            <h3 className="font-display font-black text-gray-900 uppercase text-sm mb-3 border-b border-gray-100 pb-2">Parámetros de Liquidación</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1">Vendedor a Liquidar</label>
                <select 
                  value={selectedVendedorLiquidacion} 
                  onChange={(e) => {
                    setSelectedVendedorLiquidacion(e.target.value);
                    setResumenesLiquidacion([]);
                  }}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 font-bold p-3 rounded-xl focus:border-indigo-900 focus:outline-none transition-colors"
                >
                  <option value="">-- Seleccionar Vendedor --</option>
                  {linkedSellers.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre} (@{v.usuario || v.email.split("@")[0]})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1">Desde</label>
                  <input 
                    type="date" 
                    value={fechaInicioLiquidacion} 
                    onChange={(e) => setFechaInicioLiquidacion(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 font-mono text-xs font-bold p-3 rounded-xl focus:border-indigo-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1">Hasta</label>
                  <input 
                    type="date" 
                    value={fechaFinLiquidacion} 
                    onChange={(e) => setFechaFinLiquidacion(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 font-mono text-xs font-bold p-3 rounded-xl focus:border-indigo-900 focus:outline-none"
                  />
                </div>
              </div>

              <button 
                onClick={fetchResumenesLiquidacion}
                disabled={loadingLiquidacion || !selectedVendedorLiquidacion}
                className="w-full mt-2 py-3.5 bg-indigo-950 hover:bg-indigo-900 text-white font-display font-black text-xs uppercase tracking-wider rounded-xl cursor-pointer disabled:opacity-50 transition-all flex items-center justify-center space-x-2 shadow-md"
              >
                {loadingLiquidacion ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span>Consultar Balance</span>
              </button>
            </div>
          </div>

          <AnimatePresence>
            {resumenesLiquidacion.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                    <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Vendido</span>
                    <span className="text-xl font-black text-gray-900 mt-1">C$ {totalVendidoLiq.toLocaleString("es-ES")}</span>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-col justify-between">
                    <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Premios Pagados</span>
                    <span className="text-xl font-black text-red-600 mt-1">C$ {totalPagadoLiq.toLocaleString("es-ES")}</span>
                  </div>
                </div>

                <div className="bg-indigo-950 text-white rounded-2xl p-5 shadow-lg border-2 border-indigo-900 relative overflow-hidden">
                  <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/5 rounded-full blur-xl"></div>
                  <span className="text-[11px] uppercase font-black text-indigo-200 tracking-widest block mb-1">Total Neto a Recaudar</span>
                  <div className="flex items-end space-x-2">
                    <span className="text-4xl font-black tracking-tight">C$ {totalNetoLiq.toLocaleString("es-ES")}</span>
                  </div>
                  <p className="text-[10px] text-indigo-300 mt-3 border-t border-indigo-800 pt-3">
                    Efectivo físico que el vendedor debe entregar correspondiente a {resumenesLiquidacion.length} día(s) de operación.
                  </p>
                </div>

                <button 
                  onClick={() => setShowCobroModal(true)}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-display font-black text-sm uppercase tracking-widest shadow-md border-b-4 border-emerald-800 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center space-x-2"
                >
                  <DollarSign className="w-5 h-5 stroke-[2.5]" />
                  <span>Cobrar en Efectivo</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Historial de Liquidaciones Hoy */}
          <div className="mt-8">
            <h4 className="font-display font-black text-gray-500 uppercase text-[10px] tracking-widest mb-3 pl-1">Mis Liquidaciones Hoy</h4>
            <div className="space-y-2">
              {(() => {
                const today = new Date().toISOString().split("T")[0];
                const todaysCobros = myCobros.filter(c => c.timestamp.startsWith(today));
                if (todaysCobros.length === 0) return <div className="text-[10px] text-gray-400 italic pl-1">No hay liquidaciones registradas hoy.</div>;
                return todaysCobros.map(cob => (
                  <div key={cob.id} className="bg-white border border-gray-200 rounded-xl p-3 shadow-xs flex justify-between items-center">
                    <div>
                      <span className="font-bold text-gray-800 text-xs block">{cob.nombre_vendedor}</span>
                      <span className="font-mono text-[9px] text-gray-400">{formatTo12HourTime(cob.timestamp)}</span>
                    </div>
                    <span className="font-black text-emerald-700 text-sm">C$ {cob.total_neto ? cob.total_neto.toLocaleString("es-ES") : (cob.monto_cs || 0).toLocaleString("es-ES")}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* MODAL COBRO EN EFECTIVO (FRAMER MOTION) */}
      <AnimatePresence>
        {showCobroModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col"
            >
              <div className="bg-emerald-600 px-5 py-4 text-white flex justify-between items-center">
                <div>
                  <span className="text-[9px] uppercase font-mono tracking-widest font-bold opacity-80">Confirmación</span>
                  <h3 className="font-display font-black text-base uppercase">Validar Liquidación</h3>
                </div>
                <button onClick={() => setShowCobroModal(false)} className="bg-white/20 hover:bg-white/30 rounded-full p-2 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-2">
                  <DollarSign className="w-8 h-8 stroke-[2.5]" />
                </div>
                <div>
                  <p className="text-gray-500 text-xs font-bold mb-1">¿Confirmas haber recibido la cantidad de?</p>
                  <p className="text-3xl font-black text-gray-900 tracking-tighter">C$ {totalNetoLiq.toLocaleString("es-ES")}</p>
                </div>
                <p className="text-[10px] text-gray-400 font-medium bg-gray-50 p-2 rounded-lg border border-gray-100">Al confirmar, el balance de este vendedor se cerrará permanentemente en el sistema para las fechas seleccionadas.</p>
                
                <button 
                  onClick={handleProcesarLiquidacion}
                  disabled={loadingLiquidacion}
                  className="w-full mt-2 py-3.5 bg-gray-900 hover:bg-black text-white rounded-xl font-display font-black text-sm uppercase tracking-wider shadow-md active:scale-95 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
                >
                  {loadingLiquidacion ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                  <span>Confirmar Recepción</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      `;

content = content.replace(regexCobrosTab, newCobrosTab);
fs.writeFileSync('src/components/SupervisorInterface.tsx', content);
console.log('Tab injected.');
