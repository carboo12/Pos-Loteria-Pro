const fs = require('fs');
let code = fs.readFileSync('src/components/AdminInterface.tsx', 'utf8');

// 1. Sidebar Button
code = code.replace(/<button\s+id="sidebar-cierres"[\s\S]*?<\/button>\s*/m, '');

// 2. Headings
code = code.replace(/\{activeSection === "cierres" && "Bandeja de Cierres de Caja"\}\s*/g, '');
code = code.replace(/\{activeSection === "cierres" && "Auditoría de arqueos reportados por vendedores en calle comparados con balances de sistema\."\}\s*/g, '');

// 3. Main block
const startIdx = code.indexOf('{/* SECTION 2: BANDERA DE CIERRES */}');
const endIdx = code.indexOf('{/* SECTION 3: CONFIGURACIÓN SISTEMA */}');

if (startIdx !== -1 && endIdx !== -1) {
  code = code.substring(0, startIdx) + code.substring(endIdx);
}

// 4. Also remove the widget button for "Arqueos Pendientes" in Dashboard
const widgetStart = code.indexOf('{/* Widget 3: Arqueos Pendientes */}');
const widgetEnd = code.indexOf('{/* Widget 4: Tickets Emitidos */}');
if (widgetStart !== -1 && widgetEnd !== -1) {
  code = code.substring(0, widgetStart) + code.substring(widgetEnd);
}

fs.writeFileSync('src/components/AdminInterface.tsx', code);
console.log('Removed Cierres successfully.');
