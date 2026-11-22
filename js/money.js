// AUR Desk — Money: everything that comes in and goes out, recorded by hand.
// A payment linked to an invoice updates that invoice (Part paid / Paid) automatically.
import { db } from './db.js';
import { esc, uid, icon, pageHeader, toast, confirmBox } from './ui.js';
import { money, fmtDate, today, invoiceState, syncInvoice, nextNumber } from './docs.js';
import { COMPANIES, COMPANY_ORDER } from './companies.js';
import { groupFigures, breakdown, GROUP, TRANSFER_OUT, PROJECTS, FUNDING, isInternal, isFunding } from './finance.js';

export const METHODS = ['UPI', 'Bank transfer (NEFT/IMPS/RTGS)', 'Cash', 'Card', 'Cheque', 'PayPal', 'Wise', 'Other'];
export const OUT_CATEGORIES = [
  'Software & AI tools', 'Ad spend', 'Printing materials', 'Freelancer / outside help', 'Rent & utilities',
  'Phone & internet', 'Travel', 'Taxes & fees', 'Owner withdrawal', 'Other',
];
const DEFAULT_ACCOUNTS = ['Bank account', 'UPI', 'Cash in hand'];

let month = today().slice(0, 7); // YYYY-MM
let filter = 'all';

/* =================== shared bits =================== */
const n = (v) => Number(v || 0);
const sumOf = (list, type, cur = 'INR') => list.filter((t) => t.type === type && (t.currency || 'INR') === cur).reduce((s, t) => s + n(t.amount), 0);
const totalsOf = (list) => ({ in: sumOf(list, 'in'), out: sumOf(list, 'out'), inUsd: sumOf(list, 'in', 'USD'), outUsd: sumOf(list, 'out', 'USD') });
const signed = (v) => (v < 0 ? '−' : '') + money(Math.abs(v));
const monthLabel = () => new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function monthRow() {
  const isThisMonth = month === today().slice(0, 7);
  return `
    <div class="month-row">
      <button class="icon-btn" data-month="-1" aria-label="Previous month">${icon('back')}</button>
      <strong>${esc(monthLabel())}</strong>
      <button class="icon-btn" data-month="1" aria-label="Next month" ${isThisMonth ? 'disabled' : ''}>${icon('right')}</button>
    </div>`;
}
function bindMonth(view, redraw) {
  view.querySelectorAll('[data-month]').forEach((b) => (b.onclick = () => {
    const d = new Date(month + '-01T00:00:00');
    d.setMonth(d.getMonth() + Number(b.dataset.month));
    month = d.toLocaleDateString('en-CA').slice(0, 7);
    redraw();
  }));
}
function sumCard(t, netLabel = 'Net') {
  return `
    <section class="money-sum">
      <div><small>In</small><strong class="in">${esc(money(t.in))}</strong></div>
      <div><small>Out</small><strong class="out">${esc(money(t.out))}</strong></div>
      <div><small>${netLabel}</small><strong>${esc(signed(t.in - t.out))}</strong></div>
      ${t.inUsd || t.outUsd ? `<p class="usd-line">Dollars: in ${esc(money(t.inUsd, 'USD'))} · out ${esc(money(t.outUsd, 'USD'))}</p>` : ''}
    </section>`;
}
function entryList(list, showCompany, emptyText) {
  const shown = list.filter((t) => filter === 'all' || t.type === filter)
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const days = shown.reduce((acc, t) => ((acc[t.date] ||= []).push(t), acc), {});
  return `
    <div class="seg" role="radiogroup" aria-label="Show">
      ${[['all', 'All'], ['in', 'In'], ['out', 'Out']].map(([v, l]) => `
        <input type="radio" name="mfilter" id="mf-${v}" value="${v}" ${filter === v ? 'checked' : ''}><label for="mf-${v}">${l}</label>`).join('')}
    </div>
    ${shown.length ? Object.entries(days).map(([day, items]) => `
      <section class="section">
        <h2 class="day-head">${esc(fmtDate(day))}</h2>
        <div class="list">${items.map((t) => txnRow(t, showCompany)).join('')}</div>
      </section>`).join('')
    : `<div class="empty">${emptyText}</div>`}`;
}

/* =================== Money tab: the whole group together =================== */
export function renderMoney(ctx, view) {
  const inMonth = ctx.cache.txns.filter((t) => t.date.startsWith(month));
  const g = groupFigures(ctx.cache.txns, month);
  const rows = [
    ...g.brands.map((b) => ({
      id: b.id, co: b.co, name: b.co.name, net: b.net,
      sub: b.income || b.costs ? `In ${money(b.income)} · Out ${money(b.costs)}` : 'Nothing this month',
    })),
    {
      id: GROUP, co: g.ventures.co, name: 'AUR Ventures · shared costs', net: g.ventures.net,
      sub: `Costs ${money(g.ventures.sharedCosts)}${g.ventures.funding ? ` · funding in ${money(g.ventures.funding)}` : ''}`,
    },
  ];

  view.innerHTML = `
    <div class="title-row">
      <h1 class="page-title">Money</h1>
      <span class="muted">AUR Group</span>
    </div>
    ${monthRow()}
    ${sumCard({ in: g.income, out: g.costs, inUsd: g.usdIn, outUsd: g.usdOut }, g.net < 0 ? 'Net loss' : 'Net profit')}

    <section class="section">
      <div class="section-head"><h2>By company</h2><span class="muted">tap for details</span></div>
      <div class="card co-list">
        ${rows.map((r) => `
          <button class="co-row" data-co="${r.id}" style="--co:${r.co.theme.dot}">
            <span class="co-dot" aria-hidden="true"></span>
            <span class="list-main"><strong>${esc(r.name)}</strong><small>${esc(r.sub)}</small></span>
            <span class="co-net ${r.net < 0 ? 'neg' : r.net > 0 ? 'pos' : ''}"><small>${r.id === GROUP ? 'Cost' : 'Net'}</small>${esc(signed(r.net))}</span>
            ${icon('right', 'row-arrow')}
          </button>`).join('')}
      </div>
      <p class="hint">Group profit = brand profits − AUR Ventures' shared costs. Money into Ventures is funding and moves to Ventures are internal, so neither counts as profit or cost.</p>
    </section>

    <div class="row-2">
      <button class="btn btn-primary" data-add="in">${icon('plus')}Money in</button>
      <button class="btn btn-ghost" data-add="out">${icon('minus')}Money out</button>
    </div>

    ${entryList(inMonth, true, ctx.cache.txns.length ? 'Nothing recorded in this month.' : 'Nothing recorded yet.<br>Add every payment you receive or make, and your invoices and Home figures stay up to date.')}
  `;

  bindMonth(view, () => renderMoney(ctx, view));
  view.querySelectorAll('input[name=mfilter]').forEach((r) => (r.onchange = () => { filter = r.value; renderMoney(ctx, view); }));
  view.querySelectorAll('[data-co]').forEach((b) => (b.onclick = () => ctx.go('money-co', b.dataset.co)));
  view.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { ctx.state.preset = { type: b.dataset.add }; ctx.go('txn'); }));
  bindTxnRows(ctx, view);
}

/* =================== one company in detail =================== */
let project = 'all';
export function renderMoneyCompany(ctx, view) {
  const id = ctx.state.id;
  const co = COMPANIES[id];
  if (!co) { view.innerHTML = `${pageHeader('Money')}<div class="empty">Unknown company.</div>`; return; }
  const isGroup = id === GROUP;
  const inMonth = ctx.cache.txns.filter((t) => t.company === id && t.date.startsWith(month));
  const g = groupFigures(ctx.cache.txns, month);
  const bd = breakdown(ctx.cache.txns, id, month);
  const bars = (rows, total, cls) => rows.map(([k, v]) => `
    <div class="bar-row">
      <span class="bar-label"><span>${esc(k)}</span><strong>${esc(money(v))}</strong></span>
      <span class="bar-track"><span class="bar-fill ${cls}" style="width:${total ? Math.max(3, Math.round(v / total * 100)) : 0}%"></span></span>
    </div>`).join('');
  const entries = isGroup && project !== 'all' ? inMonth.filter((t) => t.type === 'out' && (t.project || 'General') === project) : inMonth;

  let body;
  if (isGroup) {
    const v = g.ventures;
    body = `
      <section class="money-sum">
        <div><small>Shared costs</small><strong class="out">${esc(money(v.sharedCosts))}</strong></div>
        <div><small>Funding in</small><strong class="in">${esc(money(v.funding))}</strong></div>
        <div><small>Effect on profit</small><strong>${esc(signed(v.net))}</strong></div>
      </section>
      <p class="hint">AUR Ventures runs both brands. It isn't a profit centre: its costs come off the group's profit, and money put into it is funding.</p>
      <section class="section">
        <div class="section-head"><h2>Costs by project</h2><span class="muted">${esc(money(v.sharedCosts))}</span></div>
        ${bd.byProject.length ? `<div class="card bars">${bars(bd.byProject, v.sharedCosts, 'out')}</div>` : '<div class="empty">No shared costs this month.</div>'}
      </section>
      <section class="section">
        <div class="section-head"><h2>Costs by type</h2></div>
        ${bd.out.length ? `<div class="card bars">${bars(bd.out, v.sharedCosts, 'out')}</div>` : '<div class="empty">Nothing yet.</div>'}
      </section>
      <section class="section">
        <div class="section-head"><h2>Funding in</h2><span class="muted">${esc(money(v.funding))}</span></div>
        ${bd.in.length ? `<div class="card bars">${bars(bd.in, v.funding, 'in')}</div>` : '<div class="empty">No funding this month.</div>'}
      </section>`;
  } else {
    const b = g.brands.find((x) => x.id === id);
    body = `
      ${sumCard({ in: b.income, out: b.costs, inUsd: 0, outUsd: 0 }, b.net < 0 ? 'Net loss' : 'Net profit')}
      <section class="section">
        <div class="section-head"><h2>Money in by source</h2><span class="muted">${esc(money(b.income))}</span></div>
        ${bd.in.length ? `<div class="card bars">${bars(bd.in, b.income, 'in')}</div>` : '<div class="empty">No money in this month.</div>'}
      </section>
      <section class="section">
        <div class="section-head"><h2>Expenses by type</h2><span class="muted">${esc(money(b.costs))}</span></div>
        ${bd.out.length ? `<div class="card bars">${bars(bd.out, b.costs, 'out')}</div>` : '<div class="empty">No expenses this month.</div>'}
        ${b.transfers ? `<p class="hint">Also moved to AUR Ventures: ${esc(money(b.transfers))}. That's internal, so it isn't counted as an expense.</p>` : ''}
      </section>`;
  }

  view.innerHTML = `
    ${pageHeader(isGroup ? 'AUR Ventures' : co.name, isGroup ? 'Parent company · shared costs' : 'Money in & out')}
    ${monthRow()}
    ${body}
    <div class="row-2">
      <button class="btn ${isGroup ? 'btn-ghost' : 'btn-primary'}" data-add="in">${icon('plus')}${isGroup ? 'Funding in' : 'Money in'}</button>
      <button class="btn ${isGroup ? 'btn-primary' : 'btn-ghost'}" data-add="out">${icon('minus')}${isGroup ? 'Shared cost' : 'Money out'}</button>
    </div>
    <h2 class="form-section">All entries</h2>
    ${isGroup ? `
      <div class="field">
        <label for="proj-filter">Project</label>
        <select id="proj-filter"><option value="all">All projects</option>${PROJECTS.map((p) => `<option ${p === project ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      </div>` : ''}
    ${entryList(entries, false, `Nothing recorded for ${esc(isGroup ? 'AUR Ventures' : co.name)} in this month.`)}
  `;

  bindMonth(view, () => renderMoneyCompany(ctx, view));
  view.querySelectorAll('input[name=mfilter]').forEach((r) => (r.onchange = () => { filter = r.value; renderMoneyCompany(ctx, view); }));
  const pf = view.querySelector('#proj-filter');
  if (pf) pf.onchange = () => { project = pf.value; renderMoneyCompany(ctx, view); };
  view.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => { ctx.state.preset = { type: b.dataset.add, company: id }; ctx.go('txn'); }));
  view.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => ctx.back()));
  bindTxnRows(ctx, view);
}

export function txnRow(t, showCompany = false) {
  const sub = [isFunding(t) ? 'Funding: ' + (t.category || 'other') : '', isInternal(t) ? 'Internal move' : '', t.type === 'in' ? 'into ' + (t.account || '-') : 'from ' + (t.account || '-'), t.method, t.invoiceNumber, t.type === 'out' && !isInternal(t) ? (t.project ? t.project + ' · ' : '') + (t.category || '') : '']
    .filter(Boolean).join(' · ');
  return `
    <button class="list-row" data-txn="${t.id}">
      <span class="txn-icon ${t.type}" aria-hidden="true">${icon(t.type === 'in' ? 'arrowIn' : 'arrowOut')}</span>
      <span class="list-main"><strong>${esc(t.party || (t.type === 'in' ? 'Money in' : 'Money out'))}</strong><small>${showCompany && COMPANIES[t.company] ? `<span class="co-tag" style="--co:${COMPANIES[t.company].theme.dot}">${esc(COMPANIES[t.company].short)}</span>` : ''}${esc(sub)}</small></span>
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
  const company = existing ? existing.company : (preset.company && COMPANIES[preset.company] ? preset.company : state.company);
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
    ${pageHeader(existing ? (existing.type === 'in' ? 'Money in' : 'Money out') : 'Record money', COMPANIES[company].name)}
    <form class="form" id="txn-form" novalidate>
      ${existing ? '' : `
      <fieldset class="field">
        <legend>Company</legend>
        <div class="seg" role="radiogroup">
          ${COMPANY_ORDER.map((id) => `<input type="radio" name="company" id="co-${id}" value="${id}" ${id === company ? 'checked' : ''}><label for="co-${id}">${esc(COMPANIES[id].short)}</label>`).join('')}
        </div>
      </fieldset>`}
      <div class="seg seg-money" role="radiogroup" aria-label="Type">
        <input type="radio" name="type" id="ty-in" value="in" ${t.type === 'in' ? 'checked' : ''}><label for="ty-in">${company === GROUP ? 'Funding in' : 'Money in'}</label>
        <input type="radio" name="type" id="ty-out" value="out" ${t.type === 'out' ? 'checked' : ''}><label for="ty-out">${company === GROUP ? 'Shared cost' : 'Money out'}</label>
      </div>

      ${company === GROUP ? `
      <div class="field in-only">
        <label for="t-funding">Funding type</label>
        <select id="t-funding" name="funding">
          ${FUNDING.map((f) => `<option ${f === t.category ? 'selected' : ''}>${esc(f)}</option>`).join('')}
        </select>
        <small class="hint">Money put into AUR Ventures is funding. It isn't counted as profit.</small>
      </div>` : ''}
      <div class="field in-only ${company === GROUP ? 'hide-group' : ''}">
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

      ${company === GROUP ? `
      <div class="field out-only">
        <label for="t-project">Project</label>
        <select id="t-project" name="project">
          ${PROJECTS.map((p) => `<option ${p === (t.project || 'General') ? 'selected' : ''}>${esc(p)}</option>`).join('')}
        </select>
        <small class="hint">Shared costs are tracked by project, so you can see what the scheduling tool has cost so far.</small>
      </div>` : ''}
      <div class="field out-only">
        <label for="t-category">What for</label>
        <select id="t-category" name="category">
          <option value="">Choose…</option>
          ${[...OUT_CATEGORIES, ...(company === GROUP ? [] : [TRANSFER_OUT])].map((c) => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        ${company === GROUP ? '' : `<small class="hint">Choose "${TRANSFER_OUT}" when you move money to the parent company. It won't count as an expense.</small>`}
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
  // switching company redraws the form (its invoices and names differ); keeps money in/out choice
  form.querySelectorAll('input[name=company]').forEach((r) => (r.onchange = () => {
    state.preset = { ...(state.preset || {}), company: r.value, type: form.querySelector('input[name=type]:checked').value, invoiceId: '' };
    renderTxnForm(ctx, view);
  }));
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
    const invoiceId = type === 'in' && company !== GROUP ? val('invoiceId') : '';
    const inv = invoiceId ? cache.docs.find((d) => d.id === invoiceId) : null;
    if (inv && inv.currency !== val('currency')) { err.textContent = `This invoice is in ${inv.currency === 'USD' ? 'dollars' : 'rupees'}. Switch the currency to match.`; return; }

    const record = {
      ...(existing || {}),
      id: existing ? existing.id : uid(),
      company,
      type, amount, currency: val('currency'), date: val('date'),
      party: val('party'), account: val('account'), method: val('method'),
      reference: val('reference'), note: val('note'),
      category: type === 'out' ? val('category') : (company === GROUP ? val('funding') : ''),
      project: type === 'out' && company === GROUP ? val('project') : null,
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
