// Assembler + disassembler round trip, no external tools: node tools/tests/asmdas.test.cjs
const assert = require('assert');
const { assemble } = require('../../web/js/asm6502.js');
const W = require('../../web/js/wtools.js');
const eq = W.atariEquates();
let n = 0; const t = (name, f) => { f(); n++; console.log('ok  ', name); };

t('hardware names and RUN vector', () => {
  const r = assemble(' org $2000\nstart lda #$0F\n sta COLBK\n sta AUDF1\n jmp start\n .run start\n', { symbols: eq });
  assert.deepStrictEqual([...r.xex].slice(0, 2), [0xff, 0xff]);
  assert.deepStrictEqual(r.segments[r.segments.length - 1], { addr: 0x2e0, bytes: [0, 0x20] });
  assert.ok(!('COLBK' in r.symbols) && r.symbols.start === 0x2000);
  assert.ok(r.listingText.includes('8D 1A D0'));
});
t('INIT segment lands inline', () => {
  const r = assemble(' org $3000\nini rts\n .init ini\nmain nop\n .run main\n');
  assert.deepStrictEqual(r.segments.map((s) => s.addr), [0x3000, 0x2e2, 0x3001, 0x2e0]);
});
t('unknown name without symbols fails', () => assert.throws(() => assemble(' sta COLBK\n'), /undefined symbol/));
t('round trip every opcode', () => {
  const src = [' org $4000', ' lda #1', ' lda $10', ' lda $10,x', ' ldx $10,y', ' lda $1234', ' lda $1234,x', ' lda $1234,y', ' lda ($10,x)', ' lda ($10),y',
    ' jmp ($1234)', ' asl', ' asl $10', ' bne *', ' sta WSYNC', ' sta HPOSP0', ' lda RANDOM', ' rts'].join('\n') + '\n';
  const r = assemble(src, { symbols: eq });
  const seg = r.segments[0], text = W.disasm(Uint8Array.from(seg.bytes), seg.addr, {});
  const lines = text.split('\n').filter((l) => /^ {2}[0-9A-F]{4}|^\w+:$/.test(l)).map((l) => (l[0] === ' ' ? ' ' + l.slice(18).trim() : l));
  const back = assemble(' org $4000\n' + lines.join('\n') + '\n', { symbols: eq });
  assert.deepStrictEqual(back.segments[0].bytes, seg.bytes);
  assert.ok(/STA WSYNC/.test(text) && /HPOSP0/.test(text) && /RANDOM/.test(text));
});
t('disasmFile reads XEX with RUNAD', () => {
  const r = assemble(' org $2000\ns inx\n jmp s\n .run s\n');
  const txt = W.disasmFile(r.xex, 0x2000);
  assert.ok(/RUNAD = \$2000/.test(txt) && /INX/.test(txt));
});
t('MADS/dasm compat directives', () => {
  const r = assemble('        processor 6502\n org $2000\nv = $1234\n dta b(1,2), a(v), l(v), h(v), c\'AB\'\n dc.b 5\n dc.w v\n ds.b 2\n');
  assert.deepStrictEqual(r.segments[0].bytes, [1, 2, 0x34, 0x12, 0x34, 0x12, 65, 66, 5, 0x34, 0x12, 0, 0]);
});
console.log(n + ' tests passed');
