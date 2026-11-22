// AUR Desk — clients: list, onboarding form, client page.
import { db } from './db.js';
import { CHECKLISTS } from './companies.js';
import { esc, uid, icon, pageHeader, toast, confirmBox, waLink, MARKETS } from './ui.js';

const NICHES = ['Medical / clinic', 'Web3 / crypto', 'Retail / shop', 'Education', 'Restaurant / food', 'Real estate', 'Other'];

/* ---------- list ---------- */
export function renderClientList(ctx, view) {
  const { cache, state } = ctx;
  const c = ctx.company();
  const list = cache.clients
    .filter((x) => x.company === state.company)
    .sort((a, b) => a.name.localeCompare(b.name));

  view.innerHTML = `
    <div class="title-row">
      <h1 class="page-title">Clients</h1>
      <button class="btn btn-primary btn-sm" data-new>${icon('plus')}New client</button>
    </div>
    <p class="muted">${list.length} ${list.length === 1 ? 'client' : 'clients'} · ${esc(c.name)}</p>
    ${list.length ? `
      <label class="search">
        ${icon('search')}
        <span class="sr-only">Search clients</span>
        <input type="search" id="client-search" placeholder="Search by name, city or niche" autocomplete="off">
      </label>
      <div class="list" id="client-list">
        ${list.map((x) => `
          <button class="list-row" data-open="${x.id}" data-search="${esc((x.name + ' ' + (x.city || '') + ' ' + (x.niche || '') + ' ' + (x.contact || '')).toLowerCase())}">
            <span class="avatar" aria-hidden="true">${esc(initials(x.name))}</span>
            <span class="list-main">
              <strong>${esc(x.name)}</strong>
              <small>${esc([x.city, MARKETS[x.market]].filter(Boolean).join(' · '))}</small>
            </span>
            <span class="chip">${progress(x)}</span>
          </button>`).join('')}
      </div>
      <p class="empty" id="no-match" hidden>No client matches that search.</p>`
    : `<div class="empty">No clients yet for ${esc(c.name)}.<br>Tap <strong>New client</strong> to onboard your first one.</div>`}
  `;

  view.querySelector('[data-new]').onclick = () => ctx.go('client-form');
  view.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => ctx.go('client', b.dataset.open)));
  const search = view.querySelector('#client-search');
  if (search) {
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      view.querySelectorAll('#client-list [data-search]').forEach((row) => {
        const hit = !q || row.dataset.search.includes(q);
        row.hidden = !hit;
        if (hit) shown++;
      });
      view.querySelector('#no-match').hidden = shown > 0;
    };
  }
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
function progress(x) {
  const list = x.checklist || [];
  const done = list.filter((i) => i.done).length;
  return list.length && done === list.length ? 'Onboarded' : `${done}/${list.length}`;
}

/* ---------- onboarding form (new + edit) ---------- */
export function renderClientForm(ctx, view) {
  const { state, cache } = ctx;
  const existing = state.id ? cache.clients.find((x) => x.id === state.id) : null;
  const x = existing || { market: 'prayagraj', prefers: 'whatsapp', country: 'India' };

  const seg = (name, options, value) => `
    <div class="seg" role="radiogroup">
      ${Object.entries(options).map(([v, label]) => `
        <input type="radio" name="${name}" id="${name}-${v}" value="${v}" ${v === value ? 'checked' : ''}>
        <label for="${name}-${v}">${esc(label)}</label>`).join('')}
    </div>`;

  view.innerHTML = `
    ${pageHeader(existing ? 'Edit client' : 'Onboard a client', ctx.company().name)}
    <form id="client-form" class="form" novalidate>
      <div class="field">
        <label for="f-name">Business or client name *</label>
        <input id="f-name" name="name" required value="${esc(x.name)}" autocomplete="organization" placeholder="e.g. Sharma Dental Clinic">
      </div>
      <div class="field">
        <label for="f-contact">Contact person</label>
        <input id="f-contact" name="contact" value="${esc(x.contact)}" autocomplete="name" placeholder="e.g. Dr. Neha Sharma">
      </div>
      <div class="field">
        <label for="f-phone">WhatsApp / phone</label>
        <input id="f-phone" name="phone" type="tel" inputmode="tel" value="${esc(x.phone)}" placeholder="+91 98765 43210">
      </div>
      <div class="field">
        <label for="f-email">Email</label>
        <input id="f-email" name="email" type="email" inputmode="email" value="${esc(x.email)}" placeholder="name@example.com">
      </div>
      <fieldset class="field">
        <legend>Send documents by</legend>
        ${seg('prefers', { whatsapp: 'WhatsApp', email: 'Email' }, x.prefers)}
      </fieldset>
      <fieldset class="field">
        <legend>Market (sets which prices apply)</legend>
        ${seg('market', MARKETS, x.market)}
      </fieldset>
      <div class="row-2">
        <div class="field">
          <label for="f-city">City</label>
          <input id="f-city" name="city" value="${esc(x.city)}" autocomplete="address-level2">
        </div>
        <div class="field">
          <label for="f-country">Country</label>
          <input id="f-country" name="country" value="${esc(x.country)}" autocomplete="country-name">
        </div>
      </div>
      <div class="field">
        <label for="f-niche">Industry</label>
        <select id="f-niche" name="niche">
          <option value="">Choose…</option>
          ${NICHES.map((n) => `<option ${n === x.niche ? 'selected' : ''}>${esc(n)}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="f-notes">Notes</label>
        <textarea id="f-notes" name="notes" rows="3" placeholder="Goals, platforms, anything from the first call">${esc(x.notes)}</textarea>
      </div>
      <p class="form-error" id="form-error" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">${existing ? 'Save changes' : 'Save client'}</button>
    </form>`;

  view.querySelector('#client-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const val = (k) => String(f.get(k) || '').trim();
    const err = view.querySelector('#form-error');
    if (!val('name')) { err.textContent = 'Add the business or client name.'; view.querySelector('#f-name').focus(); return; }
    if (val('prefers') === 'whatsapp' && !val('phone')) { err.textContent = 'Add a WhatsApp number, or choose Email.'; view.querySelector('#f-phone').focus(); return; }
    if (val('prefers') === 'email' && !val('email')) { err.textContent = 'Add an email address, or choose WhatsApp.'; view.querySelector('#f-email').focus(); return; }

    const record = {
      ...(existing || {}),
      id: existing ? existing.id : uid(),
      company: existing ? existing.company : state.company,
      name: val('name'), contact: val('contact'), phone: val('phone'), email: val('email'),
      prefers: val('prefers'), market: val('market'), city: val('city'), country: val('country'),
      niche: val('niche'), notes: val('notes'),
      checklist: existing ? existing.checklist : (CHECKLISTS[state.company] || []).map((label) => ({ label, done: false })),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.put('clients', record);
    await ctx.reload();
    toast(existing ? 'Client updated' : 'Client saved');
    if (existing) ctx.back();
    else ctx.replace('client', record.id);
  };
}

/* ---------- client page ---------- */
export function renderClient(ctx, view) {
  const x = ctx.cache.clients.find((c) => c.id === ctx.state.id);
  if (!x) { view.innerHTML = `${pageHeader('Client')}<div class="empty">This client no longer exists.</div>`; return; }
  const list = x.checklist || [];
  const done = list.filter((i) => i.done).length;

  view.innerHTML = `
    ${pageHeader(x.name, [x.contact, x.city].filter(Boolean).join(' · '),
      `<button class="icon-btn" data-edit aria-label="Edit client">${icon('edit')}</button>`)}

    <div class="contact-row">
      ${x.phone ? `<a class="contact-btn" href="${waLink(x.phone)}" target="_blank" rel="noopener">${icon('whatsapp')}WhatsApp</a>` : ''}
      ${x.phone ? `<a class="contact-btn" href="tel:${esc(x.phone.replace(/[^\d+]/g, ''))}">${icon('phone')}Call</a>` : ''}
      ${x.email ? `<a class="contact-btn" href="mailto:${esc(x.email)}">${icon('mail')}Email</a>` : ''}
    </div>

    <section class="card info">
      <div><small>Market</small><span>${esc(MARKETS[x.market] || '-')}</span></div>
      <div><small>Documents by</small><span>${x.prefers === 'email' ? 'Email' : 'WhatsApp'}</span></div>
      <div><small>Industry</small><span>${esc(x.niche || '-')}</span></div>
      <div><small>Country</small><span>${esc(x.country || '-')}</span></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Onboarding</h2><span class="muted">${done} of ${list.length} done</span></div>
      <div class="card checklist">
        ${list.map((i, n) => `
          <label class="check-row">
            <input type="checkbox" data-check="${n}" ${i.done ? 'checked' : ''}>
            <span>${esc(i.label)}</span>
          </label>`).join('')}
      </div>
    </section>

    ${x.notes ? `<section class="section"><div class="section-head"><h2>Notes</h2></div><div class="card notes">${esc(x.notes)}</div></section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Quotations &amp; invoices</h2></div>
      <div class="empty">Quotations for this client arrive in step 3.</div>
    </section>

    <button class="btn btn-danger-ghost btn-block" data-delete>Delete client</button>
  `;

  view.querySelector('[data-edit]').onclick = () => ctx.go('client-form', x.id);
  view.querySelectorAll('[data-check]').forEach((box) => {
    box.onchange = async () => {
      x.checklist[Number(box.dataset.check)].done = box.checked;
      x.updatedAt = new Date().toISOString();
      await db.put('clients', x);
      await ctx.reload(false);
      const d = x.checklist.filter((i) => i.done).length;
      view.querySelector('.section-head .muted').textContent = `${d} of ${x.checklist.length} done`;
      if (d === x.checklist.length) toast(`${x.name} is fully onboarded`);
    };
  });
  view.querySelector('[data-delete]').onclick = async () => {
    const ok = await confirmBox({ title: `Delete ${x.name}?`, text: 'This removes the client from this phone. It cannot be undone unless you restore a backup.', ok: 'Delete', danger: true });
    if (!ok) return;
    await db.del('clients', x.id);
    await ctx.reload();
    toast('Client deleted');
    ctx.back();
  };
}
