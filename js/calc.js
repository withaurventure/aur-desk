// AUR Desk — Calculator: quick price check, profit plan, printing size.
import { db } from './db.js';
import { esc, uid, icon, pageHeader, toast, MARKETS } from './ui.js';
import { money, totals, currencyFor, MARKET_PRICE_KEY, today } from './docs.js';

const PLAN_DEFAULTS = { target: 100000, expenses: 30000, reserve: 15, hours: 120, clients: 5 };
const SIZES = [[2, 3], [3, 4], [3, 6], [4, 6], [5, 8], [6, 10], [8, 12], [10, 20]];

// remembered while the app is open
const mem = {
  mode: null,
  price: { market: 'prayagraj', qty: {}, discount: '', pay: '50', gst: false },
  print: { rateId: '', customRate: '', unit: 'ft', w: '', h: '', pieces: 1, extras: '', discount: '' },
  scope: 'all',
};

const n = (v) => (v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v));

export async function renderCalc(ctx, view) {
  const plan = { ...PLAN_DEFAULTS, ...((await db.getKV('profitPlan')) || {}) };
  if (!mem.mode) mem.mode = ctx.state.company === 'printing' ? 'print' : 'price';

  view.innerHTML = `
    ${pageHeader('Calculator', ctx.company().name)}
    <div class="seg" role="radiogroup" aria-label="Calculator">
      ${[['price', 'Price check'], ['profit', 'Profit'], ['print', 'Printing']].map(([v, l]) => `
        <input type="radio" name="cmode" id="cm-${v}" value="${v}" ${mem.mode === v ? 'checked' : ''}><label for="cm-${v}">${l}</label>`).join('')}
    </div>
    <div id="calc-body"></div>`;

  const body = view.querySelector('#calc-body');
  const draw = () => {
    if (mem.mode === 'price') priceCheck(ctx, body, plan);
    else if (mem.mode === 'profit') profit(ctx, body, plan);
    else printing(ctx, body);
  };
  view.querySelectorAll('input[name=cmode]').forEach((r) => (r.onchange = () => { mem.mode = r.value; draw(); }));
  draw();
}

const floorPerHour = (plan) => {
  const needed = (n(plan.target) + n(plan.expenses)) / (1 - Math.min(90, n(plan.reserve)) / 100);
  return { needed, perHour: n(plan.hours) ? needed / n(plan.hours) : 0, perClient: n(plan.clients) ? needed / n(plan.clients) : 0 };
};

/* =================== 1. Price check =================== */
function priceCheck(ctx, body, plan) {
  const p = mem.price;
  const company = ctx.state.company;
  const profile = ctx.profile();
  const key = MARKET_PRICE_KEY[p.market];
  const cur = currencyFor(p.market);
  const rates = ctx.cache.rates
    .filter((r) => r.company === company && r.billing !== 'sqft')
    .sort((a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || a.name.localeCompare(b.name));
  const groups = rates.reduce((acc, r) => ((acc[r.group] ||= []).push(r), acc), {});

  body.innerHTML = `
    <div class="calc">
      <div class="seg" role="radiogroup" aria-label="Market">
        ${Object.entries(MARKETS).map(([v, l]) => `<input type="radio" name="pmarket" id="pm-${v}" value="${v}" ${p.market === v ? 'checked' : ''}><label for="pm-${v}">${l}</label>`).join('')}
      </div>

      ${rates.length ? Object.entries(groups).map(([g, items]) => `
        <div class="card calc-group">
          <h3>${esc(g)}</h3>
          ${items.map((r) => {
            const price = r.prices ? r.prices[key] : null;
            const ok = price != null && price !== '';
            const q = p.qty[r.id] || 0;
            return `
            <div class="calc-item ${q ? 'on' : ''} ${ok ? '' : 'off'}">
              <span class="calc-item-text"><strong>${esc(r.name)}</strong><small>${ok ? esc(money(price, cur)) + (r.billing === 'monthly' ? ' /month' : r.billing === 'piece' ? ' /piece' : ' one-time') : 'Not offered in this market'}</small></span>
              ${ok ? `
              <span class="stepper" role="group" aria-label="${esc(g + ' ' + r.name)} quantity">
                <button type="button" data-dec="${r.id}" aria-label="Remove one" ${q ? '' : 'disabled'}>${icon('minus')}</button>
                <output>${q}</output>
                <button type="button" data-inc="${r.id}" aria-label="Add one">${icon('plus')}</button>
              </span>` : ''}
            </div>`;
          }).join('')}
        </div>`).join('')
      : `<div class="empty">No rate card for ${esc(ctx.company().name)} yet. Add prices in Settings → Rate card.</div>`}

      <div class="row-2">
        <div class="field">
          <label for="pc-disc">Discount %</label>
          <input id="pc-disc" type="number" inputmode="decimal" min="0" max="100" value="${esc(p.discount)}" placeholder="0">
        </div>
        <div class="field">
          <label for="pc-pay">Payment</label>
          <select id="pc-pay">${[['50', '50% advance'], ['60', '60% advance'], ['full', 'Full payment']].map(([v, l]) => `<option value="${v}" ${p.pay === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
      </div>
      ${profile.gstin ? `<label class="set-row card"><span>Add GST (18%)</span><input type="checkbox" class="switch" id="pc-gst" ${p.gst ? 'checked' : ''}></label>` : ''}

      <section class="calc-result" id="pc-result" aria-live="polite"></section>
      <div class="row-2">
        <button class="btn btn-ghost" data-clear>Clear</button>
        <button class="btn btn-primary" data-quote>${icon('plus')}Make quotation</button>
      </div>
    </div>`;

  const doc = () => {
    const lines = rates.filter((r) => p.qty[r.id]).map((r) => ({
      id: uid(), rateId: r.id, group: r.group, name: r.name, billing: r.billing, includes: r.includes || '',
      qty: p.qty[r.id], w: '', h: '', pieces: 1, price: r.prices[key], hours: n(r.hours),
    }));
    return {
      kind: 'quote', currency: cur, market: p.market, lines, discountPct: p.discount,
      payment: { mode: p.pay === 'full' ? 'full' : 'advance', pct: p.pay === 'full' ? 50 : Number(p.pay), balanceDays: n(profile.balanceDays) || 7 },
      addGst: !!(p.gst && profile.gstin), adSpendSeparate: false,
    };
  };

  const showResult = () => {
    const d = doc();
    const out = body.querySelector('#pc-result');
    if (!d.lines.length) { out.innerHTML = '<p class="muted">Tap + on the services above to see the price.</p>'; return; }
    const t = totals(d);
    const m = (v) => money(v, cur);
    const monthlyLines = d.lines.filter((l) => l.billing === 'monthly');
    const hours = monthlyLines.reduce((s, l) => s + l.hours * n(l.qty), 0);
    const monthlyNet = monthlyLines.reduce((s, l) => s + n(l.price) * n(l.qty), 0) * (1 - Math.min(100, n(p.discount)) / 100);
    const perHour = hours ? monthlyNet / hours : 0;
    const f = floorPerHour(plan);
    const perHourInr = cur === 'USD' ? null : perHour;
    out.innerHTML = `
      <div class="res-main"><small>${t.recurring ? 'First month' : 'Total'}</small><strong>${esc(m(t.total))}</strong></div>
      <div class="res-grid">
        ${t.recurring ? `<div><small>Then each month</small><span>${esc(m(t.recurring))}</span></div>` : ''}
        ${d.payment.mode === 'full' ? `<div><small>Payment</small><span>Full upfront</span></div>`
          : `<div><small>Advance ${d.payment.pct}%</small><span>${esc(m(t.advance))}</span></div><div><small>Balance</small><span>${esc(m(t.balance))}</span></div>`}
        ${t.discount ? `<div><small>Discount</small><span>− ${esc(m(t.discount))}</span></div>` : ''}
        ${t.gst ? `<div><small>GST 18%</small><span>${esc(m(t.gst))}</span></div>` : ''}
        ${hours ? `<div><small>Your hours / month</small><span>${hours}</span></div>` : ''}
        ${hours ? `<div><small>You earn per hour</small><span>${esc(m(perHour))}</span></div>` : ''}
      </div>
      ${perHourInr != null && hours && f.perHour ? `
        <p class="res-flag ${perHourInr >= f.perHour ? 'good' : 'warn'}">
          ${perHourInr >= f.perHour ? 'Above' : 'Below'} your ${esc(money(f.perHour))}/hour floor${perHourInr >= f.perHour ? '' : '. Raise the price, lower the discount, or treat it as a portfolio client'}.
        </p>` : ''}`;
  };

  body.querySelectorAll('input[name=pmarket]').forEach((r) => (r.onchange = () => { p.market = r.value; priceCheck(ctx, body, plan); }));
  body.querySelectorAll('[data-inc]').forEach((b) => (b.onclick = () => { p.qty[b.dataset.inc] = (p.qty[b.dataset.inc] || 0) + 1; priceCheck(ctx, body, plan); }));
  body.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = () => { p.qty[b.dataset.dec] = Math.max(0, (p.qty[b.dataset.dec] || 0) - 1); priceCheck(ctx, body, plan); }));
  body.querySelector('#pc-disc').oninput = (e) => { p.discount = e.target.value; showResult(); };
  body.querySelector('#pc-pay').onchange = (e) => { p.pay = e.target.value; showResult(); };
  const gst = body.querySelector('#pc-gst');
  if (gst) gst.onchange = () => { p.gst = gst.checked; showResult(); };
  body.querySelector('[data-clear]').onclick = () => { p.qty = {}; p.discount = ''; priceCheck(ctx, body, plan); };
  body.querySelector('[data-quote]').onclick = () => {
    const d = doc();
    if (!d.lines.length) { toast('Add at least one service first'); return; }
    d.lines.forEach((l) => delete l.hours);
    ctx.state.presetDraft = d;
    ctx.state.preset = null;
    ctx.go('doc-edit');
  };
  showResult();
}

/* =================== 2. Profit =================== */
function profit(ctx, body, plan) {
  const month = today().slice(0, 7);
  const txns = ctx.cache.txns.filter((t) => (t.currency || 'INR') === 'INR' && t.date.startsWith(month) && (mem.scope === 'all' || t.company === ctx.state.company));
  const inSum = txns.filter((t) => t.type === 'in').reduce((s, t) => s + n(t.amount), 0);
  const outSum = txns.filter((t) => t.type === 'out').reduce((s, t) => s + n(t.amount), 0);

  body.innerHTML = `
    <div class="calc">
      <p class="hint">Your plan for the whole studio. Change any number and the results update. Saved on this phone.</p>
      <div class="row-2">
        <div class="field"><label for="pf-target">Take-home goal ₹/month</label><input id="pf-target" data-k="target" type="number" inputmode="numeric" value="${plan.target}"></div>
        <div class="field"><label for="pf-exp">Expenses ₹/month</label><input id="pf-exp" data-k="expenses" type="number" inputmode="numeric" value="${plan.expenses}"></div>
        <div class="field"><label for="pf-res">Company reserve %</label><input id="pf-res" data-k="reserve" type="number" inputmode="numeric" min="0" max="90" value="${plan.reserve}"></div>
        <div class="field"><label for="pf-hours">Client hours / month</label><input id="pf-hours" data-k="hours" type="number" inputmode="numeric" value="${plan.hours}"></div>
        <div class="field"><label for="pf-clients">Clients at a time</label><input id="pf-clients" data-k="clients" type="number" inputmode="numeric" min="1" value="${plan.clients}"></div>
      </div>

      <section class="calc-result" id="pf-plan" aria-live="polite"></section>

      <h2 class="form-section">This month so far</h2>
      <div class="seg" role="radiogroup" aria-label="Which companies">
        <input type="radio" name="pscope" id="ps-all" value="all" ${mem.scope === 'all' ? 'checked' : ''}><label for="ps-all">All companies</label>
        <input type="radio" name="pscope" id="ps-one" value="one" ${mem.scope === 'one' ? 'checked' : ''}><label for="ps-one">${esc(ctx.company().short)} only</label>
      </div>
      <section class="calc-result" id="pf-actual" aria-live="polite"></section>
      <p class="hint">"This month" uses your Money entries in rupees. Record every payment and expense to keep it accurate.</p>
    </div>`;

  const draw = () => {
    const f = floorPerHour(plan);
    body.querySelector('#pf-plan').innerHTML = `
      <div class="res-main"><small>Revenue you need each month</small><strong>${esc(money(f.needed))}</strong></div>
      <div class="res-grid">
        <div><small>Per client (${n(plan.clients)})</small><span>${esc(money(f.perClient))}</span></div>
        <div><small>Your hourly floor</small><span>${esc(money(f.perHour))}</span></div>
        <div><small>Expenses</small><span>${esc(money(plan.expenses))}</span></div>
        <div><small>Reserve (${n(plan.reserve)}%)</small><span>${esc(money(f.needed * n(plan.reserve) / 100))}</span></div>
      </div>
      <p class="res-flag">Never price below the hourly floor. The Price check uses it to warn you.</p>`;
    const reserve = inSum * n(plan.reserve) / 100;
    const takeHome = inSum - outSum - reserve;
    const pct = f.needed ? Math.min(100, Math.round(inSum / f.needed * 100)) : 0;
    body.querySelector('#pf-actual').innerHTML = `
      <div class="res-main"><small>Take-home so far</small><strong class="${takeHome < 0 ? 'neg' : ''}">${takeHome < 0 ? '−' : ''}${esc(money(Math.abs(takeHome)))}</strong></div>
      <div class="track light"><div style="width:${pct}%"></div></div>
      <small class="muted">${pct}% of the monthly revenue you need</small>
      <div class="res-grid">
        <div><small>Money in</small><span>${esc(money(inSum))}</span></div>
        <div><small>Money out</small><span>${esc(money(outSum))}</span></div>
        <div><small>Reserve to keep</small><span>${esc(money(reserve))}</span></div>
        <div><small>Still to earn</small><span>${esc(money(Math.max(0, f.needed - inSum)))}</span></div>
      </div>`;
  };

  let saveTimer;
  body.querySelectorAll('[data-k]').forEach((inp) => (inp.oninput = () => {
    plan[inp.dataset.k] = inp.value === '' ? '' : Number(inp.value);
    draw();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => db.setKV('profitPlan', plan), 400);
  }));
  body.querySelectorAll('input[name=pscope]').forEach((r) => (r.onchange = () => { mem.scope = r.value; profit(ctx, body, plan); }));
  draw();
}

/* =================== 3. Printing size =================== */
function printing(ctx, body) {
  const p = mem.print;
  const items = ctx.cache.rates
    .filter((r) => r.company === 'printing' && (r.billing === 'sqft' || r.billing === 'piece'))
    .sort((a, b) => (a.order ?? 1e15) - (b.order ?? 1e15) || a.name.localeCompare(b.name));
  if (p.rateId && !items.find((r) => r.id === p.rateId)) p.rateId = '';
  const rate = items.find((r) => r.id === p.rateId);
  const perPiece = rate && rate.billing === 'piece';

  body.innerHTML = `
    <div class="calc">
      <div class="field">
        <label for="pr-item">Item (AUR Printing Studio rate card)</label>
        <select id="pr-item">
          <option value="">Custom rate</option>
          ${items.map((r) => `<option value="${r.id}" ${r.id === p.rateId ? 'selected' : ''}>${esc(r.group)} — ${esc(r.name)} · ${esc(money(r.prices && r.prices.prayagraj))} ${r.billing === 'sqft' ? '/sq ft' : '/piece'}</option>`).join('')}
        </select>
        ${items.length ? '' : '<small class="hint">No printing prices yet. Add them in Settings → Rate card with AUR Printing Studio selected, or type a rate below.</small>'}
      </div>
      ${rate ? '' : `
      <div class="field">
        <label for="pr-rate">Rate ₹ per sq ft</label>
        <input id="pr-rate" type="number" inputmode="decimal" min="0" value="${esc(p.customRate)}" placeholder="e.g. 12">
      </div>`}

      ${perPiece ? '' : `
      <div class="seg" role="radiogroup" aria-label="Size unit">
        <input type="radio" name="punit" id="pu-ft" value="ft" ${p.unit === 'ft' ? 'checked' : ''}><label for="pu-ft">Feet</label>
        <input type="radio" name="punit" id="pu-in" value="in" ${p.unit === 'in' ? 'checked' : ''}><label for="pu-in">Inches</label>
      </div>
      ${p.unit === 'ft' ? `<div class="chips" aria-label="Common sizes">${SIZES.map(([w, h]) => `<button type="button" class="chip-btn ${n(p.w) === w && n(p.h) === h ? 'on' : ''}" data-size="${w}x${h}">${w} × ${h}</button>`).join('')}</div>` : ''}
      <div class="row-2">
        <div class="field"><label for="pr-w">Width (${p.unit})</label><input id="pr-w" type="number" inputmode="decimal" min="0" value="${esc(p.w)}"></div>
        <div class="field"><label for="pr-h">Height (${p.unit})</label><input id="pr-h" type="number" inputmode="decimal" min="0" value="${esc(p.h)}"></div>
      </div>`}

      <div class="row-3">
        <div class="field"><label for="pr-pcs">Pieces</label><input id="pr-pcs" type="number" inputmode="numeric" min="1" value="${esc(p.pieces)}"></div>
        <div class="field"><label for="pr-extra">Extras ₹</label><input id="pr-extra" type="number" inputmode="numeric" min="0" value="${esc(p.extras)}" placeholder="Design, fitting"></div>
        <div class="field"><label for="pr-disc">Discount %</label><input id="pr-disc" type="number" inputmode="decimal" min="0" max="100" value="${esc(p.discount)}" placeholder="0"></div>
      </div>

      <section class="calc-result" id="pr-result" aria-live="polite"></section>
      <button class="btn btn-primary btn-block" data-quote>${icon('plus')}Make quotation (AUR Printing Studio)</button>
    </div>`;

  const calc = () => {
    const r = items.find((x) => x.id === p.rateId);
    const unitRate = r ? n(r.prices && r.prices.prayagraj) : n(p.customRate);
    const pieces = Math.max(1, n(p.pieces) || 1);
    const toFt = (v) => (p.unit === 'in' ? n(v) / 12 : n(v));
    const wFt = toFt(p.w), hFt = toFt(p.h);
    const area = r && r.billing === 'piece' ? 0 : wFt * hFt;
    const base = r && r.billing === 'piece' ? unitRate * pieces : area * pieces * unitRate;
    const extras = n(p.extras);
    const sub = base + extras;
    const disc = Math.round(sub * Math.min(100, n(p.discount)) / 100);
    const total = Math.round(sub - disc);
    return { r, unitRate, pieces, wFt, hFt, area, base, extras, disc, total };
  };

  const show = () => {
    const c = calc();
    const pay = ctx.profile('printing');
    const pct = pay.payMode === 'full' ? 100 : n(pay.payPct) || 50;
    body.querySelector('#pr-result').innerHTML = !c.total ? '<p class="muted">Enter a size and rate to see the price.</p>' : `
      <div class="res-main"><small>Total</small><strong>${esc(money(c.total))}</strong></div>
      <div class="res-grid">
        ${c.area ? `<div><small>Area per piece</small><span>${+c.area.toFixed(2)} sq ft</span></div><div><small>Total area</small><span>${+(c.area * c.pieces).toFixed(2)} sq ft</span></div>` : ''}
        <div><small>Printing</small><span>${esc(money(c.base))}</span></div>
        ${c.extras ? `<div><small>Extras</small><span>${esc(money(c.extras))}</span></div>` : ''}
        ${c.disc ? `<div><small>Discount</small><span>− ${esc(money(c.disc))}</span></div>` : ''}
        <div><small>${pct === 100 ? 'Full payment' : `Advance ${pct}%`}</small><span>${esc(money(Math.round(c.total * pct / 100)))}</span></div>
      </div>`;
  };

  const rerender = () => printing(ctx, body);
  body.querySelector('#pr-item').onchange = (e) => { p.rateId = e.target.value; rerender(); };
  const rateIn = body.querySelector('#pr-rate');
  if (rateIn) rateIn.oninput = () => { p.customRate = rateIn.value; show(); };
  body.querySelectorAll('input[name=punit]').forEach((r) => (r.onchange = () => { p.unit = r.value; p.w = ''; p.h = ''; rerender(); }));
  body.querySelectorAll('[data-size]').forEach((b) => (b.onclick = () => { [p.w, p.h] = b.dataset.size.split('x').map(Number); rerender(); }));
  for (const [id, k] of [['#pr-w', 'w'], ['#pr-h', 'h'], ['#pr-pcs', 'pieces'], ['#pr-extra', 'extras'], ['#pr-disc', 'discount']]) {
    const el = body.querySelector(id);
    if (el) el.oninput = () => { p[k] = el.value; show(); if (k === 'w' || k === 'h') body.querySelectorAll('.chip-btn').forEach((c) => c.classList.toggle('on', c.dataset.size === `${n(p.w)}x${n(p.h)}`)); };
  }
  body.querySelector('[data-quote]').onclick = () => {
    const c = calc();
    if (!c.total) { toast('Enter a size and rate first'); return; }
    const lines = [{
      id: uid(), rateId: c.r ? c.r.id : null, custom: !c.r, group: c.r ? c.r.group : 'Printing', name: c.r ? c.r.name : 'Custom print',
      billing: c.r && c.r.billing === 'piece' ? 'piece' : 'sqft', includes: c.r ? c.r.includes || '' : '',
      qty: c.pieces, w: c.r && c.r.billing === 'piece' ? '' : +c.wFt.toFixed(2), h: c.r && c.r.billing === 'piece' ? '' : +c.hFt.toFixed(2), pieces: c.pieces, price: c.unitRate,
    }];
    if (c.extras) lines.push({ id: uid(), custom: true, group: 'Custom', name: 'Extras (design, fitting)', billing: 'once', includes: '', qty: 1, w: '', h: '', pieces: 1, price: c.extras });
    if (ctx.state.company !== 'printing') { ctx.switchCompany('printing'); toast('Switched to AUR Printing Studio'); }
    ctx.state.presetDraft = { market: 'prayagraj', currency: 'INR', lines, discountPct: p.discount };
    ctx.state.preset = null;
    ctx.go('doc-edit');
  };
  show();
}

