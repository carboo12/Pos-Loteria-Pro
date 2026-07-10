const fs = require('fs');
let lines = fs.readFileSync('src/App.tsx', 'utf-8').split('\n');

const loginSuccessIndex = lines.findIndex(l => l.includes('onLoginSuccess={(u) => setCurrentUser(u)}'));
if (loginSuccessIndex !== -1) {
  lines[loginSuccessIndex] = `            <Login users={users} onLoginSuccess={(u) => {
              setCurrentUser(u);
              // [FASE 3] Get or Create resumen_diario at startup
              if (u.rol === 'vendedor') {
                fetch("/api/resumen-diario/init", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id_vendedor: u.id, nombre_vendedor: u.nombre })
                }).catch(e => console.error("Error init resumen diario:", e));
              }
            }} />`;
}

fs.writeFileSync('src/App.tsx', lines.join('\n'));
console.log('App.tsx updated');
