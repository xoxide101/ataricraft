; MP3PLAY.COM - plays a 4-bit sample file (.SMP, made from an mp3/wav by tools/audioconv.cjs) through POKEY's
; volume-only mode, to the left POKEY, the right POKEY or both. The Atari does not decode MP3 itself.
; The whole clip sits in RAM, so a clip is 4 to 12 seconds depending on the speed it was converted at.
        org $2000
        jmp start
        icl 'common.inc'
        icl 'player.inc'

; sample file layout: 'SMP',1, speed (scanlines per sample, 1-3), pages (256 bytes of packed nibbles), 0, 0, data
doplay  jmp dp1
pbad    rts
dp1     lda BUF+4
        beq pbad
        cmp #4
        bcs pbad
        sta spd
        lda BUF+5
        beq pbad
        sta pgs
        lda #$0F
        sta mL
        sta mR
        lda stereo
        beq pm1
        lda route
        and #1
        bne pm0
        sta mL
pm0     lda route
        and #2
        bne pm1
        sta mR
pm1     lda #<(BUF+8)
        sta pp
        lda #>(BUF+8)
        sta pp+1
        lda #$FF
        sta CH
pk0     lda SKSTAT
        and #4
        beq pk0
        sei
        lda #0
        sta NMIEN
        sta DMACTL
        ldy #0
pl1     lda (pp),y
        lsr
        lsr
        lsr
        lsr
        jsr emit
        lda (pp),y
        and #$0F
        jsr emit
        iny
        bne pl1
        inc pp+1
        lda SKSTAT
        and #4
        beq plend
        dec pgs
        bne pl1
plend   lda SDMCTL
        sta DMACTL
        lda #$40
        sta NMIEN
        cli
        lda #$FF
        sta CH
        rts

emit    sta t1
        and mL
        ora #$10
        sta AUDC1
        lda stereo
        beq em1
        lda t1
        and mR
        ora #$10
        sta R_AUDC1
em1     ldx spd
em2     sta WSYNC
        dex
        bne em2
        rts

spd     .byte 2
pgs     .byte 0
mL      .byte $0F
mR      .byte $0F
magic   .byte 'SMP',1
s_title .byte 'MP3PLAY  4-bit sample player (POKEY)',0
s_kind  .byte 'Type:   sample (.SMP from tools/audioconv.cjs)',0
        run start
