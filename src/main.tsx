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

// Register Service Worker for PWA capabilities
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registrado con éxito:', reg.scope))
      .catch(err => console.error('Fallo al registrar el Service Worker:', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
