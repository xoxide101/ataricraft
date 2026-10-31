; midread.inc - plays a standard MIDI file (.mid, format 0 or 1, up to 8 tracks) straight from BUF on the Atari.
; Same voice rules as tools/midiconv.cjs: 4 pure-tone voices (oldest stolen), channel 10 = noise drums (3 frames),
; velocity -> volume, tempo changes followed, 60 Hz frames. prepfile recognises 'MThd', records the track
; chunks and rewrites the first 4 bytes to the PMD magic so the shell's file check passes; ismid then selects this player.

tp      = $A0           ; track read pointer
cx      = $A2           ; current track
ms      = $A3           ; status byte
d1      = $A4
d2      = $A5
v0      = $A6           ; vlq result / chunk length
v1      = $A7
ndone   = $A8
nt      = $A9           ; tracks used
bu0     = $AA           ; microsecond budget (24 bit)
bu1     = $AB
bu2     = $AC
tui0    = $AD           ; microseconds per mtick (16 bit)
tui1    = $AE
tm0     = $AF           ; tempo, microseconds per quarter note (24 bit)
tm1     = $B0
tm2     = $B1
dvl     = $B2           ; time division
dvh     = $B3
agec    = $B4
ismid   = $B5
dv0     = $B6           ; divide work
dv1     = $B7
dv2     = $B8
rm0     = $B9
rm1     = $BA
rm2     = $BB
ch0     = $BC
vol     = $BD
fv      = $BE
cv      = $BF
best    = $C0
bage    = $C1
nf      = $C2
pg0     = $C3
pg1     = $C4
pf0     = $C5
pf1     = $C6

tsl     .byte 0,0,0,0,0,0,0,0
tsh     .byte 0,0,0,0,0,0,0,0
tel     .byte 0,0,0,0,0,0,0,0
teh     .byte 0,0,0,0,0,0,0,0
tcl     .byte 0,0,0,0,0,0,0,0
tch     .byte 0,0,0,0,0,0,0,0
tw0     .byte 0,0,0,0,0,0,0,0
tw1     .byte 0,0,0,0,0,0,0,0
tdn     .byte 0,0,0,0,0,0,0,0
trs     .byte 0,0,0,0,0,0,0,0
vn      .byte 255,255,255,255
vc      .byte 0,0,0,0
va      .byte 0,0,0,0
vd      .byte 0,0,0,0

        icl 'pitch.inc'

prepfile jmp pfs
pq      rts
pfs      lda #0
        sta ismid
        sta nf
        lda BUF
        cmp #'M'
        bne pq
        lda BUF+1
        cmp #'T'
        bne pq
        lda BUF+2
        cmp #'h'
        bne pq
        lda BUF+3
        cmp #'d'
        bne pq
        lda BUF+12
        bmi pq
        sta dvh
        lda BUF+13
        sta dvl
        ora dvh
        beq pq
        lda BUF+10
        bne pq8
        lda BUF+11
        cmp #9
        bcc pq9
pq8     lda #8
pq9     sta nt
        lda #<(BUF+14)
        sta tp
        lda #>(BUF+14)
        sta tp+1
pw1     lda tp+1
        cmp #>(BUFTOP-8)
        bcs pw9
        ldy #4
        lda (tp),y
        iny
        ora (tp),y
        bne pw9
        iny
        lda (tp),y
        sta v1
        iny
        lda (tp),y
        sta v0
        clc
        lda tp
        adc #8
        sta pg0
        lda tp+1
        adc #0
        sta pg1
        clc
        lda pg0
        adc v0
        sta pf0
        lda pg1
        adc v1
        sta pf1
        bcs pw9
        cmp #$B9
        bcs pw9
        ldy #0
        lda (tp),y
        cmp #'M'
        bne pw2
        ldy #2
        lda (tp),y
        cmp #'r'
        bne pw2
        ldx nf
        lda pg0
        sta tsl,x
        lda pg1
        sta tsh,x
        lda pf0
        sta tel,x
        lda pf1
        sta teh,x
        inc nf
        lda nf
        cmp nt
        bcs pw9
pw2     lda pf0
        sta tp
        lda pf1
        sta tp+1
        jmp pw1
pw9     lda nf
        bne pw8
        jmp pq
pw8
        sta nt
        lda #'P'
        sta BUF
        lda #'M'
        sta BUF+1
        lda #'D'
        sta BUF+2
        lda #1
        sta BUF+3
        sta ismid

; --- reading
rdb     ldy #0
        lda (tp),y
        inc tp
        bne rb1
        inc tp+1
rb1     rts

vlq     lda #0
        sta v0
        sta v1
vq1     jsr rdb
        pha
        ldx #7
vq2     asl v0
        rol v1
        dex
        bne vq2
        pla
        pha
        and #$7F
        ora v0
        sta v0
        pla
        bmi vq1
        rts

skipv   clc
        lda tp
        adc v0
        sta tp
        lda tp+1
        adc v1
        sta tp+1
        rts

; --- tempo: mtick length in microseconds = tempo / division
div24   lda #0
        sta rm0
        sta rm1
        sta rm2
        ldx #24
dv_l    asl dv0
        rol dv1
        rol dv2
        rol rm0
        rol rm1
        rol rm2
        lda rm2
        bne dv_s
        lda rm1
        cmp dvh
        bcc dv_n
        bne dv_s
        lda rm0
        cmp dvl
        bcc dv_n
dv_s    sec
        lda rm0
        sbc dvl
        sta rm0
        lda rm1
        sbc dvh
        sta rm1
        lda rm2
        sbc #0
        sta rm2
        inc dv0
dv_n    dex
        bne dv_l
        rts

settempo lda tm0
        sta dv0
        lda tm1
        sta dv1
        lda tm2
        sta dv2
        jsr div24
        lda dv2
        beq st_a
        lda #$FF
        sta dv0
        sta dv1
st_a    lda dv0
        ora dv1
        bne st_b
        lda #1
        sta dv0
st_b    lda dv0
        sta tui0
        lda dv1
        sta tui1
        rts

; --- voices (X = voice 0-3, fv = AUDF, cv = AUDC)
setv    txa
        asl
        tay
        lda route
        and #1
        beq sv1
        lda fv
        sta AUDF1,y
        lda cv
        sta AUDC1,y
sv1     lda route
        and #2
        beq sv2
        lda fv
        sta R_AUDF1,y
        lda cv
        sta R_AUDC1,y
sv2     rts

silx    lda #0
        sta cv
        jmp setv

noteoff lda ms
        and #$0F
        sta ch0
        ldx #3
nf1     lda vn,x
        cmp d1
        bne nf2
        lda vc,x
        cmp ch0
        bne nf2
        lda #$FF
        sta vn,x
        jmp silx
nf2     dex
        bpl nf1
        rts

noteon  lda ms
        and #$0F
        sta ch0
        lda d2
        clc
        adc #4
        lsr
        lsr
        lsr
        cmp #16
        bcc nv1
        lda #15
nv1     sta vol
        lda ch0
        cmp #9
        bne ton
        jmp drum
ton     lda vol
        cmp #3
        bcs nv2
        lda #3
nv2     ora #$A0
        sta cv
        lda d1
nt1     cmp #47
        bcs nt2
        clc
        adc #12
        jmp nt1
nt2     cmp #109
        bcc nt3
        sec
        sbc #12
        jmp nt2
nt3     sec
        sbc #47
        tax
        lda ptab,x
        sta fv
        ldx #3
pk1     lda vn,x
        cmp #$FF
        beq pk9
        dex
        bpl pk1
        lda #$FF
        sta best
        ldx #3
st1     lda vn,x
        cmp #$FE
        beq st3
        lda agec
        sec
        sbc va,x
        ldy best
        cpy #$FF
        beq st2
        cmp bage
        bcc st3
        beq st3
st2     sta bage
        stx best
st3     dex
        bpl st1
        ldx best
        cpx #$FF
        beq pkx
pk9     lda d1
        sta vn,x
        lda ch0
        sta vc,x
        inc agec
        lda agec
        sta va,x
        lda #0
        sta vd,x
        jmp setv
pkx     rts

drum    ldx #3
dr1l    lda vn,x
        cmp #$FF
        beq dr2l
        dex
        bpl dr1l
        rts
dr2l    lda vol
        cmp #4
        bcs dr3
        lda #4
dr3     ora #$80
        sta cv
        lda d1
        ldy #150
        cmp #37
        bcc dn
        ldy #60
        cmp #41
        bcc dn
        ldy #12
        cmp #45
        bcc dn
        ldy #30
dn      sty fv
        lda #$FE
        sta vn,x
        lda #3
        sta vd,x
        jmp setv

decay   ldx #3
dc1     lda vd,x
        beq dc2
        dec vd,x
        bne dc2
        lda #$FF
        sta vn,x
        jsr silx
dc2     dex
        bpl dc1
        rts

; --- one track: run every event whose wait is zero
trkrun  ldx cx
        lda tdn,x
        beq tr0
        rts
tr0     lda tcl,x
        sta tp
        lda tch,x
        sta tp+1
tr1     ldx cx
        lda tw0,x
        ora tw1,x
        beq tr1b
        jmp trsave
tr1b
        lda tp+1
        cmp teh,x
        bcc tr2
        beq tr1c
        jmp trend
tr1c    lda tp
        cmp tel,x
        bcc tr2
        jmp trend
tr2     jsr rdb
        sta ms
        lda ms
        bmi tr3
        lda tp
        bne tr2a
        dec tp+1
tr2a    dec tp
        ldx cx
        lda trs,x
        bmi tr2b
        jmp trend
tr2b    sta ms
        jmp tr4
tr3     cmp #$F0
        bcs tmeta
        ldx cx
        sta trs,x
tr4     lda ms
        and #$F0
        cmp #$C0
        beq t1b
        cmp #$D0
        beq t1b
        jsr rdb
        sta d1
        jsr rdb
        sta d2
        lda ms
        and #$F0
        cmp #$90
        beq tnon
        cmp #$80
        bne tdel
        jsr noteoff
        jmp tdel
tnon    lda d2
        bne tnon2
        jsr noteoff
        jmp tdel
tnon2   jsr noteon
        jmp tdel
t1b     jsr rdb
tdel    jsr vlq
        ldx cx
        lda v0
        sta tw0,x
        lda v1
        sta tw1,x
        jmp tr1
tmeta   lda ms
        cmp #$FF
        beq tmf
        jsr vlq
        jsr skipv
        jmp tdel
tmf     jsr rdb
        sta d1
        jsr vlq
        lda d1
        cmp #$2F
        bne tmn
        jmp trend
tmn
        cmp #$51
        bne tmskip
        lda v0
        cmp #3
        bne tmskip
        jsr rdb
        sta tm2
        jsr rdb
        sta tm1
        jsr rdb
        sta tm0
        jsr settempo
        jmp tdel
tmskip  jsr skipv
        jmp tdel
trsave  lda tp
        sta tcl,x
        lda tp+1
        sta tch,x
        rts
trend   ldx cx
        lda #1
        sta tdn,x
        inc ndone
        rts

mtick    ldx #0
tk1     stx cx
        lda tdn,x
        bne tk3
        lda tw0,x
        ora tw1,x
        beq tk2
        lda tw0,x
        bne tk4
        dec tw1,x
tk4     dec tw0,x
tk2     jsr trkrun
tk3     ldx cx
        inx
        cpx nt
        bcc tk1
        rts

mplay   jsr silence
        ldx #3
mp1     lda #$FF
        sta vn,x
        lda #0
        sta vd,x
        dex
        bpl mp1
        sta agec
        sta ndone
        sta bu0
        sta bu1
        sta bu2
        lda #$20
        sta tm0
        lda #$A1
        sta tm1
        lda #$07
        sta tm2
        jsr settempo
        ldx #0
mp2     stx cx
        lda tsl,x
        sta tcl,x
        sta tp
        lda tsh,x
        sta tch,x
        sta tp+1
        lda #0
        sta tdn,x
        sta trs,x
        jsr vlq
        ldx cx
        lda v0
        sta tw0,x
        lda v1
        sta tw1,x
        lda tp
        sta tcl,x
        lda tp+1
        sta tch,x
        jsr trkrun
        ldx cx
        inx
        cpx nt
        bcc mp2
        lda #$FF
        sta CH
mfr     jsr vsync
        jsr decay
        clc
        lda bu0
        adc #<16667
        sta bu0
        lda bu1
        adc #>16667
        sta bu1
        lda bu2
        adc #0
        sta bu2
mtk     lda bu2
        bne mt1
        lda bu1
        cmp tui1
        bcc mkey
        bne mt1
        lda bu0
        cmp tui0
        bcc mkey
mt1     sec
        lda bu0
        sbc tui0
        sta bu0
        lda bu1
        sbc tui1
        sta bu1
        lda bu2
        sbc #0
        sta bu2
        jsr mtick
        jmp mtk
mkey    lda ndone
        cmp nt
        bcs mend
        lda CH
        cmp #$FF
        beq mfr
        sta t2
        lda #$FF
        sta CH
mend    rts
