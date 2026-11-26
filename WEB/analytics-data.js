/* =====================================================================
   ISKAMDAR | analytics-data.js
   The data side of the analytics module. No DOM code lives here, so the
   same file runs in the browser and in Node for testing.

   What it provides
   1. The warning-sign catalogue (weights are read from script.js when it
      is loaded, so the analytics always use the prototype's real weights).
   2. A seeded SIMULATED scan log (60 days of anonymous scan metadata).
   3. A seeded SIMULATED labeled test set (400 messages) for the Model lab.
   4. All the statistics: KPIs, series, histogram, correlation, sankey
      counts, confusion matrix, ROC / AUC, F1 across thresholds.

   Nothing here stores or needs message text or URLs. Only metadata:
   input type, outcome, scores, warning signs and response time.
   ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.IskamdarData = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  /* ---------------------------------------------------------------
     1. Catalogue
     --------------------------------------------------------------- */
  const FALLBACK_WEIGHTS = {
    upfront_payment: 0.85, check_clearing: 0.8, sensitive_data: 0.7, guaranteed_returns: 0.8,
    unrealistic_pay: 0.55, urgency: 0.45, instant_hire: 0.3, off_platform: 0.3, text_model: 0.5,
    brand_lookalike: 0.65, ip_host: 0.5, disguised_link: 0.5, suspicious_tld: 0.3,
    url_shortener: 0.3, no_https: 0.2, messy_host: 0.2, offer_keywords: 0.15,
    no_business_info: 0.55, suspicious_design: 0.4, payment_request: 0.7, hidden_redirect: 0.6,
    copied_layout: 0.6, countdown_timer: 0.45, forced_signup: 0.4, new_domain: 0.4,
  };

  // id -> [plain label, source group, layer]
  const META = {
    upfront_payment:    ['Upfront payment requested',        'text', 'textual'],
    check_clearing:     ['Check-clearing setup',             'text', 'textual'],
    sensitive_data:     ['Asks for private details',         'text', 'textual'],
    guaranteed_returns: ['Guaranteed returns',               'text', 'textual'],
    unrealistic_pay:    ['Unrealistic salary',               'text', 'textual'],
    urgency:            ['Urgent pressure tactics',          'text', 'textual'],
    instant_hire:       ['Hired without an interview',       'text', 'textual'],
    off_platform:       ['Moves the chat off-platform',      'text', 'textual'],
    text_model:         ['Wording matches known scam messages', 'text', 'textual'],
    brand_lookalike:    ['Look-alike link',                  'url',  'structural'],
    ip_host:            ['Link is a raw IP address',         'url',  'structural'],
    disguised_link:     ['Disguised link',                   'url',  'structural'],
    suspicious_tld:     ['Unusual web address ending',       'url',  'structural'],
    url_shortener:      ['Shortened link',                   'url',  'structural'],
    no_https:           ['Not using HTTPS',                  'url',  'structural'],
    messy_host:         ['Cluttered web address',            'url',  'structural'],
    offer_keywords:     ['Offer-style web address',          'url',  'structural'],
    no_business_info:   ['No verifiable business info',      'page', 'structural'],
    suspicious_design:  ['Suspicious page design',           'page', 'structural'],
    copied_layout:      ['Copied layout',                    'page', 'structural'],
    new_domain:         ['Very new website',                 'page', 'structural'],
    payment_request:    ['Payment requested on the page',    'page', 'behavioral'],
    hidden_redirect:    ['Hidden redirect',                  'page', 'behavioral'],
    countdown_timer:    ['Countdown timer',                  'page', 'behavioral'],
    forced_signup:      ['Forced sign-up',                   'page', 'behavioral'],
  };

  const LAYERS = ['textual', 'structural', 'behavioral'];
  const LEVELS = { low: [0, 29], medium: [30, 69], high: [70, 99] };
  const THRESHOLDS = { high: 70, medium: 30 };

  function weights() {
    const live = root && root.Iskamdar && root.Iskamdar.SIGNALS;
    const out = {};
    Object.keys(META).forEach((id) => {
      out[id] = live && live[id] && typeof live[id].weight === 'number' ? live[id].weight : FALLBACK_WEIGHTS[id];
    });
    return out;
  }
  const W = weights();

  const SIGNS = Object.keys(META).map((id) => ({
    id, label: META[id][0], group: META[id][1], layer: META[id][2], weight: W[id],
  }));
  const SIGN_BY_ID = Object.fromEntries(SIGNS.map((s) => [s.id, s]));

  /* ---------------------------------------------------------------
     2. Scoring (same noisy-OR as the prototype)
     --------------------------------------------------------------- */
  function noisyOr(ids) {
    let safe = 1;
    for (const id of ids) safe *= 1 - W[id];
    return 1 - safe; // 0..1
  }
  function scoreOf(ids) { return Math.min(99, Math.round(noisyOr(ids) * 100)); }
  function levelOf(score) { return score >= THRESHOLDS.high ? 'high' : score >= THRESHOLDS.medium ? 'medium' : 'low'; }
  function layerScores(ids) {
    return LAYERS.reduce((o, l) => {
      o[l] = noisyOr(ids.filter((id) => SIGN_BY_ID[id].layer === l));
      return o;
    }, {});
  }

  /* ---------------------------------------------------------------
     3. Seeded random numbers
     --------------------------------------------------------------- */
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.normal = () => {
      const u = 1 - next(); const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    return next;
  }

  /* Chance that each warning sign shows up, for a scam and for a genuine item. */
  const P = {
    upfront_payment: [0.35, 0.01], check_clearing: [0.08, 0.0], sensitive_data: [0.25, 0.02],
    guaranteed_returns: [0.2, 0.01], unrealistic_pay: [0.3, 0.03], urgency: [0.4, 0.06],
    instant_hire: [0.25, 0.02], off_platform: [0.25, 0.03], text_model: [0.6, 0.04],
    brand_lookalike: [0.2, 0.01], ip_host: [0.06, 0.0], disguised_link: [0.1, 0.01],
    suspicious_tld: [0.25, 0.03], url_shortener: [0.25, 0.04], no_https: [0.35, 0.05],
    messy_host: [0.2, 0.04], offer_keywords: [0.3, 0.05],
    no_business_info: [0.5, 0.05], suspicious_design: [0.3, 0.04], copied_layout: [0.25, 0.01],
    new_domain: [0.4, 0.06], payment_request: [0.3, 0.01], hidden_redirect: [0.2, 0.01],
    countdown_timer: [0.25, 0.01], forced_signup: [0.35, 0.02],
  };

  /**
   * Draw the warning signs for one item.
   * hasText / hasLink choose which layers can fire. polished = the scam's
   * wording looks clean (a "text-evasive" scam): text signs are rare.
   */
  function drawSigns(rand, { scam, hasText, hasLink, polished }) {
    const ids = [];
    // Real items vary: some scams are subtle, some genuine offers look a little odd.
    const strength = scam ? 0.3 + rand() * 0.85 : 0.6 + rand() * 2.6;
    for (const s of SIGNS) {
      const usable = s.group === 'text' ? hasText : hasLink;
      if (!usable) continue;
      let p = Math.min(0.95, P[s.id][scam ? 0 : 1] * strength);
      if (scam && polished && s.group === 'text') p *= 0.1;
      // A scam that hides its wording tends to rely on the page instead.
      if (scam && polished && s.group !== 'text') p = Math.min(0.9, p * 1.4);
      if (rand() < p) ids.push(s.id);
    }
    return ids;
  }

  /* ---------------------------------------------------------------
     4. Simulated scan log
     --------------------------------------------------------------- */
  const FAIL_REASONS = [
    ['Timeout or error', 0.45], ['Blocked address', 0.25], ['Hop limit exceeded', 0.18], ['Unsupported scheme', 0.12],
  ];
  const DAY = 86400000;

  function generateLog(now, seed = 20261112, days = 60) {
    const rand = rng(seed);
    const rows = [];
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const dow = [0.85, 1.05, 1.08, 1.0, 1.1, 1.12, 0.8]; // Sun..Sat volume
    let n = 0;
    for (let d = days - 1; d >= 0; d--) {
      const dayStart = start.getTime() - d * DAY;
      const growth = 0.85 + 0.3 * ((days - d) / days);
      const count = Math.round(50 * growth * dow[new Date(dayStart).getDay()] * (0.9 + rand() * 0.25));
      for (let i = 0; i < count; i++) {
        // office-hours-heavy time of day
        const hour = Math.min(23.9, Math.max(0, 14 + rand.normal() * 4.5));
        const ts = dayStart + hour * 3600000;
        if (ts > now) continue;
        rows.push(makeScan(rand, ts, n++));
      }
    }
    rows.sort((a, b) => a.ts - b.ts);
    return rows;
  }

  function makeScan(rand, ts, n) {
    const r = rand();
    const inputType = r < 0.46 ? 'text' : r < 0.74 ? 'link' : 'both';
    const hasText = inputType !== 'link';
    const hasLink = inputType !== 'text';
    const row = { id: 's' + n, ts, inputType, live: false };

    if (rand() < 0.01) { // rejected before scoring (empty, too long, bad format)
      return Object.assign(row, { outcome: 'rejected', signs: [], score: null, level: null, layers: null, failure: null, ms: Math.round(30 + rand() * 60) });
    }
    if (hasLink && rand() < 0.135) { // link could not be examined
      let x = rand(); let reason = FAIL_REASONS[0][0];
      for (const [name, p] of FAIL_REASONS) { if ((x -= p) < 0) { reason = name; break; } }
      const ms = reason === 'Timeout or error' ? 15000 + rand() * 4000 : 200 + rand() * 900;
      return Object.assign(row, { outcome: 'unexamined', signs: [], score: null, level: null, layers: null, failure: reason, ms: Math.round(ms) });
    }
    const scam = rand() < 0.42;
    const polished = scam && hasText && rand() < 0.35;
    const signs = drawSigns(rand, { scam, hasText, hasLink, polished });
    const score = scoreOf(signs);
    const base = inputType === 'text' ? 1200 : 10400;
    const ms = Math.max(400, base * Math.exp(rand.normal() * 0.35 - 0.06));
    return Object.assign(row, {
      outcome: 'scored', signs, score, level: levelOf(score), layers: layerScores(signs),
      failure: null, ms: Math.round(ms), polished,
    });
  }

  /* ---------------------------------------------------------------
     5. Filters and aggregation
     --------------------------------------------------------------- */
  function applyFilters(rows, f, now) {
    const to = f.to != null ? f.to : now;
    const from = to - f.days * DAY;
    return rows.filter((r) => r.ts > from && r.ts <= to
      && (f.input === 'all' || r.inputType === f.input)
      && (f.level === 'all' || (r.outcome === 'scored' && r.level === f.level)));
  }

  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

  function kpis(rows) {
    const scored = rows.filter((r) => r.outcome === 'scored');
    const nonRej = rows.filter((r) => r.outcome !== 'rejected');
    const high = scored.filter((r) => r.level === 'high').length;
    const timed = rows.filter((r) => r.outcome !== 'rejected');
    return {
      total: rows.length,
      scored: scored.length,
      highShare: scored.length ? high / scored.length : 0,
      avgScore: mean(scored.map((r) => r.score)),
      completion: nonRej.length ? scored.length / nonRej.length : 0,
      avgMs: mean(timed.map((r) => r.ms)),
    };
  }

  function dayKey(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

  /** One bucket per calendar day for the last N days (empty days included). */
  function byDay(rows, days, now) {
    const today = dayKey(now);
    const out = [];
    for (let i = days - 1; i >= 0; i--) out.push({ day: today - i * DAY, rows: [] });
    const idx = new Map(out.map((o, i) => [o.day, i]));
    rows.forEach((r) => { const i = idx.get(dayKey(r.ts)); if (i != null) out[i].rows.push(r); });
    return out.map((o) => {
      const sc = o.rows.filter((r) => r.outcome === 'scored');
      const k = kpis(o.rows);
      return {
        day: o.day, total: o.rows.length, scored: sc.length,
        low: sc.filter((r) => r.level === 'low').length,
        medium: sc.filter((r) => r.level === 'medium').length,
        high: sc.filter((r) => r.level === 'high').length,
        highShare: k.highShare, avgScore: k.avgScore, completion: k.completion, avgMs: k.avgMs,
      };
    });
  }

  function riskMix(rows) {
    const sc = rows.filter((r) => r.outcome === 'scored');
    return { low: sc.filter((r) => r.level === 'low').length, medium: sc.filter((r) => r.level === 'medium').length, high: sc.filter((r) => r.level === 'high').length };
  }

  function sankey(rows) {
    const types = ['text', 'link', 'both'];
    const outs = ['scored', 'unexamined', 'rejected'];
    const lv = ['low', 'medium', 'high'];
    const inToOut = {}; const outToLevel = {};
    types.forEach((t) => outs.forEach((o) => { inToOut[t + '>' + o] = rows.filter((r) => r.inputType === t && r.outcome === o).length; }));
    lv.forEach((l) => { outToLevel['scored>' + l] = rows.filter((r) => r.outcome === 'scored' && r.level === l).length; });
    return { types, outs, lv, inToOut, outToLevel };
  }

  function histogram(rows) {
    const bins = new Array(10).fill(0);
    rows.filter((r) => r.outcome === 'scored').forEach((r) => { bins[Math.min(9, Math.floor(r.score / 10))]++; });
    return bins;
  }

  function avgLayerByLevel(rows) {
    const out = {};
    ['low', 'medium', 'high'].forEach((l) => {
      const sc = rows.filter((r) => r.outcome === 'scored' && r.level === l);
      out[l] = LAYERS.reduce((o, k) => { o[k] = mean(sc.map((r) => r.layers[k])); return o; }, {});
    });
    return out;
  }

  function pearson(a, b) {
    const n = a.length; if (n < 3) return 0;
    const ma = mean(a); const mb = mean(b);
    let sab = 0; let saa = 0; let sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma; const y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }

  /** Layer correlation, using only scans where all three layers could apply (text + link). */
  function layerCorrelation(rows) {
    const full = rows.filter((r) => r.outcome === 'scored' && r.inputType === 'both');
    const use = full.length >= 20 ? full : rows.filter((r) => r.outcome === 'scored');
    const m = LAYERS.map((a) => LAYERS.map((b) => (a === b ? 1 : pearson(use.map((r) => r.layers[a]), use.map((r) => r.layers[b])))));
    return { layers: LAYERS, matrix: m, n: use.length };
  }

  /** High-risk scans that have a text part and whose wording looks clean. */
  function cleanTextShare(rows) {
    const hi = rows.filter((r) => r.outcome === 'scored' && r.level === 'high' && r.inputType !== 'link');
    if (!hi.length) return 0;
    return hi.filter((r) => r.layers.textual < 0.3).length / hi.length;
  }

  function signPrevalence(rows) {
    const flagged = rows.filter((r) => r.outcome === 'scored' && r.level !== 'low');
    const counts = {};
    flagged.forEach((r) => r.signs.forEach((id) => { counts[id] = (counts[id] || 0) + 1; }));
    return Object.keys(counts).map((id) => ({ id, share: counts[id] / (flagged.length || 1), n: counts[id] }))
      .sort((a, b) => b.share - a.share).concat([]).map((x) => Object.assign(x, { flagged: flagged.length }));
  }

  function signByLevel(rows, ids) {
    const out = {};
    ids.forEach((id) => {
      out[id] = {};
      ['low', 'medium', 'high'].forEach((l) => {
        const sc = rows.filter((r) => r.outcome === 'scored' && r.level === l);
        out[id][l] = sc.length ? sc.filter((r) => r.signs.includes(id)).length / sc.length : 0;
      });
    });
    return out;
  }

  function failureReasons(rows) {
    const un = rows.filter((r) => r.outcome === 'unexamined');
    return FAIL_REASONS.map(([name]) => ({ name, n: un.filter((r) => r.failure === name).length }))
      .map((x) => Object.assign(x, { share: un.length ? x.n / un.length : 0 }));
  }

  function byWeekday(rows) {
    const buckets = [[], [], [], [], [], [], []];
    rows.filter((r) => r.outcome === 'scored').forEach((r) => buckets[(new Date(r.ts).getDay() + 6) % 7].push(r.score));
    return buckets.map(mean); // Mon..Sun
  }

  function msByInput(rows) {
    const o = {};
    ['text', 'link', 'both'].forEach((t) => { o[t] = mean(rows.filter((r) => r.inputType === t && r.outcome !== 'rejected').map((r) => r.ms)); });
    return o;
  }

  /* ---------------------------------------------------------------
     6. Simulated labeled test set + model metrics
     --------------------------------------------------------------- */
  const CONFIGS = [
    { key: 'text',       name: 'Text only',    layers: ['textual'] },
    { key: 'structural', name: '+ Structural', layers: ['textual', 'structural'] },
    { key: 'behavioral', name: '+ Behavioral', layers: ['textual', 'structural', 'behavioral'] },
  ];

  /** 400 held-out messages: 200 scam and 200 genuine, each with wording and a link. */
  function generateTestSet(seed = 1) {
    const rand = rng(seed);
    const rows = [];
    for (let i = 0; i < 400; i++) {
      const scam = i < 200;
      const evasive = scam && rand() < 0.35; // polished, clean-looking wording
      const signs = drawSigns(rand, { scam, hasText: true, hasLink: true, polished: evasive });
      rows.push({ scam, evasive, signs });
    }
    // shuffle (Fisher-Yates)
    for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
    rows.forEach((r) => {
      r.p = CONFIGS.map((c) => noisyOr(r.signs.filter((id) => c.layers.includes(SIGN_BY_ID[id].layer))));
      // The score is shown on a 0..99 scale elsewhere; keep probabilities 0..0.99 here.
      r.p = r.p.map((x) => Math.min(0.99, x));
    });
    return rows;
  }

  function confusion(test, ci, thr) {
    let tp = 0; let fn = 0; let fp = 0; let tn = 0;
    test.forEach((r) => {
      const pred = r.p[ci] >= thr;
      if (r.scam) { if (pred) tp++; else fn++; } else if (pred) fp++; else tn++;
    });
    return { tp, fn, fp, tn };
  }
  function metricsFrom(c) {
    const n = c.tp + c.fn + c.fp + c.tn;
    const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0;
    const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { accuracy: (c.tp + c.tn) / n, precision, recall, f1 };
  }
  function f1Curve(test, ci) {
    const pts = [];
    for (let t = 10; t <= 90; t += 1) pts.push({ t: t / 100, f1: metricsFrom(confusion(test, ci, t / 100)).f1 });
    return pts;
  }
  function tunedThreshold(test, ci) {
    let best = { t: 0.5, f1: -1 };
    f1Curve(test, ci).forEach((p) => { if (p.f1 > best.f1 + 1e-9) best = p; });
    return best.t;
  }
  /** ROC + AUC (trapezoid) from every distinct score. */
  function roc(test, ci) {
    const cuts = Array.from(new Set(test.map((r) => r.p[ci]))).sort((a, b) => b - a);
    const P_ = test.filter((r) => r.scam).length; const N_ = test.length - P_;
    const pts = [{ fpr: 0, tpr: 0 }];
    cuts.forEach((t) => {
      const c = confusion(test, ci, t);
      pts.push({ fpr: c.fp / N_, tpr: c.tp / P_ });
    });
    pts.push({ fpr: 1, tpr: 1 });
    let auc = 0;
    for (let i = 1; i < pts.length; i++) auc += ((pts[i].fpr - pts[i - 1].fpr) * (pts[i].tpr + pts[i - 1].tpr)) / 2;
    return { pts, auc };
  }
  function recallOn(test, ci, thr, filterFn) {
    const sc = test.filter((r) => r.scam && filterFn(r));
    return sc.length ? sc.filter((r) => r.p[ci] >= thr).length / sc.length : 0;
  }
  function evaluateAll(test) {
    return CONFIGS.map((c, ci) => {
      const thr = tunedThreshold(test, ci);
      const conf = confusion(test, ci, thr);
      const m = metricsFrom(conf);
      const r = roc(test, ci);
      return {
        key: c.key, name: c.name, thr, conf, ...m, auc: r.auc, roc: r.pts,
        recallOrdinary: recallOn(test, ci, thr, (x) => !x.evasive),
        recallEvasive: recallOn(test, ci, thr, (x) => x.evasive),
      };
    });
  }

  /* ---------------------------------------------------------------
     7. 3D points, formatting helpers
     --------------------------------------------------------------- */
  function points3d(rows, cap = 140) {
    const scored = rows.filter((r) => r.outcome === 'scored');
    // Text + link scans use all three layers, so they spread through the cube.
    const both = scored.filter((r) => r.inputType === 'both');
    const sc = both.length >= 25 ? both : scored;
    const step = Math.max(1, Math.ceil(sc.length / cap));
    const pts = sc.filter((_, i) => i % step === 0).map((r) => ({
      x: r.layers.textual, y: r.layers.structural, z: r.layers.behavioral,
      level: r.level, input: r.inputType, score: r.score,
      clean: r.level === 'high' && r.inputType !== 'link' && r.layers.textual < 0.3,
    }));
    return { points: pts, subset: sc === both ? 'both' : 'all', total: sc.length };
  }

  function fmtPct(x, d = 0) { return (x * 100).toFixed(d) + '%'; }
  function fmtSecs(ms) { return (ms / 1000).toFixed(1) + 's'; }
  function ago(ts, now) {
    const m = Math.max(0, Math.round((now - ts) / 60000));
    if (m < 1) return '0 min ago';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago';
  }

  return {
    SIGNS, SIGN_BY_ID, META, LAYERS, LEVELS, THRESHOLDS, CONFIGS, FAIL_REASONS, DAY,
    noisyOr, scoreOf, levelOf, layerScores, weights: W,
    generateLog, makeScan, rng, applyFilters, kpis, byDay, riskMix, sankey, histogram,
    avgLayerByLevel, layerCorrelation, cleanTextShare, signPrevalence, signByLevel,
    failureReasons, byWeekday, msByInput, generateTestSet, confusion, metricsFrom, f1Curve,
    tunedThreshold, roc, evaluateAll, points3d, fmtPct, fmtSecs, ago, dayKey, mean,
  };
});
