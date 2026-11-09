import { useState, useEffect, Suspense, lazy } from "react";
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

import { signOutUser } from "./services/authService";
import { subscribeToAuthState } from "./services/authService";
import { getGeneralConfig, subscribeToGeneralConfig, subscribeToResults } from "./services/configService";
import { listRecentTickets, subscribeToTickets } from "./services/ticketService";
import { listCashClosures, subscribeToCashClosures } from "./services/cashClosureService";
import { changeUserPassword, createUser, deactivateUser, listUsers, subscribeToUsers, updateUser } from "./services/userService";
import { isSupabaseEnabled } from "./lib/dataBackend";
import { AlertTriangle, Lock, Sun } from "lucide-react";
import { Toaster } from "react-hot-toast";

export default function App() {
  const [users, setUsers] = useState<Usuario[]>([]);
  const [currentUser, setCurrentUser] = useState<Usuario | null>(null);
  const [config, setConfig] = useState<Configuracion>({
    tasa_cambio: 36.50,
    contador_global_tickets: 0,
    formato_ticket: { prefijo: "", inicio_secuencial: 1 },
    sorteos: [],
    limites_numeros: [],
    resultados: [],
    cobros: []
  });
  const [sales, setSales] = useState<Venta[]>([]);
  const [closures, setClosures] = useState<CierreCaja[]>([]);
  const [serverTime, setServerTime] = useState("");
  const [loading, setLoading] = useState(true);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [simulatedSupervisorId, setSimulatedSupervisorId] = useState<string>("");

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
      const data = await listUsers();
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
      const data = await getGeneralConfig();
      setConfig(prev => ({ ...prev, ...data } as Configuracion));
    } catch (e) {
      console.error("Error loading configuration:", e);
    }
  };

  const fetchSales = async () => {
    try {
      const data = await listRecentTickets(500);
      setSales(data.map(ticket => ({ ...ticket.data, id: ticket.data.id || ticket.id })));
    } catch (e) {
      console.error("Error loading sales:", e);
    }
  };

  const fetchClosures = async () => {
    try {
      const data = await listCashClosures();
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
    if (isSupabaseEnabled) {
      localStorage.removeItem("localToken");
      localStorage.removeItem("currentUser");
      return;
    }
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
    const unsubscribe = subscribeToAuthState((fbUser) => {
      if (fbUser) {
        if (isSupabaseEnabled) {
          void listUsers().then((usersList) => {
            setUsers(usersList);
            const matched = usersList.find((candidate) => candidate.id === fbUser.uid);
            if (matched) {
              setCurrentUser(matched);
              void Promise.all([fetchConfig(), fetchSales(), fetchClosures()]);
            }
          }).catch((error) => console.error("Error cargando perfil de Supabase:", error));
          return;
        }
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

  // ─── FIRESTORE REAL-TIME LISTENERS (reemplaza polling de 4s) ────────

  // Listener 1: Tickets en tiempo real (limitado a los últimos 500 para máximo rendimiento móvil)
  useEffect(() => {
    const unsubscribe = subscribeToTickets({ limit: 500 }, (tickets) => setSales(tickets.map(ticket => ({ ...ticket.data, id: ticket.data.id || ticket.id }))),
      (err) => console.error("[tickets live] Error:", err));
    return () => unsubscribe();
  }, []);

  // Listener 2: Cierres de caja en tiempo real → setClosures
  useEffect(() => {
    const unsubscribe = subscribeToCashClosures(setClosures, (err) => console.error("[cierres live] Error:", err));
    return () => unsubscribe();
  }, []);

  // Listener 3: Usuarios en tiempo real → setUsers
  useEffect(() => {
    if (isSupabaseEnabled && !currentUser) return;
    const unsubscribe = subscribeToUsers(
      (usersList) => {
        setUsers(usersList);
        setCurrentUser(prev => {
          if (!prev) return null;
          const updated = usersList.find((u: Usuario) => u.id === prev.id);
          return updated || prev;
        });
      },
      (err) => console.error("[users live] Error:", err)
    );
    return () => unsubscribe();
  }, [currentUser?.id]);

  // Listener 4: Configuración en tiempo real → setConfig
  useEffect(() => {
    const unsubscribe = subscribeToGeneralConfig(
      (data) => setConfig(prev => ({
        ...prev,
        ...data,
        resultados: prev?.resultados || data.resultados || []
      }) as Configuracion),
      (err) => console.error("[onSnapshot configuracion] Error:", err)
    );
    return () => unsubscribe();
  }, []);

  // Listener 5: Resultados en tiempo real de Firestore → setConfig.resultados
  useEffect(() => {
    const unsubscribe = subscribeToResults(
      (resultadosList) => {
        setConfig(prev => ({
          ...(prev || { sorteos: [] }),
          resultados: resultadosList as any
        }));
      },
      (err) => console.error("[onSnapshot resultados] Error:", err)
    );
    return () => unsubscribe();
  }, []);

  // Clock sync: solo para precisión de reloj, cada 30s (no crítico en tiempo real)
  useEffect(() => {
    fetchClock();
    const interval = setInterval(fetchClock, 30000);
    return () => clearInterval(interval);
  }, []);

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
      const updatedUser = await updateUser(userId, updates);
      if (updatedUser) {
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
      const result = await createUser(newUser as any);
      if (result.success) {
        await fetchUsers();
        return { success: true, error: null };
      }
      return result;
    } catch (e: any) {
      console.error("Error creating user:", e);
      return { success: false, error: e.message || "Error de red al contactar el servidor" };
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const success = await deactivateUser(userId);
      if (success) {
        await fetchUsers();
        return true;
      }
    } catch (e) {
      console.error("Error deleting user:", e);
    }
    return false;
  };

  const handleChangeUserPassword = async (userId: string, newPassword: string) => {
    try {
      await changeUserPassword(userId, newPassword);
      return true;
    } catch (error) {
      console.error("Error actualizando contraseña:", error);
      return false;
    }
  };

  const handleNewSaleCreated = (newSale: Venta) => {
    setSales(prev => [...prev, newSale]);
  };
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] flex flex-col items-center justify-center p-6 text-gray-900 font-sans overflow-hidden">
        <div className="relative flex items-center justify-center animate-coin-drop">
          <img src="/logo.png" alt="Logo" className="w-56 h-56 object-contain drop-shadow-2xl" />
        </div>
        <h2 className="text-5xl md:text-6xl font-display font-black mt-8 text-3d-green animate-fade-in-delayed z-10 text-center">
          Rutas DSD.
        </h2>
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
            await signOutUser();
            setCurrentUser(null);
            localStorage.removeItem("localToken");
            localStorage.removeItem("currentUser");
            // Prevent back button from restoring the app
            window.history.pushState(null, "", window.location.href);
          }}
        />
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
                onRefreshClosures={fetchClosures}
                users={users}
                sales={sales}
                closures={closures}
                onUpdateConfig={handleUpdateConfig}
                onUpdateUser={handleUpdateUser}
                onCreateUser={handleCreateUser}
                onDeleteUser={handleDeleteUser}
                onChangeUserPassword={handleChangeUserPassword}
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
              void fetchUsers();
              if (isSupabaseEnabled) void Promise.all([fetchConfig(), fetchSales(), fetchClosures()]);
              // [FASE 3] Get or Create resumen_diario at startup
              if (u.rol === 'vendedor' && !isSupabaseEnabled) {
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
