// ASM/IDE panel in a real browser (no emulator or ROMs needed): assemble, errors, macros, INCLUDE from in-memory buffers, simulator run/step, views, shortcuts.
// Usage: node scripts/asmpanel-test.cjs     Env: PW_CORE (playwright-core dir), CHROME (browser executable).
const fs = require('fs'), path = require('path'), http = require('http');
const first = (list, test) => list.find((p) => p && test(p));
const pwDir = first([process.env.PW_CORE, 'C:/Users/raver/craftapi/node_modules/playwright-core', '/opt/playwright-mcp/node_modules/playwright-core'], (p) => fs.existsSync(p));
const chrome = first([process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'], (p) => fs.existsSync(p));
if (!pwDir || !chrome) { console.log('asmpanel-test: playwright-core or Chrome not found, skipped'); process.exit(0); }
const { chromium } = require(pwDir);
const WEB = path.join(__dirname, '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
let bad = 0;
const ok = (c, m, x) => { if (!c) { bad++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(WEB, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+$/, '/tools.html'));
    if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
    r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  }).listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const b = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 800 } }), p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + 'tools.html'); await p.waitForFunction(() => window.AC && AC.AsmPanel);
  await p.evaluate(() => AC.AsmPanel.open());
  const ed = p.locator('textarea'), out = () => p.locator('pre').first().innerText(), status = () => p.evaluate(() => AC.AsmPanel.el.children[3].innerText);
  const setSrc = async (t) => { await ed.fill(t); };
  const btn = (t) => p.locator('button', { hasText: t }).first();

  const h = await p.evaluate(() => AC.AsmPanel.el.children[0].getBoundingClientRect().height);
  ok(h >= 36 && h <= 42, 'ribbon is a single 36-42px row', h);

  await btn('Assemble').click();
  ok(/^OK, \d+ bytes/.test(await out()) && /start = \$2000/.test(await out()), 'sample assembles');
  await setSrc(' org $2000\n lda #1\n bogus\n'); await btn('Assemble').click();
  ok(/line 3: unknown instruction/.test(await out()), 'error shows line');
  await setSrc(' org $2000\n .macro w n\n ldx #:n\n .endm\n w 7\n sta AUDF1\n'); await p.keyboard.press('F7');
  ok(/OK, 11 bytes/.test(await out()), 'macro + F7 shortcut', await out());

  // font buffer published by another tool resolves through .INCLUDE without a disk save
  await p.evaluate(() => AC.Buffers.set('assets/font.fnt', new Uint8Array(1024).fill(0xAA), { source: 'fontedit' }));
  await setSrc(' org $3000\n .include "assets/font.fnt"\n'); await btn('Assemble').click();
  ok(/OK, 1030 bytes/.test(await out()), 'INCLUDE resolves in-memory font buffer', await out());
  await p.evaluate(() => AC.Buffers.set('assets/font.fnt', new Uint8Array(1024).fill(0x55), { source: 'fontedit' }));
  ok(/changed in memory/.test(await status()), 'stale-buffer notice', await status());
  await btn('Assemble').click();
  ok(await p.evaluate(() => AC.AsmPanel.state.last.segments[0].bytes[0]) === 0x55, 'rebuild picks up the new font bytes');

  // simulator: run, break, step
  await setSrc(' org $2000\nstart ldx #3\nl dex\n bne l\n jsr sub\n lda #$42\n sta $80\n jmp *\nsub inx\n rts\n .run start\n');
  await btn('Disasm').click(); await btn('Watch').click();
  await p.locator('select').nth(1).selectOption('sim'); await btn('Clean&Link').click();
  await btn('Into').click(); await btn('Into').click();
  ok(/PC=2003 A=00 X=02/.test(await status()), 'step into advances PC', await status());
  await btn('Run').click(); await p.waitForTimeout(300); await btn('Break').click();
  ok(await p.evaluate(() => AC.AsmPanel.state.mem[0x80]) === 0x42, 'simulator ran the program to completion');
  ok(/▶/.test(await p.locator('pre').nth(1).innerText()), 'disassembly marks PC');
  ok(/0080: 42/.test(await p.locator('pre').nth(2).innerText()), 'watch shows $80', await p.locator('pre').nth(2).innerText());
  await p.locator('select').first().selectOption('65c02'); await setSrc(' org $2000\n stz $10\n'); await p.keyboard.press('F7');
  ok(/OK, 8 bytes/.test(await out()), '65C02 dialect from ribbon', await out());
  const dis = (src, cpu) => p.evaluate(([b, c]) => AC.WTools.disasm1(Uint8Array.from(b), 0, 0x2000, { cpu: c, labels: {} }).text, [src, cpu]);
  const cmos = [[[0x64, 0x10], 'STZ $10'], [[0x80, 0x02], 'BRA $2004'], [[0x1A], 'INC A'], [[0x3A], 'DEC A'], [[0xDA], 'PHX'], [[0x7A], 'PLY'], [[0xB2, 0x20], 'LDA ($20)'],
    [[0x7C, 0x34, 0x12], 'JMP ($1234,X)'], [[0x89, 0x01], 'BIT #$01'], [[0x34, 0x40], 'BIT $40,X'], [[0x9E, 0x00, 0x30], 'STZ $3000,X'], [[0x1C, 0x00, 0x30], 'TRB $3000'], [[0x04, 0x50], 'TSB $50']];
  const got = []; for (const [b, t] of cmos) got.push(await dis(b, '65c02') === t);
  ok(got.every(Boolean), '65C02 disassembly of the CMOS opcodes', got);
  ok(/^\.BYTE/.test(await dis([0x64, 0x10], '6502')) && await dis([0xA9, 0x01], '65c02') === 'LDA #$01', 'CMOS opcodes stay data on a 6502; shared opcodes unchanged');
  await p.locator('select').first().selectOption('6502');

  // conditional assembly and procedures
  await setSrc(' org $2000\nDBG = 1\n .if DBG == 1 && 2 > 1\n lda #1\n .else\n lda #2\n .endif\n .ifdef NOPE\n nop\n .endif\n .if DBG <> 1\n dex\n .elseif DBG >= 1\n inx\n .endif\n'); await btn('Assemble').click();
  ok(JSON.stringify(await p.evaluate(() => AC.AsmPanel.state.last.segments[0].bytes)) === '[169,1,232]', '.IF/.ELSEIF/.ELSE/.ENDIF/.IFDEF choose the right branch', await out());
  await setSrc(' org $2000\n .if 0\n .proc ghost\n .endp\n lda #9\n .endif\n nop\n'); await btn('Assemble').click();
  ok(/OK, 7 bytes/.test(await out()), 'skipped branch emits nothing and defines nothing', await out());
  await setSrc(' org $2000\n .if 1\n nop\n'); await btn('Assemble').click();
  ok(/missing \.ENDIF/.test(await out()), 'unclosed .IF is an error', await out());
  await setSrc(' org $2000\n .if 1\n .error "stop here"\n .endif\n'); await btn('Assemble').click();
  ok(/line 3: stop here/.test(await out()), '.ERROR stops the build', await out());
  await setSrc(' org $2000\nloop nop\n jsr sub.go\n jmp loop\n .proc sub\nloop dex\ngo bne loop\n rts\n .endp\n'); await btn('Assemble').click();
  ok(/OK, 17 bytes/.test(await out()), '.PROC/.ENDP assemble', await out());
  const sy = await p.evaluate(() => AC.AsmPanel.state.last.symbols);
  ok(sy.loop === 0x2000 && sy['sub.loop'] === 0x2007 && sy['sub.go'] === 0x2008 && sy.sub === 0x2007, 'proc labels are scoped (local label hides the global one inside, name.label outside)', sy);
  const b2 = await p.evaluate(() => Array.from(AC.AsmPanel.state.last.segments[0].bytes));
  ok(b2[2] === 0x08 && b2[3] === 0x20 && b2[9] === 0xFD, 'jsr sub.go targets the local label; bne reaches the local loop', b2);
  await setSrc(' org $2000\n .endp\n'); await btn('Assemble').click();
  ok(/\.ENDP without \.PROC/.test(await out()), 'stray .ENDP is an error', await out());

  // Studio shell: tabs, Alt+1..4, one ribbon row per tab, font buffer from the embedded Font editor feeds .INCLUDE
  const sp = await ctx.newPage(); const serrs = []; sp.on('pageerror', (e) => serrs.push(e.message));
  await sp.goto(base + 'studio.html#ide'); await sp.waitForFunction(() => window.AC && AC.Studio && AC.AsmPanel.el);
  const vis = () => sp.evaluate(() => [...document.querySelectorAll('#ribbon>.row')].filter((r) => r.classList.contains('on')).map((r) => r.id + ':' + Math.round(document.getElementById('ribbon').getBoundingClientRect().height)));
  ok(JSON.stringify(await vis()) === '["r-ide:40"]', 'IDE ribbon is 40px', await vis());
  await sp.keyboard.press('Alt+3'); await sp.waitForFunction(() => AC.Studio.tab() === 'font');
  ok(JSON.stringify(await vis()) === '["r-font:40"]', 'Alt+3 swaps the ribbon to Font studio', await vis());
  await sp.waitForFunction(() => AC.Buffers.has('assets/font.fnt'), null, { timeout: 15000 }).catch(() => {});
  ok(await sp.evaluate(() => AC.Buffers.has('assets/font.fnt')), 'embedded Font editor published assets/font.fnt');
  await sp.keyboard.press('Alt+2'); await sp.waitForFunction(() => AC.Studio.tab() === 'ide');
  await sp.evaluate(() => { AC.AsmPanel.editor.value = ' org $3000\n .include "assets/font.fnt"\n'; AC.AsmPanel.build(); });
  ok(await sp.evaluate(() => AC.AsmPanel.state.last && AC.AsmPanel.state.last.xex.length) === 1030, 'IDE tab includes the font from the other tab, no disk save');
  await sp.keyboard.press('Alt+4'); ok((await sp.locator('#p-disk').innerText()).includes('Placeholder'), 'Disk & Flux tab is a labelled stub');
  ok(serrs.length === 0, 'studio: no page errors', serrs);
  ok(errs.length === 0, 'no page errors', errs);
  await b.close(); srv.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('FAIL', e); process.exit(1); });
