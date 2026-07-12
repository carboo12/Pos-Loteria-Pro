import { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
import { Usuario, Configuracion, Venta, CierreCaja } from "./types";
import RoleSelector from "./components/RoleSelector";
import Login from "./components/Login";

// Lazy loaded interfaces (Code Splitting)
const VendedorInterface = lazy(() => import("./components/VendedorInterface"));
const AdminInterface = lazy(() => import("./components/AdminInterface"));
const SupervisorInterface = lazy(() => import("./components/SupervisorInterface"));

// Loader Component for Suspense
const SuspenseLoader = () => (
  <div className="flex-1 flex flex-col items-center justify-center min-h-[50vh] animate-pulse">
    <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
    <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">Cargando Interfaz...</p>
  </div>
);

import { auth } from "./lib/firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { AlertTriangle, Clock, Lock, ShieldCheck, Sun } from "lucide-react";
import { Toaster } from "react-hot-toast";

// Session inactivity timeout configuration
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_WARNING_MS = 60 * 1000; // Show warning 1 minute before timeout

export default function App() {
  const [users, setUsers] = useState<Usuario[]>([]);
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null);
  const [config, setConfig] = useState<Configuracion | null>(null);
  const [sales, setSales] = useState<Venta[]>([]);
  const [closures, setClosures] = useState<CierreCaja[]>([]);
  const [serverTime, setServerTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [simulatedSupervisorId, setSimulatedSupervisorId] = useState<string>("");
  const [showSessionWarning, setShowSessionWarning] = useState(false);
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Initial State Loaders
  const safeFetchJson = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error(`Expected JSON response, but got content-type: ${contentType}`);
    }
    return await res.json();
  };

  const fetchUsers = async () => {
    try {
      const data = await safeFetchJson("/api/usuarios");
      setUsers(data);
      // Keep selected user reference in sync with latest fields (like activo, estado)
      if (currentUser) {
        const updatedSelf = data.find((u: Usuario) => u.id === currentUser.id);
        if (updatedSelf) setCurrentUser(updatedSelf);
      }
    } catch (e) {
      console.error("Error loading users:", e);
    }
  };

  const fetchConfig = async () => {
    try {
      const data = await safeFetchJson("/api/configuracion");
      setConfig(data);
    } catch (e) {
      console.error("Error loading configuration:", e);
    }
  };

  const fetchSales = async () => {
    try {
      const data = await safeFetchJson("/api/ventas");
      setSales(data);
    } catch (e) {
      console.error("Error loading sales:", e);
    }
  };

  const fetchClosures = async () => {
    try {
      const data = await safeFetchJson("/api/cierres");
      setClosures(data);
    } catch (e) {
      console.error("Error loading closures:", e);
    }
  };

  const fetchClock = async () => {
    try {
      const data = await safeFetchJson("/api/reloj");
      setServerTime(data.timestamp_servidor);
    } catch (e) {
      console.error("Error loading clock:", e);
    }
  };

  // Attempt session rehydration from localStorage on mount
  useEffect(() => {
    const token = localStorage.getItem("localToken");
    const storedUser = localStorage.getItem("currentUser");
    if (token && storedUser) {
      try {
        const parsed = JSON.parse(storedUser) as Usuario;
        setCurrentUser(parsed);
      } catch {
        localStorage.removeItem("currentUser");
      }
    }
  }, []);

  // Initial Boot loader
  useEffect(() => {
    const bootApp = async () => {
      setLoading(true);
      try {
        await Promise.all([
          fetchUsers(),
          fetchConfig(),
          fetchSales(),
          fetchClosures(),
          fetchClock()
        ]);
      } catch (err) {
        setGeneralError("Error de conexión con el backend Express. Asegúrate de que el servidor está corriendo.");
      } finally {
        setLoading(false);
      }
    };
    bootApp();
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (fbUser) {
        // Find user by email or UID
        const matched = users.find(
          (u) => u.email.toLowerCase() === fbUser.email?.toLowerCase() || u.id === fbUser.uid
        );
        if (matched) {
          setCurrentUser(matched);
        }
      } else {
        // Only clear if no rehydrated session exists
        if (!localStorage.getItem("localToken")) {
          setCurrentUser(null);
        }
      }
    });
    return () => unsubscribe();
  }, [users]);

  // Periodic polling for real-time presence, sales synchronization and drawer locks
  useEffect(() => {
    const interval = setInterval(() => {
      fetchSales();
      fetchClosures();
      fetchClock();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  // 2. Action Handlers (Passed down to components)

  const handleAutoLogout = useCallback(async () => {
    await signOut(auth);
    setCurrentUser(null);
    setShowSessionWarning(false);
    localStorage.removeItem("localToken");
    localStorage.removeItem("currentUser");
    // Prevent back button from restoring the app after logout
    window.history.pushState(null, "", window.location.href);
  }, []);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);
    setShowSessionWarning(false);

    if (!currentUser) return;

    warningRef.current = setTimeout(() => {
      setShowSessionWarning(true);
    }, SESSION_TIMEOUT_MS - SESSION_WARNING_MS);

    inactivityRef.current = setTimeout(() => {
      handleAutoLogout();
    }, SESSION_TIMEOUT_MS);
  }, [currentUser, handleAutoLogout]);

  // Session inactivity timeout: auto-logout after period of no user activity
  useEffect(() => {
    if (!currentUser) return;

    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"] as const;
    const handleActivity = () => { resetInactivityTimer(); };

    events.forEach((event) => window.addEventListener(event, handleActivity));
    resetInactivityTimer();

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity));
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
    };
  }, [currentUser, resetInactivityTimer]);

  // Prevent browser back button from restoring app state after logout (bfcache)
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const handleUpdateConfig = async (newConfig: Partial<Configuracion>) => {
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConfig)
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
        return true;
      }
    } catch (e) {
      console.error("Error updating config:", e);
    }
    return false;
  };

  const handleUpdateUser = async (userId: string, updates: Partial<Usuario>) => {
    try {
      const res = await fetch(`/api/usuarios/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        const updatedUser = await res.json();
        // Update users array
        setUsers(prev => prev.map(u => u.id === userId ? updatedUser : u));
        if (currentUser?.id === userId) {
          setCurrentUser(updatedUser);
        }
        return true;
      }
    } catch (e) {
      console.error("Error updating user:", e);
    }
    return false;
  };

  const handleCreateUser = async (newUser: Omit<Usuario, "id" | "estado">) => {
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser)
      });
      if (res.ok) {
        await fetchUsers();
        return true;
      }
    } catch (e) {
      console.error("Error creating user:", e);
    }
    return false;
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const res = await fetch(`/api/usuarios/${userId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        await fetchUsers();
        return true;
      }
    } catch (e) {
      console.error("Error deleting user:", e);
    }
    return false;
  };

  const handleNewSaleCreated = (newSale: Venta) => {
    setSales(prev => [...prev, newSale]);
  };
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 text-white font-sans">
        <div className="relative flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <Sun className="w-6 h-6 text-yellow-400 absolute animate-pulse" />
        </div>
        <h2 className="text-xl font-display font-black uppercase tracking-widest mt-6">Cargando Sistema POS...</h2>
        <p className="text-xs text-gray-400 mt-2 font-mono">Conectando con base de datos NoSQL simulada de Lotería</p>
      </div>
    );
  }

  if (generalError) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-6 text-white text-center">
        <AlertTriangle className="w-16 h-16 text-[#EF4444] animate-bounce" />
        <h2 className="text-xl font-display font-black text-[#EF4444] uppercase tracking-wider mt-4">Fallo de Comunicación</h2>
        <p className="text-sm text-gray-300 max-w-md mt-2">{generalError}</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#F3F4F6] text-[#1F2937] flex flex-col">
      
      {/* App Header */}
      {currentUser && (
        <RoleSelector config={config} 
          currentUser={currentUser} 
          onLogout={async () => {
            await signOut(auth);
            setCurrentUser(null);
            // Prevent back button from restoring the app
            window.history.pushState(null, "", window.location.href);
          }}
        />
      )}

      {/* Session inactivity warning modal */}
      {showSessionWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center animate-fade-in">
            <Clock className="w-14 h-14 text-amber-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-gray-900 uppercase tracking-wide">Sesión por expirar</h3>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              Su sesión se cerrará automáticamente por <strong>inactividad</strong>. Presione el botón para continuar.
            </p>
            <button
              onClick={() => resetInactivityTimer()}
              className="mt-5 w-full py-3 min-h-[44px] bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm uppercase tracking-wider transition-all cursor-pointer border-b-2 border-blue-900 active:translate-y-[1px] active:border-b-0"
            >
              Continuar Sesión
            </button>
          </div>
        </div>
      )}
      <Toaster position="top-right" />

      {/* Main viewport with strict layout checks */}
      <div className="flex-1 w-full flex flex-col min-h-0 overflow-hidden">
        {currentUser && config ? (
          
          !currentUser.activo ? (
            
            /* Sellar blocked account fallback view */
            <div className="bg-white p-8 rounded-3xl max-w-md text-center shadow-md border-t-8 border-[#EF4444] animate-fade-in my-10 mx-auto">
              <div className="bg-red-50 p-4 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-[#EF4444]" />
              </div>
              <h3 className="font-display font-black text-lg text-gray-950 uppercase tracking-wide">Acceso Denegado</h3>
              <p className="text-xs text-gray-600 mt-3 font-sans font-medium leading-relaxed">
                Su cuenta de vendedor <strong className="text-gray-900 font-bold">"{currentUser.nombre}"</strong> ha sido <span className="text-[#EF4444] font-bold">suspendida</span> de forma remota por el administrador del sistema.
              </p>
              <div className="bg-gray-100 p-3 rounded-xl mt-4 text-[11px] font-mono text-gray-500 leading-normal text-left">
                <strong>Motivo de seguridad:</strong> Las anulación de accesos previene el cuadre de boletos fuera de horas permitidas o faltantes recurrentes.
              </div>
              <p className="text-[10px] text-gray-400 mt-6 italic">Comuníquese con el Administrador Central para restablecer credenciales.</p>
            </div>

          ) : currentUser.rol === "administrador" ? (
            
            /* Admin view desktop-first */
            <div className="w-full flex-1 flex flex-col min-h-0 overflow-hidden animate-fade-in">
                <Suspense fallback={<SuspenseLoader />}>
              <AdminInterface
                user={currentUser}
                config={config}
                onRefreshConfig={fetchConfig}
                onRefreshSales={fetchSales}
                onRefreshUsers={fetchUsers}
                users={users}
                sales={sales}
                closures={closures}
                onUpdateConfig={handleUpdateConfig}
                onUpdateUser={handleUpdateUser}
                onCreateUser={handleCreateUser}
                onDeleteUser={handleDeleteUser}
                simulatedSupervisorId={simulatedSupervisorId}
              />
                </Suspense>
            </div>

          ) : currentUser.rol === "supervisor" ? (

            /* Supervisor view */
            <div className="w-full flex-1 flex flex-col min-h-0 overflow-hidden animate-fade-in">
                <Suspense fallback={<SuspenseLoader />}>
              <SupervisorInterface
                user={currentUser}
                config={config}
                onRefreshSales={fetchSales}
                onRefreshUsers={fetchUsers}
                users={users}
                sales={sales}
                closures={closures}
                onUpdateUser={handleUpdateUser}
              />
                </Suspense>
            </div>

          ) : (
            
            /* Vendedor view mobile-first with point-of-sale layout */
            <div className="w-full flex-1 flex flex-col min-h-0 overflow-hidden animate-fade-in">
                <Suspense fallback={<SuspenseLoader />}>
              <VendedorInterface
                user={currentUser}
                config={config}
                onRefreshSales={fetchSales}
                sales={sales}
                onNewSaleCreated={handleNewSaleCreated}
                serverTime={serverTime}
              />
                </Suspense>
            </div>

          )

        ) : (
          <div className="flex-1 overflow-y-auto p-4 flex items-center justify-center">
            <Login config={config} users={users} onLoginSuccess={(u) => {
              setCurrentUser(u);
              // [FASE 3] Get or Create resumen_diario at startup
              if (u.rol === 'vendedor') {
                fetch("/api/resumen-diario/init", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id_vendedor: u.id, nombre_vendedor: u.nombre })
                }).catch(e => console.error("Error init resumen diario:", e));
              }
            }} />
          </div>
        )}
      </div>



    </div>
  );
}
