; MIDIPLAY.COM - plays POKEY music: either a .PMD file (made from a .mid by tools/midiconv.cjs) or a standard
; .mid (format 0/1) read directly on the Atari by midread.inc. 4 pure-tone voices (more than 4 notes at once are
; stolen), noise for drums. Output goes to the left POKEY, the right POKEY or both.
; Timing is by frame (60 Hz NTSC; a PAL machine plays it a little slow).
;
; MEMORY: code at $2000 (RUN start); file in BUF $4000..$B7FF (player.inc); .PMD data is played in place.
; ZERO PAGE here: pp ($90, 2 bytes) = read pointer into the .PMD record stream, wt ($92) = frames left before
;   the next record (both from player.inc); t1 ($88) = value to write, t2 ($89) = key code that stopped play
;   (common.inc). midread.inc uses $A0..$C6.
; CONNECTIONS: player.inc (start, UI, route, silence, prepfile hook, vsync/getkey via common.inc) calls doplay
;   here; doplay branches on ismid (set by midread.inc's prepfile) to mplay (midread.inc) or pmdplay below.
;   This file supplies magic/s_title/s_kind required by player.inc.
        org $2000
        jmp start       ; the real entry is player.inc's start, included after common.inc's code
        icl 'common.inc'
        icl 'player.inc'

; music file layout: 'PMD',1, then 3-byte records: frames to wait, register 0-7 (AUDF1,AUDC1,AUDF2,...), value.
; Register $FE = nothing (long waits), $FF = end of song.
        icl 'midread.inc'

; doplay - called by the shell on SPACE. Returns at end of song or on a key (code left in t2, CH cleared).
doplay  lda ismid
        beq pmdplay
        jmp mplay
; pmdplay: pp walks the records from BUF+4. For each record: wait wt frames (one vsync per frame, polling
; the key), then store value into AUDFn/AUDCn (offset X = register) on the routed side(s), step 3 bytes and
; read the next wait. Clobbers A,X,Y,pp,wt,t1,t2.
pmdplay jsr silence
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
        lda CH          ; $FF = no key pressed
        cmp #$FF
        beq frame
        sta t2
        lda #$FF
        sta CH
        rts
apply   ldy #1
        lda (pp),y
        cmp #$FF        ; end of song
        beq pend
        cmp #$FE        ; no-op record (just a wait)
        beq next
        tax
        iny
        lda (pp),y
        sta t1
        lda route
        and #1          ; bit 0 = left POKEY ($D200)
        beq nl
        lda t1
        sta AUDF1,x
nl      lda route
        and #2          ; bit 1 = right POKEY ($D210)
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
