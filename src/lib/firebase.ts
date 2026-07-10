import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

// Configuración de Firebase obtenida de firebase-applet-config.json
const firebaseConfig = {
  apiKey: "AIzaSyCrSMQ8jNJ7QOaET1GsmoDHXPpPOVqaThY",
  authDomain: "rapigestion-2.firebaseapp.com",
  projectId: "rapigestion-2",
  storageBucket: "rapigestion-2.firebasestorage.app",
  messagingSenderId: "526997793036",
  appId: "1:526997793036:web:94edfe21744921f22a8129"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
});
export default app;
