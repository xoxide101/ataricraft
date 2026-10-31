; player.inc - shared shell for MIDIPLAY.COM and MP3PLAY.COM (needs common.inc first, MADS).
; The including program defines: s_title (zero-terminated), s_kind (zero-terminated), magic (4 bytes), and doplay
; (plays the file in BUF; returns when it ends or a key is pressed; keeps interrupts as it found them).
; Flow: ask for a file name, load it to BUF, check the 4-byte magic, then L / R / B pick the output (left POKEY,
; right POKEY, both), SPACE plays, N loads another file, ESC exits to DOS.
AUDF1   = $D200
AUDC1   = $D201
AUDCTL  = $D208
SKCTL   = $D20F
R_AUDF1 = $D210
R_AUDC1 = $D211
R_SKCTL = $D21F
R_RANDOM= $D21A
SDMCTL  = $022F
DMACTL  = $D400
BUF     = $4000
BUFTOP  = $B800

pp      = $90
wt      = $92

        .macro loc
        ldx #:1
        ldy #:2
        jsr locate
        .endm
        .macro say
        lda #<:1
        ldy #>:1
        jsr puts
        .endm

start   lda #1
        sta CRSINH
        lda #3
        sta route
        jsr detect
        jsr silence
newfile lda #$7D
        jsr eput
        lda #<s_title
        ldy #>s_title
        jsr eprint
        lda #$9B
        jsr eput
        lda #<s_ask
        ldy #>s_ask
        jsr eprint
        jsr getname
        bcs quit
        jsr loadfile
        bcc ldok
        jsr showerr
        jmp newfile
ldok    jsr draw
mloop   jsr getkey
        cmp #$1C
        beq quit
        cmp #$23
        bne mk1
        jmp newfile
mk1     cmp #$00
        bne mk2
        lda #1
        bne setr
mk2     cmp #$28
        bne mk3
        lda #2
        bne setr
mk3     cmp #$15
        bne mk4
        lda #3
setr    sta route
        jsr draw
        jmp mloop
mk4     cmp #$21
        bne mloop
        loc 0,14
        say s_playing
        jsr doplay
        jsr silence
        loc 0,14
        say s_done
        jmp mloop
quit    jsr silence
        lda #$7D
        jsr eput
        lda #0
        sta CRSINH
        rts

; A/Y = address of an EOL ($9B) terminated string -> screen editor
eprint  sta sa
        sty sa+1
        ldy #0
ep1     lda (sa),y
        beq ep2
        iny
        cmp #$9B
        bne ep1
ep2     sty ICBLL
        lda #0
        sta ICBLH
        lda sa
        sta ICBAL
        lda sa+1
        sta ICBAH
        lda #9
        sta ICCOM
        ldx #0
        jmp CIOV

; read a line, build path (EOL terminated, "D:" added when there is no device) and dname (zero terminated)
; carry set = blank line
getname lda #5
        sta ICCOM
        lda #<fname
        sta ICBAL
        lda #>fname
        sta ICBAH
        lda #60
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV
        lda fname
        cmp #$9B
        beq gnblank
        ldy #0
gn1     lda fname,y
        cmp #$9B
        beq gn2
        cmp #':'
        beq gn3
        iny
        bne gn1
gn2     lda #'D'
        sta path
        sta dname
        lda #':'
        sta path+1
        sta dname+1
        ldx #2
        bne gn4
gn3     ldx #0
gn4     ldy #0
gn5     lda fname,y
        cmp #$9B
        beq gn6
        sta path,x
        sta dname,x
        inx
        iny
        bne gn5
gn6     lda #$9B
        sta path,x
        lda #0
        sta dname,x
        clc
        rts
gnblank sec
        rts

; load path into BUF; carry set = error (ioerr = CIO status, 0 = wrong file type, 1 = too big)
loadfile ldx #$10
        lda #3
        sta ICCOM,x
        lda #<path
        sta ICBAL,x
        lda #>path
        sta ICBAH,x
        lda #4
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        jsr CIOV
        bpl lf1
        sty ioerr
        sec
        rts
lf1     ldx #$10
        lda #7
        sta ICCOM,x
        lda #<BUF
        sta ICBAL,x
        lda #>BUF
        sta ICBAH,x
        lda #<(BUFTOP-BUF)
        sta ICBLL,x
        lda #>(BUFTOP-BUF)
        sta ICBLH,x
        jsr CIOV
        sty ioerr
        ldx #$10
        lda ICBLL,x
        sta size
        lda ICBLH,x
        sta size+1
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda ioerr
        cmp #1
        beq lf2
        cmp #136
        bne lferr
lf2     lda size+1
        cmp #>(BUFTOP-BUF)
        bcc lf3
        lda #1
        sta ioerr
        sec
        rts
lf3     lda size+1
        bne lf4
        lda size
        cmp #8
        bcc lfbad
lf4     ldx #3
lf5     lda BUF,x
        cmp magic,x
        bne lfbad
        dex
        bpl lf5
        clc
        rts
lfbad   lda #0
        sta ioerr
lferr   sec
        rts

showerr loc 0,8
        lda ioerr
        bne se1
        say s_bad
        jmp se9
se1     cmp #1
        bne se2
        say s_big
        jmp se9
se2     say s_ioerr
        lda ioerr
        jsr puthex
se9     loc 0,10
        say s_any
        jsr getkey
        rts

draw    lda #$7D
        jsr eput
        loc 0,0
        say s_title
        loc 0,2
        say s_file
        say dname
        loc 0,3
        say s_size
        lda size
        sta v16
        lda size+1
        sta v16+1
        jsr putdec
        say s_bytes
        loc 0,4
        say s_kind
        loc 0,6
        say s_route
        lda route
        asl
        tax
        lda rtab,x
        ldy rtab+1,x
        jsr puts
        loc 0,7
        lda stereo
        beq dr1
        say s_st
        jmp dr2
dr1     say s_mono
dr2     loc 0,9
        say s_k1
        loc 0,10
        say s_k2
        loc 0,11
        say s_k3
        loc 0,12
        say s_k4
        rts

; ---- POKEY helpers
silence ldx #7
        lda #0
        sta AUDCTL
si1     sta AUDF1,x
        sta R_AUDF1,x
        dex
        bpl si1
        lda #3
        sta SKCTL
        lda stereo
        beq si2
        sta R_SKCTL
si2     rts

; stereo present when POKEY #2 runs its own random generator while #1 is held in init mode
detect  lda #0
        sta stereo
        lda #0
        ldx #3
        jsr dprobe
        lda t3
        bne dB
        lda t4
        bne dyes
dB      lda #3
        ldx #0
        jsr dprobe
        lda t4
        bne dend
        lda t3
        beq dend
dyes    lda #1
        sta stereo
dend    lda #3
        sta SKCTL
        sta R_SKCTL
        rts

dprobe  sei
        sta SKCTL
        stx R_SKCTL
        lda #0
        sta t3
        sta t4
        ldx #30
dl1     dex
        bne dl1
        lda RANDOM
        sta t1
        lda R_RANDOM
        sta t2
        ldx #0
dl2     ldy #20
dl3     dey
        bne dl3
        lda RANDOM
        cmp t1
        beq dl4
        inc t3
dl4     lda R_RANDOM
        cmp t2
        beq dl5
        inc t4
dl5     inx
        cpx #8
        bne dl2
        cli
        rts

route   .byte 3
stereo  .byte 0
ioerr   .byte 0
size    .word 0
fname   .ds 64
path    .ds 64
dname   .ds 64
rtab    .word 0,r1,r2,r3
r1      .byte 'LEFT only (POKEY 1)',0
r2      .byte 'RIGHT only (POKEY 2)',0
r3      .byte 'BOTH (left and right)',0
s_ask   .byte 'File (D1:NAME.EXT, blank = exit)',$9B
s_file  .byte 'File:   ',0
s_size  .byte 'Size:   ',0
s_bytes .byte ' bytes',0
s_route .byte 'Output: ',0
s_st    .byte 'POKEY 2 found: stereo',0
s_mono  .byte 'Mono machine: L, R and B sound the same',0
s_k1    .byte 'L  left only',0
s_k2    .byte 'R  right only',0
s_k3    .byte 'B  both',0
s_k4    .byte 'SPACE play (any key stops)  N new file  ESC exit',0
s_playing .byte 'Playing...                    ',0
s_done  .byte 'Done.                          ',0
s_bad   .byte 'Not a valid file for this player.',0
s_big   .byte 'File too big for memory.',0
s_ioerr .byte 'DOS error $',0
s_any   .byte 'Press a key',0
