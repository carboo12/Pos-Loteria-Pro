import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera, AlertTriangle, Loader2, Zap, ZapOff, CheckCircle2, Aperture, RefreshCw } from "lucide-react";
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

/** Enhance image for better QR detection: grayscale + contrast stretch */
function enhanceForQR(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;

  // Find min/max luminance for histogram stretch
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }

  const range = max - min || 1;
  const scale = 255 / range;

  // Apply grayscale + contrast stretch in one pass
  for (let i = 0; i < d.length; i += 4) {
    const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
    const stretched = Math.min(255, Math.max(0, Math.round((gray - min) * scale)));
    d[i] = stretched;
    d[i + 1] = stretched;
    d[i + 2] = stretched;
  }

  ctx.putImageData(imageData, 0, 0);
}

/** Try to decode QR from canvas, with image enhancement */
function decodeQR(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Attempt 1: raw image
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  if (code?.data) return code.data;

  // Attempt 2: enhanced (grayscale + contrast)
  enhanceForQR(ctx, canvas.width, canvas.height);
  imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  code = jsQR(imageData.data, imageData.width, canvas.height, {
    inversionAttempts: "attemptBoth",
  });
  if (code?.data) return code.data;

  // Attempt 3: inverted colors on enhanced
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  ctx.putImageData(imageData, 0, 0);
  code = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: "attemptBoth",
  });
  if (code?.data) return code.data;

  return null;
}

export function QrScannerModal({ onScan, onClose }: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [streamReady, setStreamReady] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [scanFailed, setScanFailed] = useState(false);
  
  const streamRef = useRef<MediaStream | null>(null);
  const torchTrackRef = useRef<MediaStreamTrack | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    torchTrackRef.current = null;
    setHasTorch(false);
    setTorchOn(false);
    setStreamReady(false);
  }, []);

  // ─── Camera Setup ────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    const startCamera = async () => {
      try {
        if (!window.isSecureContext) {
          setError("La cámara requiere HTTPS. En desarrollo local usa ngrok o certificados SSL.");
          setLoading(false);
          return;
        }

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
        if (track) torchTrackRef.current = track;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
        }

        // Wait 500ms for stream to stabilize before checking torch capability
        await new Promise((r) => setTimeout(r, 500));

        if (!active) return;

        // Capability check
        if (track) {
          try {
            const capabilities = track.getCapabilities() as any;
            if (capabilities?.torch === true) {
              setHasTorch(true);
            }
          } catch { /* ignore */ }
        }

        setStreamReady(true);
        setLoading(false);
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

    startCamera();

    return () => {
      active = false;
      stopCamera();
    };
  }, [stopCamera]);

  // ─── Capture & Process (Snapshot mode) ────────────────────────────────

  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || processing || scanned || scanFailed) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      return;
    }

    setProcessing(true);
    setScanFailed(false);
    setFrozen(true);

    try {
      // 1. Freeze the video stream
      video.pause();

      // 2. Copy current frame to canvas
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setProcessing(false);
        setFrozen(false);
        video.play().catch(() => {});
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 3. Brief delay for visual transition feedback
      await new Promise((r) => setTimeout(r, 200));

      // 4. Try to decode QR from canvas with enhancements
      const code = decodeQR(canvas);

      setProcessing(false);

      if (code) {
        playBeep();
        setScanned(true);
        setTimeout(() => onScanRef.current(code), 800);
      } else {
        setScanFailed(true);
      }
    } catch (err) {
      console.error("Scan error:", err);
      setProcessing(false);
      setScanFailed(true);
    }
  }, [processing, scanned, scanFailed]);

  const handleRetry = useCallback(() => {
    setScanFailed(false);
    setFrozen(false);
    setProcessing(false);
    if (videoRef.current) {
      videoRef.current.play().catch((err) => {
        console.error("Error resuming video:", err);
      });
    }
  }, []);

  // ─── Torch ───────────────────────────────────────────────────────────

  const toggleTorch = async () => {
    if (!streamReady || !hasTorch) return;

    try {
      const track = torchTrackRef.current;
      if (!track || track.readyState !== "live") return;

      const nextState = !torchOn;

      try {
        await track.applyConstraints({ advanced: [{ torch: nextState }] } as any);
      } catch {
        try {
          await track.applyConstraints({ torch: nextState } as any);
        } catch {
          setHasTorch(false);
          setTorchOn(false);
          return;
        }
      }

      setTorchOn(nextState);
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
                {scanned ? "Escaneado" : processing ? "Procesando..." : scanFailed ? "Intento Fallido" : "Capturar QR"}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              {!scanned && hasTorch && !frozen && (
                <button
                  onClick={toggleTorch}
                  className={`p-2 rounded-full transition-all focus:outline-none ${
                    torchOn
                      ? "bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-400 ring-2 ring-yellow-400/50 shadow-[0_0_12px_rgba(250,204,21,0.3)]"
                      : "bg-white/10 hover:bg-white/20 text-white/70"
                  }`}
                  title={torchOn ? "Apagar linterna" : "Encender linterna"}
                  disabled={!streamReady}
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
                  onClick={() => { setError(null); setLoading(true); stopCamera(); setTimeout(() => setLoading(false), 100); }}
                  className="mt-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer border-b-2 border-blue-900 active:translate-y-[1px] active:border-b-0"
                >
                  Reintentar
                </button>
              </div>
            )}

            <canvas
              ref={canvasRef}
              className={`w-full h-full object-cover ${frozen ? "block" : "hidden"}`}
            />

            <video
              ref={videoRef}
              className={`w-full h-full object-cover transition-opacity duration-500 ${
                loading || error || frozen ? "hidden" : "block"
              }`}
            />

            {/* Scanning Target Overlay */}
            {!loading && !error && !scanned && !frozen && (
              <div className="absolute inset-0 z-10 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70%] aspect-square">
                  <div className="absolute top-0 left-0 w-12 h-12 border-t-4 border-l-4 border-blue-500 rounded-tl-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
                  <div className="absolute top-0 right-0 w-12 h-12 border-t-4 border-r-4 border-blue-500 rounded-tr-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
                  <div className="absolute bottom-0 left-0 w-12 h-12 border-b-4 border-l-4 border-blue-500 rounded-bl-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
                  <div className="absolute bottom-0 right-0 w-12 h-12 border-b-4 border-r-4 border-blue-500 rounded-br-xl shadow-[0_0_15px_rgba(59,130,246,0.5)]" />
                </div>
              </div>
            )}

            {/* Processing overlay */}
            {processing && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
                <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
              </div>
            )}

            {/* Success Overlay */}
            {scanned && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
                <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
                  <CheckCircle2 className="w-20 h-20 text-emerald-400 drop-shadow-[0_0_20px_rgba(52,211,153,0.6)]" />
                </motion.div>
                <motion.p initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
                  className="text-white font-display font-black text-lg mt-4 tracking-wide">
                  Ticket verificado
                </motion.p>
              </div>
            )}
          </div>

          {/* Footer controls */}
          <div className="bg-gray-900 p-6 space-y-4 flex flex-col items-center">
            {scanFailed && !scanned && (
              <button
                onClick={handleRetry}
                className="px-6 py-3 min-h-[44px] bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-display font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md flex items-center space-x-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reintentar</span>
              </button>
            )}

            {!scanFailed && !scanned && !loading && !error && (
              <button
                onClick={captureAndScan}
                disabled={processing}
                className="w-20 h-20 rounded-full bg-white border-4 border-blue-500 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.4)] active:scale-95 transition-transform disabled:opacity-50 cursor-pointer"
              >
                <div className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center">
                  <Aperture className="w-8 h-8 text-white animate-pulse" />
                </div>
              </button>
            )}

            <p className="text-xs text-gray-400 font-sans text-center max-w-[80%]">
              {scanned
                ? "Procesando ticket..."
                : processing
                  ? "Analizando imagen..."
                  : scanFailed
                    ? "No se encontró ningún código QR. Ajusta la iluminación/distancia e intenta de nuevo."
                    : "Centra el código QR en el recuadro y presiona el botón azul para capturar."}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
