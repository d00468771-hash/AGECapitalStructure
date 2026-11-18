// capstruct.js: the finance math for the AGE capital structure app.
// Plain functions only. Nothing here touches the page, so every number can be
// checked with Node, for example:
//   node -e "const c=require('./capstruct.js'); console.log(c.roundHalfUp(0.14025*100,2))"

(function (root) {
  'use strict';

  // ---------- CSV ----------

  // Turns CSV text into an array of objects keyed by the header row.
  // Handles quoted fields (a note with a comma in it, for example).
  function parseCSV(text) {
    const rows = [];
    let field = '', row = [], inQuotes = false;
    const src = String(text).replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(f => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some(f => f.trim() !== '')) rows.push(row);
    if (rows.length === 0) return [];
    const header = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
      const obj = {};
      header.forEach((h, j) => { obj[h] = (r[j] === undefined ? '' : r[j].trim()); });
      return obj;
    });
  }

  // Reads a number from a CSV cell. A blank cell gives null.
  function num(cell) {
    if (cell === undefined || cell === null || String(cell).trim() === '') return null;
    const x = Number(cell);
    if (!Number.isFinite(x)) throw new Error('Not a number: "' + cell + '"');
    return x;
  }

  // item,value CSVs (assumptions.csv, example_firms.csv) -> { item: number }
  function toLookup(rows, keyCol, valueCol) {
    const out = {};
    rows.forEach(r => { out[r[keyCol || 'item'] || r.assumption] = num(r[valueCol || 'value']); });
    return out;
  }

  // cdss.csv has a section column; the item names are unique, so flatten it.
  function readCdss(rows) {
    const out = {};
    rows.forEach(r => { out[r.item] = num(r.value); });
    const need = ['sales', 'variable_cost_rate', 'fixed_costs', 'total_assets',
                  'shares_outstanding', 'share_price', 'management_share'];
    need.forEach(k => { if (out[k] === null || out[k] === undefined) throw new Error('cdss.csv is missing ' + k); });
    return out;
  }

  // banker_schedule.csv -> [{ debt, rd, rs }], sorted by debt.
  function readSchedule(rows) {
    const sched = rows.map(r => ({ debt: num(r.debt), rd: num(r.cost_of_debt), rs: num(r.cost_of_equity) }));
    sched.forEach(s => {
      if (s.debt === null) throw new Error('A schedule row has no amount of debt.');
      if (s.rs === null) throw new Error('No cost of equity at debt ' + s.debt + '.');
      if (s.debt > 0 && s.rd === null) throw new Error('No cost of debt at debt ' + s.debt + '.');
    });
    sched.sort((a, b) => a.debt - b.debt);
    return sched;
  }

  // ---------- Rounding and display ----------

  // Round half up on the decimal value. toFixed rounds the binary value and
  // gets 14.025 -> 14.02 wrong; this gives 14.03.
  function roundHalfUp(x, d) {
    const f = Math.pow(10, d);
    const scaled = Number((x * f).toPrecision(12));
    return (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / f;
  }

  function withCommas(x, d) {
    const r = roundHalfUp(Math.abs(x), d);
    const parts = r.toFixed(d).split('.'); // r is already rounded, so toFixed only pads
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (x < 0 && r !== 0 ? '-' : '') + parts.join('.');
  }

  const fmt = {
    dollars: x => (x < 0 ? '-$' + withCommas(-x, 0) : '$' + withCommas(x, 0)),
    // Costs shown in parentheses, as the case's income statements do.
    paren: x => '(' + withCommas(Math.abs(x), 0) + ')',
    cents: x => (x < 0 ? '-$' + withCommas(-x, 2) : '$' + withCommas(x, 2)),
    pct: x => withCommas(x * 100, 2) + '%',
    mult: x => withCommas(x, 2) + '×',
    two: x => withCommas(x, 2),
    shares: x => withCommas(x, 2),
  };

  // ---------- Statistics ----------

  // Probability-weighted mean, standard deviation and CV.
  function stats(probs, values) {
    const mean = probs.reduce((s, p, i) => s + p * values[i], 0);
    const variance = probs.reduce((s, p, i) => s + p * Math.pow(values[i] - mean, 2), 0);
    const sd = Math.sqrt(variance);
    return { mean, sd, cv: mean !== 0 ? sd / mean : null };
  }

  // ---------- Firm U and Firm L (question c) ----------

  // One firm's income statement in each kind of year, plus its ratios.
  // debt = 0 gives Firm U. TIE is null (shown "n/a") when there is no interest.
  function exampleFirm(opts) {
    const { totalAssets, debt, rate, tax, scenarios } = opts;
    const equity = totalAssets - debt;
    const interest = rate * debt;
    const years = scenarios.map(s => {
      const ebit = s.sales - s.operating_costs;
      const ebt = ebit - interest;
      const taxes = tax * ebt;
      const ni = ebt - taxes;
      return {
        probability: s.probability, sales: s.sales, operatingCosts: s.operating_costs,
        ebit, interest, ebt, taxes, ni,
        roe: ni / equity,
        tie: interest > 0 ? ebit / interest : null,
      };
    });
    const probs = years.map(y => y.probability);
    const roe = stats(probs, years.map(y => y.roe));
    const tie = interest > 0 ? stats(probs, years.map(y => y.tie)) : null;
    return { totalAssets, debt, equity, rate, interest, years, roe, tie };
  }

  // ---------- CDSS ----------

  function cdssEbit(c) {
    return c.sales * (1 - c.variable_cost_rate) - c.fixed_costs;
  }

  // Everything at one amount of borrowing, under both buyback methods.
  // c: cdss.csv values; row: { debt, rd, rs }; tax: T.
  function cdssAt(c, row, tax) {
    const n = c.shares_outstanding, P0 = c.share_price, A = c.total_assets;
    const D = row.debt, rd = row.rd || 0, rs = row.rs;
    const ebit = cdssEbit(c);
    const interest = rd * D;
    const ni = (ebit - interest) * (1 - tax);
    const tie = interest > 0 ? ebit / interest : null;

    // Case method: buy back at today's price P0.
    const caseRep = D / P0;
    const caseRem = n - caseRep;
    const caseEps = ni / caseRem;
    const casePrice = caseEps / rs;
    const waccBook = (D / A) * rd * (1 - tax) + ((A - D) / A) * rs;

    // New-price method: buy back at the price after the announcement.
    const S = ni / rs;
    const V = S + D;
    const P = V / n;
    const newRep = D / P;
    const newRem = n - newRep;
    const newEps = ni / newRem;
    const waccMarket = (D / V) * rd * (1 - tax) + (S / V) * rs;

    return {
      debt: D, rd: row.rd, rs, ebit, interest, ni, tie,
      caseMethod: {
        repurchased: caseRep, remaining: caseRem, eps: caseEps, dps: caseEps,
        price: casePrice, wacc: waccBook,
      },
      newPrice: {
        equityValue: S, firmValue: V, repurchased: newRep, remaining: newRem,
        eps: newEps, dps: newEps, price: P, wacc: waccMarket,
        // Checks from CLAUDE.md: EPS = r_s × P and WACC = EBIT(1 − T) / V.
        epsCheck: rs * P,
        waccCheck: ebit * (1 - tax) / V,
      },
    };
  }

  function cdssTable(c, schedule, tax) {
    return schedule.map(row => cdssAt(c, row, tax));
  }

  // Index of the best row by a key. Exact ties go to the smaller debt
  // (rows are sorted by debt, so the first one found wins).
  function bestIndex(rows, key, wantMax) {
    let best = 0;
    for (let i = 1; i < rows.length; i++) {
      const v = key(rows[i]), b = key(rows[best]);
      if (wantMax ? v > b : v < b) best = i;
    }
    return best;
  }

  function bests(rows) {
    return {
      casePrice: bestIndex(rows, r => r.caseMethod.price, true),
      newPrice: bestIndex(rows, r => r.newPrice.price, true),
      caseEps: bestIndex(rows, r => r.caseMethod.eps, true),
      newEps: bestIndex(rows, r => r.newPrice.eps, true),
      bookWacc: bestIndex(rows, r => r.caseMethod.wacc, false),
      marketWacc: bestIndex(rows, r => r.newPrice.wacc, false),
    };
  }

  // Close enough to call equal (for the checks, not for display).
  function near(a, b, tol) {
    return Math.abs(a - b) <= (tol || 1e-9) * Math.max(1, Math.abs(a), Math.abs(b));
  }

  const api = {
    parseCSV, num, toLookup, readCdss, readSchedule,
    roundHalfUp, fmt, stats, exampleFirm, cdssEbit, cdssAt, cdssTable,
    bestIndex, bests, near,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CapStruct = api;
})(typeof self !== 'undefined' ? self : this);
