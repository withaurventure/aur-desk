// AUR Desk — settings: company details, rate card, security, backup.
import { db } from './db.js';
import { COMPANIES, BRAND_ORDER, CHECKLISTS } from './companies.js';
import { GROUP } from './finance.js';
import { catalogHtml, catalogBlock, bindCatalog } from './catalog.js';
import { esc, uid, icon, pageHeader, toast, confirmBox, BILLING, UNITS } from './ui.js';
import {
  status as backupStatus, setPassword, setPrefs, connect, disconnect, backupToDrive, FREQS, explain,
  listDriveBackups, downloadDriveBackup, decryptFile, restorePayload, summary, encryptedFileForPhone, warmUp,
} from './backup.js';


/* ---------- main settings page ---------- */
export async function renderSettings(ctx, view) {
  const bk = await backupStatus();
  const count = (id) => ctx.cache.rates.filter((r) => r.company === id).length;
  const g = ctx.profile(GROUP);

  view.innerHTML = `
    <h1 class="page-title">Settings</h1>

    <section class="section">
      <div class="section-head"><h2>Companies</h2></div>
      <div class="org card">
        <button class="org-parent" data-go="group">
          <img class="row-logo" src="logos/aur-ventures.jpg" alt="">
          <span class="list-main"><strong>${esc(g.displayName || 'AUR Ventures')}</strong><small>Parent company · legal details, GSTIN</small></span>
          ${icon('right', 'row-arrow')}
        </button>
        <div class="org-brands">
          ${BRAND_ORDER.map((id) => {
            const c = COMPANIES[id];
            const p = ctx.profile(id);
            const missing = [!p.upi && 'UPI', !p.email && 'email'].filter(Boolean);
            return `
            <button class="org-brand" data-brand="${id}">
              <img class="row-logo" src="${c.logo}" alt="">
              <span class="list-main"><strong>${esc(c.name)}</strong>
                <small>${count(id)} services${missing.length ? ' · missing ' + esc(missing.join(', ')) : ''}</small></span>
              ${ctx.state.company === id ? '<span class="chip chip-on">In use</span>' : ''}
              ${icon('right', 'row-arrow')}
            </button>`;
          }).join('')}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Rate cards</h2></div>
      <button class="list-row folder-row" data-rates>
        <span class="row-icon" aria-hidden="true">${icon('folder')}</span>
        <span class="list-main"><strong>Rate cards</strong><small>${BRAND_ORDER.map((id) => `${esc(COMPANIES[id].short)} ${count(id)}`).join(' · ')} services · also used by the Calculator</small></span>
        ${icon('right', 'row-arrow')}
      </button>
    </section>

    <section class="section">
      <div class="section-head"><h2>Privacy &amp; Security</h2></div>
      <button class="list-row" data-go="security">
        <span class="row-icon" aria-hidden="true">${icon('shield')}</span>
        <span class="list-main"><strong>Privacy &amp; Security</strong><small>App lock, fingerprint, auto-lock, backup password</small></span>
        ${icon('right', 'row-arrow')}
      </button>
    </section>

    <section class="section" id="backup-section">
      <div class="section-head"><h2>Backup to Google Drive</h2></div>
      ${backupCard(bk)}
    </section>

    <section class="section">
      <div class="section-head"><h2>You</h2></div>
      <div class="field">
        <label for="owner-name">Your name (shown on Home)</label>
        <input id="owner-name" value="${esc(ctx.cache.owner)}" autocomplete="given-name">
      </div>
    </section>

    <button class="btn btn-ghost btn-block" data-update>Check for updates</button>
    <p class="version">AUR Desk · step 9 · data stays on this phone</p>
  `;

  view.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => ctx.go(b.dataset.go)));
  view.querySelectorAll('[data-brand]').forEach((b) => (b.onclick = () => ctx.go('brand', b.dataset.brand)));
  view.querySelector('[data-rates]').onclick = () => ctx.go('rates', ctx.state.company === 'printing' ? 'printing' : 'studio');
  bindBackup(ctx, view, bk);

  view.querySelector('[data-update]').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
      toast('Up to date. Reloading…');
      setTimeout(() => location.reload(), 600);
    } catch { toast('Could not check. Are you online?'); btn.disabled = false; btn.textContent = 'Check for updates'; }
  };
  const owner = view.querySelector('#owner-name');
  owner.onchange = async () => {
    const v = owner.value.trim() || 'Shashank';
    await db.setKV('owner', v);
    ctx.cache.owner = v;
    toast('Name saved');
  };
}

function groupBy(list, key) {
  return list.reduce((acc, x) => ((acc[x[key] || 'Other'] ||= []).push(x), acc), {});
}

/* ---------- one brand: everything about it in one place ---------- */
export async function renderBrand(ctx, view) {
  const id = BRAND_ORDER.includes(ctx.state.id) ? ctx.state.id : 'studio';
  const c = COMPANIES[id];
  const p = ctx.profile(id);
  const active = ctx.state.company === id;
  const clients = ctx.cache.clients.filter((x) => x.company === id);
  const onboarded = clients.filter((x) => (x.checklist || []).length && x.checklist.every((i) => i.done)).length;
  const services = ctx.cache.rates.filter((r) => r.company === id);
  const cats = new Set(services.map((r) => r.group)).size;
  const steps = await checklistFor(id);
  const missing = [!p.upi && 'UPI ID', !p.email && 'email'].filter(Boolean);

  view.innerHTML = `
    ${pageHeader(c.name, 'Brand of AUR Ventures')}
    <section class="brand-hero">
      <img src="${c.logo}" alt="">
      <div><strong>${esc(p.displayName || c.name)}</strong><small>${esc(c.tagline || '')}</small></div>
    </section>
    ${active
      ? `<p class="in-use">${icon('check')}You're working in ${esc(c.short)} now. New clients and quotations go here.</p>`
      : `<button class="btn btn-primary btn-block" data-use>${icon('swap')}Work in ${esc(c.name)}</button>`}

    <section class="stat-row">
      <div class="card stat"><strong>${clients.length}</strong><small>clients</small></div>
      <div class="card stat"><strong>${onboarded}</strong><small>onboarded</small></div>
      <div class="card stat"><strong>${services.length}</strong><small>services in ${cats} groups</small></div>
    </section>

    <section class="section">
      <div class="list">
        <button class="list-row" data-profile>
          <span class="row-icon" aria-hidden="true">${icon('card')}</span>
          <span class="list-main"><strong>Company details</strong><small>${missing.length ? 'Missing: ' + esc(missing.join(', ')) : 'Contact, payment and quotation defaults'}</small></span>
          ${icon('right', 'row-arrow')}
        </button>
        <button class="list-row" data-rates>
          <span class="row-icon" aria-hidden="true">${icon('folder')}</span>
          <span class="list-main"><strong>Rate card</strong><small>${services.length} services · names, prices and what's included</small></span>
          ${icon('right', 'row-arrow')}
        </button>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Onboarding steps</h2><span class="muted">for new clients</span></div>
      <div class="card">
        <ol class="step-preview">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        <details class="step-edit">
          <summary>${icon('edit')}Edit steps</summary>
          <div class="field">
            <label for="steps-text">One step per line, in order</label>
            <textarea id="steps-text" rows="6">${esc(steps.join('\n'))}</textarea>
          </div>
          <div class="row-2">
            <button class="btn btn-ghost" data-steps-reset>Use defaults</button>
            <button class="btn btn-primary" data-steps-save>Save steps</button>
          </div>
          <p class="hint">Applies to clients you add from now on. Existing clients keep their steps.</p>
        </details>
      </div>
    </section>`;

  const use = view.querySelector('[data-use]');
  if (use) use.onclick = () => { ctx.switchCompany(id); toast(`Now working in ${c.name}`); ctx.render(); };
  view.querySelector('[data-profile]').onclick = () => ctx.go('profile', id);
  view.querySelector('[data-rates]').onclick = () => ctx.go('rates', id);
  const saveSteps = async (list) => {
    const all = (await db.getKV('checklists')) || {};
    if (list) all[id] = list; else delete all[id];
    await db.setKV('checklists', all);
    toast('Onboarding steps saved');
    ctx.render();
  };
  view.querySelector('[data-steps-save]').onclick = () => {
    const list = view.querySelector('#steps-text').value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!list.length) { toast('Add at least one step'); return; }
    saveSteps(list);
  };
  view.querySelector('[data-steps-reset]').onclick = () => saveSteps(null);
}

export async function checklistFor(company) {
  const all = (await db.getKV('checklists')) || {};
  return all[company] && all[company].length ? all[company] : (CHECKLISTS[company] || []);
}

/* ---------- Rate cards folder: both brands, category → type → service ---------- */
const rateView = { query: '', open: new Set() };
export function renderRates(ctx, view) {
  const id = BRAND_ORDER.includes(ctx.state.id) ? ctx.state.id : 'studio';
  const n = ctx.cache.rates.filter((r) => r.company === id).length;

  view.innerHTML = `
    ${pageHeader('Rate cards', `${COMPANIES[id].name} · ${n} services`)}
    <div class="seg" role="radiogroup" aria-label="Company">
      ${BRAND_ORDER.map((b) => `<input type="radio" name="rco" id="rco-${b}" value="${b}" ${b === id ? 'checked' : ''}><label for="rco-${b}">${esc(COMPANIES[b].name)}</label>`).join('')}
    </div>
    ${catalogBlock('rc-cat', '', rateView, 'Search services, e.g. Instagram')}
    <div class="row-2">
      <button class="btn btn-ghost" data-add>${icon('plus')}Add service</button>
      <label class="btn btn-ghost file-btn">${icon('restore')}Import file<input type="file" id="import-rates" accept=".txt,.json,application/json,text/plain"></label>
    </div>
    <p class="hint">Prices stay on this phone. The Calculator and quotations use them straight away.</p>`;

  const draw = () => {
    view.querySelector('#rc-cat').innerHTML = catalogHtml({
      rates: ctx.cache.rates, company: id, mode: 'edit', open: rateView.open, query: rateView.query,
      empty: `No services yet for ${esc(COMPANIES[id].name)}. Add them one by one, or import a rate card file.`,
    });
  };
  bindCatalog(view, 'rc-cat', rateView, { redraw: draw, onEdit: (rid) => ctx.go('rate', rid) });
  view.querySelectorAll('input[name=rco]').forEach((r) => (r.onchange = () => { rateView.query = ''; ctx.replace('rates', r.value); }));
  view.querySelector('[data-add]').onclick = () => ctx.go('rate', 'new:' + id);
  view.querySelector('#import-rates').onchange = (e) => importRates(ctx, e.target);
  draw();
}

/* ---------- company details ---------- */
export function renderProfile(ctx, view) {
  const id = BRAND_ORDER.includes(ctx.state.id) ? ctx.state.id : ctx.state.company;
  const c = COMPANIES[id];
  const p = ctx.profile(id);
  const field = (id, label, value, type = 'text', hint = '', extra = '') => `
    <div class="field">
      <label for="p-${id}">${esc(label)}</label>
      <input id="p-${id}" name="${id}" type="${type}" value="${esc(value)}" ${extra}>
      ${hint ? `<small class="hint">${esc(hint)}</small>` : ''}
    </div>`;

  view.innerHTML = `
    ${pageHeader('Company details', c.name)}
    <form class="form" id="profile-form">
      <h2 class="form-section">Shown on documents</h2>
      ${field('displayName', 'Company name', p.displayName)}
      ${field('email', 'Email', p.email, 'email', c.id === 'printing' ? 'Add this once the Printing Studio email exists.' : '', 'inputmode="email"')}
      ${field('whatsapp', 'WhatsApp', p.whatsapp, 'tel', '', 'inputmode="tel"')}
      <div class="field">
        <label for="p-address">Address</label>
        <textarea id="p-address" name="address" rows="2" placeholder="City is enough for now">${esc(p.address)}</textarea>
      </div>

      <h2 class="form-section">Getting paid</h2>
      <p class="hint">Only you fill these in. They are saved on this phone and never go into the app's code.</p>
      ${field('upi', 'UPI ID', p.upi, 'text', 'Used for the payment QR on invoices, for example name@bank.', 'autocomplete="off" autocapitalize="off" spellcheck="false"')}
      ${field('intlLink', 'International payment link', p.intlLink, 'url', 'PayPal.me or Wise link for clients abroad.', 'inputmode="url" autocapitalize="off"')}

      <h2 class="form-section">Quotation defaults</h2>
      <p class="hint">New quotations start with these. You can change them on each quotation.</p>
      <div class="row-2">
        <div class="field">
          <label for="p-validityDays">Valid for (days)</label>
          <input id="p-validityDays" name="validityDays" type="number" inputmode="numeric" min="1" value="${esc(p.validityDays)}">
        </div>
        <div class="field">
          <label for="p-balanceDays">Balance due (days)</label>
          <input id="p-balanceDays" name="balanceDays" type="number" inputmode="numeric" min="1" value="${esc(p.balanceDays)}">
        </div>
      </div>
      <div class="field">
        <label for="p-pay">Payment</label>
        <select id="p-pay" name="pay">
          ${[['50', '50% advance'], ['60', '60% advance'], ['full', 'Full payment']].map(([v, l]) => `<option value="${v}" ${(p.payMode === 'full' ? 'full' : String(p.payPct)) === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label for="p-terms">Standard terms (one per line)</label>
        <textarea id="p-terms" name="terms" rows="5">${esc(p.terms)}</textarea>
      </div>

      <h2 class="form-section">Tax</h2>
      ${field('gstin', 'GSTIN for this brand only', (ctx.cache.profiles[id] || {}).gstin || '', 'text', 'Usually leave empty: both brands use the GSTIN in Settings → Group (AUR Ventures) once you register.', 'autocapitalize="characters"')}

      <button class="btn btn-primary btn-block" type="submit">Save details</button>
    </form>`;

  view.querySelector('#profile-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const next = {};
    for (const [k, v] of f.entries()) next[k] = String(v).trim();
    next.validityDays = Math.max(1, Number(next.validityDays) || 15);
    next.balanceDays = Math.max(1, Number(next.balanceDays) || 7);
    next.payMode = next.pay === 'full' ? 'full' : 'advance';
    next.payPct = next.pay === 'full' ? 50 : Number(next.pay);
    delete next.pay;
    if (next.upi && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(next.upi)) {
      toast('That UPI ID does not look right (name@bank)');
      view.querySelector('#p-upi').focus();
      return;
    }
    const profiles = { ...(ctx.cache.profiles || {}) };
    profiles[id] = next;
    await db.setKV('profiles', profiles);
    await ctx.reload(false);
    toast('Details saved');
    ctx.back();
  };
}

/* ---------- rate card item ---------- */
export function renderRateForm(ctx, view) {
  const sid = String(ctx.state.id || '');
  const existing = sid && !sid.startsWith('new:') ? ctx.cache.rates.find((r) => r.id === sid) : null;
  const company = existing ? existing.company : (sid.startsWith('new:') ? sid.slice(4) : ctx.state.company);
  const isPrint = company === 'printing';
  const r = existing || { billing: isPrint ? 'sqft' : 'monthly', prices: {} };
  const mine = ctx.cache.rates.filter((x) => x.company === company);
  const groups = [...new Set(mine.map((x) => x.group))];
  const subs = [...new Set(mine.map((x) => x.sub).filter(Boolean))];

  view.innerHTML = `
    ${pageHeader(existing ? 'Edit service' : 'Add service', COMPANIES[company].name)}
    <form class="form" id="rate-form">
      <div class="field">
        <label for="r-group">Category</label>
        <input id="r-group" name="group" list="group-list" required value="${esc(r.group)}" placeholder="${isPrint ? 'e.g. Flex & banners' : 'e.g. Social media management'}">
        <datalist id="group-list">${groups.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label for="r-sub">Type (optional)</label>
        <input id="r-sub" name="sub" list="sub-list" value="${esc(r.sub)}" placeholder="${isPrint ? 'e.g. Visiting cards — standard' : 'e.g. Instagram only'}">
        <datalist id="sub-list">${subs.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label for="r-name">Service name</label>
        <input id="r-name" name="name" required value="${esc(r.name)}" placeholder="${isPrint ? 'e.g. Star flex (380 GSM)' : 'e.g. Growth'}">
      </div>
      <div class="field">
        <label for="r-includes">What it includes (shown to clients and on quotations)</label>
        <textarea id="r-includes" name="includes" rows="3">${esc(r.includes)}</textarea>
      </div>
      <div class="row-2">
        <div class="field">
          <label for="r-billing">Charged</label>
          <select id="r-billing" name="billing">
            ${Object.entries(BILLING).map(([v, l]) => `<option value="${v}" ${v === r.billing ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="unit-field" ${r.billing === 'piece' ? '' : 'hidden'}>
          <label for="r-unit">Counted per</label>
          <select id="r-unit" name="unit">${UNITS.map((u) => `<option value="${u}" ${u === (r.unit || 'piece') ? 'selected' : ''}>${u}</option>`).join('')}</select>
        </div>
      </div>
      <div class="row-3">
        <div class="field"><label for="r-p1">Prayagraj ₹</label><input id="r-p1" name="prayagraj" type="number" inputmode="decimal" min="0" value="${r.prices.prayagraj ?? ''}"></div>
        <div class="field"><label for="r-p2">India ₹</label><input id="r-p2" name="india" type="number" inputmode="decimal" min="0" value="${r.prices.india ?? ''}"></div>
        <div class="field"><label for="r-p3">Abroad $</label><input id="r-p3" name="intl" type="number" inputmode="decimal" min="0" value="${r.prices.intl ?? ''}"></div>
      </div>
      <p class="hint">Leave a price empty if you don't offer this service in that market. "Per 1,000" prices are for 1,000 pieces.</p>
      ${isPrint ? '' : `
      <div class="field">
        <label for="r-hours">Your hours per month (for the Calculator)</label>
        <input id="r-hours" name="hours" type="number" inputmode="numeric" min="0" value="${r.hours ?? ''}">
      </div>`}
      <button class="btn btn-primary btn-block" type="submit">Save service</button>
      ${existing ? '<button class="btn btn-danger-ghost btn-block" type="button" data-delete>Delete this service</button>' : ''}
    </form>`;

  view.querySelector('#r-billing').onchange = (e) => { view.querySelector('#unit-field').hidden = e.target.value !== 'piece'; };
  const num = (v) => (v === '' || v == null ? null : Number(v));
  view.querySelector('#rate-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const val = (k) => String(f.get(k) || '').trim();
    if (!val('group') || !val('name')) { toast('Add the category and service name'); return; }
    await db.put('rates', {
      ...(existing || {}),
      id: existing ? existing.id : uid(),
      company,
      order: existing ? existing.order : Date.now(),
      group: val('group'), sub: val('sub'), name: val('name'), billing: val('billing'),
      unit: val('billing') === 'piece' ? val('unit') : '',
      prices: { prayagraj: num(val('prayagraj')), india: num(val('india')), intl: num(val('intl')) },
      hours: num(val('hours')), includes: val('includes'),
    });
    await ctx.reload(false);
    toast('Service saved');
    ctx.back();
  };
  const del = view.querySelector('[data-delete]');
  if (del) del.onclick = async () => {
    if (!(await confirmBox({ title: 'Delete this service?', text: `${r.sub || r.group}: ${r.name}`, ok: 'Delete', danger: true }))) return;
    await db.del('rates', existing.id);
    await ctx.reload(false);
    ctx.back();
  };
}

/* ---------- import / backup / restore ---------- */
async function readFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return null;
  try { return JSON.parse(await file.text()); }
  catch { toast("That file isn't an AUR Desk file"); return null; }
}

async function importRates(ctx, input) {
  const data = await readFile(input);
  if (!data) return;
  if (data.app !== 'aur-desk' || data.kind !== 'rate-card' || !Array.isArray(data.items)) {
    toast("That file isn't an AUR Desk rate card"); return;
  }
  const items = data.items.filter((i) => i.id && i.company && COMPANIES[i.company]);
  const cos = [...new Set(items.map((i) => i.company))];
  const names = cos.map((c) => COMPANIES[c].name).join(' and ');
  const replace = data.mode === 'replace';
  const now = ctx.cache.rates.filter((r) => cos.includes(r.company)).length;
  const ok = await confirmBox({
    title: replace ? `Replace the ${names} rate card?` : 'Import rate card?',
    text: replace
      ? `The ${now} services there now are removed and ${items.length} services are added. Quotations already made keep their prices.`
      : `${items.length} services will be added. Services with the same ID are replaced; everything else stays.`,
    ok: replace ? 'Replace' : 'Import',
  });
  if (!ok) return;
  if (replace) for (const r of ctx.cache.rates.filter((x) => cos.includes(x.company))) await db.del('rates', r.id);
  for (const item of items) await db.put('rates', item);
  await ctx.reload();
  toast(`${items.length} services imported`);
}

/* =================== Backup to Google Drive =================== */
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function backupCard(bk) {
  const step = (n, done, title, sub, action) => `
    <div class="setup-step ${done ? 'done' : ''}">
      <span class="step-no" aria-hidden="true">${done ? icon('check') : n}</span>
      <span class="step-text"><strong>${title}</strong><small>${sub}</small></span>
      ${action}
    </div>`;

  if (!bk.ready) {
    return `
      <div class="card setup">
        <p class="hint">Three one-time steps. After that, AUR Desk backs up to Google Drive by itself, encrypted with your password.</p>
        ${step(1, bk.hasPassword, 'Backup password', bk.hasPassword ? 'Set. Backups are encrypted with it.' : 'Locks every backup so only you can open it.',
          `<button class="btn btn-ghost btn-sm" data-set-password>${bk.hasPassword ? 'Change' : 'Set'}</button>`)}
        ${step(2, !!bk.prefs.clientId, 'Google Client ID', bk.prefs.clientId ? esc(bk.prefs.clientId.slice(0, 18)) + '…' : 'From your Google Cloud setup. Paste it once.',
          `<button class="btn btn-ghost btn-sm" data-client-id>${bk.prefs.clientId ? 'Change' : 'Paste'}</button>`)}
        ${step(3, bk.connected, 'Connect Google Drive', bk.connected ? esc(bk.prefs.email) : 'Sign in with the AUR Ventures Google account.',
          `<button class="btn btn-primary btn-sm" data-connect ${bk.hasPassword && bk.prefs.clientId ? '' : 'disabled'}>Connect</button>`)}
      </div>
      ${restoreFileButton()}`;
  }

  const err = bk.error && (!bk.last || new Date(bk.error.at) > new Date(bk.last));
  return `
    <div class="card backup-status">
      <div class="bs-row">
        <span class="bs-icon ${err ? 'bad' : 'good'}" aria-hidden="true">${icon(err ? 'close' : 'check')}</span>
        <span class="step-text">
          <strong>${bk.last ? 'Last backup ' + esc(when(bk.last)) : 'No backup yet'}</strong>
          <small>${err ? esc(explain({ message: bk.error.message })) : 'To ' + esc(bk.prefs.email) + ' · encrypted · newest 10 kept'}</small>
        </span>
      </div>
      <button class="btn btn-primary btn-block" data-backup-now>${icon('backup')}Back up now</button>
      <div class="field">
        <label for="auto-freq">Auto-backup</label>
        <select id="auto-freq">${Object.entries(FREQS).map(([v, l]) => `<option value="${v}" ${v === bk.prefs.freq ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <small class="hint">Runs by itself while AUR Desk is open, only when something has changed. If Google needs you to sign in again, Home shows a one-tap "Back up now".</small>
      </div>
      <button class="btn btn-ghost btn-block" data-restore-drive>${icon('restore')}Restore from Google Drive</button>
      <details class="more">
        <summary>More backup options</summary>
        <div class="more-body">
          <button class="btn btn-ghost btn-block" data-phone-copy>${icon('backup')}Save an encrypted copy to this phone</button>
          ${restoreFileButton()}
          <button class="btn btn-ghost btn-block" data-client-id>Change Google Client ID</button>
          <button class="btn btn-danger-ghost btn-block" data-disconnect>Disconnect Google Drive</button>
        </div>
      </details>
    </div>`;
}
const restoreFileButton = () => `<label class="btn btn-ghost btn-block file-btn">${icon('restore')}Restore from a backup file<input type="file" id="restore-file" accept=".aurdesk,.txt,.json,application/json,text/plain,application/octet-stream"></label>`;

function bindBackup(ctx, view, bk) {
  const on = (sel, fn) => view.querySelectorAll(sel).forEach((b) => (b.onclick = fn));
  const busy = async (btn, label, fn) => {
    const old = btn.innerHTML; btn.disabled = true; btn.textContent = label;
    try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = old; }
  };
  warmUp();

  on('[data-set-password]', async () => { if (await changeBackupPassword(bk.hasPassword)) ctx.render(); });

  on('[data-client-id]', async () => {
    const id = await textDialog({
      title: 'Google Client ID',
      text: 'Paste the Client ID from Google Cloud. It ends in .apps.googleusercontent.com',
      value: bk.prefs.clientId, placeholder: '1234567890-abc….apps.googleusercontent.com',
    });
    if (id == null) return;
    const clean = id.trim();
    if (clean && !/\.apps\.googleusercontent\.com$/.test(clean)) { toast("That doesn't look like a Client ID"); return; }
    await setPrefs({ clientId: clean });
    warmUp();
    toast('Client ID saved');
    ctx.render();
  });

  on('[data-connect]', async (e) => busy(e.currentTarget, 'Opening Google…', async () => {
    try {
      const email = await connect();
      toast(`Connected to ${email}`);
      if (email && email.toLowerCase() !== 'withaurventure@gmail.com') toast(`Connected to ${email}. If you meant AUR Ventures, disconnect and sign in with withaurventure@gmail.com.`);
      await backupToDrive({ interactive: true }).catch(() => {});
      await ctx.reload();
    } catch (err) { toast(explain(err)); }
  }));

  on('[data-backup-now]', async (e) => busy(e.currentTarget, 'Backing up…', async () => {
    try { await backupToDrive({ interactive: true }); toast('Backed up to Google Drive'); }
    catch (err) { toast(explain(err)); }
    await ctx.reload();
  }));

  const freq = view.querySelector('#auto-freq');
  if (freq) freq.onchange = async () => { await setPrefs({ freq: freq.value }); toast('Auto-backup: ' + FREQS[freq.value]); };

  on('[data-restore-drive]', async (e) => {
    let files;
    await busy(e.currentTarget, 'Loading backups…', async () => {
      try { files = await listDriveBackups(); } catch (err) { toast(explain(err)); }
    });
    if (!files) return;
    if (!files.length) { toast('No backups in Google Drive yet'); return; }
    const id = await pickBackup(files);
    if (!id) return;
    let file;
    try { file = await downloadDriveBackup(id); } catch (err) { toast(explain(err)); return; }
    await restoreFlow(ctx, file);
  });

  on('[data-phone-copy]', async () => {
    try {
      const file = await encryptedFileForPhone();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Encrypted copy saved to Downloads');
    } catch (err) { toast(explain(err)); }
  });

  const fileIn = view.querySelector('#restore-file');
  if (fileIn) fileIn.onchange = async () => {
    const data = await readFile(fileIn);
    if (data) await restoreFlow(ctx, data);
  };

  on('[data-disconnect]', async () => {
    const ok = await confirmBox({ title: 'Disconnect Google Drive?', text: 'Auto-backup stops. Your backups stay in Google Drive, and nothing on this phone is deleted.', ok: 'Disconnect', danger: true });
    if (!ok) return;
    await disconnect();
    toast('Google Drive disconnected');
    ctx.render();
  });
}

async function restoreFlow(ctx, file) {
  if (!file || file.app !== 'aur-desk' || !['backup', 'backup-encrypted'].includes(file.kind)) { toast("That isn't an AUR Desk backup"); return; }
  let data = file;
  if (file.kind === 'backup-encrypted') {
    for (;;) {
      const pw = await passwordDialog({ title: 'Backup password', text: `Enter the password this backup was made with (${when(file.exportedAt)}).` });
      if (!pw) return;
      try { data = await decryptFile(file, pw); break; }
      catch (err) { toast(explain(err)); }
    }
  }
  const ok = await confirmBox({
    title: 'Replace everything with this backup?',
    text: `From ${when(data.exportedAt)}: ${summary(data)}. Everything currently in AUR Desk on this phone will be replaced. Your PIN stays the same.`,
    ok: 'Replace and restore', danger: true,
  });
  if (!ok) return;
  await restorePayload(data);
  await ctx.reload();
  toast('Backup restored');
}

// used here (backup setup) and in Privacy & Security
export async function changeBackupPassword(hasPassword) {
  const pw = await passwordDialog({
    title: hasPassword ? 'Change backup password' : 'Set a backup password',
    text: 'At least 8 characters. Write it down somewhere safe: without it, your backups cannot be opened, not even by me. Backups made before a change still need the old password.',
    confirm: true,
  });
  if (!pw) return false;
  await setPassword(pw);
  toast('Backup password saved');
  return true;
}

/* ---------- small dialogs ---------- */
function passwordDialog({ title, text, confirm = false }) {
  const dlg = document.getElementById('confirm');
  dlg.innerHTML = `
    <h2 class="sheet-title">${esc(title)}</h2>
    <p class="confirm-text">${esc(text)}</p>
    <form class="form" id="pw-form" method="dialog" novalidate>
      <div class="field"><label for="pw1">Password</label><input id="pw1" type="password" autocomplete="new-password" minlength="8" required></div>
      ${confirm ? '<div class="field"><label for="pw2">Type it again</label><input id="pw2" type="password" autocomplete="new-password" required></div>' : ''}
      <label class="check-row show-pw"><input type="checkbox" id="pw-show"><span>Show password</span></label>
      <p class="form-error" id="pw-err" role="alert"></p>
      <div class="row-2">
        <button class="btn btn-ghost" type="button" value="no">Cancel</button>
        <button class="btn btn-primary" type="submit">OK</button>
      </div>
    </form>`;
  return new Promise((resolve) => {
    const form = dlg.querySelector('#pw-form');
    const p1 = dlg.querySelector('#pw1'), p2 = dlg.querySelector('#pw2'), err = dlg.querySelector('#pw-err');
    dlg.querySelector('#pw-show').onchange = (e) => { [p1, p2].forEach((p) => p && (p.type = e.target.checked ? 'text' : 'password')); };
    dlg.onclick = (e) => {
      if (e.target.closest('button[value=no]') || e.target === dlg) { dlg.close(); resolve(null); }
    };
    dlg.oncancel = () => resolve(null);
    form.onsubmit = (e) => {
      e.preventDefault();
      if (confirm && p1.value.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
      if (!p1.value) { err.textContent = 'Enter the password.'; return; }
      if (confirm && p1.value !== p2.value) { err.textContent = "The two passwords don't match."; return; }
      dlg.close(); resolve(p1.value);
    };
    dlg.showModal();
    p1.focus();
  });
}

function textDialog({ title, text, value = '', placeholder = '' }) {
  const dlg = document.getElementById('confirm');
  dlg.innerHTML = `
    <h2 class="sheet-title">${esc(title)}</h2>
    <p class="confirm-text">${esc(text)}</p>
    <form class="form" id="txt-form" novalidate>
      <div class="field"><label for="txt1" class="sr-only">${esc(title)}</label>
        <textarea id="txt1" rows="3" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}">${esc(value)}</textarea></div>
      <div class="row-2">
        <button class="btn btn-ghost" type="button" value="no">Cancel</button>
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
    </form>`;
  return new Promise((resolve) => {
    dlg.onclick = (e) => { if (e.target.closest('button[value=no]') || e.target === dlg) { dlg.close(); resolve(null); } };
    dlg.oncancel = () => resolve(null);
    dlg.querySelector('#txt-form').onsubmit = (e) => { e.preventDefault(); dlg.close(); resolve(dlg.querySelector('#txt1').value); };
    dlg.showModal();
  });
}

function pickBackup(files) {
  const dlg = document.getElementById('picker');
  dlg.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2 class="sheet-title">Choose a backup</h2>
    <p class="hint">Newest first. Restoring replaces what's on this phone.</p>
    <div class="picker-list">
      ${files.map((f) => `
        <button class="picker-row" data-file="${f.id}">
          <span><strong>${esc(when(f.createdTime))}</strong><small>${esc((f.description || '').replace('AUR Desk encrypted backup · ', ''))}</small></span>
          <span>${Math.max(1, Math.round(Number(f.size || 0) / 1024))} KB</span>
        </button>`).join('')}
    </div>
    <button class="btn btn-ghost" data-close>Cancel</button>`;
  return new Promise((resolve) => {
    dlg.onclick = (e) => {
      const b = e.target.closest('[data-file]');
      if (b) { dlg.close(); resolve(b.dataset.file); return; }
      if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); resolve(null); }
    };
    dlg.oncancel = () => resolve(null);
    dlg.showModal();
  });
}

/* =================== Group: AUR Ventures, the parent =================== */
export function renderGroup(ctx, view) {
  const g = ctx.profile('ventures');
  view.innerHTML = `
    ${pageHeader('AUR Ventures', 'Parent company of AUR Studio and AUR Printing Studio')}
    <form class="form" id="group-form">
      <p class="hint">AUR Ventures runs both brands and carries the shared costs (tools, registration, hiring, the scheduling tool). It doesn't make quotations or invoices itself.</p>
      <div class="field"><label for="g-name">Company name</label><input id="g-name" name="displayName" value="${esc(g.displayName)}"></div>
      <div class="field"><label for="g-email">Email</label><input id="g-email" name="email" type="email" inputmode="email" value="${esc(g.email)}"></div>
      <div class="field"><label for="g-wa">WhatsApp</label><input id="g-wa" name="whatsapp" type="tel" inputmode="tel" value="${esc(g.whatsapp)}"></div>
      <div class="field"><label for="g-addr">Registered address</label><textarea id="g-addr" name="address" rows="2">${esc(g.address)}</textarea></div>
      <div class="field">
        <label for="g-gstin">GSTIN</label>
        <input id="g-gstin" name="gstin" value="${esc(g.gstin)}" autocapitalize="characters" placeholder="Add after registration">
        <small class="hint">Printed on AUR Studio and AUR Printing Studio documents, and turns on the "Add GST" switch for both.</small>
      </div>
      <label class="set-row card">
        <span><strong class="opt-title">"A brand of AUR Ventures" on documents</strong><small class="opt-sub">Adds e.g. "AUR Studio is a brand of AUR Ventures" in small print at the bottom of PDFs</small></span>
        <input type="checkbox" class="switch" name="brandLine" ${g.brandLine ? 'checked' : ''}>
      </label>
      <button class="btn btn-primary btn-block" type="submit">Save</button>
    </form>`;
  view.querySelector('#group-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const prev = ctx.cache.profiles.ventures || {};
    const next = { ...prev };
    for (const k of ['displayName', 'email', 'whatsapp', 'address', 'gstin']) next[k] = String(f.get(k) || '').trim();
    next.brandLine = f.get('brandLine') === 'on';
    await db.setKV('profiles', { ...(ctx.cache.profiles || {}), ventures: next });
    await ctx.reload(false);
    toast('Group details saved');
    ctx.back();
  };
}
