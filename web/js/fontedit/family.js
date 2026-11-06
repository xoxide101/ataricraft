// Family registry in the editor: Family > Style > Size tree with per-size origin and per-target support flags ("exclude from app X"),
// group-as-family / split, add-a-machine, and the 'craft-family-manifest' JSON (shipped manifest + the user's overlay in localStorage).
// The old groups (Craft faces / My fonts / ACWriter / Craft fonts) are views over it: FF.views(FE.manifest).
(() => {
  'use strict';
  const FE = window.FE, FF = window.FE_FAMILY, CF = FE.CF, st = FE.state, $ = FE.$, esc = FE.esc;
  const KEY = 'craft.manifest';
  function load() {
    const base = window.CRAFT_MANIFEST ? FF.parse(JSON.parse(JSON.stringify(window.CRAFT_MANIFEST))) : FF.craft();
    try {
      const u = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (u && u.format === FF.FORMAT) {
        for (const f of u.families || []) { const i = base.families.findIndex((x) => x.id === f.id); if (i >= 0) base.families[i] = f; else base.families.push(f); }
        for (const id of u.removed || []) { const i = base.families.findIndex((x) => x.id === id); if (i >= 0) base.families.splice(i, 1); }
        Object.assign(base.targets, u.targets || {}); base.removed = u.removed || [];
      }
    } catch (e) { /* damaged overlay: shipped manifest only */ }
    return base;
  }
  FE.manifest = load(); FE.FF = FF;
  // only what the user changed is stored: families with flags, tags, aliases, or made by merge/split
  FE.saveManifest = () => {
    const m = FE.manifest, keep = m.families.filter((f) => (f.aliases && f.aliases.length) || (f.tags || []).includes('user') || f.styles.some((s) => Object.values(s.sizes).some((e) => e.flags)));
    try { localStorage.setItem(KEY, JSON.stringify({ format: FF.FORMAT, version: FF.VERSION, targets: m.targets, removed: m.removed || [], families: keep })); } catch (e) { /* quota */ }
  };
  FE.regId = (fam) => fam.id || (st.entry === 'craft' ? 'craft-sans' : st.entry === 'zfont' ? 'craft-zoom' : FF.slug(fam.name));
  // mirror the editor family into the registry (origins, sizes); flags already in the registry are kept
  FE.regSync = (fam) => {
    fam = fam || st.fam; if (!fam) return null;
    fam.id = FE.regId(fam);
    const e = FE.entries.get(st.entry);
    return FF.fromEditor(FE.manifest, fam, { kind: e && e.kind === 'craft' ? 'craft' : 'mine', source: st.src ? { type: 'outline', file: st.src.name } : undefined });
  };
  FE.targetOn = (size, target, fam) => { fam = fam || st.fam; const reg = FE.regSync(fam); return FF.supports(FE.manifest, reg, fam.style || 'regular', size, target); };
  FE.sizesFor = (target, fam) => { fam = fam || st.fam; const reg = FE.regSync(fam); return FF.sizesFor(FE.manifest, reg, target, fam.style || 'regular'); };

  let sig = '';
  function draw() {
    const box = $('tree'); if (!box || !st.fam) return;
    const reg = FE.regSync(), style = FF.styleOf(reg, st.fam.style), T = FF.targets(FE.manifest), keys = Object.keys(T);
    const s = JSON.stringify([reg, keys, st.f && st.f.adv]); if (s === sig) return; sig = s;
    const rows = Object.keys(style.sizes).map(Number).sort((a, b) => a - b).map((k) => {
      const e = style.sizes[k];
      return '<tr class="' + (st.f && st.f.adv === k ? 'on' : '') + '"><td><a href="#" data-pick="' + k + '" title="Edit this size">' + (k === 8 ? '8 Atari' : k + ' px') + '</a></td><td class="dim" title="' + esc(e.source || '') + '">' + e.origin + '</td>' +
        keys.map((t) => { const on = FF.supports(FE.manifest, reg, style.style, k, t), ex = e.flags && typeof e.flags[t] === 'boolean';
          return '<td><input type="checkbox" data-t="' + esc(t) + '" data-s="' + k + '"' + (on ? ' checked' : '') + ' class="' + (ex ? 'explicit' : '') + '" title="' + esc(T[t].label + ': size ' + k + (ex ? ' (set by you; right-click resets to the default)' : ' (default rule)')) + '"></td>'; }).join('') + '</tr>';
    }).join('');
    box.innerHTML = '<div class="treehead"><b>' + esc(reg.name) + '</b> <span class="dim">id <code>' + esc(reg.id) + '</code> - ' + esc(reg.source.type === 'outline' ? 'outline ' + (reg.source.file || '') : reg.source.type === 'charset' ? 'charset' : 'pixel master ' + (reg.source.size || '')) + '</span></div>' +
      '<div class="dim">Style: <b>' + esc(style.style) + '</b>' + (reg.styles.length > 1 ? ' (+' + (reg.styles.length - 1) + ' more)' : '') + (style.graphics ? ' - Atari graphics set' : '') + (style.coverage.length ? ' - ' + esc(style.coverage.join(', ')) : '') + '</div>' +
      '<table class="tree"><thead><tr><th>Size</th><th>Origin</th>' + keys.map((t) => '<th title="' + esc(T[t].label) + '">' + esc(T[t].short || t.replace(/-.*/, '').slice(0, 5)) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="dim">Tick = the size is used by that app or machine (builds and "Export for" honour it). Untick to exclude.</div>';
    box.querySelectorAll('[data-pick]').forEach((a) => { a.onclick = (ev) => { ev.preventDefault(); FE.selectSize(+a.dataset.pick); }; });
    box.querySelectorAll('input[data-t]').forEach((c) => {
      c.onchange = () => { FF.setFlag(FE.manifest, reg, style.style, +c.dataset.s, c.dataset.t, c.checked); FE.saveManifest(); sig = ''; draw(); };
      c.oncontextmenu = (ev) => { ev.preventDefault(); FF.setFlag(FE.manifest, reg, style.style, +c.dataset.s, c.dataset.t, null); FE.saveManifest(); sig = ''; draw(); };
    });
    const sel = $('mergewith'); sel.innerHTML = '<option value="">(choose a family)</option>' + [...FE.entries.values()].filter((e) => e.fam && e.fam !== st.fam).map((e) => '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>').join('');
  }

  // ---- group as family / split -------------------------------------------------------------------------------------------------------
  FE.mergeInto = (otherId) => {
    const e = FE.entries.get(otherId); if (!e || !e.fam || e.fam === st.fam) throw new Error('pick another loaded family');
    const mine = FE.regSync(), theirs = FE.regSyncOf(e);
    let moved = 0;
    for (const [k, f] of Object.entries(e.fam.sizes)) if (!st.fam.sizes[k]) { f.origin = f.origin === 0 ? CF.ORIGIN.hand : f.origin; f.masterAdv = st.fam.master; st.fam.sizes[k] = f; moved++; }
    FF.merge(FE.manifest, [mine.id, theirs.id]); (FE.manifest.families.find((f) => f.id === mine.id).tags || []).push('user');
    if (e.kind === 'my') { const m = FE.myFonts(); delete m[e.name]; localStorage.setItem('craft.myfonts', JSON.stringify(m)); }
    if (e.kind !== 'craft') FE.entries.delete(otherId);
    FE.saveManifest(); sig = ''; FE.libChanged(); FE.keepFamily(true); FE.render();
    FE.toast(moved + ' size(s) of "' + e.name + '" now belong to "' + st.fam.name + '"'); return moved;
  };
  FE.regSyncOf = (e) => { const keep = st.entry; st.entry = e.id; try { return FE.regSync(e.fam); } finally { st.entry = keep; } };
  FE.splitSize = (size) => {
    const fam = st.fam, f = fam.sizes[size]; if (!f) throw new Error('no such size');
    if (Object.keys(fam.sizes).length < 2) throw new Error('a family needs at least one size left');
    if (size === fam.master) throw new Error('the master cannot be split off; choose another master first');
    const reg = FE.regSync(), nf = CF.familyNew(f, fam.name + ' ' + size + 'px'); nf.name = fam.name + ' ' + size + ' px'; f.origin = CF.ORIGIN.hand; f.masterAdv = 0;
    delete fam.sizes[size];
    const n = FF.split(FE.manifest, reg.id, fam.style || 'regular', [size], nf.name); nf.id = n.id; n.tags.push('user');
    FE.keepFamily(false, nf, nf.name); FE.saveManifest(); sig = ''; FE.keepFamily(true);
    FE.setFont(fam.sizes[fam.master], fam, true); FE.libChanged(); FE.toast(size + ' px split off as its own family "' + nf.name + '"');
    return nf;
  };

  FE.manifestJson = (famOnly) => {
    const reg = FE.regSync(), m = FF.newManifest(); m.targets = FE.manifest.targets;
    m.families = famOnly === false ? FE.manifest.families : [reg]; return FF.serialize(m);
  };

  FE.fontListeners.push(() => { sig = ''; });
  FE.renders.push(draw);
  document.addEventListener('DOMContentLoaded', () => {
    $('bmerge').onclick = () => { const v = $('mergewith').value; if (!v) return FE.toast('Choose the family to fold into this one'); try { FE.mergeInto(v); } catch (e) { FE.toast(e.message); } };
    $('bsplit').onclick = () => { try { FE.splitSize(st.f.adv); } catch (e) { FE.toast(e.message); } };
    $('badddt').onclick = () => {
      const k = FF.slug($('tkey').value), sz = $('tsizes').value.trim();
      if (!k || FF.TARGETS[k]) return FE.toast('Give a new short key, e.g. c64 or zx-spectrum');
      FE.manifest.targets[k] = { label: $('tkey').value.trim(), sizes: /^all$/i.test(sz) || !sz ? 'all' : sz.split(/[ ,]+/).map(Number).filter((n) => n >= 4 && n <= 26) };
      FE.saveManifest(); sig = ''; draw(); FE.toast('Target "' + k + '" added: it now has a column in the tree and in "Export for"'); FE.fillTargets();
    };
    FE.fillTargets();
    const h = $('hint'); try { h.hidden = localStorage.getItem('craft.hint') === '1'; } catch (e) { h.hidden = false; }
    $('hintx').onclick = () => { h.hidden = true; try { localStorage.setItem('craft.hint', '1'); } catch (e) { /* private mode */ } };
  });
  FE.fillTargets = () => {
    const sel = $('bztarget'); if (!sel) return;
    sel.innerHTML = '<option value="">all sizes</option>' + Object.entries(FF.targets(FE.manifest)).map(([k, t]) => '<option value="' + esc(k) + '">only sizes for ' + esc(t.label) + '</option>').join('');
  };
})();
