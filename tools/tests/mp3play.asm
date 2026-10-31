; MP3PLAY.COM - plays a 4-bit sample file (.SMP, made from an mp3/wav by tools/audioconv.cjs) through POKEY's
; volume-only mode, to the left POKEY, the right POKEY or both. The Atari does not decode MP3 itself.
; The whole clip sits in RAM, so a clip is 4 to 12 seconds depending on the speed it was converted at.
; It also accepts an 8-bit PCM .WAV directly: prepfile converts it to the .SMP layout in place.
;
; FORMATS / LIMITS
;   .SMP: 'SMP',1, speed, pages, channels, 0, then data from BUF+8. speed = scanlines per sample (1..3, i.e.
;   about 15.7 / 7.9 / 5.2 kHz); pages = number of 256-byte pages of data (1..255); channels 0 or 1 = mono,
;   2 = stereo. Mono: two samples per byte, high nibble first. Stereo: one frame per byte, left = high nibble,
;   right = low nibble. Samples are 4-bit volumes 0..15.
;   .WAV: RIFF/WAVE, PCM, 8-bit, mono or stereo, 44-byte header; no resampling (speed is only chosen from the rate).
; MEMORY: code at $2000 (RUN start); file or converted sample in BUF $4000..$B7FF (player.inc), sample data at
;   BUF+8, header at BUF..BUF+7.
; ZERO PAGE: pp ($90-$91) = sample read pointer (player.inc); wsp ($94-$95) = WAV source pointer, wdp ($96-$97)
;   = SMP destination pointer, wcnt ($98-$99) = WAV pairs left to convert; t1 ($88) = scratch (common.inc).
; CONNECTIONS: player.inc calls doplay (SPACE) and prepfile (after load) here and uses magic/s_title/s_kind;
;   this file uses player.inc's route (bit0 = left, bit1 = right), stereo, size, AUDC1/R_AUDC1/DMACTL/SDMCTL and
;   common.inc's WSYNC, SKSTAT, NMIEN, CH.
        org $2000
        jmp start       ; start is in player.inc
        icl 'common.inc'
        icl 'player.inc'

; sample file layout: 'SMP',1, speed (scanlines per sample, 1-3), pages (256 bytes),
; channels (0 or 1 = mono, 2 = stereo), 0, data
; mono: packed nibbles, high nibble first. stereo: one frame per byte, left nibble high, right nibble low.
;
; doplay - play the .SMP in BUF. Validates speed (1..3) and pages (<>0), builds the channel masks mL/mR
; ($0F = pass, 0 = mute; only when a second POKEY exists, route bit 0 / bit 1), waits until no key is held, then
; plays with interrupts and ANTIC DMA off so WSYNC timing is exact: per sample AUDC = $10 | volume ($10 = POKEY
; volume-only "forced output" bit, so the level is the digital value), then spd WSYNCs (spd scanlines).
; A key press is checked once per 256 data bytes; it ends playback. Restores DMA/NMI, CH = $FF on return.
; Clobbers A,X,Y,pp,pgs,spd,mL,mR,t1.
doplay  jmp dp1
pbad    rts             ; bad header: nothing to play
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
        beq pm1         ; mono machine: both masks stay open
        lda route
        and #1
        bne pm0
        sta mL          ; A = 0: mute left
pm0     lda route
        and #2
        bne pm1
        sta mR          ; A = 0: mute right
pm1     lda #<(BUF+8)
        sta pp
        lda #>(BUF+8)
        sta pp+1
        lda #$FF
        sta CH
pk0     lda SKSTAT
        and #4          ; SKSTAT bit 2 = 0 while a key is held; wait for release
        beq pk0
        sei
        lda #0
        sta NMIEN       ; no VBI/DLI
        sta DMACTL      ; ANTIC DMA off: no cycle stealing, stable timing
        ldy #0
        lda BUF+6
        cmp #2
        bne pl1         ; channels <> 2: mono loop
; stereo loop: one byte = one frame (left high nibble, right low nibble)
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
        beq pl3         ; no second POKEY: right channel is dropped
        sta R_AUDC1
pl3     ldx spd
pl4     sta WSYNC       ; one scanline (~63.5 us) per pass
        dex
        bne pl4
        iny
        bne pl2
        inc pp+1        ; next page
        lda SKSTAT
        and #4
        beq plend       ; key pressed
        dec pgs
        bne pl2
        beq plend       ; always taken (Z set)
; mono loop: high nibble then low nibble, both to the selected side(s)
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
plend   lda SDMCTL      ; restore ANTIC DMA from its OS shadow
        sta DMACTL
        lda #$40        ; NMIEN: VBI on, DLI off (OS default)
        sta NMIEN
        cli
        lda #$FF
        sta CH
        rts

; emit: play one 4-bit sample (A = 0..15) on the selected side(s), then hold it for spd scanlines.
; Uses mL/mR masks; right side only when a second POKEY exists. Clobbers A,X,t1.
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

; playback state: spd = scanlines per sample, pgs = pages left, mL/mR = channel masks ($0F pass, 0 mute)
spd     .byte 2
pgs     .byte 0
mL      .byte $0F
mR      .byte $0F
; WAV conversion state (zero-page pointers above): wchn = channels, wspd = chosen speed,
; wmhi:wmlo = number of output bytes (the data length, before page padding)
wsp     = $94
wdp     = $96
wcnt    = $98
wchn    .byte 1
wspd    .byte 2
wmlo    .byte 0
wmhi    .byte 0

; prepfile - 8-bit PCM .WAV (mono or stereo, 44-byte header) -> .SMP in place: top nibble of each byte, packed in pairs.
; Mono pairs two samples; stereo pairs left and right, which is exactly the stereo .SMP layout. Anything else is
; left alone and fails the magic check. Speed is picked from the sample rate (about 15.7, 7.9 or 5.2 kHz).
; In: BUF = file, size = its length. Out: BUF = .SMP (or unchanged). Clobbers A,X,Y,t1,wsp,wdp,wcnt,w*.
; Checks: 'RI'.. 'W'(AVE) at +8, format 1 (PCM) at +20, channels 1/2 at +22, 8 bits at +34. Speed from the
; sample-rate byte at +25 (bits 8-15 of the rate): >= $2B (~11 kHz) -> 1, >= $1A (~6.6 kHz) -> 2, else 3.
; Conversion is safe in place because the destination (BUF+8, 1 byte per 2) never overtakes the source (BUF+44).
prepfile jmp pf0
pfq     rts             ; shared bail-out (branch range)
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
        sec             ; wcnt = (size - 44) / 2 = output bytes
        lda size
        sbc #44
        sta wcnt
        lda size+1
        sbc #0
        sta wcnt+1
        bcc pfq         ; shorter than the header
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
pfl     ldy #0          ; out byte = (src[0] & $F0) | (src[1] >> 4)
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
pfp     lda wdp         ; pad the last page with $88 (mid level) up to the next BUF+8 page boundary
        cmp #8
        beq pfh
        lda #$88
        ldy #0
        sta (wdp),y
        inc wdp
        bne pfp
        inc wdp+1
        bne pfp
pfh     lda wmhi        ; pages = wmhi, +1 if there is a partial page
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
        lda #1          ; header: 'SMP',1, speed, pages, channels, 0
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
