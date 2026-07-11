const fs = require('fs');
let content = fs.readFileSync('src/components/VendedorInterface.tsx', 'utf8');

// Fix 1: Type imports
content = content.replace("useState<import('../types').Jugada[]>", "useState<Jugada[]>");
content = content.replace("useState<import('../types').Venta | null>", "useState<Venta | null>");
content = content.replace("handleVolverAJugar = (boleto: import('../types').Venta)", "handleVolverAJugar = (boleto: Venta)");

// Fix top imports to include Jugada
if (!content.includes('Jugada')) {
  content = content.replace('import { Usuario, Configuracion, Venta, Sorteo } from "../types";', 'import { Usuario, Configuracion, Venta, Sorteo, Jugada } from "../types";');
}

// Fix 2: Remove the duplicated old Tab 1. 
const lines = content.split('\n');

let oldTabStart = -1;
let oldTabEnd = -1;

for (let i = 1000; i < lines.length; i++) {
  if (lines[i].includes('0. Country Selector') && oldTabStart === -1) {
    oldTabStart = i - 3; 
  }
  if (lines[i].includes('{/* TAB 2: HISTORIAL */}')) {
    oldTabEnd = i - 1;
    break;
  }
}

if (oldTabStart !== -1 && oldTabEnd !== -1) {
  lines.splice(oldTabStart, oldTabEnd - oldTabStart + 1);
}

fs.writeFileSync('src/components/VendedorInterface.tsx', lines.join('\n'));
console.log('Fixed successfully');
