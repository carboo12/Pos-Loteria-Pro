const fs = require('fs');
let content = fs.readFileSync('src/components/SupervisorInterface.tsx', 'utf8');

if (!content.includes('import { AnimatePresence, motion }') && !content.includes('import { motion, AnimatePresence }')) {
  // Try adding framer-motion imports if missing
  content = content.replace(/import \{ Usuario, Configuracion, Venta, CierreCaja, CobroVendedor \} from "\.\.\/types";/, 'import { Usuario, Configuracion, Venta, CierreCaja, CobroVendedor } from "../types";\nimport { motion, AnimatePresence } from "framer-motion";');
}

// Add state variables and logic
const stateInjectionCode = `
  // --- NUEVOS ESTADOS: Liquidación en Ruta ---
  const [fechaInicioLiquidacion, setFechaInicioLiquidacion] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7); // Default a últimos 7 días
    return d.toISOString().split("T")[0];
  });
  const [fechaFinLiquidacion, setFechaFinLiquidacion] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [selectedVendedorLiquidacion, setSelectedVendedorLiquidacion] = useState<string>("");
  const [resumenesLiquidacion, setResumenesLiquidacion] = useState<any[]>([]);
  const [loadingLiquidacion, setLoadingLiquidacion] = useState(false);
  const [showCobroModal, setShowCobroModal] = useState(false);

  // Calcula totales a cobrar
  const totalVendidoLiq = resumenesLiquidacion.reduce((sum, r) => sum + r.vendido, 0);
  const totalPagadoLiq = resumenesLiquidacion.reduce((sum, r) => sum + r.pagado, 0);
  const totalNetoLiq = totalVendidoLiq - totalPagadoLiq;

  const fetchResumenesLiquidacion = async () => {
    if (!selectedVendedorLiquidacion) {
      setErrorMessage("Por favor seleccione un vendedor.");
      return;
    }
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoadingLiquidacion(true);
    try {
      const response = await fetch("/api/finanzas/cierres/rango", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_vendedor: selectedVendedorLiquidacion,
          fecha_inicio: fechaInicioLiquidacion,
          fecha_fin: fechaFinLiquidacion
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Fallo al consultar resumenes");
      
      if (data.resumenes.length === 0) {
        setErrorMessage(data.mensaje || "No hay saldo pendiente por liquidar en este rango.");
      } else {
        setSuccessMessage(\`Consultado con éxito. \${data.resumenes.length} día(s) pendientes.\`);
      }
      setResumenesLiquidacion(data.resumenes);
    } catch (err: any) {
      setErrorMessage(err.message || "Error al conectar con servidor.");
      setResumenesLiquidacion([]);
    } finally {
      setLoadingLiquidacion(false);
    }
  };

  const handleProcesarLiquidacion = async () => {
    if (resumenesLiquidacion.length === 0 || !selectedVendedorLiquidacion) return;
    setLoadingLiquidacion(true);
    setErrorMessage(null);
    try {
      const payload = {
        id_supervisor: user.id,
        id_vendedor: selectedVendedorLiquidacion,
        rango_inicio: fechaInicioLiquidacion,
        rango_fin: fechaFinLiquidacion,
        dias_cerrados: resumenesLiquidacion.map(r => ({ id: r.id })),
        total_vendido: totalVendidoLiq,
        total_pagado: totalPagadoLiq,
        total_neto: totalNetoLiq
      };

      const res = await fetch("/api/cobros/procesar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al procesar cobro");

      setSuccessMessage(\`Cobro de C$ \${totalNetoLiq.toLocaleString("es-ES")} procesado correctamente.\`);
      setResumenesLiquidacion([]); // Limpiar para evitar doble submit
      setShowCobroModal(false);
      
      // Refrescar cobros generales y cierres para actualizar vistas
      await handleRefreshAll();
    } catch (err: any) {
      setErrorMessage(err.message || "Fallo al procesar el cobro.");
    } finally {
      setLoadingLiquidacion(false);
    }
  };
`;

const stateInjectionPoint = "const [timeText, setTimeText] = useState(\"\");";
content = content.replace(stateInjectionPoint, stateInjectionCode + "\n  " + stateInjectionPoint);

fs.writeFileSync('src/components/SupervisorInterface.tsx', content);
console.log('States injected.');
