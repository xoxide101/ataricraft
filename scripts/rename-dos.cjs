const fs = require('fs'), path = require('path'), crypto = require('crypto');
const FW = 'C:/Users/raver/ataricraft/software_n_roms/firmware/';
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const mv = (from, toDir, name) => {
  fs.mkdirSync(toDir, { recursive: true });
  let to = toDir + name;
  if (fs.existsSync(to)) { const e = path.extname(name); to = toDir + path.basename(name, e) + ' #2' + e; }
  fs.renameSync(from, to);
  return to;
};

// 1. garbled OS ROMs from out/roms/ostest.json (boot test on 130XE/800, BASIC off)
const test = JSON.parse(fs.readFileSync('C:/Users/raver/ataricraft/out/roms/ostest.json', 'utf8'));
const bad = new Map();
for (const t of test) {
  const txt = t.text || '';
  const ok = /MEMO ?-?PAD|MONITOR|SELF TEST|Jammer/i.test(txt) || txt === '';
  const odd = t.colors >= 25 || t.colors === 1 || (!ok && txt.length);
  if (odd) bad.set(t.h, t);
}
let garbled = 0;
const osDirs = ['OS 8-bit/Replacement OS', 'OS 8-bit/Atari XL-XE-XEGS', 'OS 8-bit/Atari 400-800', 'OS 8-bit/1400XL and 1450XLD'];
for (const d of osDirs) {
  if (!fs.existsSync(FW + d)) continue;
  for (const n of fs.readdirSync(FW + d)) {
    const h = sha(FW + d + '/' + n).slice(0, 8);
    const t = bad.get(h);
    if (!t) continue;
    const e = path.extname(n);
    mv(FW + d + '/' + n, FW + 'Unused (garbled or need special hardware)/', path.basename(n, e) + ' [garbled on boot test' + (t.text ? '' : ', blank screen') + ']' + e);
    garbled++;
  }
}
console.log('moved garbled/unused:', garbled);

// 2. DOS naming: "DOS - Product - Vendor - vVersion - Release (variant)"
const src = ['DOS (zipped disk-system releases)', 'Cartridges and EPROM images/SpartaDOS X'];
const log = [];
const family = (p) => /Sparta/i.test(p) ? 'SpartaDOS' : /BW-DOS/i.test(p) ? 'BW-DOS' : /MyDOS/i.test(p) ? 'MyDOS' : /DOS XL|XL DOS/i.test(p) ? 'DOS XL (OSS)' : /Turbo|Mach|Warp|Top-DOS|Rainbow|Com-DOS|Micro-DOS|Happy|II\+D|II-D|DOS Control|Toms/i.test(p) ? 'Third-party DOS' : /^(DOS|810)|Atari DOS|DOS XE/i.test(p) ? 'Atari DOS' : 'Utilities and other';
for (const d of src) {
  const dir = FW + d + '/';
  if (!fs.existsSync(dir)) continue;
  for (const n of fs.readdirSync(dir)) {
    const e = path.extname(n), b = path.basename(n, e);
    if (!/DOS|Directories|Energy Editor|Atari DOS/i.test(b) || /^(IDE|SIDE|SDX446)/i.test(b)) continue;
    const groups = [...b.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
    const flags = [...b.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
    const baseTxt = b.replace(/\(.*$/, '').replace(/\[.*$/, '').trim();
    const date = (groups.find((g) => /^(\d{4}|19xx)(-\d\d-\d\d)?$/.test(g)) || '').replace('19xx', '');
    const extra = groups.filter((g) => !/^(\d{4}|19xx)(-\d\d-\d\d)?$/.test(g));
    const vendor = extra.length ? extra[0] : '';
    const notes = extra.slice(1).filter((x) => x && x !== '-');
    let prod = baseTxt, ver = '';
    const m = baseTxt.match(/^(.*?)\s+v?(\d[\w.]*)(.*)$/);
    if (m) { prod = m[1]; ver = m[2]; if (m[3].trim()) notes.push(m[3].trim()); }
    if (prod === 'DOS' && !ver && date.startsWith('1979')) { ver = '1.0'; }
    if (/^SpartaDosXv(\d)(\d+)/i.test(prod.replace('.', ''))) continue;
    for (const f of flags) {
      if (/^a\d?$/.test(f)) notes.push('alt dump');
      else if (/^m/.test(f)) notes.push('modified' + (f.length > 2 ? ' by ' + f.slice(2).trim() : ''));
      else if (/^k-file/.test(f)) notes.push('file collection');
      else notes.push(f);
    }
    const v = vendor === '-' || !vendor ? 'Unknown vendor' : vendor;
    const out = ['DOS', prod.trim(), v, ver ? 'v' + ver : 'v?', date || 'year n.d.'].join(' - ') + (notes.length ? ' (' + notes.join(', ') + ')' : '') + e;
    const to = mv(dir + n, FW + 'DOS/' + family(prod) + '/', out.replace(/[<>:"/\\|?*]/g, '_'));
    log.push(n + '  ->  ' + path.relative(FW, to).replace(/\\/g, '/'));
  }
}
fs.writeFileSync(FW + 'DOS-RENAME-MAP.txt', log.join('\n') + '\n');
console.log('renamed DOS files:', log.length);
