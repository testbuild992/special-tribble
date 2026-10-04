import { firestoreDb } from './firestore.js';

const nowIso = () => new Date().toISOString();
const db = () => firestoreDb();

async function getAll(collection) {
  const snap = await db().collection(collection).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function exists(collection, id) {
  const snap = await db().collection(collection).doc(id).get();
  return snap.exists;
}

const byCreatedDesc = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));

/* ================= Users ================= */

export async function countUsers() {
  const snap = await db().collection('users').count().get();
  return snap.data().count;
}

export async function createUser({ name, email, passwordHash, role }) {
  const ref = db().collection('users').doc(email);
  if ((await ref.get()).exists) throw new Error('DUPLICATE_EMAIL');
  const user = { name, email, passwordHash, role, active: true, created_at: nowIso() };
  await ref.set(user);
  return { id: email, name, email, role, active: true, created_at: user.created_at };
}

export async function findUserByEmail(email) {
  if (!email) return null;
  const snap = await db().collection('users').doc(email).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getUserById(id) {
  if (!id) return null;
  const snap = await db().collection('users').doc(String(id)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function listUsers() {
  const users = await getAll('users');
  return users
    .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, created_at: u.created_at }))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

export async function toggleUser(id) {
  const ref = db().collection('users').doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) throw new Error('User not found.');
  await ref.update({ active: !snap.data().active });
  return { id: snap.id, ...snap.data(), active: !snap.data().active };
}

/* ================= Sessions ================= */

export async function createSessionRecord(token, userId, expiresAtIso) {
  await db().collection('sessions').doc(token).set({
    userId,
    created_at: nowIso(),
    expires_at: expiresAtIso,
  });
}

export async function getSessionUser(token) {
  if (!token) return null;
  const snap = await db().collection('sessions').doc(token).get();
  if (!snap.exists) return null;
  const sess = snap.data();
  if (new Date(sess.expires_at).getTime() < Date.now()) return null;
  const user = await getUserById(sess.userId);
  if (!user || !user.active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function deleteSessionRecord(token) {
  if (!token) return;
  await db().collection('sessions').doc(token).delete();
}

/* ================= Customers ================= */

export async function getCustomer(whatsapp) {
  const snap = await db().collection('customers').doc(whatsapp).get();
  if (!snap.exists) return null;
  return { whatsapp: snap.id, ...snap.data() };
}

export async function upsertCustomer(whatsapp, { name, dob }) {
  const ref = db().collection('customers').doc(whatsapp);
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update({ name, dob });
    return { whatsapp, ...snap.data(), name, dob };
  }
  const customer = { whatsapp, name, dob, source: 'guess-game', created_at: nowIso() };
  await ref.set(customer);
  return customer;
}

async function customersMap() {
  const rows = await getAll('customers');
  return new Map(rows.map((c) => [c.whatsapp, c]));
}

async function couponsWithCounts() {
  const coupons = await getAll('coupons');
  const counts = new Map();
  for (const c of coupons) {
    const entry = counts.get(c.customerWhatsapp) || { total: 0, active: 0, redeemed: 0 };
    entry.total++;
    if (c.status === 'active') entry.active++;
    if (c.status === 'redeemed') entry.redeemed++;
    counts.set(c.customerWhatsapp, entry);
  }
  return { coupons, counts };
}

export async function listCustomersView({ search = '', limit = 500 } = {}) {
  const term = String(search).trim().toLowerCase();
  const [rows, { counts }] = await Promise.all([getAll('customers'), couponsWithCounts()]);
  return rows
    .filter((c) => !term || c.name.toLowerCase().includes(term) || c.whatsapp.includes(term))
    .sort(byCreatedDesc)
    .slice(0, limit)
    .map((c) => {
      const n = counts.get(c.whatsapp) || { total: 0, active: 0, redeemed: 0 };
      return { ...c, coupons_total: n.total, coupons_active: n.active, coupons_redeemed: n.redeemed };
    });
}

export async function listCustomersForExport() {
  const [rows, { counts }] = await Promise.all([getAll('customers'), couponsWithCounts()]);
  return rows.sort(byCreatedDesc).map((c) => {
    const n = counts.get(c.whatsapp) || { total: 0, active: 0, redeemed: 0 };
    return { ...c, coupons_total: n.total, coupons_redeemed: n.redeemed };
  });
}

export async function countCustomers() {
  const snap = await db().collection('customers').count().get();
  return snap.data().count;
}

export async function allCustomers() {
  return getAll('customers');
}

export async function deleteCustomerCascade(whatsapp) {
  const batch = db().batch();
  batch.delete(db().collection('customers').doc(whatsapp));

  const [coupons, otps, games, recipients] = await Promise.all([
    db().collection('coupons').where('customerWhatsapp', '==', whatsapp).get(),
    db().collection('otps').where('whatsapp', '==', whatsapp).get(),
    db().collection('games').where('customerWhatsapp', '==', whatsapp).get(),
    db().collection('promoRecipients').where('whatsapp', '==', whatsapp).get(),
  ]);
  [...coupons.docs, ...otps.docs, ...games.docs, ...recipients.docs].forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return {
    coupons: coupons.size,
    otps: otps.size,
    games: games.size,
    recipients: recipients.size,
  };
}

export async function birthdayCustomers(mmdd) {
  const rows = await getAll('customers');
  return rows.filter((c) => c.dob && c.dob.slice(5, 10) === mmdd);
}

/* ================= Games ================= */

export async function createGame(token) {
  const game = {
    token,
    attempts: 0,
    guessedCorrect: false,
    completed: false,
    claimed: false,
    customerWhatsapp: null,
    created_at: nowIso(),
  };
  await db().collection('games').doc(token).set(game);
  return game;
}

export async function getGame(token) {
  if (!token) return null;
  const snap = await db().collection('games').doc(String(token)).get();
  if (!snap.exists) return null;
  return { token: snap.id, ...snap.data() };
}

export async function updateGame(token, patch) {
  const ref = db().collection('games').doc(String(token));
  await ref.update(patch);
  return { token, ...patch };
}

export async function countGames() {
  const snap = await db().collection('games').count().get();
  return snap.data().count;
}

/* ================= OTPs ================= */

export async function createOtp({ whatsapp, code, gameToken, expiresAt }) {
  const ref = db().collection('otps').doc();
  const otp = {
    whatsapp,
    code,
    gameToken,
    expiresAt,
    attempts: 0,
    consumed: false,
    created_at: nowIso(),
  };
  await ref.set(otp);
  return { id: ref.id, ...otp };
}

export async function getOtp(id) {
  if (!id) return null;
  const snap = await db().collection('otps').doc(String(id)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}
export async function patchOtp(id, patch) {
  await db().collection('otps').doc(String(id)).update(patch);
}

export async function hasRecentOtp(whatsapp, withinMs) {
  const snap = await db().collection('otps').where('whatsapp', '==', whatsapp).get();
  const cutoff = Date.now() - withinMs;
  return snap.docs.some((d) => new Date(d.data().created_at).getTime() > cutoff);
}

/* ================= Coupons ================= */

export async function getCoupon(code) {
  if (!code) return null;
  const snap = await db().collection('coupons').doc(String(code)).get();
  if (!snap.exists) return null;
  return { code: snap.id, ...snap.data() };
}

export async function couponCodeExists(code) {
  return exists('coupons', String(code));
}

export async function insertCoupon(coupon) {
  const ref = db().collection('coupons').doc(coupon.code);
  await ref.set({ ...coupon, created_at: nowIso() });
  return coupon;
}

export async function issueCouponBatch({ coupons, gameToken, whatsapp }) {
  const batch = db().batch();
  for (const c of coupons) {
    batch.set(db().collection('coupons').doc(c.code), { ...c, created_at: nowIso() });
  }
  batch.update(db().collection('games').doc(gameToken), { claimed: true, customerWhatsapp: whatsapp });
  await batch.commit();
}

export async function updateCoupon(code, patch) {
  const ref = db().collection('coupons').doc(String(code));
  await ref.update(patch);
  return { code, ...patch };
}

export async function couponsFor(whatsapp) {
  const snap = await db().collection('coupons').where('customerWhatsapp', '==', whatsapp).get();
  return snap.docs.map((d) => ({ code: d.id, ...d.data() }));
}

export async function listCouponsJoined(status = 'all', limit = 500) {
  const [{ coupons }, cmap] = await Promise.all([couponsWithCounts(), customersMap()]);
  return coupons
    .filter((c) => status === 'all' || c.status === status)
    .sort(byCreatedDesc)
    .slice(0, limit)
    .map((c) => {
      const cu = cmap.get(c.customerWhatsapp);
      return { ...c, name: cu?.name || '—', whatsapp: c.customerWhatsapp };
    });
}

export async function recentRedemptions(limit = 5) {
  const [{ coupons }, cmap] = await Promise.all([couponsWithCounts(), customersMap()]);
  return coupons
    .filter((c) => c.status === 'redeemed')
    .sort((a, b) => String(b.redeemed_at || '').localeCompare(String(a.redeemed_at || '')))
    .slice(0, limit)
    .map((c) => ({
      code: c.code,
      discount: c.discount,
      label: c.label,
      name: cmap.get(c.customerWhatsapp)?.name || '—',
      whatsapp: c.customerWhatsapp,
      redeemed_at: c.redeemed_at,
    }));
}

export async function birthdayCouponRecently(whatsapp, label, withinMs) {
  const rows = await couponsFor(whatsapp);
  const cutoff = Date.now() - withinMs;
  return rows.some((c) => c.label === label && new Date(c.created_at).getTime() > cutoff);
}

/* ================= Promos ================= */

export async function listPromos(limit = 200) {
  const rows = await getAll('promos');
  return rows.sort(byCreatedDesc).slice(0, limit);
}

export async function getPromo(id) {
  const snap = await db().collection('promos').doc(String(id)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createPromo({ type, title, message, createdBy, createdByName }) {
  const ref = db().collection('promos').doc();
  const promo = {
    type,
    title,
    message,
    status: 'draft',
    audience: 'all',
    sent_count: 0,
    created_by: createdBy,
    created_by_name: createdByName,
    created_at: nowIso(),
    sent_at: null,
  };
  await ref.set(promo);
  return { id: ref.id, ...promo };
}

export async function markPromoSent(id, sentCount) {
  await db().collection('promos').doc(String(id)).update({
    status: 'sent',
    sent_count: sentCount,
    sent_at: nowIso(),
  });
}

export async function upsertPromoRecipient(promoId, whatsapp, status, error) {
  const ref = db().collection('promoRecipients').doc(`${promoId}_${whatsapp}`);
  await ref.set({ promoId: String(promoId), whatsapp, status, error: error || null, sent_at: nowIso() });
}

/* ================= Stats ================= */

export async function adminStats() {
  const [customers, { coupons }, games, promos] = await Promise.all([
    getAll('customers'),
    couponsWithCounts(),
    getAll('games'),
    getAll('promos'),
  ]);
  const cmap = new Map(customers.map((c) => [c.whatsapp, c]));
  return {
    customers: customers.length,
    gamesPlayed: games.length,
    gamesCompleted: games.filter((g) => g.completed).length,
    gamesClaimed: games.filter((g) => g.claimed).length,
    couponsIssued: coupons.length,
    couponsActive: coupons.filter((c) => c.status === 'active').length,
    couponsRedeemed: coupons.filter((c) => c.status === 'redeemed').length,
    promosSent: promos.filter((p) => p.status === 'sent').length,
    recentCustomers: customers
      .sort(byCreatedDesc)
      .slice(0, 5)
      .map((c) => ({ whatsapp: c.whatsapp, name: c.name, dob: c.dob, created_at: c.created_at })),
    recentRedemptions: coupons
      .filter((c) => c.status === 'redeemed')
      .sort((a, b) => String(b.redeemed_at || '').localeCompare(String(a.redeemed_at || '')))
      .slice(0, 5)
      .map((c) => ({
        code: c.code,
        discount: c.discount,
        name: cmap.get(c.customerWhatsapp)?.name || '—',
        redeemed_at: c.redeemed_at,
      })),
  };
}

export async function staffStats() {
  const [customers, { coupons }, games] = await Promise.all([
    getAll('customers'),
    couponsWithCounts(),
    getAll('games'),
  ]);
  const today = nowIso().slice(0, 10);
  return {
    customers: customers.length,
    activeCoupons: coupons.filter((c) => c.status === 'active').length,
    redeemedToday: coupons.filter((c) => c.status === 'redeemed' && String(c.redeemed_at || '').slice(0, 10) === today)
      .length,
    gamesCompleted: games.filter((g) => g.completed).length,
  };
}
