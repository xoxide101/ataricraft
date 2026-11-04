; BANKMON - resident extended-RAM bank monitor for the Ataricraft Inspector.
; Hooks the deferred vertical blank vector. When the host asks, it maps one 16 KB extended bank into $4000-$7FFF,
; waits (inside the VBI, across frames) while the host reads or writes that window, then restores PORTB and carries on.
; The host (inspect.js) drives it through the mailbox below. Assembled at two bases so the host can relocate it.
        opt h-
        .ifndef BASE
BASE    = $0600
        .endif
        org BASE
req     .byte 0         ; +0  host sets 1 = hold a bank, 2 = probe all PORTB combinations
pb      .byte 0         ; +1  PORTB value to select for a hold
st      .byte 0         ; +2  0 idle, 1 holding, 2 probe finished
rel     .byte 0         ; +3  host sets 1 to release a hold
sav     .byte 0         ; +4  PORTB before the hold
old     .word 0         ; +5  previous deferred VBI vector
magic   .byte $B7       ; +7
tmp     .byte 0         ; +8
        .rept 7 \ .byte 0 \ .endr           ; pad to +$10
ctab    .rept 64 \ .byte 0 \ .endr          ; +$10 PORTB value per combination (host fills)
sv      .rept 64 \ .byte 0 \ .endr          ; +$50 saved byte per combination
res     .rept 64 \ .byte 0 \ .endr          ; +$90 probe result: 1 = this combination owns a distinct bank
vbi     lda req
        beq chain
        lda st
        bne chain
        lda $D301
        sta sav
        lda req
        cmp #2
        beq doprobe
        lda #1
        sta st
        lda #0
        sta req
        sta rel
        lda pb
        sta $D301
hold    lda rel
        beq hold
        lda sav
        sta $D301
        lda #0
        sta st
chain   jmp (old)
doprobe lda #0
        sta req
        ldx #0
p0      lda ctab,x
        sta $D301
        lda $4000
        sta sv,x
        inx
        cpx #64
        bne p0
        ldx #0
p1      lda ctab,x
        sta $D301
        txa
        sta $4000
        inx
        cpx #64
        bne p1
        ldx #0
p2      lda ctab,x
        sta $D301
        lda $4000
        stx tmp
        cmp tmp
        bne p2n
        lda #1
        bne p2s
p2n     lda #0
p2s     sta res,x
        inx
        cpx #64
        bne p2
        ldx #0
p3      lda ctab,x
        sta $D301
        lda sv,x
        sta $4000
        inx
        cpx #64
        bne p3
        lda sav
        sta $D301
        lda #2
        sta st
        jmp chain
end
