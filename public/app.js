// ═══════════════════════════════════════════════════════════
//  CashTracker — app.js
// ═══════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────
const state = {
  users: [],
  categories: [],
  activeUserId: null,
  currentMonth: currentMonthStr(),
  activeTab: 'dashboard',
  chart: null,
  importRows: [],      // preview from CSV parse
  ocrData: null,       // last OCR result
};

// ── Helpers ──────────────────────────────────────────────────
function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmt(amount, currency = 'EUR') {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(amount ?? 0);
}

function monthLabel(str) {
  const [y, m] = str.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const r = await fetch(url, opts);
  return r.json();
}

function dot(color, size = 'w-3 h-3') {
  return `<span class="${size} rounded-full inline-block flex-shrink-0" style="background:${color}"></span>`;
}

function userInitials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ── Boot ─────────────────────────────────────────────────────
async function boot() {
  [state.users, state.categories] = await Promise.all([
    api('GET', '/api/users'),
    api('GET', '/api/categories'),
  ]);

  // Active user from localStorage or first user
  const savedUser = localStorage.getItem('ct_active_user');
  state.activeUserId = savedUser ? +savedUser : (state.users[0]?.id ?? null);

  renderUserMenu();
  populateCategorySelects();
  populateUserSelects();
  populateMonthFilter();

  // Set today's date in expense form
  document.getElementById('expDate').value = new Date().toISOString().slice(0, 10);

  // Nav
  initTabs();
  initSubTabs();
  initModal();
  initImport();
  initSettings();

  // Load first tab
  switchTab('dashboard');
}

// ── User menu ─────────────────────────────────────────────────
function renderUserMenu() {
  const list = document.getElementById('userMenuList');
  list.innerHTML = state.users.map(u => `
    <button class="user-pick w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 transition"
            data-id="${u.id}" data-color="${u.color}" data-name="${u.name}">
      ${dot(u.color)} ${u.name}
    </button>
  `).join('');

  list.querySelectorAll('.user-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveUser(+btn.dataset.id, btn.dataset.name, btn.dataset.color);
      document.getElementById('userMenu').classList.add('hidden');
    });
  });

  const active = state.users.find(u => u.id === state.activeUserId);
  if (active) updateActiveUserUI(active.name, active.color);
}

function setActiveUser(id, name, color) {
  state.activeUserId = id;
  localStorage.setItem('ct_active_user', id);
  updateActiveUserUI(name, color);
}

function updateActiveUserUI(name, color) {
  document.getElementById('activeUserName').textContent = name;
  document.getElementById('activeUserDot').style.background = color;
}

document.getElementById('userMenuBtn').addEventListener('click', () => {
  document.getElementById('userMenu').classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (!document.getElementById('userMenuBtn').contains(e.target))
    document.getElementById('userMenu').classList.add('hidden');
});

// ── Selects population ────────────────────────────────────────
function populateCategorySelects() {
  const opts = state.categories.map(c =>
    `<option value="${c.id}">${c.icon} ${c.name}</option>`
  ).join('');

  document.getElementById('expCategory').innerHTML =
    '<option value="">— Choisir —</option>' + opts;
  document.getElementById('filterCategory').innerHTML =
    '<option value="">Toutes catégories</option>' + opts;
}

function populateUserSelects() {
  const opts = state.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  document.getElementById('expUser').innerHTML = opts;
  document.getElementById('filterUser').innerHTML = '<option value="">Tous</option>' + opts;
  document.getElementById('importUserId').innerHTML = opts;
  // Set active user as default
  if (state.activeUserId) {
    document.getElementById('expUser').value = state.activeUserId;
    document.getElementById('importUserId').value = state.activeUserId;
  }
}

function populateMonthFilter() {
  const sel = document.getElementById('filterMonth');
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ val, label: monthLabel(val) });
  }
  sel.innerHTML = months.map(m =>
    `<option value="${m.val}" ${m.val === state.currentMonth ? 'selected' : ''}>${m.label}</option>`
  ).join('');
}

// ── Tabs ──────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Month nav on dashboard
  document.getElementById('prevMonth').addEventListener('click', () => {
    const [y, m] = state.currentMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    state.currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    loadDashboard();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    const [y, m] = state.currentMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    state.currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    loadDashboard();
  });

  // Filter changes reload expenses
  ['filterMonth','filterCategory','filterScope','filterUser','filterSearch'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener(id === 'filterSearch' ? 'input' : 'change', loadExpenses);
  });

  // Export CSV
  document.getElementById('exportCSVBtn').addEventListener('click', () => {
    const month = document.getElementById('filterMonth').value;
    window.location = `/api/expenses/export/csv?month=${month}`;
  });
}

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-section').forEach(s => s.classList.add('hidden'));
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'expenses')  loadExpenses();
  if (tab === 'settings')  loadSettings();
}

// ── Sub-tabs (modal) ──────────────────────────────────────────
function initSubTabs() {
  document.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sub-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sub-tab-section').forEach(s => s.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(`subtab-${btn.dataset.subtab}`).classList.remove('hidden');
    });
  });
  // Default: manual tab active
  document.querySelector('[data-subtab="manual"]').classList.add('active');
}

// ── Modal ─────────────────────────────────────────────────────
function initModal() {
  document.getElementById('addExpenseBtn').addEventListener('click', openModal);
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('addModal').addEventListener('click', e => {
    if (e.target === document.getElementById('addModal')) closeModal();
  });
  document.getElementById('saveExpenseBtn').addEventListener('click', saveExpense);
  document.getElementById('ocrBtn').addEventListener('click', runOCR);
  document.getElementById('ocrFillBtn').addEventListener('click', fillFromOCR);
}

function openModal() {
  document.getElementById('addModal').classList.remove('hidden');
  // Reset to manual tab
  document.querySelector('[data-subtab="manual"]').click();
  document.getElementById('expUser').value = state.activeUserId || state.users[0]?.id || '';
  document.getElementById('expDate').value = new Date().toISOString().slice(0, 10);
}

function closeModal() {
  document.getElementById('addModal').classList.add('hidden');
  // Clear OCR state
  document.getElementById('ocrStatus').textContent = '';
  document.getElementById('ocrResult').classList.add('hidden');
  document.getElementById('ocrFillBtn').classList.add('hidden');
  state.ocrData = null;
}

async function saveExpense() {
  const amount   = parseFloat(document.getElementById('expAmount').value);
  const date     = document.getElementById('expDate').value;
  const user_id  = +document.getElementById('expUser').value;
  if (!amount || !date || !user_id) {
    alert('Montant, date et utilisateur sont requis.');
    return;
  }
  const payload = {
    user_id,
    amount,
    currency:    document.getElementById('expCurrency').value,
    merchant:    document.getElementById('expMerchant').value.trim() || null,
    category_id: document.getElementById('expCategory').value || null,
    date,
    note:        document.getElementById('expNote').value.trim() || null,
    scope:       document.getElementById('expScope').value,
    source:      state.ocrData ? 'ocr' : 'manual',
  };
  await api('POST', '/api/expenses', payload);
  closeModal();
  // Clear form
  ['expAmount','expMerchant','expNote'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('expCategory').value = '';
  if (state.activeTab === 'expenses') loadExpenses();
  if (state.activeTab === 'dashboard') loadDashboard();
}

// ── OCR ───────────────────────────────────────────────────────
async function runOCR() {
  const file = document.getElementById('receiptFile').files[0];
  if (!file) { alert('Sélectionne une photo de ticket.'); return; }

  const status = document.getElementById('ocrStatus');
  status.textContent = '⏳ Analyse en cours…';

  const form = new FormData();
  form.append('receipt', file);

  try {
    const data = await api('POST', '/api/ocr', form);
    state.ocrData = data;

    if (data.mock) {
      status.textContent = '⚠️ Mode démo (MINDEE_API_KEY non configuré)';
    } else {
      status.textContent = '✅ Ticket analysé';
    }

    const result = document.getElementById('ocrResult');
    result.innerHTML = `
      <div>💰 Montant : <strong>${data.amount ?? '—'} ${data.amount ? 'EUR' : ''}</strong></div>
      <div>🏪 Enseigne : <strong>${data.merchant ?? '—'}</strong></div>
      <div>📅 Date : <strong>${data.date ?? '—'}</strong></div>
    `;
    result.classList.remove('hidden');
    document.getElementById('ocrFillBtn').classList.remove('hidden');
  } catch (e) {
    status.textContent = '❌ Erreur OCR : ' + e.message;
  }
}

function fillFromOCR() {
  if (!state.ocrData) return;
  const d = state.ocrData;
  if (d.amount)   document.getElementById('expAmount').value = d.amount;
  if (d.merchant) document.getElementById('expMerchant').value = d.merchant;
  if (d.date)     document.getElementById('expDate').value = d.date;
  if (d.suggested_category_id)
    document.getElementById('expCategory').value = d.suggested_category_id;
  // Switch to manual tab to show filled fields
  document.querySelector('[data-subtab="manual"]').click();
}

// ── Dashboard ─────────────────────────────────────────────────
async function loadDashboard() {
  document.getElementById('monthLabel').textContent = monthLabel(state.currentMonth);

  const [stats, expenses] = await Promise.all([
    api('GET', `/api/stats/monthly?month=${state.currentMonth}`),
    api('GET', `/api/expenses?month=${state.currentMonth}`),
  ]);

  const t = stats.totals;
  document.getElementById('statTotal').textContent   = fmt(t?.total);
  document.getElementById('statPersonal').textContent = fmt(t?.personal);
  document.getElementById('statFamily').textContent   = fmt(t?.family);

  // Chart
  const cats = stats.byCategory.filter(c => c.total > 0);
  const chartEl = document.getElementById('categoryChart');
  const emptyEl = document.getElementById('chartEmpty');

  if (cats.length === 0) {
    chartEl.style.display = 'none';
    emptyEl.classList.remove('hidden');
  } else {
    chartEl.style.display = '';
    emptyEl.classList.add('hidden');
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(chartEl, {
      type: 'bar',
      data: {
        labels: cats.map(c => `${c.icon || ''} ${c.name || 'Divers'}`),
        datasets: [{
          data: cats.map(c => c.total),
          backgroundColor: cats.map(c => c.color || '#6b7280'),
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { color: '#9ca3af', callback: v => fmt(v) }, grid: { color: '#1f2937' } },
          x: { ticks: { color: '#9ca3af' }, grid: { display: false } },
        },
      },
    });
  }

  // Recent 5
  const recent = expenses.slice(0, 5);
  const list = document.getElementById('recentList');
  if (recent.length === 0) {
    list.innerHTML = '<li class="p-4 text-gray-500 text-sm text-center">Aucune dépense ce mois</li>';
    return;
  }
  list.innerHTML = recent.map(e => expenseRowHtml(e)).join('');
  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteExpense(+btn.dataset.id, loadDashboard));
  });
}

// ── Expenses list ─────────────────────────────────────────────
async function loadExpenses() {
  const params = new URLSearchParams();
  const month    = document.getElementById('filterMonth').value;
  const category = document.getElementById('filterCategory').value;
  const scope    = document.getElementById('filterScope').value;
  const user     = document.getElementById('filterUser').value;
  const search   = document.getElementById('filterSearch').value.trim();

  if (month)    params.set('month',       month);
  if (category) params.set('category_id', category);
  if (scope)    params.set('scope',        scope);
  if (user)     params.set('user_id',      user);
  if (search)   params.set('search',       search);

  const expenses = await api('GET', `/api/expenses?${params}`);
  const list  = document.getElementById('expensesList');
  const empty = document.getElementById('expensesEmpty');

  if (expenses.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = expenses.map(e => `<li class="bg-gray-900 rounded-2xl border border-gray-800">${expenseRowHtml(e)}</li>`).join('');
  list.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteExpense(+btn.dataset.id, loadExpenses));
  });
}

function expenseRowHtml(e) {
  const catBadge = e.category_name
    ? `<span class="text-xs px-2 py-0.5 rounded-full font-medium" style="background:${e.category_color}22;color:${e.category_color}">${e.category_icon || ''} ${e.category_name}</span>`
    : `<span class="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">—</span>`;

  const userAvatar = `<span class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
    style="background:${e.user_color}33;color:${e.user_color}">${userInitials(e.user_name || '?')}</span>`;

  const scopeBadge = e.scope === 'family'
    ? '<span class="text-xs text-pink-400">famille</span>'
    : '<span class="text-xs text-indigo-400">perso</span>';

  const label = e.merchant || e.raw_label || '—';

  return `
    <div class="flex items-center gap-3 p-3">
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-medium truncate">${label}</span>
          ${catBadge}
          ${scopeBadge}
        </div>
        <div class="flex items-center gap-2 mt-0.5">
          <span class="text-xs text-gray-400">${e.date}</span>
          ${e.note ? `<span class="text-xs text-gray-500 truncate">${e.note}</span>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        ${userAvatar}
        <span class="text-sm font-semibold text-white">${fmt(e.amount, e.currency)}</span>
        <button class="del-btn text-gray-600 hover:text-red-400 transition text-lg leading-none" data-id="${e.id}">×</button>
      </div>
    </div>
  `;
}

async function deleteExpense(id, reload) {
  if (!confirm('Supprimer cette dépense ?')) return;
  await api('DELETE', `/api/expenses/${id}`);
  reload();
}

// ── Import ────────────────────────────────────────────────────
function initImport() {
  document.getElementById('analyzeBtn').addEventListener('click', analyzeCSV);
  document.getElementById('confirmImportBtn').addEventListener('click', confirmImport);
  document.getElementById('selectAllBtn').addEventListener('click', () => setAllChecks(true));
  document.getElementById('deselectAllBtn').addEventListener('click', () => setAllChecks(false));
}

async function analyzeCSV() {
  const file = document.getElementById('importFile').files[0];
  if (!file) { alert('Sélectionne un fichier CSV ou PDF.'); return; }

  const form = new FormData();
  form.append('file', file);

  const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
  const endpoint = isPDF ? '/api/import/pdf' : '/api/import/csv';

  const res = await api('POST', endpoint, form);
  if (res.error) {
    alert('Erreur : ' + res.error + (res.text_preview ? '\n\nAperçu du texte extrait :\n' + res.text_preview : ''));
    return;
  }

  // Format badge
  const badge = document.getElementById('formatBadge');
  badge.querySelector('span').textContent = res.formatLabel;
  badge.classList.remove('hidden');

  state.importRows = res.rows.map((r, i) => ({ ...r, _idx: i, included: true }));
  renderImportPreview();
}

function renderImportPreview() {
  const rows = state.importRows;
  document.getElementById('previewCount').textContent = rows.length;
  document.getElementById('importPreview').classList.remove('hidden');
  document.getElementById('importSuccess').classList.add('hidden');

  const tbody = document.getElementById('previewTableBody');
  tbody.innerHTML = rows.map((r, i) => {
    const cat = state.categories.find(c => c.id === r.category_id);
    const catOpts = state.categories.map(c =>
      `<option value="${c.id}" ${c.id === r.category_id ? 'selected' : ''}>${c.icon} ${c.name}</option>`
    ).join('');
    return `
      <tr class="${r.included ? '' : 'opacity-40'}">
        <td class="p-3">
          <input type="checkbox" class="row-check accent-indigo-500 w-4 h-4 rounded" data-idx="${i}" ${r.included ? 'checked' : ''} />
        </td>
        <td class="p-3 text-sm whitespace-nowrap">${r.date}</td>
        <td class="p-3 text-sm max-w-xs truncate" title="${r.label}">${r.label}</td>
        <td class="p-3 text-sm text-right font-medium">${fmt(r.amount)}</td>
        <td class="p-3">
          <select class="cat-select input-sm text-xs" data-idx="${i}">
            ${catOpts}
          </select>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      state.importRows[+cb.dataset.idx].included = cb.checked;
      cb.closest('tr').classList.toggle('opacity-40', !cb.checked);
      updateConfirmCount();
    });
  });
  tbody.querySelectorAll('.cat-select').forEach(sel => {
    sel.addEventListener('change', () => {
      state.importRows[+sel.dataset.idx].category_id = +sel.value;
    });
  });

  updateConfirmCount();
}

function updateConfirmCount() {
  const count = state.importRows.filter(r => r.included).length;
  document.getElementById('confirmCount').textContent = count;
}

function setAllChecks(val) {
  state.importRows.forEach(r => r.included = val);
  document.querySelectorAll('.row-check').forEach(cb => {
    cb.checked = val;
    cb.closest('tr').classList.toggle('opacity-40', !val);
  });
  updateConfirmCount();
}

async function confirmImport() {
  const included = state.importRows.filter(r => r.included);
  if (included.length === 0) { alert('Aucune dépense sélectionnée.'); return; }

  const user_id = +document.getElementById('importUserId').value;
  const scope   = document.getElementById('importScope').value;

  const res = await api('POST', '/api/import/csv/confirm', { expenses: included, user_id, scope });
  if (res.error) { alert('Erreur : ' + res.error); return; }

  document.getElementById('importSuccess').textContent = `✅ ${res.inserted} dépenses importées avec succès !`;
  document.getElementById('importSuccess').classList.remove('hidden');
  document.getElementById('importPreview').classList.add('hidden');
  document.getElementById('formatBadge').classList.add('hidden');
  state.importRows = [];
}

// ── Settings ──────────────────────────────────────────────────
function loadSettings() {
  const list = document.getElementById('settingsUserList');
  list.innerHTML = state.users.map(u => `
    <li class="flex items-center gap-3 bg-gray-900 rounded-2xl border border-gray-800 px-4 py-3">
      <span class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
        style="background:${u.color}33;color:${u.color}">${userInitials(u.name)}</span>
      <div>
        <p class="text-sm font-medium">${u.name}</p>
        <p class="text-xs text-gray-400">${u.email}</p>
      </div>
      <span class="ml-auto w-4 h-4 rounded-full" style="background:${u.color}"></span>
    </li>
  `).join('');
}

function initSettings() {
  document.getElementById('addUserBtn').addEventListener('click', async () => {
    const name  = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim();
    const color = document.getElementById('newUserColor').value;
    if (!name || !email) { alert('Nom et email requis.'); return; }

    const user = await api('POST', '/api/users', { name, email, color });
    if (user.error) { alert('Erreur : ' + user.error); return; }

    state.users.push(user);
    renderUserMenu();
    populateUserSelects();
    loadSettings();
    document.getElementById('newUserName').value  = '';
    document.getElementById('newUserEmail').value = '';
  });
}

// ── Start ─────────────────────────────────────────────────────
boot();
