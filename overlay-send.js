(function () {
  /* VHM — Send to stream overlay.
     Reads stock rows from the Vrich page exactly like "Send stock",
     then lets staff put one code into a stream slot (Shirt / Pants / In hand / In hand 2),
     clear a slot, or refresh every slot whose code is on this page. */
  var API = 'https://firestore.googleapis.com/v1/projects/vhm-catalog/databases/(default)/documents/kv/';
  var AK = '?key=AIzaSyDDQp5_gvuRdX0flKQ3gm3zXJM_SXWUJSE';
  var SLOTS = [
    { id: 'shirt', km: 'អាវលើខ្លួន', en: 'Shirt' },
    { id: 'pants', km: 'ខោលើខ្លួន', en: 'Pants' },
    { id: 'hand', km: 'លើដៃ', en: 'In hand' },
    { id: 'hand2', km: 'លើដៃ ២', en: 'In hand 2' }
  ];
  var old = document.getElementById('vhm-ov-panel');
  if (old) old.remove();

  function toast(m, c) {
    var n = document.createElement('div');
    n.textContent = m;
    n.style.cssText = 'position:fixed;top:16px;left:0;right:0;margin:0 auto;width:fit-content;max-width:90vw;background:' + (c || '#1D9E75') + ';color:#fff;padding:10px 18px;border-radius:8px;font-size:15px;z-index:1000000;font-family:sans-serif';
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 3000);
  }

  /* 1. Collect rows — same selectors as Send stock */
  var lines = [];
  document.querySelectorAll('.monitor-item:not(.dummy)').forEach(function (li) {
    if (li.style.display === 'none' || li.getAttribute('hide') === '1') return;
    var code = li.querySelector('.code'), price = li.querySelector('.price'), qty = li.querySelector('.quantity'), remain = li.querySelector('.remain');
    if (!code || !remain) return;
    lines.push([code.innerText, price ? price.innerText : '', qty ? qty.innerText : '', remain.innerText].join(' ').replace(/\s+/g, ' ').trim());
  });
  if (!lines.length) {
    document.querySelectorAll('tr').forEach(function (r) {
      var t = r.innerText.trim();
      if (/\d+\s*\/\s*\d+/.test(t)) lines.push(t.replace(/\s+/g, ' ').trim());
    });
  }
  if (!lines.length) { toast('រកមិនឃើញស្តុក (0 rows) - open the Monitor or Sale list first', '#E24B4A'); return; }

  /* 2. Parse — same record rule as VH MEN Quick Reply's stock parser */
  var raw = lines.join('\n');
  var re = /([\s\S]+?)\s*(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s*\/\s*(\d+)/g, m;
  var codes = {}, order = [];
  while ((m = re.exec(raw)) !== null) {
    var ls = m[1].split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var line = (ls.length ? ls[ls.length - 1] : '').replace(/^\*+\s*/, '').replace(/!/g, '').trim();
    if (!line) continue;
    var parts = line.split(/\s+/), code = parts.shift();
    if (!code) continue;
    var size = parts.length ? parts.pop() : '';
    if (parts.length > 1) parts.shift();
    var color = parts.join(' ');
    if (/^(អាវ|ខោ|ឈុត|អាវក្រៅ|ខោខ្លី|ខោជើងវែង|ស្បែកជើង|មួក)$/.test(color)) color = ''; /* no colour in Vrich: the word left is the garment type */
    if (!codes[code]) { codes[code] = { code: code, price: m[2], colors: [] }; order.push(code); }
    var e = codes[code], col = null;
    for (var i = 0; i < e.colors.length; i++) if (e.colors[i].c === color) col = e.colors[i];
    if (!col) { col = { c: color, sizes: [] }; e.colors.push(col); }
    col.sizes.push({ z: size || '—', remain: parseInt(m[5], 10) });
  }
  if (!order.length) { toast('អានស្តុកមិនបាន - no stock rows recognised', '#E24B4A'); return; }

  function put(slot, payload) {
    return fetch(API + 'live_overlay_' + slot + AK, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { data: { stringValue: payload ? JSON.stringify(payload) : '' }, updatedAt: { timestampValue: new Date().toISOString() } } })
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
  }
  function getSlot(slot) {
    return fetch(API + 'live_overlay_' + slot + AK).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      try { var s = j && j.fields && j.fields.data && j.fields.data.stringValue; return s ? JSON.parse(s) : null; } catch (x) { return null; }
    }).catch(function () { return null; });
  }
  function payloadFor(code) { var e = codes[code]; return { code: e.code, price: e.price, colors: e.colors, at: new Date().toISOString() }; }
  /* Live Log entry check (read only) */
  function dec(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) { var o = {}, f = v.mapValue.fields || {}; for (var k in f) o[k] = dec(f[k]); return o; }
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    return null;
  }
  var ORD = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
  function skey(s) { var i = ORD.indexOf(s); if (i >= 0) return i; var n = parseFloat(s); return isNaN(n) ? 999 : 100 + n; }
  function esc(t) { return String(t).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function checkWeights(e) {
    var key = 'live_log:' + e.code.trim().toUpperCase().replace(/\//g, '-');
    return fetch(API + encodeURIComponent(key) + AK).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var d = j && j.fields && j.fields.data ? dec(j.fields.data) : null;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (x) { d = null; } }
      if (!d) return { bad: true, html: '⚠ <b>' + esc(e.code) + '</b> is not in Live Log yet — no price, fit or weights on stream. Add it in Live Log.' };
      var w = d.weights || {}, issues = [];
      var inStock = {};
      e.colors.forEach(function (c) { c.sizes.forEach(function (z) { if (z.remain > 0) inStock[z.z] = 1; }); });
      var sizes = Object.keys(inStock).sort(function (a, b) { return skey(a) - skey(b); });
      var missing = sizes.filter(function (s) { return !String(w[s] || '').trim(); });
      if (missing.length) issues.push('No weight for <b>' + esc(missing.join(', ')) + '</b>');
      var prev = null;
      Object.keys(w).sort(function (a, b) { return skey(a) - skey(b); }).forEach(function (s) {
        var v = String(w[s] || '').trim(); if (!v) return;
        var m2 = v.match(/(\d+(?:\.\d+)?)\s*(?:kg)?\s*[-–~]\s*(\d+(?:\.\d+)?)/i);
        if (!m2) { issues.push(esc(s) + ': "' + esc(v) + '" is not a range like 60-70'); return; }
        var a = parseFloat(m2[1]), b2 = parseFloat(m2[2]);
        if (a >= b2) issues.push(esc(s) + ': ' + esc(v) + ' is backwards');
        if (prev && v.replace(/\s|kg/gi, '') === prev.v.replace(/\s|kg/gi, '')) issues.push(esc(s) + ' has the same range as ' + esc(prev.s) + ' (' + esc(v) + ')');
        else if (prev && a < prev.a) issues.push(esc(s) + ' (' + esc(v) + ') starts lower than ' + esc(prev.s) + ' (' + esc(prev.v) + ')');
        prev = { s: s, v: v, a: a };
      });
      if (!issues.length) return { bad: false, html: '✓ Weights OK' + (d.fit ? ' · ' + esc(d.fit) : ' · no fit set') };
      return { bad: true, html: '⚠ Check weights in Live Log:<br>' + issues.join('<br>') };
    }).catch(function () { return { bad: true, html: '⚠ Could not read Live Log — check the connection' }; });
  }
  var DEF = { textSize: 20, minText: 12, width: 2, mode: 'cards' };
  function getSettings() { return getSlot('settings').then(function (d) { var o = {}; for (var k in DEF) o[k] = d && d[k] != null ? d[k] : DEF[k]; return o; }); }
  function setSettings(o) { return put('settings', o); }

  /* 3. Panel */
  var picked = order.length === 1 ? order[0] : null;
  var P = document.createElement('div');
  P.id = 'vhm-ov-panel';
  P.style.cssText = 'position:fixed;top:12px;right:12px;width:300px;max-height:86vh;overflow:auto;background:#151816;color:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:999999;font:14px/1.4 system-ui,sans-serif;padding:12px';
  document.body.appendChild(P);

  function btn(label, bg, fn, fg) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.style.cssText = 'display:block;width:100%;margin:4px 0;padding:9px 10px;border:0;border-radius:8px;font:600 14px system-ui,sans-serif;cursor:pointer;text-align:left;background:' + bg + ';color:' + (fg || '#fff');
    b.onclick = fn; return b;
  }
  function busy(b, txt) { b.disabled = true; b.style.opacity = .6; b.textContent = txt; }

  function render() {
    P.innerHTML = '';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px';
    head.innerHTML = '<b>📺 Stream overlay</b>';
    var x = document.createElement('button');
    x.textContent = '✕'; x.title = 'Close';
    x.style.cssText = 'background:none;border:0;color:#aaa;font-size:18px;cursor:pointer';
    x.onclick = function () { P.remove(); };
    head.appendChild(x); P.appendChild(head);

    if (!picked) {
      var note = document.createElement('div');
      note.style.cssText = 'color:#bbb;font-size:12px;margin-bottom:6px';
      note.textContent = order.length + ' codes on this page — pick one (or search it in Vrich first):';
      P.appendChild(note);
      var q = document.createElement('input');
      q.placeholder = 'Type code…';
      q.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:0;margin-bottom:6px;font-size:14px';
      P.appendChild(q);
      var list = document.createElement('div'); P.appendChild(list);
      function fill() {
        list.innerHTML = '';
        var t = q.value.trim().toUpperCase();
        order.filter(function (c) { return !t || c.toUpperCase().indexOf(t) >= 0; }).slice(0, 40).forEach(function (c) {
          list.appendChild(btn(c + '  ·  ' + codes[c].colors.length + ' colours', '#2A302C', function () { picked = c; render(); }));
        });
      }
      q.oninput = fill; fill(); setTimeout(function () { q.focus(); }, 50);
    } else {
      var e = codes[picked];
      var info = document.createElement('div');
      info.style.cssText = 'background:#232824;border-radius:8px;padding:8px;margin-bottom:8px';
      var avail = e.colors.map(function (c) {
        var s = c.sizes.filter(function (z) { return z.remain > 0; }).map(function (z) { return z.z; }).join(' ');
        return (c.c || '—') + ': ' + (s || 'អស់');
      }).join('<br>');
      info.innerHTML = '<div style="font-size:18px;font-weight:700">' + e.code + ' <span style="color:#F1D88E">' + e.price + '</span></div><div style="font-size:12px;color:#ccc">' + avail + '</div>';
      P.appendChild(info);
      var warn = document.createElement('div');
      warn.style.cssText = 'font-size:12px;margin:-2px 0 8px;padding:6px 8px;border-radius:8px;background:#232824;color:#bbb';
      warn.textContent = 'Checking Live Log weights…';
      P.appendChild(warn);
      checkWeights(e).then(function (r) {
        warn.innerHTML = r.html;
        warn.style.background = r.bad ? '#4A3A12' : '#173A2B';
        warn.style.color = r.bad ? '#FFD98A' : '#BFE8D2';
      });
      var lab = document.createElement('div');
      lab.style.cssText = 'font-size:12px;color:#bbb';
      lab.textContent = 'Put on stream as:';
      P.appendChild(lab);
      SLOTS.forEach(function (s) {
        var b = btn('→ ' + s.km + '  (' + s.en + ')', '#1D6E52', function () {
          busy(b, 'Sending…');
          put(s.id, payloadFor(picked)).then(function () { toast('✅ ' + picked + ' → ' + s.km); P.remove(); })
            .catch(function (err) { toast('❌ ' + err.message, '#E24B4A'); render(); });
        });
        P.appendChild(b);
      });
      if (order.length > 1) P.appendChild(btn('← Choose another code', '#2A302C', function () { picked = null; render(); }));
    }

    var sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid #333;margin:10px 0 6px;font-size:12px;color:#bbb;padding-top:8px';
    sep.textContent = 'Slots on stream:';
    P.appendChild(sep);
    var slotBox = document.createElement('div'); P.appendChild(slotBox);
    var refresh = btn('🔄 Refresh stock of everything on stream', '#3A3F6B', function () {
      busy(refresh, 'Refreshing…');
      Promise.all(SLOTS.map(function (s) { return getSlot(s.id).then(function (d) { return { s: s, d: d }; }); })).then(function (rows) {
        var jobs = rows.filter(function (r) { return r.d && r.d.code && !r.d.manual && codes[r.d.code]; }).map(function (r) { var pl = payloadFor(r.d.code); if (r.d.label) pl.label = r.d.label; return put(r.s.id, pl); });
        return Promise.all(jobs).then(function () { var hand = rows.filter(function (r) { return r.d && r.d.manual; }).length; toast((jobs.length ? '✅ Refreshed ' + jobs.length + ' slot(s)' : 'Nothing on stream is on this page') + (hand ? ' · ✋ ' + hand + ' edited by hand kept' : ''), jobs.length ? '#1D9E75' : '#B07A1E'); render(); });
      }).catch(function (err) { toast('❌ ' + err.message, '#E24B4A'); render(); });
    });
    P.appendChild(refresh);
    SLOTS.forEach(function (s) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:6px;padding:3px 0;font-size:13px';
      row.innerHTML = '<span>' + s.km + ': <b class="v">…</b></span>';
      var c = document.createElement('button');
      c.textContent = '✕ Clear';
      c.style.cssText = 'background:#3A2424;color:#fff;border:0;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px';
      c.onclick = function () {
        c.disabled = true; c.textContent = '…';
        put(s.id, null).then(function () { toast('Cleared ' + s.km); render(); }).catch(function (err) { toast('❌ ' + err.message, '#E24B4A'); render(); });
      };
      row.appendChild(c); slotBox.appendChild(row);
      getSlot(s.id).then(function (d) { row.querySelector('.v').textContent = d && d.code ? d.code + (d.manual ? ' ✋' : '') : '—'; });
    });

    var sep2 = document.createElement('div');
    sep2.style.cssText = 'border-top:1px solid #333;margin:10px 0 6px;font-size:12px;color:#bbb;padding-top:8px';
    sep2.textContent = 'Overlay look (applies within ~1s):';
    P.appendChild(sep2);
    var box = document.createElement('div');
    box.style.cssText = 'display:grid;grid-template-columns:1fr auto auto auto;gap:4px 6px;align-items:center;font-size:13px';
    P.appendChild(box);
    function small(label, fn) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'background:#2A302C;color:#fff;border:0;border-radius:6px;padding:5px 9px;cursor:pointer;font:600 13px system-ui,sans-serif';
      b.onclick = fn; return b;
    }
    getSettings().then(function (st) {
      function change(patch) {
        for (var k in patch) st[k] = patch[k];
        setSettings(st).then(function () { render(); }).catch(function (err) { toast('❌ ' + err.message, '#E24B4A'); });
      }
      function rowOf(name, value, minus, plus) {
        var l = document.createElement('span'); l.textContent = name;
        var v = document.createElement('b'); v.textContent = value; v.style.cssText = 'text-align:center;min-width:44px';
        box.appendChild(l); box.appendChild(minus); box.appendChild(v); box.appendChild(plus);
      }
      rowOf('Text size', st.textSize,
        small('−', function () { change({ textSize: Math.max(12, st.textSize - 1) }); }),
        small('+', function () { change({ textSize: Math.min(30, st.textSize + 1) }); }));
      rowOf('Smallest allowed', st.minText,
        small('−', function () { change({ minText: Math.max(8, st.minText - 1) }); }),
        small('+', function () { change({ minText: Math.min(st.textSize, st.minText + 1) }); }));
      rowOf('Width', st.width + '/6',
        small('−', function () { change({ width: Math.max(1, st.width - 1) }); }),
        small('+', function () { change({ width: Math.min(3, st.width + 1) }); }));
      var mode = small(st.mode === 'text' ? '🅰 Text mode (safe) — tap for Cards' : '🃏 Cards — tap for safe Text mode', function () { change({ mode: st.mode === 'text' ? 'cards' : 'text' }); });
      mode.style.cssText += ';grid-column:1 / -1;margin-top:4px;background:' + (st.mode === 'text' ? '#6B4A1E' : '#2A302C');
      box.appendChild(mode);
    });
  }
  render();
})();
