// AUR Desk — settings: company details, rate card, security, backup.
import { db } from './db.js';
import { COMPANIES } from './companies.js';
import { esc, uid, icon, pageHeader, toast, confirmBox, priceLine, BILLING } from './ui.js';
import { runLock, bioAvailable, bioEnabled, enableBio, disableBio } from './lock.js';
import {
  status as backupStatus, setPassword, setPrefs, connect, disconnect, backupToDrive, FREQS, explain,
  listDriveBackups, downloadDriveBackup, decryptFile, restorePayload, summary, encryptedFileForPhone, warmUp,
} from './backup.js';


/* ---------- main settings page ---------- */
export async function renderSettings(ctx, view) {
  const c = ctx.company();
  const p = ctx.profile();
  const rates = ctx.cache.rates.filter((r) => r.company === ctx.state.company)
    .sort((a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || a.name.localeCompare(b.name));
  const groups = groupBy(rates, 'group');
  const [bioOk, bioOn] = [await bioAvailable(), await bioEnabled()];
  const bk = await backupStatus();
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
      <div class="section-head"><h2>Group</h2></div>
      <button class="list-row" data-go="group">
        <img class="row-logo" src="logos/aur-ventures.jpg" alt="">
        <span class="list-main"><strong>AUR Ventures · parent company</strong><small>Legal details and GSTIN for both brands</small></span>
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
    <p class="version">AUR Desk · step 7 · data stays on this phone</p>
  `;

  view.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => ctx.go(b.dataset.go)));
  view.querySelectorAll('[data-rate]').forEach((b) => (b.onclick = () => ctx.go('rate', b.dataset.rate)));

  view.querySelector('#import-rates').onchange = (e) => importRates(ctx, e.target);
  bindBackup(ctx, view, bk);

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
      ${field('gstin', 'GSTIN for this brand only', (ctx.cache.profiles[ctx.state.company] || {}).gstin || '', 'text', 'Usually leave empty: both brands use the GSTIN in Settings → Group (AUR Ventures) once you register.', 'autocapitalize="characters"')}

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
          <button class="btn btn-ghost btn-block" data-set-password>Change backup password</button>
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

  on('[data-set-password]', async () => {
    const pw = await passwordDialog({
      title: bk.hasPassword ? 'Change backup password' : 'Set a backup password',
      text: 'At least 8 characters. Write it down somewhere safe: without it, your backups cannot be opened, not even by me. Backups made before a change still need the old password.',
      confirm: true,
    });
    if (!pw) return;
    await setPassword(pw);
    toast('Backup password saved');
    ctx.render();
  });

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
