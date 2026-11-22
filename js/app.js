// AUR Desk — app shell: lock, navigation, Home screen.
import { COMPANIES, BRAND_ORDER, DEFAULT_PROFILES } from './companies.js';
import { groupFigures, breakdown, GROUP } from './finance.js';
import { db, keepDataSafe } from './db.js';
import { esc, inr, icon, toast } from './ui.js';
import { hasPin, runLock } from './lock.js';
import { renderClientList, renderClientForm, renderClient } from './clients.js';
import { renderSettings, renderProfile, renderRateForm, renderGroup } from './settings.js';
import { renderDocuments, renderEditor, renderDoc, resetEditor } from './quote.js';
import { renderMoney, renderMoneyCompany, renderTxnForm } from './money.js';
import { renderCalc } from './calc.js';
import { invoiceState, money, fmtDate, addDays } from './docs.js';
import { status as backupStatus, isDue as backupIsDue, backupToDrive, startAutoBackup, autoBackup, warmUp, explain as backupError } from './backup.js';

const STORE_KEY = 'aurdesk.company';
const AUTO_LOCK_MS = 60 * 1000;
const view = document.getElementById('view');
const tabbar = document.querySelector('.tabbar');
const switcher = document.getElementById('switcher');

const state = {
  // only the brands can be selected; AUR Ventures is the parent (see Settings → Group)
  company: BRAND_ORDER.includes(localStorage.getItem(STORE_KEY)) ? localStorage.getItem(STORE_KEY) : 'studio',
  tab: 'home',
  sub: null,   // a screen opened on top of a tab (form, detail)
  id: null,
  preset: null, // client chosen before opening a new quotation
  presetDraft: null, // items carried over from the Calculator
};
const cache = { clients: [], rates: [], docs: [], txns: [], profiles: {}, owner: 'Shashank', lastBackup: null, backup: null, backupDue: false };

/* ---------- data ---------- */
async function load() {
  [cache.clients, cache.rates, cache.docs, cache.txns, cache.profiles, cache.owner, cache.lastBackup] = await Promise.all([
    db.all('clients'), db.all('rates'), db.all('docs'), db.all('txns'), db.getKV('profiles'), db.getKV('owner'), db.getKV('lastBackup'),
  ]);
  cache.profiles ||= {};
  cache.owner ||= 'Shashank';
  cache.backup = await backupStatus();
  cache.backupDue = await backupIsDue();
}

/* ---------- context handed to every screen ---------- */
const ctx = {
  state, cache,
  company: () => COMPANIES[state.company],
  profile: (id = state.company) => {
    const p = { ...DEFAULT_PROFILES[id], ...(cache.profiles[id] || {}) };
    if (id === GROUP) return p;
    const g = { ...DEFAULT_PROFILES[GROUP], ...(cache.profiles[GROUP] || {}) };
    if (!p.gstin && g.gstin) p.gstin = g.gstin;                 // one registration for both brands
    p.brandOf = g.brandLine ? `${p.displayName || COMPANIES[id].name} is a brand of ${g.displayName || 'AUR Ventures'}` : '';
    return p;
  },
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

let openRow = null; // which company line is opened in the group card

function groupCard() {
  const thisMonth = new Date().toLocaleDateString('en-CA').slice(0, 7);
  const monthName = new Date().toLocaleString('en-IN', { month: 'long' });
  const g = groupFigures(cache.txns, thisMonth);
  const signed = (v) => (v < 0 ? '−' : '+') + money(Math.abs(v));
  const rows = [
    ...g.brands.map((b) => ({ id: b.id, co: b.co, label: b.co.name, value: b.net })),
    { id: GROUP, co: g.ventures.co, label: 'AUR Ventures · shared costs', value: g.ventures.net },
  ];
  const list = (items, total, empty) => items.length
    ? items.slice(0, 4).map(([k, v]) => `<li><span>${esc(k)}</span><span>${esc(money(v))}</span></li>`).join('')
      + (items.length > 4 ? `<li class="more-line"><span>+ ${items.length - 4} more</span><span></span></li>` : '')
    : `<li class="none"><span>${empty}</span><span></span></li>`;
  const detail = (id) => {
    const bd = breakdown(cache.txns, id, thisMonth);
    if (id === GROUP) {
      return `
        <div class="gc-part"><strong>Shared costs ${esc(money(g.ventures.sharedCosts))}</strong><ul>${list(bd.byProject, g.ventures.sharedCosts, 'No shared costs this month')}</ul></div>
        ${g.ventures.funding ? `<div class="gc-part"><strong>Funding in ${esc(money(g.ventures.funding))}</strong><small>Not counted as profit</small><ul>${list(bd.in, g.ventures.funding, '')}</ul></div>` : ''}`;
    }
    const b = g.brands.find((x) => x.id === id);
    return `
      <div class="gc-part"><strong>In ${esc(money(b.income))}</strong><ul>${list(bd.in, b.income, 'Nothing in yet')}</ul></div>
      <div class="gc-part"><strong>Out ${esc(money(b.costs))}</strong><ul>${list(bd.out, b.costs, 'No expenses yet')}</ul></div>
      ${b.transfers ? `<p class="gc-note">Moved to AUR Ventures: ${esc(money(b.transfers))} (not a cost)</p>` : ''}`;
  };
  return `
    <section class="hero group-card" aria-label="This month, all companies">
      <span class="label">${esc(monthName)} · AUR Group</span>
      <div class="gc-main">
        <small>${g.net < 0 ? 'Net loss' : 'Net profit'}</small>
        <strong class="${g.net < 0 ? 'neg' : ''}">${esc((g.net < 0 ? '−' : '') + money(Math.abs(g.net)))}</strong>
        <span class="label">In ${esc(money(g.income))} · Out ${esc(money(g.costs))}${g.usdIn || g.usdOut ? ` · $ in ${esc(money(g.usdIn, 'USD'))}` : ''}</span>
      </div>
      <div class="gc-rows">
        ${rows.map((r) => `
          <div class="gc-item ${openRow === r.id ? 'open' : ''}">
            <button class="gc-row" data-gc="${r.id}" aria-expanded="${openRow === r.id}" style="--co:${r.co.theme.dot}">
              <span class="co-dot" aria-hidden="true"></span>
              <span class="gc-name">${esc(r.label)}</span>
              <span class="gc-val ${r.value < 0 ? 'neg' : r.value > 0 ? 'pos' : ''}">${esc(r.value ? signed(r.value) : money(0))}</span>
              ${icon('chevron', 'gc-chev')}
            </button>
            ${openRow === r.id ? `<div class="gc-detail">${detail(r.id)}<button class="gc-see" data-see="${r.id}">See all entries ${icon('right')}</button></div>` : ''}
          </div>`).join('')}
      </div>
    </section>`;
}

function renderHome() {
  const c = ctx.company();
  const coTag = (id) => `<span class="co-tag" style="--co:${COMPANIES[id].theme.dot}">${esc(COMPANIES[id].short)}</span>`;
  const openInvoices = cache.docs
    .filter((d) => BRAND_ORDER.includes(d.company) && d.kind === 'invoice')
    .map((d) => ({ d, s: invoiceState(d, cache.txns) }))
    .filter((x) => x.s.balance > 0)
    .sort((a, b) => addDays(a.d.date, a.d.payment.balanceDays).localeCompare(addDays(b.d.date, b.d.payment.balanceDays)));
  const dueInr = openInvoices.filter((x) => x.d.currency === 'INR').reduce((s, x) => s + x.s.balance, 0);
  const clients = cache.clients.filter((x) => BRAND_ORDER.includes(x.company));
  const onboarding = clients.filter((x) => (x.checklist || []).some((i) => !i.done));
  const hasData = cache.clients.length || cache.rates.length || cache.docs.length || cache.txns.length;
  const bk = cache.backup || {};
  const p = ctx.profile();

  view.innerHTML = `
    <header class="topbar">
      <div class="brand"><img src="icons/icon-192.png" alt=""><span>AUR DESK</span></div>
      <button class="company-pill" id="open-switcher" aria-label="Working in ${esc(c.name)}. Tap to switch">
        <span class="dot"></span>${esc(c.short)}${icon('chevron')}
      </button>
    </header>

    <div class="greeting"><small>${greeting()}</small><h1>${esc(cache.owner)}</h1></div>

    ${groupCard()}

    ${!bk.ready && hasData ? `
      <button class="notice" data-goto-settings>
        ${icon('backup')}<span><strong>Set up Google Drive backup</strong><small>Your data is only on this phone. Takes about 5 minutes, once.</small></span>
      </button>` : ''}
    ${bk.ready && cache.backupDue ? `
      <button class="notice" data-backup-now>
        ${icon('backup')}<span><strong>Backup due · tap to back up</strong><small>Saves an encrypted copy to Google Drive (${esc(bk.prefs.email)}).${bk.last ? ' Last: ' + esc(new Date(bk.last).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })) + '.' : ''}</small></span>
      </button>` : ''}
    ${!p.upi ? `
      <button class="notice notice-soft" data-goto-profile>
        ${icon('card')}<span><strong>Add how you get paid</strong><small>No UPI ID yet for ${esc(c.name)}. You can add it any time.</small></span>
      </button>` : ''}

    <p class="work-in">New work goes to <strong>${esc(c.name)}</strong> · switch at the top</p>
    <div class="actions">
      <button class="action primary" data-new-quote>${icon('plus')}New quotation</button>
      <button class="action" data-onboard>${icon('client')}Onboard client</button>
      <button class="action" data-record>${icon('card')}Record payment</button>
      <button class="action" data-calc>${icon('calc')}Calculator</button>
    </div>

    <section class="section">
      <div class="section-head"><h2>Payments due</h2>${dueInr ? `<span class="muted">${esc(money(dueInr))} still to come</span>` : ''}</div>
      ${openInvoices.length ? `<div class="list">${openInvoices.slice(0, 6).map(({ d, s }) => `
        <button class="list-row" data-inv="${d.id}">
          <span class="list-main"><strong>${esc(d.client ? d.client.name : '')}</strong>
            <small>${coTag(d.company)}${esc(d.number)} · ${s.advancePending ? 'advance due now' : 'due ' + esc(fmtDate(addDays(d.date, d.payment.balanceDays)))}</small></span>
          <span class="doc-right"><strong>${esc(money(s.balance, d.currency))}</strong>
            <span class="status ${s.status === 'partial' ? 'st-warn' : 'st-bad'}">${s.status === 'partial' ? 'Part paid' : 'Unpaid'}</span></span>
        </button>`).join('')}</div>`
      : '<div class="empty">Nothing due. Invoices with money still to come show up here.</div>'}
    </section>

    <section class="section">
      <div class="section-head"><h2>Still onboarding</h2></div>
      ${onboarding.length ? `<div class="list">${onboarding.slice(0, 5).map((x) => {
        const d = x.checklist.filter((i) => i.done).length;
        return `<button class="list-row" data-client="${x.id}">
          <span class="list-main"><strong>${esc(x.name)}</strong><small>${coTag(x.company)}Next: ${esc((x.checklist.find((i) => !i.done) || {}).label || '')}</small></span>
          <span class="chip">${d}/${x.checklist.length}</span></button>`;
      }).join('')}</div>`
      : `<div class="empty">${clients.length ? 'Everyone is fully onboarded.' : 'No clients yet. Tap <strong>Onboard client</strong> to add one.'}</div>`}
    </section>
  `;

  view.querySelector('#open-switcher').onclick = openSwitcher;
  view.querySelectorAll('[data-gc]').forEach((b) => (b.onclick = () => {
    openRow = openRow === b.dataset.gc ? null : b.dataset.gc;
    renderHome();
    const row = view.querySelector(`[data-gc="${b.dataset.gc}"]`);
    if (row) row.focus({ preventScroll: true });
  }));
  view.querySelectorAll('[data-see]').forEach((b) => (b.onclick = () => ctx.go('money-co', b.dataset.see)));
  // Screens opened from Home stay "on" Home, so Back returns straight here.
  view.querySelector('[data-onboard]').onclick = () => ctx.go('client-form');
  view.querySelector('[data-new-quote]').onclick = () => { state.preset = null; ctx.go('doc-edit'); };
  view.querySelectorAll('[data-client]').forEach((b) => (b.onclick = () => ctx.go('client', b.dataset.client)));
  view.querySelector('[data-record]').onclick = () => { state.preset = { type: 'in', company: state.company }; ctx.go('txn'); };
  view.querySelector('[data-calc]').onclick = () => ctx.go('calc');
  view.querySelectorAll('[data-inv]').forEach((b) => (b.onclick = () => ctx.go('doc', b.dataset.inv)));
  const gs = view.querySelector('[data-goto-settings]');
  if (gs) gs.onclick = () => setTab('settings');
  const bn = view.querySelector('[data-backup-now]');
  if (bn) bn.onclick = async () => {
    bn.disabled = true; bn.querySelector('strong').textContent = 'Backing up…';
    try { await backupToDrive({ interactive: true }); toast('Backed up to Google Drive'); }
    catch (err) { toast(backupError(err)); }
    await ctx.reload();
  };
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
    'doc-edit': renderEditor, doc: renderDoc, txn: renderTxnForm, calc: renderCalc, 'money-co': renderMoneyCompany, group: renderGroup,
  };
  if (state.sub && screens[state.sub]) await screens[state.sub](ctx, view);
  else if (state.tab === 'home') {
    // always show the current backup state on Home, and let auto-backup check if one is due
    [cache.backup, cache.backupDue] = await Promise.all([backupStatus(), backupIsDue()]);
    if (seq !== renderSeq) return;
    renderHome();
    if (cache.backup.ready && cache.backupDue) autoBackup();
  }
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
  list.innerHTML = BRAND_ORDER.map((id) => {
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
  startAutoBackup();
  warmUp();
}

async function start() {
  if ((await hasPin()) && stillUnlocked()) {
    markActive();
    await load();
    render();
    startAutoBackup();
    warmUp();
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

/* ---------- backup events: refresh Home when a backup finishes or becomes due ---------- */
const refreshHome = async () => { if (state.tab === 'home' && !state.sub && !locking) { await load(); render(); } };
window.addEventListener('aurdesk:backup', () => { toast('Backed up to Google Drive'); refreshHome(); });
window.addEventListener('aurdesk:backup-due', refreshHome);

/* ---------- start ---------- */
// Offline support + updates: when a new version takes over, reload once so it shows straight away.
const APP_VERSION = 'step 5.1'; // shown in Settings
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return; // first install: nothing to refresh
    reloaded = true;
    location.reload();
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }));
}
history.replaceState({ tab: 'home' }, '');
applyTheme();
keepDataSafe();
start();
