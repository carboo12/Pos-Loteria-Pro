const fs = require('fs');
let content = fs.readFileSync('src/components/VendedorInterface.tsx', 'utf8');

// 1. Replace the inner "Entrada de Jugada" container completely.
// In the clean base, it starts around {/* 3. Entrada de Jugada */} or {/* 2. Numero y Monto */} 
// We will look for: <div className="col-span-12"> o similar and replace the form.

// Clean base has a section for "2. Horario del Sorteo" and then "3. Numero y Monto".
// Let's do a regex replacement for the entire Tab 1 content from "3. Ingresar Jugada" or similar.
// Wait, the clean base structure is:
//             {/* 3. Número y Monto */}
//             <div className="bg-white border-2 border-gray-200 rounded-2xl p-3 shadow-xs">
//               <div className="flex justify-between items-center mb-2"> ... up to just before {/* Límite bloqueado */} or {/* Teclado numérico */}

// Let's replace the whole Venta tab content cleanly using regex.

const ventaTabRegex = /\{\/\* TAB 1: PANTALLA DE VENTA \*\/\}\s*\{activeTab === "venta" && \(\s*<div className="space-y-4 animate-fade-in">[\s\S]*?(?=\{\/\* TAB 2: HISTORIAL \*\/\})/m;

const newVentaTab = `\{/* TAB 1: PANTALLA DE VENTA */\}
        {activeTab === "venta" && (
          <div className="space-y-4 animate-fade-in">
            {/* 0. Country Selector */}
            <div>
              <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1.5">0. Seleccione País</label>
              <div className="grid grid-cols-5 gap-1">
                {["Nicaragua", "Honduras", "El Salvador", "La Primera", "Costa Rica"].map(pais => {
                  const flags: Record<string, string> = { "Nicaragua": "🇳🇮", "Honduras": "🇭🇳", "El Salvador": "🇸🇻", "La Primera": "🎰", "Costa Rica": "🇨🇷" };
                  const labels: Record<string, string> = { "Nicaragua": "NICARAGUA", "Honduras": "HONDURAS", "El Salvador": "LOTO SV", "La Primera": "PRIMERA", "Costa Rica": "LA TICA" };
                  return (
                    <button
                      key={pais}
                      id={\`pais-select-\${pais}\`}
                      onClick={() => { setSelectedPais(pais); setErrorMessage(null); setSuccessMessage(null); }}
                      className={\`py-2 px-1 rounded-xl text-[9px] font-display font-black transition-all border flex flex-col items-center justify-center space-y-1 shadow-xs \${selectedPais === pais ? "bg-blue-900 text-white border-blue-950 font-bold" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}\`}
                    >
                      <span className="text-sm">{flags[pais]}</span>
                      <span>{labels[pais]}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 1. Dynamic Game Selector */}
            <div>
              <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1.5">1. Seleccione Juego ({selectedPais})</label>
              <div className="grid grid-cols-3 gap-1.5">
                {PAISES_GAMES[selectedPais as keyof typeof PAISES_GAMES]?.map((juego) => {
                  const isSabadito = juego === "Sabadito";
                  const isWeekend = [0, 6].includes(getSyncedNow().getDay());
                  const disabled = isSabadito && !isWeekend;

                  return (
                    <button
                      key={juego}
                      id={\`game-select-\${juego.replace(/\\s+/g, "-")}\`}
                      onClick={() => {
                        if (disabled) {
                          setErrorMessage("Sabadito solo está disponible Sábados y Domingos.");
                          return;
                        }
                        setSelectedJuego(juego);
                        setErrorMessage(null);
                        setSuccessMessage(null);
                      }}
                      disabled={disabled}
                      className={\`py-2.5 px-1 rounded-xl text-[10px] font-display font-black transition-all border text-center truncate shadow-xs \${disabled ? "opacity-50 cursor-not-allowed bg-gray-200 text-gray-500 border-gray-300" : "cursor-pointer"} \${!disabled && selectedJuego === juego ? "bg-[#1E3A8A] text-white border-blue-900 font-bold" : !disabled ? "bg-white text-gray-800 border-gray-300 hover:bg-gray-100" : ""}\`}
                    >
                      {juego.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Sorteo Selector */}
            <div>
              <label className="block text-xs font-display font-black text-gray-700 uppercase tracking-wider mb-1.5">2. Horario del Sorteo</label>
              {getSorteosByGame(selectedJuego).length === 0 ? (
                <div className="text-xs text-red-500 bg-red-50 p-2 rounded border border-red-200">No hay sorteos programados para este juego hoy.</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {getSorteosByGame(selectedJuego).map((s) => {
                    const cerrado = isSorteoCerrado(s);
                    const isSelected = selectedSorteo === s.nombre;
                    return (
                      <button
                        key={s.id}
                        id={\`sorteo-select-\${s.id}\`}
                        disabled={cerrado}
                        onClick={() => { if (!cerrado) setSelectedSorteo(s.nombre); }}
                        className={\`py-2.5 px-2 rounded-xl text-center font-sans text-xs transition-all border relative overflow-hidden \${cerrado ? "bg-gray-100 text-gray-400 border-gray-200 opacity-60 cursor-not-allowed" : isSelected ? "bg-blue-900 text-white border-blue-950 font-bold cursor-pointer" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50 cursor-pointer"}\`}
                      >
                        <div className="font-bold flex items-center justify-center space-x-1">
                          <span>{s.nombre.replace(/\\s*\\(NI\\)|\\s*\\(HN\\)|\\s*\\(SV\\)|\\s*\\(LP\\)|\\s*\\(CR\\)/g, "")}</span>
                          {cerrado && <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded font-black">CERRADO</span>}
                        </div>
                        <div className={\`text-[9px] font-mono mt-0.5 \${isSelected && !cerrado ? "text-blue-200" : "text-gray-400"}\`}>
                          Cierre: {formatTo12Hour(s.hora_cierre)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 3. Entrada de jugada (CARRITO) */}
            <div className="bg-white border-2 border-gray-200 rounded-2xl p-3 shadow-xs">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] font-display font-black text-gray-600 uppercase tracking-wider">3. Ingresar Jugada</span>
                <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-gray-100">
                  <button onClick={() => setMoneda("C$")} className={\`px-2 py-0.5 rounded text-[9px] font-black cursor-pointer transition-all \${moneda === "C$" ? "bg-blue-900 text-white" : "text-gray-600"}\`}>C$</button>
                  <button onClick={() => setMoneda("USD")} className={\`px-2 py-0.5 rounded text-[9px] font-black cursor-pointer transition-all \${moneda === "USD" ? "bg-blue-900 text-white" : "text-gray-600"}\`}>USD</button>
                </div>
              </div>

              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5">
                  <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">Número</label>
                  <div className={\`h-14 border-2 rounded-xl flex items-center justify-center relative font-mono shadow-inner px-1 overflow-hidden \${isLimitBlocked ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-gray-50'}\`}>
                    {selectedJuego === "Fechas" ? (
                      <span className="text-blue-900 text-[10px] font-black text-center">{numeroJugado.replace("-", " de ")}</span>
                    ) : selectedJuego === "Premia2" ? (
                      <span className="flex items-center space-x-1 text-sm">
                        <span className="bg-blue-50 border border-blue-200 px-1 rounded font-black">{numeroJugado.substring(0, 2) || "--"}</span>
                        <span className="text-gray-300">-</span>
                        <span className="bg-blue-50 border border-blue-200 px-1 rounded font-black">{numeroJugado.substring(2) || "--"}</span>
                      </span>
                    ) : selectedJuego === "Pega 3" ? (
                      <span className="flex items-center space-x-0.5 text-[10px]">
                        <span className="bg-blue-50 border border-blue-200 px-1 rounded font-black">{numeroJugado.substring(0, 2) || "--"}</span>
                        <span className="text-gray-300">-</span>
                        <span className="bg-blue-50 border border-blue-200 px-1 rounded font-black">{numeroJugado.substring(2, 4) || "--"}</span>
                        <span className="text-gray-300">-</span>
                        <span className="bg-blue-50 border border-blue-200 px-1 rounded font-black">{numeroJugado.substring(4) || "--"}</span>
                      </span>
                    ) : (
                      <span className="text-2xl font-black tracking-widest">{numeroJugado || <span className="text-gray-300">--</span>}</span>
                    )}
                    {numeroJugado && selectedJuego !== "Fechas" && (
                      <button id="clear-num-btn" onClick={() => setNumeroJugado("")} className="absolute right-1 top-1 p-0.5 bg-gray-100 hover:bg-gray-200 rounded text-gray-500 cursor-pointer">
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                <div className="col-span-4">
                  <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">Monto</label>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono font-bold text-gray-400 text-xs">{moneda}</span>
                    <input
                      id="monto-input"
                      ref={montoInputRef}
                      type="number"
                      value={montoPago}
                      onChange={(e) => setMontoPago(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addJugadaAlCarrito(); } }}
                      placeholder="0"
                      className={\`w-full h-14 pl-8 pr-1 rounded-xl font-mono text-xl font-black shadow-inner focus:outline-none border-2 transition-colors \${isLimitBlocked ? 'border-red-400 text-red-600 bg-red-50' : 'border-gray-300 text-gray-900 bg-white focus:border-blue-900'}\`}
                    />
                  </div>
                </div>

                <div className="col-span-3">
                  <button
                    onClick={addJugadaAlCarrito}
                    disabled={!numeroJugado || !montoPago}
                    className="w-full h-14 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-display font-black text-xs uppercase tracking-wide border-b-2 border-blue-950 flex flex-col items-center justify-center space-y-0.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <span>+ Añadir</span>
                  </button>
                </div>
              </div>

              {numeroJugado && montoPago && (
                <div className="mt-2 flex justify-between items-center bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                  <span className="text-[9px] font-display font-black text-emerald-700 uppercase">Premio esta jugada:</span>
                  <span className="font-mono text-sm font-black text-emerald-600">
                    C$ {(() => {
                      const amt = Number(montoPago) || 0;
                      const amtCs = moneda === "USD" ? amt * (config.tasa_cambio || 36.50) : amt;
                      return (amtCs * calculatePrizeMultiplier(selectedJuego, selectedSorteo)).toFixed(2);
                    })()}
                  </span>
                </div>
              )}

              <div className="mt-2 grid grid-cols-6 gap-1">
                {(moneda === "C$" ? [10, 20, 50, 100, 200, 500] : [1, 5, 10, 20, 50, 100]).map(amount => (
                  <button key={amount} onClick={() => setMontoPago(String(amount))} className="py-1 rounded bg-gray-100 border border-gray-200 hover:bg-gray-200 font-mono font-black text-[10px] text-gray-700 cursor-pointer">
                    {amount}
                  </button>
                ))}
              </div>

              {selectedJuego === "Fechas" && (
                <div className="mt-3 grid grid-cols-2 gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <div>
                    <label className="block text-[9px] font-mono font-bold text-gray-500 uppercase mb-1">DÍA (1-31)</label>
                    <select value={numeroJugado.split("-")[0] || "01"} onChange={(e) => { const month = numeroJugado.split("-")[1] || "Enero"; setNumeroJugado(\`\${e.target.value.padStart(2, "0")}-\${month}\`); }} className="w-full p-2 border-2 border-gray-200 rounded-xl bg-white font-mono text-xs font-bold focus:outline-none focus:border-blue-900 cursor-pointer">
                      {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map(day => (<option key={day} value={day}>{day}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-mono font-bold text-gray-500 uppercase mb-1">MES</label>
                    <select value={numeroJugado.split("-")[1] || "Enero"} onChange={(e) => { const day = numeroJugado.split("-")[0] || "01"; setNumeroJugado(\`\${day}-\${e.target.value}\`); }} className="w-full p-2 border-2 border-gray-200 rounded-xl bg-white font-sans text-xs font-bold focus:outline-none focus:border-blue-900 cursor-pointer">
                      {["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"].map(mes => (<option key={mes} value={mes}>{mes}</option>))}
                    </select>
                  </div>
                </div>
              )}

              <div className="mt-2">
                <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">Cliente</label>
                <input type="text" value={nombreCliente} onChange={(e) => setNombreCliente(e.target.value)} placeholder="Genérico" className="w-full p-2 rounded-xl border-2 border-gray-200 text-xs font-semibold focus:outline-none focus:border-blue-900 bg-gray-50 text-gray-900" />
              </div>
            </div>

            {isLimitBlocked && limitCheckResult && (
              <div id="monto-max-alerta" className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start space-x-2 text-xs text-red-950 font-sans font-bold shadow-xs animate-pulse">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <span>NÚMERO BLOQUEADO: Límite C$ {limitCheckResult.limitMontoCs.toLocaleString("es-ES")}. Vendido: C$ {limitCheckResult.totalPrevSalesCs.toLocaleString("es-ES")}.</span>
              </div>
            )}

            {selectedJuego !== "Fechas" && (
              <div className="bg-gray-800/95 p-3 rounded-2xl border border-gray-700 shadow-md">
                <div className="grid grid-cols-3 gap-2 text-white">
                  {["1","2","3","4","5","6","7","8","9"].map(key => (
                    <button key={key} onClick={() => handleKeypadPress(key)} className="py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 rounded-xl font-display font-black text-2xl border-b-2 border-gray-900 select-none cursor-pointer text-center">{key}</button>
                  ))}
                  <button onClick={() => handleKeypadPress("BORRAR")} className="py-3 bg-red-800/90 hover:bg-red-700 text-white rounded-xl font-display font-bold text-xs uppercase border-b-2 border-red-950 select-none cursor-pointer flex items-center justify-center">Borrar</button>
                  <button onClick={() => handleKeypadPress("0")} className="py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-display font-black text-2xl border-b-2 border-gray-900 select-none cursor-pointer text-center">0</button>
                  <button onClick={() => handleKeypadPress("BACKSPACE")} className="py-3 bg-gray-600 hover:bg-gray-500 text-white rounded-xl font-display font-black text-lg border-b-2 border-gray-900 select-none cursor-pointer flex items-center justify-center">←</button>
                </div>
              </div>
            )}

            {jugadas.length > 0 && (
              <div className="bg-white border-2 border-blue-100 rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-blue-900 px-3 py-2 flex justify-between items-center">
                  <span className="text-white text-[10px] font-display font-black uppercase tracking-wider">Carrito — {jugadas.length} jugada(s)</span>
                  <button onClick={() => setJugadas([])} className="text-blue-200 hover:text-white text-[9px] font-bold uppercase cursor-pointer">Limpiar</button>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-display font-black text-gray-500 uppercase text-[9px]">Num</th>
                      <th className="text-right px-3 py-1.5 font-display font-black text-gray-500 uppercase text-[9px]">Monto</th>
                      <th className="text-right px-3 py-1.5 font-display font-black text-gray-500 uppercase text-[9px]">Premio</th>
                      <th className="px-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {jugadas.map((j, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-black text-blue-900 text-sm">{j.numero}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-800">{moneda} {j.monto.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-emerald-600">C$ {j.premio_posible.toFixed(2)}</td>
                        <td className="px-2 py-2">
                          <button onClick={() => setJugadas(prev => prev.filter((_, i) => i !== idx))} className="p-1 bg-red-50 hover:bg-red-100 text-red-500 rounded cursor-pointer">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-blue-50 border-t-2 border-blue-100">
                    <tr>
                      <td className="px-3 py-2 font-display font-black text-blue-900 text-[10px] uppercase">TOT</td>
                      <td className="px-3 py-2 text-right font-mono font-black text-blue-900">{moneda} {totalTicketMonto.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono font-black text-emerald-600">C$ {totalTicketPremio.toFixed(2)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            <button
              onClick={handleGenerarTicket}
              disabled={loading || jugadas.length === 0}
              className={\`w-full py-4 rounded-2xl bg-[#10B981] hover:bg-[#0E9F6E] text-white font-display font-black text-base tracking-widest uppercase border-b-4 border-emerald-950 shadow-md flex items-center justify-center space-x-2 select-none active:translate-y-0.5 active:border-b-2 transition-all cursor-pointer \${(loading || jugadas.length === 0) ? "opacity-50 cursor-not-allowed" : ""}\`}
            >
              {loading ? <span>GENERANDO...</span> : (
                <>
                  <span>GENERAR TICKET</span>
                  {jugadas.length > 0 && <span className="bg-white/20 rounded-full px-2 py-0.5 text-sm">{jugadas.length}</span>}
                </>
              )}
            </button>
          </div>
        )}

`;

content = content.replace(ventaTabRegex, newVentaTab);


// 2. Insert the Boleto Tab before the Bottom Navigation
const navInjectionPointRegex = /\{\/\* Bottom Navigation Bar \*\/\}/;
const boletoTabCode = `
        {/* TAB 4: BOLETO */}
        {activeTab === "boleto" && (
          <div className="space-y-4 animate-fade-in">
            <div className="border-b border-gray-200 pb-2">
              <h3 className="font-display font-black text-sm text-gray-800 uppercase tracking-wider">Gestión de Boletos</h3>
              <p className="text-[10px] text-gray-400 font-sans mt-0.5">Busca, verifica y reutiliza tickets anteriores.</p>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-3 shadow-xs">
              <label className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-2">ID, Número o Firma</label>
              <div className="flex space-x-2">
                <input type="text" value={boletoSearchInput}
                  onChange={(e) => setBoletoSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleBoletoSearch(boletoSearchInput); }}
                  placeholder="Ej. 0001045 o A9X-2M..."
                  className="flex-1 text-sm p-2.5 border-2 border-gray-200 rounded-xl font-mono font-bold text-gray-800 focus:outline-none focus:border-blue-900" />
                <button onClick={() => handleBoletoSearch(boletoSearchInput)}
                  disabled={boletoLoading || !boletoSearchInput.trim()}
                  className="px-4 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold flex items-center space-x-1 cursor-pointer disabled:opacity-50">
                  <Search className="w-4 h-4" /><span className="text-xs">Buscar</span>
                </button>
              </div>
              {boletoError && (
                <div className="mt-2 text-[10px] text-red-600 font-medium flex items-center space-x-1">
                  <AlertCircle className="w-3 h-3" /><span>{boletoError}</span>
                </div>
              )}
              {boletoLoading && (
                <div className="mt-3 flex items-center space-x-2 text-blue-700 text-xs">
                  <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-700 rounded-full animate-spin"></div>
                  <span>Buscando boleto...</span>
                </div>
              )}
            </div>

            {boletoFound && (
              <div className="bg-white border-2 border-blue-100 rounded-2xl overflow-hidden shadow-sm">
                <div className={\`px-4 py-3 flex justify-between items-start \${boletoFound.anulado ? 'bg-red-800' : 'bg-blue-900'}\`}>
                  <div>
                    <span className="text-white font-display font-black text-sm">Ticket #{boletoFound.numero_ticket}</span>
                    <span className="block text-blue-200 text-[10px] font-mono mt-0.5">{new Date(boletoFound.timestamp_servidor).toLocaleString("es-ES")}</span>
                  </div>
                  <div className="text-right">
                    <span className={\`text-[10px] font-black uppercase px-2 py-0.5 rounded \${boletoFound.anulado ? 'bg-red-600 text-white' : 'bg-emerald-500 text-white'}\`}>
                      {boletoFound.anulado ? "ANULADO" : "ACTIVO"}
                    </span>
                    <span className="block text-blue-200 text-[10px] font-mono mt-1">Firma: {boletoFound.firma_digital}</span>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-gray-50 p-2 rounded-lg">
                      <span className="block text-[9px] text-gray-500 uppercase font-black tracking-wider">Juego</span>
                      <span className="font-mono font-black text-gray-900">{boletoFound.juego}</span>
                    </div>
                    <div className="bg-gray-50 p-2 rounded-lg">
                      <span className="block text-[9px] text-gray-500 uppercase font-black tracking-wider">Monto</span>
                      <span className="font-mono font-black text-blue-900">{boletoFound.moneda} {boletoFound.monto_pago.toFixed(2)}</span>
                    </div>
                  </div>

                  {boletoFound.jugadas && boletoFound.jugadas.length > 0 ? (
                    <div>
                      <span className="block text-[9px] font-display font-black text-gray-500 uppercase tracking-wider mb-1">Jugadas ({boletoFound.jugadas.length})</span>
                      <table className="w-full text-xs border border-gray-200 rounded-xl overflow-hidden">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="text-left px-3 py-1.5 font-black text-gray-500 uppercase text-[9px]">Número</th>
                            <th className="text-right px-3 py-1.5 font-black text-gray-500 uppercase text-[9px]">Monto</th>
                            <th className="text-right px-3 py-1.5 font-black text-gray-500 uppercase text-[9px]">Premio</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {boletoFound.jugadas.map((j, i) => (
                            <tr key={i}><td className="px-3 py-2 font-mono font-black text-blue-900">{j.numero}</td><td className="px-3 py-2 text-right font-mono text-gray-800">{boletoFound.moneda} {j.monto.toFixed(2)}</td><td className="px-3 py-2 text-right font-mono text-emerald-600">C$ {j.premio_posible.toFixed(2)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 flex justify-between items-center">
                      <span className="text-[9px] font-black text-yellow-700 uppercase">Número</span>
                      <span className="font-mono font-black text-yellow-900 text-sm">{boletoFound.numero_jugado}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                    <button onClick={() => setActiveTicket(boletoFound)}
                      className="flex flex-col items-center justify-center py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 rounded-xl text-[9px] font-black uppercase tracking-wide cursor-pointer space-y-1">
                      <QrCode className="w-4 h-4" /><span>Reimprimir</span>
                    </button>
                    <button onClick={() => handleVolverAJugar(boletoFound)}
                      className="flex flex-col items-center justify-center py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-xl text-[9px] font-black uppercase tracking-wide cursor-pointer space-y-1">
                      <ArrowRight className="w-4 h-4" /><span>Volver Jugar</span>
                    </button>
                  </div>

                  {!boletoFound.anulado && (() => {
                    const sorteoObj = config.sorteos.find(s => s.nombre === boletoFound.sorteo && s.juego === boletoFound.juego);
                    return (sorteoObj && !isSorteoCerrado(sorteoObj)) ? (
                      <button onClick={() => { handleAnularTicket(boletoFound.id); setBoletoFound(null); }}
                        className="w-full mt-1 py-2.5 bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 rounded-xl text-xs font-black uppercase tracking-wide flex items-center justify-center space-x-2 cursor-pointer">
                        <X className="w-4 h-4 stroke-[3]" /><span>Anular Boleto</span>
                      </button>
                    ) : null;
                  })()}
                </div>
              </div>
            )}

          </div>
        )}
`;

content = content.replace(navInjectionPointRegex, boletoTabCode + "\n      {/* Bottom Navigation Bar */}");


// 3. Update the Nav Bar to have 4 buttons (add Boleto)
const navBarRegex = /\{\/\* Bottom Navigation Bar \*\/\}[\s\S]*?(?=\{\/\* Ticket Viewer Modal \*\/)/m;

const newNavBar = `\{/* Bottom Navigation Bar */\}
      <div className="bg-white border-t border-gray-300 py-1 px-2 flex justify-between items-center z-10">
        <button id="nav-venta" onClick={() => { setActiveTab("venta"); setErrorMessage(null); setSuccessMessage(null); }} className={\`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer \${activeTab === "venta" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}\`}>
          <Gamepad2 className={\`w-5 h-5 stroke-[2.5] \${activeTab === "venta" ? "text-[#1E3A8A]" : ""}\`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Venta</span>
        </button>
        <button id="nav-boleto" onClick={() => { setActiveTab("boleto"); setErrorMessage(null); setSuccessMessage(null); }} className={\`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer \${activeTab === "boleto" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}\`}>
          <Ticket className={\`w-5 h-5 stroke-[2.5] \${activeTab === "boleto" ? "text-[#1E3A8A]" : ""}\`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Boleto</span>
        </button>
        <button id="nav-historial" onClick={() => { setActiveTab("historial"); setErrorMessage(null); setSuccessMessage(null); onRefreshSales(); }} className={\`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer \${activeTab === "historial" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}\`}>
          <History className={\`w-5 h-5 stroke-[2.5] \${activeTab === "historial" ? "text-[#1E3A8A]" : ""}\`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Historial</span>
        </button>
        <button id="nav-pagos" onClick={() => { setActiveTab("pagos"); setErrorMessage(null); setSuccessMessage(null); }} className={\`flex flex-col items-center flex-1 py-1 px-1 text-center transition-all cursor-pointer \${activeTab === "pagos" ? "text-[#1E3A8A] scale-105" : "text-gray-400 hover:text-gray-600"}\`}>
          <CheckCircle className={\`w-5 h-5 stroke-[2.5] \${activeTab === "pagos" ? "text-[#1E3A8A]" : ""}\`} />
          <span className="text-[9px] font-display font-black uppercase tracking-wider mt-0.5">Pagos</span>
        </button>
      </div>

      `;
content = content.replace(navBarRegex, newNavBar);


fs.writeFileSync('src/components/VendedorInterface.tsx', content);
console.log('Script ran successfully');
