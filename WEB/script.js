/* =====================================================================
   ISKAMDAR | script.js
   Presentation lives in style.css, markup in index.html.

   1.  Config
   2.  Signal catalogue (single source of truth for labels + weights)
   3.  Detection engine  (route -> text -> link -> page -> score)
   4.  Storage + shared-report encoding
   5.  Small DOM helpers
   6.  Rendering (result, report, dialogs, trends)
   7.  Download (PDF + PNG, no libraries)
   8.  Share + agency reporting
   9.  Page setup + events
   ===================================================================== */
'use strict';

(() => {

  /* ===================================================================
     1. CONFIG
     =================================================================== */
  const CONFIG = Object.freeze({
    // Endpoint that loads the page behind a link and reports what it saw.
    //   POST { url } -> { signals: [ids], evidence: { pageAgeDays, registrar }, flagCount }
    // Only ids with source "page" in SIGNALS below are accepted.
    // Leave '' to score from the link and message text only (no network).
    pageScanEndpoint: '', // text-analysis prototype: no page scan

    // Endpoint that receives agency reports.
    //   POST { agency, score, level, input, urls, flags, note, createdAt } -> { reference }
    // Leave '' for demo mode: nothing is sent and the dialogs say so.
    reportEndpoint: '',

    // Text model (TF-IDF + logistic regression, see textmodel.js made by train_text.py).
    // When textmodel.js is missing or empty the engine falls back to the rules below.
    useTextModel: true,
    // Keep the hand-written text rules as extra signals next to the text model.
    // Set false to score message text with the text model only (as in the proposal).
    useTextRules: true,

    requestTimeoutMs: 15000,
    maxInputLength: 4000,
  });

  // Entry-level pay above this per-day figure (PHP) is treated as unrealistic.
  // ~2.5x the Metro Manila minimum daily wage. A heuristic, not a legal line.
  const HIGH_DAILY_PHP = 2000;
  const VERY_HIGH_DAILY_PHP = 5000;
  const USD_TO_PHP = 56;

  const LEVEL_THRESHOLDS = Object.freeze({ high: 70, medium: 30 });

  const LEVELS = Object.freeze({
    high: {
      label: 'High risk',
      title: 'High risk',
      heading: 'Why the models estimate a high chance of a scam:',
      summary: 'High risk',
    },
    medium: {
      label: 'Suspicious',
      title: 'Suspicious',
      heading: 'Why the models estimate a moderate chance of a scam:',
      summary: 'Suspicious',
    },
    low: {
      label: 'Low risk',
      title: 'Low risk',
      heading: 'What the models checked:',
      summary: 'Low risk',
    },
  });

  const AGENCIES = Object.freeze({
    pnp: { name: 'PNP Anti-Cybercrime', code: 'PNP' },
    dole: { name: 'DOLE / DMW', code: 'DOLE' },
    sec: { name: 'Securities and Exchange Commission EIPD', code: 'SEC' },
  });

  const STORAGE_KEY = 'iskamdar.scan.v1';

  /* ===================================================================
     2. SIGNAL CATALOGUE
     source: text | url | page      severity: danger | warn
     weight: 0..1 chance-style contribution to the noisy-OR score
     =================================================================== */
  const SIGNALS = Object.freeze({
    // ---- message text -------------------------------------------------
    upfront_payment: {
      source: 'text', severity: 'danger', weight: 0.85,
      title: 'Upfront payment requested',
      detail: 'Asks for a fee before you are hired or paid. Real employers never charge for hiring, training or equipment.',
      clause: 'asks you to pay money upfront',
    },
    check_clearing: {
      source: 'text', severity: 'danger', weight: 0.8,
      title: 'Check-clearing setup',
      detail: 'Asks you to deposit a check and spend part of it on equipment. The check bounces days later and the money is taken from you.',
      clause: 'asks you to buy equipment with a check you deposit, a common check-clearing fraud method',
    },
    sensitive_data: {
      source: 'text', severity: 'danger', weight: 0.7,
      title: 'Asks for private details',
      detail: 'Requests passwords, OTPs, card numbers or ID photos. A real employer does not need these to hire you.',
      clause: 'asks for private details such as OTPs, passwords or ID photos',
    },
    guaranteed_returns: {
      source: 'text', severity: 'danger', weight: 0.8,
      title: 'Guaranteed returns',
      detail: 'Promises fixed or risk-free profit. Every real investment carries risk.',
      clause: 'promises guaranteed or risk-free profits',
    },
    unrealistic_pay: {
      source: 'text', severity: 'warn', weight: 0.55,
      title: 'Unrealistic salary',
      detail: 'High pay claimed for entry-level or easy work, far above the market rate.',
      clause: 'promises unrealistically high pay for easy work',
    },
    urgency: {
      source: 'text', severity: 'warn', weight: 0.45,
      title: 'Urgent pressure tactics',
      detail: 'Phrases like "limited slots" push you to decide before you can check anything.',
      clause: 'uses urgent pressure tactics to rush your decision',
    },
    instant_hire: {
      source: 'text', severity: 'warn', weight: 0.3,
      title: 'Hired without an interview',
      detail: 'You are told you are hired or selected without any application, interview or assessment.',
      clause: 'says you are hired without an interview',
    },
    off_platform: {
      source: 'text', severity: 'warn', weight: 0.3,
      title: 'Moves the chat off-platform',
      detail: 'Pushes you to Telegram, WhatsApp or Viber, where there is no record and no accountability.',
      clause: 'pushes you to continue on a private chat app',
    },

    text_model: {
      source: 'text', severity: 'danger', weight: 0.5,
      title: 'Wording matches known scam messages',
      detail: 'The words in this message are similar to scam messages the text model learned from.',
      clause: 'uses wording that matches known scam messages',
    },

    // ---- link ---------------------------------------------------------
    brand_lookalike: {
      source: 'url', severity: 'danger', weight: 0.65,
      title: 'Look-alike link',
      detail: 'The address imitates a well-known brand or agency but is not its official domain.',
      clause: 'uses a link that imitates a well-known brand',
    },
    ip_host: {
      source: 'url', severity: 'danger', weight: 0.5,
      title: 'Link is a raw IP address',
      detail: 'Real companies use a name, not a bare number, for their website.',
      clause: 'uses a raw IP address instead of a website name',
    },
    disguised_link: {
      source: 'url', severity: 'danger', weight: 0.5,
      title: 'Disguised link',
      detail: 'The address uses tricks (an "@" sign or look-alike characters) to hide where it really goes.',
      clause: 'uses a disguised web address',
    },
    suspicious_tld: {
      source: 'url', severity: 'warn', weight: 0.3,
      title: 'Unusual web address ending',
      detail: 'Ends in .xyz, .top or a similar extension that scammers buy cheaply.',
      clause: 'sits on a cheap, unusual web address ending',
    },
    url_shortener: {
      source: 'url', severity: 'warn', weight: 0.3,
      title: 'Shortened link',
      detail: 'A link shortener hides the real destination until after you click.',
      clause: 'hides its real destination behind a shortened link',
    },
    no_https: {
      source: 'url', severity: 'warn', weight: 0.2,
      title: 'Not using HTTPS',
      detail: 'The connection is not encrypted. Never enter personal details on it.',
      clause: 'does not use a secure connection',
    },
    messy_host: {
      source: 'url', severity: 'warn', weight: 0.2,
      title: 'Cluttered web address',
      detail: 'Many hyphens or sub-domains are a common way to look official.',
      clause: 'uses a cluttered web address',
    },
    offer_keywords: {
      source: 'url', severity: 'warn', weight: 0.15,
      title: 'Offer-style web address',
      detail: 'The address is built around job or money keywords. Check the company yourself.',
      clause: 'uses an address built around job or money keywords',
    },

    // ---- page (reported by the scan endpoint) -------------------------
    no_business_info: {
      source: 'page', severity: 'danger', weight: 0.55,
      title: 'No verifiable business info',
      detail: 'The page names no registered company or address.',
      clause: 'names no registered company or address',
    },
    payment_request: {
      source: 'page', severity: 'danger', weight: 0.7,
      title: 'Payment requested on the page',
      detail: 'The page asks for a fee or payment before hiring.',
      clause: 'asks for a payment on the page',
    },
    hidden_redirect: {
      source: 'page', severity: 'danger', weight: 0.6,
      title: 'Hidden redirect',
      detail: 'The page sends you somewhere else without telling you.',
      clause: 'redirects you without telling you',
    },
    copied_layout: {
      source: 'page', severity: 'danger', weight: 0.6,
      title: 'Copied layout',
      detail: 'The design copies a known company or agency page.',
      clause: 'copies the layout of a known company or agency',
    },
    countdown_timer: {
      source: 'page', severity: 'warn', weight: 0.45,
      title: 'Countdown timer',
      detail: 'A fake clock is pushing you to decide fast.',
      clause: 'shows a countdown timer to rush you',
    },
    forced_signup: {
      source: 'page', severity: 'warn', weight: 0.4,
      title: 'Forced sign-up',
      detail: 'The page demands an account or personal details before showing anything.',
      clause: 'forces you to sign up before showing anything',
    },
    new_domain: {
      source: 'page', severity: 'warn', weight: 0.4,
      title: 'Very new website',
      detail: 'The domain was registered only days ago.',
      clause: 'sits on a website registered only days ago',
    },
  });

  const NEW_DOMAIN_DAYS = 30;

  /* ===================================================================
     3. DETECTION ENGINE
     =================================================================== */

  /* ---- 3a. Routing: link, message, or both ------------------------- */

  const BARE_TLDS = [
    'com', 'net', 'org', 'ph', 'io', 'co', 'me', 'ly', 'xyz', 'top', 'info', 'biz', 'site', 'online',
    'shop', 'click', 'link', 'work', 'club', 'live', 'app', 'dev', 'gov', 'edu', 'ai', 'to', 'cc', 'tk',
    'ml', 'ga', 'cf', 'gq', 'icu', 'buzz', 'cfd', 'sbs', 'rest', 'store', 'vip', 'fun', 'life', 'pro',
    'tech', 'cyou', 'quest', 'monster', 'loan', 'ws', 'us', 'uk',
  ].join('|');

  const URL_PATTERN = new RegExp(
    '(?:https?:\\/\\/|www\\.)[^\\s<>"\'`]+' +
    '|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:' + BARE_TLDS + ')(?![a-z0-9-])(?::\\d+)?(?:\\/[^\\s<>"\'`]*)?',
    'gi'
  );

  function toUrl(raw) {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    try {
      const url = new URL(withScheme);
      return url.hostname.includes('.') || url.hostname.startsWith('[') ? url : null;
    } catch {
      return null;
    }
  }

  function routeInput(input) {
    const urls = [];
    let rest = input;
    for (const m of input.matchAll(URL_PATTERN)) {
      const prev = input[m.index - 1];
      if (prev && /[@\w.-]/.test(prev)) continue; // part of an e-mail or a longer token
      const raw = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
      const url = toUrl(raw);
      if (!url) continue;
      urls.push(url);
      rest = rest.replace(m[0], ' ');
    }
    const leftover = rest.replace(/\s+/g, ' ').trim();
    let kind = 'message';
    if (urls.length) kind = leftover.length >= 12 ? 'both' : 'link';
    return { kind, urls, text: input, leftover };
  }

  /* ---- 3b. Text analysis ------------------------------------------ */

  const NEGATION = /\b(?:no|not|never|without|zero|free of|don'?t|doesn'?t|huwag|wag|hindi|maniwala|babala)\b[^.!?\n]*$/i;

  function matches(text, re, { unnegated = false } = {}) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of text.matchAll(g)) {
      if (!unnegated) return true;
      const before = text.slice(Math.max(0, m.index - 30), m.index);
      if (!NEGATION.test(before)) return true;
    }
    return false;
  }

  const TEXT_RULES = [
    {
      id: 'upfront_payment', unnegated: true,
      patterns: [
        /\b(?:processing|registration|training|onboarding|activation|application|medical|uniform|reservation|clearance|slot)\s+(?:fees?|payments?|charges?)\b/i,
        /\b(?:send|pay|deposit|transfer|remit)\b[^.!?\n]{0,40}\b(?:fees?|gcash|maya|paymaya|crypto|bitcoin|gift ?cards?)\b/i,
        /\b(?:pay|send)\b[^.!?\n]{0,25}(?:₱|php\s?)\d/i,
        // Tagalog / Taglish: "Mag-send ng P1,000", "magbayad ng P5,000", "mag-deposit ng P500"
        /\bmag-?(?:send|deposit|top ?up|bayad|padala|load)\b[^.!?\n]{0,30}\d/i,
      ],
    },
    {
      id: 'check_clearing', unnegated: true,
      patterns: [
        /\b(?:digital|mobile|cashier'?s?|personal)\s+che(?:ck|que)s?\b/i,
        /\b(?:deposit|cash)\b[^.!?\n]{0,30}\bche(?:ck|que)s?\b/i,
      ],
    },
    {
      id: 'sensitive_data', unnegated: true,
      patterns: [
        /\b(?:send|provide|share|submit|give|enter)\b[^.!?\n]{0,40}\b(?:otp|one[- ]time (?:pin|password|code)|password|pin(?: code)?|cvv|card number|bank (?:details|account)|selfie with (?:your )?id|id (?:photo|picture|selfie))\b/i,
        /\b(?:ibigay|ipadala|i-?send|i-?share|ilagay)\b[^.!?\n]{0,40}\b(?:otp|password|pin|gcash number|account number|bank details)\b/i,
      ],
    },
    {
      id: 'guaranteed_returns', unnegated: true,
      patterns: [
        /\b(?:guaranteed|sure|risk[- ]?free|no[- ]risk)\b[^.!?\n]{0,30}\b(?:profits?|returns?|income|earnings|payouts?)\b/i,
        /\bdouble (?:your|the) (?:money|investment)\b/i,
        /\b\d{2,3}\s?%\s*(?:daily|weekly|monthly|per (?:day|week|month)|roi|returns?)\b/i,
        // Tagalog / Taglish: "dodoble ang pera", "kikita ka ng P1,500", "walang talo/lugi/risk", "garantisado"
        /\b(?:dodoble|doblehin|doble|triplehin)\b[^.!?\n]{0,30}\b(?:pera|puhunan|investment|kita)\b/i,
        /\bkikita\s+(?:ka|ng)\b[^.!?\n]{0,40}(?:₱|php|\bp)\s?\d/i,
        /\bwala(?:ng)?\s+(?:talo|lugi|risk|panganib)\b/i,
        /\bgarantisad[oa]\b/i,
      ],
    },
    {
      id: 'urgency',
      patterns: [
        /\b(?:limited (?:slots?|spots?|time|offer)|(?:slots?|spots?)\s+(?:are\s+)?(?:left|limited|filling)|only \d+\s+(?:slots?|spots?)|act now|hurry|last chance|today only|expires?\b|claim (?:your|the) (?:spot|slot)|within \d+\s*(?:hours?|hrs?|minutes?|mins?)|don'?t miss)/i,
        /\b(?:apply|reply|respond|pay|send)\b[^.!?\n]{0,15}\b(?:now|today|immediately|asap)\b/i,
        /\blimitado(?:ng)?\s+(?:slots?|puwesto|pagkakataon)\b/i,
        /\bngayon\s+(?:na|din)\b/i,
      ],
    },
    {
      id: 'instant_hire',
      patterns: [
        /\b(?:you'?re hired|you are hired|congratulations|congrats|you(?:'ve| have) been (?:selected|chosen|hired)|no interview|hired (?:already|immediately|instantly))\b/i,
        /\b(?:walang\s+interview|ikaw ay napili|napili ka|pumasa ka na|pasado ka na|pass ka na)\b/i,
      ],
    },
    {
      id: 'off_platform',
      patterns: [/\b(?:telegram|whatsapp|viber|wechat)\b/i, /\bt\.me\//i, /\bwa\.me\//i],
    },
  ];

  const PAY_RE = /(₱|php|\$|usd)?\s?(\d+(?:\.\d+)?)\s?(k)?\s*(pesos|php|usd|dollars)?\s*(?:\/|per\s+|a\s+|every\s+|each\s+|kada\s+|bawat\s+)?(hours?|hrs?|hourly|days?|daily|weeks?|weekly|months?|monthly|araw|linggo|buwan|oras)\b/gi;
  const PER_DAY = { hour: 8, hr: 8, day: 1, week: 0.2, month: 1 / 22 };
  const EASY_WORK = /\b(?:no experience|entry[- ]level|easy|simple|just|only|part[- ]?time|from home|few (?:hours|minutes)|no (?:skills|degree)|anyone can|beginner|data entry|typing|tasks?|walang\s+(?:experience|puhunan|interview)|madali(?:ng)?|kahit\s+sino|sa\s+bahay|home[- ]?based)\b/i;

  function periodKey(word) {
    const w = word.toLowerCase();
    if (w.startsWith('h') || w.startsWith('or')) return 'hour';
    if (w.startsWith('d') || w.startsWith('ar')) return 'day';
    if (w.startsWith('w') || w.startsWith('li')) return 'week';
    return 'month';
  }

  /** Returns a weight (0 if the pay looks normal). */
  function detectUnrealisticPay(text) {
    const clean = text.replace(/(\d),(?=\d{3}\b)/g, '$1');
    const easy = EASY_WORK.test(clean);
    let best = 0;
    for (const m of clean.matchAll(PAY_RE)) {
      let amount = parseFloat(m[2]) * (m[3] ? 1000 : 1);
      if (!Number.isFinite(amount)) continue;
      const usd = /^(?:\$|usd)$/i.test(m[1] || '') || /^(?:usd|dollars)$/i.test(m[4] || '');
      if (usd) amount *= USD_TO_PHP;
      const daily = amount * PER_DAY[periodKey(m[5])];
      if (daily >= VERY_HIGH_DAILY_PHP || (daily >= HIGH_DAILY_PHP && easy)) {
        best = Math.max(best, easy ? SIGNALS.unrealistic_pay.weight : 0.35);
      }
    }
    return best;
  }

  function analyzeText(text) {
    const found = [];
    for (const rule of TEXT_RULES) {
      if (rule.patterns.some((re) => matches(text, re, { unnegated: rule.unnegated }))) {
        found.push({ id: rule.id });
      }
    }
    const payWeight = detectUnrealisticPay(text);
    if (payWeight) found.push({ id: 'unrealistic_pay', weight: payWeight });
    return found;
  }

  /* ---- 3b-2. Text model (TF-IDF + logistic regression) -------------- */

  const TEXT_MODEL = window.IskTextModel || null;
  const ML_SKIP = new Set(['num', 'url', 'phone', 'email', 'at', 'and', 'to', 'the', 'of', 'in', 'is', 'a', 'an', 'you', 'your',
    'we', 'for', 'on', 'or', 'po', 'na', 'ng', 'sa', 'mo', 'ka', 'ang', 'get', 'now', 'will', 'from', 'with', 'are']);

  /** Returns { p, score, signal } or null when no trained text model is loaded. */
  function analyzeTextModel(text) {
    if (!CONFIG.useTextModel || !TEXT_MODEL || typeof TEXT_MODEL.score !== 'function') return null;
    const r = TEXT_MODEL.score(text);
    if (!r || r.known === 0) return { p: null, score: null, signal: null, known: 0 };
    const t1 = (TEXT_MODEL.meta && TEXT_MODEL.meta.t1) || 0.3;
    let signal = null;
    if (r.p >= t1) {
      const words = r.contrib
        .filter((x) => x.c > 0 && !x.term.split(' ').every((w) => ML_SKIP.has(w)))
        .sort((a, b) => b.c - a.c)
        .slice(0, 3)
        .map((x) => '\u201c' + x.term.replace(/\bnum\b/g, '#').replace(/\burl\b/g, 'link') + '\u201d');
      const list = words.length ? ' (' + words.join(', ') + ')' : '';
      signal = {
        id: 'text_model',
        weight: r.p,
        detail: `Wording similar to scam messages the text model learned from${list}. It estimates a ${r.score}% chance of a scam.`,
        clause: `uses wording that matches known scam messages${list}`,
      };
    }
    return { p: r.p, score: r.score, signal, known: r.known };
  }

  /* ---- 3c. Link analysis ------------------------------------------ */

  const SUSPICIOUS_TLDS = new Set([
    'xyz', 'top', 'click', 'work', 'loan', 'icu', 'buzz', 'cfd', 'sbs', 'rest', 'gq', 'tk', 'ml', 'cf', 'ga',
    'monster', 'cyou', 'quest',
  ]);
  const SHORTENERS = new Set([
    'bit.ly', 'tinyurl.com', 't.co', 'cutt.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'ow.ly', 'buff.ly', 'tiny.cc', 's.id',
  ]);
  const SECOND_LEVELS = new Set(['com', 'co', 'gov', 'org', 'net', 'edu', 'ac']);
  const BRANDS = [
    { token: 'gcash', official: ['gcash.com'] },
    { token: 'paypal', official: ['paypal.com'] },
    { token: 'facebook', official: ['facebook.com'] },
    { token: 'jobstreet', official: ['jobstreet.com', 'jobstreet.com.ph'] },
    { token: 'linkedin', official: ['linkedin.com'] },
    { token: 'indeed', official: ['indeed.com', 'ph.indeed.com'] },
    { token: 'unionbank', official: ['unionbankph.com'] },
    { token: 'metrobank', official: ['metrobank.com.ph'] },
    { token: 'lazada', official: ['lazada.com.ph', 'lazada.com'] },
    { token: 'shopee', official: ['shopee.ph', 'shopee.com'] },
    { token: 'philhealth', official: ['philhealth.gov.ph'] },
    { token: 'pagibig', official: ['pagibigfund.gov.ph'] },
    { token: 'maya', official: ['maya.ph'], exact: true },
    { token: 'bdo', official: ['bdo.com.ph'], exact: true },
    { token: 'bpi', official: ['bpi.com.ph'], exact: true },
    { token: 'sss', official: ['sss.gov.ph'], exact: true },
    { token: 'dole', official: ['dole.gov.ph'], exact: true },
    { token: 'dmw', official: ['dmw.gov.ph'], exact: true },
    { token: 'sec', official: ['sec.gov.ph'], exact: true },
  ];
  const OFFER_WORDS = /(?:job-?offer|hiring-?now|work-?from-?home|earn-?(?:fast|daily|money)|easy-?money|investment|crypto|double|profit|loan|claim|prize|giveaway)/i;

  function registrableDomain(host) {
    const labels = host.split('.');
    if (labels.length <= 2) return host;
    const tld = labels[labels.length - 1];
    const sld = labels[labels.length - 2];
    return tld.length === 2 && SECOND_LEVELS.has(sld) ? labels.slice(-3).join('.') : labels.slice(-2).join('.');
  }

  function analyzeUrl(url) {
    const ids = [];
    const host = url.hostname.toLowerCase();
    const tld = host.split('.').pop();
    const parts = host.split(/[.-]/);
    const registrable = registrableDomain(host);

    if (url.protocol === 'http:') ids.push('no_https');
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) ids.push('ip_host');
    if (url.username || url.password || host.includes('xn--')) ids.push('disguised_link');
    if (SUSPICIOUS_TLDS.has(tld)) ids.push('suspicious_tld');
    if (SHORTENERS.has(registrable)) ids.push('url_shortener');
    if ((host.match(/-/g) || []).length >= 3 || host.split('.').length >= 5) ids.push('messy_host');
    if (OFFER_WORDS.test(host + url.pathname)) ids.push('offer_keywords');

    const lookalike = BRANDS.some(({ token, official, exact }) => {
      const hit = exact ? parts.includes(token) : parts.some((p) => p === token || (p.length > token.length && p.includes(token)));
      return hit && !official.includes(registrable);
    });
    if (lookalike) ids.push('brand_lookalike');

    return ids.map((id) => ({ id }));
  }

  /* ---- 3d. Page scan (optional backend) ---------------------------- */

  async function scanPage(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
    try {
      const res = await fetch(CONFIG.pageScanEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('Scan failed: HTTP ' + res.status);
      return normalizeScan(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeScan(data) {
    const ids = Array.isArray(data?.signals)
      ? data.signals.filter((id) => typeof id === 'string' && SIGNALS[id]?.source === 'page')
      : [];
    const ev = data?.evidence ?? {};
    const pageAgeDays = Number.isFinite(ev.pageAgeDays) && ev.pageAgeDays >= 0 ? Math.round(ev.pageAgeDays) : null;
    if (pageAgeDays !== null && pageAgeDays < NEW_DOMAIN_DAYS && !ids.includes('new_domain')) ids.push('new_domain');
    return {
      ids,
      evidence: {
        pageAgeDays,
        registrar: typeof ev.registrar === 'string' ? ev.registrar.slice(0, 60) : null,
      },
      flagCount: Number.isInteger(data?.flagCount) && data.flagCount >= 0 ? data.flagCount : null,
    };
  }

  /* ---- 3e. Scoring ------------------------------------------------- */

  /** Noisy-OR: each independent warning sign raises the risk without ever passing 100. */
  function scoreSignals(signals) {
    const safe = signals.reduce((p, s) => p * (1 - s.weight), 1);
    return Math.min(99, Math.round((1 - safe) * 100));
  }

  function levelFor(score) {
    if (score >= LEVEL_THRESHOLDS.high) return 'high';
    if (score >= LEVEL_THRESHOLDS.medium) return 'medium';
    return 'low';
  }

  function detectCategory(input, signals) {
    const ids = new Set(signals.map((s) => s.id));
    const job = /\b(?:job|hiring|hired|vacanc|position|salary|work[- ]from[- ]home|recruit|applicant|application|employ)/i.test(input)
      || ['unrealistic_pay', 'instant_hire', 'check_clearing'].some((id) => ids.has(id));
    const investment = /\b(?:invest|returns?|profit|trading|trader|crypto|forex|capital|loan|dividend|roi)\b/i.test(input)
      || ids.has('guaranteed_returns');
    if (job && investment) return 'both';
    if (job) return 'job';
    if (investment) return 'investment';
    return 'general';
  }

  function displayFor(routed) {
    if (!routed.urls.length) return 'Message text scan';
    const u = routed.urls[0];
    const shown = (u.hostname + u.pathname).replace(/\/$/, '');
    return shown.length > 60 ? shown.slice(0, 57) + '…' : shown;
  }

  function newId() {
    const rand = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
    return Date.now().toString(36) + rand;
  }

  /** The whole pipeline: input -> routing -> text -> link -> page -> score. */
  async function analyze(rawInput) {
    const input = String(rawInput).trim().slice(0, CONFIG.maxInputLength);
    // Text-analysis prototype: everything is treated as message text.
    const routed = { kind: 'message', urls: [], text: input, leftover: input };
    const found = new Map();
    const add = ({ id, weight, ...extra }) => {
      if (!SIGNALS[id] || found.has(id)) return;
      found.set(id, { id, weight: weight ?? SIGNALS[id].weight, ...extra });
    };

    let textModel = null;
    if (routed.kind !== 'link') {
      textModel = analyzeTextModel(input);
      if (textModel?.signal) add(textModel.signal);
      if (CONFIG.useTextRules || !textModel) analyzeText(input).forEach(add);
    }
    routed.urls.forEach((u) => analyzeUrl(u).forEach(add));

    let pageScanned = false;
    let evidence = {};
    let flagCount = null;
    if (routed.urls.length && CONFIG.pageScanEndpoint) {
      try {
        const scan = await scanPage(routed.urls[0].href);
        scan.ids.forEach((id) => add({ id }));
        evidence = scan.evidence;
        flagCount = scan.flagCount;
        pageScanned = true;
      } catch (err) {
        console.warn('Page scan unavailable, scoring from link and text only.', err);
      }
    }

    const signals = [...found.values()].sort((a, b) => b.weight - a.weight);
    const score = scoreSignals(signals);
    return {
      id: newId(),
      createdAt: Date.now(),
      kind: routed.kind,
      input,
      urls: routed.urls.map((u) => u.href),
      display: displayFor(routed),
      signals,
      score,
      level: levelFor(score),
      category: detectCategory(input, signals),
      pageScanned,
      evidence,
      flagCount,
      textScore: textModel?.score ?? null,
    };
  }

  /* ---- 3f. Wording ------------------------------------------------- */

  const sig = (s) => ({ ...SIGNALS[s.id], ...s });

  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function buildExplanation(scan) {
    if (scan.level === 'low') {
      return 'No major warning signs were found in what you shared. That does not prove it is safe: confirm the company yourself before you share details or pay anything.';
    }
    const subject = scan.kind === 'message' ? 'message' : scan.kind === 'link' ? 'link' : 'offer';
    const clauses = scan.signals.slice(0, 4).map((s) => sig(s).clause);
    return scan.level === 'high'
      ? `This ${subject} ${joinList(clauses)}.`
      : `This ${subject} shows some warning signs. It ${joinList(clauses)}.`;
  }

  function buildNote(scan) {
    return '';
  }

  /* ===================================================================
     4. STORAGE + SHARED-REPORT ENCODING
     =================================================================== */

  const store = {
    get() {
      try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
    },
    set(value) {
      try { sessionStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable */ }
    },
  };

  function loadScan() {
    const raw = store.get();
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      if (!s || typeof s.score !== 'number' || !LEVELS[s.level] || !Array.isArray(s.signals)) return null;
      s.signals = s.signals.filter((x) => x && SIGNALS[x.id]);
      return s;
    } catch {
      return null;
    }
  }

  const b64url = {
    encode(str) {
      const bytes = new TextEncoder().encode(str);
      let bin = '';
      bytes.forEach((b) => { bin += String.fromCharCode(b); });
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode(str) {
      const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
      return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    },
  };

  /** A shared link carries the verdict only: no message text, no query strings, no name. */
  function makeShareLink(scan) {
    const payload = { v: 1, s: scan.score, d: scan.display, f: scan.signals.map((x) => x.id) };
    return location.href.split('#')[0] + '#r=' + b64url.encode(JSON.stringify(payload));
  }

  function parseSharedScan(token) {
    try {
      const p = JSON.parse(b64url.decode(token));
      if (p?.v !== 1 || !Number.isFinite(p.s)) return null;
      const score = Math.max(0, Math.min(99, Math.round(p.s)));
      const ids = Array.isArray(p.f) ? [...new Set(p.f)].filter((id) => SIGNALS[id]).slice(0, 12) : [];
      return {
        id: 'shared',
        shared: true,
        createdAt: null,
        kind: 'shared',
        input: '',
        urls: [],
        display: typeof p.d === 'string' ? p.d.slice(0, 80) : 'Shared report',
        signals: ids.map((id) => ({ id, weight: SIGNALS[id].weight })),
        score,
        level: levelFor(score),
        category: 'general',
        pageScanned: false,
        evidence: {},
        flagCount: null,
      };
    } catch {
      return null;
    }
  }

  /* ===================================================================
     5. DOM HELPERS
     =================================================================== */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value);
    }
    [].concat(children).forEach((c) => c && node.append(c));
    return node;
  }

  function icon(id, cls = 'icon') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + id);
    svg.append(use);
    return svg;
  }

  function setRing(wrap, score, level) {
    wrap.dataset.level = level;
    const value = $('.ring__value', wrap);
    value.style.strokeDashoffset = '100';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      value.style.strokeDashoffset = String(100 - score);
    }));
  }

  let toastTimer;
  function toast(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = el('textarea', { 'aria-hidden': 'true', class: 'sr-only' });
      area.value = text;
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { /* ignore */ }
      area.remove();
      return ok;
    }
  }

  function formatTime(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return new Date(ts).toString();
    }
  }

  const redFlagCount = (scan) => `${scan.signals.length} red flag${scan.signals.length === 1 ? '' : 's'}`;

  /* ===================================================================
     6. RENDERING
     =================================================================== */
  const state = { scan: null, sharedMode: false, lastInput: null, submitAgency: null, lastReference: null };

  function renderResult(scan) {
    const meta = LEVELS[scan.level];
    $('#result-panel').dataset.level = scan.level;
    $('#result-title').textContent = meta.title;
    $('#result-explain-heading').textContent = meta.heading;
    $('#result-explanation').textContent = buildExplanation(scan);
    $('#result-level-pill').textContent = meta.label;
    $('#result-ring-score').textContent = scan.score + '%';
    $('use', $('#result-icon')).setAttribute('href', scan.level === 'low' ? '#i-shield-check' : '#i-alert');
    setRing($('#result-ring'), scan.score, scan.level);

    const note = buildNote(scan);
    const noteEl = $('#result-note');
    noteEl.textContent = note;
    noteEl.hidden = !note;
  }

  function findingRow(s) {
    const info = sig(s);
    const ic = info.severity === 'danger' ? icon('i-x', 'findings__icon') : icon('i-alert', 'findings__icon findings__icon--warn');
    return el('li', {}, [ic, el('p', {}, [el('strong', { text: info.title + '.' }), ' ' + info.detail])]);
  }

  function renderReport(scan) {
    const content = $('#report-content');
    const actions = $('#report-actions');
    const empty = $('#report-empty');
    const sharedCta = $('#shared-cta');

    empty.hidden = Boolean(scan);
    content.hidden = !scan;
    actions.hidden = !scan || Boolean(scan?.shared);
    sharedCta.hidden = !scan?.shared;
    if (!scan) return;

    const meta = LEVELS[scan.level];
    $('#report-summary').dataset.level = scan.level;
    $('#report-verdict').textContent = meta.summary;
    $('#report-subject').textContent = scan.display;
    $('#report-ring-score').textContent = scan.score + '%';
    setRing($('#report-ring'), scan.score, scan.level);

    const list = $('#findings');
    list.replaceChildren();
    if (scan.signals.length) {
      scan.signals.forEach((s) => list.append(findingRow(s)));
    } else {
      list.append(el('li', {}, [
        icon('i-shield-check', 'findings__icon findings__icon--ok'),
        el('p', {}, [el('strong', { text: 'No red flags found.' }), ' Nothing in what you shared matched our scam patterns.']),
      ]));
    }

    const note = buildNote(scan);
    const noteEl = $('#report-note');
    noteEl.textContent = note;
    noteEl.hidden = !note;

    // Agencies: mark the best match for this kind of scam.
    const best = {
      pnp: scan.category === 'general',
      dole: scan.category === 'job' || scan.category === 'both',
      sec: scan.category === 'investment' || scan.category === 'both',
    };
    $$('.agency').forEach((row) => {
      const key = row.dataset.agencyRow;
      row.dataset.recommended = String(Boolean(best[key]));
      $('.agency__tag', row).hidden = !best[key];
    });

    $('#flag-count').textContent = scan.flagCount !== null
      ? `This kind of offer has been flagged ${scan.flagCount} times this month.`
      : 'Share this report to warn the people you know.';
  }

  function renderDeep(scan) {
    const flags = $('#deep-flags');
    flags.replaceChildren();
    if (!scan.signals.length) {
      flags.append(el('li', {}, [
        icon('i-shield-check', 'flags__icon flags__icon--warn'),
        el('span', { class: 'flags__title', text: 'No red flags' }),
        el('span', { class: 'flags__text', text: 'Nothing in what you shared matched our scam patterns.' }),
      ]));
    }
    scan.signals.slice(0, 6).forEach((s) => {
      const info = sig(s);
      flags.append(el('li', {}, [
        icon('i-alert', 'flags__icon' + (info.severity === 'warn' ? ' flags__icon--warn' : '')),
        el('span', { class: 'flags__title', text: info.title }),
        el('span', { class: 'flags__text', text: info.detail }),
      ]));
    });

    const ev = scan.evidence || {};
    const rows = [
      ['Page age', ev.pageAgeDays != null ? `${ev.pageAgeDays} day${ev.pageAgeDays === 1 ? '' : 's'}` : 'Not checked'],
      ['Domain registrar', ev.registrar || 'Not checked'],
      ['Page scan', scan.pageScanned ? 'Completed' : scan.urls.length ? 'Not available' : 'No link given'],
      ['Known scam pattern match', { high: 'High', medium: 'Moderate', low: 'Low' }[scan.level]],
    ];
    const body = $('#deep-evidence');
    body.replaceChildren(...rows.map(([metric, result]) => el('tr', {}, [el('td', { text: metric }), el('td', { text: result })])));
  }

  function fillPreview(prefix, scan) {
    const meta = LEVELS[scan.level];
    $(`#${prefix}-verdict`).textContent = meta.summary;
    $(`#${prefix}-subject`).textContent = scan.display;
    $(`#${prefix}-score`).textContent = scan.score + '%';
    $(`#${prefix === 'dl' ? 'dl-preview' : 'sh-preview'}`).dataset.level = scan.level;
    setRing($(`#${prefix}-ring`), scan.score, scan.level);
  }

  function prepareDownload(scan) {
    fillPreview('dl', scan);
    $('#dl-found-label').textContent = scan.signals.length ? `What we found (${redFlagCount(scan)})` : 'What we found (no red flags)';
    const timeBox = $('input[name="inc-time"]');
    timeBox.disabled = !scan.createdAt;
    timeBox.checked = Boolean(scan.createdAt);
    syncDownloadLabel();
  }

  function prepareShare(scan) {
    fillPreview('sh', scan);
    $('#share-link').value = makeShareLink(scan);
  }

  function renderTrends() {
    const groups = [
      ['text', 'What the message says', 'Scam language that shows up in SMS messages and job posts.'],
      ['url', 'What the link looks like', 'Tricks in the web address itself.'],
      ['page', 'What the page does', 'Behavior and design found by loading the real page.'],
    ];
    const root = $('#trends-groups');
    root.replaceChildren(...groups.map(([source, title, blurb]) => {
      const cards = Object.values(SIGNALS)
        .filter((s) => s.source === source)
        .sort((a, b) => b.weight - a.weight)
        .map((s) => el('article', { class: 'trend-card', 'data-severity': s.severity }, [
          el('div', { class: 'trend-card__head' }, [el('span', { class: 'trend-card__sev' }), el('h3', { text: s.title })]),
          el('p', { text: s.detail }),
        ]));
      return el('section', { class: 'trends__group' }, [
        el('h2', { text: title }),
        el('p', { text: blurb }),
        el('div', { class: 'trends__cards' }, cards),
      ]);
    }));
  }

  /* ---- Dialog helpers ------------------------------------------------ */

  function openDialog(id) {
    const needsScan = { 'dlg-deep': renderDeep, 'dlg-download': prepareDownload, 'dlg-share': prepareShare };
    if (needsScan[id]) {
      if (!state.scan) { toast('Check a link or message first.'); return; }
      needsScan[id](state.scan);
    }
    $$('dialog[open]').forEach((d) => d.close());
    $('#' + id).showModal();
  }

  function closeAllDialogs() {
    $$('dialog[open]').forEach((d) => d.close());
  }

  /* ===================================================================
     7. DOWNLOAD (PDF + PNG without libraries)
     =================================================================== */

  const LEVEL_RGB = { high: [0.933, 0.11, 0.145], medium: [0.96, 0.647, 0.141], low: [0.122, 0.616, 0.341] };
  const LEVEL_HEX = { high: '#ee1c25', medium: '#f5a524', low: '#1f9d57' };

  function reportModel(scan, opts) {
    return {
      scan,
      showScore: opts.score,
      showFound: opts.found,
      time: opts.time ? formatTime(scan.createdAt) : '',
      flags: scan.signals.map((s) => {
        const info = sig(s);
        return { title: info.title, detail: info.detail, severity: info.severity };
      }),
    };
  }

  function pdfSafe(str) {
    return String(str)
      .replace(/₱/g, 'PHP ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/[·•]/g, '-')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[^\x20-\x7E]/g, '');
  }

  function wrapByChars(str, size, maxWidth) {
    const perLine = Math.max(10, Math.floor(maxWidth / (size * 0.5)));
    const words = pdfSafe(str).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > perLine) { lines.push(line); line = w; } else { line = (line + ' ' + w).trim(); }
    }
    if (line) lines.push(line);
    return lines;
  }

  function buildPdf(model) {
    const { scan } = model;
    const W = 595, H = 842, M = 48;
    const ops = [];
    const esc = (s) => pdfSafe(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const text = (str, x, y, size, font = 'F1', rgb = [0.05, 0.1, 0.17]) => {
      ops.push(`BT /${font} ${size} Tf ${rgb.join(' ')} rg ${x} ${y} Td (${esc(str)}) Tj ET`);
    };
    const rgb = LEVEL_RGB[scan.level];

    ops.push('0.106 0.125 0.224 rg 0 782 595 60 re f');
    text('ISKAMDAR', M, 804, 22, 'F2', [1, 1, 1]);
    text('Scam check report', W - M - 100, 806, 11, 'F1', [0.82, 0.86, 0.93]);

    let y = 740;
    if (model.showScore) {
      text(String(scan.score), M, y - 30, 54, 'F2', rgb);
      text('/ 100', M + String(scan.score).length * 30 + 8, y - 30, 16, 'F1', [0.42, 0.45, 0.53]);
      text(LEVELS[scan.level].summary.toUpperCase(), M + 170, y - 8, 15, 'F2', rgb);
      wrapByChars(scan.display, 10, W - M - (M + 170)).slice(0, 2).forEach((l, i) => text(l, M + 170, y - 28 - i * 13, 10, 'F1', [0.3, 0.33, 0.4]));
      ops.push('0.91 0.92 0.93 rg ' + M + ' ' + (y - 62) + ' ' + (W - 2 * M) + ' 10 re f');
      ops.push(rgb.join(' ') + ' rg ' + M + ' ' + (y - 62) + ' ' + ((W - 2 * M) * scan.score / 100).toFixed(2) + ' 10 re f');
      y -= 100;
    } else {
      text(pdfSafe(scan.display), M, y - 10, 12, 'F1', [0.3, 0.33, 0.4]);
      y -= 40;
    }

    if (model.showFound) {
      text('What we found', M, y, 15, 'F2');
      y -= 24;
      if (!model.flags.length) {
        text('No red flags found.', M, y, 11);
        y -= 20;
      }
      for (const f of model.flags.slice(0, 9)) {
        const mark = f.severity === 'danger' ? [0.93, 0.11, 0.145] : [0.96, 0.647, 0.141];
        ops.push(mark.join(' ') + ' rg ' + M + ' ' + (y - 1) + ' 6 6 re f');
        text(f.title, M + 16, y, 11, 'F2');
        y -= 15;
        wrapByChars(f.detail, 10, W - 2 * M - 16).forEach((l) => { text(l, M + 16, y, 10, 'F1', [0.3, 0.33, 0.4]); y -= 13; });
        y -= 8;
      }
    }

    if (model.time) text('Scanned on ' + model.time, M, 90, 10, 'F1', [0.42, 0.45, 0.53]);
    text('This report is for guidance only. Always verify before acting.', M, 70, 10, 'F1', [0.42, 0.45, 0.53]);

    const content = ops.join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    pdf += offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([Uint8Array.from(pdf, (c) => c.charCodeAt(0) & 0xff)], { type: 'application/pdf' });
  }

  async function buildPng(model) {
    if (document.fonts?.ready) await document.fonts.ready;
    const { scan } = model;
    const W = 1080, P = 64;
    const FONT = 'Poppins, system-ui, "Segoe UI", Arial, sans-serif';
    const color = LEVEL_HEX[scan.level];

    const wrap = (ctx, str, maxWidth) => {
      const lines = [];
      let line = '';
      for (const word of String(str).split(/\s+/)) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else { line = test; }
      }
      if (line) lines.push(line);
      return lines;
    };

    const draw = (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, 4000);
      ctx.fillStyle = '#1b2039';
      ctx.fillRect(0, 0, W, 110);
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#fff';
      ctx.font = `800 40px ${FONT}`;
      ctx.fillText('ISKAMDAR', P, 70);
      ctx.font = `400 24px ${FONT}`;
      ctx.fillStyle = '#d3deec';
      ctx.textAlign = 'right';
      ctx.fillText('Scam check report', W - P, 68);
      ctx.textAlign = 'left';

      let y = 170;
      if (model.showScore) {
        const cx = P + 90, cy = y + 90;
        ctx.lineWidth = 24;
        ctx.strokeStyle = '#e9eaee';
        ctx.beginPath(); ctx.arc(cx, cy, 78, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = color;
        ctx.beginPath(); ctx.arc(cx, cy, 78, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * scan.score) / 100); ctx.stroke();
        ctx.fillStyle = '#0e1a2b';
        ctx.font = `600 46px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(scan.score + '%', cx, cy + 16);
        ctx.textAlign = 'left';

        ctx.fillStyle = color;
        ctx.font = `800 34px ${FONT}`;
        let ty = y + 70;
        wrap(ctx, LEVELS[scan.level].summary.toUpperCase(), W - 2 * P - 230).forEach((l) => { ctx.fillText(l, P + 230, ty); ty += 42; });
        ctx.fillStyle = '#4a5368';
        ctx.font = `400 24px ${FONT}`;
        wrap(ctx, scan.display, W - 2 * P - 230).slice(0, 2).forEach((l) => { ctx.fillText(l, P + 230, ty); ty += 32; });
        y += 230;
      } else {
        ctx.fillStyle = '#4a5368';
        ctx.font = `400 26px ${FONT}`;
        ctx.fillText(scan.display, P, y + 10);
        y += 60;
      }

      if (model.showFound) {
        ctx.fillStyle = '#0e1a2b';
        ctx.font = `700 32px ${FONT}`;
        ctx.fillText('What we found', P, y);
        y += 20;
        const items = model.flags.length ? model.flags : [{ title: 'No red flags found', detail: 'Nothing in what you shared matched our scam patterns.', severity: 'ok' }];
        for (const f of items) {
          y += 14;
          ctx.strokeStyle = '#e3e5ea';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();
          y += 40;
          ctx.fillStyle = f.severity === 'danger' ? '#ee1c25' : f.severity === 'ok' ? '#1f9d57' : '#f5a524';
          ctx.beginPath(); ctx.arc(P + 14, y - 9, 14, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#0e1a2b';
          ctx.font = `700 26px ${FONT}`;
          ctx.fillText(f.title, P + 46, y);
          ctx.font = `400 23px ${FONT}`;
          ctx.fillStyle = '#4a5368';
          wrap(ctx, f.detail, W - 2 * P - 46).forEach((l) => { y += 34; ctx.fillText(l, P + 46, y); });
          y += 10;
        }
      }

      y += 50;
      ctx.fillStyle = '#6b7388';
      ctx.font = `400 21px ${FONT}`;
      if (model.time) { ctx.fillText('Scanned on ' + model.time, P, y); y += 34; }
      ctx.fillText('This report is for guidance only. Always verify before acting.', P, y);
      return y + P;
    };

    const probe = document.createElement('canvas');
    probe.width = W; probe.height = 4000;
    const height = Math.ceil(draw(probe.getContext('2d')));

    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = height;
    draw(canvas.getContext('2d'));
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function syncDownloadLabel() {
    const fmt = $('#dl-form').elements.format.value;
    $('#dl-submit-label').textContent = fmt === 'pdf' ? 'Download PDF' : 'Download Image';
  }

  async function handleDownload(e) {
    e.preventDefault();
    const scan = state.scan;
    if (!scan) return;
    const form = e.currentTarget;
    const opts = {
      score: form.elements['inc-score'].checked,
      found: form.elements['inc-found'].checked,
      time: form.elements['inc-time'].checked,
    };
    if (!opts.score && !opts.found && !opts.time) { toast('Pick at least one thing to include.'); return; }

    const btn = $('#dl-submit');
    btn.setAttribute('aria-busy', 'true');
    try {
      const model = reportModel(scan, opts);
      const fmt = form.elements.format.value;
      const blob = fmt === 'pdf' ? buildPdf(model) : await buildPng(model);
      triggerDownload(blob, `iskamdar-report-${scan.id.slice(-6)}.${fmt}`);
      toast('Report downloaded.');
    } catch (err) {
      console.error(err);
      toast('Could not create the report. Please try again.');
    } finally {
      btn.removeAttribute('aria-busy');
    }
  }

  /* ===================================================================
     8. SHARE + AGENCY REPORTING
     =================================================================== */

  function shareTo(channel) {
    const scan = state.scan;
    if (!scan) return;
    const link = $('#share-link').value || makeShareLink(scan);
    const text = `Careful: Iskamdar flagged this offer (${LEVELS[scan.level].label.toLowerCase()}, ${scan.score}/100). See the report:`;
    const open = (url) => window.open(url, '_blank', 'noopener,noreferrer');
    const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (channel === 'whatsapp') open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + link));
    else if (channel === 'facebook') open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(link));
    else if (channel === 'email') location.href = 'mailto:?subject=' + encodeURIComponent('Scam warning from Iskamdar') + '&body=' + encodeURIComponent(text + '\n\n' + link);
    else if (channel === 'messenger') {
      if (mobile) {
        location.href = 'fb-messenger://share?link=' + encodeURIComponent(link);
      } else {
        copyText(link).then(() => toast('Link copied. Paste it into Messenger.'));
      }
    }
  }

  function openSubmit(key) {
    const scan = state.scan;
    const agency = AGENCIES[key];
    if (!scan || scan.shared || !agency) return;
    state.submitAgency = key;
    $('#submit-agency').textContent = agency.name;
    $('#submit-score').textContent = `${scan.score} / 100 · ${LEVELS[scan.level].label}`;
    $('#submit-score-box').dataset.level = scan.level;
    const sent = scan.input.length > 500 ? scan.input.slice(0, 500) + '…' : scan.input;
    $('#submit-text').textContent = '“' + sent + '”';
    const flags = $('#submit-flags');
    flags.replaceChildren(...(scan.signals.length
      ? scan.signals.map((s) => el('li', { text: sig(s).title }))
      : [el('li', { text: 'No red flags detected' })]));
    $('#submit-note').value = '';
    openDialog('dlg-submit');
  }

  function localReference(code) {
    const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 90000) + 10000;
    return `ISK-${code}-${n}`;
  }

  async function submitReport(key, note) {
    const scan = state.scan;
    const agency = AGENCIES[key];
    if (!CONFIG.reportEndpoint) {
      await new Promise((r) => setTimeout(r, 600));
      return { reference: localReference(agency.code), demo: true };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.requestTimeoutMs);
    try {
      const res = await fetch(CONFIG.reportEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agency: key,
          score: scan.score,
          level: scan.level,
          input: scan.input,
          urls: scan.urls,
          flags: scan.signals.map((s) => s.id),
          note,
          createdAt: scan.createdAt,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const ref = typeof data?.reference === 'string' && /^[A-Za-z0-9-]{4,40}$/.test(data.reference) ? data.reference : null;
      if (!ref) throw new Error('No reference returned');
      return { reference: ref, demo: false };
    } finally {
      clearTimeout(timer);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const key = state.submitAgency;
    if (!key) return;
    const btn = $('#submit-confirm');
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try {
      const { reference, demo } = await submitReport(key, $('#submit-note').value.trim());
      const agency = AGENCIES[key];
      state.lastReference = reference;
      $('#success-title').textContent = demo ? 'Demo Report Created' : 'Report Submitted';
      $('#success-message').textContent = demo
        ? `This is a prototype, so nothing was sent to ${agency.name}.`
        : `Your report has been sent to ${agency.name}.`;
      $('#success-ref-label').textContent = demo ? 'Demo reference number' : 'Reference number';
      $('#success-ref').textContent = reference;
      $('#success-hint').hidden = demo;
      $('#success-demo').hidden = !demo;
      try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
      openDialog('dlg-success');
    } catch (err) {
      console.error(err);
      toast('Could not send the report. Please try again.');
    } finally {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  }

  /* ===================================================================
     9. PAGE SETUP + EVENTS
     Every page is its own HTML file and <body data-page="..."> tells this
     script which one it is running on. A finished scan travels between
     pages in sessionStorage; a shared report travels in report.html#r=...
     =================================================================== */
  const PAGE = document.body.dataset.page;
  const URLS = Object.freeze({
    home: 'index.html',
    result: 'result.html',
    report: 'report.html',
    about: 'about.html',
    trends: 'trends.html',
  });
  const ANCHOR_NAV = ['how', 'faq']; // sections of index.html that have a nav entry

  const on = (selector, type, handler) => {
    const node = $(selector);
    if (node) node.addEventListener(type, handler);
  };

  /** Highlights the current page in the nav (and #how / #faq on the home page). */
  function markNav() {
    const anchor = location.hash.slice(1);
    const current = PAGE === 'home' ? (ANCHOR_NAV.includes(anchor) ? anchor : '') : PAGE;
    $$('[data-nav]').forEach((a) => {
      if (a.dataset.nav === current) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function initResultPage() {
    if (!state.scan) {
      location.replace(URLS.home); // nothing has been checked in this tab yet
      return;
    }
    renderResult(state.scan);
  }

  function initReportPage() {
    const fromResult = new URLSearchParams(location.search).has('src');
    const apply = () => {
      closeAllDialogs();
      const token = location.hash.startsWith('#r=') ? location.hash.slice(3) : null;
      const shared = token === null ? null : parseSharedScan(token);
      if (token !== null && !shared) toast('That shared report link is not valid.');
      state.sharedMode = Boolean(shared);
      state.scan = shared || (fromResult ? loadScan() : null);
      if (!state.scan && token === null) {
        location.replace(URLS.home); // nothing to report: go back to the home page
        return;
      }
      renderReport(state.scan);
    };
    apply();
    window.addEventListener('hashchange', apply);
  }

  async function handleCheck(e) {
    const form = e.target.closest('[data-check-form]');
    if (!form) return;
    e.preventDefault();

    const input = form.elements.q;
    const value = input.value.trim();
    if (!value) {
      state.lastInput = input;
      openDialog('dlg-input');
      return;
    }
    if (value.split(/\s+/).length < 10) {
      state.lastInput = input;
      openDialog('dlg-short-input');
      return;
    }

    const btn = $('button[type="submit"]', form);
    const label = btn.textContent;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    btn.textContent = 'Scanning…';
    const overlay = $('#loading-overlay');
    if (overlay) {
      overlay.hidden = false;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    try {
      const [scan] = await Promise.all([
        analyze(value),
        new Promise(r => setTimeout(r, 900)),
      ]);
      state.scan = scan;
      store.set(JSON.stringify(scan));
      input.value = '';
      location.href = URLS.result;
    } catch (err) {
      console.error(err);
      if (overlay) overlay.hidden = true;
      toast('Something went wrong. Please try again.');
    } finally {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function handleClick(e) {
    const t = e.target;

    const closer = t.closest('[data-close]');
    if (closer) { closer.closest('dialog')?.close(); return; }

    const opener = t.closest('[data-open]');
    if (opener) { openDialog(opener.dataset.open); return; }

    const agency = t.closest('[data-agency]');
    if (agency) { openSubmit(agency.dataset.agency); return; }

    const share = t.closest('[data-share]');
    if (share) { shareTo(share.dataset.share); return; }

    const action = t.closest('[data-action]');
    if (action?.dataset.action === 'copy-link') {
      copyText($('#share-link').value).then((ok) => toast(ok ? 'Link copied.' : 'Could not copy. Select the link and copy it manually.'));
    } else if (action?.dataset.action === 'copy-ref') {
      copyText(state.lastReference || $('#success-ref').textContent).then((ok) => toast(ok ? 'Reference copied.' : 'Could not copy the reference.'));
    }

    // Click on a dialog's backdrop closes it (except the form with unsaved text).
    if (t instanceof HTMLDialogElement && !t.classList.contains('dlg--sticky')) t.close();
  }

  /* ---- Demo notice (floating glass card) --------------------------- */
  function initDemoNotice() {
    // Auto-opens on the home page when the system is opened or refreshed, not when
    // arriving from another page of the site (result, about...). Elsewhere only the pill shows.
    const navType = performance.getEntriesByType?.('navigation')?.[0]?.type;
    const fromSite = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin;
    const minimized = !(PAGE === 'home' && (navType === 'reload' || (navType === 'navigate' && !fromSite)));

    const items = [
      ['Text analysis only', 'Paste a message. Links and web pages are not scanned in this version.'],
      ['Not a guarantee', 'A low risk result does not prove an offer is real. Always verify before responding.'],
      ['Demo mode', 'Reports are not sent to any agency, and nothing you paste is stored on a server.'],
    ];
    const card = el('aside', { class: 'demo-note', role: 'complementary', 'aria-label': 'Demo version notice' }, [
      el('div', { class: 'demo-note__head' }, [
        el('span', { class: 'demo-note__badge', text: 'Demo version' }),
        el('button', { class: 'demo-note__min', type: 'button', 'aria-label': 'Minimize notice', text: '−' }),
      ]),
      el('p', { class: 'demo-note__title', text: 'System demonstration' }),
      el('p', { class: 'demo-note__lead', text: 'This demo shows the panel how Iskamdar analyzes a message and produces a risk level.' }),
      el('ul', { class: 'demo-note__list' }, items.map(([h, p]) =>
        el('li', {}, [el('strong', { text: h + '. ' }), p]))),
      el('p', { class: 'demo-note__foot', text: 'Risk levels: Low risk 0–29, Suspicious 30–69, High risk 70–100 (development thresholds).' }),
      el('button', { class: 'demo-note__go', type: 'button', text: 'Start demo' }),
    ]);
    const back = el('div', { class: 'demo-backdrop' });
    const pill = el('button', { class: 'demo-pill', type: 'button', 'aria-label': 'Show demo version notice', text: 'Demo version' });

    const set = (min) => {
      card.hidden = min;
      back.hidden = min;
      pill.hidden = !min;
    };
    $('.demo-note__min', card).addEventListener('click', () => set(true));
    $('.demo-note__go', card).addEventListener('click', () => set(true));
    back.addEventListener('click', () => set(true));
    pill.addEventListener('click', () => set(false));
    document.body.append(back, card, pill);
    card.hidden = minimized;
    back.hidden = minimized;
    pill.hidden = !minimized;
  }

  function init() {
    state.scan = loadScan();
    markNav();
    initDemoNotice();

    // Listeners that exist on every page.
    document.addEventListener('submit', handleCheck);
    document.addEventListener('click', handleClick);
    window.addEventListener('hashchange', markNav);
    on('#nav-toggle', 'click', () => {
      const open = $('#site-nav').classList.toggle('is-open');
      $('#nav-toggle').setAttribute('aria-expanded', String(open));
    });

    // Elements that exist only on some pages.
    on('#dlg-input', 'close', () => state.lastInput?.focus());
    on('#dl-form', 'submit', handleDownload);
    on('#dl-form', 'change', (e) => { if (e.target.name === 'format') syncDownloadLabel(); });
    on('#submit-form', 'submit', handleSubmit);

    if (PAGE === 'home') {
      window.addEventListener('pageshow', (e) => {
        if (e.persisted) { const inp = $('#home-input'); if (inp) inp.value = ''; }
      });
    }
    if (PAGE === 'result') initResultPage();
    if (PAGE === 'report') initReportPage();
    if (PAGE === 'trends') renderTrends();
  }

  // Exposed for testing and for the thesis evaluation harness.
  window.Iskamdar = Object.freeze({ analyze, routeInput, analyzeText, analyzeTextModel, analyzeUrl, scoreSignals, levelFor, SIGNALS, CONFIG });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
