// AUR Desk — step 1: app shell, company switcher and Home screen.
import { COMPANIES, COMPANY_ORDER } from './companies.js';

const STORE_KEY = 'aurdesk.company';
const view = document.getElementById('view');
const switcher = document.getElementById('switcher');
const toastEl = document.getElementById('toast');

const state = {
  company: localStorage.getItem(STORE_KEY) in COMPANIES ? localStorage.getItem(STORE_KEY) : 'studio',
  tab: 'home',
};

/* ---------- helpers ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const company = () => COMPANIES[state.company];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,';
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* ---------- theme ---------- */
function applyTheme() {
  const t = company().theme;
  const root = document.documentElement.style;
  const map = {
    primary: t.primary, 'on-primary': t.onPrimary, hero: t.hero, 'hero-muted': t.heroMuted,
    'hero-track': t.heroTrack, 'hero-bar': t.heroBar, dot: t.dot, soft: t.soft,
    border: t.border, 'icon-ink': t.iconInk,
  };
  for (const [k, v] of Object.entries(map)) root.setProperty('--' + k, v);
}

/* ---------- screens ---------- */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  client: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6"/>',
  card: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>',
  calc: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function renderHome() {
  const c = company();
  const month = new Date().toLocaleString('en-IN', { month: 'long' });
  // Real figures arrive in step 2, when invoices and payments are stored on the phone.
  const received = 0, due = 0;
  const pct = received + due ? Math.round((received / (received + due)) * 100) : 0;

  view.innerHTML = `
    <header class="topbar">
      <div class="brand"><img src="icons/icon-192.png" alt=""><span>AUR DESK</span></div>
      <button class="company-pill" id="open-switcher" aria-label="Switch company, current: ${esc(c.name)}">
        <span class="dot"></span>${esc(c.short)}
        <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.chevron}</svg>
      </button>
    </header>

    <div class="greeting"><small>${greeting()}</small><h1>Shashank</h1></div>

    <section class="hero" aria-label="This month">
      <span class="label">${esc(month)} · ${esc(c.name)}</span>
      <div class="hero-grid">
        <div><small>Received</small><strong>${inr(received)}</strong></div>
        <div><small>Still due</small><strong>${inr(due)}</strong></div>
      </div>
      <div class="track"><div style="width:${pct}%"></div></div>
      <span class="label">${pct}% of this month's billing collected</span>
    </section>

    <div class="actions">
      <button class="action primary" data-soon="New quotation">${icon('plus')}New quotation</button>
      <button class="action" data-soon="Client onboarding">${icon('client')}Onboard client</button>
      <button class="action" data-soon="Recording payments">${icon('card')}Record payment</button>
      <button class="action" data-soon="The calculator">${icon('calc')}Quick calculator</button>
    </div>

    <section class="section">
      <div class="section-head"><h2>Payments due</h2></div>
      <div class="empty">No invoices yet for ${esc(c.name)}.<br>Your first quotation will show up here once it becomes an invoice.</div>
    </section>
  `;
  document.getElementById('open-switcher').addEventListener('click', openSwitcher);
}

function renderPlaceholder(title, text) {
  view.innerHTML = `
    <h1 class="page-title">${esc(title)}</h1>
    <div class="empty">${esc(text)}</div>
  `;
}

function render() {
  applyTheme();
  document.querySelectorAll('.tab').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (state.tab === 'home') renderHome();
  if (state.tab === 'clients') renderPlaceholder('Clients', 'Client onboarding arrives in step 2.');
  if (state.tab === 'documents') renderPlaceholder('Documents', 'Quotations, invoices and receipts arrive in steps 3 and 4.');
  if (state.tab === 'settings') renderPlaceholder('Settings', 'Your rate card, UPI ID and backups arrive in step 2.');
  view.scrollTop = 0;
}

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
    toast('Switched to ' + company().name);
    return;
  }
  // tap on the dark backdrop, or Cancel, closes the sheet
  if (e.target === switcher || e.target.closest('[data-close]')) switcher.close();
});

/* ---------- navigation & actions ---------- */
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  state.tab = tab.dataset.tab;
  render();
});

view.addEventListener('click', (e) => {
  const soon = e.target.closest('[data-soon]');
  if (soon) toast(soon.dataset.soon + ' is coming in the next steps');
});

/* ---------- offline support ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}

render();
