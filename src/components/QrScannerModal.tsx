import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera, AlertTriangle, Loader2, Zap, ZapOff, CheckCircle2 } from "lucide-react";
import jsQR from "jsqr";

interface QrScannerModalProps {
  onScan: (data: string) => void;
  onClose: () => void;
}

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "square";
    osc.frequency.value = 1800;
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.stop(ctx.currentTime + 0.15);
  } catch { /* silent fail */ }
}

export function QrScannerModal({ onScan, onClose }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scanLineY, setScanLineY] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef<number>();
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const zoomStepRef = useRef(0);
  const scanStartRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);

  const stopCamera = useCallback(() => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    const startCamera = async () => {
      try {
        if (!window.isSecureContext) {
          setError("La cámara requiere HTTPS. En desarrollo local usa ngrok o certificados SSL.");
          setLoading(false);
          return;
        }

        scanStartRef.current = Date.now();
        zoomStepRef.current = 0;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
            frameRate: { ideal: 30, max: 60 },
            focusMode: "continuous",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (!active) { stream.getTracks().forEach((t) => t.stop()); return; }

        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const capabilities = track.getCapabilities() as any;
            if (capabilities?.torch) setHasTorch(true);
          } catch { /* ignore */ }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
          setLoading(false);
          requestRef.current = requestAnimationFrame(tick);
        }
      } catch (err: any) {
        if (!active) return;
        setLoading(false);
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setError("Permiso de cámara denegado. Ve a la configuración del navegador y permite el acceso a la cámara.");
        } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
          setError("No se encontró ninguna cámara en este dispositivo.");
        } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          setError("La cámara está siendo usada por otra aplicación. Cierra otras apps e intenta de nuevo.");
        } else {
          setError(`Error al abrir la cámara: ${err.message}`);
        }
      }
    };

    const tick = () => {
      if (!active || !videoRef.current || !canvasRef.current) return;

      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Staged smart zoom escalation for aggressive QR detection
      const elapsed = Date.now() - scanStartRef.current;
      if (elapsed > 2000 && zoomStepRef.current === 0) {
        zoomStepRef.current = 1;
        applyZoom(1.2);
      } else if (elapsed > 4000 && zoomStepRef.current === 1) {
        zoomStepRef.current = 2;
        applyZoom(1.5);
      } else if (elapsed > 6000 && zoomStepRef.current === 2) {
        zoomStepRef.current = 3;
        applyZoom(1.8);
      }

      // Animate scan line
      if (elapsed % 2000 < 16) setScanLineY(0);
      else setScanLineY(((elapsed % 2000) / 2000) * 100);

      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // attemptBoth: scans both normal and inverted QR codes for maximum compatibility
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "attemptBoth",
          });

          // Throttle: max one successful scan per 100ms
          const now = performance.now();
          if (code && code.data && now - lastFrameTimeRef.current > 100) {
            lastFrameTimeRef.current = now;
            frameCountRef.current++;
            // Require 2 consecutive matches to avoid false positives
            if (frameCountRef.current >= 2) {
              playBeep();
              setScanned(true);
              setTimeout(() => onScanRef.current(code.data), 800);
              return;
            }
          } else if (!code || !code.data) {
            frameCountRef.current = 0;
          }
        }
      }
      requestRef.current = requestAnimationFrame(tick);
    };

    const applyZoom = (level: number) => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      try {
        const caps = track.getCapabilities() as any;
        if (caps?.zoom) {
          const maxZoom = caps.zoom.max || 1;
          track.applyConstraints({ advanced: [{ zoom: Math.min(level, maxZoom) }] } as any);
        }
      } catch { /* not all devices support zoom */ }
    };

    startCamera();

    return () => {
      active = false;
      stopCamera();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTorch = async () => {
    try {
      const track = streamRef.current?.getVideoTracks()[0];
      if (track) {
        const nextState = !torchOn;
        await track.applyConstraints({ advanced: [{ torch: nextState }] } as any);
        setTorchOn(nextState);
      }
    } catch { /* ignore */ }
  };

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
          <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center z-20 bg-gradient-to-b from-gray-900/90 to-transparent">
            <div className="flex items-center space-x-2 text-white/90">
              <Camera className="w-5 h-5" />
              <span className="font-display font-bold tracking-wide text-sm">
                {scanned ? "Escaneado" : "Escáner Activo"}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              {!scanned && (
                <button
                  onClick={toggleTorch}
                  className={`p-2 rounded-full transition-all focus:outline-none ${
                    torchOn
                      ? "bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-400 ring-2 ring-yellow-400/50 shadow-[0_0_12px_rgba(250,204,21,0.3)]"
                      : hasTorch
                        ? "bg-white/10 hover:bg-white/20 text-white/70"
                        : "bg-white/5 text-white/30 cursor-not-allowed"
                  }`}
                  title={torchOn ? "Apagar linterna" : hasTorch ? "Encender linterna" : "Linterna no disponible en este dispositivo"}
                  disabled={!hasTorch}
                >
                  {torchOn ? <Zap className="w-5 h-5 fill-yellow-400" /> : <ZapOff className="w-5 h-5" />}
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Camera Viewport */}
          <div className="relative aspect-[3/4] w-full bg-black flex items-center justify-center overflow-hidden">

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
                  onClick={() => { setError(null); setLoading(true); stopCamera(); setTimeout(() => { setLoading(false); }, 100); }}
                  className="mt-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer border-b-2 border-blue-900 active:translate-y-[1px] active:border-b-0"
                >
                  Reintentar
                </button>
              </div>
            )}

            <canvas ref={canvasRef} className="hidden" />

            <video
              ref={videoRef}
              className={"w-full h-full object-cover transition-opacity duration-500 " + (loading || error ? "opacity-0" : "opacity-100")}
            />

            {/* Scanning Overlay with animated line */}
            {!loading && !error && !scanned && (
              <div className="absolute inset-0 z-10 pointer-events-none">
                {/* Corner brackets */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] aspect-square">
                  <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-blue-500 rounded-tl-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                  <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-blue-500 rounded-tr-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                  <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-blue-500 rounded-bl-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                  <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-blue-500 rounded-br-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]"></div>
                  {/* Animated scan line */}
                  <div
                    className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent shadow-[0_0_8px_rgba(96,165,250,0.6)]"
                    style={{ top: `${scanLineY}%`, transition: "top 0.05s linear" }}
                  />
                </div>
              </div>
            )}

            {/* Success Overlay */}
            {scanned && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                >
                  <CheckCircle2 className="w-20 h-20 text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.6)]" />
                </motion.div>
                <motion.p
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-white font-display font-black text-lg mt-4 tracking-wide"
                >
                  Ticket verificado
                </motion.p>
              </div>
            )}
          </div>

          {/* Footer Guide */}
          <div className="bg-gray-900 p-4 text-center">
            <p className="text-xs text-gray-400 font-sans">
              {scanned
                ? "Procesando ticket..."
                : "Apunte la cámara hacia el código QR del ticket. Se escaneará automáticamente."}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
