// AUR Desk — quotation and invoice logic: numbering, totals, terms, conversion.
import { db } from './db.js';
import { COMPANIES } from './companies.js';
import { uid } from './ui.js';

export const QUOTE_STATUS = {
  draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', invoiced: 'Invoiced',
};
export const INVOICE_STATUS = { unpaid: 'Unpaid', partial: 'Part paid', paid: 'Paid' };

const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v));
const round = (n, cur) => (cur === 'USD' ? Math.round(n * 100) / 100 : Math.round(n));

export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in the phone's time zone
export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + Number(days || 0));
  return d.toLocaleDateString('en-CA');
}
export function fmtDate(iso) {
  return iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}
export function money(n, cur = 'INR') {
  return cur === 'USD'
    ? '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}

/* ---------- numbering: AURS-Q-001, AURS-INV-001 (per company) ---------- */
const CODES = { quote: 'Q', invoice: 'INV', receipt: 'RCP' };
export async function nextNumber(company, kind) {
  const counters = (await db.getKV('counters')) || {};
  const c = (counters[company] ||= {});
  c[kind] = (c[kind] || 0) + 1;
  await db.setKV('counters', counters);
  return `${COMPANIES[company].prefix}-${CODES[kind]}-${String(c[kind]).padStart(3, '0')}`;
}

/* ---------- lines ---------- */
export const MARKET_PRICE_KEY = { prayagraj: 'prayagraj', india: 'india', intl: 'intl' };
export const currencyFor = (market) => (market === 'intl' ? 'USD' : 'INR');

export function lineFromRate(rate, market) {
  const price = rate.prices ? rate.prices[MARKET_PRICE_KEY[market]] : null;
  return {
    id: uid(), rateId: rate.id, group: rate.group, name: rate.name, billing: rate.billing,
    includes: rate.includes || '', qty: 1, w: '', h: '', pieces: 1, price: price ?? 0,
  };
}
export function lineQty(l) {
  if (l.billing === 'sqft') return num(l.w) * num(l.h) * (num(l.pieces) || 1);
  return num(l.qty) || 0;
}
export function lineAmount(l, cur) { return round(lineQty(l) * num(l.price), cur); }

/* ---------- totals ---------- */
export function totals(doc) {
  const cur = doc.currency;
  const lines = doc.lines || [];
  const subtotal = round(lines.reduce((s, l) => s + lineAmount(l, cur), 0), cur);
  const monthly = round(lines.filter((l) => l.billing === 'monthly').reduce((s, l) => s + lineAmount(l, cur), 0), cur);
  const pct = Math.min(100, Math.max(0, num(doc.discountPct)));
  const discount = round(subtotal * pct / 100, cur);
  const taxable = subtotal - discount;
  const gst = doc.addGst ? round(taxable * 0.18, cur) : 0;
  const total = round(taxable + gst, cur);
  // what the client pays each month after the first, when the first month also has one-time items
  const recurring = monthly > 0 && monthly < subtotal
    ? round(monthly * (1 - pct / 100) * (doc.addGst ? 1.18 : 1), cur) : null;
  const advance = doc.payment.mode === 'full' ? total : round(total * num(doc.payment.pct) / 100, cur);
  return { subtotal, discountPct: pct, discount, gst, total, recurring, advance, balance: round(total - advance, cur), hasMonthly: monthly > 0 };
}

/* ---------- terms written for you from the choices made ---------- */
export function autoTerms(doc) {
  const t = totals(doc);
  const m = (n) => money(n, doc.currency);
  const out = [];
  if (doc.kind === 'quote') {
    out.push(`This quotation is valid for ${doc.validityDays} days, until ${fmtDate(addDays(doc.date, doc.validityDays))}.`);
  }
  if (doc.payment.mode === 'full') {
    out.push(doc.kind === 'quote'
      ? `Full payment of ${m(t.total)} is due before work starts.`
      : `Full payment of ${m(t.total)} is due by ${fmtDate(addDays(doc.date, doc.payment.balanceDays))}.`);
  } else {
    out.push(`${doc.payment.pct}% advance (${m(t.advance)}) is due before work starts.`);
    out.push(doc.kind === 'quote'
      ? `The balance of ${m(t.balance)} is due within ${doc.payment.balanceDays} days of the invoice.`
      : `The balance of ${m(t.balance)} is due by ${fmtDate(addDays(doc.date, doc.payment.balanceDays))}.`);
  }
  if (t.hasMonthly) out.push('Monthly services are billed at the start of each month.');
  if (doc.adSpendSeparate) out.push('Advertising spend is paid by the client directly to the ad platforms and is not part of these amounts.');
  if (doc.addGst) out.push('GST at 18% is charged as shown.');
  return out;
}

/* ---------- new documents ---------- */
export async function newQuote(company, profile, client) {
  const market = client ? client.market : 'prayagraj';
  return {
    id: uid(), kind: 'quote', company, number: null, status: 'draft',
    clientId: client ? client.id : null, client: client ? snapshot(client) : null,
    date: today(), market, currency: currencyFor(market),
    lines: [], discountPct: 0,
    validityDays: Number(profile.validityDays) || 15,
    payment: { mode: profile.payMode || 'advance', pct: Number(profile.payPct) || 50, balanceDays: Number(profile.balanceDays) || 7 },
    adSpendSeparate: false, addGst: false,
    terms: profile.terms || '',
    createdAt: new Date().toISOString(),
  };
}

export function snapshot(c) {
  return { name: c.name, contact: c.contact || '', phone: c.phone || '', email: c.email || '', city: c.city || '', country: c.country || '', prefers: c.prefers || 'whatsapp' };
}

export async function saveDoc(doc) {
  if (!doc.number) doc.number = await nextNumber(doc.company, doc.kind);
  doc.updatedAt = new Date().toISOString();
  await db.put('docs', doc);
  return doc;
}

/* Approve a quotation and turn it into an invoice. The quotation keeps its number
   and is marked Invoiced; the invoice gets its own number, today's date, and can be edited. */
export async function convertToInvoice(quote) {
  const inv = {
    ...structuredClone(quote),
    id: uid(), kind: 'invoice', number: null, status: 'unpaid',
    date: today(), fromQuoteId: quote.id, fromQuoteNumber: quote.number,
    payments: [], createdAt: new Date().toISOString(),
  };
  delete inv.validityDays;
  delete inv.invoiceId;
  await saveDoc(inv);
  quote.status = 'invoiced';
  quote.invoiceId = inv.id;
  quote.invoiceNumber = inv.number;
  await saveDoc(quote);
  return inv;
}

/* ---------- payments against invoices (recorded by hand in Money) ---------- */
export function paymentsFor(invoiceId, txns) {
  return txns.filter((t) => t.type === 'in' && t.invoiceId === invoiceId)
    .sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt));
}

// paid so far, what is left, and what the client should pay next
export function invoiceState(inv, txns) {
  const t = totals(inv);
  const cur = inv.currency;
  const paid = round(paymentsFor(inv.id, txns).reduce((s, x) => s + num(x.amount), 0), cur);
  const balance = Math.max(0, round(t.total - paid, cur));
  const status = paid <= 0 ? 'unpaid' : balance <= (cur === 'USD' ? 0.005 : 0.5) ? 'paid' : 'partial';
  const advanceLeft = inv.payment.mode === 'full' ? balance : Math.max(0, round(t.advance - paid, cur));
  const dueNow = advanceLeft > 0 ? advanceLeft : balance;
  return { total: t.total, paid, balance, status, dueNow, advancePending: advanceLeft > 0 && inv.payment.mode !== 'full' };
}

export async function syncInvoice(invoiceId) {
  if (!invoiceId) return;
  const inv = await db.get('docs', invoiceId);
  if (!inv) return;
  const s = invoiceState(inv, await db.all('txns'));
  if (inv.status !== s.status) { inv.status = s.status; inv.updatedAt = new Date().toISOString(); await db.put('docs', inv); }
}
