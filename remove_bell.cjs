const fs = require('fs');
let c = fs.readFileSync('src/components/AdminInterface.tsx', 'utf8');
const bellRegex = /\{\/\* Bell Icon Notification Button \*\/\}[\s\S]*?(?=<button\s+id="download-thermal-report-btn")/m;
c = c.replace(bellRegex, '');
fs.writeFileSync('src/components/AdminInterface.tsx', c);
console.log('Removed duplicate bell');
