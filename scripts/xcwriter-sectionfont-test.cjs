// xCWriter: fonts added in the font editor (craft.myfonts, craft.manifest) must be listed in the Typeface and Section-font pickers with
// plain names, sizes and support flags, and a section font must change the section's text in High quality, Page and Atari views.
// Screenshots: out/shots/sectionfont/*.png (env SHOT_TAG=before|after)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), http = require('http'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), WEB = path.join(ROOT, 'web'), TAG = process.env.SHOT_TAG || 'after';
const SHOTS = path.join(ROOT, 'out', 'shots', 'sectionfont');
const CF = require('../tools/craftfont.cjs'), FP = require('../tools/fontpipe.cjs');
require('./fontlist.cjs').build();
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ttf': 'font/ttf' };

// a font the editor would keep: family "Test Serif" with sizes 8 and 12, flagged off for ACWriter at 12; its manifest overlay
const master = CF.parse(fs.readFileSync(path.join(ROOT, 'font', 'craft12.acf')));
const fam = CF.familyNew(master, 'Test Serif');
CF.familyDerive(fam, [8]);
const MY = { 'Test Serif': FP.toXcf(fam, {}) };
const MAN = { format: 'craft-family-manifest', version: 1, targets: {}, removed: [], families: [{ id: 'test-serif', name: 'Test Serif', kind: 'mine', source: { type: 'pixel-master', size: 12 }, tags: ['user'],
  styles: [{ style: 'regular', graphics: false, coverage: [], sizes: { 8: { origin: 'derived' }, 12: { origin: 'master', flags: { xcwriter: true } } } }] }] };
const para = (t, extra) => Object.assign({ align: 'l', bullet: false, runs: [{ t, b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }, extra || {});

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(WEB, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'); r.end(fs.readFileSync(f));
  }).listen(0);
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const errs = []; let fails = 0;
  const ok = (m) => console.log('ok  ' + m), bad = (m) => { fails++; console.log('FAIL ' + m); };
  const check = (c, m) => (c ? ok(m) : bad(m));
  for (const url of ['http://localhost:' + srv.address().port + '/xcwriter.html', 'file:///' + WEB.replace(/\\/g, '/') + '/xcwriter.html']) {
    const kind = url.startsWith('http') ? 'http' : 'file';
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } }), p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(kind + ': ' + e.message));
    await p.addInitScript(([my, man]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('craft.myfonts', JSON.stringify(my)); localStorage.setItem('craft.manifest', JSON.stringify(man)); localStorage.setItem('seeded', '1'); } }, [MY, MAN]);
    await p.goto(url); await p.click('#hnew'); await p.waitForTimeout(800);
    const shot = (n) => p.screenshot({ path: path.join(SHOTS, TAG + '-' + kind + '-' + n + '.png') });

    // (1) added fonts appear in both lists with plain names, sizes and support notes
    const list = (id) => p.evaluate((i) => [...document.querySelectorAll('#' + i + ' option')].map((o) => ({ v: o.value, t: o.textContent, d: o.disabled })), id);
    await p.click('#mpg'); await p.waitForTimeout(300);
    const pf = await list('pgfont'), sf = await list('secfont');
    const mine = pf.filter((o) => /Test Serif/.test(o.t));
    check(mine.length === 2, kind + ': both sizes of the added family are in Typeface: ' + JSON.stringify(mine));
    check(mine.every((o) => !/\[|^\w+\d$/.test(o.t)) && mine.some((o) => /12 px/.test(o.t)) && mine.some((o) => /8 px/.test(o.t)), kind + ': plain names with sizes');
    check(sf.filter((o) => /Test Serif/.test(o.t)).length === 2, kind + ': and in the section font picker');
    check(await p.evaluate(() => [...document.querySelectorAll('#pgfont optgroup')].some((g) => /Test Serif/.test(g.label))), kind + ': grouped under its family');
    check(mine.some((o) => /ACWriter/.test(o.t)), kind + ': support notes shown');
    await shot('1-lists');

    // (2) the section font picker is available in every view and changes the text
    const id12 = (mine.find((o) => /12 px/.test(o.t)) || {}).v;
    await p.evaluate(() => { XW.doc = XCW.normalize(['One', 'Two', 'Three'].map((t) => ({ align: 'l', bullet: false, runs: [{ t: t + ' the quick brown fox jumps', b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }))); XW.page = null; });
    for (const mode of ['hq', 'atari', 'page']) {
      await p.click({ hq: '#mhq', atari: '#mat', page: '#mpg' }[mode]); await p.waitForTimeout(400);
      await p.evaluate(() => { XW.doc = XCW.normalize(['One', 'Two', 'Three'].map((t) => ({ align: 'l', bullet: false, runs: [{ t: t + ' the quick brown fox jumps', b: 0, i: 0, u: 0, sup: 0, sub: 0 }] }))); XW.page = null; XW.load && XW.load(XW.doc); });
      check(await p.isVisible('#secfont'), kind + ' ' + mode + ': section font picker visible');
    }
    await p.click('#mhq'); await p.waitForTimeout(300);
    await p.evaluate(() => { const hq = document.getElementById('hq'); hq.focus(); const r = document.createRange(); r.setStart(hq.children[1].firstChild, 2); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange')); });
    await p.waitForTimeout(200);
    const fam0 = await p.evaluate(() => getComputedStyle(document.querySelector('#hq p')).fontFamily);
    if (id12 && await p.isVisible('#secfont')) await p.selectOption('#secfont', id12);
    await p.waitForTimeout(900);
    const fam1 = await p.evaluate(() => [...document.querySelectorAll('#hq p')].map((e) => getComputedStyle(e).fontFamily));
    check(fam1.every((f) => /XCF_/.test(f)) && fam1[0] !== fam0, kind + ': High quality text shows the section font ' + JSON.stringify(fam1));
    await shot('2-hq-section-font');
    const res = await p.evaluate(() => XCW.Page.resolve(XW.doc, XW.page || {}).map((r) => r.face));
    check(res.every((f) => f === id12), kind + ': model resolves the section face ' + JSON.stringify(res));
    await p.click('#mat'); await p.waitForTimeout(300);
    const atFace = await p.evaluate(() => (XCW.Page.resolve(XW.doc, XW.page || {})[1] || {}).face);
    check(atFace === id12, kind + ': Atari view uses the section face');
    await shot('3-atari-section-font');
    await p.click('#mpg'); await p.waitForTimeout(500); await shot('4-page-section-font');

    // (3) a size turned off for xCWriter in the font editor is hidden, or greyed with the reason under "show all"
    await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('craft.manifest')); m.families[0].styles[0].sizes[8].flags = { xcwriter: false }; localStorage.setItem('craft.manifest', JSON.stringify(m)); window.dispatchEvent(new Event('focus')); });
    await p.waitForTimeout(300);
    let l2 = await list('pgfont');
    check(!l2.some((o) => o.v === 'TESTSER8'), kind + ': a size flagged off for xCWriter is hidden');
    await p.check('#fshowall'); await p.waitForTimeout(300);
    l2 = await list('secfont');
    const grey = l2.find((o) => o.v === 'TESTSER8');
    check(grey && grey.d && /turned off for xCWriter/.test(grey.t), kind + ': show all greys it with the reason: ' + (grey && grey.t));
    await shot('5-show-all');
    await p.uncheck('#fshowall');
    await ctx.close();
  }
  check(errs.length === 0, 'no page errors ' + errs.join('|'));
  await b.close(); srv.close();
  if (fails) { console.log(fails + ' failed'); process.exit(1); }
  console.log('xcwriter section font test passed');
})().catch((e) => { console.error(e); process.exit(1); });
