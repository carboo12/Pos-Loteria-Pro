import { onAuthStateChanged, signOut, type User, type Unsubscribe } from "firebase/auth";
import { auth as firebaseAuth } from "../lib/firebase";
import { isSupabaseEnabled } from "../lib/dataBackend";
import { supabase } from "../lib/supabaseClient";

/** Supabase profile role must be loaded from public.profiles; never accept a role from user metadata. */
export function getInternalEmail(username: string): string {
  const cleanUsername = username.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(cleanUsername)) throw new Error("El nombre de usuario solo puede contener letras, números y guion bajo.");
  return `${cleanUsername}@app.local`;
}

export async function signInWithUsername(username: string, password: string): Promise<{ userId: string; email: string | null; profile: Record<string, unknown> | null; localToken?: string }> {
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername || !password) throw new Error("Nombre de usuario y contraseña son requeridos.");
  if (isSupabaseEnabled) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: getInternalEmail(cleanUsername), password });
    if (error) throw error;
    if (!data.user) throw new Error("Supabase no devolvió un usuario autenticado.");
    const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
    if (profileError) throw profileError;
    return {
      userId: data.user.id,
      email: data.user.email || null,
      profile: { ...profile, rol: profile.rol === "admin" ? "administrador" : profile.rol, activo: profile.estado === "activo", conexion: "offline" },
    };
  }
  const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: cleanUsername, password }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Error de autenticación (HTTP ${response.status})`);
  return { userId: payload.user?.id, email: payload.user?.email || null, profile: payload.user || null, localToken: payload.localToken };
}

export function subscribeToAuthState(callback: (user: User | null) => void): Unsubscribe {
  if (isSupabaseEnabled) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      callback(session?.user ? ({ uid: session.user.id, email: session.user.email } as User) : null);
    });
    return () => subscription.unsubscribe();
  }
  return onAuthStateChanged(firebaseAuth, callback);
}

export async function signOutUser(): Promise<void> {
  if (isSupabaseEnabled) {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return;
  }
  await signOut(firebaseAuth);
}
