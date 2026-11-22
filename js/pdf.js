// AUR Desk — branded A4 PDFs for quotations and invoices, and sharing them.
// Runs fully on the phone (jsPDF + Montserrat, which has the ₹ sign). Works offline.
import { COMPANIES } from './companies.js';
import { BILLING } from './ui.js';
import { totals, autoTerms, money, fmtDate, addDays, lineQty, lineAmount } from './docs.js';

let libPromise;
function loadLib() {
  if (!libPromise) {
    libPromise = (async () => {
      const load = (src) => new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src + ' failed to load'));
        document.head.appendChild(s);
      });
      if (!window.jspdf) await load('vendor/jspdf.umd.min.js');
      if (!window.qrcode) await load('vendor/qrcode.js');
      const fonts = {};
      for (const w of ['Regular', 'SemiBold', 'Bold']) fonts[w] = await fileToBase64(`fonts/Montserrat-${w}.ttf`);
      return { jsPDF: window.jspdf.jsPDF, fonts };
    })();
    libPromise.catch(() => { libPromise = null; });
  }
  return libPromise;
}

async function fileToBase64(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadImage(url) {
  const blob = await (await fetch(url)).blob();
  const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = dataUrl; });
  return { dataUrl, w: img.naturalWidth, h: img.naturalHeight, type: blob.type.includes('png') ? 'PNG' : 'JPEG' };
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/* ---------- shared page setup + header ---------- */
async function setup(company) {
  const { jsPDF, fonts } = await loadLib();
  const co = COMPANIES[company];
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  for (const [w, data] of Object.entries(fonts)) {
    pdf.addFileToVFS(`M-${w}.ttf`, data);
    pdf.addFont(`M-${w}.ttf`, 'M', w.toLowerCase());
  }
  const font = (w, size, color = [10, 20, 51]) => { pdf.setFont('M', w); pdf.setFontSize(size); pdf.setTextColor(...color); };
  return {
    pdf, co, font,
    SLATE: [74, 85, 115], NAVY: [10, 20, 51], GREEN: [31, 122, 82],
    ACCENT: rgb(co.theme.primary), SOFT: rgb(co.theme.soft),
    W: 210, L: 16, R: 194,
  };
}

async function drawHeader(k, profile, title, rightLines) {
  const { pdf, co, font, SLATE, ACCENT, W, L, R } = k;
  pdf.setFillColor(...ACCENT); pdf.rect(0, 0, W, 4, 'F');
  let x0 = L;
  try {
    const logo = await loadImage(co.logo);
    const box = 24, ratio = logo.w / logo.h;
    const lw = ratio >= 1 ? box : box * ratio, lh = ratio >= 1 ? box / ratio : box;
    pdf.addImage(logo.dataUrl, logo.type, L, 12 + (box - lh) / 2, lw, lh);
    x0 = L + box + 6;
  } catch { /* logo is optional */ }
  font('bold', 14); pdf.text(profile.displayName || co.name, x0, 19);
  font('regular', 8.5, SLATE);
  const contact = [profile.email, profile.whatsapp].filter(Boolean).join('   ·   ');
  if (contact) pdf.text(contact, x0, 25);
  if (profile.address) pdf.text(pdf.splitTextToSize(profile.address.replace(/\n/g, ', '), 90)[0], x0, 30);
  if (profile.gstin) pdf.text('GSTIN ' + profile.gstin, x0, profile.address ? 35 : 30);

  font('bold', 20, ACCENT); pdf.text(title, R, 20, { align: 'right' });
  font('semibold', 10); pdf.text(rightLines[0] || '', R, 26.5, { align: 'right' });
  font('regular', 8.5, SLATE);
  rightLines.slice(1).forEach((line, i) => pdf.text(line, R, 31.5 + i * 4.5, { align: 'right' }));
  pdf.setDrawColor(227, 230, 238); pdf.setLineWidth(0.3); pdf.line(L, 42, R, 42);
}

function drawFooter(k) {
  const { pdf, co, font, SLATE, W, R } = k;
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    font('regular', 7.5, SLATE);
    if (co.tagline) pdf.text(co.tagline, W / 2, 287, { align: 'center' });
    if (pages > 1) pdf.text(`${i} / ${pages}`, R, 287, { align: 'right' });
  }
}

// UPI payment QR (any UPI app can scan it). Amount and note are filled in.
function drawUpiQr(k, x, y, size, upi, name, amount, note) {
  const { pdf } = k;
  const url = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(name)}&am=${Math.round(amount)}&cu=INR&tn=${encodeURIComponent(note)}`;
  const qr = window.qrcode(0, 'M');
  qr.addData(url); qr.make();
  const n = qr.getModuleCount();
  const cell = size / n;
  pdf.setFillColor(255, 255, 255); pdf.rect(x - 2, y - 2, size + 4, size + 4, 'F');
  pdf.setFillColor(10, 20, 51);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) pdf.rect(x + c * cell, y + r * cell, cell + 0.02, cell + 0.02, 'F');
}

const fileNameFor = (number, name) => `${number || 'draft'} ${name || ''}`.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') + '.pdf';

/* ---------- quotation / invoice ----------
   pay (invoices only): { paid, balance, dueNow } from what you've recorded in Money */
export async function buildPdf(doc, profile, pay = null) {
  const k = await setup(doc.company);
  const { pdf, co, font, SLATE, NAVY, GREEN, ACCENT, SOFT, W, L, R } = k;
  const cur = doc.currency;
  const m = (n) => money(n, cur);
  const t = totals(doc);
  const isQuote = doc.kind === 'quote';
  const paidSoFar = !isQuote && pay && pay.paid > 0;

  await drawHeader(k, profile, isQuote ? 'QUOTATION' : 'INVOICE', [
    doc.number || '',
    'Date: ' + fmtDate(doc.date),
    isQuote ? 'Valid until: ' + fmtDate(addDays(doc.date, doc.validityDays))
      : (doc.payment.mode === 'full' ? 'Due: ' : 'Balance due: ') + fmtDate(addDays(doc.date, doc.payment.balanceDays)),
  ]);

  // bill to + amount box
  const c = doc.client || {};
  font('semibold', 7.5, SLATE); pdf.text(isQuote ? 'PREPARED FOR' : 'BILL TO', L, 50);
  font('bold', 11.5); pdf.text(c.name || '', L, 56);
  font('regular', 9, SLATE);
  let cy = 61.5;
  for (const line of [c.contact, [c.city, c.country].filter(Boolean).join(', '), c.phone, c.email].filter(Boolean)) {
    pdf.text(line, L, cy); cy += 4.6;
  }
  pdf.setFillColor(...SOFT); pdf.roundedRect(128, 47, R - 128, 26, 3, 3, 'F');
  font('semibold', 7.5, SLATE); pdf.text(isQuote ? 'TOTAL' : paidSoFar ? (pay.balance > 0 ? 'BALANCE DUE' : 'PAID IN FULL') : 'AMOUNT DUE', 133, 54);
  font('bold', 17, paidSoFar && pay.balance <= 0 ? GREEN : ACCENT); pdf.text(m(paidSoFar ? pay.balance : t.total), 133, 62.5);
  font('regular', 8, SLATE);
  pdf.text(paidSoFar ? `Paid so far: ${m(pay.paid)} of ${m(t.total)}`
    : doc.payment.mode === 'full' ? 'Full payment' : `${doc.payment.pct}% advance: ${m(t.advance)}`, 133, 68.5);

  // items table
  let y = Math.max(cy + 4, 82);
  const COL = { item: L + 3, billing: 116, qty: 146, rate: 170, amount: R - 3 };
  const header = () => {
    pdf.setFillColor(...SOFT); pdf.rect(L, y - 5, R - L, 8, 'F');
    font('semibold', 8, SLATE);
    pdf.text('ITEM', COL.item, y);
    pdf.text('BILLING', COL.billing, y);
    pdf.text('QTY', COL.qty, y, { align: 'right' });
    pdf.text('RATE', COL.rate, y, { align: 'right' });
    pdf.text('AMOUNT', COL.amount, y, { align: 'right' });
    y += 8;
  };
  const newPageIfNeeded = (need) => {
    if (y + need > 270) { pdf.addPage(); pdf.setFillColor(...ACCENT); pdf.rect(0, 0, W, 4, 'F'); y = 20; return true; }
    return false;
  };
  header();
  for (const l of doc.lines) {
    font('regular', 8);
    const inc = l.includes ? pdf.splitTextToSize(l.includes, COL.billing - COL.item - 6) : [];
    const sizeLine = l.billing === 'sqft' && (l.w || l.h) ? [`${l.w} × ${l.h} ft${Number(l.pieces) > 1 ? ` × ${l.pieces} pcs` : ''}`] : [];
    const extra = [...sizeLine, ...inc];
    const h = 5 + extra.length * 3.8 + 3;
    if (newPageIfNeeded(h)) header();
    font('semibold', 9.5); pdf.text(pdf.splitTextToSize(`${l.group} — ${l.name}`, COL.billing - COL.item - 6)[0], COL.item, y);
    font('regular', 8.5, SLATE); pdf.text(BILLING[l.billing] || '', COL.billing, y);
    const q = lineQty(l);
    font('regular', 9); pdf.text(l.billing === 'sqft' ? `${+q.toFixed(2)} sq ft` : String(q), COL.qty, y, { align: 'right' });
    pdf.text(m(l.price), COL.rate, y, { align: 'right' });
    font('semibold', 9); pdf.text(m(lineAmount(l, cur)), COL.amount, y, { align: 'right' });
    font('regular', 8, SLATE);
    extra.forEach((s, i) => pdf.text(s, COL.item, y + 4.4 + i * 3.8));
    y += h;
    pdf.setDrawColor(238, 240, 245); pdf.line(L, y - 3.5, R, y - 3.5);
  }

  // totals
  const rows = [['Subtotal', m(t.subtotal)]];
  if (t.discount) rows.push([`Discount (${t.discountPct}%)`, '− ' + m(t.discount)]);
  if (t.gst) rows.push(['GST (18%)', m(t.gst)]);
  newPageIfNeeded(14 + rows.length * 6 + (t.recurring ? 6 : 0) + 14);
  y += 2;
  const totalsTop = y;
  for (const [k, v] of rows) {
    font('regular', 9, SLATE); pdf.text(k, 150, y, { align: 'right' });
    font('regular', 9); pdf.text(v, COL.amount, y, { align: 'right' });
    y += 6;
  }
  pdf.setDrawColor(...ACCENT); pdf.setLineWidth(0.4); pdf.line(120, y - 3.5, R, y - 3.5);
  y += 2;
  font('bold', 11); pdf.text('Total', 150, y, { align: 'right' });
  font('bold', 11, ACCENT); pdf.text(m(t.total), COL.amount, y, { align: 'right' });
  y += 6.5;
  if (t.recurring) {
    font('regular', 8.5, SLATE); pdf.text('Then each month', 150, y, { align: 'right' });
    pdf.text(m(t.recurring), COL.amount, y, { align: 'right' }); y += 5.5;
  }
  if (doc.payment.mode !== 'full' && !paidSoFar) {
    font('semibold', 9); pdf.text(`Advance (${doc.payment.pct}%)`, 150, y, { align: 'right' });
    pdf.text(m(t.advance), COL.amount, y, { align: 'right' }); y += 5.5;
    font('regular', 9, SLATE); pdf.text('Balance', 150, y, { align: 'right' });
    pdf.text(m(t.balance), COL.amount, y, { align: 'right' }); y += 5.5;
  }
  if (paidSoFar) {
    font('semibold', 9, GREEN); pdf.text('Paid so far', 150, y, { align: 'right' });
    pdf.text('− ' + m(pay.paid), COL.amount, y, { align: 'right' }); y += 5.5;
    font('bold', 10); pdf.text(pay.balance > 0 ? 'Balance due' : 'Paid in full', 150, y, { align: 'right' });
    pdf.text(m(pay.balance), COL.amount, y, { align: 'right' }); y += 5.5;
  }

  // how to pay: sits in the empty space left of the totals
  const payLines = [];
  if (profile.upi && cur === 'INR') payLines.push('UPI: ' + profile.upi);
  if (profile.intlLink && cur === 'USD') payLines.push('Pay online: ' + profile.intlLink);
  const qrAmount = !isQuote && cur === 'INR' && profile.upi ? (pay ? pay.dueNow : (doc.payment.mode === 'full' ? t.total : t.advance)) : 0;
  if (payLines.length) {
    let py = totalsTop;
    font('semibold', 8, SLATE); pdf.text('HOW TO PAY', L, py); py += 5.5;
    font('regular', 9); payLines.forEach((p) => { pdf.text(pdf.splitTextToSize(p, 95)[0], L, py); py += 4.8; });
    if (qrAmount > 0) {
      drawUpiQr(k, L, py + 1, 28, profile.upi, profile.displayName, qrAmount, doc.number || '');
      font('semibold', 9); pdf.text(`Scan to pay ${m(qrAmount)}`, L + 33, py + 10);
      font('regular', 7.5, SLATE); pdf.text(pdf.splitTextToSize('Any UPI app: GPay, PhonePe, Paytm, BHIM', 60), L + 33, py + 15);
      py += 33;
    }
    y = Math.max(y, py);
  }

  // terms
  const terms = [...autoTerms(doc), ...String(doc.terms || '').split('\n').map((s) => s.trim()).filter(Boolean)];
  if (terms.length) {
    y += 6;
    newPageIfNeeded(12);
    font('semibold', 8, SLATE); pdf.text('TERMS', L, y); y += 5.5;
    font('regular', 8.5, NAVY);
    terms.forEach((term, i) => {
      const lines = pdf.splitTextToSize(term, R - L - 7);
      newPageIfNeeded(lines.length * 4.2 + 1);
      pdf.text(`${i + 1}.`, L, y);
      pdf.text(lines, L + 6, y);
      y += lines.length * 4.2 + 1.2;
    });
  }

  drawFooter(k);
  return new File([pdf.output('blob')], fileNameFor(doc.number, c.name), { type: 'application/pdf' });
}

/* ---------- payment receipt ---------- */
export async function buildReceipt(txn, inv, profile, state) {
  const k = await setup(txn.company);
  const { pdf, font, SLATE, GREEN, SOFT, L, R } = k;
  const cur = txn.currency || 'INR';
  const m = (n) => money(n, cur);

  await drawHeader(k, profile, 'RECEIPT', [txn.receiptNo || '', 'Date: ' + fmtDate(txn.date)]);

  font('semibold', 7.5, SLATE); pdf.text('RECEIVED FROM', L, 50);
  font('bold', 11.5); pdf.text(txn.party || (inv && inv.client ? inv.client.name : ''), L, 56);
  if (inv && inv.client) {
    font('regular', 9, SLATE);
    let cy = 61.5;
    for (const line of [inv.client.contact, [inv.client.city, inv.client.country].filter(Boolean).join(', ')].filter(Boolean)) { pdf.text(line, L, cy); cy += 4.6; }
  }
  pdf.setFillColor(...SOFT); pdf.roundedRect(128, 47, R - 128, 26, 3, 3, 'F');
  font('semibold', 7.5, SLATE); pdf.text('AMOUNT RECEIVED', 133, 54);
  font('bold', 17, GREEN); pdf.text(m(txn.amount), 133, 62.5);
  font('regular', 8, SLATE); pdf.text('Thank you', 133, 68.5);

  let y = 86;
  const rows = [
    ['Payment date', fmtDate(txn.date)],
    ['Paid by', txn.method || '-'],
  ];
  if (txn.reference) rows.push(['Reference', txn.reference]);
  if (inv) {
    rows.push(['For invoice', `${inv.number} (${fmtDate(inv.date)})`]);
    rows.push(['Invoice total', m(state.total)]);
    rows.push(['Paid to date', m(state.paid)]);
    rows.push([state.balance > 0 ? 'Balance remaining' : 'Status', state.balance > 0 ? m(state.balance) : 'Paid in full']);
  }
  if (txn.note) rows.push(['Note', txn.note]);
  for (const [a, b] of rows) {
    font('regular', 9.5, SLATE); pdf.text(a, L, y);
    font(a === 'Balance remaining' || a === 'Status' ? 'bold' : 'semibold', 9.5); pdf.text(pdf.splitTextToSize(String(b), 110), 80, y);
    y += 8;
    pdf.setDrawColor(238, 240, 245); pdf.line(L, y - 4.5, R, y - 4.5);
  }
  y += 6;
  font('regular', 8.5, SLATE);
  pdf.text('This receipt confirms the payment above was received by ' + profile.displayName + '.', L, y);

  drawFooter(k);
  return new File([pdf.output('blob')], fileNameFor(txn.receiptNo, txn.party), { type: 'application/pdf' });
}

export function receiptMessage(txn, inv, profile, state) {
  const m = (n) => money(n, txn.currency || 'INR');
  const lines = [`Hello ${inv && inv.client ? (inv.client.contact || inv.client.name) : txn.party || ''},`, '',
    `We have received ${m(txn.amount)} on ${fmtDate(txn.date)}${inv ? ` for invoice ${inv.number}` : ''}. Thank you!`];
  if (inv) lines.push(state.balance > 0 ? `Balance remaining: ${m(state.balance)}.` : 'The invoice is now paid in full.');
  lines.push(`Receipt ${txn.receiptNo} is attached.`, '', profile.displayName);
  if (profile.whatsapp) lines.push(profile.whatsapp);
  return lines.join('\n');
}

/* ---------- share / download ---------- */
export function shareMessage(doc, profile) {
  const c = doc.client || {};
  const t = totals(doc);
  const m = (n) => money(n, doc.currency);
  const hello = `Hello ${c.contact || c.name || ''},`.replace(' ,', ',');
  const lines = doc.kind === 'quote'
    ? [hello, '', `Please find quotation ${doc.number} from ${profile.displayName} attached.`,
       `Total: ${m(t.total)}${t.recurring ? `, then ${m(t.recurring)} each month` : ''}.`,
       doc.payment.mode === 'full' ? 'Full payment is due before work starts.' : `Advance to start: ${m(t.advance)} (${doc.payment.pct}%).`,
       `Valid until ${fmtDate(addDays(doc.date, doc.validityDays))}.`]
    : [hello, '', `Please find invoice ${doc.number} from ${profile.displayName} attached.`,
       `Amount: ${m(t.total)}.`,
       doc.payment.mode === 'full' ? `Due by ${fmtDate(addDays(doc.date, doc.payment.balanceDays))}.` : `Advance due now: ${m(t.advance)}. Balance ${m(t.balance)} by ${fmtDate(addDays(doc.date, doc.payment.balanceDays))}.`];
  lines.push('', 'Thank you,', profile.displayName);
  if (profile.whatsapp) lines.push(profile.whatsapp);
  return lines.join('\n');
}

// Opens Android's share sheet with the PDF attached. Pick WhatsApp or Gmail there.
export async function sharePdf(file, text, title) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text, title }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  downloadFile(file);
  return 'downloaded';
}

export function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
