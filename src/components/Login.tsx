import React, { useState } from "react";

import { Usuario } from "../types";
import toast from "react-hot-toast";
import { 
  Lock, 
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
import { signInWithUsername } from "../services/authService";

interface LoginProps {
  config?: any;
  users: Usuario[];
  onLoginSuccess: (user: Usuario) => void;
}

export default function Login({ users, onLoginSuccess, config }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDemoAccounts, setShowDemoAccounts] = useState(true);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Por favor complete todos los campos.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await signInWithUsername(username, password);
      const matchedUser = result.profile as unknown as Usuario | null;
      if (!matchedUser) throw new Error("No se encontró el perfil del usuario autenticado.");
      if (result.localToken) localStorage.setItem("localToken", result.localToken);
      else localStorage.removeItem("localToken");
      localStorage.setItem("currentUser", JSON.stringify(matchedUser));
      
      toast.success(`¡Bienvenido de nuevo, ${matchedUser.nombre}!`, { position: 'top-center' });
      
      // onLoginSuccess gestiona el guardado de sesión y la redirección según el rol
      onLoginSuccess(matchedUser);
      
    } catch (err: any) {
      console.error("[Login] Error completo:", {
        message: err.message,
        stack: err.stack,
        raw: err
      });
      setError(err.message || "Ocurrió un error al iniciar sesión. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  const fillCredentials = (demoUsername: string) => {
    setUsername(demoUsername);
    // setPassword("Loto123456!");
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
          alt={config?.formato_ticket?.titulo || "Logo del Sistema"} 
          className="w-48 h-auto mx-auto object-contain filter drop-shadow-md"
        />

      </motion.div>

      {/* Main Login Card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="bg-white rounded-3xl shadow-xl border border-gray-100 p-6 sm:p-8 w-full"
      >


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
          {/* Username Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
              Nombre de Usuario
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="nombredeusuario"
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
