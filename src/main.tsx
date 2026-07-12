import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx'

import { auth } from './lib/firebase';

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
    
    // Si Firebase falló (ERR_CONNECTION_CLOSED), usamos el token local de respaldo
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

// Register Service Worker with auto-update
const registerServiceWorker = () => {
  if (!("serviceWorker" in navigator)) return;

  let registration: ServiceWorkerRegistration | null = null;
  let refreshing = false;

  // Listen for the 'controllerchange' event to reload when a new SW takes over
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    console.log("Nueva versión del Service Worker activa. Recargando...");
    window.location.reload();
  });

  navigator.serviceWorker.register("/sw.js").then((reg) => {
    registration = reg;
    console.log("Service Worker registrado:", reg.scope);

    // Check if a new SW is waiting to activate
    if (reg.installing) {
      console.log("SW instalando...");
    } else if (reg.waiting) {
      console.log("Nueva versión detectada (waiting). Forzando activación...");
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }

    // Detect new SW on updatefound
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
  }).catch((err) => console.error("Error al registrar SW:", err));
};

if ("serviceWorker" in navigator) {
  // Delay registration slightly to not block initial render
  window.addEventListener("load", () => registerServiceWorker());
}

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
