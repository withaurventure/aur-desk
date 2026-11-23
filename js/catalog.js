// AUR Desk — the rate card as a catalogue: category → sub-category → service.
// One renderer for Settings, the Calculator, the quotation picker and client onboarding,
// so every screen shows the same services the moment a price changes.
import { esc, icon, unitSuffix } from './ui.js';
import { money, MARKET_PRICE_KEY, currencyFor } from './docs.js';

export const byOrder = (a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || a.name.localeCompare(b.name);

/** [{ group, subs: [{ sub, items }] }] in rate-card order */
export function catalogTree(rates, company, filter = () => true) {
  const out = [];
  for (const r of rates.filter((x) => x.company === company && filter(x)).sort(byOrder)) {
    let g = out.find((x) => x.group === (r.group || 'Other'));
    if (!g) out.push((g = { group: r.group || 'Other', subs: [] }));
    let s = g.subs.find((x) => x.sub === (r.sub || ''));
    if (!s) g.subs.push((s = { sub: r.sub || '', items: [] }));
    s.items.push(r);
  }
  return out;
}

export const priceFor = (r, market) => {
  const p = r.prices ? r.prices[MARKET_PRICE_KEY[market]] : null;
  return p === '' || p == null ? null : Number(p);
};
export const priceText = (r, market) => {
  const p = priceFor(r, market);
  return p == null ? 'Not offered here' : money(p, currencyFor(market)) + unitSuffix(r);
};

const matches = (r, q) => !q || [r.group, r.sub, r.name, r.includes].join(' ').toLowerCase().includes(q);

/**
 * mode 'select': each service has a − n + stepper; picked ones turn green.
 * mode 'edit':   each service opens its edit page.
 * picked: { rateId: count }
 */
export function catalogHtml({ rates, company, market = 'prayagraj', mode = 'select', picked = {}, open = new Set(), query = '', filter, empty = '' }) {
  const q = query.trim().toLowerCase();
  const tree = catalogTree(rates, company, (r) => (!filter || filter(r)) && matches(r, q));
  if (!tree.length) return `<div class="empty">${q ? 'No service matches that search.' : empty}</div>`;
  return tree.map(({ group, subs }) => {
    const all = subs.flatMap((s) => s.items);
    const nPicked = all.filter((r) => picked[r.id]).length;
    const isOpen = q || open.has(group);
    return `
    <details class="cat ${nPicked ? 'has-picked' : ''}" data-cat="${esc(group)}" ${isOpen ? 'open' : ''}>
      <summary>
        <span class="cat-name"><strong>${esc(group)}</strong>
          <small>${all.length} ${all.length === 1 ? 'service' : 'services'}${subs.length > 1 ? ` · ${subs.length} types` : ''}</small></span>
        ${nPicked ? `<span class="cat-badge">${icon('check')}${nPicked}</span>` : ''}
        ${icon('chevron', 'cat-chev')}
      </summary>
      ${subs.map(({ sub, items }) => `
        ${sub ? `<h4 class="sub-head">${esc(sub)}</h4>` : ''}
        <div class="svc-list">${items.map((r) => svcHtml(r, { market, mode, n: picked[r.id] || 0 })).join('')}</div>`).join('')}
    </details>`;
  }).join('');
}

function svcHtml(r, { market, mode, n }) {
  const p = priceFor(r, market);
  const ok = p != null;
  const main = `
      <span class="svc-text">
        <strong>${esc(r.name)}</strong>
        ${r.includes ? `<small class="svc-desc">${esc(r.includes)}</small>` : ''}
        <span class="svc-price ${ok ? '' : 'na'}">${esc(priceText(r, market))}${r.hours && r.billing === 'monthly' ? `<em>· ${r.hours} h/mo</em>` : ''}</span>
      </span>`;
  if (mode === 'edit') {
    return `<button type="button" class="svc" data-edit-rate="${r.id}">${main}${icon('right', 'svc-arrow')}</button>`;
  }
  return `
    <div class="svc ${n ? 'picked' : ''} ${ok ? '' : 'off'}" data-svc="${r.id}">
      ${n ? `<span class="svc-tick" aria-hidden="true">${icon('check')}</span>` : ''}
      ${main}
      ${ok ? `
      <span class="stepper" role="group" aria-label="${esc(r.name)} quantity">
        <button type="button" data-step="-1" aria-label="Remove one" ${n ? '' : 'disabled'}>${icon('minus')}</button>
        <output>${r.billing === 'thousand' && n ? n.toLocaleString('en-IN') : n}</output>
        <button type="button" data-step="1" aria-label="Add one">${icon('plus')}</button>
      </span>` : ''}
    </div>`;
}

/** how much one tap on + or − changes a count */
export const stepFor = (r, current, dir) => {
  if (r.billing !== 'thousand') return Math.max(0, current + dir);
  if (dir > 0) return current ? current + 500 : 1000;
  return current <= 1000 ? 0 : current - 500;
};

/** search box + catalogue, with state kept in `st` ({ query, open:Set }) */
export function catalogBlock(id, html, st, placeholder = 'Search services') {
  return `
    <label class="search cat-search">${icon('search')}<span class="sr-only">Search</span>
      <input type="search" id="${id}-q" value="${esc(st.query || '')}" placeholder="${esc(placeholder)}" autocomplete="off"></label>
    <div class="catalog" id="${id}">${html}</div>`;
}

/** wire up open/close memory, search, steppers and edit taps. redraw() re-renders the catalogue only. */
export function bindCatalog(root, id, st, { redraw, onStep, onEdit }) {
  const box = root.querySelector('#' + id);
  const q = root.querySelector(`#${id}-q`);
  if (q) q.oninput = () => { st.query = q.value; redraw(); };
  box.addEventListener('toggle', (e) => {
    const d = e.target.closest && e.target.closest('details[data-cat]');
    if (!d || (st.query || '').trim()) return;
    if (d.open) st.open.add(d.dataset.cat); else st.open.delete(d.dataset.cat);
  }, true);
  box.onclick = (e) => {
    const step = e.target.closest('[data-step]');
    if (step && onStep) { onStep(step.closest('[data-svc]').dataset.svc, Number(step.dataset.step)); return; }
    const ed = e.target.closest('[data-edit-rate]');
    if (ed && onEdit) onEdit(ed.dataset.editRate);
  };
}

/**
 * Bottom tray: "3 selected · ₹27,000". Tap to see the list and remove items.
 * rows: [{ id, title, detail, amount }]
 */
export function trayHtml(rows, totalText, { open = false, action = '' } = {}) {
  if (!rows.length) return '';
  return `
    <div class="tray ${open ? 'open' : ''}" role="region" aria-label="Selected services">
      <div class="tray-list" ${open ? '' : 'hidden'}>
        ${rows.map((r) => `
          <div class="tray-row">
            <span class="tray-tick" aria-hidden="true">${icon('check')}</span>
            <span class="tray-text"><strong>${esc(r.title)}</strong><small>${esc(r.detail)}</small></span>
            <span class="tray-amt">${esc(r.amount)}</span>
            <button type="button" class="icon-btn icon-btn-sm" data-tray-remove="${esc(r.id)}" aria-label="Remove ${esc(r.title)}">${icon('close')}</button>
          </div>`).join('')}
      </div>
      <div class="tray-bar">
        <button type="button" class="tray-toggle" data-tray-toggle aria-expanded="${open}">
          <span class="tray-count">${icon('check')}${rows.length}</span>
          <span class="tray-sum"><strong>${esc(totalText)}</strong><small>${rows.length} selected · tap to ${open ? 'hide' : 'see'}</small></span>
          ${icon('chevron', 'tray-chev')}
        </button>
        ${action}
      </div>
    </div>`;
}

export function bindTray(root, { onToggle, onRemove }) {
  const t = root.querySelector('.tray');
  if (!t) return;
  t.onclick = (e) => {
    if (e.target.closest('[data-tray-toggle]')) onToggle();
    const rm = e.target.closest('[data-tray-remove]');
    if (rm) onRemove(rm.dataset.trayRemove);
  };
}
