; MIDIPLAY.COM - plays a POKEY music file (.PMD, made from a .mid by tools/midiconv.cjs): 4 pure-tone voices
; (more than 4 notes at once are stolen), noise for drums. Output goes to the left POKEY, the right POKEY or both.
; The Atari does not read .mid itself. Timing is by frame (60 Hz NTSC; a PAL machine plays it a little slow).
        org $2000
        jmp start
        icl 'common.inc'
        icl 'player.inc'

; music file layout: 'PMD',1, then 3-byte records: frames to wait, register 0-7 (AUDF1,AUDC1,AUDF2,...), value.
; Register $FE = nothing (long waits), $FF = end of song.
doplay  jsr silence
        lda #<(BUF+4)
        sta pp
        lda #>(BUF+4)
        sta pp+1
        ldy #0
        lda (pp),y
        sta wt
        lda #$FF
        sta CH
frame   jsr vsync
tick    lda wt
        beq apply
        dec wt
        lda CH
        cmp #$FF
        beq frame
        sta t2
        lda #$FF
        sta CH
        rts
apply   ldy #1
        lda (pp),y
        cmp #$FF
        beq pend
        cmp #$FE
        beq next
        tax
        iny
        lda (pp),y
        sta t1
        lda route
        and #1
        beq nl
        lda t1
        sta AUDF1,x
nl      lda route
        and #2
        beq next
        lda t1
        sta R_AUDF1,x
next    clc
        lda pp
        adc #3
        sta pp
        bcc nx1
        inc pp+1
nx1     ldy #0
        lda (pp),y
        sta wt
        jmp tick
pend    rts

magic   .byte 'PMD',1
s_title .byte 'MIDIPLAY  POKEY music player',0
s_kind  .byte 'Type:   music (.PMD from tools/midiconv.cjs)',0
        run start
