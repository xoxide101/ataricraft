// AtariCraft BASIC compiler: a subset of Atari BASIC to MADS-style 6502 source, then to an XEX through asm6502.js.
// AC.BComp.compile(src) -> { asm, xex, errors:[{line,msg}] }   (xex is null when there are errors)
//
// The subset: 16-bit signed integers only (no floats, no string variables), numeric DIM arrays, PRINT of numbers and
// string literals, LET, IF/THEN, GOTO, GOSUB/RETURN/POP, FOR/NEXT (constant STEP, paired at compile time), ON..GOTO/GOSUB,
// INPUT (integers), POKE, GRAPHICS/COLOR/SETCOLOR/PLOT/DRAWTO/POSITION/SOUND, END/STOP, REM.
// Functions: PEEK DPEEK ABS INT STICK STRIG PADDLE PTRIG and INT(RND(0)*N) (the only RND form, gives 0..N-1).
// Division truncates toward zero.  Numbers above 32767 wrap (POKE/PEEK addresses up to 65535 work as addresses).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./asm6502.js'));
  else { root.AC = root.AC || {}; root.AC.BComp = factory(root.AC.Asm); }
})(typeof self !== 'undefined' ? self : this, function (Asm) {
  const KW = new Set(['REM', 'LET', 'PRINT', 'IF', 'THEN', 'GOTO', 'GOSUB', 'RETURN', 'POP', 'FOR', 'TO', 'STEP', 'NEXT', 'POKE', 'GRAPHICS', 'COLOR', 'SETCOLOR',
    'PLOT', 'DRAWTO', 'POSITION', 'SOUND', 'DIM', 'ON', 'INPUT', 'END', 'STOP', 'AND', 'OR', 'NOT']);
  const FN = { PEEK: 1, DPEEK: 1, ABS: 1, INT: 1, STICK: 1, STRIG: 1, PADDLE: 1, PTRIG: 1, RND: 1 };
  const PORT = { STICK: 0x278, STRIG: 0x284, PADDLE: 0x270, PTRIG: 0x27C };

  // Runtime routines, included only when used.  Zero page: $80/$81 result, $82/$83 second operand, $84/$85 remainder/product.
  const RT = {
    putc: { code: `r_putc  pha
        lda #11
        sta $0342
        lda #0
        sta $0348
        sta $0349
        pla
        ldx #0
        jmp $E456
`, deps: [] },
    pstr: { code: `r_pstr  ldy #0
ps1     lda ($8A),y
        beq ps2
        sty $8D
        jsr r_putc
        ldy $8D
        iny
        bne ps1
ps2     rts
`, deps: ['putc'] },
    eol: { code: `r_eol   lda #155
        jmp r_putc
`, deps: ['putc'] },
    neg80: { code: `r_neg80 sec
        lda #0
        sbc $80
        sta $80
        lda #0
        sbc $81
        sta $81
        rts
`, deps: [] },
    neg82: { code: `r_neg82 sec
        lda #0
        sbc $82
        sta $82
        lda #0
        sbc $83
        sta $83
        rts
`, deps: [] },
    mul: { code: `r_mul   lda #0
        sta $84
        sta $85
        ldx #16
mu1     lsr $83
        ror $82
        bcc mu2
        clc
        lda $84
        adc $80
        sta $84
        lda $85
        adc $81
        sta $85
mu2     asl $80
        rol $81
        dex
        bne mu1
        lda $84
        sta $80
        lda $85
        sta $81
        rts
`, deps: [] },
    udiv: { code: `r_udiv  lda #0
        sta $84
        sta $85
        ldx #16
ud1     asl $80
        rol $81
        rol $84
        rol $85
        sec
        lda $84
        sbc $82
        tay
        lda $85
        sbc $83
        bcc ud2
        sta $85
        sty $84
        inc $80
ud2     dex
        bne ud1
        rts
`, deps: [] },
    div: { code: `r_div   lda $81
        eor $83
        php
        lda $81
        bpl dv1
        jsr r_neg80
dv1     lda $83
        bpl dv2
        jsr r_neg82
dv2     jsr r_udiv
        plp
        bpl dv3
        jsr r_neg80
dv3     rts
`, deps: ['udiv', 'neg80', 'neg82'] },
    abs: { code: `r_abs   lda $81
        bpl ab1
        jmp r_neg80
ab1     rts
`, deps: ['neg80'] },
    cmp: { code: `r_eq    lda $80
        cmp $82
        bne r_f
        lda $81
        cmp $83
        bne r_f
r_t     lda #1
        sta $80
        lda #0
        sta $81
        rts
r_f     lda #0
        sta $80
        sta $81
        rts
r_lt    sec
        lda $80
        sbc $82
        lda $81
        sbc $83
        bvc lt1
        eor #$80
lt1     bmi r_t
        jmp r_f
r_gt    ldx $80
        lda $82
        sta $80
        stx $82
        ldx $81
        lda $83
        sta $81
        stx $83
        jmp r_lt
`, deps: [] },
    pint: { code: `r_pint  lda $81
        bpl pi1
        lda #45
        jsr r_putc
        jsr r_neg80
pi1     lda #0
        sta $8C
pi2     lda #10
        sta $82
        lda #0
        sta $83
        jsr r_udiv
        lda $84
        clc
        adc #48
        pha
        inc $8C
        lda $80
        ora $81
        bne pi2
pi3     pla
        jsr r_putc
        dec $8C
        bne pi3
        rts
`, deps: ['putc', 'udiv', 'neg80'] },
    tab: { code: `r_tab   lda #32
        jsr r_putc
        lda $55
tb1     cmp #10
        bcc tb2
        sbc #10
        jmp tb1
tb2     cmp #0
        bne r_tab
        rts
`, deps: ['putc'] },
    input: { code: `r_inp   lda #63
        jsr r_putc
        lda #32
        jsr r_putc
        lda #5
        sta $0342
        lda #$80
        sta $0344
        lda #5
        sta $0345
        lda #40
        sta $0348
        lda #0
        sta $0349
        ldx #0
        jsr $E456
        lda #0
        sta $8E
        rts
r_inn   lda #0
        sta $80
        sta $81
        sta $8C
        ldy $8E
        lda $0580,y
        cmp #45
        bne in1
        inc $8C
        iny
in1     lda $0580,y
        sec
        sbc #48
        cmp #10
        bcs in3
        sta $8D
        lda $80
        sta $82
        lda $81
        sta $83
        asl $80
        rol $81
        asl $80
        rol $81
        clc
        lda $80
        adc $82
        sta $80
        lda $81
        adc $83
        sta $81
        asl $80
        rol $81
        clc
        lda $80
        adc $8D
        sta $80
        bcc in2
        inc $81
in2     iny
        bne in1
in3     lda $8C
        beq in4
        jsr r_neg80
in4     lda $0580,y
        cmp #44
        bne in5
        iny
in5     sty $8E
        rts
`, deps: ['putc', 'neg80'] },
    rnd: { code: `r_rnd   lda $80
        sta $82
        lda $81
        sta $83
        lda $D20A
        sta $80
        lda $D20A
        and #$7F
        sta $81
        jsr r_udiv
        lda $84
        sta $80
        lda $85
        sta $81
        rts
`, deps: ['udiv'] },
    gr: { code: `r_gr    sta $8C
        lda #12
        sta $03A2
        ldx #$60
        jsr $E456
        lda #3
        sta $03A2
        lda #<r_sname
        sta $03A4
        lda #>r_sname
        sta $03A5
        lda $8C
        and #$30
        ora #12
        sta $03AA
        lda $8C
        and #15
        sta $03AB
        ldx #$60
        jmp $E456
r_sname .byte 'S:',155
`, deps: [] },
    plot: { code: `r_plot  lda #11
        sta $03A2
        lda #0
        sta $03A8
        sta $03A9
        lda r_col
        ldx #$60
        jmp $E456
`, deps: [] },
    drawto: { code: `r_draw  lda r_col
        sta $02FB
        lda #$11
        sta $03A2
        lda #12
        sta $03AA
        lda #0
        sta $03AB
        ldx #$60
        jmp $E456
`, deps: [] }
  };

  function compile(src) {
    const errors = [];
    const out = [];
    const used = new Set();
    const scalars = new Set();
    const arrays = new Map();
    const strs = [];
    let uid = 0, forId = 0, usesCol = false, usesSound = false;
    const em = (s) => out.push('        ' + s);
    const lab = (s) => out.push(s);
    const need = (n) => { used.add(n); };

    // ---- source lines ----
    const lines = new Map();
    src.split(/\r?\n/).forEach((raw, i) => {
      if (!raw.trim()) return;
      const m = /^\s*(\d+)\s?(.*)$/.exec(raw);
      if (!m) { errors.push({ line: i + 1, msg: 'line has no line number' }); return; }
      lines.set(+m[1], { n: +m[1], text: m[2], src: i + 1 });
    });
    const order = [...lines.keys()].sort((a, b) => a - b);
    const targets = new Map();

    // ---- parser/code generator for one line ----
    let s, p, curLine, fors = [];
    const fail = (msg) => { throw new Error(msg); };
    const ws = () => { while (p < s.length && (s[p] === ' ' || s[p] === '\t')) p++; };
    const atEnd = () => { ws(); return p >= s.length || s[p] === ':'; };
    const peekIdent = () => { ws(); const m = /^[A-Za-z][A-Za-z0-9]*\$?/.exec(s.slice(p)); return m ? m[0].toUpperCase() : null; };
    const ident = () => { const id = peekIdent(); if (!id) fail('name expected'); p += id.length; return id; };
    const eat = (c) => { ws(); if (s[p] === c) { p++; return true; } return false; };
    const expect = (c) => { if (!eat(c)) fail(`'${c}' expected`); };
    const kw = (w) => { if (peekIdent() === w) { p += w.length; return true; } return false; };
    const varName = (id) => {
      if (id.endsWith('$')) fail('string variables are not supported');
      if (KW.has(id)) fail(`'${id}' is a reserved word`);
      return id;
    };

    const num = () => {
      ws(); const m = /^\d+(\.\d*)?([eE][+-]?\d+)?/.exec(s.slice(p));
      if (!m) fail('number expected');
      if (/[.eE]/.test(m[0])) fail('floating point is not supported (integers only)');
      p += m[0].length;
      const v = +m[0]; if (v > 65535) fail('number too large for 16 bits');
      return v & 0xFFFF;
    };
    const lineRef = () => {
      ws(); if (!/\d/.test(s[p] || '')) fail('line number expected (computed line numbers are not supported)');
      const n = num(); targets.set(n, curLine.src); return n;
    };

    function prim() {
      ws();
      if (/\d|\./.test(s[p] || '')) return { t: 'n', v: num() };
      if (s[p] === '(') { p++; const e = orE(); expect(')'); return e; }
      const id = peekIdent(); if (!id) fail('expression expected');
      p += id.length;
      if (FN[id]) {
        expect('('); const a = orE(); expect(')');
        if (id === 'INT') return fromInt(a);
        if (id === 'RND') fail('RND is only supported as INT(RND(0)*N)');
        return { t: 'f', name: id, a };
      }
      varName(id);
      ws();
      if (s[p] === '(') { p++; const i = orE(); expect(')'); if (!arrays.has(id)) fail(`array ${id} is not DIMed`); return { t: 'a', name: id, i }; }
      if (arrays.has(id)) fail(`array ${id} needs an index`);
      scalars.add(id);
      return { t: 'v', name: id };
    }
    const isRnd = (e) => e.t === 'f' && e.name === 'RND0';
    function fromInt(a) {
      if (a.t === 'b' && a.op === '*') {
        if (isRnd(a.l)) return { t: 'rnd', n: a.r };
        if (isRnd(a.r)) return { t: 'rnd', n: a.l };
      }
      if (isRnd(a)) fail('INT(RND(0)) is always 0 here; use INT(RND(0)*N)');
      return a;
    }
    function unary() {
      ws();
      if (s[p] === '-') { p++; const e = unary(); return e.t === 'n' ? { t: 'n', v: (-e.v) & 0xFFFF } : { t: 'u', op: 'neg', e }; }
      if (s[p] === '+') { p++; return unary(); }
      // RND(0) is only meaningful inside INT(RND(0)*N): it is handled in prim() via the placeholder below.
      if (peekIdent() === 'RND') { p += 3; expect('('); const a = orE(); expect(')'); if (!(a.t === 'n' && a.v === 0)) fail('only RND(0) is supported, inside INT(RND(0)*N)'); return { t: 'f', name: 'RND0' }; }
      return prim();
    }
    const bin = (sub, ops) => () => {
      let l = sub();
      for (;;) {
        ws(); let op = null;
        for (const o of ops) if (s.startsWith(o, p)) { op = o; break; }
        if (!op) return l;
        p += op.length; l = { t: 'b', op, l, r: sub() };
      }
    };
    const mulE = bin(unary, ['*', '/']);
    const addE = bin(mulE, ['+', '-']);
    function cmpE() {
      let l = addE();
      for (;;) {
        ws(); let op = null;
        for (const o of ['<=', '>=', '<>', '<', '>', '=']) if (s.startsWith(o, p)) { op = o; break; }
        if (!op) return l;
        p += op.length; l = { t: 'b', op, l, r: addE() };
      }
    }
    function notE() { if (kw('NOT')) return { t: 'u', op: 'not', e: notE() }; return cmpE(); }
    function andE() { let l = notE(); while (kw('AND')) l = { t: 'b', op: 'AND', l, r: notE() }; return l; }
    function orE() { let l = andE(); while (kw('OR')) l = { t: 'b', op: 'OR', l, r: andE() }; return l; }

    const lo = (v) => v & 255, hi = (v) => (v >> 8) & 255;
    const simple = (e) => e.t === 'n' || e.t === 'v';
    const loadTo = (e, a, b) => {
      if (e.t === 'n') { em(`lda #${lo(e.v)}`); em(`sta ${a}`); em(`lda #${hi(e.v)}`); em(`sta ${b}`); }
      else { em(`lda V_${e.name}`); em(`sta ${a}`); em(`lda V_${e.name}+1`); em(`sta ${b}`); }
    };
    function addr(e) {
      gen(e.i);
      em('asl $80'); em('rol $81'); em('clc'); em('lda $80'); em(`adc #<A_${e.name}`); em('sta $8A'); em('lda $81'); em(`adc #>A_${e.name}`); em('sta $8B');
    }
    function gen(e) {
      switch (e.t) {
        case 'n': loadTo(e, '$80', '$81'); return;
        case 'v': loadTo(e, '$80', '$81'); return;
        case 'a': addr(e); em('ldy #0'); em('lda ($8A),y'); em('sta $80'); em('iny'); em('lda ($8A),y'); em('sta $81'); return;
        case 'u':
          gen(e.e);
          if (e.op === 'neg') { need('neg80'); em('jsr r_neg80'); }
          else { const q = ++uid; em('lda $80'); em('ora $81'); em(`beq Qt${q}`); em('lda #0'); em('sta $80'); em('sta $81'); em(`beq Qe${q}`); lab(`Qt${q}`); em('lda #1'); em('sta $80'); em('lda #0'); em('sta $81'); lab(`Qe${q}`); }
          return;
        case 'rnd': gen(e.n); need('rnd'); em('jsr r_rnd'); return;
        case 'f':
          if (e.name === 'RND0') fail('RND is only supported as INT(RND(0)*N)');
          gen(e.a);
          if (e.name === 'ABS') { need('abs'); em('jsr r_abs'); }
          else if (e.name === 'PEEK' || e.name === 'DPEEK') {
            em('lda $80'); em('sta $8A'); em('lda $81'); em('sta $8B'); em('ldy #0'); em('lda ($8A),y'); em('sta $80');
            if (e.name === 'DPEEK') { em('iny'); em('lda ($8A),y'); em('sta $81'); } else em('sty $81');
          } else { em('lda $80'); em('tax'); em(`lda $${PORT[e.name].toString(16)},x`); em('sta $80'); em('lda #0'); em('sta $81'); }
          return;
        case 'b': {
          gen(e.l);
          if (simple(e.r)) loadTo(e.r, '$82', '$83');
          else { em('lda $80'); em('pha'); em('lda $81'); em('pha'); gen(e.r); em('lda $80'); em('sta $82'); em('lda $81'); em('sta $83'); em('pla'); em('sta $81'); em('pla'); em('sta $80'); }
          const o = e.op;
          if (o === '+' || o === '-') {
            const i = o === '+' ? 'adc' : 'sbc';
            em(o === '+' ? 'clc' : 'sec'); em('lda $80'); em(`${i} $82`); em('sta $80'); em('lda $81'); em(`${i} $83`); em('sta $81');
          } else if (o === '*') { need('mul'); em('jsr r_mul'); }
          else if (o === '/') { need('div'); em('jsr r_div'); }
          else if (o === 'AND') { em('lda $80'); em('and $82'); em('sta $80'); em('lda $81'); em('and $83'); em('sta $81'); }
          else if (o === 'OR') { em('lda $80'); em('ora $82'); em('sta $80'); em('lda $81'); em('ora $83'); em('sta $81'); }
          else {
            need('cmp');
            const call = { '=': 'r_eq', '<>': 'r_eq', '<': 'r_lt', '>=': 'r_lt', '>': 'r_gt', '<=': 'r_gt' }[o];
            em(`jsr ${call}`);
            if (o === '<>' || o === '>=' || o === '<=') { em('lda $80'); em('eor #1'); em('sta $80'); }
          }
          return;
        }
      }
      fail('internal: bad expression');
    }
    const store = (name) => { em('lda $80'); em(`sta V_${name}`); em('lda $81'); em(`sta V_${name}+1`); };
    const test = (skip) => { const q = ++uid; em('lda $80'); em('ora $81'); em(`bne Q${q}`); em(`jmp ${skip}`); lab(`Q${q}`); };
    const args = (n) => {
      const r = [];
      for (let i = 0; i < n; i++) { if (i) expect(','); gen(orE()); em('lda $80'); em(`sta $${(0x90 + i * 2).toString(16)}`); em('lda $81'); em(`sta $${(0x91 + i * 2).toString(16)}`); }
      return r;
    };
    const lvalue = () => {
      const id = varName(ident()); ws();
      if (s[p] === '(') {
        p++; const i = orE(); expect(')'); if (!arrays.has(id)) fail(`array ${id} is not DIMed`);
        return { arr: true, name: id, i };
      }
      if (arrays.has(id)) fail(`array ${id} needs an index`);
      scalars.add(id); return { arr: false, name: id };
    };
    const saveAddr = (lv) => { addr(lv); em('lda $8A'); em('sta $90'); em('lda $8B'); em('sta $91'); };
    const storeLv = (lv) => {
      if (!lv.arr) { store(lv.name); return; }
      em('ldy #0'); em('lda $80'); em('sta ($90),y'); em('iny'); em('lda $81'); em('sta ($90),y');
    };

    function statement() {
      const w = peekIdent();
      if (w === 'REM') { p = s.length; return; }
      if (w && KW.has(w) && w !== 'LET') p += w.length;
      switch (w && KW.has(w) ? w : null) {
        case 'LET': p += 3; assign(); return;
        case 'PRINT': return print();
        case 'IF': {
          const c = orE(); if (!kw('THEN')) fail('THEN expected');
          gen(c); test(`X${curLine.n}`);
          ws();
          if (/\d/.test(s[p] || '')) em(`jmp L${lineRef()}`);
          else { stmts(); }
          return;
        }
        case 'GOTO': em(`jmp L${lineRef()}`); return;
        case 'GOSUB': em(`jsr L${lineRef()}`); return;
        case 'RETURN': em('rts'); return;
        case 'POP': em('pla'); em('pla'); return;
        case 'END': case 'STOP': em('jmp ($000A)'); return;
        case 'FOR': {
          const v = varName(ident()); scalars.add(v); expect('=');
          gen(orE()); store(v);
          if (!kw('TO')) fail('TO expected');
          const k = ++forId; gen(orE()); em('lda $80'); em(`sta F${k}L`); em('lda $81'); em(`sta F${k}L+1`);
          let step = 1;
          if (kw('STEP')) { const neg = eat('-'); ws(); step = num(); if (neg) step = (-step) & 0xFFFF; if (!neg && step > 32767) fail('STEP too large'); }
          lab(`F${k}T`);
          fors.push({ v, k, step, line: curLine.src });
          return;
        }
        case 'NEXT': {
          const v = varName(ident());
          let f; while (fors.length) { f = fors.pop(); if (f.v === v) break; f = null; }
          if (!f) fail(`NEXT ${v} without FOR`);
          const k = f.k, neg = f.step > 32767;
          em('clc'); em(`lda V_${v}`); em(`adc #${lo(f.step)}`); em(`sta V_${v}`); em(`lda V_${v}+1`); em(`adc #${hi(f.step)}`); em(`sta V_${v}+1`);
          loadTo({ t: 'v', name: v }, '$80', '$81'); em(`lda F${k}L`); em('sta $82'); em(`lda F${k}L+1`); em('sta $83');
          need('cmp'); em(neg ? 'jsr r_lt' : 'jsr r_gt');
          em('lda $80'); em('ora $81'); em(`bne F${k}X`); em(`jmp F${k}T`); lab(`F${k}X`);
          return;
        }
        case 'POKE': {
          gen(orE()); em('lda $80'); em('sta $90'); em('lda $81'); em('sta $91'); expect(',');
          gen(orE()); em('ldy #0'); em('lda $80'); em('sta ($90),y'); return;
        }
        case 'GRAPHICS': gen(orE()); need('gr'); em('lda $80'); em('jsr r_gr'); return;
        case 'COLOR': gen(orE()); usesCol = true; em('lda $80'); em('sta r_col'); return;
        case 'SETCOLOR': {
          args(3);
          em('lda $94'); em('and #15'); em('sta $94'); em('lda $92'); em('asl'); em('asl'); em('asl'); em('asl'); em('ora $94'); em('ldx $90'); em('sta $02C4,x');
          return;
        }
        case 'PLOT': case 'POSITION': case 'DRAWTO': {
          args(2);
          em('lda $92'); em('sta $54'); em('lda $90'); em('sta $55'); em('lda $91'); em('sta $56');
          if (w === 'PLOT') { usesCol = true; need('plot'); em('jsr r_plot'); }
          if (w === 'DRAWTO') { usesCol = true; need('drawto'); em('jsr r_draw'); }
          return;
        }
        case 'SOUND': {
          args(4); usesSound = true;
          em('lda #0'); em('sta $D208'); em('lda #3'); em('sta $D20F');
          em('lda $90'); em('asl'); em('tax'); em('lda $92'); em('sta $D200,x');
          em('lda $94'); em('asl'); em('asl'); em('asl'); em('asl'); em('sta $98'); em('lda $96'); em('and #15'); em('ora $98'); em('sta $D201,x');
          return;
        }
        case 'DIM': {
          do {
            const id = ident(); if (id.endsWith('$')) fail('string arrays/variables are not supported');
            varName(id); expect('('); const n = num(); expect(')');
            if (scalars.has(id) || arrays.has(id)) fail(`${id} is already used`);
            arrays.set(id, n + 1);
          } while (eat(','));
          return;
        }
        case 'ON': {
          gen(orE());
          const gosub = kw('GOSUB'); if (!gosub && !kw('GOTO')) fail('GOTO or GOSUB expected');
          const q = ++uid; let i = 0;
          do {
            i++; const n = lineRef(); const nx = `Qn${q}_${i}`;
            em('lda $81'); em(`bne ${nx}`); em('lda $80'); em(`cmp #${i}`); em(`bne ${nx}`);
            if (gosub) { em(`jsr L${n}`); em(`jmp Qo${q}`); } else em(`jmp L${n}`);
            lab(nx);
          } while (eat(','));
          lab(`Qo${q}`);
          return;
        }
        case 'INPUT': {
          let first = true;
          do {
            const lv = lvalue(); if (lv.arr) saveAddr(lv);
            need('input'); if (first) em('jsr r_inp'); first = false; em('jsr r_inn'); storeLv(lv);
          } while (eat(','));
          return;
        }
        case 'TO': case 'THEN': case 'STEP': case 'AND': case 'OR': case 'NOT': fail(`unexpected ${w}`);
      }
      if (/^[A-Za-z]/.test(s.slice(p).trim())) { assign(); return; }
      if (s[p] === '?') { p++; return print(); }
      fail('statement expected');
    }
    function assign() {
      const lv = lvalue(); expect('=');
      if (lv.arr) { saveAddr(lv); }
      gen(orE()); storeLv(lv);
    }
    function strLit() {
      p++; let t = '';
      for (;;) {
        if (p >= s.length) fail('unterminated string');
        if (s[p] === '"') { p++; break; }
        t += s[p++];
      }
      strs.push(t); const k = strs.length - 1;
      em(`lda #<S${k}`); em('sta $8A'); em(`lda #>S${k}`); em('sta $8B'); need('pstr'); em('jsr r_pstr');
    }
    function print() {
      let nl = true;
      for (;;) {
        ws();
        if (p >= s.length || s[p] === ':') break;
        if (s[p] === '"') strLit();
        else if (s[p] === '#') fail('PRINT # is not supported');
        else { gen(orE()); need('pint'); em('jsr r_pint'); }
        ws();
        if (s[p] === ';') { p++; nl = false; }
        else if (s[p] === ',') { p++; nl = false; need('tab'); em('jsr r_tab'); }
        else { nl = true; break; }
      }
      if (nl) { need('eol'); em('jsr r_eol'); }
    }
    function stmts() {
      for (;;) {
        ws();
        if (p >= s.length) return;
        if (s[p] === ':') { p++; continue; }
        statement();
        ws();
        if (p < s.length && s[p] !== ':') fail(`unexpected '${s.slice(p, p + 8)}'`);
      }
    }

    lab('        org $2000');
    lab('start');
    for (const n of order) {
      curLine = lines.get(n); s = curLine.text; p = 0;
      lab(`L${n}`);
      try { stmts(); } catch (e) { errors.push({ line: curLine.src, msg: e.message }); }
      lab(`X${n}`);
    }
    for (const f of fors) errors.push({ line: f.line, msg: `FOR ${f.v} has no NEXT` });
    for (const [n, from] of targets) if (!lines.has(n)) errors.push({ line: from, msg: `line ${n} does not exist` });
    em('jmp ($000A)');

    // ---- runtime and data ----
    const added = new Set();
    const addRt = (n) => { if (added.has(n)) return; added.add(n); for (const d of RT[n].deps) addRt(d); out.push(RT[n].code.replace(/\n$/, '')); };
    for (const n of used) addRt(n);
    if (usesCol) lab('r_col   .byte 0');
    if (usesSound) { /* registers are set inline */ }
    for (const v of scalars) lab(`V_${v}   .word 0`);
    for (const [v, n] of arrays) lab(`A_${v}   .ds ${n * 2}`);
    for (let k = 0; k < forId; k++) lab(`F${k + 1}L  .word 0`);
    strs.forEach((t, k) => lab(`S${k}      .byte ${[...t].map((c) => c.charCodeAt(0) & 255).concat(0).join(',')}`));
    lab('        org $02E0');
    lab('        .word start');
    const asm = out.join('\n') + '\n';
    errors.sort((a, b) => a.line - b.line);
    let xex = null;
    if (!errors.length) {
      try { xex = Asm.assemble(asm).xex; } catch (e) { errors.push({ line: 0, msg: 'internal assembler error: ' + e.message }); }
    }
    return { asm, xex, errors };
  }
  return { compile };
});
