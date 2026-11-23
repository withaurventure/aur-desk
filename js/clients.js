// AUR Desk — clients: list, onboarding form, client page.
import { db } from './db.js';
import { esc, uid, icon, pageHeader, toast, confirmBox, waLink, MARKETS, unitSuffix } from './ui.js';
import { docRow, bindDocRows } from './quote.js';
import { checklistFor } from './settings.js';
import { money, totals, currencyFor, lineFromRate, lineTitle, qtyText, lineAmount, fmtDate } from './docs.js';
import { catalogHtml, catalogBlock, bindCatalog, stepFor, priceFor, byOrder } from './catalog.js';

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
      checklist: existing ? existing.checklist : (await checklistFor(state.company)).map((label) => ({ label, done: false, at: null })),
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
const svcPick = { query: '', open: new Set() };

export function renderClient(ctx, view) {
  const x = ctx.cache.clients.find((c) => c.id === ctx.state.id);
  if (!x) { view.innerHTML = `${pageHeader('Client')}<div class="empty">This client no longer exists.</div>`; return; }
  const list = x.checklist || [];
  const done = list.filter((i) => i.done).length;
  const pct = list.length ? Math.round(done / list.length * 100) : 0;
  const next = list.findIndex((i) => !i.done);
  const docs = ctx.cache.docs.filter((d) => d.clientId === x.id).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const cur = currencyFor(x.market);
  const lines = serviceLines(ctx, x);
  const preview = lines.length ? totals({ currency: cur, lines, discountPct: 0, payment: { mode: 'full' } }) : null;
  const R = 26, C = 2 * Math.PI * R;

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
      <div><small>Client since</small><span>${esc(fmtDate((x.createdAt || '').slice(0, 10)) || '-')}</span></div>
    </section>

    <section class="section">
      <div class="onb card">
        <div class="onb-head">
          <svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="${R}" class="ring-bg"/>
            <circle cx="32" cy="32" r="${R}" class="ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/>
            <text x="32" y="37" text-anchor="middle">${pct}%</text>
          </svg>
          <div class="onb-title">
            <h2>Onboarding</h2>
            <small>${done === list.length && list.length ? 'Complete. Client is fully onboarded.' : `${done} of ${list.length} steps done`}</small>
          </div>
        </div>
        ${next >= 0 ? `
        <div class="onb-next">
          <span><small>Next step</small><strong>${esc(list[next].label)}</strong></span>
          <button class="btn btn-primary btn-sm" data-step-done="${next}">${icon('check')}Done</button>
        </div>` : ''}
        <ol class="timeline">
          ${list.map((i, n) => `
            <li class="tl ${i.done ? 'done' : n === next ? 'current' : ''}">
              <button type="button" class="tl-btn" data-toggle="${n}" aria-pressed="${!!i.done}">
                <span class="tl-dot" aria-hidden="true">${i.done ? icon('check') : n + 1}</span>
                <span class="tl-text"><strong>${esc(i.label)}</strong>
                  <small>${i.done ? 'Done' + (i.at ? ' · ' + esc(fmtDate(i.at.slice(0, 10))) : '') : n === next ? 'Up next' : 'To do'}</small></span>
              </button>
            </li>`).join('')}
        </ol>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Services</h2>${lines.length ? `<button class="btn btn-ghost btn-sm" data-services>${icon('edit')}Change</button>` : ''}</div>
      ${lines.length ? `
        <div class="card svc-chosen">
          ${lines.map((l) => `
            <div class="chosen-row">
              <span class="tray-tick" aria-hidden="true">${icon('check')}</span>
              <span class="tray-text"><strong>${esc(lineTitle(l))}</strong><small>${l.billing === 'sqft' ? 'Size goes in the quotation' : esc(qtyText(l))} · ${esc(money(l.price, cur))}${esc(unitSuffix(l))}</small></span>
              <span class="tray-amt">${l.billing === 'sqft' ? 'by size' : esc(money(lineAmount(l, cur), cur))}</span>
            </div>`).join('')}
          <div class="chosen-total"><span>${preview.recurring ? 'First month' : 'Total'}</span><strong>${esc(money(preview.total, cur))}</strong></div>
          ${preview.recurring ? `<div class="chosen-total sub"><span>Then each month</span><span>${esc(money(preview.recurring, cur))}</span></div>` : ''}
        </div>
        <button class="btn btn-primary btn-block" data-quote-svc>${icon('plus')}Make quotation from these</button>`
      : `<div class="empty">No services chosen yet.<br><button class="btn btn-primary btn-sm" data-services>${icon('plus')}Choose services</button></div>`}
    </section>

    ${x.notes ? `<section class="section"><div class="section-head"><h2>Notes</h2></div><div class="card notes">${esc(x.notes)}</div></section>` : ''}

    <section class="section">
      <div class="section-head"><h2>Quotations &amp; invoices</h2><button class="btn btn-ghost btn-sm" data-quote>${icon('plus')}Quotation</button></div>
      ${docs.length ? `<div class="list">${docs.map(docRow).join('')}</div>` : '<div class="empty">Nothing sent to this client yet.</div>'}
    </section>

    <button class="btn btn-danger-ghost btn-block" data-delete>Delete client</button>
  `;

  const save = async (msg) => {
    x.updatedAt = new Date().toISOString();
    await db.put('clients', x);
    await ctx.reload(false);
    ctx.render();
    if (msg) toast(msg);
  };
  const setStep = (n, on) => {
    x.checklist[n].done = on;
    x.checklist[n].at = on ? new Date().toISOString() : null;
    const all = x.checklist.every((i) => i.done);
    save(on && all ? `${x.name} is fully onboarded` : '');
  };
  view.querySelectorAll('[data-toggle]').forEach((b) => (b.onclick = () => setStep(Number(b.dataset.toggle), !x.checklist[Number(b.dataset.toggle)].done)));
  const nd = view.querySelector('[data-step-done]');
  if (nd) nd.onclick = () => setStep(Number(nd.dataset.stepDone), true);

  view.querySelector('[data-edit]').onclick = () => ctx.go('client-form', x.id);
  view.querySelector('[data-quote]').onclick = () => { ctx.state.preset = x.id; ctx.go('doc-edit'); };
  view.querySelectorAll('[data-services]').forEach((b) => (b.onclick = () => chooseServices(ctx, x, save)));
  const qs = view.querySelector('[data-quote-svc]');
  if (qs) qs.onclick = () => {
    if (ctx.state.company !== x.company) ctx.switchCompany(x.company);
    ctx.state.preset = x.id;
    ctx.state.presetDraft = { market: x.market, currency: cur, lines: serviceLines(ctx, x) };
    ctx.go('doc-edit');
  };
  bindDocRows(ctx, view);
  view.querySelector('[data-delete]').onclick = async () => {
    const ok = await confirmBox({ title: `Delete ${x.name}?`, text: 'This removes the client from this phone. It cannot be undone unless you restore a backup.', ok: 'Delete', danger: true });
    if (!ok) return;
    await db.del('clients', x.id);
    await ctx.reload();
    toast('Client deleted');
    ctx.back();
  };
}

/** the client's chosen services as quotation lines, at today's rate-card prices */
function serviceLines(ctx, x) {
  return (x.services || []).map((s) => {
    const r = ctx.cache.rates.find((q) => q.id === s.rateId);
    if (!r || priceFor(r, x.market) == null) return null;
    return { ...lineFromRate(r, x.market), qty: s.qty };
  }).filter(Boolean);
}

/** sheet with the full rate card; picked services turn green, a bar shows count and total */
function chooseServices(ctx, x, save) {
  const dlg = document.getElementById('picker');
  const picked = Object.fromEntries((x.services || []).map((s) => [s.rateId, s.qty]));
  const rates = ctx.cache.rates.filter((r) => r.company === x.company);
  const cur = currencyFor(x.market);

  dlg.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2 class="sheet-title">Services for ${esc(x.name)}</h2>
    <p class="hint">Prices for ${esc(MARKETS[x.market])}. Tap + to choose; chosen services turn green.</p>
    <div class="picker-list">${catalogBlock('cs-cat', '', svcPick)}</div>
    <div class="picker-foot" id="cs-foot"></div>`;

  const draw = () => {
    dlg.querySelector('#cs-cat').innerHTML = catalogHtml({
      rates, company: x.company, market: x.market, picked, open: svcPick.open, query: svcPick.query,
      empty: 'No rate card yet. Add services in Settings → Rate cards.',
    });
    const lines = rates.filter((r) => picked[r.id]).map((r) => ({ ...lineFromRate(r, x.market), qty: picked[r.id] }));
    const t = lines.length ? totals({ currency: cur, lines, discountPct: 0, payment: { mode: 'full' } }) : null;
    dlg.querySelector('#cs-foot').innerHTML = `
      <span class="pk-sum ${lines.length ? 'on' : ''}">${lines.length ? `${icon('check')}${lines.length} chosen · ${esc(money(t.total, cur))}` : 'Nothing chosen yet'}</span>
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-save>Save</button>`;
  };
  bindCatalog(dlg, 'cs-cat', svcPick, {
    redraw: draw,
    onStep: (id, dir) => {
      const r = rates.find((q) => q.id === id);
      const n = r.billing === 'sqft' ? Math.max(0, (picked[id] || 0) + dir) : stepFor(r, picked[id] || 0, dir);
      if (n) picked[id] = n; else delete picked[id];
      draw();
    },
  });
  dlg.onclick = (e) => {
    if (e.target.closest('[data-save]')) {
      x.services = rates.filter((r) => picked[r.id]).sort(byOrder).map((r) => ({ rateId: r.id, qty: picked[r.id] }));
      dlg.close();
      save(x.services.length ? `${x.services.length} services saved` : 'Services cleared');
    } else if (e.target === dlg || e.target.closest('[data-cancel]')) dlg.close();
  };
  draw();
  dlg.showModal();
}
