/* =====================================================================
   VH MEN Quick Reply — Size chart & size recommendation (shared module)
   Used by quickreply.html (laptop / admin) and quickreply-view.html (phone).

   Source of truth: the VH MEN System Google Sheet (MeasurementCharts / Rows /
   Fields / Values + approved FitRules), read through the read-only Apps Script
   endpoint in QuickReplyApi.gs. Nothing is copied into Firebase and nothing is
   written anywhere except a read-only saved copy in this browser (localStorage)
   for short internet drop-outs — always labelled as a saved copy.

   Nothing here invents a measurement or a size: values are shown exactly as
   stored; recommendations come only from the existing engine (Fit.gs).
   ===================================================================== */
(function () {
  'use strict';

  /* The VH MEN System web app (/exec) link. Not a secret — the endpoint only returns customer-facing data.
     Override by defining window.VHM_SIZE_API_URL before this file loads. */
  var DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbyfrqOrsqOPSG5aUz8a6XxOGIFzJwt3nq9ZfWSAYjwHCW58SBzP4ZPE0skQ1TYgVWUxfQ/exec';
  var API_VERSION = 1;
  var FRESH_MS = 10 * 60 * 1000;     // older than this → refreshed automatically
  var TIMEOUT_MS = 15000;
  var LS_PREFIX = 'vhm_size_v1:';
  var LS_RECENT = 'vhm_size_recent';
  var MAX_SAVED = 40;

  function apiUrl() { return String(window.VHM_SIZE_API_URL || DEFAULT_API_URL || '').trim(); }
  function normCode(s) { return String(s == null ? '' : s).normalize('NFC').replace(/[\s\u200b-\u200d\u2060\ufeff]+/g, '').toLowerCase().replace(/[-._\/]/g, ''); }
  function cleanCode(s) { return String(s == null ? '' : s).replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim(); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }
  function online() { return navigator.onLine !== false; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtClock(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtWhen(ms) {
    if (!ms || !isFinite(ms)) return '—';
    var d = new Date(ms), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay ? fmtClock(ms) : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + fmtClock(ms);
  }
  function num(v) { return v === '' || v === null || v === undefined ? '' : String(Math.round(Number(v) * 10) / 10); }
  function range(a, b) { var x = num(a), y = num(b); return x !== '' && y !== '' ? (x === y ? x : x + '–' + y) : ''; }

  /* ---------------------------------------------------------------- texts (Khmer first) */
  var GARMENT = { shirt: ['អាវ', 'Shirt'], pants: ['ខោ', 'Pants'], other: ['ផ្សេងៗ', 'Other'] };
  var STATUS = {
    no_rules: ['គ្មានការណែនាំជាក់លាក់សម្រាប់ផលិតផលនេះ', 'No product-specific recommendation available'],
    no_match: ['គ្មានទំហំណាដែលត្រូវនឹងកម្ពស់ និងទម្ងន់នេះ', 'No size matches this height and weight'],
    overlap: ['មានទំហំច្រើនជាងមួយត្រូវគ្នា — សូមជ្រើសដោយខ្លួនឯង', 'More than one size matches — you decide'],
    need_fit: ['សូមជ្រើសរបៀបពាក់', 'Choose the preferred fit'],
    no_fit_rules: ['គ្មានច្បាប់សម្រាប់របៀបពាក់នេះ', 'No rules for this fit'],
    need_garment: ['សូមជ្រើស អាវ ឬ ខោ', 'Choose shirt or pants'],
    group_conflict: ['ផលិតផលនេះនៅក្នុងក្រុមពីរ — អ្នកគ្រប់គ្រងត្រូវកែ', 'This product is in two groups — an admin must fix it']
  };
  var ERR = {
    NOT_FOUND: ['រកមិនឃើញកូដនេះក្នុង VH MEN System', 'This code is not in VH MEN System'],
    DISABLED: ['ការភ្ជាប់តារាងទំហំមិនទាន់បើក', 'The size chart link is switched off (admin: Script Property QR_SIZE_API = on)'],
    BUSY: ['ប្រព័ន្ធរវល់ — សូមព្យាយាមម្ដងទៀតបន្តិចទៀត', 'Busy — please try again in a minute'],
    NETWORK: ['មិនអាចភ្ជាប់ទៅ Google Sheets', 'Could not reach Google Sheets'],
    TIMEOUT: ['ភ្ជាប់យូរពេក — សូមព្យាយាមម្ដងទៀត', 'Took too long — please try again'],
    OFFLINE: ['គ្មានអ៊ីនធឺណិត', 'No internet connection'],
    BAD_RESPONSE: ['ទិន្នន័យមិនត្រឹមត្រូវ — មិនបង្ហាញ', 'Unexpected answer from the server — not shown'],
    NO_URL: ['មិនទាន់កំណត់តំណ VH MEN System', 'The VH MEN System link is not set'],
    NOT_SETUP: ['មូលដ្ឋានទិន្នន័យមិនទាន់រៀបចំ', 'The database is not set up'],
    SERVER: ['មានបញ្ហានៅម៉ាស៊ីនមេ', 'Server problem — please try again']
  };
  function errText(e) {
    var code = (e && e.code) || 'SERVER';
    if (code === 'VALIDATION') return ['ព័ត៌មានមិនត្រឹមត្រូវ', (e && e.message) || 'Check what you entered'];
    return ERR[code] || ERR.SERVER;
  }
  function methodTxt(m) {
    if (m === 'flat') return [' (វាស់សំប៉ែត)', ' (flat)'];
    if (m === 'circumference') return [' (វាស់ជុំវិញ)', ' (around)'];
    return ['', ''];
  }
  function fitLabel(key, prefs) {
    if (!key) return ['គ្រប់របៀបពាក់', 'Any fit'];
    var p = (prefs || []).filter(function (x) { return x.key === key; })[0];
    return p ? [p.km || p.en, p.en || p.km] : [key, key];
  }
  function fill(pair, o) { return pair.map(function (s) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] === undefined || o[k] === null ? '' : String(o[k]); }); }); }
  /* Structured reasons from the engine → [km, en]. Same wording as VH MEN System (JsFit.html). */
  function reasonText(r, prefs) {
    var dk = r.dim === 'height' ? 'កម្ពស់' : 'ទម្ងន់', de = r.dim === 'height' ? 'height' : 'weight', u = r.dim === 'height' ? 'cm' : 'kg';
    var o = Object.assign({}, r, { dk: dk, de: de, De: de.charAt(0).toUpperCase() + de.slice(1), u: u,
      fk: fitLabel(r.fit, prefs)[0], fe: fitLabel(r.fit, prefs)[1], fits: (r.fits || []).map(function (f) { return fitLabel(f, prefs)[1]; }).join(', '),
      sizes: (r.sizes || []).join(' / '), others: (r.others || []).join(', '), hs: (r.heightSizes || []).join(', ') || '—', ws: (r.weightSizes || []).join(', ') || '—',
      groups: (r.groups || []).join(', '), min: num(r.min), max: num(r.max) });
    var T = {
      group: ['ផ្អែកលើក្រុម “{name}” ដែលបានអនុម័ត', 'Based on the approved group “{name}”'],
      fit_fallback: ['គ្មានច្បាប់សម្រាប់ {fk} — ប្រើច្បាប់ “គ្រប់របៀបពាក់”', 'No rules for a {fe} fit — the “any fit” rules are used'],
      fit_only: ['ច្បាប់ទាំងនេះសម្រាប់ {fk} ប៉ុណ្ណោះ', 'These rules are for a {fe} fit'],
      in_range: ['{dk} {v} {u} នៅក្នុងចន្លោះ {min}–{max} {u} របស់ទំហំ {size}', '{De} {v} {u} is within {min}–{max} {u} for size {size}'],
      rule_lacks: ['ច្បាប់ទំហំ {size} គ្មានចន្លោះ{dk} — {dk}មិនត្រូវបានពិនិត្យ', 'The {size} rule has no {de} range — {de} was not checked'],
      input_missing: ['មិនបានវាយ{dk} — មិនត្រូវបានពិនិត្យ', '{De} was not entered — not checked'],
      unique: ['មានតែទំហំ {size} ប៉ុណ្ណោះដែលត្រូវ', 'Only size {size} matches'],
      priority: ['ទំហំផ្សេងក៏ត្រូវដែរ ({others}) — {size} ត្រូវបានជ្រើសព្រោះអាទិភាពខ្ពស់ជាង', 'Other sizes also match ({others}); {size} has a higher priority'],
      overlap: ['ទំហំ {sizes} ត្រូវគ្នាស្មើៗ — ប្រព័ន្ធមិនជ្រើសឲ្យទេ', 'Sizes {sizes} match equally — the system does not pick one'],
      above_all: ['{dk} {v} {u} លើសចន្លោះទាំងអស់ (ធំបំផុត {limit} {u})', '{De} {v} {u} is above every approved range (largest {limit} {u})'],
      below_all: ['{dk} {v} {u} ក្រោមចន្លោះទាំងអស់ (តូចបំផុត {limit} {u})', '{De} {v} {u} is below every approved range (smallest {limit} {u})'],
      split: ['កម្ពស់ និងទម្ងន់ត្រូវនឹងទំហំខុសគ្នា', 'Height and weight point to different sizes'],
      gap: ['តម្លៃនេះស្ថិតនៅចន្លោះទំហំ (គ្មានច្បាប់គ្រប)', 'This falls between the approved ranges'],
      partial_hint: ['កម្ពស់ត្រូវ {hs} · ទម្ងន់ត្រូវ {ws}', 'Height fits {hs} · weight fits {ws}'],
      need_fit: ['ផលិតផលនេះមានច្បាប់តាមរបៀបពាក់ ({fits})', 'This product has rules per fit ({fits})'],
      no_rules_for_fit: ['គ្មានច្បាប់សម្រាប់ {fk} (មាន: {fits})', 'No approved rules for a {fe} fit (available: {fits})'],
      no_rules: ['គ្មានច្បាប់កម្ពស់/ទម្ងន់ដែលបានអនុម័ត', 'No approved height/weight rules'],
      group_conflict: ['ផលិតផលនៅក្នុងក្រុមច្រើន: {groups}', 'The product is in several groups: {groups}'],
      need_garment: STATUS.need_garment
    };
    return fill(T[r.k] || [r.k, r.k], o);
  }

  /* ---------------------------------------------------------------- customer message (pure) */
  /* Customer-facing words only: no rules, API, sync status, notes, or the customer's height/weight. */
  var MSG = {
    shirt: {
      km: { open: 'សម្រាប់អាវកូដ {code}', rec: 'តាមទិន្នន័យ{basis}របស់បង យើងណែនាំ Size {size} បង។', head: 'រង្វាស់អាវ Size {size}:', foot: 'រង្វាស់ខាងលើជារង្វាស់អាវផ្ទាល់ ដើម្បីឱ្យបងងាយស្រួលជ្រើសរើសទំហំ។' },
      en: { open: 'For product {code}', rec: ', based on your {basis}, we recommend size {size}.', head: 'Size {size} measurements:', foot: 'These are the actual garment measurements to help you choose your preferred fit.' }
    },
    pants: {
      km: { open: 'សម្រាប់ខោកូដ {code}', rec: 'យើងណែនាំ Size {size} តាមទិន្នន័យណែនាំទំហំរបស់បង។', head: 'រង្វាស់ខោ Size {size}:', foot: 'រង្វាស់ខាងលើជារង្វាស់ខោផ្ទាល់។' },
      en: { open: 'For product {code}', rec: ', we recommend size {size}.', head: 'Size {size} measurements:', foot: 'These are actual garment measurements.' }
    },
    other: {
      km: { open: 'សម្រាប់កូដ {code}', rec: 'យើងណែនាំ Size {size} តាមទិន្នន័យណែនាំទំហំរបស់បង។', head: 'រង្វាស់ Size {size}:', foot: 'រង្វាស់ខាងលើជារង្វាស់ផលិតផលផ្ទាល់។' },
      en: { open: 'For product {code}', rec: ', we recommend size {size}.', head: 'Size {size} measurements:', foot: 'These are actual product measurements.' }
    }
  };
  function tpl(s, o) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return o[k] === undefined ? '' : String(o[k]); }); }
  /**
   * o: { lang: 'km'|'en', code, garment, size, recommend: bool, basis: { h: bool, w: bool },
   *      lines: [{ labelKm, labelEn, unit, method, value }] }
   * recommend=false → the same message without the recommendation sentence (measurements of a size staff chose).
   */
  function buildMessage(o) {
    var lang = o.lang === 'en' ? 'en' : 'km';
    var T = (MSG[o.garment] || MSG.other)[lang];
    var b = o.basis || {};
    var basis = lang === 'km' ? (b.h && b.w ? 'កម្ពស់ និងទម្ងន់' : b.h ? 'កម្ពស់' : 'ទម្ងន់') : (b.h && b.w ? 'height and weight' : b.h ? 'height' : 'weight');
    var v = { code: o.code, size: o.size, basis: basis };
    var out = [];
    if (lang === 'km') {
      out.push(tpl(T.open, v));
      if (o.recommend) out.push('', tpl(T.rec, v));
    } else {
      out.push(tpl(T.open, v) + (o.recommend ? tpl(T.rec, v) : ':'));
    }
    var lines = (o.lines || []).filter(function (l) { return String(l.value == null ? '' : l.value).trim() !== ''; });
    out.push('', tpl(T.head, v));
    lines.forEach(function (l) {
      var km = l.labelKm || l.labelEn, en = l.labelEn || l.labelKm;
      var label = lang === 'km' ? (en && en !== km ? km + ' (' + en + ')' : km) : en;
      var m = methodTxt(l.method)[lang === 'km' ? 0 : 1];
      out.push('- ' + label + ': ' + String(l.value).trim() + (l.unit ? ' ' + l.unit : '') + m);
    });
    out.push('', T.foot);
    return out.join('\n');
  }

  /* ---------------------------------------------------------------- verification before a customer reply (pure) */
  /**
   * Checks the six things that must be true before a measurement or recommendation message is offered.
   * in: { data, chart, size, rec (recommendSize answer or null), recCurrent: bool, pick: '' | size chosen from an overlap }
   * out: { mode: 'recommend' | 'measure' | null, recSize, checks: [{ k, level: ok|warn|bad|info, t: [km, en] }], lines }
   */
  function verifyReply(x) {
    var checks = [], d = x.data, c = x.chart;
    function add(k, level, t) { checks.push({ k: k, level: level, t: t }); }
    var out = { mode: null, recSize: '', checks: checks, lines: [] };
    // 1. product code exists
    if (!d || !d.product || !d.product.code) { add('product', 'bad', ['រកមិនឃើញផលិតផល', 'Product not found']); return out; }
    add('product', 'ok', ['កូដ ' + d.product.code + ' មានក្នុងប្រព័ន្ធ', 'Product ' + d.product.code + ' exists']);
    // 3. product-specific chart
    if (!c) { add('chart', 'bad', ['គ្មានតារាងរង្វាស់សម្រាប់កូដនេះ', 'No measurement chart for this product']); return out; }
    // 2. category
    var cat = String(d.product.category || '').toLowerCase();
    var catSays = /pant|trouser|short|jean|ខោ/.test(cat) ? 'pants' : /shirt|polo|tee|top|jacket|អាវ/.test(cat) ? 'shirt' : '';
    if (c.garment === 'other') add('category', 'warn', ['ប្រភេទ: ផ្សេងៗ (មិនមែនអាវ/ខោ)', 'Category: other (not shirt or pants)']);
    else if (catSays && catSays !== c.garment) add('category', 'warn', ['ប្រភេទផលិតផល “' + d.product.category + '” តែតារាងជា' + GARMENT[c.garment][0], 'Product category “' + d.product.category + '” but this is a ' + c.garment + ' chart — check']);
    else add('category', 'ok', ['ប្រភេទ: ' + GARMENT[c.garment][0], 'Category: ' + GARMENT[c.garment][1]]);
    add('chart', c.status === 'draft' ? 'warn' : 'ok', c.status === 'draft' ? ['តារាងផ្ទាល់ (ព្រាង)', 'Product-specific chart (draft)'] : ['តារាងផ្ទាល់របស់ ' + d.product.code, 'Product-specific chart of ' + d.product.code]);
    // 4. the size exists in this chart
    var r = x.rec, live = r && x.recCurrent;
    var recRow = null;
    if (live && r.status === 'ok') {
      out.recSize = r.recommended.sizeLabel;
      var m = r.recommended.measurements;
      recRow = m && m.found && m.chartId === c.id ? c.sizes.filter(function (s) { return s.id === m.rowId; })[0] : null;
      if (!recRow) recRow = c.sizes.filter(function (s) { return normCode(s.label) === normCode(r.recommended.sizeLabel); })[0] || null;
      if (!recRow) add('recsize', 'bad', ['ច្បាប់ណែនាំ Size ' + r.recommended.sizeLabel + ' តែតារាងគ្មាន Size នេះ', 'The rule recommends size ' + r.recommended.sizeLabel + ', but this chart has no such size — fix the chart or the rule']);
      else { out.recSize = recRow.label; if (recRow.label !== r.recommended.sizeLabel) add('recsize', 'warn', ['ច្បាប់ “' + r.recommended.sizeLabel + '” = Size ' + recRow.label + ' ក្នុងតារាង', 'Rule size “' + r.recommended.sizeLabel + '” is called ' + recRow.label + ' in the chart']); }
    }
    var row = c.sizes.filter(function (s) { return s.label === x.size; })[0];
    if (!row) { add('size', 'bad', ['ជ្រើស Size ក្នុងតារាង', 'Choose a size from this chart']); return out; }
    var rv = c.values[row.id] || {};
    out.lines = c.fields.filter(function (f) { return f.customer !== false && rv[f.id] !== undefined && String(rv[f.id]).trim() !== ''; })
      .map(function (f) { return { fieldId: f.id, labelKm: f.labelKm, labelEn: f.labelEn, unit: f.unit, method: f.method, value: rv[f.id] }; });
    // 5. the values belong to this product + size
    if (!out.lines.length) { add('values', 'bad', ['Size ' + row.label + ' មិនទាន់មានរង្វាស់', 'No measurements entered for size ' + row.label]); return out; }
    var isRec = live && r.status === 'ok' && recRow && recRow.id === row.id;
    var isPick = live && r.status === 'overlap' && x.pick === row.label && (r.options || []).some(function (o) { return o.sizeLabel === row.label; });
    if (isRec || isPick) {
      var ms = isRec ? r.recommended.measurements : (r.options.filter(function (o) { return o.sizeLabel === row.label; })[0] || {}).measurements;
      var same = r.product && r.product.code === d.product.code && (!r.chart || r.chart.id === c.id) && ms && ms.found && ms.chartId === c.id && ms.rowId === row.id &&
        out.lines.every(function (l) { var mv = ms.values.filter(function (v) { return v.fieldId === l.fieldId; })[0]; return mv && String(mv.value) === String(l.value); });
      if (!same) { add('values', 'bad', ['រង្វាស់មិនដូចគ្នានឹងចម្លើយណែនាំ — សូមចុច Refresh', 'Measurements differ from the recommendation answer — tap Refresh']); isRec = isPick = false; }
      else add('values', 'ok', ['រង្វាស់ជារបស់ ' + d.product.code + ' Size ' + row.label, 'Measurements belong to ' + d.product.code + ' size ' + row.label]);
    } else add('values', 'ok', ['រង្វាស់ជារបស់ ' + d.product.code + ' Size ' + row.label, 'Measurements belong to ' + d.product.code + ' size ' + row.label]);
    // 6. an applicable approved FitRule
    if (!r) add('rule', 'info', ['មិនទាន់ណែនាំ — សារបង្ហាញតែរង្វាស់', 'No recommendation yet — message shows measurements only']);
    else if (!x.recCurrent) add('rule', 'warn', ['បានប្ដូរព័ត៌មាន — ចុច “ណែនាំទំហំ” ម្ដងទៀត', 'Inputs changed — tap Recommend again']);
    else if (r.status === 'ok' || r.status === 'overlap') {
      var src = r.source === 'group' ? ['ច្បាប់ក្រុម “' + r.groupName + '” ដែលបានអនុម័ត', 'Approved group FitRule “' + r.groupName + '”'] : ['ច្បាប់ផ្ទាល់ដែលបានអនុម័ត', 'Approved product-specific FitRule'];
      if (isRec || isPick) add('rule', 'ok', src);
      else if (r.status === 'ok' && recRow) add('rule', 'info', ['អ្នកជ្រើស Size ' + row.label + ' (ណែនាំ ' + recRow.label + ') — សារបង្ហាញតែរង្វាស់', 'You chose ' + row.label + ' (recommended ' + recRow.label + ') — measurements only']);
      else if (r.status === 'overlap') add('rule', 'warn', ['ជ្រើស Size មួយពីទំហំដែលត្រូវ', 'Pick one of the matching sizes']);
    } else add('rule', 'warn', [(STATUS[r.status] || [r.status])[0] + ' — សារបង្ហាញតែរង្វាស់', (STATUS[r.status] || [r.status, r.status])[1] + ' — measurements only']);
    out.mode = (isRec || isPick) && !checks.some(function (k) { return k.level === 'bad'; }) ? 'recommend' : 'measure';
    if (checks.some(function (k) { return k.level === 'bad' && k.k !== 'recsize'; })) out.mode = null;
    return out;
  }

  /* ---------------------------------------------------------------- data access */
  var inflight = new Map();
  var mem = new Map();   // normCode → { data, at, source }

  function fail(code, message) { var e = new Error(message || code); e.code = code; return e; }

  function request(params) {
    var url = apiUrl();
    if (!url) return Promise.reject(fail('NO_URL'));
    if (!online()) return Promise.reject(fail('OFFLINE'));
    var qs = Object.keys(params).filter(function (k) { return params[k] !== '' && params[k] !== null && params[k] !== undefined; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var key = qs;
    if (inflight.has(key)) return inflight.get(key);       // the same question already on its way → share it
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    // A plain GET with no custom headers: no CORS preflight; Apps Script answers with Access-Control-Allow-Origin: *.
    var p = fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + qs, { method: 'GET', redirect: 'follow', cache: 'no-store', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) {
        if (!res.ok) throw fail('NETWORK', 'HTTP ' + res.status);
        return res.text();
      })
      .then(function (txt) {
        var j;
        try { j = JSON.parse(txt); } catch (e) { throw fail(/<html/i.test(txt) ? 'DISABLED' : 'BAD_RESPONSE', 'Not JSON'); }
        if (!j || typeof j !== 'object' || j.apiVersion !== API_VERSION) throw fail('BAD_RESPONSE', 'Unknown API version');
        if (!j.ok) throw fail((j.error && j.error.code) || 'SERVER', j.error && j.error.message);
        if (j.action !== params.action) throw fail('BAD_RESPONSE', 'Wrong action');
        return j;
      }, function (e) {
        if (e && e.code) throw e;
        if (e && e.name === 'AbortError') throw fail('TIMEOUT');
        throw fail(online() ? 'NETWORK' : 'OFFLINE', e && e.message);
      })
      .finally(function () { clearTimeout(timer); inflight.delete(key); });
    inflight.set(key, p);
    return p;
  }

  function isStr(v) { return typeof v === 'string'; }
  function validMeasurements(j, code) {
    if (!j.product || !isStr(j.product.code) || !j.product.code) return false;
    if (normCode(j.product.query) !== normCode(code)) return false;     // the answer must be for the code that was asked
    if (!Array.isArray(j.charts) || (j.status !== 'ok' && j.status !== 'no_chart')) return false;
    return j.charts.every(function (c) {
      return c && isStr(c.id) && Array.isArray(c.sizes) && Array.isArray(c.fields) && c.values && typeof c.values === 'object' &&
        c.sizes.every(function (s) { return s && isStr(s.id) && isStr(s.label); }) &&
        c.fields.every(function (f) { return f && isStr(f.id) && (isStr(f.labelKm) || isStr(f.labelEn)); }) &&
        c.guide && Array.isArray(c.guide.rules);
    });
  }
  function validRecommend(j, code) {
    return j.product && isStr(j.product.code) && normCode(j.product.query) === normCode(code) && isStr(j.status) && j.input &&
      (j.status !== 'ok' || (j.recommended && isStr(j.recommended.sizeLabel)));
  }

  function savedKey(code) { return LS_PREFIX + normCode(code); }
  function readSaved(code) {
    try { var s = JSON.parse(lsGet(savedKey(code)) || 'null'); return s && s.data && validMeasurements(s.data, code) ? s : null; } catch (e) { return null; }
  }
  function writeSaved(code, rec) {
    if (!lsSet(savedKey(code), JSON.stringify({ data: rec.data, at: rec.at }))) pruneSaved(10);
    pruneSaved(MAX_SAVED);
  }
  function pruneSaved(keep) {
    try {
      var list = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(LS_PREFIX) === 0) { var at = 0; try { at = JSON.parse(localStorage.getItem(k)).at || 0; } catch (e) { } list.push([k, at]); }
      }
      list.sort(function (a, b) { return b[1] - a[1]; }).slice(keep).forEach(function (x) { lsDel(x[0]); });
    } catch (e) { }
  }

  /** Last known copy (memory, then this browser), without asking the server. */
  function peek(code) {
    var m = mem.get(normCode(code));
    if (m) return m;
    var s = readSaved(code);
    return s ? { data: s.data, at: s.at, source: 'saved' } : null;
  }

  /** Fetch fresh measurements. Resolves { data, at, source:'network' }; rejects with e.code. */
  function getMeasurements(code) {
    code = cleanCode(code);
    return request({ action: 'getProductMeasurements', code: code }).then(function (j) {
      if (!validMeasurements(j, code)) throw fail('BAD_RESPONSE', 'Unexpected chart data');
      var rec = { data: j, at: Date.now(), source: 'network' };
      mem.set(normCode(code), rec);
      writeSaved(code, rec);
      return rec;
    }, function (e) {
      if (e && e.code === 'NOT_FOUND') { mem.delete(normCode(code)); lsDel(savedKey(code)); }
      throw e;
    });
  }

  function recommend(code, p) {
    code = cleanCode(code);
    return request({ action: 'recommendSize', code: code, heightCm: p.heightCm, weightKg: p.weightKg, garment: p.garment, chartId: p.chartId, fit: p.fit }).then(function (j) {
      if (!validRecommend(j, code)) throw fail('BAD_RESPONSE', 'Unexpected recommendation');
      return j;
    });
  }

  function recent() { try { var a = JSON.parse(lsGet(LS_RECENT) || '[]'); return Array.isArray(a) ? a.filter(isStr).slice(0, 8) : []; } catch (e) { return []; } }
  function pushRecent(code) { var a = recent().filter(function (c) { return normCode(c) !== normCode(code); }); a.unshift(code); lsSet(LS_RECENT, JSON.stringify(a.slice(0, 8))); }

  /* ---------------------------------------------------------------- styles (scoped .vsz-) */
  var CSS = [
    '.vsz{--z-bg:#faf7f0;--z-card:#fff;--z-ink:#23252b;--z-mut:#6b6f78;--z-line:#e6e2d8;--z-line2:#d4cfc2;',
    '  --z-ok:#1d7a46;--z-okbg:#e8f5ed;--z-okln:#a8d5b9;--z-warn:#8a5a00;--z-warnbg:#fff4d9;--z-warnln:#efcf7f;--z-bad:#b42318;--z-badbg:#fdeceb;--z-badln:#f2b8b5;--z-acc:#2f6fed;',
    '  display:block;background:var(--z-bg);color:var(--z-ink);border-radius:14px;padding:10px;touch-action:manipulation;font-size:15px;line-height:1.45}',
    '.vsz *{box-sizing:border-box}',
    '.vsz button{touch-action:manipulation;cursor:pointer;font:inherit;color:inherit}',
    '.vsz .z-card{background:var(--z-card);border:1px solid var(--z-line);border-radius:12px;padding:12px;margin:0 0 10px}',
    '.vsz .z-lbl{font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--z-mut)}',
    '.vsz .z-en{display:block;font-size:12.5px;color:var(--z-mut);font-weight:500}',
    '.vsz .z-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.vsz .z-grow{flex:1 1 auto;min-width:0}',
    '.vsz .z-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:8px 14px;border-radius:10px;border:1.5px solid var(--z-line2);background:#fff;font-weight:700;font-size:15px;line-height:1.2;text-align:center}',
    '.vsz .z-btn.pri{background:var(--z-ink);border-color:var(--z-ink);color:#fff}',
    '.vsz .z-btn.go{background:var(--z-acc);border-color:var(--z-acc);color:#fff}',
    '.vsz .z-btn.big{min-height:52px;font-size:16.5px;width:100%}',
    '.vsz .z-btn.done{background:var(--z-ok);border-color:var(--z-ok);color:#fff}',
    '.vsz .z-btn:disabled{opacity:.45;cursor:not-allowed}',
    '.vsz .z-in{min-height:48px;width:100%;border:1.5px solid var(--z-line2);border-radius:10px;padding:8px 12px;background:#fff;font-size:16px;color:var(--z-ink)}',
    '.vsz .z-in:focus{outline:3px solid #b9ccf8;border-color:var(--z-acc)}',
    '.vsz .z-in.err{border-color:var(--z-bad)}',
    '.vsz .z-unit{position:relative}',
    '.vsz .z-unit .z-in{padding-right:46px;font-size:18px;font-weight:700}',
    '.vsz .z-unit b{position:absolute;right:12px;top:50%;transform:translateY(-50%);color:var(--z-mut);font-size:14px;pointer-events:none}',
    '.vsz .z-fld{display:flex;flex-direction:column;gap:4px;flex:1 1 120px;min-width:0;font-size:13px;font-weight:700;color:var(--z-mut)}',
    /* product */
    '.vsz .z-code{font-size:22px;font-weight:850;letter-spacing:.01em}',
    '.vsz .z-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:2px 10px;font-size:12.5px;font-weight:750;border:1px solid var(--z-line2);background:#fff;white-space:nowrap}',
    '.vsz .z-pill.ok{background:var(--z-okbg);border-color:var(--z-okln);color:var(--z-ok)}',
    '.vsz .z-pill.warn{background:var(--z-warnbg);border-color:var(--z-warnln);color:var(--z-warn)}',
    '.vsz .z-pill.bad{background:var(--z-badbg);border-color:var(--z-badln);color:var(--z-bad)}',
    '.vsz .z-meta{font-size:13px;color:var(--z-mut);margin-top:6px;overflow-wrap:anywhere}',
    '.vsz .z-state{display:flex;gap:10px;align-items:flex-start;border-radius:10px;padding:9px 11px;margin-top:10px;border:1px solid var(--z-line);font-weight:750;overflow-wrap:anywhere}',
    '.vsz .z-state i{flex:none;width:12px;height:12px;border-radius:50%;margin-top:5px;background:#aaa}',
    '.vsz .z-state.ok{background:var(--z-okbg);border-color:var(--z-okln);color:var(--z-ok)}.vsz .z-state.ok i{background:var(--z-ok)}',
    '.vsz .z-state.warn{background:var(--z-warnbg);border-color:var(--z-warnln);color:var(--z-warn)}.vsz .z-state.warn i{background:#d79a00}',
    '.vsz .z-state.bad{background:var(--z-badbg);border-color:var(--z-badln);color:var(--z-bad)}.vsz .z-state.bad i{background:var(--z-bad)}',
    '.vsz .z-state.busy{color:var(--z-mut)}.vsz .z-state.busy i{animation:zp 1s infinite alternate}',
    '@keyframes zp{from{opacity:.25}to{opacity:1}}',
    '.vsz .z-sync{font-size:12.5px;margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
    '.vsz .z-dot{width:8px;height:8px;border-radius:50%;background:#aaa;flex:none}',
    '.vsz .z-dot.ok{background:var(--z-ok)}.vsz .z-dot.warn{background:#d79a00}.vsz .z-dot.bad{background:var(--z-bad)}',
    '.vsz .z-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}',
    '.vsz .z-tab{min-height:44px;padding:6px 12px;border-radius:10px;border:1.5px solid var(--z-line2);background:#fff;font-weight:700;text-align:left}',
    '.vsz .z-tab[aria-pressed="true"]{border-color:var(--z-ink);box-shadow:inset 0 0 0 1px var(--z-ink)}',
    /* recommendation card */
    '.vsz .z-rec{text-align:center;padding:14px 12px}',
    '.vsz .z-rec.ok{background:var(--z-okbg);border-color:var(--z-okln)}',
    '.vsz .z-rec.warn{background:var(--z-warnbg);border-color:var(--z-warnln)}',
    '.vsz .z-rec.bad{background:var(--z-badbg);border-color:var(--z-badln)}',
    '.vsz .z-size{font-size:56px;line-height:1;font-weight:900;margin:6px 0 4px;letter-spacing:-.01em;color:var(--z-ok)}',
    '.vsz .z-src{font-weight:750}',
    '.vsz .z-why{list-style:none;margin:10px 0 0;padding:0;text-align:left;font-size:13.5px}',
    '.vsz .z-why li{padding:5px 0;border-top:1px solid rgba(0,0,0,.07)}',
    '.vsz .z-opts{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:10px}',
    '.vsz .z-opt{min-height:48px;min-width:64px;padding:6px 14px;border-radius:10px;border:1.5px solid var(--z-line2);background:#fff;font-weight:850;font-size:18px}',
    '.vsz .z-opt[aria-pressed="true"]{background:var(--z-ink);color:#fff;border-color:var(--z-ink)}',
    /* chart table */
    '.vsz table.z-tbl{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:15px}',
    '.vsz .z-tbl th{font-size:12px;font-weight:750;color:var(--z-mut);text-align:right;padding:6px 4px;vertical-align:bottom;border-bottom:1.5px solid var(--z-line2);overflow-wrap:anywhere;line-height:1.25}',
    '.vsz .z-tbl th:first-child,.vsz .z-tbl td:first-child{text-align:left;width:64px}',
    '.vsz .z-tbl th small{display:block;font-weight:500}',
    '.vsz .z-tbl td{padding:0 4px;height:46px;text-align:right;border-bottom:1px solid var(--z-line);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
    '.vsz .z-tbl tr{cursor:pointer}',
    '.vsz .z-tbl td.z-sz{font-weight:850;font-size:16px}',
    '.vsz .z-tbl td.z-sz small{display:block;font-size:11px;font-weight:700}',
    '.vsz .z-tbl tr.rec td{background:var(--z-okbg)}',
    '.vsz .z-tbl tr.rec td.z-sz{color:var(--z-ok)}',
    '.vsz .z-tbl tr.sel td{box-shadow:inset 0 2px 0 var(--z-ink),inset 0 -2px 0 var(--z-ink)}',
    '.vsz .z-tbl tr.sel td:first-child{box-shadow:inset 2px 2px 0 var(--z-ink),inset 0 -2px 0 var(--z-ink)}',
    '.vsz .z-tbl tr.sel td:last-child{box-shadow:inset -2px 2px 0 var(--z-ink),inset 0 -2px 0 var(--z-ink)}',
    '.vsz .z-tbl td.empty{color:#b5b1a6}',
    '.vsz .z-tbl .z-staff{opacity:.6}',
    '.vsz .z-out{color:var(--z-bad)}.vsz .z-in-stock{color:var(--z-ok)}',
    /* stacked chart for many columns */
    '.vsz .z-stack{display:grid;gap:8px}',
    '.vsz .z-sc{border:1.5px solid var(--z-line);border-radius:10px;padding:8px 10px;background:#fff;text-align:left;width:100%}',
    '.vsz .z-sc.rec{background:var(--z-okbg);border-color:var(--z-okln)}',
    '.vsz .z-sc.sel{border-color:var(--z-ink);box-shadow:inset 0 0 0 1px var(--z-ink)}',
    '.vsz .z-sc dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:2px 12px;margin:4px 0 0}',
    '.vsz .z-sc dt{font-size:12px;color:var(--z-mut)}.vsz .z-sc dd{margin:0 0 4px;font-weight:750}',
    /* checks */
    '.vsz .z-checks{list-style:none;margin:0;padding:0;font-size:13.5px}',
    '.vsz .z-checks li{display:flex;gap:8px;padding:5px 0;border-top:1px solid var(--z-line)}',
    '.vsz .z-checks li:first-child{border-top:0}',
    '.vsz .z-checks .ic{flex:none;width:20px;text-align:center;font-weight:900}',
    '.vsz .z-checks .ok .ic{color:var(--z-ok)}.vsz .z-checks .warn .ic{color:#c48a00}.vsz .z-checks .bad .ic{color:var(--z-bad)}.vsz .z-checks .info .ic{color:var(--z-mut)}',
    '.vsz details.z-acc>summary{min-height:44px;display:flex;align-items:center;gap:8px;font-weight:750;cursor:pointer;list-style:none}',
    '.vsz details.z-acc>summary::-webkit-details-marker{display:none}',
    '.vsz details.z-acc>summary:after{content:"▾";margin-left:auto;color:var(--z-mut)}',
    '.vsz details.z-acc[open]>summary:after{content:"▴"}',
    /* customer message */
    '.vsz .z-seg{display:flex;border:1.5px solid var(--z-line2);border-radius:10px;overflow:hidden;margin:8px 0}',
    '.vsz .z-seg button{flex:1 1 0;min-height:44px;border:0;background:#fff;font-weight:750;color:var(--z-mut)}',
    '.vsz .z-seg button[aria-pressed="true"]{background:var(--z-ink);color:#fff}',
    '.vsz .z-chat{background:#eef0f3;border-radius:12px;padding:12px}',
    '.vsz .z-bubble{background:#fff;border-radius:16px 16px 16px 4px;padding:11px 13px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.55;box-shadow:0 1px 1px rgba(0,0,0,.06);max-width:100%}',
    '.vsz .z-note{font-size:13px;color:var(--z-mut);margin-top:6px}',
    '.vsz .z-note.warn{color:var(--z-warn)}.vsz .z-note.bad{color:var(--z-bad)}.vsz .z-note.ok{color:var(--z-ok)}',
    '.vsz .z-acts{display:grid;gap:8px;margin-top:10px}',
    '@media (min-width:520px){.vsz .z-acts.two{grid-template-columns:1fr 1fr}}',
    '.vsz .z-dock{position:sticky;bottom:0;z-index:5;margin:0 -10px -10px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:rgba(250,247,240,.96);border-top:1px solid var(--z-line);border-radius:0 0 14px 14px}',
    '.vsz .z-empty{color:var(--z-mut);text-align:center;padding:16px 6px}',
    '.vsz .z-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}',
    '.vsz .z-chip{min-height:40px;padding:4px 12px;border-radius:999px;border:1px solid var(--z-line2);background:#fff;font-weight:700;font-size:14px}',
    '.vsz .z-guide{font-size:13.5px;padding:6px 0;border-top:1px solid var(--z-line);overflow-wrap:anywhere}'
  ].join('\n');
  function injectCss() {
    if (document.getElementById('vsz-css')) return;
    var s = document.createElement('style'); s.id = 'vsz-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === false || v === null || v === undefined) return;
      if (k === 'class') el.className = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'open' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { add(el, k); }); return; }
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  /** Khmer line + smaller English line */
  function bi(pair, cls) { return h('span', { class: cls || '' }, pair[0], h('span', { class: 'z-en' }, pair[1])); }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) { }
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { }
      document.body.removeChild(ta); return ok;
    }
    try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback); } catch (e) { }
    return Promise.resolve(fallback());
  }

  /* ---------------------------------------------------------------- panel = STAFF VIEW + CUSTOMER MESSAGE PREVIEW */
  /**
   * opts: {
   *   mode: 'admin' | 'phone',
   *   search: bool              — show the code search box (phone)
   *   onUseReply(text, info)    — admin: put the customer message into the reply composer
   *   onCopy(text, info, ok)
   *   stockFor(size)            — admin: { inStock: bool, colors: [] } | null for the loaded stock
   *   lang: 'km' | 'en'
   * }
   */
  function createPanel(opts) {
    opts = opts || {};
    injectCss();
    var el = h('div', { class: 'vsz', 'data-vsz': opts.mode || '' });
    var LANG_KEY = 'vhm_size_lang_' + (opts.mode || 'x');
    var savedLang = lsGet(LANG_KEY);
    var st = {
      code: '', token: 0, loading: false, rec: null, err: null,
      chartId: '', size: '', sizeByUser: false, h: '', w: '', fit: '', inErr: '',
      r: null, rLoading: false, rErr: null, rKey: '', rPick: '',
      lang: savedLang === 'en' ? 'en' : (opts.lang === 'en' ? 'en' : 'km'), copied: 0, copyFail: false
    };

    function curData() { return st.rec && st.rec.data; }
    function curChart() {
      var d = curData(); if (!d || !d.charts.length) return null;
      return d.charts.filter(function (c) { return c.id === st.chartId; })[0] || d.charts.filter(function (c) { return c.id === d.activeChartId; })[0] || d.charts[0];
    }
    function inputKey() { var c = curChart(); return [st.code, c ? c.id : '', c ? c.garment : '', String(st.h).trim(), String(st.w).trim(), st.fit].join('|'); }
    function prefs() { var d = curData(); return (d && d.fitPreferences) || []; }
    function unconfirmed() { return !!(st.rec && (st.rec.source === 'saved' || (st.err && st.err.code !== 'NOT_FOUND'))); }

    function setCode(code, o) {
      code = cleanCode(code);
      o = o || {};
      if (!code) { st.code = ''; st.rec = null; st.err = null; st.loading = false; render(); return; }
      var same = normCode(code) === normCode(st.code);
      if (!same) {
        st.code = code; st.chartId = ''; st.size = ''; st.sizeByUser = false; st.r = null; st.rErr = null; st.rKey = ''; st.rPick = ''; st.inErr = '';
        if (!o.keepBody) { st.h = ''; st.w = ''; st.fit = ''; }
        st.rec = peek(code); st.err = null;
      }
      var fresh = st.rec && st.rec.source === 'network' && Date.now() - st.rec.at < 60000;
      if (same && fresh && !o.force) { render(); return; }
      load();
    }

    function load() {
      var code = st.code; if (!code) return;
      var token = ++st.token;
      st.loading = true; st.err = null; render();
      getMeasurements(code).then(function (rec) {
        if (token !== st.token) return;
        st.loading = false; st.rec = rec; st.err = null;
        pushRecent(rec.data.product.code);
        render();
      }, function (e) {
        if (token !== st.token) return;
        st.loading = false; st.err = e;
        if (e.code === 'NOT_FOUND') st.rec = null;
        else if (!st.rec) st.rec = peek(code);
        render();
      });
    }

    function parseIn(v, lo, hi) { var s = String(v).trim().replace(',', '.'); if (!s) return { s: '' }; if (!/^\d{2,3}(\.\d)?$/.test(s)) return { bad: true }; var n = Number(s); return n < lo || n > hi ? { bad: true } : { s: s }; }
    function runRecommend() {
      var c = curChart(), d = curData();
      if (!d) return;
      var hh = parseIn(st.h, 100, 230), ww = parseIn(st.w, 25, 200);
      st.inErr = '';
      if (hh.bad) st.inErr = 'h'; else if (ww.bad) st.inErr = 'w'; else if (!hh.s && !ww.s) st.inErr = 'both';
      if (st.inErr) { st.r = null; st.rErr = null; render(); return; }
      var key = inputKey(), code = st.code, token = st.token;
      st.rLoading = true; st.rErr = null; st.rPick = ''; render();
      recommend(code, { heightCm: hh.s, weightKg: ww.s, garment: c ? c.garment : '', chartId: c ? c.id : '', fit: st.fit }).then(function (j) {
        if (token !== st.token || normCode(code) !== normCode(st.code)) return;
        st.rLoading = false; st.r = j; st.rKey = key; st.sizeByUser = false;
        if (j.status === 'ok') {
          var cc = curChart(), m = j.recommended.measurements;
          var row = cc && ((m && m.found && m.chartId === cc.id && cc.sizes.filter(function (s) { return s.id === m.rowId; })[0]) || cc.sizes.filter(function (s) { return normCode(s.label) === normCode(j.recommended.sizeLabel); })[0]);
          if (row) st.size = row.label;
        }
        if (d && j.dataVersion > d.dataVersion) load();   // the Sheet changed since the chart was loaded → reload so both agree
        render();
      }, function (e) {
        if (token !== st.token) return;
        st.rLoading = false; st.rErr = e; st.r = null; render();
      });
    }

    function verified() {
      return verifyReply({ data: curData(), chart: curChart(), size: st.size, rec: st.r, recCurrent: !!st.r && st.rKey === inputKey(), pick: st.rPick });
    }
    function messageFor(v, lang) {
      var c = curChart(), d = curData();
      if (!v.mode || !c) return '';
      return buildMessage({ lang: lang || st.lang, code: d.product.code, garment: c.garment, size: st.size, recommend: v.mode === 'recommend',
        basis: { h: !!String(st.h).trim(), w: !!String(st.w).trim() }, lines: v.lines });
    }

    /* ---- render (keeps the focused input and caret, so a background refresh never interrupts typing) ---- */
    function render() {
      var a = document.activeElement, keep = null;
      if (a && el.contains(a) && a.getAttribute('data-vsz') && (a.tagName === 'INPUT' || a.tagName === 'SELECT')) {
        keep = { k: a.getAttribute('data-vsz'), v: a.value, s: null, e: null };
        try { keep.s = a.selectionStart; keep.e = a.selectionEnd; } catch (x) { }
      }
      draw();
      if (keep) {
        var b = el.querySelector('[data-vsz="' + keep.k + '"]');
        if (b) { if (b.tagName === 'INPUT') b.value = keep.v; b.focus(); try { if (keep.s !== null) b.setSelectionRange(keep.s, keep.e); } catch (x) { } }
      }
    }
    function draw() {
      el.innerHTML = '';
      if (opts.search) el.append(searchBox());
      if (!st.code) { el.append(h('div', { class: 'z-empty' }, bi(['វាយកូដផលិតផល ដើម្បីមើលរង្វាស់', 'Type a product code to see its measurements']))); return; }
      el.append(productCard());
      var d = curData(), c = curChart();
      if (!d || !c) return;
      if (!st.size || !c.sizes.some(function (s) { return s.label === st.size; })) { st.size = c.sizes.length ? c.sizes[0].label : ''; st.sizeByUser = false; }
      var v = verified();
      el.append(inputCard(c), recCard(c, v), chartCard(c, v), checksCard(v), messageCard(v));
      var text = messageFor(v);
      if (opts.mode === 'phone' && text) el.append(dock(text, v));
    }

    function searchBox() {
      var inp = h('input', { class: 'z-in', type: 'search', 'data-vsz': 'code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', enterkeyhint: 'search', placeholder: 'E353', value: st.code, 'aria-label': 'Product code' });
      function go() { var v = cleanCode(inp.value); if (v) setCode(v, { force: normCode(v) === normCode(st.code) }); }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      var rec = recent();
      return h('div', { class: 'z-card' },
        h('div', { class: 'z-row', style: 'align-items:flex-end' }, h('label', { class: 'z-fld', style: 'flex:3 1 150px' }, 'កូដផលិតផល · Product code', inp),
          h('button', { type: 'button', class: 'z-btn go', 'data-vsz': 'find', onclick: go, style: 'min-height:48px' }, 'ស្វែងរក · Find')),
        rec.length ? h('div', { class: 'z-chips', 'aria-label': 'Recent codes' }, rec.map(function (x) {
          return h('button', { type: 'button', class: 'z-chip', onclick: function () { setCode(x); } }, x);
        })) : null);
    }

    /* The three system states (+ loading / error) for the chart, and a separate line for data freshness. */
    function chartState() {
      var d = curData(), c = curChart(), e = st.err;
      if (e && e.code === 'NOT_FOUND') return ['bad', ['រកមិនឃើញកូដ ' + st.code, 'Code ' + st.code + ' was not found in VH MEN System']];
      if (!d) {
        if (st.loading) return ['busy', ['កំពុងទាញទិន្នន័យ…', 'Loading from Google Sheets…']];
        var t = errText(e || {}); return ['bad', ['✗ ' + t[0], t[1]]];
      }
      if (!c) return ['bad', ['គ្មានតារាងរង្វាស់ — មិនអាចបង្កើតសាររង្វាស់បានទេ', 'Chart unavailable — no product-specific chart, so no measurement message']];
      if (!c.guide.rules.length) return ['warn', ['មានតារាង តែគ្មានច្បាប់ណែនាំដែលបានអនុម័ត', 'No FitRule — chart available, but no approved recommendation rules']];
      return ['ok', ['តារាងត្រូវគ្នា · ច្បាប់អនុម័ត ' + c.guide.rules.length, 'Chart matched — product-specific chart and ' + c.guide.rules.length + ' approved FitRule' + (c.guide.rules.length === 1 ? '' : 's') + (c.guide.source === 'group' ? ' (group “' + c.guide.groupName + '”)' : '')]];
    }
    function syncLine() {
      var r = st.rec, e = st.err;
      if (!r) return null;
      var gen = Date.parse(r.data.generatedAt) || r.at;
      var cls, txt;
      if (r.source === 'network' && !e) {
        var old = Date.now() - r.at > FRESH_MS;
        cls = old ? 'warn' : 'ok';
        txt = (old ? 'Read from Google Sheets at ' + fmtWhen(gen) + ' — older than 10 min' : 'Live · read from Google Sheets at ' + fmtWhen(gen));
      } else if (r.source === 'network') {
        cls = 'warn'; txt = 'Could not refresh — showing data read at ' + fmtWhen(gen) + ', not confirmed current · ' + errText(e)[1];
      } else {
        cls = 'warn'; txt = 'Saved copy from ' + fmtWhen(gen) + ' — not live data' + (e ? ' · ' + errText(e)[1] : '');
      }
      if (st.loading) txt += ' · refreshing…';
      return h('div', { class: 'z-sync', 'data-vsz': 'status', 'data-source': r.source === 'network' && !e ? 'network' : r.source === 'network' ? 'stale' : 'saved', role: 'status' },
        h('span', { class: 'z-dot ' + cls }), h('span', { class: 'z-grow' }, txt));
    }

    function productCard() {
      var d = curData(), c = curChart();
      var s = chartState();
      var card = h('div', { class: 'z-card', 'data-vsz': 'product' });
      var g = c ? GARMENT[c.garment] : null;
      card.append(h('div', { class: 'z-row' },
        h('div', { class: 'z-grow' }, h('div', { class: 'z-lbl' }, 'ផលិតផល · Product'), h('div', { class: 'z-code', 'data-vsz': 'pcode' }, d ? d.product.code : st.code.toUpperCase())),
        h('button', { type: 'button', class: 'z-btn', 'data-vsz': 'refresh', disabled: st.loading, onclick: function () { load(); }, 'aria-label': 'Refresh from Google Sheets' }, st.loading ? '⏳' : '↻', ' Refresh')));
      if (d) {
        card.append(h('div', { class: 'z-row', style: 'margin-top:6px' },
          g ? h('span', { class: 'z-pill', 'data-vsz': 'category' }, g[0] + ' · ' + g[1]) : (d.product.category ? h('span', { class: 'z-pill' }, d.product.category) : null),
          c ? h('span', { class: 'z-pill ' + (c.status === 'active' ? 'ok' : 'warn'), 'data-vsz': 'chartstatus' }, c.status === 'active' ? '● Active chart' : '● ' + c.status.charAt(0).toUpperCase() + c.status.slice(1) + ' chart') : null,
          d.product.archived ? h('span', { class: 'z-pill warn' }, 'Archived product') : null));
        var meta = [];
        if (d.product.name) meta.push(d.product.name);
        if (c) meta.push([c.title, c.variant].filter(Boolean).join(' · ') || c.id);
        if (c && c.updatedAt) meta.push('Chart updated ' + fmtWhen(Date.parse(c.updatedAt)));
        card.append(h('div', { class: 'z-meta' }, meta.join(' — ')));
        if (d.product.matchedBy === 'identifier') card.append(h('div', { class: 'z-meta' }, d.product.query + ' → ' + d.product.code));
      }
      card.append(h('div', { class: 'z-state ' + s[0], 'data-vsz': 'state', 'data-state': s[0], role: s[0] === 'bad' ? 'alert' : 'status' }, h('i'), bi(s[1])));
      if (!d && st.err && st.err.code !== 'NOT_FOUND') card.append(h('div', { style: 'margin-top:8px' }, h('button', { type: 'button', class: 'z-btn', onclick: function () { load(); } }, 'ព្យាយាមម្ដងទៀត · Try again')));
      var sl = syncLine(); if (sl) card.append(sl);
      if (d && !c) card.append(h('div', { class: 'z-meta', 'data-vsz': 'nochart' }, 'No generic chart is shown instead. Add a chart for ' + d.product.code + ' in VH MEN System, or check the code.' + (opts.mode === 'admin' ? ' The live-log “Size by weight (estimate)” in Product replies still works.' : '')));
      if (d && d.charts.length > 1) card.append(h('div', { class: 'z-tabs', role: 'group', 'aria-label': 'Charts' }, d.charts.map(function (x) {
        var gg = GARMENT[x.garment] || [x.garment, x.garment];
        return h('button', { type: 'button', class: 'z-tab', 'aria-pressed': x.id === c.id ? 'true' : 'false', onclick: function () { st.chartId = x.id; st.size = ''; st.r = null; render(); } },
          gg[0] + ' · ' + gg[1], h('span', { class: 'z-en' }, [x.title, x.variant].filter(Boolean).join(' · ') || x.id));
      })));
      return card;
    }

    function inputCard(c) {
      var fits = c.guide.fits.filter(Boolean), P = prefs();
      function inp(k, ph, label) {
        var x = h('input', { class: 'z-in' + (st.inErr === k || st.inErr === 'both' ? ' err' : ''), type: 'text', inputmode: 'decimal', pattern: '[0-9]*[.,]?[0-9]*', 'data-vsz': k === 'h' ? 'height' : 'weight', placeholder: ph, value: k === 'h' ? st.h : st.w, 'aria-label': label, autocomplete: 'off', enterkeyhint: 'done' });
        x.addEventListener('input', function () { if (k === 'h') st.h = x.value; else st.w = x.value; });
        x.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runRecommend(); } });
        return x;
      }
      var card = h('div', { class: 'z-card', 'data-vsz': 'body' },
        h('div', { class: 'z-lbl' }, 'រង្វាស់ខ្លួនអតិថិជន · Customer’s body'),
        h('div', { class: 'z-row', style: 'margin-top:6px;align-items:flex-start' },
          h('label', { class: 'z-fld' }, 'កម្ពស់ · Height', h('span', { class: 'z-unit' }, inp('h', '170', 'Customer height in centimetres'), h('b', null, 'cm'))),
          h('label', { class: 'z-fld' }, 'ទម្ងន់ · Weight', h('span', { class: 'z-unit' }, inp('w', '65', 'Customer weight in kilograms'), h('b', null, 'kg')))));
      if (st.inErr) card.append(h('div', { class: 'z-note bad', role: 'alert', 'data-vsz': 'inerr' },
        st.inErr === 'both' ? 'សូមវាយកម្ពស់ ឬទម្ងន់ · Enter height and/or weight.' : st.inErr === 'h' ? 'កម្ពស់ជា cm ឧ. 170 · Height in cm, e.g. 170 (100–230).' : 'ទម្ងន់ជា kg ឧ. 65 · Weight in kg, e.g. 65 (25–200).'));
      if (fits.length) {
        var sel = h('select', { class: 'z-in', 'data-vsz': 'fit', 'aria-label': 'Preferred fit', onchange: function (e) { st.fit = e.target.value; } },
          h('option', { value: '' }, 'គ្រប់របៀប · Any fit'), fits.map(function (f) { var l = fitLabel(f, P); return h('option', { value: f, selected: st.fit === f }, l[0] + ' · ' + l[1]); }));
        card.append(h('label', { class: 'z-fld', style: 'margin-top:8px' }, 'របៀបពាក់ · Fit', sel));
      }
      var again = st.r && st.rKey !== inputKey();
      card.append(h('div', { style: 'margin-top:10px' }, h('button', { type: 'button', class: 'z-btn pri big', 'data-vsz': 'recommend', disabled: st.rLoading || !online(), onclick: runRecommend },
        st.rLoading ? '⏳ កំពុងពិនិត្យ… · Checking…' : again ? '↻ ណែនាំម្ដងទៀត · Recommend again' : 'ណែនាំទំហំ · Recommend size')));
      if (!online()) card.append(h('div', { class: 'z-note bad' }, 'គ្មានអ៊ីនធឺណិត · Offline — the recommendation cannot be checked. The chart below is a saved copy.'));
      return card;
    }

    function recCard(c, v) {
      var r = st.r, P = prefs();
      if (st.rErr) { var t = errText(st.rErr); return h('div', { class: 'z-card z-rec bad', 'data-vsz': 'result', role: 'alert' }, h('div', { class: 'z-lbl' }, 'Recommendation'), h('div', { style: 'margin-top:6px;font-weight:750' }, bi(['✗ ' + t[0], t[1]]))); }
      if (!r) {
        if (!c.guide.rules.length) return h('div', { class: 'z-card z-rec warn', 'data-vsz': 'result', 'data-status': 'no_rules_known' }, h('div', { class: 'z-lbl' }, 'Recommendation'),
          h('div', { style: 'margin-top:6px;font-weight:800' }, bi(STATUS.no_rules)), h('div', { class: 'z-note' }, 'You can still send the measurements of a size the customer asks for.'));
        return h('div', { class: 'z-card z-rec', 'data-vsz': 'result' }, h('div', { class: 'z-lbl' }, 'Recommendation'), h('div', { class: 'z-note' }, 'Enter height and/or weight, then tap Recommend size.'));
      }
      var stale = st.rKey !== inputKey();
      var why = (r.reasons || []).filter(function (x) { return x.k !== 'partial_hint' || opts.mode === 'admin'; }).slice(0, 4);
      var whyEl = why.length ? h('ul', { class: 'z-why' }, why.map(function (x) { var p = reasonText(x, P); return h('li', null, p[0], h('span', { class: 'z-en' }, p[1])); })) : null;
      var src = r.source === 'group' ? 'Matching group FitRule · “' + r.groupName + '”' : 'Matching product-specific FitRule';
      var card;
      if (r.status === 'ok') {
        var recBad = v.checks.some(function (k) { return k.k === 'recsize' && k.level === 'bad'; });
        card = h('div', { class: 'z-card z-rec ' + (recBad || stale ? 'warn' : 'ok'), 'data-vsz': 'result', 'data-status': recBad ? 'size_missing' : 'ok' },
          h('div', { class: 'z-lbl' }, 'ទំហំណែនាំ · Recommended size'),
          h('div', { class: 'z-size', 'data-vsz': 'recsize' }, v.recSize || r.recommended.sizeLabel),
          h('div', { class: 'z-src', 'data-vsz': 'source' }, recBad ? '✗ Size not in this chart — no recommendation message' : src),
          r.fit ? h('div', { class: 'z-note' }, 'Fit: ' + fitLabel(r.fit, P)[0] + ' · ' + fitLabel(r.fit, P)[1]) : null,
          (r.recommended.guidance || []).length ? h('div', { class: 'z-note' }, '💡 ' + r.recommended.guidance.join(' · ')) : null,
          (r.alternatives || []).length ? h('div', { class: 'z-note' }, 'Also matches: ' + r.alternatives.map(function (a) { return a.sizeLabel + (a.kind === 'fit' ? ' (' + fitLabel(a.fit, P)[1] + ')' : ''); }).join(', ')) : null,
          whyEl);
      } else if (r.status === 'overlap') {
        card = h('div', { class: 'z-card z-rec warn', 'data-vsz': 'result', 'data-status': 'overlap' }, h('div', { class: 'z-lbl' }, 'Recommendation'),
          h('div', { style: 'margin-top:6px;font-weight:800' }, bi(STATUS.overlap)), h('div', { class: 'z-src', style: 'margin-top:4px' }, src),
          h('div', { class: 'z-opts' }, (r.options || []).map(function (o) {
            return h('button', { type: 'button', class: 'z-opt', 'aria-pressed': st.rPick === o.sizeLabel ? 'true' : 'false', onclick: function () { st.rPick = o.sizeLabel; st.size = o.sizeLabel; st.sizeByUser = false; render(); } }, o.sizeLabel);
          })), whyEl);
      } else if (r.status === 'need_fit' || r.status === 'no_fit_rules') {
        card = h('div', { class: 'z-card z-rec warn', 'data-vsz': 'result', 'data-status': r.status }, h('div', { class: 'z-lbl' }, 'Recommendation'),
          h('div', { style: 'margin-top:6px;font-weight:800' }, bi(STATUS[r.status])),
          h('div', { class: 'z-opts' }, (r.fits || []).map(function (f) { var l = fitLabel(f, P); return h('button', { type: 'button', class: 'z-opt', style: 'font-size:15px', onclick: function () { st.fit = f; runRecommend(); } }, l[0] + ' · ' + l[1]); })), whyEl);
      } else {
        card = h('div', { class: 'z-card z-rec warn', 'data-vsz': 'result', 'data-status': r.status }, h('div', { class: 'z-lbl' }, 'Recommendation'),
          h('div', { style: 'margin-top:6px;font-weight:800' }, bi(STATUS[r.status] || [r.status, r.status])), whyEl,
          r.status === 'no_rules' ? h('div', { class: 'z-note' }, 'No size is guessed.' + (opts.mode === 'admin' ? ' Fallback: “Size by weight (estimate)” in Product replies (live-log kg guide).' : '')) : null);
      }
      if (stale) card.append(h('div', { class: 'z-note bad' }, 'បានប្ដូរព័ត៌មាន · Inputs changed — tap “Recommend again”.'));
      return card;
    }

    function chartCard(c, v) {
      var recId = '';
      if (st.r && st.r.status === 'ok' && st.rKey === inputKey()) { var rr = c.sizes.filter(function (s) { return s.label === v.recSize; })[0]; recId = rr ? rr.id : ''; }
      var fields = c.fields;
      var card = h('div', { class: 'z-card', 'data-vsz': 'chart' },
        h('div', { class: 'z-row' }, h('div', { class: 'z-lbl z-grow' }, 'តារាងរង្វាស់ · Measurement chart'), h('span', { class: 'z-note', style: 'margin:0' }, c.sizes.length + ' sizes')),
        h('div', { class: 'z-note', style: 'margin:2px 0 8px' }, 'វាស់លើ' + (c.garment === 'pants' ? 'ខោ' : c.garment === 'shirt' ? 'អាវ' : 'ទំនិញ') + ' មិនមែនខ្លួន · Garment measurements, not body. Tap a size to use it in the message.'));
      if (!c.sizes.length || !fields.length) { card.append(h('div', { class: 'z-empty' }, 'This chart has no ' + (!c.sizes.length ? 'sizes' : 'measurement columns') + ' yet.')); return card; }
      function pick(label) { st.size = label; st.sizeByUser = true; render(); }
      function stockOf(label) { var s = opts.stockFor ? opts.stockFor(label) : null; return s ? h('small', { class: s.inStock ? 'z-in-stock' : 'z-out', title: s.inStock ? 'In stock: ' + s.colors.join(', ') : 'Out of stock' }, s.inStock ? '● stock' : '✗ out') : null; }
      var narrowOk = fields.length <= 5;
      if (narrowOk) {
        var thead = h('tr', null, h('th', null, 'Size'), fields.map(function (f) {
          return h('th', { class: f.customer === false ? 'z-staff' : '', scope: 'col' }, f.labelKm || f.labelEn, f.labelEn && f.labelEn !== f.labelKm ? h('small', null, f.labelEn) : null, h('small', null, (f.unit ? f.unit : '') + (f.method === 'flat' ? ' · flat' : f.method === 'circumference' ? ' · around' : '') + (f.customer === false ? ' · staff' : '')));
        }));
        var tb = h('tbody');
        c.sizes.forEach(function (s) {
          var rv = c.values[s.id] || {};
          tb.append(h('tr', { class: (s.id === recId ? 'rec ' : '') + (s.label === st.size ? 'sel' : ''), 'data-size': s.label, 'data-rec': s.id === recId ? '1' : null, tabindex: '0', role: 'button', 'aria-pressed': s.label === st.size ? 'true' : 'false',
            onclick: function () { pick(s.label); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(s.label); } } },
            h('td', { class: 'z-sz' }, s.label + (s.id === recId ? ' ★' : ''), stockOf(s.label)),
            fields.map(function (f) { var x = rv[f.id], has = x !== undefined && String(x).trim() !== ''; return h('td', { class: (has ? '' : 'empty ') + (f.customer === false ? 'z-staff' : ''), 'data-field': f.key || f.id }, has ? String(x) : '—'); })));
        });
        card.append(h('table', { class: 'z-tbl', 'data-vsz': 'table' }, h('thead', null, thead), tb));
      } else {
        card.append(h('div', { class: 'z-stack', 'data-vsz': 'table' }, c.sizes.map(function (s) {
          var rv = c.values[s.id] || {};
          return h('button', { type: 'button', class: 'z-sc' + (s.id === recId ? ' rec' : '') + (s.label === st.size ? ' sel' : ''), 'data-size': s.label, 'data-rec': s.id === recId ? '1' : null, 'aria-pressed': s.label === st.size ? 'true' : 'false', onclick: function () { pick(s.label); } },
            h('div', { class: 'z-row' }, h('b', { style: 'font-size:17px' }, s.label + (s.id === recId ? ' ★ Recommended' : '')), stockOf(s.label)),
            h('dl', null, fields.map(function (f) { var x = rv[f.id], has = x !== undefined && String(x).trim() !== ''; return [h('dt', null, (f.labelKm || f.labelEn) + (f.labelEn && f.labelEn !== f.labelKm ? ' · ' + f.labelEn : '')), h('dd', { 'data-field': f.key || f.id }, has ? String(x) + (f.unit ? ' ' + f.unit : '') : '—')]; })));
        })));
      }
      // approved guide (staff only)
      var P = prefs(), g = c.guide;
      var det = h('details', { class: 'z-acc', 'data-vsz': 'guide', style: 'margin-top:8px' }, h('summary', null, 'Approved height/weight guide (' + g.rules.length + ')'));
      if (!g.rules.length) det.append(h('div', { class: 'z-note' }, bi(STATUS.no_rules)));
      g.rules.slice().sort(function (a, b) { return c.sizes.findIndex(function (s) { return s.label === a.sizeLabel; }) - c.sizes.findIndex(function (s) { return s.label === b.sizeLabel; }); }).forEach(function (r) {
        var parts = [], hr = range(r.minHeightCm, r.maxHeightCm), wr = range(r.minWeightKg, r.maxWeightKg);
        if (hr) parts.push(hr + ' cm'); if (wr) parts.push(wr + ' kg');
        det.append(h('div', { class: 'z-guide' }, h('b', null, r.sizeLabel), ' · ' + parts.join(' · ') + (r.fit ? ' · ' + fitLabel(r.fit, P)[1] : '') + (r.guidance ? ' · 💡 ' + r.guidance : '')));
      });
      if (g.unmatched && g.unmatched.length) det.append(h('div', { class: 'z-note bad' }, 'Rules for sizes not in this chart: ' + g.unmatched.join(', ')));
      card.append(det);
      return card;
    }

    function checksCard(v) {
      var bad = v.checks.filter(function (k) { return k.level === 'bad'; }).length, warn = v.checks.filter(function (k) { return k.level === 'warn'; }).length;
      var det = h('details', { class: 'z-card z-acc', 'data-vsz': 'checks', open: !!(bad || warn) },
        h('summary', null, h('span', { class: 'z-dot ' + (bad ? 'bad' : warn ? 'warn' : 'ok') }), bad ? bad + ' problem' + (bad > 1 ? 's' : '') + ' — check before replying' : warn ? warn + ' warning' + (warn > 1 ? 's' : '') : 'All checks passed'));
      det.append(h('ul', { class: 'z-checks' }, v.checks.map(function (k) {
        return h('li', { class: k.level, 'data-check': k.k, 'data-level': k.level }, h('span', { class: 'ic' }, k.level === 'ok' ? '✓' : k.level === 'bad' ? '✗' : k.level === 'warn' ? '!' : 'i'), bi(k.t));
      })));
      return det;
    }

    function info(v) { return { code: curData().product.code, size: st.size, recommend: v.mode === 'recommend', source: unconfirmed() ? 'saved' : 'network', generatedAt: curData().generatedAt, lang: st.lang }; }
    function doCopy(text, v) {
      copyText(text).then(function (ok) {
        st.copyFail = !ok; if (ok) st.copied = Date.now(); render();
        if (ok) setTimeout(function () { if (Date.now() - st.copied >= 1700) render(); }, 1850);
        if (opts.onCopy) opts.onCopy(text, info(v), ok);
      });
    }
    function copyBtn(text, v, extraCls, dockLabel) {
      var done = Date.now() - st.copied < 1800;
      return h('button', { type: 'button', class: 'z-btn big ' + (done ? 'done' : 'go') + (extraCls ? ' ' + extraCls : ''), 'data-vsz': dockLabel ? 'dockcopy' : 'copy', onclick: function () { doCopy(text, v); } },
        done ? '✓ បានចម្លង · Copied' : '📋 ' + (dockLabel || 'ចម្លងសារ · Copy message'));
    }

    function messageCard(v) {
      var card = h('div', { class: 'z-card', 'data-vsz': 'message' },
        h('div', { class: 'z-row' }, h('div', { class: 'z-lbl z-grow' }, 'សារសម្រាប់អតិថិជន · Customer message'), h('span', { class: 'z-note', style: 'margin:0' }, 'Preview')));
      card.append(h('div', { class: 'z-seg', role: 'group', 'aria-label': 'Message language' }, [['km', 'ខ្មែរ'], ['en', 'English']].map(function (l) {
        return h('button', { type: 'button', 'aria-pressed': st.lang === l[0] ? 'true' : 'false', 'data-lang': l[0], onclick: function () { st.lang = l[0]; lsSet(LANG_KEY, l[0]); render(); } }, l[1]);
      })));
      var text = messageFor(v);
      if (!text) {
        var why = v.checks.filter(function (k) { return k.level === 'bad'; })[0];
        card.append(h('div', { class: 'z-note bad', 'data-vsz': 'nomsg' }, 'No customer message: ' + (why ? why.t[1] : 'choose a size') + '.'));
        return card;
      }
      card.append(h('div', { class: 'z-note ' + (v.mode === 'recommend' ? 'ok' : ''), 'data-vsz': 'msgmode', 'data-mode': v.mode },
        v.mode === 'recommend' ? '✓ Recommendation message · Size ' + st.size : 'Measurements only · Size ' + st.size + ' (no recommendation)'));
      card.append(h('div', { class: 'z-chat' }, h('div', { class: 'z-bubble kh', 'data-vsz': 'msgtext', tabindex: '0', lang: st.lang }, text)));
      if (unconfirmed()) card.append(h('div', { class: 'z-note warn' }, '⚠ Not confirmed current (saved copy or refresh failed) — check before sending.'));
      var acts = h('div', { class: 'z-acts' + (opts.onUseReply ? ' two' : '') }, copyBtn(text, v));
      if (opts.onUseReply) acts.append(h('button', { type: 'button', class: 'z-btn big', 'data-vsz': 'use', onclick: function () { opts.onUseReply(text, info(v)); } }, '↘ ដាក់ក្នុងប្រអប់ឆ្លើយ · Use in reply'));
      card.append(acts);
      if (st.copyFail) card.append(h('div', { class: 'z-note bad' }, 'Copy blocked — long-press the message to copy it.'));
      return card;
    }

    /* phone: the copy action stays reachable while scrolling through the chart */
    function dock(text, v) {
      return h('div', { class: 'z-dock', 'data-vsz': 'dock' }, copyBtn(text, v, '', (st.lang === 'km' ? 'ចម្លងសារខ្មែរ' : 'Copy English message') + ' · Size ' + st.size));
    }

    // keep data honest over time
    function maybeRefresh() {
      if (!st.code || st.loading || document.hidden || !online()) return;
      if (!st.rec || st.err || st.rec.source === 'saved' || Date.now() - st.rec.at > FRESH_MS) load();
      else render();
    }
    window.addEventListener('online', function () { if (st.code) maybeRefresh(); else render(); });
    window.addEventListener('offline', function () { render(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) maybeRefresh(); });
    setInterval(maybeRefresh, 60000);

    render();
    return {
      el: el,
      setCode: setCode,
      refresh: function () { if (st.code) load(); },
      code: function () { return st.code; },
      render: render
    };
  }

  window.VHMSize = { createPanel: createPanel, buildMessage: buildMessage, verifyReply: verifyReply, getMeasurements: getMeasurements, recommend: recommend, peek: peek, apiUrl: apiUrl, _normCode: normCode };
})();
