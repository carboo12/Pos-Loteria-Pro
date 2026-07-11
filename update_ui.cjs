const fs = require('fs');
let content = fs.readFileSync('src/components/VendedorInterface.tsx', 'utf8');

// 1. Add states and new functions before handleTicketQrSearch
const stateInjectionPoint = "const [paymentResult, setPaymentResult] = useState<{ganador: boolean, message: string, monto: number} | null>(null);";
const stateInjectionCode = `
  // --- NEW MULTI-NUMBER CART STATE ---
  const [jugadas, setJugadas] = useState<import('../types').Jugada[]>([]);
  const totalTicketMonto = jugadas.reduce((acc, j) => acc + j.monto, 0);
  const totalTicketPremio = jugadas.reduce((acc, j) => acc + j.premio_posible, 0);

  // --- NEW BOLETO SEARCH STATE ---
  const [boletoSearchInput, setBoletoSearchInput] = useState("");
  const [boletoLoading, setBoletoLoading] = useState(false);
  const [boletoError, setBoletoError] = useState<string | null>(null);
  const [boletoFound, setBoletoFound] = useState<import('../types').Venta | null>(null);

  const addJugadaAlCarrito = () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!numeroJugado) {
      setErrorMessage("Ingrese un número válido para jugar.");
      return;
    }
    const numericAmount = Number(montoPago);
    if (!montoPago || isNaN(numericAmount) || numericAmount <= 0) {
      setErrorMessage("Ingrese un monto válido mayor a cero.");
      return;
    }
    if (!selectedSorteo) {
      setErrorMessage("No hay sorteos activos seleccionados.");
      return;
    }

    if (isLimitBlocked && limitCheckResult) {
      setErrorMessage(\`NÚMERO BLOQUEADO: Límite de C$ \${limitCheckResult.limitMontoCs.toLocaleString("es-ES")} alcanzado.\`);
      return;
    }

    const matchingSorteo = config.sorteos.find(s => s.nombre === selectedSorteo);
    if (matchingSorteo && isSorteoCerrado(matchingSorteo)) {
      setErrorMessage(\`BLOQUEADO: El sorteo \${selectedSorteo} ya cerró.\`);
      return;
    }

    const multiplier = calculatePrizeMultiplier(selectedJuego, selectedSorteo);
    const montoInCs = moneda === "USD" ? numericAmount * (config.tasa_cambio || 36.50) : numericAmount;
    const premioPosibleCs = montoInCs * multiplier;

    const nuevaJugada = {
      numero: numeroJugado,
      monto: numericAmount,
      premio_posible: premioPosibleCs
    };

    setJugadas([...jugadas, nuevaJugada]);
    setNumeroJugado("");
    setMontoPago("");
    if (montoInputRef.current) montoInputRef.current.focus();
  };

  const handleBoletoSearch = async (query: string) => {
    setBoletoError(null);
    setBoletoFound(null);
    if (!query.trim()) return;

    setBoletoLoading(true);
    let targetNum = query;
    let targetFirma = "";

    if (query.includes("ticket=")) {
      try {
        const urlObj = new URL(query);
        targetNum = urlObj.searchParams.get("ticket") || targetNum;
        targetFirma = urlObj.searchParams.get("firma") || targetFirma;
      } catch (err) {
        const tMatch = query.match(/[?&]ticket=([^&]+)/);
        const fMatch = query.match(/[?&]firma=([^&]+)/);
        if (tMatch) targetNum = tMatch[1];
        if (fMatch) targetFirma = fMatch[1];
      }
    }
    const cleanNum = targetNum.replace(/^#/, "").trim();

    try {
      const foundInCache = sales.find(s => 
        s.id === cleanNum || s.numero_ticket === cleanNum || 
        (s.firma_digital && s.firma_digital.toUpperCase() === cleanNum.toUpperCase()) ||
        (targetFirma && s.firma_digital && s.firma_digital.toUpperCase() === targetFirma.toUpperCase())
      );

      if (foundInCache) {
        setBoletoFound(foundInCache);
      } else {
        const res = await fetch(\`/api/ventas?ticket=\${cleanNum}\`);
        if (!res.ok) throw new Error("Error en red");
        const data = await res.json();
        if (data && data.length > 0) {
          setBoletoFound(data[0]);
        } else {
          setBoletoError(\`No se encontró boleto con el ID/Firma: "\${query}"\`);
        }
      }
    } catch (err) {
      setBoletoError(\`Error al buscar boleto: \${query}\`);
    } finally {
      setBoletoLoading(false);
    }
  };

  const handleVolverAJugar = (boleto: import('../types').Venta) => {
    // Clone logic: switch to Venta tab and clone game/sorteo/numbers
    setActiveTab("venta");
    setSelectedPais(boleto.juego === "Sabadito" ? "Nicaragua" : "Nicaragua"); // Simplified mapping for cloned
    setSelectedJuego(boleto.juego);
    setMoneda(boleto.moneda);
    setNombreCliente(boleto.nombre_cliente || "Genérico");
    
    // Attempt to set Sorteo if it's still available
    const sorteosActivos = getSorteosByGame(boleto.juego);
    const todaviaAbierto = sorteosActivos.some(s => s.nombre === boleto.sorteo && !isSorteoCerrado(s));
    if (todaviaAbierto) {
      setSelectedSorteo(boleto.sorteo);
    } else if (sorteosActivos.length > 0) {
      // Pick first open if previous is closed
      setSelectedSorteo(sorteosActivos[0].nombre);
    }

    if (boleto.jugadas && boleto.jugadas.length > 0) {
      setJugadas([...boleto.jugadas]);
    } else {
      // Legacy single number clone
      setJugadas([{
        numero: boleto.numero_jugado,
        monto: boleto.monto_pago,
        premio_posible: boleto.premio_posible_cs || 0
      }]);
    }
  };
`;

content = content.replace(stateInjectionPoint, stateInjectionPoint + "\n" + stateInjectionCode);


// 2. Modify handleGenerarTicket to send jugadas array and use its aggregate totals
const handleGenerarNew = `
  const handleGenerarTicket = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);
    
    if (jugadas.length === 0) {
      setErrorMessage("Agregue al menos una jugada al carrito.");
      return;
    }
    if (!selectedSorteo) {
      setErrorMessage("Seleccione un sorteo válido.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          juego: selectedJuego,
          sorteo: selectedSorteo,
          jugadas: jugadas,
          numero_jugado: "MULTI", // Legacy field for single-number views
          monto_pago: totalTicketMonto, // Aggregate total
          moneda: moneda,
          id_vendedor: user.id,
          nombre_cliente: nombreCliente.trim() || "Genérico",
          premio_posible_cs: totalTicketPremio
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Error al procesar la venta");
      }

      const data = await response.json();
      setActiveTicket(data.ticket);
      setSuccessMessage("¡Ticket emitido con éxito!");
      
      // Notificamos actualización de límite al top-level
      onNewSaleCreated(data.ticket);

      // Limpiamos formularios
      setJugadas([]);
      setNumeroJugado("");
      setMontoPago("");
      setNombreCliente("Genérico");
      
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err.message || "No se pudo conectar con el servidor para emitir el ticket.");
    } finally {
      setLoading(false);
    }
  };
`;

// Extract old handleGenerarTicket entirely and replace it.
const regexHandleGenerar = /const handleGenerarTicket = async \(\) => \{[\s\S]*?\n  \};\n/m;
content = content.replace(regexHandleGenerar, handleGenerarNew + "\n");

// 3. Write back changes
fs.writeFileSync('src/components/VendedorInterface.tsx', content);
console.log('Script ran successfully');
