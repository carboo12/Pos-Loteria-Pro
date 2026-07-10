const fs = require('fs');

let adminContent = fs.readFileSync('src/components/AdminInterface.tsx', 'utf-8');

// The bell block is inside the "Quick Action Controls"
// Let's replace the EXACT bell block that exists right now from line 1470 to 1549

const bellRegex = /\{\/\* Bell Icon Notification Button \*\/\}[\s\S]*?(?=<button\s+id="download-thermal-report-btn")/m;

const bellMatch = adminContent.match(bellRegex);

if (bellMatch) {
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
  
  // Replace the closing div of the dropdown.
  // The end of the dropdown is right before:
  //                 </div>
  //               )}
  //             </div>
  // 
  // Let's find that exact ending:
  const endRegex = /<\/div>\s*\}\)\s*\}\s*<\/div>\s*<div className="p-2 bg-gray-50 text-center border-t border-gray-100">\s*<span className="text-\[9px\] text-gray-400 font-mono tracking-widest uppercase font-bold">FCM \/ SSE en Vivo<\/span>\s*<\/div>\s*<\/div>\s*\)\}/;
  
  bellCode = bellCode.replace(
    endRegex,
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

  // Inject the portal near the bottom of AdminInterface, above {/* Qr Scanner Modal */}
  adminContent = adminContent.replace(
    '{/* Qr Scanner Modal */}',
    portalCode + '\n      {/* Qr Scanner Modal */}'
  );
}

// 1. Add createPortal import
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

fs.writeFileSync('src/components/AdminInterface.tsx', adminContent);
console.log('AdminInterface nav patched successfully again.');
