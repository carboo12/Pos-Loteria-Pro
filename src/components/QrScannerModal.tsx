import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera, AlertTriangle, Loader2 } from "lucide-react";
import jsQR from "jsqr";

interface QrScannerModalProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

export function QrScannerModal({ onScan, onClose }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<number>();

  useEffect(() => {
    let active = true;

    const startCamera = async () => {
      try {
        if (!window.isSecureContext) {
          setError("La cámara requiere una conexión segura (HTTPS). Si estás en desarrollo local, usa un túnel como ngrok o configura certificados SSL locales.");
          setLoading(false);
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
          setLoading(false);
          requestRef.current = requestAnimationFrame(tick);
        }
      } catch (err: any) {
        if (active) {
          console.error("Camera error:", err);
          setLoading(false);
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setError("Permiso de cámara denegado. Ve a la configuración de Chrome/Navegador en tu celular, busca 'Configuración de sitios' y permite el acceso a la cámara para esta página.");
          } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setError("No se encontró ninguna cámara en este dispositivo.");
          } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            setError("La cámara está siendo usada por otra aplicación. Cierra otras apps e intenta de nuevo.");
          } else {
            setError(`Error al abrir la cámara: ${err.message}`);
          }
        }
      }
    };

    const tick = () => {
      if (!active || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
          
          if (code && code.data) {
            onScan(code.data);
            return; // Stop ticking, we found the QR
          }
        }
      }
      requestRef.current = requestAnimationFrame(tick);
    };

    startCamera();

    return () => {
      active = false;
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [onScan, retryCount]);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="bg-gray-900 rounded-3xl w-full max-w-md overflow-hidden relative shadow-2xl border border-gray-800"
        >
          {/* Header */}
          <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-gray-900/90 to-transparent">
            <div className="flex items-center space-x-2 text-white/90">
              <Camera className="w-5 h-5" />
              <span className="font-display font-bold tracking-wide text-sm">Escáner Activo</span>
            </div>
            <button
              onClick={onClose}
              className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Camera Viewport */}
          <div className="relative aspect-[3/4] w-full bg-black flex items-center justify-center">
            
            {loading && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 z-10">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
                <p className="text-white/80 font-sans text-sm font-medium animate-pulse">Iniciando cámara...</p>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-gray-900 z-10 space-y-4">
                <AlertTriangle className="w-12 h-12 text-red-500" />
                <p className="text-red-400 font-sans text-sm leading-relaxed">{error}</p>
                <button
                  onClick={() => { setError(null); setLoading(true); setRetryCount(c => c + 1); }}
                  className="mt-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer border-b-2 border-blue-900 active:translate-y-[1px] active:border-b-0"
                >
                  Reintentar
                </button>
              </div>
            )}

            {/* Hidden Canvas for Processing */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Video Element */}
            <video
              ref={videoRef}
              className={"w-full h-full object-cover transition-opacity duration-500 " + (loading || error ? "opacity-0" : "opacity-100")}
            />

            {/* Targeting Overlay */}
            {!loading && !error && (
              <div className="absolute inset-0 z-10 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] aspect-square">
                  {/* Corners */}
                  <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-blue-500 rounded-tl-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                  <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-blue-500 rounded-tr-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                  <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-blue-500 rounded-bl-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                  <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-blue-500 rounded-br-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                  
                  {/* Scanning Line Animation */}
                  <motion.div 
                    animate={{ y: ["0%", "300%", "0%"] }}
                    transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
                    className="w-full h-0.5 bg-blue-400/80 shadow-[0_0_10px_rgba(59,130,246,1)] mt-[10%]"
                  />
                </div>
              </div>
            )}
          </div>
          
          {/* Footer Guide */}
          <div className="bg-gray-900 p-4 text-center">
            <p className="text-xs text-gray-400 font-sans">
              Apunte la cámara hacia el código QR del ticket. Se escaneará automáticamente.
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
