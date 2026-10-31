; KEYTEST.COM - visual keyboard: every key is a block that is grey (untested), yellow (held down) or green
; (has been pressed). SHIFT, CTRL, START/SELECT/OPTION and BREAK are included. Joysticks and paddles are read
; out below. PASS when every key has been seen. Hold START+SELECT+OPTION together to exit.
;
; HOW IT WORKS: the main loop (once per frame) polls POKEY directly - KBCODE ($D209) with SKSTAT ($D20F)
;   for the keyboard, CONSOL ($D01F) for START/SELECT/OPTION, IRQST ($D20E) bit 7 for BREAK - and paints
;   a map cell for each key. The OS keyboard handler is not used. A cell goes yellow while its key is
;   down and green once released ("settled"). PASS shows when `cnt` (distinct keys seen) >= `tot`.
;
; SCREEN (cscreen.inc, NA = 3 text rows, NMAP = 6 map rows of 20 cells, NB = 8 text rows):
;   rows 0-2 title / KBCODE+SKSTAT / legend; map = the keyboard drawn as blocks;
;   rows 3-10 below it: key count, JOY1-3 (U D L R FIRE), PADDLE 0-3, PADDLE 4-7, RESULT, exit hint.
;   Map cell number = map row * 20 + column; cells are laid out roughly like the keyboard rows:
;   0-14 digit row, 15-19 optional extra keys (not counted), 20-33 top letter row, 40 CTRL, 41-53 next row,
;   60/72 SHIFT, 61-71 bottom row, 83-91 space bar (nine cells), 95-98 START/SELECT/OPTION/BREAK.
;
; MEMORY / VARIABLES: cnt = keys seen, tot = keys required (starts at 8 and grows per mapped key; see
;   kt1), cur = key currently held ($FF none), shp/ctp = SHIFT / CTRL currently shown held, pv = previous
;   console-key state, st = per-cell "seen" flags, ktab = KBCODE (low 6 bits) -> cell, $FF = unmapped.
;
; EXTENDING: add a `code,cell` pair to kdef (terminated by $FF) and, if the cell should be drawn at start
;   and counted, nothing more is needed; cells 15-19 are deliberately not counted towards `tot`.
        org $2000
NA      = 3
NMAP    = 6
NB      = 8
        jmp start
        icl 'common.inc'
        icl 'cscreen.inc'

cnt     .byte 0         ; number of distinct counted keys seen so far
tot     .byte 0         ; number of keys that must be seen for PASS
cur     .byte $FF       ; map cell of the main-block key currently held, $FF = none
shp     .byte 0         ; 1 while SHIFT is shown held
ctp     .byte 0         ; 1 while CTRL is shown held
pst     .byte 0         ; state passed to paint
pv      .byte 0,0,0,0   ; previous pressed state of START, SELECT, OPTION, BREAK
cbit    .byte 1,2,4,$80 ; bit tested for each: CONSOL bits 0-2, IRQST bit 7 (0 = pressed)
ccl     .byte 95,96,97,98       ; map cell of each of those four keys
st      .ds 100         ; per-cell "has been seen" flag
ktab    .ds 64          ; KBCODE & $3F -> map cell, $FF = not mapped

; key table: pairs of (KBCODE low 6 bits, map cell), terminated by $FF.
; Codes are POKEY keyboard scan codes (not ATASCII); bit 6/7 of KBCODE (shift/ctrl) are masked off.
kdef    .byte $1C,0, $1F,1, $1E,2, $1A,3, $18,4, $1D,5, $1B,6, $33,7, $35,8, $30,9, $32,10, $36,11, $37,12, $34,13
        .byte $03,15, $04,16, $13,17, $14,18, $11,19
        .byte $2C,20, $2F,21, $2E,22, $2A,23, $28,24, $2D,25, $2B,26, $0B,27, $0D,28, $08,29, $0A,30, $0E,31, $0F,32, $0C,33
        .byte $3F,41, $3E,42, $3A,43, $38,44, $3D,45, $39,46, $01,47, $05,48, $00,49, $02,50, $06,51, $07,52, $3C,53
        .byte $17,61, $16,62, $12,63, $10,64, $15,65, $23,66, $25,67, $20,68, $22,69, $26,70, $27,71
        .byte $21,83
        .byte $FF

; start: set up the screen, clear st, build ktab from kdef (counting each key except cells 15-19 into
; tot, and drawing every mapped cell grey), draw the space bar, SHIFT, CTRL and console cells grey,
; then fall into the main loop.
start   lda #$7D
        jsr eput
        lda #1
        sta CRSINH      ; hide the cursor
        jsr gs_init
        ldx #0
        lda #1
        jsr bar
        loc 0,0
        say s_title
        loc 0,2
        say s_leg
        ldx #99
        lda #0
stc     sta st,x
        dex
        bpl stc
        ldx #63
        lda #$FF
kt0     sta ktab,x
        dex
        bpl kt0
        lda #8
        sta tot         ; base 8 = space bar, 2 SHIFT cells, CTRL and the 4 console keys (not in kdef)
        ldx #0
kt1     lda kdef,x
        cmp #$FF
        beq kt9
        tay
        lda kdef+1,x
        sta ktab,y
        stx t4
        pha
        cmp #15
        bcc kt2
        cmp #20
        bcc kt3
kt2     inc tot
kt3     pla
        tax
        lda #1
        jsr mapset
        ldx t4
        inx
        inx
        jmp kt1
kt9     ldx #83         ; space bar: cells 83..91
kt4     lda #1
        jsr mapset
        inx
        cpx #92
        bcc kt4
        lda #60
        sta t4
        ldx #60         ; left / right SHIFT
        lda #1
        jsr mapset
        ldx #72
        lda #1
        jsr mapset
        ldx #40         ; CTRL
        lda #1
        jsr mapset
        ldx #95         ; START, SELECT, OPTION, BREAK
kt5     lda #1
        jsr mapset
        inx
        cpx #99
        bcc kt5
        loc 0,10
        say s_hint

; main loop, once per frame: keep attract mode off, wait for vblank, restart the pot scan (POTGO) so
; POT0-7 stay current, and exit when START, SELECT and OPTION are all held (CONSOL low 3 bits = 0).
loop    lda #0
        sta ATRACT
        jsr vsync
        sta POTGO       ; any write starts a new paddle (POT) scan
        lda CONSOL
        and #7          ; 0 = START, SELECT and OPTION all pressed
        bne lp0
        jmp quit
lp0     jsr keys
        jsr mods
        jsr cons
        jsr readout
        jmp loop

; keys: main key block. Yellow while held, green after release. SKSTAT bit 2 = 0 means a key is down.
; Uses KBCODE & $3F -> ktab; unmapped keys ($FF) are ignored. When a different key replaces the held
; one, the previous cell is settled first (only one key is tracked at a time). Clobbers A, X, Y, pst.
keys    lda SKSTAT
        and #4          ; bit 2: 0 = a key is currently down
        bne kdn
        lda KBCODE
        and #$3F
        tax
        lda ktab,x
        cmp #$FF
        beq kret
        cmp cur
        beq kyel
        pha
        lda cur
        cmp #$FF
        beq kn1
        tax
        jsr settle
kn1     pla
        sta cur
kyel    ldx cur
        lda #0
        jmp paint
kdn     lda cur
        cmp #$FF
        beq kret
        tax
        lda #$FF
        sta cur
        jmp settle
kret    rts

; mods: SHIFT and CTRL cells. SHIFT is "down" if SKSTAT bit 3 = 0, or a key is down with KBCODE bit 6
; (shift) set; both shift cells light together (the hardware cannot tell left from right). CTRL is
; detected only while some key is down with KBCODE bit 7 set (CTRL alone generates no key code, so it
; appears to be seen only in combination with another key). Clobbers A, X, Y.
mods    lda SKSTAT
        and #8          ; bit 3: 0 = SHIFT held
        beq sh1
        lda SKSTAT
        and #4
        bne sh0
        lda KBCODE
        and #$40        ; KBCODE bit 6 = shift
        beq sh0
sh1     nop
        lda #1
        sta shp
        ldx #60
        lda #0
        jsr paint
        ldx #72
        lda #0
        jsr paint
        jmp ctl
sh0     lda shp
        beq ctl
        lda #0
        sta shp
        ldx #60
        jsr settle
        ldx #72
        jsr settle
ctl     lda SKSTAT
        and #4
        bne ct0
        lda KBCODE
        bpl ct0         ; KBCODE bit 7 = ctrl
        lda #1
        sta ctp
        ldx #40
        lda #0
        jmp paint
ct0     lda ctp
        beq ctr
        lda #0
        sta ctp
        ldx #40
        jmp settle
ctr     rts

; cons: START/SELECT/OPTION (CONSOL bits 0-2) and BREAK (IRQST bit 7); X = 0..3 indexes cbit/ccl/pv.
; A pressed key reads as 0 in the hardware bit; the and/eor pair turns that into nonzero = pressed.
; Pressed -> yellow; on release -> settle (green). Clobbers A, X, Y, t4.
cons    ldx #3
cn1     stx t4
        cpx #3
        beq cnb
        lda CONSOL
        jmp cnc
cnb     lda IRQST       ; BREAK: IRQST bit 7 is 0 while the key is held
cnc     and cbit,x
        eor cbit,x
        beq cnu
        lda #1
        sta pv,x
        lda ccl,x
        tax
        lda #0
        jsr paint
        jmp cnn
cnu     lda pv,x
        beq cnn
        lda #0
        sta pv,x
        lda ccl,x
        tax
        jsr settle
cnn     ldx t4
        dex
        bpl cn1
        rts

; settle: X = cell: mark it tested (first time only: st flag, and cnt++ unless it is one of the
; uncounted cells 15-19) and colour it green (state 3). Falls into paint. Clobbers A.
settle  lda st,x
        bne se1
        lda #1
        sta st,x
        cpx #15
        bcc se0
        cpx #20
        bcc se1
se0     inc cnt
se1     lda #3
; paint: X = cell, A = state (see mapset); the space bar (cell 83) is nine cells wide, 83..91.
paint   sta pst
        cpx #83
        bne pa1
pa0     lda pst
        jsr mapset
        inx
        cpx #92
        bcc pa0
        rts
pa1     lda pst
        jmp mapset

; readout: refresh the text rows: raw KBCODE/SKSTAT, keys tested count, joystick 1-3, paddles 0-7 and the
; RESULT line (PASS when cnt >= tot). Hardware sources: PORTA low nibble = stick 1, high nibble =
; stick 2; PORTB low nibble = stick 3 (400/800 only); TRIG0-2 = fire buttons; POT0-POT7 = paddles.
; Clobbers A, X, Y, t1-t4, v16.
readout loc 0,1
        say s_kb
        lda KBCODE
        jsr puthex
        say s_sk
        lda SKSTAT
        jsr puthex
        loc 0,3
        say s_cnt
        lda cnt
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        lda #' '
        jsr putc
        lda #'/'
        jsr putc
        lda #' '
        jsr putc
        lda tot
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        lda #' '
        jsr putc
        lda #' '
        jsr putc
        loc 0,4
        say s_j1
        lda PORTA
        sta t1
        lda TRIG0
        sta t2
        jsr joy
        loc 0,5
        say s_j2
        lda PORTA
        lsr             ; stick 2 is in the high nibble
        lsr
        lsr
        lsr
        sta t1
        lda TRIG0+1     ; $D011 = TRIG1
        sta t2
        jsr joy
        loc 0,6
        say s_j3
        lda PORTB
        sta t1
        lda TRIG0+2     ; $D012 = TRIG2
        sta t2
        jsr joy
        loc 0,7
        say s_pad
        ldx #0
pl1     stx t4
        lda POT0,x
        jsr puthex
        lda #' '
        jsr putc
        ldx t4
        inx
        cpx #4
        bne pl1
        loc 0,8
        say s_pad2
        ldx #4
pl2     stx t4
        lda POT0,x
        jsr puthex
        lda #' '
        jsr putc
        ldx t4
        inx
        cpx #8
        bne pl2
        loc 0,9
        lda cnt
        cmp tot
        bcs rdone
        say s_prog
        ldx #9
        lda #0
        jmp bar
rdone   say s_pass
        ldx #9
        lda #2
        jmp bar

; quit: restore the OS screen and cursor and return to DOS.
quit    jsr gs_off
        lda #0
        sta CRSINH
        rts

; joy: print "UDLR F" for one stick. t1 low nibble = U D L R (bit set = released, 0 = pressed),
; t2 = trigger (0 = pressed). A pressed direction shows its letter, a released one '-'.
; jb: A = letter, X = mask; prints the letter if (t1 & mask) = 0. Clobbers A, X, Y, t3.
joy     lda #'U'
        ldx #1
        jsr jb
        lda #'D'
        ldx #2
        jsr jb
        lda #'L'
        ldx #4
        jsr jb
        lda #'R'
        ldx #8
        jsr jb
        lda #' '
        jsr putc
        lda #'F'
        ldx t2
        beq jf
        lda #'-'
jf      jmp putc
jb      stx t3
        pha
        lda t1
        and t3
        beq jp
        pla
        lda #'-'
        jmp putc
jp      pla
        jmp putc

s_title .byte 'KEYTEST  visual keyboard / joysticks / paddles',0
s_leg   .byte 'grey=untested yellow=down green=tested',0
s_kb    .byte 'KBCODE $',0
s_sk    .byte '  SKSTAT $',0
s_cnt   .byte 'KEYS TESTED: ',0
s_j1    .byte 'JOY1 UDLR FIRE: ',0
s_j2    .byte 'JOY2 UDLR FIRE: ',0
s_j3    .byte 'JOY3 UDLR FIRE (400/800): ',0
s_pad   .byte 'PADDLE 0-3: ',0
s_pad2  .byte 'PADDLE 4-7: ',0
s_prog  .byte 'RESULT: testing - press every key     ',0
s_pass  .byte 'RESULT: PASS - every key was seen     ',0
s_hint  .byte 'Hold START+SELECT+OPTION to exit',0
        run start
