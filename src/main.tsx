import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx'

import './index.css';

// ──────────────────────────────────────────────────────
// APP_VERSION — must match CACHE_NAME in public/sw.js
// Increment on every deploy that changes frontend assets.
// ──────────────────────────────────────────────────────
const APP_VERSION = "v12";
const VERSION_KEY = "sw_version";

// ──────────────────────────────────────────────────────
// KILL SWITCH: If cached index.html points to old assets,
// unregister all SWs, purge all caches, and hard-reload.
// ──────────────────────────────────────────────────────
const runKillSwitch = async (): Promise<boolean> => {
  if (!("serviceWorker" in navigator)) return false;

  const stored = localStorage.getItem(VERSION_KEY);

  // Force-clean on first deploy with new version (fixes corrupted manifest.json cache)
  if (stored !== APP_VERSION) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
      const cacheNames = await caches.keys();
      for (const name of cacheNames) await caches.delete(name);
    } catch {}
  }

  if (stored === APP_VERSION) return false;

  console.log(`[Kill Switch] Versión desactualizada (stored=${stored}, current=${APP_VERSION}). Limpiando...`);

  localStorage.setItem(VERSION_KEY, APP_VERSION);
  window.location.reload();
  return true;
};

// ──────────────────────────────────────────────────────
// FETCH INTERCEPTOR — inject session token + 401 auto-logout
// ──────────────────────────────────────────────────────
let isForceLoggingOut = false;

const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
  
  // Inyectar token de sesión en peticiones autenticadas
  if (url.includes('/api/') && !url.includes('/api/ping') && !url.includes('/api/reloj') && !url.includes('/api/setup-admin')) {
    const tokenStr = localStorage.getItem("localToken");

    if (tokenStr) {
      init = init || {};
      init.headers = {
        ...init.headers,
        "Authorization": `Bearer ${tokenStr}`
      };
    }
  }

  const response = await originalFetch(input, init);

  // Anti-bucle: si ya estamos en proceso de logout forzado, no interceptar
  if (isForceLoggingOut) return response;

  // Si la respuesta es 401/403 en una petición autenticada → sesión muerta
  if ((response.status === 401 || response.status === 403) && url.includes('/api/') && !url.includes('/api/login') && !url.includes('/api/auth/me') && !url.includes('/api/setup-admin') && !url.includes('/api/ping') && !url.includes('/api/reloj') && !url.includes('/api/notifications') && !url.includes('/api/usuarios')) {
    console.warn(`[Auth] Sesión expirada o rechazada (${response.status}). Cerrando sesión...`);
    isForceLoggingOut = true;
    
    // Limpiar estado local
    localStorage.removeItem("localToken");
    localStorage.removeItem("currentUser");
    
    // Invalidar sesión en servidor (best-effort)
    try {
      await originalFetch("/api/auth/logout", { method: "POST" });
    } catch {}
    
    // Forzar recarga completa al login
    window.location.href = "/";
    return response;
  }

  return response;
};

// ──────────────────────────────────────────────────────
// SERVICE WORKER REGISTRATION + AUTO-UPDATE
// ──────────────────────────────────────────────────────
const registerServiceWorker = () => {
  if (!("serviceWorker" in navigator)) return;

  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    console.log("Nueva versión del Service Worker activa. Recargando...");
    window.location.reload();
  });

  navigator.serviceWorker.register("/sw.js").then((reg) => {
    console.log("Service Worker registrado:", reg.scope);

    if (reg.waiting) {
      console.log("SW en espera detectado. Forzando activación...");
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          console.log("Nueva versión instalada. Forzando activación...");
          newWorker.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });

    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "SW_ACTIVATED" && e.data?.version !== APP_VERSION) {
        console.log(`[SW] Versión ${e.data.version} activa, esperaba ${APP_VERSION}. Recargando...`);
        window.location.reload();
      }
    });

    // Periodic update check: every 60 minutes, ask the SW to check for updates
    setInterval(() => {
      if (navigator.serviceWorker.controller) {
        reg.update().catch(() => {});
      }
    }, 60 * 60 * 1000);
  }).catch((err) => console.error("Error al registrar SW:", err));
};

// ──────────────────────────────────────────────────────
// PWA INSTALL PROMPT
// ──────────────────────────────────────────────────────
let deferredPrompt: any = null;

window.addEventListener("beforeinstallprompt", (e: Event) => {
  e.preventDefault();
  deferredPrompt = (e as any).prompt;
  (window as any).__installPrompt = e;
  console.log("beforeinstallprompt capturado - instalación disponible");
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  (window as any).__installPrompt = null;
  console.log("App instalada exitosamente");
});

// ──────────────────────────────────────────────────────
// BOOT: Kill Switch → SW Registration → Render
// ──────────────────────────────────────────────────────
(async () => {
  const reloaded = await runKillSwitch();
  if (reloaded) return;

  if ("serviceWorker" in navigator) {
    if (document.readyState === "complete") {
      registerServiceWorker();
    } else {
      window.addEventListener("load", () => registerServiceWorker());
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
})();
