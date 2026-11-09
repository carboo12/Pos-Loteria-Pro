export type DataBackend = "firebase" | "supabase";

const requestedBackend = String(import.meta.env.VITE_USE_SUPABASE || "false").toLowerCase();
export const dataBackend: DataBackend = ["true", "1", "supabase"].includes(requestedBackend)
  ? "supabase"
  : "firebase";

export const isSupabaseEnabled = dataBackend === "supabase";
