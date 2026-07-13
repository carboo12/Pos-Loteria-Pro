import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx'

import { auth } from './lib/firebase';

// ──────────────────────────────────────────────────────
// APP_VERSION — must match CACHE_NAME in public/sw.js
// Increment on every deploy that changes frontend assets.
// ──────────────────────────────────────────────────────
const APP_VERSION = "loto-pos-cache-v8";
const VERSION_KEY = "sw_version";

// ──────────────────────────────────────────────────────
// KILL SWITCH: If cached index.html points to old assets,
// unregister all SWs, purge all caches, and hard-reload.
// ──────────────────────────────────────────────────────
const runKillSwitch = async (): Promise<boolean> => {
  if (!("serviceWorker" in navigator)) return false;

  const stored = localStorage.getItem(VERSION_KEY);
  if (stored === APP_VERSION) return false;

  console.log(`[Kill Switch] Versión desactualizada (stored=${stored}, current=${APP_VERSION}). Limpiando...`);

  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      await reg.unregister();
    }
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      await caches.delete(name);
    }
  } catch (e) {
    console.warn("[Kill Switch] Error limpiando caches:", e);
  }

  localStorage.setItem(VERSION_KEY, APP_VERSION);
  // Hard reload: bypass browser cache entirely
  window.location.reload();
  return true; // page will reload, nothing after this runs
};

// Run kill switch immediately, before anything else
let killSwitchDone = false;
runKillSwitch().then((reloaded) => {
  killSwitchDone = reloaded;
});

// ──────────────────────────────────────────────────────
// FETCH INTERCEPTOR — inject Firebase token into /api/ calls
// ──────────────────────────────────────────────────────
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
  
  if (url.includes('/api/') && !url.includes('/api/ping') && !url.includes('/api/reloj') && !url.includes('/api/setup-admin')) {
    let tokenStr = null;
    
    if (auth.currentUser) {
      try {
        tokenStr = await auth.currentUser.getIdToken();
      } catch (e) {
        console.warn("Firebase token injection bypassed (offline/blocked).");
      }
    }
    
    if (!tokenStr) {
      tokenStr = localStorage.getItem("localToken");
    }

    if (tokenStr) {
      init = init || {};
      init.headers = {
        ...init.headers,
        "Authorization": `Bearer ${tokenStr}`
      };
    }
  }
  return originalFetch(input, init);
};
import './index.css';

// ──────────────────────────────────────────────────────
// SERVICE WORKER REGISTRATION + AUTO-UPDATE
// ──────────────────────────────────────────────────────
const registerServiceWorker = () => {
  if (!("serviceWorker" in navigator) || killSwitchDone) return;

  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    console.log("Nueva versión del Service Worker activa. Recargando...");
    window.location.reload();
  });

  navigator.serviceWorker.register("/sw.js").then((reg) => {
    console.log("Service Worker registrado:", reg.scope);

    // If a new SW is already waiting, force it to activate
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

    // Listen for version messages from SW
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "SW_ACTIVATED" && e.data?.version !== APP_VERSION) {
        console.log(`[SW] Versión ${e.data.version} activa, esperaba ${APP_VERSION}. Recargando...`);
        window.location.reload();
      }
    });
  }).catch((err) => console.error("Error al registrar SW:", err));
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => registerServiceWorker());
}

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
// RENDER
// ──────────────────────────────────────────────────────
if (!killSwitchDone) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
