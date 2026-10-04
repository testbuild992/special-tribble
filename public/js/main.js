const $ = (id) => document.getElementById(id);

$('yr').textContent = new Date().getFullYear();

let gameState = null;
let claimState = { token: null, otpId: null };

async function api(path, body, method = 'POST') {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function renderDots(used) {
  document.querySelectorAll('#attempts .dot').forEach((d, i) => {
    d.classList.toggle('used', i < used);
  });
}

function clearResume() {
  const resume = $('resumeBtn');
  if (resume) resume.remove();
}

function resetClaimBox() {
  $('couponResult').classList.add('hidden');
  $('otpForm').classList.add('hidden');
  $('detailsForm').classList.remove('hidden');
  $('detailsError').classList.add('hidden');
  $('otpError').classList.add('hidden');
}

function renderOptions() {
  const box = $('options');
  box.innerHTML = '';
  (gameState?.options || []).forEach((opt) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'option';
    btn.textContent = opt.label;
    btn.addEventListener('click', () => guess(opt.id, btn));
    box.appendChild(btn);
  });
}

async function startGame() {
  clearResume();
  resetClaimBox();
  try {
    gameState = await api('/api/game/start');
  } catch (e) {
    $('questionText').textContent = e.message;
    return;
  }
  claimState.token = gameState.token;

  $('questionText').textContent = gameState.question;
  $('feedback').classList.add('hidden');
  $('hintBox').classList.add('hidden');
  $('revealBox').classList.add('hidden');
  $('retryBtn').classList.add('hidden');
  $('game-question').classList.remove('hidden');
  renderDots(0);
  renderOptions();
}

async function guess(optionId, btn) {
  if (!gameState || gameState.finished) return;
  const buttons = [...document.querySelectorAll('.option')];
  buttons.forEach((b) => (b.disabled = true));
  btn.classList.add('chosen');

  try {
    const result = await api('/api/game/guess', { token: gameState.token, optionId });
    gameState = { ...gameState, ...result };
    renderDots(result.attemptsUsed);

    $('feedback').classList.remove('hidden');
    $('game-question').classList.add('hidden');
    $('feedbackMsg').textContent = result.message;

    if (result.correct) {
      btn.classList.add('correct');
      document.querySelectorAll('#attempts .dot').forEach((d) => d.classList.add('hit'));
    }

    if (result.finished) {
      clearResume();
      $('hintBox').classList.add('hidden');
      $('revealBox').classList.remove('hidden');
      $('revealAnswer').textContent = result.answer;
      $('rewardFirst').textContent = result.rewards.first + '%';
      $('rewardSecond').textContent = result.rewards.second + '%';
    } else {
      $('hintBox').classList.remove('hidden');
      $('hintText').textContent = result.hint;
      const resume = document.createElement('button');
      resume.type = 'button';
      resume.className = 'btn btn-ghost btn-sm';
      resume.id = 'resumeBtn';
      resume.textContent = `Try again — ${result.attemptsLeft} chance left`;
      resume.addEventListener('click', resumeGame);
      $('feedback').appendChild(resume);
    }
  } catch (e) {
    $('feedbackMsg').textContent = e.message;
    buttons.forEach((b) => (b.disabled = false));
    btn.classList.remove('chosen');
  }
}

function resumeGame() {
  clearResume();
  renderOptions();
  $('game-question').classList.remove('hidden');
  $('hintBox').classList.add('hidden');
  $('feedback').classList.add('hidden');
}

/* ================= Claim coupons ================= */

$('detailsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('detailsError');
  err.classList.add('hidden');
  const btn = $('sendOtpBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const phone = $('cPhone').value.replace(/\D/g, '');
  try {
    const data = await api('/api/coupon/claim', {
      token: claimState.token,
      name: $('cName').value,
      whatsapp: phone,
      dob: $('cDob').value,
    });

    if (data.alreadyClaimed) {
      showCoupons(data.coupons);
      return;
    }

    claimState.otpId = data.otpId;
    $('detailsForm').classList.add('hidden');
    $('otpForm').classList.remove('hidden');
    $('otpSent').textContent = data.devOtpMode
      ? `DEV MODE (WhatsApp API not set up) — your code is ${data.devOtp}`
      : `We sent a 6-digit code to +91 ${phone} on WhatsApp.`;
    $('cOtp').value = '';
    $('cOtp').focus();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send WhatsApp code';
  }
});

$('backBtn').addEventListener('click', () => {
  $('otpForm').classList.add('hidden');
  $('detailsForm').classList.remove('hidden');
});

$('otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('otpError');
  err.classList.add('hidden');
  try {
    const data = await api('/api/coupon/verify', {
      token: claimState.token,
      otpId: claimState.otpId,
      code: $('cOtp').value.trim(),
    });
    $('otpForm').classList.add('hidden');
    showCoupons(data.coupons);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

function showCoupons(coupons) {
  $('detailsForm').classList.add('hidden');
  $('otpForm').classList.add('hidden');
  $('couponResult').classList.remove('hidden');

  const list = $('couponList');
  list.innerHTML = '';
  coupons.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'coupon';
    el.innerHTML = `
      <div class="coupon-info">
        <div class="coupon-label">${escapeHtml(c.label)}</div>
        <div class="coupon-discount">${c.discount}% OFF</div>
      </div>
      <div class="coupon-right">
        <span class="coupon-code" title="Tap to copy">${escapeHtml(c.code)}</span>
        <div class="coupon-exp">Valid till ${escapeHtml(c.expires_at)}</div>
      </div>`;
    const codeEl = el.querySelector('.coupon-code');
    codeEl.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(c.code);
        codeEl.textContent = 'COPIED ✓';
        setTimeout(() => (codeEl.textContent = c.code), 1400);
      } catch {}
    });
    list.appendChild(el);
  });

  if (coupons[0]?.expires_at) $('expiryText').textContent = coupons[0].expires_at;
  $('couponResult').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ================= Init ================= */

$('retryBtn').addEventListener('click', startGame);

startGame();
