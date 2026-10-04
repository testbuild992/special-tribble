import { Router } from 'express';
import * as data from '../data.js';
import { hashPassword, generateCouponCode, daysFromNow, ah } from '../util.js';
import { sendWhatsAppMessage, whatsappConfigured } from '../whatsapp.js';
import { requireAdmin, requireAuth } from '../auth.js';

const router = Router();

const PROMO_TYPES = [
  'trending_week',
  'trending_month',
  'new_item',
  'new_menu',
  'birthday',
  'anniversary',
  'corporate',
  'general',
];

/* ---------------- Admin: dashboard ---------------- */

router.get(
  '/api/admin/stats',
  requireAdmin,
  ah(async (req, res) => {
    res.json(await data.adminStats());
  })
);

/* ---------------- Admin: customers ---------------- */

router.get(
  '/api/admin/customers',
  requireAdmin,
  ah(async (req, res) => {
    const customers = await data.listCustomersView({ search: String(req.query.search || '').trim() });
    res.json({ customers });
  })
);

router.delete(
  '/api/admin/customers/:whatsapp',
  requireAdmin,
  ah(async (req, res) => {
    const whatsapp = String(req.params.whatsapp || '').replace(/^\+/, '');
    const customer = await data.getCustomer(whatsapp);
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    const removed = await data.deleteCustomerCascade(whatsapp);
    res.json({ ok: true, whatsapp, ...removed });
  })
);

router.get(
  '/api/admin/customers/export',
  requireAdmin,
  ah(async (req, res) => {
    const rows = await data.listCustomersForExport();
    const header = 'Name,WhatsApp,DOB,Joined,Coupons Total,Coupons Redeemed';
    const body = rows
      .map((r) =>
        [r.name, '+' + r.whatsapp, r.dob || '', r.created_at, r.coupons_total, r.coupons_redeemed]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=biji-customers.csv');
    res.send(header + '\n' + body);
  })
);

/* ---------------- Admin: coupons ---------------- */

router.get(
  '/api/admin/coupons',
  requireAdmin,
  ah(async (req, res) => {
    const coupons = await data.listCouponsJoined(String(req.query.status || 'all'));
    res.json({ coupons });
  })
);

router.post(
  '/api/admin/coupons/birthday',
  requireAdmin,
  ah(async (req, res) => {
    const discount = Number(req.body?.discount || 20);
    const today = new Date().toISOString().slice(5, 10);
    const customers = await data.birthdayCustomers(today);
    const expires = daysFromNow(Number(process.env.COUPON_EXPIRY_DAYS || 30));
    let created = 0;
    for (const c of customers) {
      if (await data.birthdayCouponRecently(c.whatsapp, 'Birthday Treat', 24 * 60 * 60 * 1000)) continue;
      let code;
      do code = generateCouponCode();
      while (await data.couponCodeExists(code));
      await data.insertCoupon({
        code,
        customerWhatsapp: c.whatsapp,
        discount,
        label: 'Birthday Treat',
        status: 'active',
        gameToken: null,
        expires_at: expires,
        redeemed_at: null,
        redeemed_by: null,
      });
      created++;
    }
    res.json({ ok: true, matched: customers.length, created });
  })
);

/* ---------------- Admin: promos (retention campaigns) ---------------- */

router.get(
  '/api/admin/promos',
  requireAdmin,
  ah(async (req, res) => {
    res.json({ types: PROMO_TYPES, promos: await data.listPromos() });
  })
);

router.post(
  '/api/admin/promos',
  requireAdmin,
  ah(async (req, res) => {
    const { type, title, message } = req.body || {};
    if (!PROMO_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid promo type.' });
    if (!title || !message) return res.status(400).json({ error: 'Title and message are required.' });
    const promo = await data.createPromo({
      type,
      title: String(title).trim(),
      message: String(message).trim(),
      createdBy: req.user.id,
      createdByName: req.user.name,
    });
    res.json({ ok: true, id: promo.id });
  })
);

router.post(
  '/api/admin/promos/:id/send',
  requireAdmin,
  ah(async (req, res) => {
    const promo = await data.getPromo(req.params.id);
    if (!promo) return res.status(404).json({ error: 'Promo not found.' });
    const customers = await data.allCustomers();
    if (!customers.length) return res.status(400).json({ error: 'No customers in the database yet.' });

    let sent = 0;
    let failed = 0;
    for (const c of customers) {
      const text = `${promo.title}\n\n${promo.message}`;
      const result = await sendWhatsAppMessage(c.whatsapp, text);
      const status = result.ok ? 'sent' : 'failed';
      if (result.ok) sent++;
      else failed++;
      await data.upsertPromoRecipient(promo.id, c.whatsapp, status, result.error || null);
    }

    await data.markPromoSent(promo.id, sent);

    res.json({
      ok: true,
      sent,
      failed,
      dev: !whatsappConfigured(),
      note: whatsappConfigured()
        ? undefined
        : 'WhatsApp API keys not configured — messages logged in DEV mode only.',
    });
  })
);

/* ---------------- Admin: staff accounts ---------------- */

router.get(
  '/api/admin/staff',
  requireAdmin,
  ah(async (req, res) => {
    res.json({ users: await data.listUsers() });
  })
);

router.post(
  '/api/admin/staff',
  requireAdmin,
  ah(async (req, res) => {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const finalRole = role === 'admin' ? 'admin' : 'staff';
    try {
      await data.createUser({
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        passwordHash: hashPassword(String(password)),
        role: finalRole,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message === 'DUPLICATE_EMAIL' ? 'That email is already registered.' : e.message });
    }
  })
);

router.post(
  '/api/admin/staff/:id/toggle',
  requireAdmin,
  ah(async (req, res) => {
    const id = String(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    await data.toggleUser(id);
    res.json({ ok: true });
  })
);

/* ---------------- Staff: lookup + verify/redeem ---------------- */

router.get(
  '/api/staff/customers',
  requireAuth,
  ah(async (req, res) => {
    const customers = await data.listCustomersView({
      search: String(req.query.search || '').trim(),
      limit: 100,
    });
    res.json({ customers });
  })
);

async function loadCouponWithCustomer(code) {
  const coupon = await data.getCoupon(code);
  if (!coupon) return null;
  const customer = await data.getCustomer(coupon.customerWhatsapp);
  return {
    ...coupon,
    name: customer?.name || '—',
    whatsapp: coupon.customerWhatsapp,
  };
}

router.post(
  '/api/staff/coupons/check',
  requireAuth,
  ah(async (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const coupon = await loadCouponWithCustomer(code);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found.' });
    if (coupon.status === 'active' && coupon.expires_at < new Date().toISOString().slice(0, 10)) {
      await data.updateCoupon(coupon.code, { status: 'expired' });
      coupon.status = 'expired';
    }
    res.json({ coupon });
  })
);

router.post(
  '/api/staff/coupons/redeem',
  requireAuth,
  ah(async (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const coupon = await loadCouponWithCustomer(code);
    if (!coupon) return res.status(404).json({ error: 'Coupon not found.' });
    if (coupon.status === 'redeemed') return res.status(400).json({ error: 'Already redeemed.', coupon });
    if (coupon.status === 'expired') return res.status(400).json({ error: 'Coupon expired.', coupon });

    const updated = await data.updateCoupon(coupon.code, {
      status: 'redeemed',
      redeemed_at: new Date().toISOString(),
      redeemed_by: req.user.id,
    });
    res.json({ ok: true, coupon: { ...coupon, ...updated } });
  })
);

router.get(
  '/api/staff/stats',
  requireAuth,
  ah(async (req, res) => {
    res.json(await data.staffStats());
  })
);

export default router;
