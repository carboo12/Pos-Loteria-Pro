const fs = require('fs');

let code = fs.readFileSync('src/components/AdminInterface.tsx', 'utf8');

const target1 = `      const data = await res.json();
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

const repl1 = `      const data = await res.json();
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

code = code.replace(target1, repl1);

fs.writeFileSync('src/components/AdminInterface.tsx', code);
console.log('Fixed block 1');
