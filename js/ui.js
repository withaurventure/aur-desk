// AUR Desk — small shared helpers.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
export const usd = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const MARKETS = { prayagraj: 'Prayagraj', india: 'Other Indian city', intl: 'International' };
export const BILLING = { monthly: 'Monthly', once: 'One-time', sqft: 'Per sq ft', piece: 'Per piece' };

export const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  client: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6"/>',
  card: '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20M6 15h4"/>',
  calc: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h2M14 11h2M8 15h2M14 15h2M8 19h2M14 19h2"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  whatsapp: '<path d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.4-1.6-1-2-2l1-1-1-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  finger: '<path d="M12 11v3a8 8 0 0 1-1.5 4.6"/><path d="M8.5 8.5A4 4 0 0 1 16 11v2.5a12 12 0 0 1-.8 4.3"/><path d="M5.6 6.4A8 8 0 0 1 20 11v1.5"/><path d="M8 11v2a6 6 0 0 1-1.6 4.1"/><path d="M4 13.5V11c0-1 .2-2 .5-2.8"/>',
  del: '<path d="M21 4H8l-6 8 6 8h13a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z"/><path d="M17 9l-5 6M12 9l5 6"/>',
  backup: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  restore: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>',
};
export const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export function pageHeader(title, subtitle = '', action = '') {
  return `
    <header class="page-head">
      <button class="icon-btn" data-back aria-label="Back">${icon('back')}</button>
      <div class="page-head-text"><h1>${esc(title)}</h1>${subtitle ? `<small>${esc(subtitle)}</small>` : ''}</div>
      ${action}
    </header>`;
}

/* ---------- toast ---------- */
let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- confirm dialog ---------- */
export function confirmBox({ title, text, ok = 'OK', danger = false }) {
  const dlg = document.getElementById('confirm');
  dlg.innerHTML = `
    <h2 class="sheet-title">${esc(title)}</h2>
    <p class="confirm-text">${esc(text)}</p>
    <div class="row-2">
      <button class="btn btn-ghost" value="no">Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${esc(ok)}</button>
    </div>`;
  return new Promise((resolve) => {
    dlg.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) { dlg.close(); resolve(b.value === 'yes'); }
      else if (e.target === dlg) { dlg.close(); resolve(false); }
    };
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

/* ---------- phone helpers ---------- */
export function waLink(phone, text = '') {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;            // Indian number without country code
  return `https://wa.me/${d}${text ? '?text=' + encodeURIComponent(text) : ''}`;
}

export function priceLine(item) {
  const p = item.prices || {};
  if (item.billing === 'sqft' || item.billing === 'piece') {
    const unit = item.billing === 'sqft' ? '/ sq ft' : '/ piece';
    return `${inr(p.prayagraj)} ${unit}`;
  }
  const parts = [];
  if (p.prayagraj) parts.push(inr(p.prayagraj));
  if (p.india) parts.push(inr(p.india));
  if (p.intl) parts.push(usd(p.intl));
  return parts.join(' · ') + (item.billing === 'monthly' ? ' /mo' : '');
}
