const fs = require('fs');

let content = fs.readFileSync('src/components/AdminInterface.tsx', 'utf-8');

// 1. Add Import
if (!content.includes('import { QrScannerModal }')) {
  content = content.replace(
    'import TicketPreviewModal from "./TicketPreviewModal";',
    'import TicketPreviewModal from "./TicketPreviewModal";\nimport { QrScannerModal } from "./QrScannerModal";'
  );
}

// 2. Add State
if (!content.includes('const [isScannerOpen, setIsScannerOpen]')) {
  content = content.replace(
    'const [qrSearchInput, setQrSearchInput] = useState("");',
    'const [qrSearchInput, setQrSearchInput] = useState("");\n  const [isScannerOpen, setIsScannerOpen] = useState(false);'
  );
}

// 3. Inject Modal (Safely before TicketViewerModal)
if (!content.includes('<QrScannerModal')) {
  content = content.replace(
    '{/* Ticket Viewer Modal */}',
    `{/* Qr Scanner Modal */}
      {isScannerOpen && (
        <QrScannerModal
          onScan={(data) => {
            setQrSearchInput(data);
            setIsScannerOpen(false);
          }}
          onClose={() => setIsScannerOpen(false)}
        />
      )}

      {/* Ticket Viewer Modal */}`
  );
}

// 4. Refactor the form
const formStart = '<form onSubmit={handleTicketQrSearch} className="flex gap-2 max-w-2xl">';
const formRegex = /<form onSubmit=\{handleTicketQrSearch\} className="flex gap-2 max-w-2xl">[\s\S]*?<\/form>/;

if (content.match(formRegex) && !content.includes('onClick={() => setIsScannerOpen(true)}')) {
  const newForm = `<form onSubmit={handleTicketQrSearch} className="flex gap-2 max-w-2xl">
            <div className="relative flex-1">
              <input
                type="text"
                value={qrSearchInput}
                onChange={(e) => setQrSearchInput(e.target.value)}
                placeholder="Ingrese ID de ticket o enlace del código QR (Presione Enter)..."
                className="w-full pl-9 pr-10 py-2.5 min-h-[44px] bg-gray-50 border border-gray-300 rounded-xl text-xs font-sans font-medium text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
              />
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-[14px]" />
              {/* Lupa para forzar submit si no quieren presionar enter */}
              <button type="submit" className="absolute right-2 top-2 p-1.5 text-gray-400 hover:text-blue-600 transition-colors cursor-pointer">
                <Search className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="px-5 py-2.5 min-h-[44px] bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-display font-black tracking-wider uppercase transition-colors flex items-center justify-center space-x-2 cursor-pointer shadow-sm shrink-0"
            >
              <QrCode className="w-4 h-4" />
              <span>Verificar QR / ID</span>
            </button>
          </form>`;
          
  content = content.replace(formRegex, newForm);
}

fs.writeFileSync('src/components/AdminInterface.tsx', content);
console.log('AdminInterface patched successfully.');
