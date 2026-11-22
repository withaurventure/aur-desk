// AUR Desk — Documents tab, quotation/invoice editor and document page.
import { db } from './db.js';
import { esc, icon, pageHeader, toast, confirmBox, BILLING, MARKETS } from './ui.js';
import {
  QUOTE_STATUS, INVOICE_STATUS, totals, autoTerms, money, fmtDate, addDays, lineFromRate, lineQty, lineAmount,
  newQuote, saveDoc, snapshot, currencyFor, convertToInvoice, MARKET_PRICE_KEY, invoiceState, paymentsFor,
} from './docs.js';
import { buildPdf, buildReceipt, receiptMessage, sharePdf, shareMessage, downloadFile } from './pdf.js';
import { ensureReceiptNo } from './money.js';
import { uid } from './ui.js';

const statusLabel = (d) => (d.kind === 'quote' ? QUOTE_STATUS : INVOICE_STATUS)[d.status] || d.status;
const statusClass = (d) => ({ draft: 'st-muted', sent: 'st-info', accepted: 'st-good', declined: 'st-bad', invoiced: 'st-good', unpaid: 'st-bad', partial: 'st-warn', paid: 'st-good' }[d.status] || '');

/* =================== Documents tab =================== */
let docTab = 'quote';
export function renderDocuments(ctx, view) {
  const docs = ctx.cache.docs
    .filter((d) => d.company === ctx.state.company && d.kind === docTab)
    .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  view.innerHTML = `
    <div class="title-row">
      <h1 class="page-title">Documents</h1>
      <button class="btn btn-primary btn-sm" data-new>${icon('plus')}New quotation</button>
    </div>
    <div class="seg" role="radiogroup" aria-label="Document type">
      <input type="radio" name="doctab" id="dt-quote" value="quote" ${docTab === 'quote' ? 'checked' : ''}><label for="dt-quote">Quotations</label>
      <input type="radio" name="doctab" id="dt-invoice" value="invoice" ${docTab === 'invoice' ? 'checked' : ''}><label for="dt-invoice">Invoices</label>
    </div>
    ${docs.length ? `<div class="list">${docs.map(docRow).join('')}</div>
      <p class="hint swipe-hint">Swipe a document right to send it, or left to edit or delete it.</p>`
      : `<div class="empty">${docTab === 'quote'
        ? `No quotations yet for ${esc(ctx.company().name)}.<br>Tap <strong>New quotation</strong> to make one.`
        : 'No invoices yet. Approve a quotation to turn it into an invoice.'}</div>`}
  `;
  const older = ctx.cache.docs.filter((d) => d.company === 'ventures' && d.kind === docTab);
  if (older.length) {
    view.insertAdjacentHTML('beforeend', `
      <section class="section"><div class="section-head"><h2>AUR Ventures (older)</h2><span class="muted">made before Ventures became the parent</span></div>
      <div class="list">${older.map(docRow).join('')}</div></section>`);
  }
  view.querySelector('[data-new]').onclick = () => { ctx.state.preset = null; ctx.go('doc-edit'); };
  view.querySelectorAll('input[name=doctab]').forEach((r) => (r.onchange = () => { docTab = r.value; renderDocuments(ctx, view); }));
  bindDocRows(ctx, view);
}

export function docRow(d) {
  const t = totals(d);
  return `
  <div class="swipe" data-swipe="${d.id}">
    <div class="swipe-under swipe-send" aria-hidden="true">${icon('send')}<span>Send</span></div>
    <div class="swipe-under swipe-tray">
      <button class="tray-btn tray-edit" data-act="edit" tabindex="-1">${icon('edit')}<span>Edit</span></button>
      <button class="tray-btn tray-delete" data-act="delete" tabindex="-1">${icon('trash')}<span>Delete</span></button>
    </div>
    <button class="list-row swipe-front" data-doc="${d.id}">
      <span class="list-main">
        <strong>${esc(d.client ? d.client.name : 'No client')}</strong>
        <small>${esc(d.number || 'Draft')} · ${esc(fmtDate(d.date))}</small>
      </span>
      <span class="doc-right">
        <strong>${esc(money(t.total, d.currency))}</strong>
        <span class="status ${statusClass(d)}">${esc(statusLabel(d))}</span>
      </span>
    </button>
  </div>`;
}
export function bindDocRows(ctx, root, rerender = () => ctx.render()) {
  root.querySelectorAll('[data-doc]').forEach((b) => (b.onclick = () => ctx.go('doc', b.dataset.doc)));
  bindSwipes(ctx, root, rerender);
}

/* =================== Editor =================== */
let draft = null;
let draftFor = null;
let dirty = false;
export function resetEditor() { draft = null; draftFor = null; dirty = false; }

export async function renderEditor(ctx, view) {
  const key = ctx.state.id || 'new:' + (ctx.state.preset || '');
  if (draftFor !== key || !draft) {
    if (ctx.state.id) draft = structuredClone(ctx.cache.docs.find((d) => d.id === ctx.state.id));
    else {
      const client = ctx.state.preset ? ctx.cache.clients.find((c) => c.id === ctx.state.preset) : null;
      draft = await newQuote(ctx.state.company, ctx.profile(), client);
      if (ctx.state.presetDraft) {                       // started from the Calculator
        const pd = ctx.state.presetDraft;
        ctx.state.presetDraft = null;
        Object.assign(draft, {
          market: pd.market, currency: pd.currency, lines: pd.lines, discountPct: pd.discountPct || 0,
          ...(pd.payment ? { payment: pd.payment } : {}), ...(pd.addGst ? { addGst: true } : {}),
        });
        dirty = true;
      }
    }
    draftFor = key;
    dirty = false;
  }
  if (!draft) { view.innerHTML = `${pageHeader('Document')}<div class="empty">This document no longer exists.</div>`; return; }
  const d = draft;
  const isQuote = d.kind === 'quote';
  const profile = ctx.profile(d.company);
  const clients = ctx.cache.clients.filter((c) => c.company === d.company).sort((a, b) => a.name.localeCompare(b.name));
  const validityChoice = [7, 15, 30].includes(Number(d.validityDays)) ? String(d.validityDays) : 'custom';
  const payChoice = d.payment.mode === 'full' ? 'full' : String(d.payment.pct);

  view.innerHTML = `
    <header class="page-head">
      <button class="icon-btn" data-leave aria-label="Back">${icon('back')}</button>
      <div class="page-head-text"><h1>${isQuote ? (d.number ? 'Edit quotation' : 'New quotation') : 'Edit invoice'}</h1>
      <small>${esc(d.number || ctx.company().name)}</small></div>
    </header>

    <form class="form editor" id="doc-form" novalidate>
      <section class="ed-block">
        <h2 class="form-section">Client</h2>
        ${clients.length ? `
          <div class="field">
            <label for="d-client">${isQuote ? 'Quotation for' : 'Invoice to'}</label>
            <select id="d-client">
              <option value="">Choose a client…</option>
              ${clients.map((c) => `<option value="${c.id}" ${c.id === d.clientId ? 'selected' : ''}>${esc(c.name)}${c.city ? ' · ' + esc(c.city) : ''}</option>`).join('')}
            </select>
          </div>
          <p class="hint" id="market-hint">${d.clientId ? `Prices for <strong>${esc(MARKETS[d.market])}</strong> (${d.currency === 'USD' ? 'US dollars' : 'rupees'}).` : ''}</p>`
        : `<div class="empty">No clients yet. <button type="button" class="inline-link" data-add-client>Onboard a client first</button></div>`}
      </section>

      <section class="ed-block">
        <h2 class="form-section">Items</h2>
        <div id="lines"></div>
        <div class="row-2">
          <button type="button" class="btn btn-ghost" data-pick>${icon('plus')}From rate card</button>
          <button type="button" class="btn btn-ghost" data-custom>${icon('edit')}Custom item</button>
        </div>
        <div class="field">
          <label for="d-discount">Discount %</label>
          <input id="d-discount" type="number" inputmode="decimal" min="0" max="100" value="${d.discountPct || ''}" placeholder="0">
        </div>
      </section>

      ${isQuote ? `
      <section class="ed-block">
        <h2 class="form-section">Validity</h2>
        <div class="seg" role="radiogroup" aria-label="Quotation valid for">
          ${['7', '15', '30', 'custom'].map((v) => `
            <input type="radio" name="validity" id="v-${v}" value="${v}" ${validityChoice === v ? 'checked' : ''}>
            <label for="v-${v}">${v === 'custom' ? 'Custom' : v + ' days'}</label>`).join('')}
        </div>
        <div class="field" id="custom-validity" ${validityChoice === 'custom' ? '' : 'hidden'}>
          <label for="d-validity">Valid for (days)</label>
          <input id="d-validity" type="number" inputmode="numeric" min="1" value="${d.validityDays}">
        </div>
      </section>` : `
      <section class="ed-block">
        <h2 class="form-section">Invoice date</h2>
        <div class="field">
          <label for="d-date">Date</label>
          <input id="d-date" type="date" value="${d.date}">
        </div>
      </section>`}

      <section class="ed-block">
        <h2 class="form-section">Payment</h2>
        <div class="seg" role="radiogroup" aria-label="Payment">
          ${[['50', '50% advance'], ['60', '60% advance'], ['full', 'Full payment']].map(([v, l]) => `
            <input type="radio" name="pay" id="p-${v}" value="${v}" ${payChoice === v ? 'checked' : ''}>
            <label for="p-${v}">${l}</label>`).join('')}
        </div>
        <div class="field">
          <label for="d-balance">${d.payment.mode === 'full' ? 'Payment due within' : 'Balance due within'}</label>
          <select id="d-balance">
            ${[3, 7, 15, 30].map((n) => `<option value="${n}" ${Number(d.payment.balanceDays) === n ? 'selected' : ''}>${n} days of the invoice</option>`).join('')}
          </select>
        </div>
      </section>

      <section class="ed-block">
        <h2 class="form-section">Options</h2>
        <div class="card settings-list">
          <label class="set-row">
            <span><strong class="opt-title">Ad spend paid separately</strong><small class="opt-sub">Adds a line saying the client pays the ad platforms directly</small></span>
            <input type="checkbox" class="switch" id="d-adspend" ${d.adSpendSeparate ? 'checked' : ''}>
          </label>
          <label class="set-row ${profile.gstin ? '' : 'is-disabled'}">
            <span><strong class="opt-title">Add GST (18%)</strong><small class="opt-sub">${profile.gstin ? 'Adds 18% GST on the total after discount' : 'Add your GSTIN in Settings → Company details to turn this on'}</small></span>
            <input type="checkbox" class="switch" id="d-gst" ${d.addGst ? 'checked' : ''} ${profile.gstin ? '' : 'disabled'}>
          </label>
        </div>
      </section>

      <section class="ed-block">
        <h2 class="form-section">Terms &amp; conditions</h2>
        <p class="hint">Written for you from the choices above:</p>
        <ol class="auto-terms" id="auto-terms"></ol>
        <div class="field">
          <label for="d-terms">Your own terms (one per line, edit freely)</label>
          <textarea id="d-terms" rows="5">${esc(d.terms)}</textarea>
        </div>
      </section>
    </form>

    <div class="sum-bar">
      <div class="sum-figs" id="sum"></div>
      <button class="btn btn-primary" data-save>Save</button>
    </div>
  `;

  renderLines(ctx, view);
  refresh(view);
  bindEditor(ctx, view);
}

function renderLines(ctx, view) {
  const d = draft;
  const cur = d.currency;
  const box = view.querySelector('#lines');
  if (!d.lines.length) { box.innerHTML = '<div class="empty">No items yet. Add from your rate card or a custom item.</div>'; return; }
  box.innerHTML = d.lines.map((l, i) => `
    <div class="line-card" data-line="${i}">
      <div class="line-top">
        ${l.custom
          ? `<input class="line-name" data-f="name" value="${esc(l.name)}" placeholder="Item name" aria-label="Item name">`
          : `<span class="line-title"><strong>${esc(l.group)} — ${esc(l.name)}</strong><small>${esc(BILLING[l.billing] || '')}</small></span>`}
        <button type="button" class="icon-btn icon-btn-sm" data-remove aria-label="Remove item">${icon('close')}</button>
      </div>
      ${l.custom ? `
        <div class="field"><label>Charged</label>
          <select data-f="billing">${Object.entries(BILLING).map(([v, t]) => `<option value="${v}" ${v === l.billing ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>` : ''}
      <div class="line-inputs">
        ${l.billing === 'sqft' ? `
          <div class="field"><label>Width ft</label><input data-f="w" type="number" inputmode="decimal" min="0" value="${l.w}"></div>
          <div class="field"><label>Height ft</label><input data-f="h" type="number" inputmode="decimal" min="0" value="${l.h}"></div>
          <div class="field"><label>Pieces</label><input data-f="pieces" type="number" inputmode="numeric" min="1" value="${l.pieces}"></div>`
        : `<div class="field"><label>${l.billing === 'monthly' ? 'Months' : 'Qty'}</label><input data-f="qty" type="number" inputmode="numeric" min="0" value="${l.qty}"></div>`}
        <div class="field"><label>Rate ${cur === 'USD' ? '$' : '₹'}</label><input data-f="price" type="number" inputmode="decimal" min="0" value="${l.price}"></div>
      </div>
      <div class="line-amount"><span data-qty-label>${esc(qtyLabel(l))}</span><strong data-amount>${esc(money(lineAmount(l, cur), cur))}</strong></div>
    </div>`).join('');
}

function qtyLabel(l) {
  const q = lineQty(l);
  return l.billing === 'sqft' ? `${+q.toFixed(2)} sq ft` : `${q} × ${l.billing === 'monthly' ? 'month' : 'unit'}`;
}

function refresh(view) {
  const d = draft;
  const t = totals(d);
  const m = (n) => money(n, d.currency);
  view.querySelector('#sum').innerHTML = `
    <strong>${esc(m(t.total))}</strong>
    <small>${d.payment.mode === 'full' ? 'Full payment' : `Advance ${d.payment.pct}%: ${esc(m(t.advance))}`}${t.recurring ? ` · then ${esc(m(t.recurring))}/mo` : ''}</small>`;
  view.querySelector('#auto-terms').innerHTML = autoTerms(d).map((s) => `<li>${esc(s)}</li>`).join('');
  view.querySelectorAll('[data-line]').forEach((card) => {
    const l = d.lines[Number(card.dataset.line)];
    card.querySelector('[data-amount]').textContent = m(lineAmount(l, d.currency));
    card.querySelector('[data-qty-label]').textContent = qtyLabel(l);
  });
}

function bindEditor(ctx, view) {
  const d = draft;
  const touch = () => { dirty = true; refresh(view); };

  view.querySelector('[data-leave]').onclick = async () => {
    if (dirty && !(await confirmBox({ title: 'Leave without saving?', text: 'Your changes to this document will be lost.', ok: 'Leave', danger: true }))) return;
    draft = null; draftFor = null; ctx.back();
  };
  const addClient = view.querySelector('[data-add-client]');
  if (addClient) addClient.onclick = () => { resetEditor(); ctx.replace('client-form'); };

  const sel = view.querySelector('#d-client');
  if (sel) sel.onchange = () => {
    const c = ctx.cache.clients.find((x) => x.id === sel.value);
    d.clientId = c ? c.id : null;
    d.client = c ? snapshot(c) : null;
    if (c && c.market !== d.market) {
      d.market = c.market;
      d.currency = currencyFor(c.market);
      reprice(ctx);
      renderLines(ctx, view);
      if (d.lines.length) toast(`Prices switched to ${MARKETS[d.market]}`);
    }
    view.querySelector('#market-hint').innerHTML = c ? `Prices for <strong>${esc(MARKETS[d.market])}</strong> (${d.currency === 'USD' ? 'US dollars' : 'rupees'}).` : '';
    touch();
  };

  // line edits (delegated, so re-rendered lines keep working)
  const lines = view.querySelector('#lines');
  lines.oninput = (e) => {
    const card = e.target.closest('[data-line]');
    if (!card || !e.target.dataset.f) return;
    const l = d.lines[Number(card.dataset.line)];
    l[e.target.dataset.f] = e.target.value;
    touch();
  };
  lines.onchange = (e) => {
    if (e.target.dataset.f === 'billing') { renderLines(ctx, view); touch(); }
  };
  lines.onclick = (e) => {
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    d.lines.splice(Number(rm.closest('[data-line]').dataset.line), 1);
    renderLines(ctx, view); touch();
  };

  view.querySelector('[data-pick]').onclick = () => openPicker(ctx, view, touch);
  view.querySelector('[data-custom]').onclick = () => {
    d.lines.push({ id: uid(), custom: true, group: 'Custom', name: '', billing: d.company === 'printing' ? 'piece' : 'once', includes: '', qty: 1, w: '', h: '', pieces: 1, price: '' });
    renderLines(ctx, view); touch();
    view.querySelector(`[data-line="${d.lines.length - 1}"] .line-name`).focus();
  };

  view.querySelector('#d-discount').oninput = (e) => { d.discountPct = e.target.value; touch(); };

  view.querySelectorAll('input[name=validity]').forEach((r) => (r.onchange = () => {
    const custom = view.querySelector('#custom-validity');
    if (r.value === 'custom') { custom.hidden = false; view.querySelector('#d-validity').focus(); }
    else { custom.hidden = true; d.validityDays = Number(r.value); view.querySelector('#d-validity').value = r.value; }
    touch();
  }));
  const vInput = view.querySelector('#d-validity');
  if (vInput) vInput.oninput = () => { d.validityDays = Math.max(1, Number(vInput.value) || 1); touch(); };
  const dateInput = view.querySelector('#d-date');
  if (dateInput) dateInput.onchange = () => { d.date = dateInput.value || d.date; touch(); };

  view.querySelectorAll('input[name=pay]').forEach((r) => (r.onchange = () => {
    if (r.value === 'full') d.payment.mode = 'full';
    else { d.payment.mode = 'advance'; d.payment.pct = Number(r.value); }
    view.querySelector('label[for=d-balance]').textContent = d.payment.mode === 'full' ? 'Payment due within' : 'Balance due within';
    touch();
  }));
  view.querySelector('#d-balance').onchange = (e) => { d.payment.balanceDays = Number(e.target.value); touch(); };
  view.querySelector('#d-adspend').onchange = (e) => { d.adSpendSeparate = e.target.checked; touch(); };
  view.querySelector('#d-gst').onchange = (e) => { d.addGst = e.target.checked; touch(); };
  view.querySelector('#d-terms').oninput = (e) => { d.terms = e.target.value; dirty = true; };

  view.querySelector('[data-save]').onclick = async () => {
    if (!d.clientId) { toast('Choose a client first'); (view.querySelector('#d-client') || view).focus(); return; }
    if (!d.lines.length) { toast('Add at least one item'); return; }
    if (d.lines.some((l) => l.custom && !String(l.name).trim())) { toast('Give every custom item a name'); return; }
    const isNew = !d.number;
    await saveDoc(d);
    await ctx.reload(false);
    const id = d.id;
    draft = null; draftFor = null; dirty = false;
    toast(isNew ? `${d.kind === 'quote' ? 'Quotation' : 'Invoice'} ${d.number} saved` : 'Changes saved');
    if (isNew) ctx.replace('doc', id);
    else ctx.back();
  };
}

function reprice(ctx) {
  for (const l of draft.lines) {
    if (!l.rateId) continue;
    const r = ctx.cache.rates.find((x) => x.id === l.rateId);
    if (r && r.prices) l.price = r.prices[MARKET_PRICE_KEY[draft.market]] ?? l.price;
  }
}

/* ---------- rate card picker ---------- */
function openPicker(ctx, view, touch) {
  const d = draft;
  const dlg = document.getElementById('picker');
  const key = MARKET_PRICE_KEY[d.market];
  const rates = ctx.cache.rates
    .filter((r) => r.company === d.company)
    .sort((a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || a.name.localeCompare(b.name));
  const groups = rates.reduce((acc, r) => ((acc[r.group] ||= []).push(r), acc), {});

  dlg.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    <h2 class="sheet-title">Add from rate card</h2>
    <p class="hint">Prices shown for ${esc(MARKETS[d.market])}. You can change any rate after adding.</p>
    <div class="picker-list">
      ${rates.length ? Object.entries(groups).map(([g, items]) => `
        <h3 class="picker-group">${esc(g)}</h3>
        ${items.map((r) => {
          const p = r.prices ? r.prices[key] : null;
          const ok = p != null && p !== '';
          return `<button class="picker-row" data-rate="${r.id}" ${ok ? '' : 'disabled'}>
            <span><strong>${esc(r.name)}</strong><small>${esc(BILLING[r.billing] || '')}</small></span>
            <span>${ok ? esc(money(p, d.currency)) : 'Not offered here'}</span>
          </button>`;
        }).join('')}`).join('')
      : '<div class="empty">No rate card for this company yet. Add prices in Settings, or use a custom item.</div>'}
    </div>
    <button class="btn btn-ghost" data-close>Done</button>`;
  dlg.onclick = (e) => {
    const b = e.target.closest('[data-rate]');
    if (b && !b.disabled) {
      const r = rates.find((x) => x.id === b.dataset.rate);
      d.lines.push(lineFromRate(r, d.market));
      renderLines(ctx, view); touch();
      toast(`${r.group}: ${r.name} added`);
      return;
    }
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  };
  dlg.showModal();
}

/* =================== Document page =================== */
export function renderDoc(ctx, view) {
  const d = ctx.cache.docs.find((x) => x.id === ctx.state.id);
  if (!d) { view.innerHTML = `${pageHeader('Document')}<div class="empty">This document no longer exists.</div>`; return; }
  const t = totals(d);
  const m = (n) => money(n, d.currency);
  const isQuote = d.kind === 'quote';
  const profile = ctx.profile(d.company);
  const terms = [...autoTerms(d), ...String(d.terms || '').split('\n').map((s) => s.trim()).filter(Boolean)];
  const canConvert = isQuote && d.status !== 'invoiced' && d.status !== 'declined';
  const ps = isQuote ? null : invoiceState(d, ctx.cache.txns);
  const pays = isQuote ? [] : paymentsFor(d.id, ctx.cache.txns);

  view.innerHTML = `
    ${pageHeader(d.number || 'Draft', `${isQuote ? 'Quotation' : 'Invoice'} · ${fmtDate(d.date)}`,
      d.status !== 'invoiced' ? `<button class="icon-btn" data-edit aria-label="Edit">${icon('edit')}</button>` : '')}

    <section class="doc-hero">
      <div class="doc-hero-top">
        <span class="status ${statusClass(d)}">${esc(statusLabel(d))}</span>
        <span class="muted">${isQuote ? 'Valid until ' + esc(fmtDate(addDays(d.date, d.validityDays))) : 'Due ' + esc(fmtDate(addDays(d.date, d.payment.balanceDays)))}</span>
      </div>
      ${ps ? `
        <strong class="doc-total">${esc(m(ps.balance))}</strong>
        <small>${ps.balance > 0 ? `still due of ${esc(m(t.total))} · paid ${esc(m(ps.paid))}${ps.advancePending ? ` · advance due ${esc(m(ps.dueNow))}` : ''}` : `Paid in full · ${esc(m(t.total))}`}</small>
        <div class="track"><div style="width:${t.total ? Math.min(100, Math.round(ps.paid / t.total * 100)) : 0}%"></div></div>`
      : `<strong class="doc-total">${esc(m(t.total))}</strong>
      <small>${d.payment.mode === 'full' ? 'Full payment' : `${d.payment.pct}% advance ${esc(m(t.advance))} · balance ${esc(m(t.balance))}`}${t.recurring ? ` · then ${esc(m(t.recurring))}/month` : ''}</small>`}
      <span class="doc-client">${esc(d.client ? d.client.name : '')}${d.client && d.client.prefers ? ` · prefers ${d.client.prefers === 'email' ? 'email' : 'WhatsApp'}` : ''}</span>
    </section>

    <div class="row-2">
      <button class="btn btn-primary" data-share>${icon('send')}Send PDF</button>
      <button class="btn btn-ghost" data-download>${icon('backup')}Download</button>
    </div>

    ${canConvert ? `
      <section class="approve card">
        <div><strong>Client agreed?</strong><small>Approve to turn this quotation into an invoice. You can still edit the invoice afterwards.</small></div>
        <button class="btn btn-primary btn-block" data-convert>${icon('check')}Approve &amp; create invoice</button>
        ${d.status !== 'declined' ? '<button class="btn btn-danger-ghost btn-block" data-decline>Mark as declined</button>' : ''}
      </section>` : ''}
    ${isQuote && d.invoiceId ? `<button class="list-row" data-goto="${d.invoiceId}"><span class="list-main"><strong>Invoice ${esc(d.invoiceNumber || '')}</strong><small>Created from this quotation</small></span>${icon('right', 'row-arrow')}</button>` : ''}
    ${!isQuote && d.fromQuoteId ? `<button class="list-row" data-goto="${d.fromQuoteId}"><span class="list-main"><strong>Quotation ${esc(d.fromQuoteNumber || '')}</strong><small>This invoice was approved from it</small></span>${icon('right', 'row-arrow')}</button>` : ''}

    <section class="section">
      <div class="section-head"><h2>Items</h2></div>
      <div class="card doc-lines">
        ${d.lines.map((l) => `
          <div class="doc-line">
            <span><strong>${esc(l.group)} — ${esc(l.name)}</strong><small>${esc(qtyLabel(l))} × ${esc(m(l.price))}</small></span>
            <span>${esc(m(lineAmount(l, d.currency)))}</span>
          </div>`).join('')}
        <div class="doc-line sub"><span>Subtotal</span><span>${esc(m(t.subtotal))}</span></div>
        ${t.discount ? `<div class="doc-line sub"><span>Discount (${t.discountPct}%)</span><span>− ${esc(m(t.discount))}</span></div>` : ''}
        ${t.gst ? `<div class="doc-line sub"><span>GST (18%)</span><span>${esc(m(t.gst))}</span></div>` : ''}
        <div class="doc-line total"><span>Total</span><span>${esc(m(t.total))}</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Terms</h2></div>
      <ol class="card terms-list">${terms.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </section>

    ${!isQuote ? `
      <section class="section">
        <div class="section-head"><h2>Payments</h2><span class="muted">${pays.length} recorded</span></div>
        ${pays.length ? `<div class="card pay-list">${pays.map((p) => `
          <div class="pay-row">
            <span><strong>${esc(m(p.amount))}</strong><small>${esc(fmtDate(p.date))} · ${esc(p.method || '')}${p.account ? ' · into ' + esc(p.account) : ''}</small></span>
            <button class="btn btn-ghost btn-sm" data-receipt="${p.id}">${icon('receipt')}Receipt</button>
          </div>`).join('')}</div>` : '<div class="empty">No payments recorded yet.</div>'}
        ${ps.balance > 0 ? `<button class="btn btn-primary btn-block" data-record>${icon('plus')}Record a payment</button>` : ''}
      </section>` : ''}
    ${!profile.upi && d.currency === 'INR' ? `<p class="hint">Tip: add your UPI ID in Settings → Company details and it will be printed on the PDF.</p>` : ''}

    <button class="btn btn-danger-ghost btn-block" data-delete>Delete ${isQuote ? 'quotation' : 'invoice'}</button>
  `;

  const edit = view.querySelector('[data-edit]');
  if (edit) edit.onclick = () => ctx.go('doc-edit', d.id);
  view.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => ctx.go('doc', b.dataset.goto)));

  const makeFile = async (btn) => {
    btn.disabled = true; const label = btn.innerHTML; btn.textContent = 'Making PDF…';
    try { return await buildPdf(d, profile, ps); }
    catch (err) { console.error(err); toast('Could not make the PDF. Open the app once with internet, then try again.'); return null; }
    finally { btn.disabled = false; btn.innerHTML = label; }
  };

  view.querySelector('[data-share]').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; const label = btn.innerHTML; btn.textContent = 'Making PDF…';
    try { await sendDoc(ctx, d); } finally { btn.disabled = false; btn.innerHTML = label; }
  };
  view.querySelector('[data-download]').onclick = async (e) => {
    const file = await makeFile(e.currentTarget);
    if (file) { downloadFile(file); toast('PDF saved to Downloads'); }
  };

  const rec = view.querySelector('[data-record]');
  if (rec) rec.onclick = () => { ctx.state.preset = { type: 'in', invoiceId: d.id }; ctx.go('txn'); };
  view.querySelectorAll('[data-receipt]').forEach((b) => (b.onclick = async () => {
    const txn = ctx.cache.txns.find((x) => x.id === b.dataset.receipt);
    if (!txn) return;
    b.disabled = true; const label = b.innerHTML; b.textContent = 'Making…';
    try {
      await ensureReceiptNo(txn);
      // balance as it stood right after this payment
      const upTo = pays.filter((p) => (p.date + p.createdAt) <= (txn.date + txn.createdAt));
      const paid = upTo.reduce((s, p) => s + Number(p.amount || 0), 0);
      const state = { total: t.total, paid, balance: Math.max(0, t.total - paid) };
      const file = await buildReceipt(txn, d, profile, state);
      const how = await sharePdf(file, receiptMessage(txn, d, profile, state), `Receipt ${txn.receiptNo}`);
      if (how !== 'cancelled') toast(how === 'shared' ? 'Receipt sent' : 'Receipt saved to Downloads');
      await ctx.reload(false);
    } catch (err) { console.error(err); toast('Could not make the receipt'); }
    finally { b.disabled = false; b.innerHTML = label; }
  }));

  const conv = view.querySelector('[data-convert]');
  if (conv) conv.onclick = async () => {
    const ok = await confirmBox({
      title: `Approve ${d.number}?`,
      text: `This creates an invoice for ${d.client ? d.client.name : 'the client'} of ${m(t.total)}, dated today, with the same items and terms. The quotation is kept and marked Invoiced.`,
      ok: 'Approve & create invoice',
    });
    if (!ok) return;
    const inv = await convertToInvoice(d);
    await ctx.reload(false);
    toast(`Invoice ${inv.number} created`);
    ctx.replace('doc', inv.id);
  };
  const dec = view.querySelector('[data-decline]');
  if (dec) dec.onclick = async () => {
    d.status = 'declined'; await saveDoc(d); await ctx.reload(); toast('Marked as declined');
  };

  view.querySelector('[data-delete]').onclick = async () => {
    if (await confirmDelete(ctx, d)) { await deleteDoc(ctx, d); ctx.back(); }
  };
}

/* =================== actions shared by the document page and the swipes =================== */
export async function sendDoc(ctx, d) {
  const profile = ctx.profile(d.company);
  const ps = d.kind === 'invoice' ? invoiceState(d, ctx.cache.txns) : null;
  let file;
  try { file = await buildPdf(d, profile, ps); }
  catch (err) { console.error(err); toast('Could not make the PDF. Open the app once with internet, then try again.'); return; }
  const how = await sharePdf(file, shareMessage(d, profile), `${d.kind === 'quote' ? 'Quotation' : 'Invoice'} ${d.number}`);
  if (how === 'cancelled') return;
  if (d.kind === 'quote' && d.status === 'draft') { d.status = 'sent'; await saveDoc(d); }
  await ctx.reload();
  toast(how === 'shared' ? 'Sent' : 'PDF saved to Downloads');
}

export function confirmDelete(ctx, d) {
  const pays = d.kind === 'invoice' ? paymentsFor(d.id, ctx.cache.txns) : [];
  return confirmBox({
    title: `Are you sure you want to delete ${d.number}?`,
    text: `${d.kind === 'quote' ? 'Quotation' : 'Invoice'} for ${d.client ? d.client.name : 'no client'}. This removes it from this phone and cannot be undone. Its number will not be reused.${pays.length ? ' Its payments stay in Money, no longer linked to an invoice.' : ''}`,
    ok: 'Delete', danger: true,
  });
}

export async function deleteDoc(ctx, d) {
  const pays = d.kind === 'invoice' ? paymentsFor(d.id, ctx.cache.txns) : [];
  await db.del('docs', d.id);
  for (const p of pays) { p.invoiceId = null; p.note = [p.note, `was for ${d.number} (deleted)`].filter(Boolean).join(' · '); await db.put('txns', p); }
  if (d.kind === 'invoice' && d.fromQuoteId) {
    const q = ctx.cache.docs.find((x) => x.id === d.fromQuoteId);
    if (q) { q.status = 'accepted'; delete q.invoiceId; delete q.invoiceNumber; await saveDoc(q); }
  }
  await ctx.reload(false);
  toast(`${d.number} deleted`);
}

/* =================== swipe rows ===================
   Swipe right → Send.  Swipe left → shows Edit and Delete.  Tap → opens the document.
   Every action asks "Are you sure?" first. */
const SEND_AT = 96;     // px to the right that counts as "send"
const TRAY = 156;       // width of the Edit + Delete tray

export function bindSwipes(ctx, root, rerender) {
  let openRow = null;
  const close = (row) => { if (!row) return; row.querySelector('.swipe-front').style.transform = ''; row.classList.remove('open'); if (openRow === row) openRow = null; };

  root.querySelectorAll('.swipe').forEach((row) => {
    const front = row.querySelector('.swipe-front');
    const d = () => ctx.cache.docs.find((x) => x.id === row.dataset.swipe);
    let x0 = 0, y0 = 0, dx = 0, base = 0, dragging = false, decided = false, moved = false;

    front.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (openRow && openRow !== row) close(openRow);
      x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false; decided = false; dragging = true;
      base = row.classList.contains('open') ? -TRAY : 0;
      front.style.transition = 'none';
    });
    front.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        if (Math.abs(my) > Math.abs(mx)) { dragging = false; front.style.transition = ''; return; } // vertical: let the page scroll
        front.setPointerCapture(e.pointerId);
      }
      moved = true;
      dx = Math.max(-TRAY - 30, Math.min(SEND_AT + 40, base + mx));
      front.style.transform = `translateX(${dx}px)`;
      row.classList.toggle('going-right', dx > 0);
      row.classList.toggle('armed', dx >= SEND_AT);
    });
    const end = async () => {
      if (!dragging) return;
      dragging = false;
      front.style.transition = '';
      row.classList.remove('armed');
      if (!moved) return;
      if (dx >= SEND_AT) { front.style.transform = ''; await askSend(ctx, d()); return; }
      if (dx <= -TRAY / 2) { front.style.transform = `translateX(${-TRAY}px)`; row.classList.add('open'); openRow = row; }
      else close(row);
    };
    front.addEventListener('pointerup', end);
    front.addEventListener('pointercancel', end);
    // a drag is not a tap: don't open the document after swiping
    front.addEventListener('click', (e) => {
      if (moved || row.classList.contains('open')) { e.stopImmediatePropagation(); e.preventDefault(); if (!moved) close(row); moved = false; }
    }, true);

    row.querySelector('[data-act=edit]').onclick = async () => {
      const doc = d(); close(row);
      if (doc.kind === 'quote' && doc.status === 'invoiced') { toast('This quotation is already invoiced. Edit its invoice instead.'); return; }
      const ok = await confirmBox({ title: `Edit ${doc.number}?`, text: `Opens ${doc.kind === 'quote' ? 'the quotation' : 'the invoice'} for ${doc.client ? doc.client.name : 'this client'} so you can change it.`, ok: 'Edit' });
      if (ok) ctx.go('doc-edit', doc.id);
    };
    row.querySelector('[data-act=delete]').onclick = async () => {
      const doc = d(); close(row);
      if (await confirmDelete(ctx, doc)) { await deleteDoc(ctx, doc); rerender(); }
    };
  });
}

async function askSend(ctx, d) {
  const ok = await confirmBox({
    title: `Send ${d.number}?`,
    text: `Makes the PDF and opens the share menu, so you can send it to ${d.client ? d.client.name : 'the client'} on ${d.client && d.client.prefers === 'email' ? 'email' : 'WhatsApp'} (or anywhere else).`,
    ok: 'Send',
  });
  if (ok) await sendDoc(ctx, d);
}

