/* =====================================================================
   ISKAMDAR | analytics.js
   The interface for analytics.html. Data and statistics come from
   analytics-data.js (window.IskamdarData); charts use Chart.js.

   1.  Setup, state, helpers
   2.  Tabs, filters, "what is this?" panels
   3.  Overview
   4.  Risk & evidence (incl. the 3D explorer)
   5.  Model lab
   6.  Playground
   7.  Report
   8.  Boot
   ===================================================================== */
(function () {
  'use strict';

  const D = window.IskamdarData;
  if (!D || !window.Chart) { console.error('Analytics: data module or Chart.js missing.'); return; }

  /* ---------------------------------------------------------------
     1. Setup, state, helpers
     --------------------------------------------------------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const css = getComputedStyle(document.documentElement);
  const tok = (n, f) => (css.getPropertyValue(n).trim() || f);

  const COLOR = {
    low: tok('--green', '#1f9d57'), medium: tok('--amber', '#f5a524'), high: tok('--red', '#ee1c25'),
    textual: '#1a5fa8', structural: '#f5a524', behavioral: '#f26d67',
    ink: tok('--ink', '#0e1a2b'), muted: tok('--muted', '#6b7388'), line: '#e8eaf0', blue: tok('--blue', '#1a5fa8'),
    sky: '#7db1e6', navy: '#1b2039',
    input: { text: '#7db1e6', link: '#1a5fa8', both: '#1b2039' },
  };
  const LEVEL_NAME = { low: 'Low risk', medium: 'Suspicious', high: 'High risk' };
  const INPUT_NAME = { text: 'Text', link: 'Link', both: 'Text + link' };
  const OUTCOME_NAME = { scored: 'Scored', unexamined: 'Could not examine', rejected: 'Rejected' };
  const LIVE_KEY = 'iskamdar.analytics.live.v1';
  const TABS = ['overview', 'risk', 'model', 'playground', 'report'];

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  Chart.defaults.font.family = '"Poppins", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';
  Chart.defaults.font.size = 11.5;
  Chart.defaults.color = '#6b7388';
  Chart.defaults.animation = reduceMotion ? false : { duration: 650, easing: 'easeOutCubic' };
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = '#0e1a2b';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.titleFont = { weight: '600', size: 12 };
  Chart.defaults.plugins.tooltip.boxPadding = 4;

  const state = {
    tab: 'overview',
    filters: { days: 7, input: 'all', level: 'all' },
    now: Date.now(),
    sim: [],
    live: [],
    log: [],
    test: D.generateTestSet(),
    evals: null,
    cfg: 2,
    thr: 0.5,
    metric: 'total',
    pg: { mode: 'signs', sel: new Set(), layers: { textual: 0, structural: 0, behavioral: 0 } },
    rendered: {},
  };
  state.evals = D.evaluateAll(state.test);
  state.thr = state.evals[state.cfg].thr;

  const charts = {};
  /** Creates a chart, or updates the one already on this canvas. A failing chart never stops the others. */
  function chart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas) return null;
    try {
      const old = charts[id];
      if (old && old.canvas === canvas && old.config.type === config.type) {
        old.data = config.data;
        old.options = config.options;
        old.update();
        return old;
      }
      if (old) { old.destroy(); delete charts[id]; }
      charts[id] = new Chart(canvas, config);
      return charts[id];
    } catch (err) {
      console.error('Analytics: the chart "' + id + '" could not be drawn.', err);
      return null;
    }
  }
  /** True when nothing has been painted on the canvas. */
  function isBlank(canvas) {
    try {
      const w = canvas.width; const h = canvas.height;
      if (!w || !h) return true;
      const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 0) return false;
      return true;
    } catch { return false; } // cannot read it: assume it is fine
  }
  /** Safety net: repaint every visible chart, and rebuild any that are still blank. */
  function redrawAll(allowRebuild) {
    let rebuilt = false;
    Object.keys(charts).forEach((id) => {
      const c = charts[id];
      if (!c || !c.canvas || !c.canvas.isConnected || !c.canvas.offsetParent) return;
      try {
        c.resize();
        c.update('none'); // update always repaints, resize alone does not when the size is unchanged
        if (allowRebuild && isBlank(c.canvas)) { c.destroy(); delete charts[id]; rebuilt = true; }
      } catch (err) { console.error('Analytics: redraw failed for ' + id, err); }
    });
    if (rebuilt) { console.warn('Analytics: some charts were blank, drawing them again.'); render(true); }
  }
  function scheduleRedraw() {
    requestAnimationFrame(() => redrawAll(false));
    clearTimeout(scheduleRedraw.t1); clearTimeout(scheduleRedraw.t2); clearTimeout(scheduleRedraw.t3);
    scheduleRedraw.t1 = setTimeout(() => redrawAll(false), 200);
    scheduleRedraw.t2 = setTimeout(() => redrawAll(true), 1000);
    scheduleRedraw.t3 = setTimeout(() => redrawAll(true), 2200);
  }
  function killCharts() { Object.keys(charts).forEach((k) => { charts[k].destroy(); delete charts[k]; }); }

  const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
  const f2 = (x) => x.toFixed(2);
  const dayLabel = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const signLabel = (id) => D.SIGN_BY_ID[id].label;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const layerColor = (id) => COLOR[D.SIGN_BY_ID[id].layer];
  const heat = (v, max) => { // blue scale for heatmap cells
    const t = Math.max(0, Math.min(1, v / (max || 1)));
    return { bg: `rgba(26, 95, 168, ${0.1 + t * 0.85})`, fg: t > 0.42 ? '#fff' : '#0e1a2b' };
  };

  const tip = $('#an-tip');
  function showTip(html, x, y) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 14) + 'px';
    tip.style.top = Math.max(8, y - r.height - 10) + 'px';
  }
  function hideTip() { tip.hidden = true; }

  function toast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('is-visible');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('is-visible'), 2600);
  }

  /* live scans recorded by script.js in this browser */
  function loadLive() {
    let raw = [];
    try { raw = JSON.parse(localStorage.getItem(LIVE_KEY) || '[]'); } catch { raw = []; }
    if (!Array.isArray(raw)) raw = [];
    return raw.filter((r) => r && Number.isFinite(r.ts) && ['text', 'link', 'both'].includes(r.inputType)
      && ['scored', 'unexamined', 'rejected'].includes(r.outcome)).slice(-500).map((r, i) => {
      const signs = Array.isArray(r.signs) ? r.signs.filter((id) => D.SIGN_BY_ID[id]) : [];
      const scored = r.outcome === 'scored';
      const score = scored ? D.scoreOf(signs) : null;
      return {
        id: 'L' + i, ts: r.ts, inputType: r.inputType, outcome: r.outcome, signs: scored ? signs : [],
        score, level: scored ? D.levelOf(score) : null, layers: scored ? D.layerScores(signs) : null,
        failure: r.outcome === 'unexamined' ? (r.failure || 'Timeout or error') : null,
        ms: Math.max(0, Math.round(r.ms || 0)), live: true,
      };
    });
  }
  function buildLog() {
    state.live = loadLive();
    state.log = state.sim.concat(state.live).sort((a, b) => a.ts - b.ts);
    const chip = $('#an-live-chip');
    chip.hidden = !state.live.length;
    chip.textContent = state.live.length + (state.live.length === 1 ? ' live scan' : ' live scans') + ' from this browser';
    const clr = $('#rp-clear'); if (clr) clr.hidden = !state.live.length;
  }

  const rowsNow = () => D.applyFilters(state.log, state.filters, state.now);
  const rowsPrev = () => D.applyFilters(state.log, state.filters, state.now - state.filters.days * D.DAY);

  /* ---------------------------------------------------------------
     2. Tabs, filters, explain panels
     --------------------------------------------------------------- */
  const HERO = {
    overview: ['Scam scan analytics.', 'See how Philippine job and investment offers are scored across the textual, structural and behavioral layers. Filter the data, compare configurations and click any section header to learn what it shows.'],
    risk: ['How scans get their score.', 'Each warning sign raises the risk. Scores under 30 are low risk, 30 to 69 are suspicious and 70 or more are high risk.'],
    model: ['Does adding layers help?', 'Three configurations are scored on a labeled test set of 400 held-out messages. Each one can use more layers than the one before.'],
    playground: ['Try the scoring yourself.', 'Tick the warning signs a message shows and watch the 0 to 100 score change, using the same weights as the prototype.'],
    report: ['Key findings.', 'The main findings for the current selection, ready to export for the class presentation or the thesis.'],
  };
  const FILTER_TABS = new Set(['overview', 'risk', 'report']);

  const EXPLAIN = {
    activity: '<strong>What you see.</strong> Each bar is one day. Its height is the number of scans that received a score, split by risk level (green low, amber suspicious, red high).<ul><li><strong>Method:</strong> descriptive statistics, counts grouped by day and level.</li><li><strong>Why it matters:</strong> a rising red share tells the team that scammers are sending more convincing offers, or that more at-risk people are using the tool.</li></ul>',
    journey: '<strong>What you see.</strong> A Sankey diagram follows every scan from the type of input, to what happened to it, to the final risk level. A thicker band means more scans.<ul><li><strong>Method:</strong> flow counts (a funnel across two stages).</li><li><strong>Why it matters:</strong> it shows where scans are lost. "Could not examine" means a link could not be opened safely, so no page-level evidence was available.</li></ul>',
    trends: '<strong>What you see.</strong> The line follows one metric for the last 30 days. The bars compare the average risk score for each weekday, and the last chart compares how long each input type takes.<ul><li><strong>Method:</strong> time-series aggregation and group means.</li><li><strong>Why it matters:</strong> links take about ten times longer than plain text because the page is opened and watched, which is useful for setting user expectations.</li></ul>',
    latest: '<strong>What you see.</strong> The newest scan events. Only metadata is logged: input type, outcome, score and warning signs. No message text and no URLs are stored.<ul><li><strong>Method:</strong> event log.</li><li><strong>Live scans:</strong> scans you run on this site in this browser are added here with a LIVE tag.</li></ul>',
    distribution: '<strong>What you see.</strong> The histogram counts scored scans in ten score bands. The dotted lines mark the 30 and 70 cut-offs. The grouped bars show how strongly each layer fires at each risk level.<ul><li><strong>Method:</strong> frequency distribution and group means of the layer scores.</li><li><strong>Layer score:</strong> for one layer, <code>1 − (1 − w₁)(1 − w₂)…</code> over only that layer\'s warning signs, from 0 to 1.</li></ul>',
    explorer: '<strong>What you see.</strong> Every scored scan is a point. Its position comes from the three layer scores: textual, structural and behavioral. Red diamonds are high-risk scans whose wording looks clean.<ul><li><strong>Method:</strong> 3D scatter plot and a Pearson correlation matrix.</li><li><strong>Why it matters:</strong> the diamonds are scams that a text-only checker would miss. Low correlation between layers means each one adds information the others do not.</li></ul>',
    flagged: '<strong>What you see.</strong> How often each warning sign appears in suspicious and high-risk scans, colored by the layer it belongs to. The heatmap shows how the same signs are spread across the three risk levels.<ul><li><strong>Method:</strong> prevalence (share of flagged scans that contain the sign).</li><li><strong>Why it matters:</strong> it tells the team which signs to explain first on the Scam Trends page.</li></ul>',
    unexamined: '<strong>What you see.</strong> When a link cannot be examined, the system does not guess. These bars show why. The donut shows all outcomes together.<ul><li><strong>Method:</strong> failure-reason breakdown.</li><li><strong>Why it matters:</strong> a large "timeout or error" share points to a fix on the scanning server, not to scammers.</li></ul>',
    configs: '<strong>What you see.</strong> The same 400 labeled test messages are scored three times: with the textual layer only, then with the structural layer added, then with the behavioral layer added. The decision threshold turns a score into "scam" or "legit".<ul><li><strong>Accuracy</strong> is the share of correct calls. <strong>Precision</strong> is how many flagged messages are really scams. <strong>Recall</strong> is how many scams were caught. <strong>F1</strong> balances precision and recall.</li><li>The confusion matrix counts true and false positives and negatives. <strong>Tuned threshold</strong> is the one with the best F1.</li></ul>',
    thesis: '<strong>What you see.</strong> The thesis question: does adding page structure and behavior help? F1 bars compare the three configurations. The ROC curve plots catch rate against false alarms, and AUC is the area under it (1.0 is perfect, 0.5 is a coin toss).<ul><li><strong>Text-evasive scams</strong> are polished scams whose wording looks clean. This is the case the structural and behavioral layers were built for.</li></ul>',
    profiles: '<strong>What you see.</strong> Five measures for each configuration on one radar chart and in a table. The best value in each row is highlighted.<ul><li><strong>Method:</strong> multi-metric comparison.</li></ul>',
    playground: '<strong>What you see.</strong> The same scoring the prototype uses. Each warning sign has a weight between 0 and 1. Ticked signs combine as <code>1 − (1 − w₁)(1 − w₂)…</code>, so more signs push the score up but never past 99.<ul><li><strong>Layer sliders</strong> set each layer\'s strength directly instead of ticking individual signs.</li></ul>',
    findings: '<strong>What you see.</strong> Plain-language results written from the numbers on the other tabs. They change when you change the filters.<ul><li>Export the page as a PDF, download the anonymous log as CSV, or copy the summary as text.</li></ul>',
  };

  function setTab(tab, push = true) {
    if (!TABS.includes(tab)) tab = 'overview';
    state.tab = tab;
    $$('#an-tabs [role=tab]').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    TABS.forEach((t) => { $('#view-' + t).hidden = t !== tab; });
    $('#an-title').textContent = HERO[tab][0];
    $('#an-lead').textContent = HERO[tab][1];
    $('#an-filters-wrap').hidden = !FILTER_TABS.has(tab);
    document.title = HERO[tab][0].replace(/\.$/, '') + ' | ISKAMDAR Analytics';
    if (push && location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
    hideTip();
    explorer.active = tab === 'risk';
    render();
  }

  function syncFilterUi() {
    $$('.an-seg[data-filter]').forEach((seg) => {
      const cur = String(state.filters[seg.dataset.filter]);
      $$('button', seg).forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.v === cur)); b.tabIndex = b.dataset.v === cur ? 0 : -1; });
    });
    const dirty = state.filters.days !== 7 || state.filters.input !== 'all' || state.filters.level !== 'all';
    $('#an-reset').hidden = !dirty;
  }

  /* ---------------------------------------------------------------
     3. Overview
     --------------------------------------------------------------- */
  function sparkline(values, color) {
    const w = 84; const h = 34; const pad = 3;
    if (values.length < 2) return '';
    const mn = Math.min(...values); const mx = Math.max(...values); const span = mx - mn || 1;
    const pts = values.map((v, i) => [pad + (i * (w - pad * 2)) / (values.length - 1), h - pad - ((v - mn) / span) * (h - pad * 2)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${color}"/></svg>`;
  }

  function countUp(el, to, fmt) {
    if (reduceMotion) { el.textContent = fmt(to); return; }
    const t0 = performance.now(); const dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(to * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function deltaPill(cur, prev, kind) {
    // kind: pct (relative), pts (percentage points), abs (number), secs
    if (kind === 'out100') return { text: 'out of 100', cls: '' };
    if (!prev && !cur) return { text: 'no data', cls: '' };
    let text; let good = null;
    if (kind === 'pct') { const d = prev ? (cur - prev) / prev : 0; text = (d >= 0 ? '+' : '') + (d * 100).toFixed(1) + '% vs prior'; good = null; }
    else if (kind === 'ptsDown') { const d = (cur - prev) * 100; text = (d >= 0 ? '+' : '') + d.toFixed(1) + ' pts vs prior'; good = d <= 0; }
    else if (kind === 'ptsUp') { const d = (cur - prev) * 100; text = (d >= 0 ? '+' : '') + d.toFixed(1) + ' pts vs prior'; good = d >= 0; }
    else if (kind === 'out100') { text = 'out of 100'; }
    else { const d = (cur - prev) / 1000; text = (d >= 0 ? '+' : '') + d.toFixed(1) + 's vs prior'; good = d <= 0; }
    return { text, cls: good === null ? '' : good ? 'is-good' : 'is-bad' };
  }

  function renderOverview() {
    const rows = rowsNow(); const prev = rowsPrev();
    const k = D.kpis(rows); const kp = D.kpis(prev);
    const e = state.evals;

    // thesis banner
    $('#th-text').textContent = f2(e[0].f1);
    $('#th-all').textContent = f2(e[2].f1);
    $('#th-evasive').textContent = pct(e[2].recallEvasive);
    $('#th-evasive-sub').textContent = `Polished scams with clean text, against ${pct(e[0].recallEvasive)} with text alone.`;

    // KPIs
    const days = D.byDay(rows, state.filters.days, state.now);
    const defs = [
      { key: 'total', label: 'Total scans', color: '#1a5fa8', val: k.total, fmt: (v) => Math.round(v).toLocaleString(), series: days.map((d) => d.total), d: deltaPill(k.total, kp.total, 'pct') },
      { key: 'highShare', label: 'High-risk share', color: '#ee1c25', val: k.highShare, fmt: (v) => pct(v), series: days.map((d) => d.highShare), d: deltaPill(k.highShare, kp.highShare, 'ptsDown') },
      { key: 'avgScore', label: 'Average risk score', color: '#6a4fd8', val: k.avgScore, fmt: (v) => Math.round(v), series: days.map((d) => d.avgScore), d: deltaPill(0, 0, 'out100') },
      { key: 'completion', label: 'Completion rate', color: '#1f9d57', val: k.completion, fmt: (v) => pct(v), series: days.map((d) => d.completion), d: deltaPill(k.completion, kp.completion, 'ptsUp') },
      { key: 'avgMs', label: 'Avg response time', color: '#f5a524', val: k.avgMs, fmt: (v) => (v / 1000).toFixed(1) + 's', series: days.map((d) => d.avgMs), d: deltaPill(k.avgMs, kp.avgMs, 'secs') },
    ];
    $('#an-kpis').innerHTML = defs.map((d, i) => `<article class="an-kpi" style="--k:${d.color}"><span class="an-kpi__label">${d.label}</span><div class="an-kpi__row"><strong class="an-kpi__value" data-i="${i}">${d.fmt(d.val)}</strong>${sparkline(d.series, d.color)}</div><span class="an-delta-pill ${d.d.cls}">${d.d.text}</span></article>`).join('');
    $$('.an-kpi__value').forEach((el) => countUp(el, defs[+el.dataset.i].val, defs[+el.dataset.i].fmt));

    const hi = k.highShare; const clean = D.cleanTextShare(rows);
    $('#ov-takeaway').textContent = rows.length
      ? `High-risk scans are ${pct(hi)} of scored scans in the last ${state.filters.days} days. ${pct(clean)} of the high-risk scans with a text part have clean-looking wording, so the other layers caught them.`
      : 'No scans match these filters. Try a wider date range or reset the filters.';

    // 01 stacked bars + donut
    chart('ch-stack', {
      type: 'bar',
      data: {
        labels: days.map((d) => dayLabel(d.day)),
        datasets: [
          { label: 'Low risk', data: days.map((d) => d.low), backgroundColor: COLOR.low, borderRadius: 0, maxBarThickness: 46 },
          { label: 'Suspicious', data: days.map((d) => d.medium), backgroundColor: COLOR.medium, maxBarThickness: 46 },
          { label: 'High risk', data: days.map((d) => d.high), backgroundColor: COLOR.high, borderRadius: { topLeft: 4, topRight: 4 }, maxBarThickness: 46 },
        ],
      },
      options: {
        maintainAspectRatio: false, layout: { padding: { top: 22 } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: state.filters.days > 30 ? 12 : 31 } },
          y: { stacked: true, grid: { color: COLOR.line }, border: { display: false }, ticks: { precision: 0 } },
        },
        plugins: { tooltip: { mode: 'index', intersect: false, callbacks: { footer: (items) => 'Total ' + items.reduce((s, i) => s + i.parsed.y, 0) } } },
      },
      plugins: [{
        id: 'totals',
        afterDatasetsDraw(c) {
          if (state.filters.days > 14) return;
          const { ctx } = c; const top = c.data.datasets.length - 1;
          ctx.save(); ctx.font = '600 11.5px Poppins, sans-serif'; ctx.fillStyle = '#0e1a2b'; ctx.textAlign = 'center';
          c.getDatasetMeta(top).data.forEach((bar, i) => {
            const t = c.data.datasets.reduce((s, ds) => s + ds.data[i], 0);
            if (t) ctx.fillText(t, bar.x, bar.y - 7);
          });
          ctx.restore();
        },
      }],
    });

    const mix = D.riskMix(rows); const mixTotal = mix.low + mix.medium + mix.high;
    $('#mix-total').textContent = mixTotal.toLocaleString();
    chart('ch-mix', donutConfig([mix.low, mix.medium, mix.high], ['Low risk', 'Suspicious', 'High risk'], [COLOR.low, COLOR.medium, COLOR.high]));
    $('#mix-legend').innerHTML = ['low', 'medium', 'high'].map((l) => `<li><i class="dot dot--${l}"></i>${LEVEL_NAME[l]} ${mixTotal ? pct(mix[l] / mixTotal) : '0%'}</li>`).join('');

    renderSankey(rows);

    // 03 trends: line, weekday, response time
    renderLine();
    const wk = D.byWeekday(rows);
    const maxWk = Math.max(...wk);
    chart('ch-weekday', {
      type: 'bar',
      data: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], datasets: [{ data: wk, backgroundColor: wk.map((v) => (v === maxWk && v > 0 ? COLOR.behavioral : COLOR.blue)), borderRadius: 6, maxBarThickness: 34 }] },
      options: { maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { min: 0, suggestedMax: 60, grid: { color: COLOR.line }, border: { display: false } } }, plugins: { tooltip: { callbacks: { label: (c) => 'Average risk ' + c.parsed.y.toFixed(1) } } } },
    });
    const ms = D.msByInput(rows); const maxMs = Math.max(...Object.values(ms), 1);
    $('#hbars-ms').innerHTML = ['text', 'link', 'both'].map((t) => hrow(INPUT_NAME[t], ms[t] / maxMs, D.fmtSecs(ms[t]), COLOR.input[t])).join('');
    animateBars('#hbars-ms');

    renderLatest(rows);
  }

  function donutConfig(data, labels, colors) {
    return {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 3, borderColor: '#fff', hoverOffset: 6 }] },
      options: { maintainAspectRatio: false, cutout: '70%', plugins: { tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed.toLocaleString()} (${pct(c.parsed / (c.dataset.data.reduce((a, b) => a + b, 0) || 1))})` } } } },
    };
  }

  function hrow(label, frac, val, color, title) {
    return `<div class="an-hrow" ${title ? `title="${esc(title)}"` : ''}><span class="an-hrow__label">${esc(label)}</span><span class="an-hrow__track"><span class="an-hrow__fill" data-w="${Math.max(0, Math.min(1, frac)) * 100}" style="background:${color}"></span></span><span class="an-hrow__val">${esc(val)}</span></div>`;
  }
  function animateBars(sel) {
    requestAnimationFrame(() => requestAnimationFrame(() => $$(sel + ' .an-hrow__fill').forEach((f) => { f.style.width = f.dataset.w + '%'; })));
  }

  function renderLine() {
    // 30 full days up to the end of yesterday, so today's partial count does not drag the line down
    const base = { days: 30, input: state.filters.input, level: state.filters.level, to: D.dayKey(state.now) };
    const rows = D.applyFilters(state.log, base, state.now);
    const days = D.byDay(rows, 30, state.now - D.DAY);
    const m = state.metric;
    const conv = { total: (d) => d.total, highShare: (d) => d.highShare * 100, avgScore: (d) => d.avgScore, completion: (d) => d.completion * 100, avgMs: (d) => d.avgMs / 1000 };
    const fmt = { total: (v) => Math.round(v), highShare: (v) => v.toFixed(0) + '%', avgScore: (v) => v.toFixed(1), completion: (v) => v.toFixed(0) + '%', avgMs: (v) => v.toFixed(1) + 's' };
    const names = { total: 'Total scans', highShare: 'High-risk share', avgScore: 'Avg risk', completion: 'Completion', avgMs: 'Response' };
    $$('#metric-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === m)));
    chart('ch-line', {
      type: 'line',
      data: { labels: days.map((d) => dayLabel(d.day)), datasets: [{ label: names[m], data: days.map(conv[m]), borderColor: COLOR.blue, borderWidth: 2.2, tension: 0.25, fill: true, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: COLOR.blue,
        backgroundColor: (ctx) => { const { chart: c } = ctx; if (!c.chartArea) return 'rgba(26,95,168,.08)'; const g = c.ctx.createLinearGradient(0, c.chartArea.top, 0, c.chartArea.bottom); g.addColorStop(0, 'rgba(26,95,168,.22)'); g.addColorStop(1, 'rgba(26,95,168,0)'); return g; } }] },
      options: { maintainAspectRatio: false, animations: { colors: false }, interaction: { mode: 'index', intersect: false },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { beginAtZero: true, grid: { color: COLOR.line }, border: { display: false }, ticks: { callback: (v) => fmt[m](v) } } },
        plugins: { tooltip: { callbacks: { label: (c) => ` ${names[m]}: ${fmt[m](c.parsed.y)}` } } } },
    });
  }

  /* Sankey: input type -> outcome -> risk level, drawn in SVG */
  function renderSankey(rows) {
    const s = D.sankey(rows);
    const host = $('#sankey');
    const W = 1100; const H = 300; const nodeW = 16; const gap = 14;
    const cols = [30, 450, W - 200];
    const total = rows.length;
    if (!total) { host.innerHTML = '<p class="an-empty">No scans match these filters.</p>'; return; }
    const usable = H - gap * 2;
    const unit = (usable * 0.92) / total; // pixels per scan, shared by every column
    const mkNodes = (items, x, colorOf, nameOf) => {
      const visible = items.filter((i) => i.n > 0);
      const heights = visible.map((i) => Math.max(3, i.n * unit));
      const sum = heights.reduce((a, b) => a + b, 0) + gap * (visible.length - 1);
      let y = (H - sum) / 2;
      const out = {};
      visible.forEach((i, idx) => { out[i.key] = { x, y, h: heights[idx], n: i.n, color: colorOf(i.key), name: nameOf(i.key), cursorOut: 0, cursorIn: 0 }; y += heights[idx] + gap; });
      return out;
    };
    const A = mkNodes(s.types.map((t) => ({ key: t, n: s.outs.reduce((a, o) => a + s.inToOut[t + '>' + o], 0) })), cols[0], (k) => COLOR.input[k], (k) => INPUT_NAME[k]);
    const B = mkNodes(s.outs.map((o) => ({ key: o, n: s.types.reduce((a, t) => a + s.inToOut[t + '>' + o], 0) })), cols[1], (k) => ({ scored: COLOR.low, unexamined: COLOR.medium, rejected: '#9aa0ad' }[k]), (k) => OUTCOME_NAME[k]);
    const C = mkNodes(s.lv.map((l) => ({ key: l, n: s.outToLevel['scored>' + l] })), cols[2], (k) => COLOR[k], (k) => LEVEL_NAME[k]);
    const links = [];
    s.types.forEach((t) => s.outs.forEach((o) => { const n = s.inToOut[t + '>' + o]; if (n && A[t] && B[o]) links.push({ a: A[t], b: B[o], n, color: A[t].color, label: `${INPUT_NAME[t]} → ${OUTCOME_NAME[o]}` }); }));
    s.lv.forEach((l) => { const n = s.outToLevel['scored>' + l]; if (n && B.scored && C[l]) links.push({ a: B.scored, b: C[l], n, color: C[l].color, label: `Scored → ${LEVEL_NAME[l]}` }); });
    const path = (l) => {
      const h = Math.max(1.5, l.n * unit);
      const y0 = l.a.y + l.a.cursorOut; l.a.cursorOut += h;
      const y1 = l.b.y + l.b.cursorIn; l.b.cursorIn += h;
      const x0 = l.a.x + nodeW; const x1 = l.b.x; const cx = (x0 + x1) / 2;
      return { d: `M${x0} ${y0} C${cx} ${y0},${cx} ${y1},${x1} ${y1} L${x1} ${y1 + h} C${cx} ${y1 + h},${cx} ${y0 + h},${x0} ${y0 + h} Z`, h };
    };
    // draw big flows last so small ones stay visible
    const paths = links.map((l) => Object.assign(l, path(l)));
    const band = paths.map((l, i) => `<path class="band" data-i="${i}" d="${l.d}" fill="${l.color}" fill-opacity="0.28" tabindex="0"><title>${esc(l.label)}: ${l.n}</title></path>`).join('');
    const nodes = (grp, side) => Object.values(grp).map((n) => {
      const lx = side === 'L' ? n.x - 8 : n.x + nodeW + 8;
      const anchor = side === 'L' ? 'end' : 'start';
      return `<rect x="${n.x}" y="${n.y}" width="${nodeW}" height="${Math.max(3, n.h)}" rx="3" fill="${n.color}"/><text x="${lx}" y="${n.y + n.h / 2 + 4}" text-anchor="${anchor}">${esc(n.name)}</text>`;
    }).join('');
    const midLabels = Object.values(B).map((n) => `<text class="val" x="${n.x + nodeW + 8}" y="${n.y + n.h / 2 + 4}">${esc(n.name)} · ${n.n.toLocaleString()}</text>`).join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sankey diagram of scans from input type to outcome to risk level"><g>${band}</g>${nodes(A, 'L')}${nodes(C, 'R')}${Object.values(B).map((n) => `<rect x="${n.x}" y="${n.y}" width="${nodeW}" height="${Math.max(3, n.h)}" rx="3" fill="${n.color}"/>`).join('')}${midLabels}</svg>`;
    host.onmousemove = (ev) => {
      const p = ev.target.closest('.band');
      $$('.band', host).forEach((b) => b.classList.toggle('is-on', b === p));
      host.classList.toggle('is-hovering', !!p);
      if (p) { const l = paths[+p.dataset.i]; showTip(`<b>${esc(l.label)}</b><br>${l.n.toLocaleString()} scans · ${pct(l.n / total, 1)} of all`, ev.clientX, ev.clientY); } else hideTip();
    };
    host.onmouseleave = () => { host.classList.remove('is-hovering'); $$('.band', host).forEach((b) => b.classList.remove('is-on')); hideTip(); };
  }

  function renderLatest(rows) {
    const body = $('#tbl-latest tbody');
    const recent = rows.slice().sort((a, b) => b.ts - a.ts).slice(0, 8);
    if (!recent.length) { body.innerHTML = '<tr><td colspan="6" class="an-empty">No scans match these filters.</td></tr>'; return; }
    body.innerHTML = recent.map((r) => {
      const scored = r.outcome === 'scored';
      const color = scored ? COLOR[r.level] : 'var(--line)';
      const lvPill = scored ? `<span class="an-pill an-pill--${r.level}">${LEVEL_NAME[r.level]}</span>` : '';
      const tags = scored ? r.signs.slice(0, 3).map((id) => {
        const c = layerColor(id);
        return `<span class="an-sign-tag" style="--bd:${c}55;--bg:${c}12">${esc(signLabel(id))}</span>`;
      }).join('') : (r.failure ? `<span class="an-sign-tag">${esc(r.failure)}</span>` : '');
      const score = scored ? `<span class="an-score"><b>${r.score}</b><i style="--c:${color}"></i>${lvPill}</span>` : '<span class="an-pill an-pill--gray">n/a</span>';
      return `<tr><td>${D.ago(r.ts, state.now)}${r.live ? '<span class="an-live-tag">Live</span>' : ''}</td><td>${INPUT_NAME[r.inputType]}</td><td>${OUTCOME_NAME[r.outcome]}</td><td>${score}</td><td><div class="an-signs-cell">${tags}</div></td><td class="r">${D.fmtSecs(r.ms)}</td></tr>`;
    }).join('');
  }

  /* ---------------------------------------------------------------
     4. Risk & evidence
     --------------------------------------------------------------- */
  function renderRisk() {
    const rows = rowsNow();
    const sc = rows.filter((r) => r.outcome === 'scored');
    const mix = D.riskMix(rows); const n = sc.length || 1;
    $('#rk-takeaway').textContent = sc.length
      ? `${pct(mix.high / n)} of scored scans are high risk. ${pct(mix.low / n)} score under 30 and ${pct(mix.medium / n)} sit in the suspicious band.`
      : 'No scored scans match these filters. Try a wider date range or reset the filters.';

    const bins = D.histogram(rows);
    const labels = bins.map((_, i) => `${i * 10}-${i * 10 + 9}`);
    chart('ch-hist', {
      type: 'bar',
      data: { labels, datasets: [{ data: bins, backgroundColor: bins.map((_, i) => (i < 3 ? COLOR.low : i < 7 ? COLOR.medium : COLOR.high)), borderRadius: 4, categoryPercentage: 0.92, barPercentage: 0.92 }] },
      options: { maintainAspectRatio: false, layout: { padding: { top: 22 } }, scales: { x: { grid: { display: false } }, y: { grid: { color: COLOR.line }, border: { display: false }, ticks: { precision: 0 } } },
        plugins: { tooltip: { callbacks: { title: (i) => 'Score ' + i[0].label, label: (c) => ` ${c.parsed.y} scans` } } } },
      plugins: [{
        id: 'cutoffs',
        afterDraw(c) {
          const { ctx, chartArea: a, scales: { x } } = c; if (!a) return;
          const x30 = x.getPixelForValue(2.5); const x70 = x.getPixelForValue(6.5);
          ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = '#8b93a5'; ctx.lineWidth = 1.2;
          [x30, x70].forEach((px) => { ctx.beginPath(); ctx.moveTo(px, a.top - 4); ctx.lineTo(px, a.bottom); ctx.stroke(); });
          ctx.setLineDash([]); ctx.font = '700 11.5px Poppins, sans-serif'; ctx.textAlign = 'center';
          [['Low', (a.left + x30) / 2, COLOR.low], ['Suspicious', (x30 + x70) / 2, COLOR.medium], ['High', (x70 + a.right) / 2, COLOR.high]].forEach(([t, px, col]) => { ctx.fillStyle = col; ctx.fillText(t, px, a.top - 8); });
          ctx.restore();
        },
      }],
    });

    const al = D.avgLayerByLevel(rows);
    chart('ch-layers', {
      type: 'bar',
      data: { labels: ['Low', 'Suspicious', 'High'], datasets: D.LAYERS.map((l) => ({ label: l[0].toUpperCase() + l.slice(1), data: ['low', 'medium', 'high'].map((lv) => al[lv][l]), backgroundColor: COLOR[l], borderRadius: 5, maxBarThickness: 34 })) },
      options: { maintainAspectRatio: false, scales: { x: { grid: { display: false } }, y: { min: 0, max: 1, grid: { color: COLOR.line }, border: { display: false }, ticks: { stepSize: 0.2 } } },
        plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 18 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${c.parsed.y.toFixed(2)}` } } } },
    });

    const p3 = D.points3d(rows);
    explorer.setPoints(p3.points);
    $('#ex-sub').textContent = p3.points.length
      ? `${p3.subset === 'both' ? 'Text + link scans, where all three layers apply' : 'Every scored scan'} · ${p3.points.length} points · drag to rotate, scroll to zoom`
      : 'Drag to rotate, scroll to zoom';
    renderCorr(rows);
    renderFlagged(rows);
  }

  function corrColor(v) {
    const t = Math.max(0, Math.min(1, Math.abs(v)));
    if (v >= 0.999) return { bg: '#1a5fa8', fg: '#fff' };
    return { bg: `rgba(26, 95, 168, ${0.28 + t * 0.55})`, fg: t > 0.5 ? '#fff' : '#0e1a2b' };
  }
  function renderCorr(rows) {
    const c = D.layerCorrelation(rows);
    const names = ['Textual', 'Structural', 'Behavioral'];
    let h = '<span></span>' + names.map((n) => `<span class="an-corr__col">${n}</span>`).join('');
    c.matrix.forEach((row, i) => {
      h += `<span class="an-corr__row">${names[i]}</span>` + row.map((v, j) => { const k = corrColor(v); return `<span class="an-corr__cell" style="background:${k.bg};color:${k.fg}" title="${names[i]} vs ${names[j]}: ${f2(v)}">${f2(v)}</span>`; }).join('');
    });
    $('#corr').innerHTML = h;
    const clean = D.cleanTextShare(rows);
    $('#corr-note').textContent = `Low correlation between layers means each one adds new information. ${pct(clean)} of high-risk scans with a text part have wording that looks clean.`;
  }

  function renderFlagged(rows) {
    const prev = D.signPrevalence(rows);
    const top = prev.slice(0, 10);
    const max = top.length ? top[0].share : 1;
    $('#hbars-signs').innerHTML = top.length
      ? top.map((p) => hrow(signLabel(p.id), p.share / (max * 1.08), pct(p.share), layerColor(p.id), `${p.n} of ${p.flagged} flagged scans`)).join('')
      : '<p class="an-empty">No suspicious or high-risk scans in this selection.</p>';
    animateBars('#hbars-signs');
    const ids = prev.slice(0, 8).map((p) => p.id);
    const by = D.signByLevel(rows, ids);
    let max2 = 0; ids.forEach((id) => ['low', 'medium', 'high'].forEach((l) => { max2 = Math.max(max2, by[id][l]); }));
    $('#heat-signs').innerHTML = ids.length
      ? `<div class="an-heat__row an-heat__row--head"><span></span><span>Low risk</span><span>Suspicious</span><span>High risk</span></div>` + ids.map((id) => `<div class="an-heat__row"><span class="an-heat__name">${esc(signLabel(id))}</span>${['low', 'medium', 'high'].map((l) => { const k = heat(by[id][l], max2); return `<span class="an-heat__cell" style="background:${k.bg};color:${k.fg}" title="${esc(signLabel(id))} · ${LEVEL_NAME[l]}">${Math.round(by[id][l] * 100)}%</span>`; }).join('')}</div>`).join('')
      : '<p class="an-empty">Not enough flagged scans.</p>';

    const fr = D.failureReasons(rows); const maxF = Math.max(...fr.map((f) => f.share), 0.01);
    $('#hbars-fail').innerHTML = rows.some((r) => r.outcome === 'unexamined')
      ? fr.map((f) => hrow(f.name, f.share / maxF, pct(f.share), '#f5a524', `${f.n} scans`)).join('')
      : '<p class="an-empty">No scans were left unexamined in this selection.</p>';
    animateBars('#hbars-fail');
    const worst = fr.slice().sort((a, b) => b.n - a.n)[0];
    $('#fail-note').textContent = worst && worst.n
      ? `${worst.name} is the biggest cause (${pct(worst.share)} of unexamined scans). When a link cannot be examined the system says so instead of guessing, so no risk score is given.`
      : '';
    const outs = ['scored', 'unexamined', 'rejected'].map((o) => rows.filter((r) => r.outcome === o).length);
    $('#out-total').textContent = rows.length.toLocaleString();
    chart('ch-outcome', donutConfig(outs, ['Scored', 'Could not examine', 'Rejected'], [COLOR.low, COLOR.medium, '#9aa0ad']));
    $('#out-legend').innerHTML = ['Scored', 'Could not examine', 'Rejected'].map((nme, i) => `<li><i class="dot" style="background:${[COLOR.low, COLOR.medium, '#9aa0ad'][i]}"></i>${nme} ${rows.length ? pct(outs[i] / rows.length) : '0%'}</li>`).join('');
  }

  /* ---- 3D explorer: a small projection engine on a 2D canvas ---- */
  const explorer = {
    active: false, points: [], hover: null, paused: false, mode: 'level',
    yaw: -0.75, pitch: 0.5, zoom: 1, drag: null, raf: 0, projected: [],
    init() {
      this.canvas = $('#ex-canvas'); this.box = $('.an-3d'); this.tipEl = $('#ex-tip');
      this.ctx = this.canvas.getContext('2d');
      const cv = this.canvas;
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); this.drag = { x: e.clientX, y: e.clientY }; this.box.classList.add('is-drag'); });
      cv.addEventListener('pointermove', (e) => {
        if (this.drag) {
          this.yaw += (e.clientX - this.drag.x) * 0.008;
          this.pitch = Math.max(-0.2, Math.min(1.35, this.pitch + (e.clientY - this.drag.y) * 0.006));
          this.drag = { x: e.clientX, y: e.clientY }; this.hover = null; this.tipEl.hidden = true;
        } else this.pick(e);
        this.draw();
      });
      const end = () => { this.drag = null; this.box.classList.remove('is-drag'); };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointerleave', () => { this.hover = null; this.tipEl.hidden = true; this.draw(); });
      cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom = Math.max(0.6, Math.min(2.2, this.zoom * (e.deltaY < 0 ? 1.08 : 0.92))); this.draw(); }, { passive: false });
      cv.addEventListener('keydown', (e) => {
        const k = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.08], ArrowDown: [0, 0.08] }[e.key];
        if (k) { e.preventDefault(); this.yaw += k[0]; this.pitch = Math.max(-0.2, Math.min(1.35, this.pitch + k[1])); this.draw(); }
        if (e.key === '+' || e.key === '=') { this.zoom = Math.min(2.2, this.zoom * 1.1); this.draw(); }
        if (e.key === '-') { this.zoom = Math.max(0.6, this.zoom * 0.9); this.draw(); }
      });
      $('#ex-pause').addEventListener('click', (e) => {
        this.paused = !this.paused; const b = e.currentTarget;
        b.setAttribute('aria-pressed', String(this.paused)); $('b', b).textContent = this.paused ? 'Play' : 'Pause'; $('span', b).textContent = this.paused ? '▶' : '❚❚';
      });
      $('#ex-color').addEventListener('change', (e) => { this.mode = e.target.value; this.legend(); this.draw(); });
      $('#ex-reset').addEventListener('click', () => { this.yaw = -0.75; this.pitch = 0.5; this.zoom = 1; this.draw(); });
      new ResizeObserver(() => this.draw()).observe(this.box);
      this.legend();
      const loop = () => {
        this.raf = requestAnimationFrame(loop);
        if (!this.active || this.paused || this.drag || reduceMotion || document.hidden) return;
        this.yaw += 0.004; this.draw();
      };
      loop();
    },
    legend() {
      $('#ex-legend').innerHTML = this.mode === 'level'
        ? `<li><i class="dot dot--low"></i>Low risk</li><li><i class="dot dot--medium"></i>Suspicious</li><li><i class="dot dot--high"></i>High risk</li><li><i class="dot dot--diamond"></i>High risk, clean-looking text</li>`
        : `<li><i class="dot" style="background:${COLOR.input.text}"></i>Text</li><li><i class="dot" style="background:${COLOR.input.link}"></i>Link</li><li><i class="dot" style="background:${COLOR.input.both}"></i>Text + link</li>`;
    },
    setPoints(p) { this.points = p; this.draw(); },
    project(x, y, z, w, h) {
      // Behavioral is the vertical axis; textual runs right, structural runs left.
      const px = x - 0.5; const py = z - 0.5; const pz = y - 0.5;
      const cy = Math.cos(this.yaw); const sy = Math.sin(this.yaw);
      const x1 = px * cy - pz * sy; const z1 = px * sy + pz * cy;
      const cp = Math.cos(this.pitch); const sp = Math.sin(this.pitch);
      const y1 = py * cp - z1 * sp; const z2 = py * sp + z1 * cp;
      const s = Math.min(w, h) * 0.6 * this.zoom; const persp = 1 / (1 + z2 * 0.22);
      return { x: w / 2 + x1 * s * persp, y: h / 2 - y1 * s * persp + h * 0.02, d: z2, k: persp };
    },
    draw() {
      if (!this.ctx) return;
      const cv = this.canvas; const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = this.box.clientWidth; const h = this.box.clientHeight; if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const c = this.ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      const P = (x, y, z) => this.project(x, y, z, w, h);
      // floor grid
      c.lineWidth = 1; c.strokeStyle = 'rgba(14,26,43,.08)';
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        [[P(t, 0, 0), P(t, 1, 0)], [P(0, t, 0), P(1, t, 0)]].forEach(([a, b]) => { c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); });
      }
      // cube edges
      c.strokeStyle = 'rgba(14,26,43,.22)';
      const V = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((v) => P(...v));
      [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => { c.beginPath(); c.moveTo(V[a].x, V[a].y); c.lineTo(V[b].x, V[b].y); c.stroke(); });
      // axis labels
      c.font = '700 12px Poppins, sans-serif'; c.textAlign = 'center';
      const lab = (t, p, col) => { c.fillStyle = col; c.fillText(t, p.x, p.y); };
      const a1 = P(1.12, 0, 0); const a2 = P(0, 1.12, 0); const a3 = P(0, 0, 1.12);
      lab('Textual', a1, COLOR.textual); lab('Structural', a2, '#d98a06'); lab('Behavioral', a3, COLOR.behavioral);
      // points, far to near
      this.projected = this.points.map((p) => Object.assign({ p }, P(p.x, p.y, p.z))).sort((a, b) => b.d - a.d);
      this.projected.forEach((q) => {
        const p = q.p; const r = 3.4 + 2.2 * q.k;
        const col = this.mode === 'level' ? COLOR[p.level] : COLOR.input[p.input];
        const hov = this.hover === q;
        c.globalAlpha = 0.45 + 0.5 * Math.min(1, q.k);
        c.fillStyle = col;
        if (this.mode === 'level' && p.clean) {
          const s = r * 1.5; c.beginPath(); c.moveTo(q.x, q.y - s); c.lineTo(q.x + s, q.y); c.lineTo(q.x, q.y + s); c.lineTo(q.x - s, q.y); c.closePath(); c.fill();
        } else { c.beginPath(); c.arc(q.x, q.y, hov ? r + 2 : r, 0, 6.2832); c.fill(); }
        if (hov) { c.globalAlpha = 1; c.lineWidth = 2; c.strokeStyle = '#0e1a2b'; c.stroke(); }
      });
      c.globalAlpha = 1;
      if (!this.points.length) { c.fillStyle = COLOR.muted; c.textAlign = 'center'; c.font = '500 13px Poppins, sans-serif'; c.fillText('No scored scans match these filters.', w / 2, h / 2); }
    },
    pick(e) {
      const r = this.canvas.getBoundingClientRect(); const mx = e.clientX - r.left; const my = e.clientY - r.top;
      let best = null; let bd = 14;
      for (let i = this.projected.length - 1; i >= 0; i--) { const q = this.projected[i]; const d = Math.hypot(q.x - mx, q.y - my); if (d < bd) { bd = d; best = q; } }
      this.hover = best;
      if (best) {
        const p = best.p;
        this.tipEl.hidden = false; this.tipEl.style.left = mx + 'px'; this.tipEl.style.top = my + 'px';
        this.tipEl.innerHTML = `<b>Score ${p.score} · ${LEVEL_NAME[p.level]}</b><br>${INPUT_NAME[p.input]}<br>Textual ${f2(p.x)} · Structural ${f2(p.y)} · Behavioral ${f2(p.z)}${p.clean ? '<br><i>Wording looks clean</i>' : ''}`;
      } else this.tipEl.hidden = true;
    },
  };

  /* ---------------------------------------------------------------
     5. Model lab
     --------------------------------------------------------------- */
  const MET_ORDER = ['accuracy', 'precision', 'recall', 'f1', 'auc'];
  const MET_NAME = { accuracy: 'Accuracy', precision: 'Precision', recall: 'Recall', f1: 'F1-score', auc: 'AUC' };

  function renderModel(rebuildControls = true) {
    const e = state.evals; const T = state.test;
    if (rebuildControls) {
      $('#cfg-seg').innerHTML = D.CONFIGS.map((c, i) => `<button type="button" role="radio" data-i="${i}" aria-checked="${i === state.cfg}" tabindex="${i === state.cfg ? 0 : -1}">${c.name}</button>`).join('');
    } else $$('#cfg-seg button').forEach((b) => { b.setAttribute('aria-checked', String(+b.dataset.i === state.cfg)); b.tabIndex = +b.dataset.i === state.cfg ? 0 : -1; });
    $('#thr').value = state.thr; $('#thr-out').textContent = f2(state.thr);

    const conf = D.confusion(T, state.cfg, state.thr); const m = D.metricsFrom(conf);
    $('#ml-metrics').innerHTML = [['Accuracy', m.accuracy], ['Precision', m.precision], ['Recall', m.recall], ['F1-score', m.f1]].map(([n, v]) => `<div class="an-metric${n === 'F1-score' ? ' an-metric--f1' : ''}"><span>${n}</span><strong>${f2(v)}</strong></div>`).join('');
    $('#cm').innerHTML = `<span></span><span class="an-cm__col">Predicted scam</span><span class="an-cm__col">Predicted legit</span>
      <span class="an-cm__row">Actual scam</span>${cmCell(conf.tp, 'True positive', '#1a5fa8', '#fff')}${cmCell(conf.fn, 'False negative', '#fde4e3', '#8a1218')}
      <span class="an-cm__row">Actual legit</span>${cmCell(conf.fp, 'False positive', '#fdf0c7', '#7a5200')}${cmCell(conf.tn, 'True negative', '#7db1e6', '#0e1a2b')}`;

    const curve = D.f1Curve(T, state.cfg);
    chart('ch-f1', {
      type: 'line',
      data: { datasets: [
        { label: 'F1', data: curve.map((p) => ({ x: p.t, y: p.f1 })), borderColor: COLOR.blue, borderWidth: 2.4, pointRadius: 0, tension: 0.2, fill: false },
        { label: 'Current', data: [{ x: state.thr, y: m.f1 }], showLine: false, pointStyle: 'star', pointRadius: 11, pointHoverRadius: 12, backgroundColor: COLOR.high, borderColor: COLOR.high },
      ] },
      options: { maintainAspectRatio: false, parsing: false, interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        scales: { x: { type: 'linear', min: 0.1, max: 0.9, grid: { display: false }, ticks: { stepSize: 0.2, callback: (v) => v.toFixed(2) } }, y: { min: f1Floor(curve), max: 1, grid: { color: COLOR.line }, border: { display: false }, ticks: { stepSize: 0.1, callback: (v) => v.toFixed(1) } } },
        plugins: { tooltip: { callbacks: { title: (i) => 'Threshold ' + f2(i[0].parsed.x), label: (c) => ' F1 ' + f2(c.parsed.y) } } } },
    });

    // 02 thesis
    const names = D.CONFIGS.map((c) => c.name);
    chart('ch-f1bars', {
      type: 'bar',
      data: { labels: names, datasets: [{ data: e.map((x) => x.f1), backgroundColor: [COLOR.sky, COLOR.blue, COLOR.navy], borderRadius: 8, maxBarThickness: 64 }] },
      options: { maintainAspectRatio: false, layout: { padding: { top: 22 } }, scales: { x: { grid: { display: false } }, y: { min: 0, max: 1, grid: { color: COLOR.line }, border: { display: false }, ticks: { stepSize: 0.2 } } }, plugins: { tooltip: { callbacks: { label: (c) => ' F1 ' + f2(c.parsed.y) } } } },
      plugins: [valueLabels(f2)],
    });
    const lift = e[2].f1 - e[0].f1;
    $('#f1-delta').textContent = `${lift >= 0 ? '+' : ''}${f2(lift)} vs text only`;
    chart('ch-roc', {
      type: 'line',
      data: { datasets: [
        ...e.map((x, i) => ({ label: `${x.name} (AUC ${f2(x.auc)})`, data: x.roc.map((p) => ({ x: p.fpr, y: p.tpr })), borderColor: [COLOR.sky, COLOR.blue, COLOR.navy][i], borderWidth: 2.4, pointRadius: 0, stepped: false, tension: 0 })),
        { label: 'Chance', data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: '#b9bfcc', borderDash: [4, 4], borderWidth: 1.2, pointRadius: 0 },
      ] },
      options: { maintainAspectRatio: false, parsing: false, scales: { x: { type: 'linear', min: 0, max: 1, title: { display: true, text: 'False alarm rate' }, grid: { display: false }, ticks: { stepSize: 0.25 } }, y: { min: 0, max: 1, title: { display: true, text: 'Scams caught' }, grid: { color: COLOR.line }, border: { display: false }, ticks: { stepSize: 0.25 } } },
        plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 12, font: { size: 10.5 }, filter: (i) => i.text !== 'Chance' } }, tooltip: { enabled: false } } },
    });
    chart('ch-evasive', {
      type: 'bar',
      data: { labels: names, datasets: [
        { label: 'Ordinary scams', data: e.map((x) => x.recallOrdinary), backgroundColor: COLOR.blue, borderRadius: 6, maxBarThickness: 30 },
        { label: 'Text-evasive scams', data: e.map((x) => x.recallEvasive), backgroundColor: COLOR.behavioral, borderRadius: 6, maxBarThickness: 30 },
      ] },
      options: { maintainAspectRatio: false, layout: { padding: { top: 20 } }, scales: { x: { grid: { display: false } }, y: { min: 0, max: 1, grid: { color: COLOR.line }, border: { display: false }, ticks: { stepSize: 0.25, callback: (v) => v * 100 + '%' } } },
        plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${pct(c.parsed.y)}` } } } },
      plugins: [valueLabels((v) => pct(v), 10.5)],
    });

    // 03 profiles
    chart('ch-radar', {
      type: 'radar',
      data: { labels: MET_ORDER.map((k) => MET_NAME[k]), datasets: e.map((x, i) => ({ label: x.name, data: MET_ORDER.map((k) => x[k]), borderColor: [COLOR.sky, COLOR.blue, COLOR.navy][i], backgroundColor: ['rgba(125,177,230,.18)', 'rgba(26,95,168,.14)', 'rgba(27,32,57,.1)'][i], borderWidth: 2, pointRadius: 3 })) },
      options: { maintainAspectRatio: false, scales: { r: { min: 0, max: 1, ticks: { stepSize: 0.25, backdropColor: 'transparent', font: { size: 10 } }, grid: { color: COLOR.line }, angleLines: { color: COLOR.line }, pointLabels: { font: { size: 11.5, weight: '600' }, color: COLOR.ink } } },
        plugins: { legend: { display: true, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 14 } } } },
    });
    $('#tbl-metrics thead').innerHTML = `<tr><th>Metric</th>${e.map((x) => `<th>${x.name}</th>`).join('')}</tr>`;
    $('#tbl-metrics tbody').innerHTML = MET_ORDER.map((k) => {
      const best = Math.max(...e.map((x) => x[k]));
      return `<tr><td>${MET_NAME[k]}</td>${e.map((x) => `<td class="${x[k] === best ? 'best' : ''}">${f2(x[k])}</td>`).join('')}</tr>`;
    }).join('') + `<tr><td>Threshold</td>${e.map((x) => `<td>${f2(x.thr)}</td>`).join('')}</tr>`;

    $('#ml-takeaway').textContent = `At the tuned threshold, all three layers catch ${pct(e[2].recall)} of scams and ${pct(e[2].recallEvasive)} of text-evasive scams, against ${pct(e[0].recallEvasive)} of text-evasive scams with text alone.`;
  }
  function f1Floor(curve) { return Math.max(0, Math.floor((Math.min(...curve.map((p) => p.f1)) - 0.05) * 10) / 10); }
  function cmCell(n, label, bg, fg) { return `<div class="an-cm__cell" style="background:${bg};color:${fg}"><strong>${n}</strong><span>${label}</span></div>`; }
  function valueLabels(fmt, size = 12) {
    return { id: 'vals', afterDatasetsDraw(c) {
      const { ctx } = c; ctx.save(); ctx.font = `600 ${size}px Poppins, sans-serif`; ctx.fillStyle = '#0e1a2b'; ctx.textAlign = 'center';
      c.data.datasets.forEach((ds, di) => c.getDatasetMeta(di).data.forEach((bar, i) => ctx.fillText(fmt(ds.data[i]), bar.x, bar.y - 6)));
      ctx.restore();
    } };
  }

  /* ---------------------------------------------------------------
     6. Playground
     --------------------------------------------------------------- */
  const PG_GROUPS = [
    ['text', 'What the message says', ['upfront_payment', 'check_clearing', 'sensitive_data', 'guaranteed_returns', 'unrealistic_pay', 'urgency', 'instant_hire', 'off_platform', 'text_model']],
    ['url', 'What the link looks like', ['brand_lookalike', 'ip_host', 'disguised_link', 'suspicious_tld', 'url_shortener', 'no_https', 'messy_host', 'offer_keywords']],
    ['page', 'What the page does', ['no_business_info', 'payment_request', 'hidden_redirect', 'copied_layout', 'countdown_timer', 'forced_signup', 'new_domain']],
  ];
  const PRESETS = [
    ['Fake job offer', ['upfront_payment', 'urgency', 'instant_hire', 'off_platform', 'unrealistic_pay']],
    ['Investment scam', ['guaranteed_returns', 'text_model', 'forced_signup', 'payment_request', 'new_domain']],
    ['Look-alike site', ['brand_lookalike', 'no_https', 'copied_layout', 'hidden_redirect', 'countdown_timer']],
    ['Looks fine', []],
  ];

  function buildPlayground() {
    $('#pg-signs').innerHTML = PG_GROUPS.map(([, title, ids]) => `<div><h4>${title}<small>${ids.length}</small></h4>${ids.map((id) => `<label class="an-check"><input type="checkbox" value="${id}"><span>${esc(signLabel(id))}</span><em>${D.weights[id].toFixed(2)}</em></label>`).join('')}</div>`).join('');
    $('#pg-presets').innerHTML = '<span>Try</span>' + PRESETS.map(([n], i) => `<button type="button" class="an-btn-pill" data-preset="${i}">${n}</button>`).join('') + '<button type="button" class="an-btn-pill" data-preset="clear">Clear all</button>';
    const L = { textual: 'Textual', structural: 'Structural', behavioral: 'Behavioral' };
    $('#pg-sliders').innerHTML = '<p>Set how strongly each layer fires, from 0 (nothing found) to 100% (certain). The layers combine the same way as individual warning signs.</p>' +
      D.LAYERS.map((l) => `<div class="an-lslider" style="--c:${COLOR[l]}"><div class="an-lslider__top"><label for="ls-${l}">${L[l]} layer</label><output id="lo-${l}">0%</output></div><input type="range" id="ls-${l}" data-layer="${l}" min="0" max="95" step="1" value="0"></div>`).join('');
    $('#pg-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.pg.mode = b.dataset.v; renderPlayground(); } });
    $('#pg-signs').addEventListener('change', (e) => {
      if (e.target.type !== 'checkbox') return;
      if (e.target.checked) state.pg.sel.add(e.target.value); else state.pg.sel.delete(e.target.value);
      renderPlayground();
    });
    $('#pg-presets').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.pg.mode = 'signs';
      state.pg.sel = new Set(b.dataset.preset === 'clear' ? [] : PRESETS[+b.dataset.preset][1]);
      renderPlayground();
    });
    $('#pg-sliders').addEventListener('input', (e) => { if (e.target.dataset.layer) { state.pg.layers[e.target.dataset.layer] = +e.target.value / 100; renderPlayground(); } });
    $('#pg-gauge').innerHTML = `<svg viewBox="0 22 320 174" role="img" aria-label="Risk gauge"><path d="M30 160 A130 130 0 0 1 290 160" fill="none" stroke="#eef1f6" stroke-width="22" stroke-linecap="round"/>
      <path id="g-arc" class="an-gauge__arc" d="M30 160 A130 130 0 0 1 290 160" fill="none" stroke="${COLOR.low}" stroke-width="22" stroke-linecap="round" stroke-dasharray="408.4" stroke-dashoffset="408.4"/>
      <g id="g-ticks"></g><g id="g-needle" class="an-gauge__needle"><line x1="160" y1="160" x2="160" y2="48" stroke="#0e1a2b" stroke-width="3" stroke-linecap="round"/><circle cx="160" cy="160" r="8" fill="#0e1a2b"/></g>
      <text id="g-num" x="160" y="150" text-anchor="middle" font-size="46" font-weight="700" fill="#0e1a2b" font-family="Poppins, sans-serif">0</text>
      <text x="30" y="186" text-anchor="middle" font-size="11" fill="#6b7388">0</text><text x="290" y="186" text-anchor="middle" font-size="11" fill="#6b7388">100</text></svg><div class="an-gauge__level" id="g-level">Low risk</div>`;
    // cut-off ticks at 30 and 70
    $('#g-ticks').innerHTML = [30, 70].map((v) => { const a = Math.PI - (v / 100) * Math.PI; const x1 = 160 + Math.cos(a) * 118; const y1 = 160 - Math.sin(a) * 118; const x2 = 160 + Math.cos(a) * 142; const y2 = 160 - Math.sin(a) * 142; return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fff" stroke-width="3"/>`; }).join('');
  }

  function renderPlayground() {
    const sliders = state.pg.mode === 'sliders';
    $$('#pg-mode button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === state.pg.mode)));
    $('#pg-signs').hidden = sliders; $('#pg-presets').hidden = sliders; $('#pg-sliders').hidden = !sliders;
    $$('#pg-signs input').forEach((i) => { i.checked = state.pg.sel.has(i.value); });
    D.LAYERS.forEach((l) => { $('#lo-' + l).textContent = Math.round(state.pg.layers[l] * 100) + '%'; $('#ls-' + l).value = Math.round(state.pg.layers[l] * 100); });

    let score; let drivers;
    if (sliders) {
      const safe = D.LAYERS.reduce((p, l) => p * (1 - state.pg.layers[l]), 1);
      score = Math.min(99, Math.round((1 - safe) * 100));
      drivers = D.LAYERS.filter((l) => state.pg.layers[l] > 0).map((l) => ({ label: l[0].toUpperCase() + l.slice(1) + ' layer', w: state.pg.layers[l], color: COLOR[l] })).sort((a, b) => b.w - a.w);
    } else {
      const ids = Array.from(state.pg.sel); score = D.scoreOf(ids);
      drivers = ids.map((id) => ({ label: signLabel(id), w: D.weights[id], color: layerColor(id) })).sort((a, b) => b.w - a.w);
    }
    const level = D.levelOf(score);
    const arc = $('#g-arc');
    arc.style.strokeDashoffset = 408.4 * (1 - score / 100); arc.setAttribute('stroke', COLOR[level]);
    $('#g-needle').style.transform = `rotate(${-90 + score * 1.8}deg)`;
    $('#g-num').textContent = score;
    const lv = $('#g-level'); lv.textContent = LEVEL_NAME[level]; lv.style.color = COLOR[level];
    $('#pg-drivers').innerHTML = drivers.length
      ? drivers.map((d) => hrow(d.label, d.w, d.w.toFixed(2), d.color)).join('')
      : '<p class="an-empty">Tick a warning sign to see what drives the score.</p>';
    animateBars('#pg-drivers');
  }

  /* ---------------------------------------------------------------
     7. Report
     --------------------------------------------------------------- */
  function findings() {
    const rows = rowsNow(); const k = D.kpis(rows); const e = state.evals;
    const prev = D.signPrevalence(rows); const top = prev[0];
    const fr = D.failureReasons(rows).sort((a, b) => b.n - a.n)[0];
    const unexRate = rows.length ? rows.filter((r) => r.outcome === 'unexamined').length / rows.length : 0;
    return {
      rows, k, top, fr, unexRate, prev,
      list: [
        { m: `${f2(e[0].f1)} → ${f2(e[2].f1)}`, s: 'F1-score', c: '#1a5fa8', t: `Adding the structural and behavioral layers raises the F1-score from ${f2(e[0].f1)} to ${f2(e[2].f1)}.` },
        { m: `${pct(e[0].recallEvasive)} → ${pct(e[2].recallEvasive)}`, s: 'Evasive scams caught', c: '#f26d67', t: `Text-evasive scams caught rise from ${pct(e[0].recallEvasive)} to ${pct(e[2].recallEvasive)} when all three layers are used.` },
        { m: pct(k.highShare), s: `Last ${state.filters.days} days`, c: '#ee1c25', t: `High-risk scans are ${pct(k.highShare)} of scored scans in the last ${state.filters.days} days${filterWords()}.` },
        { m: top ? pct(top.share) : '–', s: 'Top warning sign', c: '#d98a06', t: top ? `The most common warning sign in flagged scans is ${signLabel(top.id).toLowerCase()} (${pct(top.share)}).` : 'There are no flagged scans in this selection.' },
        { m: pct(unexRate), s: 'Not examined', c: '#6a4fd8', t: `${pct(unexRate)} of scans could not be examined${fr && fr.n ? `, mostly ${fr.name.toLowerCase()}` : ''}.` },
      ],
    };
  }
  function filterWords() {
    const f = state.filters; const out = [];
    if (f.input !== 'all') out.push('input: ' + INPUT_NAME[f.input].toLowerCase());
    if (f.level !== 'all') out.push('level: ' + LEVEL_NAME[f.level].toLowerCase());
    return out.length ? ` (${out.join(', ')})` : '';
  }

  function renderReport() {
    const F = findings(); const rows = F.rows; const f = state.filters;
    $('#rp-findings').innerHTML = F.list.map((x) => `<li class="an-finding"><div class="an-finding__metric" style="--c:${x.c}">${x.m}<small>${x.s}</small></div><p>${esc(x.t)}</p></li>`).join('');
    const sc = rows.filter((r) => r.outcome === 'scored').length;
    $('#rp-summary').innerHTML = [
      ['Date range', 'Last ' + f.days + ' days'], ['Input type', f.input === 'all' ? 'All' : INPUT_NAME[f.input]], ['Risk level', f.level === 'all' ? 'All' : LEVEL_NAME[f.level]],
      ['Total scans', rows.length.toLocaleString()], ['Scored scans', sc.toLocaleString()], ['Data', state.live.length ? 'Simulated + ' + state.live.length + ' live' : 'Simulated'],
    ].map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');

    const mx = D.riskMix(rows); const mt = mx.low + mx.medium + mx.high;
    $('#rp-mixbar').innerHTML = ['low', 'medium', 'high'].map((l) => `<span style="flex:${mt ? mx[l] : 1} 1 0;background:${COLOR[l]}"></span>`).join('');
    $('#rp-mixlist').innerHTML = ['low', 'medium', 'high'].map((l) => `<li><i class="dot dot--${l}"></i>${LEVEL_NAME[l]}<b>${mx[l].toLocaleString()} · ${mt ? pct(mx[l] / mt) : '0%'}</b></li>`).join('');

    const e = state.evals; const acts = [];
    acts.push({ tag: 'Detection', h: 'Keep all three layers switched on', p: `Text alone catches only ${pct(e[0].recallEvasive)} of text-evasive scams in the test set. With the structural and behavioral layers the rate is ${pct(e[2].recallEvasive)}, so skipping the page check for link scans would leave the polished scams through.` });
    acts.push({ tag: 'Reliability', h: F.fr && F.fr.n ? `Reduce "${F.fr.name.toLowerCase()}" failures` : 'Keep link failures low', p: F.fr && F.fr.n ? `${pct(F.unexRate)} of scans in this selection could not be examined and ${pct(F.fr.share)} of those were ${F.fr.name.toLowerCase()}. A retry or a longer wait on the scan server would recover some of them.` : 'Every link in this selection was examined. Keep watching the failure reasons as traffic grows.' });
    const t2 = F.prev.slice(0, 2).map((p) => signLabel(p.id).toLowerCase());
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    acts.push({ tag: 'Awareness', h: t2.length ? 'Lead the Scam Trends page with the top signs' : 'Collect more scans', p: t2.length ? `${cap(t2.join(' and '))} appear most often in flagged scans. Explaining these first helps users spot the offers that reach them most.` : 'There are not enough flagged scans in this selection to rank warning signs.' });
    $('#rp-actions').innerHTML = acts.map((a) => `<li><small>${a.tag}</small><b>${esc(a.h)}</b><span>${esc(a.p)}</span></li>`).join('');
  }

  function summaryText() {
    const F = findings(); const f = state.filters;
    return ['ISKAMDAR scan analytics (simulated data)', `Selection: last ${f.days} days, input ${f.input === 'all' ? 'all' : INPUT_NAME[f.input]}, risk level ${f.level === 'all' ? 'all' : LEVEL_NAME[f.level]}`,
      `Scans: ${F.rows.length} (${F.k.scored} scored)`, ...F.list.map((x, i) => `${i + 1}. ${x.t}`), 'Only metadata is logged. No message text and no URLs.'].join('\n');
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportCsv() {
    const rows = rowsNow();
    const head = 'timestamp,input_type,outcome,score,level,textual,structural,behavioral,warning_signs,response_ms,live';
    const body = rows.map((r) => [new Date(r.ts).toISOString(), r.inputType, r.outcome, r.score ?? '', r.level ?? '', r.layers ? r.layers.textual.toFixed(3) : '', r.layers ? r.layers.structural.toFixed(3) : '', r.layers ? r.layers.behavioral.toFixed(3) : '', '"' + r.signs.join(';') + '"', r.ms, r.live ? 1 : 0].join(','));
    download('iskamdar-scan-log.csv', [head, ...body].join('\n'), 'text/csv;charset=utf-8');
    toast(`Downloaded ${rows.length.toLocaleString()} anonymous rows.`);
  }

  /* ---------------------------------------------------------------
     8. Render dispatcher and boot
     --------------------------------------------------------------- */
  function render(isRebuild) {
    state.now = Date.now(); // scans recorded since the page opened must count
    syncFilterUi();
    if (state.tab === 'overview') renderOverview();
    else if (state.tab === 'risk') renderRisk();
    else if (state.tab === 'model') renderModel();
    else if (state.tab === 'playground') renderPlayground();
    else if (state.tab === 'report') renderReport();
    if (!isRebuild) scheduleRedraw();
  }

  function boot() {
    state.now = Date.now();
    state.sim = D.generateLog(state.now);
    buildLog();
    buildPlayground();
    explorer.init();

    // tabs (click + arrow keys)
    const tabs = $('#an-tabs');
    tabs.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) setTab(b.dataset.tab); });
    tabs.addEventListener('keydown', (e) => {
      const i = TABS.indexOf(state.tab); let n = -1;
      if (e.key === 'ArrowRight') n = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
      if (n >= 0) { e.preventDefault(); setTab(TABS[n]); $('#tab-' + TABS[n]).focus(); }
    });
    window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t) && t !== state.tab) setTab(t, false); });

    // filters
    $$('.an-seg[data-filter]').forEach((seg) => seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const key = seg.dataset.filter; state.filters[key] = key === 'days' ? +b.dataset.v : b.dataset.v;
      render();
    }));
    $('#an-reset').addEventListener('click', () => { state.filters = { days: 7, input: 'all', level: 'all' }; render(); });
    $('#an-live-chip').addEventListener('click', () => { setTab('overview'); $('[data-sec=latest]').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); });

    // "what is this?" panels
    document.addEventListener('click', (e) => {
      const b = e.target.closest('.an-what'); if (!b) return;
      const sec = b.closest('.an-sec'); const panel = $('.an-explain', sec);
      const open = b.getAttribute('aria-expanded') !== 'true';
      b.setAttribute('aria-expanded', String(open));
      if (open && !panel.innerHTML) panel.innerHTML = EXPLAIN[sec.dataset.sec] || '';
      panel.hidden = !open;
    });

    // metric tabs
    $('#metric-tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { state.metric = b.dataset.v; renderLine(); } });

    // model lab controls
    $('#cfg-seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.cfg = +b.dataset.i; state.thr = state.evals[state.cfg].thr; renderModel(false); });
    $('#thr').addEventListener('input', (e) => { state.thr = +e.target.value; renderModel(false); });
    $('#thr-tuned').addEventListener('click', () => { state.thr = state.evals[state.cfg].thr; renderModel(false); toast('Threshold set to ' + f2(state.thr) + ', the best F1 for this configuration.'); });

    // report actions
    $('#rp-pdf').addEventListener('click', () => {
      document.body.classList.add('is-printing-report');
      const done = () => { document.body.classList.remove('is-printing-report'); window.removeEventListener('afterprint', done); };
      window.addEventListener('afterprint', done);
      window.print();
    });
    $('#rp-csv').addEventListener('click', exportCsv);
    $('#rp-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(summaryText()); toast('Summary copied.'); } catch { toast('Could not copy. Select the findings and copy them manually.'); }
    });
    $('#rp-clear').addEventListener('click', () => { try { localStorage.removeItem(LIVE_KEY); } catch { /* storage unavailable */ } buildLog(); render(); toast('Live scans cleared.'); });

    window.addEventListener('resize', scheduleRedraw);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRedraw(); });

    // refresh live scans if another tab records one
    window.addEventListener('storage', (e) => { if (e.key === LIVE_KEY) { buildLog(); render(); } });

    const start = location.hash.slice(1);
    setTab(TABS.includes(start) ? start : 'overview', false);
    window.__analytics = { state, D, setTab, render, charts, explorer }; // handy for testing in the console
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
