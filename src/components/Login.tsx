import React, { useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import { Usuario } from "../types";
import { 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  Sun, 
  ShieldAlert, 
  ChevronDown, 
  ChevronUp, 
  User, 
  Check, 
  Copy 
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface LoginProps {
  users: Usuario[];
  onLoginSuccess: (user: Usuario) => void;
}

export default function Login({ users, onLoginSuccess }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDemoAccounts, setShowDemoAccounts] = useState(true);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const [setupLoading, setSetupLoading] = useState(false);
  const [setupSuccessMsg, setSetupSuccessMsg] = useState<string | null>(null);

  const handleSetupAdmin = async () => {
    setSetupLoading(true);
    setError(null);
    setSetupSuccessMsg(null);
    try {
      const res = await fetch("/api/setup-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (data.success) {
        setSetupSuccessMsg(`¡Inicialización exitosa! ${data.fbStatus}`);
        setEmail("carboo12@gmail.com");
        setPassword("Loto123456!");
      } else {
        setError(data.message || "Error al inicializar el usuario administrador.");
      }
    } catch (err) {
      console.error(err);
      setError("Error de comunicación con el servidor al inicializar.");
    } finally {
      setSetupLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Por favor complete todos los campos.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Sign in with Firebase Auth Client SDK
      const userCredential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const fbUser = userCredential.user;

      // 2. Find the user in our local server's database list
      const matchedUser = users.find(
        (u) => u.email.toLowerCase() === fbUser.email?.toLowerCase() || u.id === fbUser.uid
      );

      if (matchedUser) {
        if (!matchedUser.activo) {
          setError("Acceso denegado. Su cuenta se encuentra suspendida temporalmente.");
          setLoading(false);
          return;
        }
        onLoginSuccess(matchedUser);
      } else {
        setError("Usuario autenticado pero no registrado en la base de datos de lotería.");
      }
    } catch (err: any) {
      console.error("Login error:", err);
      let errorMsg = "Ocurrió un error al iniciar sesión. Intente nuevamente.";
      
      if (err.code === "auth/invalid-email") {
        errorMsg = "El correo electrónico ingresado no tiene un formato válido.";
      } else if (err.code === "auth/user-disabled") {
        errorMsg = "Este usuario ha sido suspendido en Firebase Authentication.";
      } else if (err.code === "auth/user-not-found") {
        errorMsg = "No se encontró ninguna cuenta asociada a este correo.";
      } else if (err.code === "auth/wrong-password") {
        errorMsg = "La contraseña ingresada es incorrecta.";
      } else if (err.code === "auth/invalid-credential" || err.code === "auth/invalid-login-credentials") {
        errorMsg = "Credenciales incorrectas. Verifique su correo y contraseña.";
      } else if (err.code === "auth/network-request-failed") {
        errorMsg = "Error de red. Verifique su conexión de internet.";
      }
      
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const fillCredentials = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("Loto123456!");
    setError(null);
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  return (
    <div className="w-full max-w-md mx-auto p-4 flex flex-col items-center justify-center min-h-[85vh]">
      {/* Brand Logo & Header */}
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-6"
      >
        <img 
          src="/logo.png" 
          alt="La Nueva Era" 
          className="w-48 h-auto mx-auto object-contain filter drop-shadow-md"
        />
        <p className="text-xs text-gray-500 font-mono tracking-widest mt-3 uppercase">
          PWA MULTI-PAÍS • INICIO DE SESIÓN
        </p>
      </motion.div>

      {/* Main Login Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="bg-white rounded-3xl shadow-xl border border-gray-100 p-6 sm:p-8 w-full"
      >
        <h2 className="text-lg font-bold text-gray-950 uppercase tracking-wide mb-4">
          Acceso Autorizado
        </h2>

        {error && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mb-5 bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-start space-x-2.5"
          >
            <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <span className="text-xs font-semibold text-red-900 leading-normal">{error}</span>
          </motion.div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          {/* Email Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
              Correo Electrónico
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@loteria.com"
                className="w-full pl-10 pr-4 py-3 min-h-[44px] bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
              Contraseña de Acceso
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-11 py-3 min-h-[44px] bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3.5 min-h-[48px] flex items-center justify-center font-display font-black text-xs uppercase tracking-wider rounded-xl border-b-2 border-blue-900 cursor-pointer shadow-md text-white transition-all ${
              loading 
                ? "bg-blue-400 border-blue-600 cursor-wait" 
                : "bg-blue-600 hover:bg-blue-500 active:translate-y-[1px] active:border-b-0"
            }`}
          >
            {loading ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Verificando...</span>
              </div>
            ) : (
              <span>Entrar al Sistema</span>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
