// AUR Desk — app shell: lock, navigation, Home screen.
import { COMPANIES, COMPANY_ORDER, DEFAULT_PROFILES } from './companies.js';
import { db, keepDataSafe } from './db.js';
import { esc, inr, icon, toast } from './ui.js';
import { hasPin, runLock } from './lock.js';
import { renderClientList, renderClientForm, renderClient } from './clients.js';
import { renderSettings, renderProfile, renderRateForm } from './settings.js';

const STORE_KEY = 'aurdesk.company';
const AUTO_LOCK_MS = 60 * 1000;
const view = document.getElementById('view');
const tabbar = document.querySelector('.tabbar');
const switcher = document.getElementById('switcher');

const state = {
  company: localStorage.getItem(STORE_KEY) in COMPANIES ? localStorage.getItem(STORE_KEY) : 'studio',
  tab: 'home',
  sub: null,   // a screen opened on top of a tab (form, detail)
  id: null,
};
const cache = { clients: [], rates: [], profiles: {}, owner: 'Shashank', lastBackup: null };

/* ---------- data ---------- */
async function load() {
  [cache.clients, cache.rates, cache.profiles, cache.owner, cache.lastBackup] = await Promise.all([
    db.all('clients'), db.all('rates'), db.getKV('profiles'), db.getKV('owner'), db.getKV('lastBackup'),
  ]);
  cache.profiles ||= {};
  cache.owner ||= 'Shashank';
}

/* ---------- context handed to every screen ---------- */
const ctx = {
  state, cache,
  company: () => COMPANIES[state.company],
  profile: (id = state.company) => ({ ...DEFAULT_PROFILES[id], ...(cache.profiles[id] || {}) }),
  go(sub, id = null) {
    state.sub = sub; state.id = id;
    history.pushState({ tab: state.tab, sub, id }, '');
    render();
  },
  replace(sub, id = null) {
    state.sub = sub; state.id = id;
    history.replaceState({ tab: state.tab, sub, id }, '');
    render();
  },
  back() { history.back(); },
  async reload(andRender = true) { await load(); if (andRender) render(); },
  render: () => render(),
  lockNow: () => lock(),
};

/* ---------- theme ---------- */
function applyTheme() {
  const t = ctx.company().theme;
  const map = {
    primary: t.primary, 'on-primary': t.onPrimary, hero: t.hero, 'hero-muted': t.heroMuted,
    'hero-track': t.heroTrack, 'hero-bar': t.heroBar, dot: t.dot, soft: t.soft,
    border: t.border, 'icon-ink': t.iconInk,
  };
  for (const [k, v] of Object.entries(map)) document.documentElement.style.setProperty('--' + k, v);
}

/* ---------- Home ---------- */
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,';
}

function renderHome() {
  const c = ctx.company();
  const month = new Date().toLocaleString('en-IN', { month: 'long' });
  const received = 0, due = 0; // real figures arrive with invoices in step 4
  const pct = received + due ? Math.round((received / (received + due)) * 100) : 0;
  const clients = cache.clients.filter((x) => x.company === state.company);
  const onboarding = clients.filter((x) => (x.checklist || []).some((i) => !i.done));
  const hasData = cache.clients.length || cache.rates.length;
  const staleBackup = hasData && (!cache.lastBackup || Date.now() - new Date(cache.lastBackup) > 7 * 864e5);
  const p = ctx.profile();

  view.innerHTML = `
    <header class="topbar">
      <div class="brand"><img src="icons/icon-192.png" alt=""><span>AUR DESK</span></div>
      <button class="company-pill" id="open-switcher" aria-label="Switch company, current: ${esc(c.name)}">
        <span class="dot"></span>${esc(c.short)}${icon('chevron')}
      </button>
    </header>

    <div class="greeting"><small>${greeting()}</small><h1>${esc(cache.owner)}</h1></div>

    <section class="hero" aria-label="This month">
      <span class="label">${esc(month)} · ${esc(c.name)}</span>
      <div class="hero-grid">
        <div><small>Received</small><strong>${inr(received)}</strong></div>
        <div><small>Still due</small><strong>${inr(due)}</strong></div>
      </div>
      <div class="track"><div style="width:${pct}%"></div></div>
      <span class="label">${clients.length} ${clients.length === 1 ? 'client' : 'clients'} · ${onboarding.length} still onboarding</span>
    </section>

    ${staleBackup ? `
      <button class="notice" data-goto-settings>
        ${icon('backup')}<span><strong>Back up your data</strong><small>Last backup: ${cache.lastBackup ? new Date(cache.lastBackup).toLocaleDateString('en-IN') : 'never'}. Tap to back up.</small></span>
      </button>` : ''}
    ${!p.upi ? `
      <button class="notice notice-soft" data-goto-profile>
        ${icon('card')}<span><strong>Add how you get paid</strong><small>No UPI ID yet for ${esc(c.name)}. You can add it any time.</small></span>
      </button>` : ''}

    <div class="actions">
      <button class="action primary" data-soon="New quotation">${icon('plus')}New quotation</button>
      <button class="action" data-onboard>${icon('client')}Onboard client</button>
      <button class="action" data-soon="Recording payments">${icon('card')}Record payment</button>
      <button class="action" data-soon="The calculator">${icon('calc')}Quick calculator</button>
    </div>

    <section class="section">
      <div class="section-head"><h2>Still onboarding</h2></div>
      ${onboarding.length ? `<div class="list">${onboarding.slice(0, 4).map((x) => {
        const d = x.checklist.filter((i) => i.done).length;
        return `<button class="list-row" data-client="${x.id}">
          <span class="list-main"><strong>${esc(x.name)}</strong><small>Next: ${esc((x.checklist.find((i) => !i.done) || {}).label || '')}</small></span>
          <span class="chip">${d}/${x.checklist.length}</span></button>`;
      }).join('')}</div>`
      : `<div class="empty">${clients.length ? 'Everyone is fully onboarded.' : `No clients yet for ${esc(c.name)}. Tap <strong>Onboard client</strong> to add one.`}</div>`}
    </section>
  `;

  view.querySelector('#open-switcher').onclick = openSwitcher;
  view.querySelector('[data-onboard]').onclick = () => { setTab('clients'); ctx.go('client-form'); };
  view.querySelectorAll('[data-client]').forEach((b) => (b.onclick = () => { setTab('clients'); ctx.go('client', b.dataset.client); }));
  view.querySelectorAll('[data-soon]').forEach((b) => (b.onclick = () => toast(b.dataset.soon + ' arrives in the next steps')));
  const gs = view.querySelector('[data-goto-settings]');
  if (gs) gs.onclick = () => setTab('settings');
  const gp = view.querySelector('[data-goto-profile]');
  if (gp) gp.onclick = () => { setTab('settings'); ctx.go('profile'); };
}

function renderDocuments() {
  view.innerHTML = `
    <h1 class="page-title">Documents</h1>
    <div class="empty">Quotations arrive in step 3, invoices and receipts in step 4.</div>`;
}

/* ---------- router ---------- */
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  applyTheme();
  tabbar.hidden = !!state.sub;
  document.body.classList.toggle('has-sub', !!state.sub);
  tabbar.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  const screens = {
    'client-form': renderClientForm, client: renderClient,
    profile: renderProfile, rate: renderRateForm,
  };
  if (state.sub && screens[state.sub]) await screens[state.sub](ctx, view);
  else if (state.tab === 'home') renderHome();
  else if (state.tab === 'clients') renderClientList(ctx, view);
  else if (state.tab === 'documents') renderDocuments();
  else if (state.tab === 'settings') await renderSettings(ctx, view);
  if (seq !== renderSeq) return;

  view.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => ctx.back()));
  window.scrollTo(0, 0);
}

function setTab(tab) {
  state.tab = tab; state.sub = null; state.id = null;
  history.replaceState({ tab }, '');
  render();
}

tabbar.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) setTab(tab.dataset.tab);
});

window.addEventListener('popstate', (e) => {
  const s = e.state || {};
  state.tab = s.tab || 'home';
  state.sub = s.sub || null;
  state.id = s.id || null;
  render();
});

/* ---------- company switcher ---------- */
function openSwitcher() {
  const list = document.getElementById('switcher-list');
  list.setAttribute('role', 'radiogroup');
  list.innerHTML = COMPANY_ORDER.map((id) => {
    const c = COMPANIES[id];
    return `
      <button class="company-option" role="radio" data-company="${id}" aria-checked="${id === state.company}"
        style="--option-accent:${c.theme.primary};--option-soft:${c.theme.soft}">
        <img src="${c.logo}" alt="">
        <span><strong>${esc(c.name)}</strong><small>Numbers start with ${c.prefix}</small></span>
      </button>`;
  }).join('');
  switcher.showModal();
}

switcher.addEventListener('click', (e) => {
  const opt = e.target.closest('[data-company]');
  if (opt) {
    state.company = opt.dataset.company;
    localStorage.setItem(STORE_KEY, state.company);
    switcher.close();
    render();
    toast('Switched to ' + ctx.company().name);
    return;
  }
  if (e.target === switcher || e.target.closest('[data-close]')) switcher.close();
});

/* ---------- lock ---------- */
let locking = false;
async function lock() {
  if (locking) return;
  locking = true;
  view.innerHTML = '';
  await runLock((await hasPin()) ? 'unlock' : 'setup');
  locking = false;
  await load();
  render();
}

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) lock();
});

/* ---------- start ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
history.replaceState({ tab: 'home' }, '');
applyTheme();
keepDataSafe();
lock();
