// Machine profile validator (docs/MACHINE-PROFILE.md). No dependencies; Node and browser (AC.CraftCore.profile).
// validate(p) -> {ok, errors:[string], warnings:[string]}.
// Discipline: a fact we do not know is null AND listed in "unknown" by its dotted path; the validator checks both directions.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.CraftCore = root.AC.CraftCore || {}; root.AC.CraftCore.profile = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FAMILIES = ['z80', '6502', '6809', 'tms9900', 'scmp', '6800', 'sm83', 'other'];
  const STATUS = ['complete', 'stub'];
  const REGION_TYPES = ['ram', 'rom', 'io', 'video', 'banked', 'cart', 'mirror', 'unmapped'];
  const MODE_TYPES = ['text', 'bitmap', 'tile', 'mixed'];
  const MEDIA_KINDS = ['disk', 'tape', 'cartridge', 'snapshot', 'program', 'rom', 'other'];
  const ENDIAN = ['little', 'big'];
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  function nullPaths(v, path, out) {
    if (v === null) out.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => nullPaths(x, path ? path + '.' + i : String(i), out));
    else if (isObj(v)) for (const k of Object.keys(v)) if (k !== 'unknown') nullPaths(v[k], path ? path + '.' + k : k, out);
    return out;
  }
  function getPath(v, path) { for (const k of path.split('.')) { if (v == null || typeof v !== 'object' || !(k in v)) return undefined; v = v[k]; } return v; }

  function validate(p) {
    const errors = [], warnings = [], err = (m) => errors.push(m), warn = (m) => warnings.push(m);
    if (!isObj(p)) return { ok: false, errors: ['profile must be an object'], warnings };
    if (p.profile !== 1) err('profile must be 1 (schema version)');
    if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) err('id must be lower-case letters, digits and hyphens');
    if (typeof p.name !== 'string' || !p.name) err('name is required');
    if (FAMILIES.indexOf(p.family) < 0) err('family must be one of ' + FAMILIES.join(', '));
    if (STATUS.indexOf(p.status) < 0) err('status must be complete or stub');

    const cpu = p.cpu;
    if (!isObj(cpu)) err('cpu is required');
    else {
      if (typeof cpu.arch !== 'string') err('cpu.arch is required');
      if (cpu.clockHz !== null && !(isNum(cpu.clockHz) && cpu.clockHz > 0)) err('cpu.clockHz must be a positive number or null');
      if (ENDIAN.indexOf(cpu.endianness) < 0) err('cpu.endianness must be little or big');
    }

    const mem = p.memory;
    if (!isObj(mem)) err('memory is required');
    else {
      if (!(Number.isInteger(mem.addressBits) && mem.addressBits >= 8 && mem.addressBits <= 32)) err('memory.addressBits must be an integer 8..32');
      else if (!Array.isArray(mem.regions) || !mem.regions.length) err('memory.regions needs at least one region');
      else {
        const top = Math.pow(2, mem.addressBits) - 1, byLayer = {};
        mem.regions.forEach((r, i) => {
          const w = 'memory.regions[' + i + ']' + (r && r.name ? ' (' + r.name + ')' : '');
          if (!isObj(r)) { err(w + ' must be an object'); return; }
          if (typeof r.name !== 'string' || !r.name) err(w + ': name required');
          if (REGION_TYPES.indexOf(r.type) < 0) err(w + ': type must be one of ' + REGION_TYPES.join(', '));
          if (!Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end > top || r.start > r.end) { err(w + ': start/end must be integers, 0 <= start <= end <= ' + top); return; }
          const layer = r.layer || 'base'; (byLayer[layer] = byLayer[layer] || []).push(r);
        });
        // two regions in the same layer may not overlap; model bank switching and variants with different layers
        for (const layer of Object.keys(byLayer)) {
          const rs = byLayer[layer].slice().sort((a, b) => a.start - b.start);
          for (let i = 1; i < rs.length; i++) if (rs[i].start <= rs[i - 1].end) err('memory: regions "' + rs[i - 1].name + '" and "' + rs[i].name + '" overlap in layer "' + layer + '"');
          if (layer === 'base' && p.status === 'complete') {
            let covered = 0; rs.forEach((r) => { covered += r.end - r.start + 1; });
            if (covered !== top + 1) warn('memory: base layer covers ' + covered + ' of ' + (top + 1) + ' bytes (mark gaps as "unmapped")');
          }
        }
      }
    }

    const v = p.video;
    if (!isObj(v)) err('video is required');
    else {
      if (!isObj(v.native)) err('video.native is required');
      else for (const k of ['width', 'height']) if (v.native[k] !== null && !(Number.isInteger(v.native[k]) && v.native[k] > 0)) err('video.native.' + k + ' must be a positive integer or null');
      if (!Array.isArray(v.modes)) err('video.modes must be an array (may be empty on a stub)');
      else { const ids = new Set(); v.modes.forEach((m, i) => { if (!m || typeof m.id !== 'string') err('video.modes[' + i + '].id required'); else if (ids.has(m.id)) err('video.modes: duplicate id ' + m.id); else ids.add(m.id); if (m && MODE_TYPES.indexOf(m.type) < 0) err('video.modes[' + i + '].type must be one of ' + MODE_TYPES.join(', ')); }); }
      if (v.palette != null && !isObj(v.palette)) err('video.palette must be an object or null');
    }
    if (!isObj(p.audio)) err('audio is required');
    else if (p.audio.channels !== null && !Number.isInteger(p.audio.channels)) err('audio.channels must be an integer or null');
    if (!isObj(p.charset)) err('charset is required');
    if (!isObj(p.keyboard)) err('keyboard is required');

    if (!Array.isArray(p.media)) err('media must be an array');
    else p.media.forEach((m, i) => { if (!isObj(m) || MEDIA_KINDS.indexOf(m.kind) < 0) err('media[' + i + '].kind must be one of ' + MEDIA_KINDS.join(', ')); else if (!Array.isArray(m.formats) || !m.formats.length) err('media[' + i + '].formats needs at least one extension'); });

    const roms = p.roms;
    if (!isObj(roms)) err('roms is required');
    else {
      if (roms.policy !== 'local-only') err('roms.policy must be "local-only": ROM images are never stored in a profile or the repository');
      if (!Array.isArray(roms.list)) err('roms.list must be an array');
      else roms.list.forEach((r, i) => {
        if (!isObj(r) || typeof r.role !== 'string') { err('roms.list[' + i + '].role required'); return; }
        if (r.sha256 != null && !/^[0-9a-f]{64}$/.test(r.sha256)) err('roms.list[' + i + '].sha256 must be 64 hex digits or null');
        for (const k of Object.keys(r)) if (typeof r[k] === 'string' && r[k].length > 300) err('roms.list[' + i + '].' + k + ' looks like embedded data; keep ROM contents out of profiles');
      });
    }
    if (!Array.isArray(p.testMaterial)) err('testMaterial must be an array (freely redistributable software only)');
    if (!Array.isArray(p.sources) || !p.sources.length) err('sources needs at least one reference');

    // unknown <-> null discipline
    if (!Array.isArray(p.unknown)) err('unknown must be an array of dotted paths');
    else {
      const listed = new Set(p.unknown), nulls = nullPaths(p, '', []);
      for (const n of nulls) if (!listed.has(n)) err('null at "' + n + '" is not listed in unknown');
      for (const u of listed) { const val = getPath(p, u); if (val === undefined) err('unknown lists "' + u + '" which does not exist'); else if (val !== null) err('unknown lists "' + u + '" but it has a value'); }
      if (p.status === 'stub' && !p.unknown.length) warn('a stub with no unknowns: promote it to "complete"?');
    }
    return { ok: errors.length === 0, errors, warnings };
  }
  return { validate, FAMILIES, REGION_TYPES };
});
