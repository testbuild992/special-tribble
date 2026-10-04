import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countUsers, createUser } from './data.js';
import { hashPassword } from './util.js';
import publicRoutes from './routes/public.js';
import panelRoutes from './routes/panels.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

export async function seedAdmin() {
  if ((await countUsers()) > 0) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@biji.com').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'Biji@1234';
  const name = process.env.ADMIN_NAME || 'BIJI Admin';
  await createUser({ name, email, passwordHash: hashPassword(password), role: 'admin' });
  console.log(`Seeded admin account: ${email}`);
}

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.use(publicRoutes);
app.use(panelRoutes);

app.use(express.static(path.join(root, 'public')));

const pages = {
  '/admin': 'admin.html',
  '/staff': 'staff.html',
};
app.get(Object.keys(pages), (req, res) => {
  res.sendFile(path.join(root, 'public', pages[req.path]));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

export default app;
