// AUR Desk — Money: everything that comes in and goes out, recorded by hand.
// A payment linked to an invoice updates that invoice (Part paid / Paid) automatically.
import { db } from './db.js';
import { esc, uid, icon, pageHeader, toast, confirmBox } from './ui.js';
import { money, fmtDate, today, invoiceState, syncInvoice, nextNumber } from './docs.js';

export const METHODS = ['UPI', 'Bank transfer (NEFT/IMPS/RTGS)', 'Cash', 'Card', 'Cheque', 'PayPal', 'Wise', 'Other'];
export const OUT_CATEGORIES = [
  'Software & AI tools', 'Ad spend', 'Printing materials', 'Freelancer / outside help', 'Rent & utilities',
  'Phone & internet', 'Travel', 'Taxes & fees', 'Owner withdrawal', 'Other',
];
const DEFAULT_ACCOUNTS = ['Bank account', 'UPI', 'Cash in hand'];

let month = today().slice(0, 7); // YYYY-MM
let filter = 'all';

/* =================== Money tab =================== */
export function renderMoney(ctx, view) {
  const company = ctx.state.company;
  const all = ctx.cache.txns.filter((t) => t.company === company);
  const inMonth = all.filter((t) => t.date.startsWith(month));
  const shown = inMonth.filter((t) => filter === 'all' || t.type === filter)
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  const sum = (type, cur) => inMonth.filter((t) => t.type === type && (t.currency || 'INR') === cur).reduce((s, t) => s + Number(t.amount || 0), 0);
  const inr = { in: sum('in', 'INR'), out: sum('out', 'INR') };
  const usd = { in: sum('in', 'USD'), out: sum('out', 'USD') };
  const label = new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const isThisMonth = month === today().slice(0, 7);

  // group the list by day
  const days = shown.reduce((acc, t) => ((acc[t.date] ||= []).push(t), acc), {});

  view.innerHTML = `
    <div class="title-row">
      <h1 class="page-title">Money</h1>
    </div>

    <div class="month-row">
      <button class="icon-btn" data-month="-1" aria-label="Previous month">${icon('back')}</button>
      <strong>${esc(label)}</strong>
      <button class="icon-btn" data-month="1" aria-label="Next month" ${isThisMonth ? 'disabled' : ''}>${icon('right')}</button>
    </div>

    <section class="money-sum">
      <div><small>In</small><strong class="in">${esc(money(inr.in))}</strong></div>
      <div><small>Out</small><strong class="out">${esc(money(inr.out))}</strong></div>
      <div><small>Net</small><strong>${esc((inr.in - inr.out < 0 ? '−' : '') + money(Math.abs(inr.in - inr.out)))}</strong></div>
      ${usd.in || usd.out ? `<p class="usd-line">Dollars: in ${esc(money(usd.in, 'USD'))} · out ${esc(money(usd.out, 'USD'))}</p>` : ''}
    </section>

    <div class="row-2">
      <button class="btn btn-primary" data-add="in">${icon('plus')}Money in</button>
      <button class="btn btn-ghost" data-add="out">${icon('minus')}Money out</button>
    </div>

    <div class="seg" role="radiogroup" aria-label="Show">
      ${[['all', 'All'], ['in', 'In'], ['out', 'Out']].map(([v, l]) => `
        <input type="radio" name="mfilter" id="mf-${v}" value="${v}" ${filter === v ? 'checked' : ''}><label for="mf-${v}">${l}</label>`).join('')}
    </div>

    ${shown.length ? Object.entries(days).map(([day, list]) => `
      <section class="section">
        <h2 class="day-head">${esc(fmtDate(day))}</h2>
        <div class="list">${list.map(txnRow).join('')}</div>
      </section>`).join('')
    : `<div class="empty">${all.length ? 'Nothing recorded in this month.' : `Nothing recorded yet for ${esc(ctx.company().name)}.<br>Add every payment you receive or make, and your invoices and Home figures stay up to date.`}</div>`}
  `;

  view.querySelectorAll('[data-month]').forEach((b) => (b.onclick = () => {
    const d = new Date(month + '-01T00:00:00');
    d.setMonth(d.getMonth() + Number(b.dataset.month));
    month = d.toLocaleDateString('en-CA').slice(0, 7);
    renderMoney(ctx, view);
  }));
  view.querySelectorAll('input[name=mfilter]').forEach((r) => (r.onchange = () => { filter = r.value; renderMoney(ctx, view); }));
  view.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { ctx.state.preset = { type: b.dataset.add }; ctx.go('txn'); }));
  bindTxnRows(ctx, view);
}

export function txnRow(t) {
  const sub = [t.type === 'in' ? 'into ' + (t.account || '-') : 'from ' + (t.account || '-'), t.method, t.invoiceNumber, t.type === 'out' ? t.category : '']
    .filter(Boolean).join(' · ');
  return `
    <button class="list-row" data-txn="${t.id}">
      <span class="txn-icon ${t.type}" aria-hidden="true">${icon(t.type === 'in' ? 'arrowIn' : 'arrowOut')}</span>
      <span class="list-main"><strong>${esc(t.party || (t.type === 'in' ? 'Money in' : 'Money out'))}</strong><small>${esc(sub)}</small></span>
      <strong class="txn-amt ${t.type}">${t.type === 'in' ? '+' : '−'}${esc(money(t.amount, t.currency || 'INR'))}</strong>
    </button>`;
}
export function bindTxnRows(ctx, root) {
  root.querySelectorAll('[data-txn]').forEach((b) => (b.onclick = () => { ctx.state.preset = null; ctx.go('txn', b.dataset.txn); }));
}

/* =================== Money in / out form =================== */
export function renderTxnForm(ctx, view) {
  const { cache, state } = ctx;
  const existing = state.id ? cache.txns.find((t) => t.id === state.id) : null;
  const preset = state.preset || {};
  const company = existing ? existing.company : state.company;
  const openInvoices = cache.docs
    .filter((d) => d.kind === 'invoice' && d.company === company)
    .map((d) => ({ d, s: invoiceState(d, cache.txns.filter((t) => !existing || t.id !== existing.id)) }))
    .filter(({ d, s }) => s.balance > 0 || (existing && existing.invoiceId === d.id) || preset.invoiceId === d.id)
    .sort((a, b) => b.d.date.localeCompare(a.d.date));

  const t = existing ? { ...existing } : {
    type: preset.type || 'in', amount: '', currency: 'INR', date: today(),
    party: '', account: '', method: 'UPI', reference: '', category: '', note: '', invoiceId: preset.invoiceId || '',
  };
  if (!existing && t.invoiceId) {
    const hit = openInvoices.find((x) => x.d.id === t.invoiceId);
    if (hit) { t.amount = hit.s.dueNow; t.currency = hit.d.currency; t.party = hit.d.client ? hit.d.client.name : ''; }
  }

  const parties = [...new Set([...cache.clients.filter((c) => c.company === company).map((c) => c.name), ...cache.txns.map((x) => x.party)].filter(Boolean))];
  const accounts = [...new Set([...cache.txns.map((x) => x.account), ...DEFAULT_ACCOUNTS].filter(Boolean))];

  view.innerHTML = `
    ${pageHeader(existing ? (existing.type === 'in' ? 'Money in' : 'Money out') : 'Record money', ctx.company().name)}
    <form class="form" id="txn-form" novalidate>
      <div class="seg seg-money" role="radiogroup" aria-label="Type">
        <input type="radio" name="type" id="ty-in" value="in" ${t.type === 'in' ? 'checked' : ''}><label for="ty-in">Money in</label>
        <input type="radio" name="type" id="ty-out" value="out" ${t.type === 'out' ? 'checked' : ''}><label for="ty-out">Money out</label>
      </div>

      <div class="field in-only">
        <label for="t-invoice">For invoice</label>
        <select id="t-invoice" name="invoiceId">
          <option value="">Not for an invoice</option>
          ${openInvoices.map(({ d, s }) => `<option value="${d.id}" ${d.id === t.invoiceId ? 'selected' : ''}>${esc(d.number)} · ${esc(d.client ? d.client.name : '')} · ${s.balance > 0 ? 'due ' + esc(money(s.balance, d.currency)) : 'paid'}</option>`).join('')}
        </select>
        <small class="hint" id="inv-hint"></small>
      </div>

      <div class="amount-row">
        <div class="field">
          <label for="t-amount">Amount</label>
          <input id="t-amount" name="amount" type="number" inputmode="decimal" min="0" step="any" required value="${esc(t.amount)}" placeholder="0">
        </div>
        <div class="seg seg-cur" role="radiogroup" aria-label="Currency">
          <input type="radio" name="currency" id="cu-INR" value="INR" ${t.currency !== 'USD' ? 'checked' : ''}><label for="cu-INR">₹</label>
          <input type="radio" name="currency" id="cu-USD" value="USD" ${t.currency === 'USD' ? 'checked' : ''}><label for="cu-USD">$</label>
        </div>
      </div>

      <div class="field">
        <label for="t-date">Date</label>
        <input id="t-date" name="date" type="date" value="${esc(t.date)}" max="${today()}">
      </div>

      <div class="field">
        <label for="t-party" id="party-label">${t.type === 'in' ? 'Received from' : 'Paid to'}</label>
        <input id="t-party" name="party" list="party-list" value="${esc(t.party)}" autocomplete="off" placeholder="${t.type === 'in' ? 'Client or person' : 'e.g. Canva, Meta Ads, freelancer'}">
        <datalist id="party-list">${parties.map((p) => `<option value="${esc(p)}"></option>`).join('')}</datalist>
      </div>

      <div class="field">
        <label for="t-account" id="account-label">${t.type === 'in' ? 'Received into' : 'Paid from'}</label>
        <input id="t-account" name="account" list="account-list" value="${esc(t.account)}" autocomplete="off" placeholder="e.g. Bank account, Cash in hand">
        <datalist id="account-list">${accounts.map((a) => `<option value="${esc(a)}"></option>`).join('')}</datalist>
        <small class="hint">Where the money landed or left from. Type your own names, for example "SBI current".</small>
      </div>

      <div class="field">
        <label for="t-method">Method</label>
        <select id="t-method" name="method">${METHODS.map((m) => `<option ${m === t.method ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      </div>

      <div class="field out-only">
        <label for="t-category">What for</label>
        <select id="t-category" name="category">
          <option value="">Choose…</option>
          ${OUT_CATEGORIES.map((c) => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label for="t-ref">Reference (optional)</label>
        <input id="t-ref" name="reference" value="${esc(t.reference)}" autocomplete="off" placeholder="UTR or transaction ID">
      </div>

      <div class="field">
        <label for="t-note">Note (optional)</label>
        <textarea id="t-note" name="note" rows="2">${esc(t.note)}</textarea>
      </div>

      <p class="form-error" id="form-error" role="alert"></p>
      <button class="btn btn-primary btn-block" type="submit">${existing ? 'Save changes' : 'Save'}</button>
      ${existing ? '<button class="btn btn-danger-ghost btn-block" type="button" data-delete>Delete this entry</button>' : ''}
    </form>`;

  const form = view.querySelector('#txn-form');
  const applyType = () => {
    const type = form.querySelector('input[name=type]:checked').value;
    form.classList.toggle('is-out', type === 'out');
    view.querySelector('#party-label').textContent = type === 'in' ? 'Received from' : 'Paid to';
    view.querySelector('#account-label').textContent = type === 'in' ? 'Received into' : 'Paid from';
  };
  const invHint = () => {
    const sel = view.querySelector('#t-invoice');
    const hit = openInvoices.find((x) => x.d.id === sel.value);
    view.querySelector('#inv-hint').textContent = hit
      ? `Total ${money(hit.s.total, hit.d.currency)} · paid ${money(hit.s.paid, hit.d.currency)} · ${hit.s.advancePending ? 'advance still due ' + money(hit.s.dueNow, hit.d.currency) : 'balance ' + money(hit.s.balance, hit.d.currency)}`
      : '';
    return hit;
  };
  form.querySelectorAll('input[name=type]').forEach((r) => (r.onchange = applyType));
  view.querySelector('#t-invoice').onchange = () => {
    const hit = invHint();
    if (hit) {
      view.querySelector('#t-amount').value = hit.s.dueNow;
      view.querySelector(`#cu-${hit.d.currency}`).checked = true;
      if (hit.d.client) view.querySelector('#t-party').value = hit.d.client.name;
    }
  };
  applyType();
  invHint();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const val = (k) => String(f.get(k) || '').trim();
    const err = view.querySelector('#form-error');
    const amount = Number(val('amount'));
    if (!(amount > 0)) { err.textContent = 'Enter an amount above zero.'; view.querySelector('#t-amount').focus(); return; }
    if (!val('date')) { err.textContent = 'Choose a date.'; return; }
    const type = val('type');
    const invoiceId = type === 'in' ? val('invoiceId') : '';
    const inv = invoiceId ? cache.docs.find((d) => d.id === invoiceId) : null;
    if (inv && inv.currency !== val('currency')) { err.textContent = `This invoice is in ${inv.currency === 'USD' ? 'dollars' : 'rupees'}. Switch the currency to match.`; return; }

    const record = {
      ...(existing || {}),
      id: existing ? existing.id : uid(),
      company,
      type, amount, currency: val('currency'), date: val('date'),
      party: val('party'), account: val('account'), method: val('method'),
      reference: val('reference'), note: val('note'),
      category: type === 'out' ? val('category') : '',
      invoiceId: invoiceId || null, invoiceNumber: inv ? inv.number : null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await db.put('txns', record);
    await syncInvoice(record.invoiceId);
    if (existing && existing.invoiceId && existing.invoiceId !== record.invoiceId) await syncInvoice(existing.invoiceId);
    await ctx.reload(false);
    if (inv) {
      const s = invoiceState(inv, ctx.cache.txns);
      toast(s.balance > 0 ? `Saved. ${inv.number}: ${money(s.balance, inv.currency)} still due` : `Saved. ${inv.number} is paid in full`);
    } else toast('Saved');
    ctx.back();
  };

  const del = view.querySelector('[data-delete]');
  if (del) del.onclick = async () => {
    const ok = await confirmBox({
      title: 'Delete this entry?',
      text: `${existing.type === 'in' ? 'Money in' : 'Money out'}: ${money(existing.amount, existing.currency || 'INR')}${existing.invoiceNumber ? ` (for ${existing.invoiceNumber}, which will show this amount as unpaid again)` : ''}.`,
      ok: 'Delete', danger: true,
    });
    if (!ok) return;
    await db.del('txns', existing.id);
    await syncInvoice(existing.invoiceId);
    await ctx.reload(false);
    toast('Deleted');
    ctx.back();
  };
}

/* receipt number is given the first time a receipt is made for a payment */
export async function ensureReceiptNo(txn) {
  if (txn.receiptNo) return txn;
  txn.receiptNo = await nextNumber(txn.company, 'receipt');
  await db.put('txns', txn);
  return txn;
}
