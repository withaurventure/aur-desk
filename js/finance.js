// AUR Desk — group profit rules (one place, used by Home, Money and the Calculator).
//
// • AUR Studio and AUR Printing Studio are the brands: they earn and spend.
// • AUR Ventures is the parent: it only carries shared costs (tools, registration,
//   hiring/payroll, the scheduling tool…). It is never a profit centre.
// • Money that comes INTO Ventures is funding (your own investment, a loan, a transfer
//   from a brand), so it never counts as income.
// • A brand's "Transfer to AUR Ventures" is an internal move, so it is not a brand cost.
// • Group net profit = Studio net + Printing net − Ventures shared costs.
// Figures are in rupees; dollar entries are reported separately.
import { COMPANIES } from './companies.js';

export const GROUP = 'ventures';
export const BRANDS = ['studio', 'printing'];
export const TRANSFER_OUT = 'Transfer to AUR Ventures';
export const PROJECTS = ['Scheduling tool', 'Registration & legal', 'Hiring & payroll', 'General'];
export const FUNDING = ['Owner investment', 'Loan', 'Transfer from AUR Studio', 'Transfer from AUR Printing Studio', 'Other'];

const amt = (t) => Number(t.amount || 0);
const inr = (t) => (t.currency || 'INR') === 'INR';

export const isInternal = (t) => (t.company !== GROUP && t.type === 'out' && t.category === TRANSFER_OUT);
export const isFunding = (t) => t.company === GROUP && t.type === 'in';

// figures for one month (YYYY-MM) or for everything when month is null
export function groupFigures(txns, month = null) {
  const list = month ? txns.filter((t) => t.date.startsWith(month)) : txns;
  const sum = (f) => list.filter(f).reduce((s, t) => s + amt(t), 0);

  const brands = BRANDS.map((id) => {
    const mine = (t) => t.company === id && inr(t);
    const income = sum((t) => mine(t) && t.type === 'in');
    const costs = sum((t) => mine(t) && t.type === 'out' && !isInternal(t));
    const transfers = sum((t) => mine(t) && isInternal(t));
    return { id, co: COMPANIES[id], income, costs, net: income - costs, transfers };
  });
  const sharedCosts = sum((t) => t.company === GROUP && inr(t) && t.type === 'out');
  const funding = sum((t) => isFunding(t) && inr(t));

  const income = brands.reduce((s, b) => s + b.income, 0);
  const costs = brands.reduce((s, b) => s + b.costs, 0) + sharedCosts;
  const usdIn = sum((t) => !inr(t) && t.type === 'in' && !isFunding(t));
  const usdOut = sum((t) => !inr(t) && t.type === 'out' && !isInternal(t));

  return {
    income, costs, net: income - costs,
    brands,
    ventures: { id: GROUP, co: COMPANIES[GROUP], sharedCosts, funding, net: -sharedCosts },
    usdIn, usdOut,
  };
}

// money in by source and money out by type (or project) for one company, for a month
export function breakdown(txns, company, month) {
  const list = txns.filter((t) => t.company === company && t.date.startsWith(month) && inr(t));
  const group = (f, key) => Object.entries(list.filter(f).reduce((acc, t) => {
    const k = key(t) || 'Not set';
    acc[k] = (acc[k] || 0) + amt(t);
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  return {
    in: group((t) => t.type === 'in', (t) => (company === GROUP ? t.category : t.party)),
    out: group((t) => t.type === 'out' && !isInternal(t), (t) => t.category),
    byProject: company === GROUP ? group((t) => t.type === 'out', (t) => t.project || 'General') : [],
    transfers: list.filter(isInternal).reduce((s, t) => s + amt(t), 0),
  };
}
