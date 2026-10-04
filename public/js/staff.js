const $ = (id) => document.getElementById(id);

async function api(path, body, method = 'POST') {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    showAuth();
    throw new Error('Not logged in.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const fmt = (d) => (d ? String(d).replace('T', ' ').slice(0, 16) : '—');

function showAuth() {
  $('appView').classList.add('hidden');
  $('authView').classList.remove('hidden');
}

function showApp(user) {
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('whoName').textContent = user.name;
  $('whoRole').textContent = user.role === 'admin' ? 'Administrator' : 'Staff';
  loadOverview();
}

/* ---------------- Auth ---------------- */

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError');
  err.classList.add('hidden');
  try {
    const data = await api('/api/auth/login', {
      email: $('loginEmail').value,
      password: $('loginPassword').value,
    });
    showApp(data);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', {});
  showAuth();
});

/* ---------------- Navigation ---------------- */

const pages = ['redeem', 'customers', 'overview'];
document.querySelectorAll('.nav-item[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    pages.forEach((p) => $('page-' + p).classList.add('hidden'));
    $('page-' + btn.dataset.page).classList.remove('hidden');
    if (btn.dataset.page === 'overview') loadOverview();
    if (btn.dataset.page === 'customers') loadCustomers();
  });
});

/* ---------------- Redeem ---------------- */

let currentCoupon = null;

function setMsg(el, text, cls) {
  el.textContent = text;
  el.className = 'msg ' + (cls || '');
}

$('checkBtn').addEventListener('click', checkCoupon);
$('redeemCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') checkCoupon();
});

async function checkCoupon() {
  const code = $('redeemCode').value.trim().toUpperCase();
  const msg = $('redeemMsg');
  $('redeemResult').classList.add('hidden');
  currentCoupon = null;
  if (!code) return setMsg(msg, 'Enter a coupon code first.', 'err');

  try {
    const { coupon } = await api('/api/staff/coupons/check', { code });
    currentCoupon = coupon;
    $('redeemResult').classList.remove('hidden');
    $('rDiscount').textContent = coupon.discount + '% OFF';
    $('rLabel').textContent = coupon.label;
    $('rCustomer').textContent = `${coupon.name} · +${coupon.whatsapp}`;
    $('rExpiry').innerHTML =
      `Status: <span class="badge ${esc(coupon.status)}">${esc(coupon.status)}</span> · Valid till ${esc(coupon.expires_at)}`;

    if (coupon.status === 'active') {
      $('confirmBtn').classList.remove('hidden');
      setMsg(msg, 'Coupon is valid. Ask the guest to confirm.', 'ok');
    } else {
      $('confirmBtn').classList.add('hidden');
      setMsg(msg, coupon.status === 'redeemed' ? `Already redeemed ${fmt(coupon.redeemed_at)}.` : 'This coupon has expired.', 'err');
    }
  } catch (e) {
    setMsg(msg, e.message, 'err');
  }
}

$('confirmBtn').addEventListener('click', async () => {
  if (!currentCoupon) return;
  try {
    const r = await api('/api/staff/coupons/redeem', { code: currentCoupon.code });
    setMsg($('redeemMsg'), `✓ Redeemed — guest saved ${r.coupon.discount}%.`, 'ok');
    $('redeemResult').classList.add('hidden');
    $('redeemCode').value = '';
    currentCoupon = null;
  } catch (e) {
    setMsg($('redeemMsg'), e.message, 'err');
  }
});

/* ---------------- Customers ---------------- */

let searchTimer;
async function loadCustomers(search = '') {
  const data = await api(`/api/staff/customers?search=${encodeURIComponent(search)}`, null, 'GET');
  $('custRows').innerHTML = data.customers.length
    ? data.customers
        .map(
          (c) => `<tr>
            <td>${esc(c.name)}</td>
            <td>+${esc(c.whatsapp)}</td>
            <td>${esc(c.dob || '—')}</td>
            <td>${c.coupons_active} active / ${c.coupons_redeemed} redeemed</td>
            <td>${fmt(c.created_at)}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="empty">No customers found.</td></tr>';
}

$('custSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadCustomers(e.target.value.trim()), 280);
});

/* ---------------- Overview ---------------- */

async function loadOverview() {
  const s = await api('/api/staff/stats', null, 'GET');
  const cards = [
    ['Customers', s.customers],
    ['Active coupons', s.activeCoupons],
    ['Redeemed today', s.redeemedToday],
    ['Games completed', s.gamesCompleted],
  ];
  $('statGrid').innerHTML = cards
    .map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join('');
}

/* ---------------- Boot ---------------- */

(async function init() {
  try {
    const me = await api('/api/auth/me', null, 'GET');
    if (me.user) showApp(me.user);
    else showAuth();
  } catch {
    showAuth();
  }
})();
