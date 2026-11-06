// Quality tab: validator with a chosen coverage set, optionally over all sizes; every issue jumps to its glyph.
(() => {
  'use strict';
  const FE = window.FE, CF = FE.CF, $ = FE.$, st = FE.state;
  const DESC = new Set('gjpqyQ,;'.split('').map((c) => c.charCodeAt(0)));
  const nm = (c) => { const i = FE.charInfo(c); return (i.ch && c > 32 ? i.ch + ' ' : '') + i.name; };
  function checkFont(f, cov) {
    const out = [], add = (sev, code, msg) => out.push({ sev, size: f.adv, code, msg });
    const widths = [];
    for (const code of cov) {
      const slot = f.map[code], g = f.glyphs[slot], gfx = CF.isGfxSlot(code), nc = CF.colsOf(f, slot);
      if (!g) { if (code !== 32) add('error', code, 'missing glyph'); continue; }
      let lo = 99, hi = -1, top = 99, bot = -1;
      for (let r = 0; r < f.rows; r++) for (let q = 0; q < nc; q++) if (CF.hasPx(f, g[r] || 0, q)) { lo = Math.min(lo, q); hi = Math.max(hi, q); top = Math.min(top, r); bot = Math.max(bot, r); }
      if (hi < 0) { if (code !== 32 && code !== 160) add('error', code, 'empty glyph (no pixels)'); continue; }
      if (gfx) continue;
      widths.push(hi - lo + 1);
      if (hi - lo + 1 > f.gw) add('warn', code, 'ink ' + (hi - lo + 1) + ' px wider than the glyph width ' + f.gw);
      if (f.advs[slot] && f.advs[slot] !== f.adv) add('info', code, 'advance ' + f.advs[slot] + ' differs from the pitch ' + f.adv + ' (inconsistent widths in a fixed-pitch face)');
      if (nc > 1 && lo === 0 && hi >= f.adv - 1) add('warn', code, 'stems touch both cell edges: neighbours will merge');
      else if (hi >= f.adv - 1 && f.adv > 4) add('warn', code, 'ink clipped at the right cell edge (column ' + hi + ')');
      if (top === 0) add('warn', code, 'ink touches the top row of the cell (clipped?)');
      if (bot === f.rows - 1) add('warn', code, 'descender clipped at the bottom row of the cell');
      if (DESC.has(code) && bot <= f.base) add('warn', code, 'descender missing: no ink below the baseline (row ' + f.base + ')');
      if (!DESC.has(code) && /[A-Za-z0-9]/.test(String.fromCharCode(code)) && bot > f.base && !/[Qgjpqy]/.test(String.fromCharCode(code))) add('info', code, 'ink below the baseline (' + (bot - f.base) + ' rows)');
    }
    const med = widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)];
    if (med) for (const code of cov) {
      const g = f.glyphs[f.map[code]]; if (!g || CF.isGfxSlot(code)) continue; let lo = 99, hi = -1;
      for (const r of g) for (let q = 0; q < f.gw; q++) if (CF.hasPx(f, r, q)) { lo = Math.min(lo, q); hi = Math.max(hi, q); }
      if (hi >= 0 && /[A-Z0-9]/.test(String.fromCharCode(code)) && Math.abs(hi - lo + 1 - med) > Math.max(2, med * 0.5)) out.push({ sev: 'info', size: f.adv, code, msg: 'ink width ' + (hi - lo + 1) + ' px is far from the typical ' + med });
    }
    return out;
  }
  FE.validate = (key, all) => {
    const cov = FE.COVERAGE[key][1](), fonts = all ? Object.values(st.fam.sizes) : [st.f];
    return fonts.flatMap((f) => checkFont(f, cov));
  };
  function run() {
    const res = FE.validate($('qcov').value, $('qall').checked), box = $('qres');
    const n = (s) => res.filter((r) => r.sev === s).length;
    $('qsum').innerHTML = res.length ? '<b class="bad">' + n('error') + ' errors</b>, ' + n('warn') + ' warnings, ' + n('info') + ' notes' : '<b class="ok">No problems found</b> for ' + FE.COVERAGE[$('qcov').value][0] + '.';
    box.innerHTML = '';
    for (const r of res.sort((a, b) => ['error', 'warn', 'info'].indexOf(a.sev) - ['error', 'warn', 'info'].indexOf(b.sev) || a.size - b.size || a.code - b.code)) {
      const d = document.createElement('div'); d.className = 'issue ' + r.sev; d.dataset.code = r.code; d.dataset.size = r.size;
      d.innerHTML = '<span class="sev">' + r.sev + '</span><span class="isz">' + r.size + ' px</span><b>' + FE.esc(nm(r.code)) + ' (' + r.code + ')</b> ' + FE.esc(r.msg);
      d.onclick = () => FE.gotoCode(r.code, r.size);
      box.appendChild(d);
    }
    st.report = res; return res;
  }
  FE.runQuality = run;
  document.addEventListener('DOMContentLoaded', () => {
    $('qcov').innerHTML = Object.entries(FE.COVERAGE).map(([k, v]) => '<option value="' + k + '">' + FE.esc(v[0]) + '</option>').join('');
    $('qrun').onclick = run; $('qcov').onchange = run; $('qall').onchange = run;
    $('qcsv').onclick = () => FE.download('quality-report.txt', (st.report || run()).map((r) => r.sev + '\t' + r.size + ' px\t' + r.code + '\t' + r.msg).join('\n'), 'text/plain');
  });
  FE.onTab('quality', run);
})();
