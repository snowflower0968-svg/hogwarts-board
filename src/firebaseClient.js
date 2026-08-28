import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

if (!firebaseConfig.apiKey) {
  // eslint-disable-next-line no-console
  console.error('Missing Firebase env vars. Copy .env.example to .env and fill it in with your Firebase project config.');
}

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Real login IDs aren't emails, so Firebase Auth (which is email-based)
// is given a synthetic address built from the login id. The real
// loginId is stored separately in the users/{uid} document.
export const FAKE_DOMAIN = '@hogwarts.local';
export function loginIdToEmail(loginId) {
  return `${loginId.trim().toLowerCase()}${FAKE_DOMAIN}`;
}
