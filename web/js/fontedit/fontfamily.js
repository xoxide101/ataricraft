// Craft family registry: ONE family = one name + styles + sizes (+ where each size came from) + support flags per target app/machine.
// Plain JSON ('craft-family-manifest'), no dependencies; UMD so the editor (<script>), Node (tools/fontfamily.cjs: fontpipe, the
// ACWriter face build, xCWriter tooling) and tests all use the same code. Scheme documented in docs/FONT.md ("Family registry").
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else (root.XCW = root.XCW || {}).Family = (root.FE_FAMILY = api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FORMAT = 'craft-family-manifest', VERSION = 1;
  const SIZES = [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26];
  const ORIGINS = ['master', 'outline', 'derived', 'hand', 'imported'];
  // Target = an app or machine. sizes: 'all' or a list; styles: optional list. A new machine only adds an entry here (or in the manifest's own
  // "targets" object): nothing else in the code needs to know its key.
  const TARGETS = {
    'acwriter-atari': { label: 'ACWriter (Atari 8-bit)', short: 'ACW', sizes: [4, 5, 6, 8] },
    xcwriter: { label: 'xCWriter', short: 'xCW', sizes: 'all' },
    print: { label: 'Print / PDF', short: 'Print', sizes: 'all' },
    zoom: { label: 'Zoom face (ACWriter PAGE 2x)', short: 'Zoom', sizes: [8], styles: ['zoom'] },
  };
  const slug = (s) => String(s || 'font').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
  const targets = (m) => Object.assign({}, TARGETS, (m && m.targets) || {});
  const newManifest = () => ({ format: FORMAT, version: VERSION, targets: {}, families: [] });
  const find = (m, id) => m.families.find((f) => f.id === id);
  const styleOf = (fam, style) => fam.styles.find((s) => s.style === (style || 'regular')) || fam.styles[0];
  const uniqueId = (m, base) => { let id = slug(base), n = 2; while (find(m, id)) id = slug(base) + '-' + n++; return id; };

  function addFamily(m, o) {
    const id = o.id || uniqueId(m, o.name);
    if (find(m, id)) throw new Error('family id exists: ' + id);
    const fam = { id, name: o.name || id, kind: o.kind || 'mine', source: o.source || { type: 'pixel-master', size: 12 }, tags: o.tags || [], styles: [] };
    m.families.push(fam);
    return fam;
  }
  function addStyle(fam, style, o) {
    let s = fam.styles.find((x) => x.style === style);
    if (!s) { s = { style, sizes: {}, graphics: !!(o && o.graphics), coverage: (o && o.coverage) || [] }; fam.styles.push(s); }
    return s;
  }
  function setSize(fam, style, size, o) {
    const s = addStyle(fam, style || 'regular'), cur = s.sizes[size] || {};
    s.sizes[size] = Object.assign({ origin: 'derived' }, cur, o || {});
    return s.sizes[size];
  }
  // explicit flag on the size wins; otherwise the target's default rule (a size list or 'all', optionally limited to some styles)
  function supports(m, fam, style, size, target) {
    const s = styleOf(fam, style), e = s && s.sizes[size]; if (!e) return false;
    if (e.flags && typeof e.flags[target] === 'boolean') return e.flags[target];
    const t = targets(m)[target]; if (!t) return true;
    if (t.styles && !t.styles.includes(s.style)) return false;
    return t.sizes === 'all' || (Array.isArray(t.sizes) && t.sizes.includes(+size));
  }
  function sizesFor(m, famId, target, style) {
    const fam = typeof famId === 'string' ? find(m, famId) : famId; if (!fam) return [];
    const out = [];
    for (const s of fam.styles) { if (style && s.style !== style) continue; for (const k of Object.keys(s.sizes)) if (supports(m, fam, s.style, +k, target)) out.push(+k); }
    return [...new Set(out)].sort((a, b) => a - b);
  }
  // true / false = explicit, null = back to the target default
  function setFlag(m, fam, style, size, target, val) {
    const e = styleOf(fam, style).sizes[size]; if (!e) throw new Error('no such size ' + size);
    e.flags = e.flags || {};
    if (val === null || val === undefined) delete e.flags[target]; else e.flags[target] = !!val;
    if (!Object.keys(e.flags).length) delete e.flags;
  }
  // "group as family": fold several families (e.g. craft4.acf, craft5.acf ... imported separately) into the first one; same style+size keeps the first
  function merge(m, ids, name) {
    const fams = ids.map((i) => find(m, i)).filter(Boolean); if (fams.length < 2) throw new Error('need two families to merge');
    const into = fams[0]; if (name) { into.name = name; }
    for (const f of fams.slice(1)) {
      for (const s of f.styles) { const d = addStyle(into, s.style, s); for (const [k, v] of Object.entries(s.sizes)) if (!d.sizes[k]) d.sizes[k] = JSON.parse(JSON.stringify(v)); d.graphics = d.graphics || s.graphics; }
      into.tags = [...new Set(into.tags.concat(f.tags || []))]; into.aliases = [...new Set((into.aliases || []).concat([f.id, f.name]))];
      m.families.splice(m.families.indexOf(f), 1);
    }
    return into;
  }
  // split: one style (or one size list) leaves and becomes its own family
  function split(m, famId, style, sizes, name) {
    const fam = find(m, famId), s = styleOf(fam, style); if (!fam || !s) throw new Error('nothing to split');
    const keys = (sizes && sizes.length ? sizes : Object.keys(s.sizes)).map(String).filter((k) => s.sizes[k]);
    if (!keys.length) throw new Error('no such sizes');
    const nf = addFamily(m, { name: name || fam.name + ' ' + s.style, kind: fam.kind, source: fam.source, tags: fam.tags.slice() });
    const ns = addStyle(nf, s.style, s);
    for (const k of keys) { ns.sizes[k] = s.sizes[k]; delete s.sizes[k]; }
    if (!Object.keys(s.sizes).length && fam.styles.length > 1) fam.styles.splice(fam.styles.indexOf(s), 1);
    return nf;
  }
  // from filenames: craft4.acf craft5.acf ... / Foo-12.fnt / Foo_12px.xcf  ->  { family guess, size }; used by "group as family" and drag-drop of many files
  function guessFromFile(name) {
    const base = String(name).replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '');
    const mm = /^(.*?)[-_ .]*(\d{1,2})(?:\s*px|x\d+)?$/i.exec(base);
    let style = 'regular', fam = mm ? mm[1] : base;
    const st = /[-_ ](bold|italic|oblique|light|black|zoom|mono)$/i.exec(fam); if (st) { style = st[1].toLowerCase(); fam = fam.slice(0, st.index); }
    return { family: fam || base, id: slug(fam || base), style, size: mm ? +mm[2] : null };
  }
  function groupFiles(m, files) {
    const out = new Map();
    for (const f of files) {
      const g = guessFromFile(typeof f === 'string' ? f : f.name); if (!g.size) continue;
      const fam = find(m, g.id) || addFamily(m, { id: g.id, name: g.family.replace(/^./, (c) => c.toUpperCase()), kind: 'mine' });
      setSize(fam, g.style, g.size, { origin: 'imported', source: typeof f === 'string' ? f : f.name }); out.set(fam.id, fam);
    }
    return [...out.values()];
  }
  // the editor family object ({ name, master, sizes:{px:font} }) <-> a registry entry
  const ORIGIN_OF = { 0: 'master', 1: 'derived', 2: 'hand' };
  function fromEditor(m, fam, o) {
    o = o || {};
    const id = fam.id || (o.id) || slug(fam.name), reg = find(m, id) || addFamily(m, { id, name: fam.name, kind: o.kind || 'mine', source: o.source }), style = fam.style || 'regular';
    reg.name = fam.name || reg.name; if (o.source) reg.source = o.source; else if (fam.master) reg.source = reg.source || { type: 'pixel-master', size: fam.master };
    if (reg.source && reg.source.type === 'pixel-master') reg.source.size = fam.master || reg.source.size;
    const s = addStyle(reg, style);
    for (const k of Object.keys(s.sizes)) if (!fam.sizes[k]) delete s.sizes[k];
    for (const [k, f] of Object.entries(fam.sizes)) {
      const flags = fam.flags && fam.flags[k], prev = s.sizes[k] || {};
      const origin = +k === fam.master ? (reg.source && reg.source.type === 'outline' ? 'outline' : 'master') : (ORIGIN_OF[f.origin] || 'derived');
      s.sizes[k] = Object.assign({}, prev, { origin }, (o.sources && o.sources[k]) ? { source: o.sources[k] } : {}, flags ? { flags: Object.assign({}, flags) } : {});
    }
    return reg;
  }
  const flagsOf = (reg, style) => { const out = {}; for (const [k, e] of Object.entries(styleOf(reg, style).sizes)) if (e.flags) out[k] = Object.assign({}, e.flags); return out; };
  // the three older groups are only views over the registry
  function views(m) {
    const pick = (fn) => m.families.filter(fn).map((f) => f.id);
    return {
      'Craft faces': pick((f) => f.kind === 'craft'),
      'ACWriter / Craft fonts': pick((f) => f.kind === 'craft' || sizesFor(m, f, 'acwriter-atari').length > 0),
      'My fonts': pick((f) => f.kind === 'mine'),
    };
  }
  function validate(m) {
    const p = [], seen = new Set();
    if (!m || m.format !== FORMAT) return ['not a ' + FORMAT];
    for (const f of m.families || []) {
      if (seen.has(f.id)) p.push('duplicate family id ' + f.id); seen.add(f.id);
      if (!f.name) p.push(f.id + ': no name');
      if (!f.styles || !f.styles.length) p.push(f.id + ': no styles');
      for (const s of f.styles || []) for (const [k, e] of Object.entries(s.sizes)) {
        if (!(+k >= 4 && +k <= 26)) p.push(f.id + '/' + s.style + ': size ' + k + ' outside 4-26');
        if (!ORIGINS.includes(e.origin)) p.push(f.id + '/' + s.style + '/' + k + ': origin ' + e.origin);
        for (const t of Object.keys(e.flags || {})) if (!targets(m)[t]) p.push(f.id + '/' + s.style + '/' + k + ': unknown target ' + t + ' (kept, ignored)');
      }
    }
    return p;
  }
  const serialize = (m) => JSON.stringify(m, null, 1) + '\n';
  function parse(text) {
    const m = typeof text === 'string' ? JSON.parse(text) : text;
    if (!m || m.format !== FORMAT) throw new Error('not a ' + FORMAT);
    m.targets = m.targets || {}; m.families = m.families || [];
    return m;
  }
  // the shipped Craft Sans family with sensible default flags
  function craft() {
    const m = newManifest(), fam = addFamily(m, { id: 'craft-sans', name: 'Craft Sans', kind: 'craft', source: { type: 'pixel-master', size: 12, file: 'font/craft12.acf' }, tags: ['shipped', 'craft'] });
    const files = { 4: 'font/overrides/craft4.acf', 5: 'font/overrides/craft5.acf', 6: 'font/overrides/craft6.acf', 8: 'font/craft8.fnt', 10: 'font/craft10.acf', 12: 'font/craft12.acf' };
    for (const k of SIZES) setSize(fam, 'regular', k, { origin: k === 12 ? 'master' : (files[k] ? 'hand' : 'derived'), source: files[k] || 'font/craft' + k + '.acf' });
    addStyle(fam, 'regular').graphics = true; fam.styles[0].coverage = ['ascii', 'atari-graphics'];
    const z = addFamily(m, { id: 'craft-zoom', name: 'Craft Zoom', kind: 'craft', source: { type: 'pixel-master', size: 8 }, tags: ['shipped', 'zoom'] });
    setSize(z, 'zoom', 8, { origin: 'hand', source: 'tools/craft8art.cjs' }); z.styles[0].graphics = true;
    return m;
  }
  return { FORMAT, VERSION, SIZES, ORIGINS, TARGETS, slug, targets, newManifest, find, styleOf, addFamily, addStyle, setSize, supports, sizesFor, setFlag, merge, split, guessFromFile, groupFiles, fromEditor, flagsOf, views, validate, serialize, parse, craft };
});
