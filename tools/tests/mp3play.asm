; MP3PLAY.COM - plays a 4-bit sample file (.SMP, made from an mp3/wav by tools/audioconv.cjs) through POKEY's
; volume-only mode, to the left POKEY, the right POKEY or both. The Atari does not decode MP3 itself.
; The whole clip sits in RAM, so a clip is 4 to 12 seconds depending on the speed it was converted at.
        org $2000
        jmp start
        icl 'common.inc'
        icl 'player.inc'

; sample file layout: 'SMP',1, speed (scanlines per sample, 1-3), pages (256 bytes), channels (0 or 1 = mono, 2 = stereo), 0, data
; mono: packed nibbles, high nibble first. stereo: one frame per byte, left nibble high, right nibble low.
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
        lda BUF+6
        cmp #2
        bne pl1
pl2     lda (pp),y
        lsr
        lsr
        lsr
        lsr
        and mL
        ora #$10
        sta AUDC1
        lda (pp),y
        and mR
        and #$0F
        ora #$10
        ldx stereo
        beq pl3
        sta R_AUDC1
pl3     ldx spd
pl4     sta WSYNC
        dex
        bne pl4
        iny
        bne pl2
        inc pp+1
        lda SKSTAT
        and #4
        beq plend
        dec pgs
        bne pl2
        beq plend
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
wsp     = $94
wdp     = $96
wcnt    = $98
wchn    .byte 1
wspd    .byte 2
wmlo    .byte 0
wmhi    .byte 0

; 8-bit PCM .WAV (mono or stereo, 44-byte header) -> .SMP in place: top nibble of each byte, packed in pairs.
; Mono pairs two samples; stereo pairs left and right, which is exactly the stereo .SMP layout. Anything else is
; left alone and fails the magic check. Speed is picked from the sample rate (about 15.7, 7.9 or 5.2 kHz).
prepfile jmp pf0
pfq     rts
pf0     lda BUF
        cmp #'R'
        bne pfq
        lda BUF+1
        cmp #'I'
        bne pfq
        lda BUF+8
        cmp #'W'
        bne pfq
        lda BUF+20
        cmp #1
        bne pfq
        lda BUF+34
        cmp #8
        bne pfq
        lda BUF+22
        cmp #1
        beq pf1
        cmp #2
        bne pfq
pf1     sta wchn
        lda BUF+25
        cmp #$2B
        bcs pfs1
        cmp #$1A
        bcs pfs2
        lda #3
        bne pf2
pfs1    lda #1
        bne pf2
pfs2    lda #2
pf2     sta wspd
        sec
        lda size
        sbc #44
        sta wcnt
        lda size+1
        sbc #0
        sta wcnt+1
        bcc pfq
        lsr wcnt+1
        ror wcnt
        lda wcnt
        ora wcnt+1
        beq pfq
        lda wcnt
        sta wmlo
        lda wcnt+1
        sta wmhi
        lda #<(BUF+44)
        sta wsp
        lda #>(BUF+44)
        sta wsp+1
        lda #<(BUF+8)
        sta wdp
        lda #>(BUF+8)
        sta wdp+1
pfl     ldy #0
        lda (wsp),y
        and #$F0
        sta t1
        iny
        lda (wsp),y
        lsr
        lsr
        lsr
        lsr
        ora t1
        ldy #0
        sta (wdp),y
        inc wdp
        bne pfa
        inc wdp+1
pfa     clc
        lda wsp
        adc #2
        sta wsp
        bcc pfb
        inc wsp+1
pfb     lda wcnt
        bne pfc
        dec wcnt+1
pfc     dec wcnt
        lda wcnt
        ora wcnt+1
        bne pfl
pfp     lda wdp
        cmp #8
        beq pfh
        lda #$88
        ldy #0
        sta (wdp),y
        inc wdp
        bne pfp
        inc wdp+1
        bne pfp
pfh     lda wmhi
        ldx wmlo
        beq pfh1
        clc
        adc #1
pfh1    sta BUF+5
        lda #'S'
        sta BUF
        lda #'M'
        sta BUF+1
        lda #'P'
        sta BUF+2
        lda #1
        sta BUF+3
        lda wspd
        sta BUF+4
        lda wchn
        sta BUF+6
        lda #0
        sta BUF+7
        rts
magic   .byte 'SMP',1
s_title .byte 'MP3PLAY  4-bit sample player (POKEY)',0
s_kind  .byte 'Type:   sample (.SMP from tools/audioconv.cjs)',0
        run start
