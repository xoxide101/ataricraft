// Compares web/js/asm6502.js with MADS on sample programs: node tools/tests/asm6502.test.cjs  (needs out/mads/mads.exe)
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const { assemble } = require('../../web/js/asm6502.js');
const mads = path.join(__dirname, '..', '..', 'out', 'mads', 'mads.exe');
const progs = {
  basic: `        org $2000
start   lda #$00
        sta $d01a
loop    inx
        bne loop
        lda msg,x
        sta $0600,y
        jmp start
msg     .byte "HI",$9b,0
        .word start,loop
        org $2e0
        .word start
`,
  modes: `        org $3000
        lda #<tab
        ldx #>tab
        lda (ptr),y
        sta (ptr,x)
        lda tab,x
        lda tab,y
        ldx tab,y
        ldy ptr,x
        stx ptr,y
        asl
        asl ptr
        rol tab,x
        jsr sub
        jmp (vec)
sub     rts
ptr     = $80
vec     = $0600
tab     .byte 1,2,3,4
        .byte $ea,$ea,$ea
        ldx #(2*3)+1
        lda #1<<4|1
`,
  branch: `        org $4000
top     dex
        bne top
        beq fwd
        nop
fwd     bcc top
        bmi top
        rts
`,
};
let bad = 0;
for (const [name, src] of Object.entries(progs)) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'asm')), f = path.join(d, name + '.asm'), o = path.join(d, name + '.xex');
  fs.writeFileSync(f, src);
  const r = cp.spawnSync(mads, [f, '-o:' + o], { encoding: 'utf8' });
  let mine; try { mine = Buffer.from(assemble(src).xex); } catch (e) { console.log('FAIL', name, e.message); bad++; continue; }
  if (r.status !== 0) { console.log('MADS failed on', name, r.stdout.slice(-300)); bad++; continue; }
  const ref = fs.readFileSync(o);
  if (Buffer.compare(mine, ref) === 0) console.log('ok  ', name, mine.length, 'bytes'); else { bad++; console.log('FAIL', name, '\n mine', mine.toString('hex'), '\n mads', ref.toString('hex')); }
}
process.exit(bad ? 1 : 0);
