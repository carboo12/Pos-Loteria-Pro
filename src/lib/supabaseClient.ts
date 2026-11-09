import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseRequested = ["true", "1", "supabase"].includes(String(import.meta.env.VITE_USE_SUPABASE).toLowerCase());

if (supabaseRequested && (!url || !anonKey)) {
  throw new Error("VITE_USE_SUPABASE=true requiere VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.");
}

// Placeholder values allow importing this module in Firebase mode without connecting to Supabase.
export const supabase = createClient(url || "http://127.0.0.1:54321", anonKey || "supabase-disabled-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export async function restoreSupabaseSession(): Promise<void> {
  const { error } = await supabase.auth.getSession();
  if (error) throw error;
}
