import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCrSMQ8jNJ7QOaET1GsmoDHXPpPOVqaThY",
  authDomain: "rapigestion-2.firebaseapp.com",
  projectId: "rapigestion-2",
  storageBucket: "rapigestion-2.firebasestorage.app",
  messagingSenderId: "526997793036",
  appId: "1:526997793036:web:94edfe21744921f22a8129"
};

const FIRESTORE_DB_ID = "ai-studio-puntodeventadelo-99bc134f-793f-40a0-acdb-49f626766fdc";

const app = initializeApp(firebaseConfig);
export const firestore = getFirestore(app, FIRESTORE_DB_ID);
export const auth = getAuth(app);
export default app;

// Production-ready: diagnostic utilities removed.
