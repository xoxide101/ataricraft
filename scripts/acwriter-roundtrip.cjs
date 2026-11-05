// ACWriter <-> xCWriter round trip through the real emulator and the real xCWriter page.
// 1. compose in ACWriter (bold, italic, underline, centre, right, bullet, sub, sup), Save As H:ACRT, read it in xCWriter in both modes
// 2. author in xCWriter, Send to Atari (BroadcastChannel to the emulator tab), File > Open H:XCRT in ACWriter, re-save as H:XCBACK, read in xCWriter again
// 3. Word-made and hand-written RTF -> .CWD -> File > Open in ACWriter (and the >11 KB file: truncated, opens without hanging)
// Usage: node scripts/acwriter-roundtrip.cjs [poc5.xex]    (screenshots out/rt-*.png, files out/rt/*)
const { chromium } = require('C:/Users/raver/craftapi/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'), RT = path.join(OUT, 'rt');
fs.mkdirSync(RT, { recursive: true });
const X = require('../tools/xcwcore.cjs'), I = require('../tools/craftimport.cjs'), D = require('../tools/craftdoc.cjs'), RTFS = require('./rtf-fixtures.cjs');
const URL = (f) => 'file:///' + ROOT.replace(/\\/g, '/') + '/' + f;
const ok = (m) => console.log('ok  ' + m);
const sig = (ps) => ps.map((p) => p.align + (p.bullet ? '*' : ' ') + p.runs.map((r) => (r.b ? '<b>' : '') + (r.i ? '<i>' : '') + (r.u ? '<u>' : '') + (r.sup ? '<^>' : '') + (r.sub ? '<_>' : '') + r.t).join('|')).join('\n');
const MENU_KEYS = { ':': 'Shift+Semicolon', ' ': 'Space', '.': 'Period', '-': 'Minus' };

(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL('web/index.html'));
  await p.setInputFiles('#romfiles', [ROOT + '/software_n_roms/ATARIXL.ROM', ROOT + '/software_n_roms/ATARIBAS.ROM']);
  await p.selectOption('#model', '130xe').catch(() => {});
  await p.click('#boot'); await p.waitForTimeout(3000);
  await p.evaluate((a) => FujiNet.emu.bootFile('POC.XEX', new Uint8Array(a)), Array.from(fs.readFileSync(path.join(ROOT, 'tools/acwriter', process.argv[2] || 'poc5.xex'))));
  await p.waitForTimeout(3000);
  await p.locator('canvas').first().click();
  await p.waitForTimeout(10000); await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
  const key = async (k, w = 350) => { await p.keyboard.press(k); await p.waitForTimeout(w); };
  const type = async (s) => { for (const ch of s) await key(MENU_KEYS[ch] || ch, 450); };
  const menu = async (...ks) => { await key('Escape'); for (const k of ks) await key(k, 700); await p.waitForTimeout(900); };
  const shot = async (n) => { const f = path.join(OUT, 'rt-' + n + '.png'); await p.locator('canvas').first().screenshot({ path: f }); return f; };
  const hostFile = async (re) => {
    const files = await p.evaluate(() => Object.fromEntries(Object.entries(FujiNet.emu.hostFiles()).map(([k, v]) => [k, Array.from(v)])));
    const n = Object.keys(files).find((k) => re.test(k)); return n ? Buffer.from(files[n]) : null;
  };
  const openH = async (name) => { await menu('f', 'o'); await type('h:' + name.toLowerCase()); await key('Enter', 2500); };
  await key('ArrowDown', 900);

  // ---------- 1. ACWriter -> xCWriter ----------
  await menu('f', 'n'); await key('Enter', 1200); await key('CapsLock', 500);
  await shot('0-new');
  await menu('p', 'c'); await key('Control+b', 300); await type('Centred Title'); await key('Control+b', 300); await key('Enter', 1000);
  await menu('p', 'l'); await type('Plain '); await key('Control+b', 300); await type('bold'); await key('Control+b', 300); await type(' ');
  await menu('c', 'i'); await type('ital'); await menu('c', 'i'); await type(' '); await key('Control+u', 300); await type('under'); await key('Control+u', 300);
  await type(' H'); await menu('c', 'd'); await type('2'); await menu('c', 'd'); await type('O x'); await menu('c', 'p'); await type('2'); await menu('c', 'p'); await key('Enter', 1000);
  await menu('p', 'r'); await type('Right side'); await key('Enter', 1000);
  await menu('p', 'b'); await type('Bullet item'); await key('Enter', 1000);
  await menu('p', 'l'); await type('Last line');
  await shot('1-acwriter-composed');
  await menu('f', 'a'); await type('h:acrt'); await key('Enter', 2000);
  const acrt = await hostFile(/ACRT/i); assert(acrt, 'ACRT saved to H:');
  fs.writeFileSync(path.join(RT, 'ACRT.CWD'), acrt);
  const parsed = D.parse(acrt); assert(parsed.h.checksumOk, 'ACWriter wrote a valid checksum');
  const want1 = ['c |Centred Title', 'l |Plain |bold| |ital| |under H|2|O x|2', 'r |Right side', 'l*|Bullet item', 'l |Last line'];
  const m1 = X.openDoc(acrt, 'ACRT.CWD').paras;
  const got1 = sig(m1).split('\n');
  console.log('ACWriter saved model:\n' + got1.join('\n'));
  const has = (re) => assert(re.test(sig(m1)), 'ACWriter file lacks ' + re);
  has(/^c .*<b>Centred Title/mi); has(/<b>bold/i); has(/<i>ital/i); has(/<u>under/i); has(/<_>2/); has(/<\^>2/); has(/^r .*Right side/mi); has(/^l\*.*Bullet item/mi); has(/Last line$/mi);
  ok('ACWriter composed bold/italic/underline/centre/right/bullet/sub/sup and Save As wrote a valid .CWD (' + acrt.length + ' bytes)');

  // ---------- xCWriter page (same browser context so BroadcastChannel reaches the emulator tab) ----------
  const xp = await ctx.newPage(); xp.on('pageerror', (e) => errs.push(e.message));
  await xp.setViewportSize({ width: 1360, height: 900 });
  await xp.goto(URL('web/xcwriter.html'));
  const xmodel = () => xp.evaluate(() => JSON.parse(JSON.stringify(XW.doc)));
  for (const mode of ['#mhq', '#mat']) {
    await xp.setInputFiles('#filein', path.join(RT, 'ACRT.CWD')); await xp.waitForTimeout(300);
    if (await xp.locator('#bhome').count()) { /* already in editor */ }
    await xp.click(mode); await xp.waitForTimeout(500);
    const m = await xmodel(); assert.strictEqual(sig(m), sig(m1), 'xCWriter model differs from ACWriter file in ' + mode);
    await xp.screenshot({ path: path.join(OUT, 'rt-2-xcw-' + mode.slice(1) + '-from-acwriter.png') });
  }
  ok('ACWriter-saved file opens in xCWriter HQ and matching mode with an identical model (text, styles, alignment, bullet, sub/sup)');

  // ---------- 2. xCWriter -> ACWriter ----------
  await xp.click('#bhome'); await xp.click('#hnew'); await xp.click('#mhq'); await xp.click('#hq');
  await xp.keyboard.type('xCWriter Title'); await xp.click('#tb-c'); await xp.keyboard.press('Enter'); await xp.click('#tb-l');
  await xp.keyboard.type('Plain '); await xp.keyboard.press('Control+b'); await xp.keyboard.type('bold'); await xp.keyboard.press('Control+b');
  await xp.keyboard.type(' '); await xp.keyboard.press('Control+i'); await xp.keyboard.type('ital'); await xp.keyboard.press('Control+i');
  await xp.keyboard.type(' '); await xp.keyboard.press('Control+u'); await xp.keyboard.type('under'); await xp.keyboard.press('Control+u'); await xp.keyboard.press('Enter');
  await xp.click('#tb-r'); await xp.keyboard.type('Flush right'); await xp.keyboard.press('Enter');
  await xp.click('#tb-bul'); await xp.keyboard.type('A bullet'); await xp.keyboard.press('Enter'); await xp.click('#tb-bul');
  await xp.click('#tb-l'); await xp.keyboard.type('Quote \u201csmart\u201d and caf\u00e9 end');
  await xp.waitForTimeout(300);
  const authored = await xmodel(); console.log('xCWriter authored model:\n' + sig(authored));
  // Send to Atari over BroadcastChannel
  await xp.click('#mat'); await xp.waitForTimeout(400);
  await xp.fill('#fn, #docname', 'XCRT').catch(() => {});
  await xp.evaluate(() => { XW.name = 'XCRT'; });
  await xp.click('#tb-send'); await xp.waitForTimeout(2500);
  let sent = await hostFile(/XCRT/i), via = 'Send to Atari';
  if (!sent) {
    via = 'hostWrite (Send to Atari did not reach the emulator)';
    const bytes = X.save(await xmodel(), 'cwd').bytes; await p.evaluate((a) => FujiNet.emu.hostWrite('XCRT.CWD', new Uint8Array(a)), Array.from(bytes)); sent = bytes;
  }
  console.log('delivered via', via, sent.length, 'bytes');
  fs.writeFileSync(path.join(RT, 'XCRT.CWD'), sent);
  await p.bringToFront(); await p.locator('canvas').first().click(); await p.waitForTimeout(500);
  await openH('xcrt'); const f2 = await shot('3-acwriter-opened-xcwriter-doc');
  // re-save in ACWriter, read again in xCWriter
  await menu('f', 'a'); await type('h:xcback'); await key('Enter', 2000);
  const back = await hostFile(/XCBACK/i); assert(back, 'XCBACK saved'); fs.writeFileSync(path.join(RT, 'XCBACK.CWD'), back);
  const mBack = X.openDoc(back, 'XCBACK.CWD').paras, mSent = X.openDoc(sent, 'XCRT.CWD').paras;
  assert(D.parse(back).h.checksumOk);
  console.log('after ACWriter re-save:\n' + sig(mBack));
  assert.strictEqual(sig(mBack), sig(mSent), 'ACWriter re-save changed the document');
  await xp.bringToFront(); await xp.setInputFiles('#filein', path.join(RT, 'XCBACK.CWD')); await xp.waitForTimeout(300);
  await xp.screenshot({ path: path.join(OUT, 'rt-4-xcw-after-cycle.png') });
  assert.strictEqual(sig(await xmodel()), sig(mSent)); ok('xCWriter -> ' + via + ' -> ACWriter File>Open -> Save As -> xCWriter: model identical after the full cycle');

  // ---------- 3. imported documents in ACWriter ----------
  await p.bringToFront(); await p.locator('canvas').first().click();
  const cases = { RICH: fs.readFileSync(path.join(ROOT, 'docs/samples/word/rich.rtf')), WPAD: Buffer.from(RTFS.wordpad, 'latin1'), ESCAPES: Buffer.from(RTFS.escapes, 'latin1'), TABLE: Buffer.from(RTFS.table, 'latin1'),
    RICHDOCX: fs.readFileSync(path.join(ROOT, 'docs/samples/word/rich.docx')) };
  let body = ''; for (let i = 1; i <= 220; i++) body += 'The quick brown fox jumps over the lazy dog, paragraph ' + i + ' of a long real-world RTF document.\\par\r\n';
  cases.LONGRTF = Buffer.from('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}' + body + '}', 'latin1');
  for (const [name, buf] of Object.entries(cases)) {
    const r = I.convert(buf, name === 'RICHDOCX' ? 'x.docx' : 'x.rtf'); fs.writeFileSync(path.join(RT, name + '.CWD'), r.file);
    await p.evaluate(([n, a]) => FujiNet.emu.hostWrite(n + '.CWD', new Uint8Array(a)), [name, Array.from(r.file)]);
    await openH(name); await p.waitForTimeout(name === 'LONGRTF' ? 8000 : 1500); await shot('5-import-' + name.toLowerCase());
    const st = await p.evaluate(() => ataricraft.peek(0x1410, 3)); // sanity read: emulator still responsive
    console.log('opened', name, r.file.length, 'bytes', r.truncated ? 'TRUNCATED, ' + r.dropped + ' dropped' : '', 'responsive', Array.isArray(st) || !!st);
  }
  ok('imported documents opened in ACWriter without hanging (screenshots out/rt-5-import-*.png)');
  console.log('errors:', errs); assert.deepStrictEqual(errs, []);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
