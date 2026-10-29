; KEYTEST.COM - visual keyboard: every key is a block that is grey (untested), yellow (held down) or green
; (has been pressed). SHIFT, CTRL, START/SELECT/OPTION and BREAK are included. Joysticks and paddles are read
; out below. PASS when every key has been seen. Hold START+SELECT+OPTION together to exit.
        org $2000
NA      = 3
NMAP    = 6
NB      = 8
        jmp start
        icl 'common.inc'
        icl 'cscreen.inc'

cnt     .byte 0
tot     .byte 0
cur     .byte $FF
shp     .byte 0
ctp     .byte 0
pst     .byte 0
pv      .byte 0,0,0,0
cbit    .byte 1,2,4,$80
ccl     .byte 95,96,97,98
st      .ds 100
ktab    .ds 64

; key code, cell
kdef    .byte $1C,0, $1F,1, $1E,2, $1A,3, $18,4, $1D,5, $1B,6, $33,7, $35,8, $30,9, $32,10, $36,11, $37,12, $34,13
        .byte $03,15, $04,16, $13,17, $14,18, $11,19
        .byte $2C,20, $2F,21, $2E,22, $2A,23, $28,24, $2D,25, $2B,26, $0B,27, $0D,28, $08,29, $0A,30, $0E,31, $0F,32, $0C,33
        .byte $3F,41, $3E,42, $3A,43, $38,44, $3D,45, $39,46, $01,47, $05,48, $00,49, $02,50, $06,51, $07,52, $3C,53
        .byte $17,61, $16,62, $12,63, $10,64, $15,65, $23,66, $25,67, $20,68, $22,69, $26,70, $27,71
        .byte $21,83
        .byte $FF

start   lda #$7D
        jsr eput
        lda #1
        sta CRSINH
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
        sta tot
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
kt9     ldx #83
kt4     lda #1
        jsr mapset
        inx
        cpx #92
        bcc kt4
        lda #60
        sta t4
        ldx #60
        lda #1
        jsr mapset
        ldx #72
        lda #1
        jsr mapset
        ldx #40
        lda #1
        jsr mapset
        ldx #95
kt5     lda #1
        jsr mapset
        inx
        cpx #99
        bcc kt5
        loc 0,10
        say s_hint

loop    lda #0
        sta ATRACT
        jsr vsync
        sta POTGO
        lda CONSOL
        and #7
        bne lp0
        jmp quit
lp0     jsr keys
        jsr mods
        jsr cons
        jsr readout
        jmp loop

; main key block: yellow while held, green after release
keys    lda SKSTAT
        and #4
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

mods    lda SKSTAT
        and #8
        beq sh1
        lda SKSTAT
        and #4
        bne sh0
        lda KBCODE
        and #$40
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
        bpl ct0
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

cons    ldx #3
cn1     stx t4
        cpx #3
        beq cnb
        lda CONSOL
        jmp cnc
cnb     lda IRQST
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

; X = cell: mark tested, colour green
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
; X = cell, A = state; the space bar is nine cells wide
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
        lsr
        lsr
        lsr
        lsr
        sta t1
        lda TRIG0+1
        sta t2
        jsr joy
        loc 0,6
        say s_j3
        lda PORTB
        sta t1
        lda TRIG0+2
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

quit    jsr gs_off
        lda #0
        sta CRSINH
        rts

; t1 low nibble = U D L R (0 = pressed), t2 = trigger (0 = pressed)
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
