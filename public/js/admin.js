const $ = (id) => document.getElementById(id);

let promoTypes = [];

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

/* ---------------- Auth ---------------- */

function showAuth() {
  $('appView').classList.add('hidden');
  $('authView').classList.remove('hidden');
}

function showApp(user) {
  $('authView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('whoName').textContent = user.name;
  $('whoRole').textContent = user.role === 'admin' ? 'Administrator' : 'Staff';
  if (user.role !== 'admin') {
    location.href = '/staff';
    return;
  }
  loadDashboard();
}

$('showSignup')?.addEventListener('click', () => {
  $('loginPane').classList.add('hidden');
  $('signupPane').classList.remove('hidden');
});
$('showLogin').addEventListener('click', () => {
  $('signupPane').classList.add('hidden');
  $('loginPane').classList.remove('hidden');
});

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

$('signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('signupError');
  err.classList.add('hidden');
  try {
    const data = await api('/api/auth/signup', {
      name: $('suName').value,
      email: $('suEmail').value,
      password: $('suPassword').value,
    });
    showApp({ name: $('suName').value, role: data.role });
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

const pages = ['dashboard', 'customers', 'coupons', 'campaigns', 'team'];
document.querySelectorAll('.nav-item[data-page]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    pages.forEach((p) => $('page-' + p).classList.add('hidden'));
    $('page-' + btn.dataset.page).classList.remove('hidden');
    ({ dashboard: loadDashboard, customers: loadCustomers, coupons: loadCoupons, campaigns: loadPromos, team: loadTeam }[btn.dataset.page])();
  });
});

/* ---------------- Dashboard ---------------- */

async function loadDashboard() {
  const s = await api('/api/admin/stats', null, 'GET');
  const cards = [
    ['Customers', s.customers],
    ['Games played', s.gamesPlayed],
    ['Coupons claimed', s.gamesClaimed],
    ['Coupons issued', s.couponsIssued],
    ['Active coupons', s.couponsActive],
    ['Redeemed', s.couponsRedeemed],
    ['Campaigns sent', s.promosSent],
  ];
  $('statGrid').innerHTML = cards
    .map(([label, value]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join('');

  $('recentCustomers').innerHTML = s.recentCustomers.length
    ? s.recentCustomers
        .map(
          (c) =>
            `<tr><td>${esc(c.name)}</td><td>+${esc(c.whatsapp)}</td><td>${esc(c.dob || '—')}</td><td>${fmt(c.created_at)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No customers yet.</td></tr>';

  $('recentRedemptions').innerHTML = s.recentRedemptions.length
    ? s.recentRedemptions
        .map(
          (r) =>
            `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${r.discount}%</td><td>${fmt(r.redeemed_at)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="empty">No redemptions yet.</td></tr>';
}

/* ---------------- Customers ---------------- */

async function loadCustomers(search = '') {
  const data = await api(`/api/admin/customers?search=${encodeURIComponent(search)}`, null, 'GET');
  $('customerRows').innerHTML = data.customers.length
    ? data.customers
        .map(
          (c) => `<tr>
            <td>${esc(c.name)}</td>
            <td>+${esc(c.whatsapp)}</td>
            <td>${esc(c.dob || '—')}</td>
            <td>${c.coupons_active} active / ${c.coupons_total} total</td>
            <td>${fmt(c.created_at)}</td>
            <td><button class="btn btn-sm btn-danger" data-del="${esc(c.whatsapp)}">Delete</button></td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="empty">No customers found.</td></tr>';

  document.querySelectorAll('[data-del]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const wa = btn.dataset.del;
      if (
        !confirm(
          `Delete customer +${wa}?\n\nThis removes their coupons and frees the WhatsApp number so it can claim again (useful for re-testing).`
        )
      )
        return;
      btn.disabled = true;
      try {
        await api(`/api/admin/customers/${encodeURIComponent(wa)}`, null, 'DELETE');
        loadCustomers($('customerSearch').value.trim());
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    })
  );
}

let searchTimer;
$('customerSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadCustomers(e.target.value.trim()), 280);
});

$('birthdayBtn').addEventListener('click', async () => {
  const msg = $('customerMsg');
  msg.textContent = 'Generating…';
  msg.className = 'msg';
  try {
    const r = await api('/api/admin/coupons/birthday', { discount: 20 });
    msg.textContent = `Matched ${r.matched} birthday(s) today — created ${r.created} coupon(s).`;
    msg.className = 'msg ok';
  } catch (e) {
    msg.textContent = e.message;
    msg.className = 'msg err';
  }
});

/* ---------------- Coupons ---------------- */

async function loadCoupons() {
  const status = $('couponFilter').value;
  const data = await api(`/api/admin/coupons?status=${status}`, null, 'GET');
  $('couponRows').innerHTML = data.coupons.length
    ? data.coupons
        .map(
          (c) => `<tr>
            <td><b>${esc(c.code)}</b></td>
            <td>${esc(c.name)}<br /><span style="opacity:.6">+${esc(c.whatsapp)}</span></td>
            <td>${c.discount}%</td>
            <td>${esc(c.label)}</td>
            <td><span class="badge ${esc(c.status)}">${esc(c.status)}</span></td>
            <td>${esc(c.expires_at)}</td>
            <td>${fmt(c.redeemed_at)}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="empty">No coupons here.</td></tr>';
}
$('couponFilter').addEventListener('change', loadCoupons);

/* ---------------- Campaigns ---------------- */

async function loadPromos() {
  const data = await api('/api/admin/promos', null, 'GET');
  promoTypes = data.types;
  const sel = $('promoType');
  if (!sel.options.length) {
    sel.innerHTML = data.types
      .map((t) => `<option value="${t}">${t.replace(/_/g, ' ')}</option>`)
      .join('');
  }
  $('promoRows').innerHTML = data.promos.length
    ? data.promos
        .map(
          (p) => `<tr>
            <td><b>${esc(p.title)}</b><br /><span style="opacity:.6;font-size:12.5px">${esc(p.message.slice(0, 70))}${p.message.length > 70 ? '…' : ''}</span></td>
            <td>${esc(p.type.replace(/_/g, ' '))}</td>
            <td><span class="badge ${p.status}">${p.status}</span></td>
            <td>${p.sent_count}</td>
            <td>${p.status === 'sent' ? '—' : `<button class="btn btn-sm" data-send="${p.id}">Send now</button>`}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="5" class="empty">No campaigns yet.</td></tr>';

  document.querySelectorAll('[data-send]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const r = await api(`/api/admin/promos/${btn.dataset.send}/send`);
        alert(
          r.dev
            ? `DEV mode (WhatsApp API not configured): ${r.sent} message(s) logged, ${r.failed} failed.`
            : `Sent: ${r.sent} | Failed: ${r.failed}`
        );
        loadPromos();
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
        btn.textContent = 'Send now';
      }
    })
  );
}

$('promoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('promoMsg');
  msg.className = 'msg';
  msg.textContent = 'Saving…';
  try {
    await api('/api/admin/promos', {
      type: $('promoType').value,
      title: $('promoTitle').value,
      message: $('promoMessage').value,
    });
    $('promoTitle').value = '';
    $('promoMessage').value = '';
    msg.textContent = 'Campaign saved. Hit “Send now” to deliver it on WhatsApp.';
    msg.className = 'msg ok';
    loadPromos();
  } catch (ex) {
    msg.textContent = ex.message;
    msg.className = 'msg err';
  }
});

/* ---------------- Team ---------------- */

async function loadTeam() {
  const data = await api('/api/admin/staff', null, 'GET');
  $('teamRows').innerHTML = data.users
    .map(
      (u) => `<tr>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td><span class="badge role">${esc(u.role)}</span></td>
        <td><span class="badge ${u.active ? 'active' : 'expired'}">${u.active ? 'active' : 'disabled'}</span></td>
        <td><button class="btn btn-sm btn-danger" data-toggle="${u.id}">${u.active ? 'Disable' : 'Enable'}</button></td>
      </tr>`
    )
    .join('');

  document.querySelectorAll('[data-toggle]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/staff/${btn.dataset.toggle}/toggle`, {});
        loadTeam();
      } catch (e) {
        alert(e.message);
      }
    })
  );
}

$('staffForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('staffMsg');
  msg.className = 'msg';
  msg.textContent = 'Creating…';
  try {
    await api('/api/admin/staff', {
      name: $('stName').value,
      email: $('stEmail').value,
      password: $('stPassword').value,
      role: $('stRole').value,
    });
    e.target.reset();
    msg.textContent = 'Account created.';
    msg.className = 'msg ok';
    loadTeam();
  } catch (ex) {
    msg.textContent = ex.message;
    msg.className = 'msg err';
  }
});

/* ---------------- Boot ---------------- */

(async function init() {
  try {
    const me = await api('/api/auth/me', null, 'GET');
    if (me.user) return showApp(me.user);
    showAuth();
    const open = await api('/api/auth/signup-open', null, 'GET');
    if (open.open) $('signupSwitch').classList.remove('hidden');
  } catch {
    showAuth();
  }
})();
