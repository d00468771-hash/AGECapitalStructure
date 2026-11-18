// app.js: reads the CSV files in data/ and fills in the page.
// The finance math lives in capstruct.js (window.CapStruct).

(function () {
  'use strict';
  const C = window.CapStruct;
  const f = C.fmt;
  const $ = id => document.getElementById(id);

  function esc(s) {
    return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  async function loadCSV(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not read ' + path + ' (' + res.status + ')');
    return C.parseCSV(await res.text());
  }

  // ---------- Firm U and Firm L ----------

  function firmTable(firm, tax) {
    const yrs = firm.years;
    const cells = fn => yrs.map(y => '<td>' + fn(y) + '</td>').join('');
    const middle = val => '<td></td><td>' + val + '</td><td></td>';
    const rows = [
      ['Assets', cells(() => f.dollars(firm.totalAssets))],
      ['Equity', cells(() => f.dollars(firm.equity))],
      ['Probability', cells(y => f.two(y.probability))],
      ['Sales', cells(y => f.dollars(y.sales))],
      ['Oper. costs', cells(y => f.paren(y.operatingCosts))],
      ['EBIT', cells(y => f.dollars(y.ebit)), 'total'],
      ['Interest', cells(y => f.paren(y.interest))],
      ['EBT', cells(y => f.dollars(y.ebt))],
      ['Taxes (' + f.pct(tax).replace('.00', '') + ')', cells(y => f.paren(y.taxes))],
      ['Net income', cells(y => f.dollars(y.ni)), 'total'],
      ['ROE', cells(y => f.pct(y.roe))],
      ['TIE', cells(y => (y.tie === null ? 'n/a' : f.mult(y.tie)))],
      ['E(ROE)', middle(f.pct(firm.roe.mean)), 'stat'],
      ['σ(ROE)', middle(f.pct(firm.roe.sd)), 'stat'],
      ['CV(ROE)', middle(f.two(firm.roe.cv)), 'stat'],
      ['E(TIE)', middle(firm.tie ? f.mult(firm.tie.mean) : 'n/a'), 'stat'],
      ['σ(TIE)', middle(firm.tie ? f.mult(firm.tie.sd) : 'n/a'), 'stat'],
    ];
    const head = '<thead><tr><th>Year</th><th>Bad</th><th>Average</th><th>Good</th></tr></thead>';
    return head + '<tbody>' + rows.map(r =>
      '<tr' + (r[2] ? ' class="' + r[2] + '"' : '') + '><td>' + r[0] + '</td>' + r[1] + '</tr>').join('') + '</tbody>';
  }

  // ---------- CDSS ----------

  const COLS = [
    ['Debt', r => f.dollars(r.debt)],
    ['r<sub>d</sub>', r => (r.rd === null ? '—' : f.pct(r.rd))],
    ['r<sub>s</sub>', r => f.pct(r.rs)],
    ['Shares repurchased', (r, m) => f.shares(m.repurchased)],
    ['Shares remaining', (r, m) => f.shares(m.remaining)],
    ['EPS', (r, m) => f.cents(m.eps)],
    ['TIE', r => (r.tie === null ? 'n/a' : f.mult(r.tie))],
    ['Share price', (r, m) => f.cents(m.price)],
    ['WACC', (r, m) => f.pct(m.wacc)],
  ];

  function cdssTable(rows, method, bestPriceIdx, waccLabel, selIdx) {
    const plain = h => h.replace(/<[^>]+>/g, '');
    const head = '<thead><tr>' + COLS.map(c =>
      '<th scope="col">' + (c[0] === 'WACC' ? 'WACC (' + waccLabel + ')' : c[0]) + '</th>').join('') + '</tr></thead>';
    const body = rows.map((r, i) => {
      const m = r[method];
      const classes = [i === bestPriceIdx ? 'best' : '', i === selIdx ? 'selected' : ''].filter(Boolean);
      const cls = classes.length ? ' class="' + classes.join(' ') + '"' : '';
      return '<tr' + cls + '>' + COLS.map((c, j) => {
        let v = c[1](r, m);
        if (j === 0 && i === bestPriceIdx) v += '<span class="flag">highest price</span>';
        if (j === 0 && i === selIdx) v += '<span class="flag sel">◀ slider</span>';
        const label = c[0] === 'WACC' ? 'WACC (' + waccLabel + ')' : plain(c[0]);
        return '<td data-label="' + esc(label) + '">' + v + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return head + '<tbody>' + body + '</tbody>';
  }

  function checks(cdss, rows) {
    const out = [];
    const p0 = rows[0];
    if (p0.debt !== 0) {
      out.push('<div class="warning">The schedule has no $0 row, so the app can\'t check today\'s price.</div>');
    } else if (!C.near(p0.caseMethod.price, cdss.share_price, 1e-6)) {
      out.push('<div class="warning"><strong>Check failed:</strong> at $0 of debt, EPS / r<sub>s</sub> = ' +
        f.cents(p0.caseMethod.eps) + ' / ' + f.pct(p0.rs) + ' = ' + f.cents(p0.caseMethod.price) +
        ', but cdss.csv says today\'s price is ' + f.cents(cdss.share_price) + '. The schedule and the case data don\'t agree.</div>');
    } else {
      out.push('<p class="ok">✓ Check: at $0 of debt, EPS / r<sub>s</sub> = ' + f.cents(p0.caseMethod.eps) + ' / ' +
        f.pct(p0.rs) + ' = ' + f.cents(p0.caseMethod.price) + ', today\'s price in cdss.csv.</p>');
    }
    const bad = rows.filter(r => !C.near(r.newPrice.eps, r.newPrice.epsCheck, 1e-9) ||
                                 !C.near(r.newPrice.wacc, r.newPrice.waccCheck, 1e-9));
    if (bad.length) {
      out.push('<div class="warning"><strong>Check failed</strong> for the new-price method at ' +
        bad.map(r => f.dollars(r.debt)).join(', ') + ': EPS should equal r<sub>s</sub> × P and WACC should equal EBIT(1 − T) / V.</div>');
    } else {
      out.push('<p class="ok">✓ Check: under the new-price method, EPS = r<sub>s</sub> × P and market-weight WACC = EBIT(1 − T) / V at every amount of debt.</p>');
    }
    return out.join('');
  }

  function summary(rows) {
    const b = C.bests(rows);
    const d = i => f.dollars(rows[i].debt);
    const items = [
      'Highest share price, case method: <strong>' + d(b.casePrice) + '</strong> (' + f.cents(rows[b.casePrice].caseMethod.price) + ')',
      'Highest share price, new-price method: <strong>' + d(b.newPrice) + '</strong> (' + f.cents(rows[b.newPrice].newPrice.price) + ')',
      'Lowest WACC, book weights: <strong>' + d(b.bookWacc) + '</strong> (' + f.pct(rows[b.bookWacc].caseMethod.wacc) + ')',
      'Lowest WACC, market weights: <strong>' + d(b.marketWacc) + '</strong> (' + f.pct(rows[b.marketWacc].newPrice.wacc) + ')',
      'Highest EPS, case method: <strong>' + d(b.caseEps) + '</strong> (' + f.cents(rows[b.caseEps].caseMethod.eps) + ')',
      'Highest EPS, new-price method: <strong>' + d(b.newEps) + '</strong> (' + f.cents(rows[b.newEps].newPrice.eps) + ')',
    ];
    const four = [b.casePrice, b.newPrice, b.bookWacc, b.marketWacc];
    const agree = four.every(i => i === four[0]);
    const verdict = agree
      ? '<p>Both buyback methods give the highest price at <strong>' + d(four[0]) + '</strong>, and both sets of WACC weights are lowest there too.</p>'
      : '<div class="warning">The price and WACC measures don\'t all point to the same amount of debt, so the app doesn\'t pick one. Compare the lines above.</div>';
    return '<h3 style="margin-top:0">Which amount of debt?</h3>' + verdict + '<ul>' + items.map(i => '<li>' + i + '</li>').join('') + '</ul>';
  }

  // ---------- CDSS debt lever ----------

  function stakeCell(cdss, m) {
    const s = C.managementStake(cdss.management_share, cdss.shares_outstanding, m.repurchased, m.remaining);
    if (s.status === 'ok') return f.pct(s.stake);
    if (s.status === 'all') return f.pct(1) + ' *';
    return '⚠ would have to sell';
  }

  function stakeNotes(cdss, r) {
    const out = [];
    [['case method', r.caseMethod], ['new-price method', r.newPrice]].forEach(([name, m]) => {
      const s = C.managementStake(cdss.management_share, cdss.shares_outstanding, m.repurchased, m.remaining);
      if (s.status === 'all') {
        out.push('<p class="note">* Under the ' + name + ', the buyback takes exactly the outside investors\' ' +
          f.shares((1 - cdss.management_share) * cdss.shares_outstanding) + ' shares, so no outside shareholders would be left.</p>');
      } else if (s.status === 'sell') {
        out.push('<div class="warning">Under the ' + name + ', the buyback needs ' + f.shares(m.repurchased) +
          ' shares, more than the ' + f.shares((1 - cdss.management_share) * cdss.shares_outstanding) +
          ' that outside investors own, so management would have to sell.</div>');
      }
    });
    return out.join('');
  }

  function leverTable(cdss, r) {
    const a = r.caseMethod, b = r.newPrice;
    const tie = r.tie === null ? 'n/a' : f.mult(r.tie);
    const rows = [
      ['Share price', f.cents(a.price), f.cents(b.price)],
      ['Shares repurchased', f.shares(a.repurchased), f.shares(b.repurchased)],
      ['Shares remaining', f.shares(a.remaining), f.shares(b.remaining)],
      ['EPS', f.cents(a.eps), f.cents(b.eps)],
      ['Dividends per share', f.cents(a.dps), f.cents(b.dps)],
      ['TIE', tie, tie],
      ['WACC', f.pct(a.wacc) + ' <span class="tag">book</span>', f.pct(b.wacc) + ' <span class="tag">market</span>'],
      ['Management\'s share', stakeCell(cdss, a), stakeCell(cdss, b)],
    ];
    return '<thead><tr><th></th><th>Buy back at ' + f.cents(cdss.share_price) + ' (case)</th><th>Buy back at new price</th></tr></thead><tbody>' +
      rows.map(x => '<tr><td>' + x[0] + '</td><td>' + x[1] + '</td><td>' + x[2] + '</td></tr>').join('') + '</tbody>';
  }

  // ---------- Firm L lever ----------

  function firmCompare(u, l) {
    const both = (fu, fl) => 'U ' + fu + ' · L ' + fl;
    const tieMean = x => (x.tie ? f.mult(x.tie.mean) : 'n/a');
    const tieSd = x => (x.tie ? f.mult(x.tie.sd) : 'n/a');
    const items = [
      ['E(ROE)', both(f.pct(u.roe.mean), f.pct(l.roe.mean))],
      ['σ(ROE)', both(f.pct(u.roe.sd), f.pct(l.roe.sd))],
      ['CV(ROE)', both(f.two(u.roe.cv), f.two(l.roe.cv))],
      ['E(TIE)', both(tieMean(u), tieMean(l))],
      ['σ(TIE)', both(tieSd(u), tieSd(l))],
    ];
    return items.map(x => '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>').join('');
  }

  // ---------- Start ----------

  async function main() {
    try {
      const [assumptions, cdssRows, schedRows, firmRows, scenRows] = await Promise.all([
        loadCSV('data/assumptions.csv'),
        loadCSV('data/cdss.csv'),
        loadCSV('data/banker_schedule.csv'),
        loadCSV('data/example_firms.csv'),
        loadCSV('data/ebit_scenarios.csv'),
      ]);
      const tax = C.toLookup(assumptions, 'assumption').tax_rate;
      if (tax === null || tax === undefined) throw new Error('assumptions.csv has no tax_rate.');
      const cdss = C.readCdss(cdssRows);
      const schedule = C.readSchedule(schedRows);
      const ex = C.toLookup(firmRows);
      const scenarios = scenRows.map(r => ({
        probability: C.num(r.probability), sales: C.num(r.sales), operating_costs: C.num(r.operating_costs),
      }));

      // Firm U and Firm L
      const firmU = C.exampleFirm({ totalAssets: ex.total_assets, debt: 0, rate: ex.interest_rate, tax, scenarios });
      $('firm-u').innerHTML = firmTable(firmU, tax);
      const rateTxt = f.pct(ex.interest_rate).replace('.00', '');
      const stops = C.sliderStops(ex.slider_max, ex.slider_step);
      const fs = $('firm-slider');
      fs.max = String(stops.length - 1);
      function setFirmDebt(i) {
        fs.value = String(i);
        const firmL = C.exampleFirm({ totalAssets: ex.total_assets, debt: stops[i], rate: ex.interest_rate, tax, scenarios });
        $('firm-debt-out').textContent = f.dollars(firmL.debt);
        $('firm-l').innerHTML = firmTable(firmL, tax);
        $('firm-l-tag').textContent = f.dollars(firmL.debt) + ' of ' + rateTxt + ' debt';
        $('firm-compare').innerHTML = firmCompare(firmU, firmL);
        fs.setAttribute('aria-valuetext', f.dollars(firmL.debt));
      }
      fs.addEventListener('input', () => setFirmDebt(Number(fs.value)));
      const caseStop = stops.findIndex(d => C.near(d, ex.firm_l_debt));
      $('btn-case').textContent = 'Case (' + f.dollars(ex.firm_l_debt) + ')';
      $('btn-case').addEventListener('click', () => setFirmDebt(caseStop >= 0 ? caseStop : 0));
      $('firm-rate-note').textContent = 'The interest rate is held at ' + rateTxt +
        ' at every amount of debt, so the slider shows what debt does to Firm L\'s return and risk, not how lenders would respond.';
      setFirmDebt(caseStop >= 0 ? caseStop : 0);
      $('firms-note').textContent = 'Both firms have ' + f.dollars(ex.total_assets) + ' of assets and a ' +
        f.pct(tax).replace('.00', '') + ' tax rate. Bad, average and good years have the probabilities in ebit_scenarios.csv.';
      $('firms').hidden = false;

      // CDSS
      const rows = C.cdssTable(cdss, schedule, tax);
      const b = C.bests(rows);
      const facts = [
        ['EBIT', f.dollars(C.cdssEbit(cdss))],
        ['Shares outstanding (n)', f.shares(cdss.shares_outstanding).replace('.00', '')],
        ['Today\'s price (P₀)', f.cents(cdss.share_price)],
        ['Book assets (A)', f.dollars(cdss.total_assets)],
        ['Tax rate (T)', f.pct(tax)],
      ];
      $('cdss-facts').innerHTML = facts.map(x => '<div><dt>' + x[0] + '</dt><dd>' + x[1] + '</dd></div>').join('');
      $('p0').textContent = f.cents(cdss.share_price);
      $('checks').innerHTML = checks(cdss, rows);
      $('summary').innerHTML = summary(rows);

      const cs = $('cdss-slider');
      cs.max = String(rows.length - 1);
      function setCdssDebt(i, note) {
        cs.value = String(i);
        const r = rows[i];
        $('cdss-debt-out').textContent = f.dollars(r.debt);
        cs.setAttribute('aria-valuetext', f.dollars(r.debt));
        $('lever-table').innerHTML = leverTable(cdss, r);
        $('stake-note').innerHTML = stakeNotes(cdss, r);
        $('pick-note').innerHTML = note || '';
        $('case-table').innerHTML = cdssTable(rows, 'caseMethod', b.casePrice, 'book weights', i);
        $('new-table').innerHTML = cdssTable(rows, 'newPrice', b.newPrice, 'market weights', i);
      }
      function go(what, caseIdx, newIdx) {
        const p = C.pickDebt(caseIdx, newIdx);
        const note = p.agree ? '' :
          '<div class="warning">' + what + ': the $20 buyback picks ' + f.dollars(rows[p.caseIdx].debt) +
          ' and the new-price buyback picks ' + f.dollars(rows[p.newIdx].debt) + '. The slider is at the case method\'s amount.</div>';
        setCdssDebt(p.index, note);
      }
      cs.addEventListener('input', () => setCdssDebt(Number(cs.value)));
      $('btn-best').addEventListener('click', () => go('Highest share price', b.casePrice, b.newPrice));
      $('btn-eps').addEventListener('click', () => go('Highest EPS', b.caseEps, b.newEps));
      setCdssDebt(0);
      $('cdss').hidden = false;

      $('status').textContent = '';
    } catch (err) {
      const s = $('status');
      s.classList.add('error');
      s.textContent = 'The app couldn\'t load its data: ' + err.message;
    }
  }

  main();

  // Register the service worker so the app installs and works offline.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works without it */ });
    });
  }
})();
