import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
} from "firebase/auth";

/* Optional Capacitor — may not be installed in a pure-web build. */
let Capacitor = null;
try {
  // dynamic-safe: won't throw if the package is missing
  // eslint-disable-next-line global-require
  Capacitor = await import("@capacitor/core").then((m) => m.Capacitor);
} catch {
  Capacitor = null;
}

const firebaseConfig = {
  apiKey: "AIzaSyB0omL5FU7l2LHu2SqvHHXhM51zQFpoabs",
  authDomain: "overtimerequest.firebaseapp.com",
  projectId: "overtimerequest",
  storageBucket: "overtimerequest.firebasestorage.app",
  messagingSenderId: "268038721496",
  appId: "1:268038721496:web:2ef4a10f77befc40dfacad",
  measurementId: "G-WV2R9DL8BJ",
};

/* ✅ Exported so `adminApi.js` (and future utils) can import it. */
export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

function getPlatformAuth() {
  // On native (Capacitor) Android/iOS, use indexedDB persistence — the
  // default browser persistence can hang inside a WebView.
  if (Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
    return initializeAuth(app, { persistence: indexedDBLocalPersistence });
  }
  return getAuth(app);
}

export const auth = getPlatformAuth();

/* ---------------------------------------------------------------- */
/*  Secondary Auth instance — for admin-driven user registration    */
/*  without signing the admin out.                                  */
/* ---------------------------------------------------------------- */
const SECONDARY_APP_NAME = "admin-secondary";
let _secondaryAuth = null;

export function getSecondaryAuth() {
  if (_secondaryAuth) return _secondaryAuth;
  const existing = getApps().find((a) => a.name === SECONDARY_APP_NAME);
  const secondaryApp =
    existing || initializeApp(getApp().options, SECONDARY_APP_NAME);
  _secondaryAuth = getAuth(secondaryApp);
  return _secondaryAuth;
}