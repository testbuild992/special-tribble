import '../server/env.js';
import app, { seedAdmin } from '../server/app.js';

let ready = null;
async function ensureReady() {
  if (!ready) {
    ready = seedAdmin().catch((e) => console.error('Admin seed failed:', e.message));
  }
  await ready;
  return app;
}

export default async function handler(req, res) {
  const application = await ensureReady();
  return application(req, res);
}
