import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx'

import { auth } from './lib/firebase';

const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
  if (url.startsWith('/api/') && !url.includes('/api/ping') && !url.includes('/api/reloj') && !url.includes('/api/setup-admin')) {
    if (auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken();
        init = init || {};
        init.headers = {
          ...init.headers,
          "Authorization": `Bearer ${token}`
        };
      } catch (e) {
        console.error("Failed to inject token", e);
      }
    }
  }
  return originalFetch(input, init);
};
;
import './index.css';

// Register Service Worker + capture install prompt for Android
let deferredPrompt: any = null;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => {
        console.log("Service Worker registrado:", reg.scope);
      })
      .catch((err) => console.error("Error al registrar SW:", err));
  });
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
