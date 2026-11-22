// AUR Desk — app shell: lock, navigation, Home screen.
import { COMPANIES, COMPANY_ORDER, DEFAULT_PROFILES } from './companies.js';
import { db, keepDataSafe } from './db.js';
import { esc, inr, icon, toast } from './ui.js';
import { hasPin, runLock } from './lock.js';
import { renderClientList, renderClientForm, renderClient } from './clients.js';
import { renderSettings, renderProfile, renderRateForm } from './settings.js';
import { renderDocuments, renderEditor, renderDoc, resetEditor } from './quote.js';
import { renderMoney, renderTxnForm } from './money.js';
import { renderCalc } from './calc.js';
import { invoiceState, money, fmtDate, addDays } from './docs.js';

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
  preset: null, // client chosen before opening a new quotation
  presetDraft: null, // items carried over from the Calculator
};
const cache = { clients: [], rates: [], docs: [], txns: [], profiles: {}, owner: 'Shashank', lastBackup: null };

/* ---------- data ---------- */
async function load() {
  [cache.clients, cache.rates, cache.docs, cache.txns, cache.profiles, cache.owner, cache.lastBackup] = await Promise.all([
    db.all('clients'), db.all('rates'), db.all('docs'), db.all('txns'), db.getKV('profiles'), db.getKV('owner'), db.getKV('lastBackup'),
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
    if (state.sub === sub && state.id === id && sub !== 'doc-edit') return; // double tap: don't stack the same screen
    if (sub === 'doc-edit') resetEditor();
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
  setTab: (tab) => setTab(tab),
  switchCompany(id) { state.company = id; localStorage.setItem(STORE_KEY, id); applyTheme(); },
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
  const thisMonth = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const received = cache.txns
    .filter((t) => t.company === state.company && t.type === 'in' && (t.currency || 'INR') === 'INR' && t.date.startsWith(thisMonth))
    .reduce((s, t) => s + Number(t.amount || 0), 0);
  const openInvoices = cache.docs
    .filter((d) => d.company === state.company && d.kind === 'invoice')
    .map((d) => ({ d, s: invoiceState(d, cache.txns) }))
    .filter((x) => x.s.balance > 0)
    .sort((a, b) => addDays(a.d.date, a.d.payment.balanceDays).localeCompare(addDays(b.d.date, b.d.payment.balanceDays)));
  const due = openInvoices.filter((x) => x.d.currency === 'INR').reduce((s, x) => s + x.s.balance, 0);
  const dueUsd = openInvoices.filter((x) => x.d.currency === 'USD').reduce((s, x) => s + x.s.balance, 0);
  const pct = received + due ? Math.round((received / (received + due)) * 100) : 0;
  const clients = cache.clients.filter((x) => x.company === state.company);
  const onboarding = clients.filter((x) => (x.checklist || []).some((i) => !i.done));
  const openQuotes = cache.docs.filter((d) => d.company === state.company && d.kind === 'quote' && ['draft', 'sent', 'accepted'].includes(d.status)).length;
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
        <div><small>Still due</small><strong>${inr(due)}</strong>${dueUsd ? `<small>+ ${esc(money(dueUsd, 'USD'))}</small>` : ''}</div>
      </div>
      <div class="track"><div style="width:${pct}%"></div></div>
      <span class="label">${clients.length} ${clients.length === 1 ? 'client' : 'clients'} · ${openQuotes} open ${openQuotes === 1 ? 'quotation' : 'quotations'}</span>
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
      <button class="action primary" data-new-quote>${icon('plus')}New quotation</button>
      <button class="action" data-onboard>${icon('client')}Onboard client</button>
      <button class="action" data-record>${icon('card')}Record payment</button>
      <button class="action" data-calc>${icon('calc')}Calculator</button>
    </div>

    <section class="section">
      <div class="section-head"><h2>Payments due</h2></div>
      ${openInvoices.length ? `<div class="list">${openInvoices.slice(0, 5).map(({ d, s }) => `
        <button class="list-row" data-inv="${d.id}">
          <span class="list-main"><strong>${esc(d.client ? d.client.name : '')}</strong>
            <small>${esc(d.number)} · ${s.advancePending ? 'advance due now' : 'due ' + esc(fmtDate(addDays(d.date, d.payment.balanceDays)))}</small></span>
          <span class="doc-right"><strong>${esc(money(s.balance, d.currency))}</strong>
            <span class="status ${s.status === 'partial' ? 'st-warn' : 'st-bad'}">${s.status === 'partial' ? 'Part paid' : 'Unpaid'}</span></span>
        </button>`).join('')}</div>`
      : '<div class="empty">Nothing due. Invoices with money still to come show up here.</div>'}
    </section>

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
  // Screens opened from Home stay "on" Home, so Back returns straight here.
  view.querySelector('[data-onboard]').onclick = () => ctx.go('client-form');
  view.querySelector('[data-new-quote]').onclick = () => { state.preset = null; ctx.go('doc-edit'); };
  view.querySelectorAll('[data-client]').forEach((b) => (b.onclick = () => ctx.go('client', b.dataset.client)));
  view.querySelector('[data-record]').onclick = () => { state.preset = { type: 'in' }; ctx.go('txn'); };
  view.querySelector('[data-calc]').onclick = () => ctx.go('calc');
  view.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = () => ctx.go('doc', b.dataset.inv)));
  const gs = view.querySelector('[data-goto-settings]');
  if (gs) gs.onclick = () => setTab('settings');
  const gp = view.querySelector('[data-goto-profile]');
  if (gp) gp.onclick = () => ctx.go('profile');
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
    'doc-edit': renderEditor, doc: renderDoc, txn: renderTxnForm, calc: renderCalc,
  };
  if (state.sub && screens[state.sub]) await screens[state.sub](ctx, view);
  else if (state.tab === 'home') renderHome();
  else if (state.tab === 'clients') renderClientList(ctx, view);
  else if (state.tab === 'documents') renderDocuments(ctx, view);
  else if (state.tab === 'money') renderMoney(ctx, view);
  else if (state.tab === 'settings') await renderSettings(ctx, view);
  if (seq !== renderSeq) return;

  view.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => ctx.back()));
  window.scrollTo(0, 0);
}

// History is kept flat: [Home] or [Home, another tab] (+ any screens opened on top).
// So Back from any tab goes to Home, and Back on Home closes the app. Switching tabs never stacks.
function setTab(tab) {
  if (tab === state.tab && !state.sub) return;
  const fromHome = state.tab === 'home';
  if (tab === 'home') { history.back(); return; }           // popstate brings Home back
  state.tab = tab; state.sub = null; state.id = null;
  if (fromHome) history.pushState({ tab }, '');
  else history.replaceState({ tab }, '');
  render();
}

tabbar.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) setTab(tab.dataset.tab);
});

window.addEventListener('popstate', (e) => {
  const s = e.state || {};
  if (state.sub === 'doc-edit' && s.sub !== 'doc-edit') resetEditor(); // phone Back out of the editor drops the unsaved draft
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

/* ---------- lock ----------
   The app asks for the PIN when it is opened fresh, or after 1 minute in the background.
   A refresh (or pull-to-refresh) within that minute keeps you unlocked: the "unlocked"
   flag lives in sessionStorage, which survives a reload but is cleared when the app is closed. */
const SESSION_KEY = 'aurdesk.unlocked';
const ACTIVE_KEY = 'aurdesk.lastActive';
const markActive = () => sessionStorage.setItem(ACTIVE_KEY, String(Date.now()));

function stillUnlocked() {
  const last = Number(sessionStorage.getItem(ACTIVE_KEY) || 0);
  return sessionStorage.getItem(SESSION_KEY) === '1' && Date.now() - last < AUTO_LOCK_MS;
}

let locking = false;
async function lock() {
  if (locking) return;
  locking = true;
  sessionStorage.removeItem(SESSION_KEY);
  view.innerHTML = '';
  await runLock((await hasPin()) ? 'unlock' : 'setup');
  sessionStorage.setItem(SESSION_KEY, '1');
  markActive();
  locking = false;
  await load();
  render();
}

async function start() {
  if ((await hasPin()) && stillUnlocked()) {
    markActive();
    await load();
    render();
  } else {
    lock();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) markActive();
  else if (!locking && !stillUnlocked()) lock();
  else markActive();
});
window.addEventListener('pagehide', markActive);

/* ---------- start ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
history.replaceState({ tab: 'home' }, '');
applyTheme();
keepDataSafe();
start();
