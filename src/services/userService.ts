import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { firestore } from "../lib/firebase";
import { isSupabaseEnabled } from "../lib/dataBackend";
import { restoreSupabaseSession, supabase } from "../lib/supabaseClient";
import type { Usuario } from "../types";

type UserProfile = Record<string, any>;

function mapProfile(profile: UserProfile, all: UserProfile[] = []): Usuario {
  return {
    id: String(profile.id),
    nombre: profile.nombre,
    usuario: profile.usuario,
    rol: profile.rol === "admin" ? "administrador" : profile.rol,
    estado: profile.estado === "inactivo" ? "inactivo" : "activo",
    activo: profile.estado !== "inactivo",
    conexion: "offline",
    region: profile.region,
    email: profile.email,
    id_supervisor: profile.id_supervisor || "",
    vendedoresAsignados: all.filter((user) => user.id_supervisor === profile.id).map((user) => String(user.id)),
  } as Usuario;
}

async function supabaseHeaders(): Promise<Record<string, string>> {
  await restoreSupabaseSession();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("La sesión de Supabase expiró. Inicia sesión nuevamente.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
}

async function requestSupabaseAdmin(path: string, method: string, body?: unknown): Promise<any> {
  const response = await fetch(path, {
    method,
    headers: await supabaseHeaders(),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `No se pudo completar la operación (HTTP ${response.status}).`);
  return result;
}

export async function listUsers(): Promise<Usuario[]> {
  if (!isSupabaseEnabled) {
    const response = await fetch("/api/usuarios");
    if (!response.ok) throw new Error(`Error al cargar usuarios (HTTP ${response.status}).`);
    return response.json();
  }
  await restoreSupabaseSession();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];
  const { data, error } = await supabase.from("profiles").select("*").order("nombre");
  if (error) throw error;
  return (data || []).map((profile) => mapProfile(profile, data || []));
}

export function subscribeToUsers(callback: (users: Usuario[]) => void, onError?: (error: Error) => void): Unsubscribe {
  if (!isSupabaseEnabled) {
    return onSnapshot(collection(firestore, "usuarios"), (snapshot) => {
      callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Usuario)));
    }, onError);
  }
  let disposed = false;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  const load = async () => {
    try {
      const users = await listUsers();
      if (!disposed) callback(users);
    } catch (error) { onError?.(error as Error); }
  };
  void restoreSupabaseSession().then(() => {
    if (disposed) return;
    void load();
    channel = supabase.channel("profiles-users-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => { void load(); })
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onError?.(error || new Error(`Supabase Realtime: ${status}`));
      });
  }).catch((error) => onError?.(error as Error));
  return () => { disposed = true; if (channel) void supabase.removeChannel(channel); };
}

export async function createUser(user: Record<string, any>): Promise<{ success: boolean; error: string | null }> {
  try {
    if (isSupabaseEnabled) {
      await requestSupabaseAdmin("/api/supabase/admin/users", "POST", user);
      return { success: true, error: null };
    }
    const response = await fetch("/api/usuarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(user) });
    const result = await response.json().catch(() => ({}));
    return response.ok ? { success: true, error: null } : { success: false, error: result.error || `Error del servidor (HTTP ${response.status})` };
  } catch (error: any) { return { success: false, error: error.message || "Error al crear el usuario." }; }
}

export async function updateUser(userId: string, updates: Partial<Usuario>): Promise<Usuario | null> {
  if (isSupabaseEnabled) {
    const profile = await requestSupabaseAdmin(`/api/supabase/admin/users/${encodeURIComponent(userId)}`, "PUT", updates);
    return { ...profile, rol: profile.rol === "admin" ? "administrador" : profile.rol } as Usuario;
  }
  const response = await fetch(`/api/usuarios/${encodeURIComponent(userId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
  if (!response.ok) return null;
  return response.json();
}

export async function deactivateUser(userId: string): Promise<boolean> {
  if (isSupabaseEnabled) {
    await requestSupabaseAdmin(`/api/supabase/admin/users/${encodeURIComponent(userId)}`, "DELETE");
    return true;
  }
  const response = await fetch(`/api/usuarios/${encodeURIComponent(userId)}`, { method: "DELETE" });
  return response.ok;
}

export async function changeUserPassword(userId: string, newPassword: string): Promise<void> {
  if (isSupabaseEnabled) {
    await requestSupabaseAdmin(`/api/supabase/admin/users/${encodeURIComponent(userId)}/password`, "PUT", { newPassword });
    return;
  }
  const response = await fetch(`/api/usuarios/${encodeURIComponent(userId)}/password`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newPassword }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `No se pudo cambiar la contraseña (HTTP ${response.status}).`);
}
