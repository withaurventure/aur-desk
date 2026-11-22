// AUR Desk — settings: company details, rate card, security, backup.
import { db } from './db.js';
import { COMPANIES } from './companies.js';
import { esc, uid, icon, pageHeader, toast, confirmBox, priceLine, BILLING } from './ui.js';
import { runLock, bioAvailable, bioEnabled, enableBio, disableBio } from './lock.js';

const BACKUP_KEYS = ['profiles', 'owner', 'counters'];

/* ---------- main settings page ---------- */
export async function renderSettings(ctx, view) {
  const c = ctx.company();
  const p = ctx.profile();
  const rates = ctx.cache.rates.filter((r) => r.company === ctx.state.company)
    .sort((a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || a.name.localeCompare(b.name));
  const groups = groupBy(rates, 'group');
  const [bioOk, bioOn] = [await bioAvailable(), await bioEnabled()];
  const last = ctx.cache.lastBackup ? new Date(ctx.cache.lastBackup).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never';
  const missing = [!p.upi && 'UPI ID', !p.email && 'email'].filter(Boolean);

  view.innerHTML = `
    <h1 class="page-title">Settings</h1>

    <section class="section">
      <div class="section-head"><h2>${esc(c.name)}</h2><span class="muted">switch company on Home</span></div>
      <button class="list-row" data-go="profile">
        <img class="row-logo" src="${c.logo}" alt="">
        <span class="list-main"><strong>Company details</strong><small>${missing.length ? 'Missing: ' + esc(missing.join(', ')) : 'Contact and payment details complete'}</small></span>
        ${icon('right', 'row-arrow')}
      </button>
    </section>

    <section class="section">
      <div class="section-head"><h2>Rate card</h2><span class="muted">${rates.length} ${rates.length === 1 ? 'item' : 'items'}</span></div>
      ${rates.length ? Object.entries(groups).map(([g, items]) => `
        <div class="card rate-group">
          <h3>${esc(g)}</h3>
          ${items.map((r) => `
            <button class="rate-row" data-rate="${r.id}">
              <span><strong>${esc(r.name)}</strong><small>${esc(BILLING[r.billing] || '')}</small></span>
              <span class="rate-price">${esc(priceLine(r))}</span>
            </button>`).join('')}
        </div>`).join('') : `<div class="empty">No prices yet for ${esc(c.name)}. Add items one by one, or import a rate card file.</div>`}
      <div class="row-2">
        <button class="btn btn-ghost" data-go="rate">${icon('plus')}Add item</button>
        <label class="btn btn-ghost file-btn">${icon('restore')}Import file<input type="file" id="import-rates" accept=".txt,.json,application/json,text/plain"></label>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Security</h2></div>
      <div class="card settings-list">
        <button class="set-row" data-change-pin>${icon('lock')}<span>Change PIN</span>${icon('right', 'row-arrow')}</button>
        ${bioOk ? `
        <label class="set-row">
          ${icon('finger')}<span>Unlock with fingerprint</span>
          <input type="checkbox" class="switch" id="bio-toggle" ${bioOn ? 'checked' : ''}>
        </label>` : `<div class="set-row muted">${icon('finger')}<span>Fingerprint needs a screen lock on this phone</span></div>`}
        <button class="set-row" data-lock-now>${icon('lock')}<span>Lock now</span>${icon('right', 'row-arrow')}</button>
      </div>
      <p class="hint">The app locks itself when it has been in the background for 1 minute.</p>
    </section>

    <section class="section">
      <div class="section-head"><h2>Backup</h2><span class="muted">Last: ${esc(last)}</span></div>
      <div class="row-2">
        <button class="btn btn-primary" data-backup>${icon('backup')}Back up now</button>
        <label class="btn btn-ghost file-btn">${icon('restore')}Restore<input type="file" id="restore-file" accept=".txt,.json,application/json,text/plain"></label>
      </div>
      <p class="hint">Back up saves one file with all three companies' clients, quotations, invoices, money entries, prices and details. Save it to Google Drive. Your PIN is not included.</p>
    </section>

    <section class="section">
      <div class="section-head"><h2>You</h2></div>
      <div class="field">
        <label for="owner-name">Your name (shown on Home)</label>
        <input id="owner-name" value="${esc(ctx.cache.owner)}" autocomplete="given-name">
      </div>
    </section>

    <button class="btn btn-ghost btn-block" data-update>Check for updates</button>
    <p class="version">AUR Desk · step 5.1 · data stays on this phone</p>
  `;

  view.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => ctx.go(b.dataset.go)));
  view.querySelectorAll('[data-rate]').forEach((b) => (b.onclick = () => ctx.go('rate', b.dataset.rate)));

  view.querySelector('#import-rates').onchange = (e) => importRates(ctx, e.target);
  view.querySelector('#restore-file').onchange = (e) => restore(ctx, e.target);
  view.querySelector('[data-backup]').onclick = () => backup(ctx);

  view.querySelector('[data-change-pin]').onclick = async () => {
    await runLock('setup', { cancellable: true });
    ctx.render();
  };
  view.querySelector('[data-lock-now]').onclick = () => ctx.lockNow();
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
  const bio = view.querySelector('#bio-toggle');
  if (bio) {
    bio.onchange = async () => {
      if (bio.checked) {
        try { await enableBio(); toast('Fingerprint unlock is on'); }
        catch { bio.checked = false; toast('Fingerprint was not set up'); }
      } else { await disableBio(); toast('Fingerprint unlock is off'); }
    };
  }
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

/* ---------- company details ---------- */
export function renderProfile(ctx, view) {
  const c = ctx.company();
  const p = ctx.profile();
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
      ${field('gstin', 'GSTIN', p.gstin, 'text', 'Leave empty until you register. Documents will then show no GST.', 'autocapitalize="characters"')}

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
    profiles[ctx.state.company] = next;
    await db.setKV('profiles', profiles);
    await ctx.reload(false);
    toast('Details saved');
    ctx.back();
  };
}

/* ---------- rate card item ---------- */
export function renderRateForm(ctx, view) {
  const company = ctx.state.company;
  const existing = ctx.state.id ? ctx.cache.rates.find((r) => r.id === ctx.state.id) : null;
  const isPrint = company === 'printing';
  const r = existing || { billing: isPrint ? 'sqft' : 'monthly', prices: {} };
  const groups = [...new Set(ctx.cache.rates.filter((x) => x.company === company).map((x) => x.group))];

  view.innerHTML = `
    ${pageHeader(existing ? 'Edit price' : 'Add price', COMPANIES[company].name)}
    <form class="form" id="rate-form">
      <div class="field">
        <label for="r-group">Service</label>
        <input id="r-group" name="group" list="group-list" required value="${esc(r.group)}" placeholder="${isPrint ? 'e.g. Flex banner' : 'e.g. Social media management'}">
        <datalist id="group-list">${groups.map((g) => `<option value="${esc(g)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label for="r-name">${isPrint ? 'Variant' : 'Tier'}</label>
        <input id="r-name" name="name" required value="${esc(r.name)}" placeholder="${isPrint ? 'e.g. Standard 10 oz' : 'e.g. Growth'}">
      </div>
      <div class="field">
        <label for="r-billing">Charged</label>
        <select id="r-billing" name="billing">
          ${Object.entries(BILLING).map(([v, l]) => `<option value="${v}" ${v === r.billing ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="row-3">
        <div class="field"><label for="r-p1">Prayagraj ₹</label><input id="r-p1" name="prayagraj" type="number" inputmode="numeric" min="0" value="${r.prices.prayagraj ?? ''}"></div>
        <div class="field"><label for="r-p2">India ₹</label><input id="r-p2" name="india" type="number" inputmode="numeric" min="0" value="${r.prices.india ?? ''}"></div>
        <div class="field"><label for="r-p3">Abroad $</label><input id="r-p3" name="intl" type="number" inputmode="numeric" min="0" value="${r.prices.intl ?? ''}"></div>
      </div>
      <p class="hint">Leave a price empty if you don't offer this item in that market.</p>
      <div class="field">
        <label for="r-hours">Hours per month (for your own planning)</label>
        <input id="r-hours" name="hours" type="number" inputmode="numeric" min="0" value="${r.hours ?? ''}">
      </div>
      <div class="field">
        <label for="r-includes">What's included (printed on quotations)</label>
        <textarea id="r-includes" name="includes" rows="3">${esc(r.includes)}</textarea>
      </div>
      <button class="btn btn-primary btn-block" type="submit">Save price</button>
      ${existing ? '<button class="btn btn-danger-ghost btn-block" type="button" data-delete>Delete this item</button>' : ''}
    </form>`;

  const num = (v) => (v === '' || v == null ? null : Number(v));
  view.querySelector('#rate-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const val = (k) => String(f.get(k) || '').trim();
    if (!val('group') || !val('name')) { toast('Add the service and tier names'); return; }
    await db.put('rates', {
      id: existing ? existing.id : uid(),
      company,
      order: existing ? existing.order : Date.now(),
      group: val('group'), name: val('name'), billing: val('billing'),
      prices: { prayagraj: num(val('prayagraj')), india: num(val('india')), intl: num(val('intl')) },
      hours: num(val('hours')), includes: val('includes'),
    });
    await ctx.reload(false);
    toast('Price saved');
    ctx.back();
  };
  const del = view.querySelector('[data-delete]');
  if (del) del.onclick = async () => {
    if (!(await confirmBox({ title: 'Delete this price?', text: `${r.group}: ${r.name}`, ok: 'Delete', danger: true }))) return;
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
  const ok = await confirmBox({
    title: 'Import rate card?',
    text: `${data.items.length} prices will be added. Items with the same ID are replaced; everything else stays.`,
    ok: 'Import',
  });
  if (!ok) return;
  for (const item of data.items) {
    if (!item.id || !item.company || !COMPANIES[item.company]) continue;
    await db.put('rates', item);
  }
  await ctx.reload();
  toast(`${data.items.length} prices imported`);
}

async function backup(ctx) {
  const payload = {
    app: 'aur-desk', kind: 'backup', version: 1, exportedAt: new Date().toISOString(),
    clients: await db.all('clients'),
    rates: await db.all('rates'),
    docs: await db.all('docs'),
    txns: await db.all('txns'),
    kv: Object.fromEntries(await Promise.all(BACKUP_KEYS.map(async (k) => [k, await db.getKV(k)]))),
  };
  const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, phone's own time zone
  // .txt so Android's share menu accepts it; AUR Desk reads it back as normal.
  const file = new File([JSON.stringify(payload, null, 1)], `aur-desk-backup-${date}.txt`, { type: 'text/plain' });
  let shared = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'AUR Desk backup' }); shared = true; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  if (!shared) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  await db.setKV('lastBackup', new Date().toISOString());
  await ctx.reload();
  toast(shared ? 'Backup ready. Choose Drive to save it' : 'Backup saved to Downloads');
}

async function restore(ctx, input) {
  const data = await readFile(input);
  if (!data) return;
  if (data.app !== 'aur-desk' || data.kind !== 'backup') { toast("That file isn't an AUR Desk backup"); return; }
  const when = new Date(data.exportedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const ok = await confirmBox({
    title: 'Restore this backup?',
    text: `From ${when}: ${data.clients.length} clients, ${(data.docs || []).length} documents, ${(data.txns || []).length} money entries and ${data.rates.length} prices. Everything currently in AUR Desk will be replaced.`,
    ok: 'Replace and restore', danger: true,
  });
  if (!ok) return;
  await db.clear('clients');
  await db.clear('rates');
  await db.clear('docs');
  await db.clear('txns');
  for (const c of data.clients) await db.put('clients', c);
  for (const t of data.txns || []) await db.put('txns', t);
  for (const d of data.docs || []) await db.put('docs', d);
  for (const r of data.rates) await db.put('rates', r);
  for (const k of BACKUP_KEYS) if (data.kv && k in data.kv) await db.setKV(k, data.kv[k]);
  await ctx.reload();
  toast('Backup restored');
}
