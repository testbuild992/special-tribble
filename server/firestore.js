import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function credentials() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE || path.join(root, 'serviceAccount.json');
  if (fs.existsSync(keyPath)) {
    const text = fs.readFileSync(keyPath, 'utf8').trim();
    if (text) return JSON.parse(text);
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim()) return JSON.parse(raw.trim());
  const project_id = process.env.FIREBASE_PROJECT_ID;
  const client_email = process.env.FIREBASE_CLIENT_EMAIL;
  const private_key = process.env.FIREBASE_PRIVATE_KEY;
  if (project_id && client_email && private_key) {
    return { project_id, client_email, private_key: private_key.replace(/\\n/g, '\n') };
  }
  return null;
}

let db = null;

export function firestoreDb() {
  if (db) return db;
  const creds = credentials();
  if (!creds) {
    throw new Error(
      'Firestore is not configured. Paste your Firebase service-account JSON into serviceAccount.json (project root) or set FIREBASE_SERVICE_ACCOUNT, or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.'
    );
  }
  if (!getApps().length) {
    initializeApp({ credential: cert(creds) });
  }
  db = getFirestore();
  return db;
}
