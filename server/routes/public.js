import { Router } from 'express';
import * as data from '../data.js';
import {
  randomToken,
  generateCouponCode,
  generateOtp,
  hashPassword,
  verifyPassword,
  normalizePhone,
  daysFromNow,
  ah,
} from '../util.js';
import { sendOtp, whatsappConfigured } from '../whatsapp.js';
import { createSession, destroySession, loadUser } from '../auth.js';

const router = Router();

/* ---------------- Game config ---------------- */

const QUESTION = 'Which cuisine will BIJI serve?';
const OPTIONS = [
  { id: 'chinese', label: 'Chinese Cuisine' },
  { id: 'multi-cuisine', label: 'Multi Cuisine' },
  { id: 'korean', label: 'Korean Cuisine' },
  { id: 'indian', label: 'Indian Cuisine' },
  { id: 'japanese', label: 'Japanese Cuisine' },
  { id: 'mexican', label: 'Mexican Cuisine' },
];
const ANSWER = process.env.GAME_ANSWER || 'multi-cuisine';
const SECONDS_COUPON_CORRECT = Number(process.env.SECOND_COUPON_CORRECT || 30);
const SECONDS_COUPON_WRONG = Number(process.env.SECOND_COUPON_WRONG || 20);
const COUPON_EXPIRY_DAYS = Number(process.env.COUPON_EXPIRY_DAYS || 30);

function shuffledOptions() {
  const a = [...OPTIONS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const answerLabel = () =>
  (OPTIONS.find((o) => o.id === ANSWER) || OPTIONS.find((o) => o.id === 'multi-cuisine')).label;

const HINTS = [
  'Every craving will have a place at BIJI — so we clearly could not pick just ONE cuisine.',
  'Picky eater, classic craving, or a group with totally different tastes? Everyone gets exactly what they want, with zero compromises… from a single kitchen.',
];

router.get('/api/config', (req, res) => {
  res.json({
    brand: 'BIJI by Chef Brown',
    question: QUESTION,
    options: shuffledOptions(),
    maxAttempts: 3,
    devOtpMode: !whatsappConfigured(),
  });
});

router.post(
  '/api/game/start',
  ah(async (req, res) => {
    const token = randomToken(18);
    await data.createGame(token);
    res.json({ token, question: QUESTION, options: shuffledOptions(), attemptsLeft: 3 });
  })
);

router.post(
  '/api/game/guess',
  ah(async (req, res) => {
    const { token, optionId } = req.body || {};
    const game = await data.getGame(token || '');
    if (!game) return res.status(404).json({ error: 'Game session not found. Please refresh.' });
    if (game.completed) return res.status(400).json({ error: 'This round is already finished.' });
    if (!OPTIONS.some((o) => o.id === optionId)) return res.status(400).json({ error: 'Invalid option.' });

    const correct = optionId === ANSWER;
    const attempts = game.attempts + 1;
    const guessedCorrect = game.guessedCorrect || correct;
    const finished = correct || attempts >= 3;
    await data.updateGame(token, { attempts, guessedCorrect, ...(finished ? { completed: true } : {}) });

    const secondDiscount = correct ? SECONDS_COUPON_CORRECT : SECONDS_COUPON_WRONG;
    const label = answerLabel();

    if (correct) {
      return res.json({
        correct: true,
        finished: true,
        attemptsUsed: attempts,
        attemptsLeft: 0,
        options: shuffledOptions(),
        message:
          attempts === 1
            ? 'Straight from the heart — you guessed it on your very first try! 🎯'
            : 'You got it! BIJI serves exactly that. 🎯',
        answer: label,
        rewards: { first: 50, second: secondDiscount },
      });
    }

    const hint = attempts < 3 ? HINTS[attempts - 1] : null;
    res.json({
      correct: false,
      finished,
      attemptsUsed: attempts,
      attemptsLeft: 3 - attempts,
      options: shuffledOptions(),
      message: finished
        ? 'So close — the answer is ' + label
        : 'Good guess — not quite. Here is your hint, it gets easier from here.',
      hint,
      answer: finished ? label : null,
      rewards: finished ? { first: 50, second: secondDiscount } : null,
    });
  })
);

/* ---------------- Coupon claim: name + WhatsApp + DOB ---------------- */

router.post(
  '/api/coupon/claim',
  ah(async (req, res) => {
    const { token, name, whatsapp, dob } = req.body || {};
    const game = await data.getGame(token || '');
    if (!game || !game.completed) return res.status(400).json({ error: 'Finish the 3 guesses first.' });
    if (game.claimed) return res.status(400).json({ error: 'Coupons already claimed for this round.' });

    const cleanName = String(name || '').trim();
    const phone = normalizePhone(whatsapp);
    if (cleanName.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
    if (!/^\d{12}$/.test(phone)) {
      return res
        .status(400)
        .json({ error: 'Please enter a valid WhatsApp number with country code (e.g. 919876543210).' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return res.status(400).json({ error: 'Please enter your date of birth.' });

    const customer = await data.getCustomer(phone);
    if (customer) {
      const existing = await data.couponsFor(phone);
      if (existing.length > 0) {
        return res.status(409).json({
          error:
            'This WhatsApp number has already claimed its coupons — one claim per number. Need help? Ask our staff.',
        });
      }
    }

    if (await data.hasRecentOtp(phone, 60_000)) {
      return res.status(429).json({ error: 'Please wait a minute before requesting another code.' });
    }

    await data.upsertCustomer(phone, { name: cleanName, dob });

    const code = generateOtp();
    const otp = await data.createOtp({
      whatsapp: phone,
      code,
      gameToken: game.token,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const sent = await sendOtp(phone, code);
    if (!sent.ok) return res.status(502).json({ error: 'Could not send WhatsApp OTP: ' + sent.error });

    res.json({ otpId: otp.id, devOtpMode: !whatsappConfigured(), ...(sent.devOtp ? { devOtp: sent.devOtp } : {}) });
  })
);

router.post(
  '/api/coupon/verify',
  ah(async (req, res) => {
    const { token, otpId, code } = req.body || {};
    const game = await data.getGame(token || '');
    if (!game || !game.completed) return res.status(400).json({ error: 'Game session not found.' });

    const otp = await data.getOtp(otpId);
    if (!otp || otp.consumed) return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    if (otp.expiresAt < Date.now()) return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    if (otp.attempts >= 5) return res.status(400).json({ error: 'Too many attempts. Please request a new code.' });

    await data.patchOtp(otp.id, { attempts: otp.attempts + 1 });
    if (String(code).trim() !== otp.code) return res.status(400).json({ error: 'Incorrect code. Try again.' });

    await data.patchOtp(otp.id, { consumed: true });

    const customer = await data.getCustomer(otp.whatsapp);
    if (!customer) return res.status(400).json({ error: 'Customer not found.' });

    const existing = await data.couponsFor(otp.whatsapp);
    if (existing.length >= 2) {
      await data.updateGame(token, { claimed: true, customerWhatsapp: otp.whatsapp });
      return res.json({ coupons: existing });
    }

    const correct = game.guessedCorrect;
    const second = correct ? SECONDS_COUPON_CORRECT : SECONDS_COUPON_WRONG;
    const expires = daysFromNow(COUPON_EXPIRY_DAYS);
    const specs = [
      [50, 'Launch Feast — Flat 50% OFF'],
      [second, correct ? `You Nailed It — ${second}% OFF` : `Almost There — ${second}% OFF`],
    ];
    const toIssue = [];
    for (const [discount, label] of specs) {
      let code2;
      do code2 = generateCouponCode();
      while (await data.couponCodeExists(code2));
      toIssue.push({
        code: code2,
        customerWhatsapp: otp.whatsapp,
        discount,
        label,
        status: 'active',
        gameToken: game.token,
        expires_at: expires,
        redeemed_at: null,
        redeemed_by: null,
      });
    }

    await data.issueCouponBatch({ coupons: toIssue, gameToken: game.token, whatsapp: otp.whatsapp });
    res.json({
      coupons: toIssue.map((c) => ({ code: c.code, discount: c.discount, label: c.label, expires_at: c.expires_at })),
    });
  })
);

/* ---------------- Auth: email + password ---------------- */

router.get(
  '/api/auth/signup-open',
  ah(async (req, res) => {
    res.json({ open: (await data.countUsers()) === 0 });
  })
);

router.post(
  '/api/auth/signup',
  ah(async (req, res) => {
    const { name, email, password } = req.body || {};
    if ((await data.countUsers()) > 0) {
      return res.status(403).json({ error: 'Sign-ups are closed. Ask the admin to create your account.' });
    }
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    try {
      const user = await data.createUser({
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        passwordHash: hashPassword(String(password)),
        role: 'admin',
      });
      await createSession(res, user.id);
      res.json({ ok: true, role: 'admin' });
    } catch (e) {
      res.status(400).json({ error: e.message === 'DUPLICATE_EMAIL' ? 'That email is already registered.' : e.message });
    }
  })
);

router.post(
  '/api/auth/login',
  ah(async (req, res) => {
    const { email, password } = req.body || {};
    const user = await data.findUserByEmail(String(email || '').trim().toLowerCase());
    if (!user || !user.active || !verifyPassword(String(password || ''), user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    await createSession(res, user.id);
    res.json({ ok: true, role: user.role, name: user.name });
  })
);

router.post(
  '/api/auth/logout',
  ah(async (req, res) => {
    await destroySession(req, res);
    res.json({ ok: true });
  })
);

router.get(
  '/api/auth/me',
  ah(async (req, res) => {
    res.json({ user: await loadUser(req) });
  })
);

export default router;
