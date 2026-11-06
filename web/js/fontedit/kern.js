// Kerning pairs (editor-side: stored per size in the autosave and in the family zip as kerning.json; the ACF/XCF formats have no kerning).
(() => {
  'use strict';
  const FE = window.FE, $ = FE.$, st = FE.state;
  const tab = (f = st.f) => st.kern[f.adv] || (st.kern[f.adv] = {});
  // Classes live in the same table under '@classes': { L: {name: [codes]}, R: {name: [codes]}, P: {'left|right': value} }. A single pair wins over a class pair.
  const classes = (f = st.f) => { const t = tab(f); return t['@classes'] || (t['@classes'] = { L: {}, R: {}, P: {} }); };
  FE.kernOf = (f, a, b) => {
    const t = st.kern[f.adv]; if (!t) return 0;
    const v = t[a + ',' + b]; if (v) return v;
    const c = t['@classes']; if (!c) return 0;
    for (const k of Object.keys(c.P)) { const [l, r] = k.split('|'); if (c.L[l] && c.R[r] && c.L[l].includes(a) && c.R[r].includes(b)) return c.P[k]; }
    return 0;
  };
  const ch = (c) => (c >= 33 && c < 127 ? String.fromCharCode(c) : '#' + c);
  const code = (s) => (/^#\d+$/.test(s) ? +s.slice(1) : FE.codeOfChar([...s][0] || '?'));
  function draw() {
    if (!FE.isTab('kern') || !st.f) return;
    const t = tab(), keys = Object.keys(t).filter((k) => k[0] !== '@').sort(), box = $('kerntbl');
    box.innerHTML = keys.length ? '' : '<div class="empty">No kerning pairs for ' + st.f.adv + ' px yet. Add one above (negative = closer).</div>';
    for (const k of keys) {
      const [a, b] = k.split(',').map(Number), r = document.createElement('div'); r.className = 'krow';
      r.innerHTML = '<b>' + FE.esc(ch(a) + ch(b)) + '</b><input type="number" min="-8" max="8" value="' + t[k] + '"><button title="Remove">x</button>';
      r.querySelector('input').onchange = (e) => { t[k] = +e.target.value || 0; if (!t[k]) delete t[k]; st.dirty = true; FE.render(); };
      r.querySelector('button').onclick = () => { delete t[k]; st.dirty = true; FE.render(); };
      r.querySelector('b').onclick = () => { $('kl').value = ch(a); $('kr').value = ch(b); $('kv').value = t[k]; };
      box.appendChild(r);
    }
    drawClasses();
    const f = st.f, z = +$('kz').value, lines = $('ktext').value.split('\n'), cv = $('kernpv'), c = cv.getContext('2d'), C = FE.themeColors();
    const w = (l, k) => FE.parseText(l).reduce((n, [x], i, a) => n + f.adv + (k && i ? FE.kernOf(f, a[i - 1][0], x) : 0), 0) + 8;
    cv.width = Math.max(...lines.map((l) => w(l, true)), w('x', false)) * z; cv.height = (lines.length * 2 * (f.rows + 1) + 4) * z;
    c.fillStyle = C.paper; c.fillRect(0, 0, cv.width, cv.height);
    lines.forEach((l, i) => {
      FE.drawLine(c, f, l, 4, 2 + i * 2 * (f.rows + 1), z, '#16181c', { kern: false });
      FE.drawLine(c, f, l, 4, 2 + (i * 2 + 1) * (f.rows + 1), z, '#a02020', { kern: true });
    });
  }
  function drawClasses() {
    const c = tab()['@classes'] || { L: {}, R: {}, P: {} }, nm = (o) => Object.keys(o);
    const show = (side) => nm(c[side]).map((n) => '<b>' + FE.esc(n) + '</b> ' + FE.esc(c[side][n].map((x) => ch(x)).join(' '))).join('<br>');
    $('kclist').innerHTML = (nm(c.L).length || nm(c.R).length) ? 'Left: <br>' + (show('L') || '-') + '<br>Right: <br>' + (show('R') || '-') : 'No classes yet. Example: left class "A" = AÀÁÂ, right class "V" = VWY, then pair A|V = -1.';
    for (const [id, side] of [['kcl', 'L'], ['kcr', 'R']]) { const s = $(id), cur = s.value; s.innerHTML = nm(c[side]).map((n) => '<option>' + FE.esc(n) + '</option>').join('') || '<option value="">(no ' + (side === 'L' ? 'left' : 'right') + ' class)</option>'; s.value = cur; }
    $('kcplist').innerHTML = nm(c.P).map((k) => '<span class="kcp">' + FE.esc(k.replace('|', ' + ')) + ' = ' + c.P[k] + ' <button data-k="' + FE.esc(k) + '" title="Remove">x</button></span> ').join('');
    for (const b of $('kcplist').querySelectorAll('button')) b.onclick = () => { delete classes().P[b.dataset.k]; st.dirty = true; FE.render(); };
  }
  FE.renders.push(draw);
  document.addEventListener('DOMContentLoaded', () => {
    $('kadd').onclick = () => {
      const a = code($('kl').value), b = code($('kr').value), v = Math.max(-8, Math.min(8, +$('kv').value || 0)), t = tab();
      if (v) t[a + ',' + b] = v; else delete t[a + ',' + b];
      st.dirty = true; FE.render();
    };
    $('kpre').onclick = () => { const t = tab(), d = Math.max(1, Math.round(st.f.adv / 6)); for (const p of ['AV', 'AT', 'AY', 'LT', 'LY', 'TA', 'VA', 'To', 'Ty', 'Yo', 'Wa']) { const k = p.charCodeAt(0) + ',' + p.charCodeAt(1); if (!t[k]) t[k] = -d; } st.dirty = true; FE.render(); };
    $('kcadd').onclick = () => {
      const n = $('kcname').value.trim(), codes = [...$('kcmem').value].filter((x) => x.trim()).map((x) => FE.codeOfChar(x)), c = classes();
      if (!n) return FE.toast('Give the class a name');
      if (codes.length) c[$('kcside').value][n] = codes; else { delete c.L[n]; delete c.R[n]; for (const k of Object.keys(c.P)) if (k.split('|').includes(n)) delete c.P[k]; }
      st.dirty = true; FE.render();
    };
    $('kcpadd').onclick = () => {
      const l = $('kcl').value, r = $('kcr').value, v = Math.max(-8, Math.min(8, +$('kcv').value || 0)), c = classes();
      if (!l || !r) return FE.toast('Define a left and a right class first');
      if (v) c.P[l + '|' + r] = v; else delete c.P[l + '|' + r];
      st.dirty = true; FE.render();
    };
    $('kclear').onclick = () => { st.kern[st.f.adv] = {}; st.dirty = true; FE.render(); };
    for (const id of ['ktext', 'kz']) $(id).addEventListener('input', draw);
    $('ktext').value = 'AVATAR To Ty LT Wa Yo\nTypography WAVE';
  });
})();
