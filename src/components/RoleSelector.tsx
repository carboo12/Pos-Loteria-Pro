import { Shield, Smartphone, Users, LogOut, Award } from "lucide-react";
import { Usuario } from "../types";

interface RoleSelectorProps {
  config?: any;
  currentUser: Usuario | null;
  onLogout?: () => void;
}

export default function RoleSelector({ currentUser, onLogout, config }: RoleSelectorProps) {
  if (!currentUser) return null;

  const isVendedor = currentUser.rol === "vendedor";
  const isSupervisor = currentUser.rol === "supervisor";
  
  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white p-4 shadow-md w-full">
      <div className="w-full mx-auto flex flex-row justify-between items-center px-4 md:px-6">
        
        {/* Brand / Logo */}
        <div className="flex items-center">
          <img 
            src="/logo.png" 
            alt={config?.formato_ticket?.titulo || "Logo del Sistema"} 
            className="h-10 w-auto object-contain filter drop-shadow-sm"
          />
        </div>

        {/* Logged User Info & Action */}
        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-display font-black tracking-wide uppercase text-slate-200">
              {currentUser.nombre}
            </span>
            <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider">
              {currentUser.rol === "administrador" ? "Administrador" : isSupervisor ? "Supervisor" : "Vendedor"} • {currentUser.region}
            </span>
          </div>

          <div className="bg-slate-800 p-1.5 rounded-xl border border-slate-700 flex items-center justify-center">
            {isVendedor ? (
              <Smartphone className="w-4 h-4 text-emerald-400" />
            ) : isSupervisor ? (
              <Users className="w-4 h-4 text-cyan-400" />
            ) : (
              <Shield className="w-4 h-4 text-amber-400" />
            )}
          </div>

          {onLogout && (
            <button
              onClick={onLogout}
              className="px-3.5 py-2 min-h-[40px] rounded-xl bg-red-950/40 hover:bg-red-900/60 border border-red-900/50 text-red-400 hover:text-red-300 flex items-center space-x-1.5 transition-all cursor-pointer font-bold text-xs shadow-xs animate-fade-in"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-display font-black uppercase tracking-wider hidden xs:inline">Salir</span>
            </button>
          )}
        </div>

      </div>
    </header>
  );
}
