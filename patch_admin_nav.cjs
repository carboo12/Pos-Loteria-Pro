const fs = require('fs');

let adminContent = fs.readFileSync('src/components/AdminInterface.tsx', 'utf-8');

// 1. Add Import
if (!adminContent.includes('createPortal')) {
  adminContent = adminContent.replace(
    'import { useState, useEffect, FormEvent } from "react";',
    'import { useState, useEffect, FormEvent } from "react";\nimport { createPortal } from "react-dom";'
  );
}

// 2. Add notifSlot state
if (!adminContent.includes('const [notifSlot, setNotifSlot]')) {
  adminContent = adminContent.replace(
    'const [isSidebarOpen, setIsSidebarOpen] = useState(false);',
    'const [isSidebarOpen, setIsSidebarOpen] = useState(false);\n  const [notifSlot, setNotifSlot] = useState<HTMLElement | null>(null);\n  useEffect(() => { setNotifSlot(document.getElementById("navbar-notification-slot")); }, []);'
  );
}

// 3. Move the notification block to the Portal, somewhere safe (like near the end of <main>)
// First extract the block from lines 1470 to 1549:
// Instead of hardcoding lines, let's use regex to find the block
const bellRegex = /\{\/\* Bell Icon Notification Button \*\/\}[\s\S]*?(?=<button\s+id="download-thermal-report-btn")/m;

const bellMatch = adminContent.match(bellRegex);
if (bellMatch && !adminContent.includes('notifSlot && createPortal')) {
  let bellCode = bellMatch[0];
  
  // Remove the old block from the header actions
  adminContent = adminContent.replace(bellMatch[0], '');
  
  // Wrap the dropdown in motion.div
  bellCode = bellCode.replace(
    /<div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl border border-gray-300 shadow-xl z-50 text-gray-800 overflow-hidden animate-fade-in">/,
    `<AnimatePresence>
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: -10 }} 
                  animate={{ opacity: 1, scale: 1, y: 0 }} 
                  exit={{ opacity: 0, scale: 0.95, y: -10 }}
                  className="absolute right-0 mt-2 w-80 bg-white rounded-2xl border border-gray-300 shadow-xl z-50 text-gray-800 overflow-hidden"
                >`
  );
  
  // Replace the closing div of the dropdown (it's the second to last closing div in the block)
  // Let's replace the precise closing div of showNotifHub
  bellCode = bellCode.replace(
    /<\/div>\s*\}\)\s*\}\s*<\/div>\s*<div className="p-2 bg-gray-50 text-center border-t border-gray-100">\s*<span className="text-\[9px\] text-gray-400 font-mono tracking-widest uppercase font-bold">FCM \/ SSE en Vivo<\/span>\s*<\/div>\s*<\/div>\s*\)\}/,
    `</div>\n                  )}\n                  </div>\n                  <div className="p-2 bg-gray-50 text-center border-t border-gray-100">\n                    <span className="text-[9px] text-gray-400 font-mono tracking-widest uppercase font-bold">FCM / SSE en Vivo</span>\n                  </div>\n                </motion.div>\n              </AnimatePresence>\n              )}`
  );

  const portalCode = `
      {/* Notification Portal */}
      {notifSlot && createPortal(
        <div className="relative flex items-center justify-center">
          ${bellCode.trim()}
        </div>,
        notifSlot
      )}
  `;

  // Inject the portal near the bottom of AdminInterface, above {/* Ticket Viewer Modal */}
  adminContent = adminContent.replace(
    '{/* Qr Scanner Modal */}',
    portalCode + '\n      {/* Qr Scanner Modal */}'
  );
}

fs.writeFileSync('src/components/AdminInterface.tsx', adminContent);
console.log('AdminInterface nav patched successfully.');
