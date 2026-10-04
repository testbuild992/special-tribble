import { createSessionRecord, deleteSessionRecord, getSessionUser } from './data.js';
import { randomToken } from './util.js';

const COOKIE = 'biji_sid';
const SESSION_DAYS = 7;

export async function createSession(res, userId) {
  const token = randomToken(24);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await createSessionRecord(token, userId, expires.toISOString());
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}`
  );
}

export async function destroySession(req, res) {
  const token = getToken(req);
  await deleteSessionRecord(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getToken(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  return match ? match.slice(COOKIE.length + 1) : null;
}

export async function loadUser(req) {
  const token = getToken(req);
  if (!token) return null;
  return getSessionUser(token);
}

export async function requireAuth(req, res, next) {
  try {
    const user = await loadUser(req);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only' });
    next();
  });
}
