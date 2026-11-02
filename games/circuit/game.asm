; Circuit Runner demo: ONE (robot) and TASK (robot Pomeranian). SELECT swaps who you control.
; Screen: ANTIC mode 4, three bands scrolling at 1/4, 1/2 and full speed (DLI sets HSCROL and colours per band).
; Rows live at $4000 + row*$200 (256 columns plus 44 repeated), so a coarse scroll is just a new LMS low byte.
; Puzzle: ONE stands on plate A while TASK crawls through the vent to plate B. Both pressed (AND) latches the door open.
WSYNC  = $D40A
HSCROL = $D404
CHBASE = $D409
COLPF0 = $D016
COLPF1 = $D017
COLPF2 = $D018
COLPF3 = $D019
COLBK  = $D01A
HPOSP0 = $D000
dl     = $3E00
hud    = $3E80

wxl   = $80
wxh   = $81
anim  = $88
oldy  = $8B
oldd  = $8C
hs1   = $8D
hs2   = $8E
hs3   = $8F
dlin  = $90
cxl   = $91
cxh   = $92
t1    = $93
t2    = $94
row   = $95
colf  = $96
colm  = $97
coln  = $98
src   = $9C
dst   = $9E
tptr  = $A0
txl   = $A2
txh   = $A3
tyy   = $A4
nxl   = $A5
nxh   = $A6
dirv  = $A7
istk  = $A8
ifir  = $A9
ctl   = $AA
selp  = $AB
gate  = $AC
t3    = $AD
t4    = $AE
pla   = $AF
plb   = $B0
; actor tables, index 0 = ONE, 1 = TASK
axl   = $0600
axh   = $0602
ayl   = $0604
ayh   = $0606
avl   = $0608
avh   = $060A
agd   = $060C
afc   = $060E
amv   = $0610
aac   = $0612
aht   = $0614

        org $2000
start   lda #0
        sta $D40E
        sta $022F
        sta $D400
        lda #<dli
        sta $0200
        lda #>dli
        sta $0201
        lda #<vbi
        sta $0224
        lda #>vbi
        sta $0225
        lda #<dl
        sta $0230
        lda #>dl
        sta $0231
        lda #$38
        sta $02F4
        lda farpal+0
        sta $02C4
        lda farpal+1
        sta $02C5
        lda farpal+2
        sta $02C6
        lda farpal+3
        sta $02C7
        lda farpal+4
        sta $02C8
        lda plpal+0
        sta $02C0
        lda plpal+1
        sta $02C1
        lda plpal+2
        sta $02C2
        lda plpal+3
        sta $02C3
        lda #$80
        sta $D407
        lda #3
        sta $D01D
        lda #1
        sta $026F
        ldx #0
        lda #0
clr     sta $8400,x
        sta $8500,x
        sta $8600,x
        sta $8700,x
        inx
        bne clr
        sta hs3
        sta anim
        sta oldy
        sta oldd
        sta ctl
        sta gate
        sta afc
        sta afc+1
        sta amv
        sta amv+1
        sta aac
        sta aac+1
        lda #2
        sta selp
        lda #16
        sta aht
        lda #8
        sta aht+1
        ldx #0
        jsr respawn
        ldx #1
        jsr respawn
        lda #$3E
        sta $022F
        lda #$C0
        sta $D40E
main    jmp main

respawn txa
        asl a
        asl a
        asl a
        asl a
        clc
        adc #64
        sta axl,x
        lda #0
        sta axh,x
        sta ayl,x
        sta avl,x
        sta avh,x
        sta agd,x
        lda #100
        sta ayh,x
        rts

; Reads the tile id at world pixel (txh:txl, tyy). Near band rows only, else 0.
tile    lda tyy
        sec
        sbc #32
        bcc tzero
        lsr a
        lsr a
        lsr a
        sta row
        cmp #12
        bcc tzero
        cmp #23
        bcs tzero
        asl a
        clc
        adc #$40
        sta tptr+1
        lda txh
        asl a
        asl a
        asl a
        asl a
        asl a
        asl a
        sta t3
        lda txl
        lsr a
        lsr a
        ora t3
        sta tptr
        ldy #0
        lda (tptr),y
        and #$7F
        rts
tzero   lda #0
        rts

; Tile ids 19 (block) and 20 (door) stop movement from every side.
fullsol cmp #19
        beq fsy
        cmp #20
        beq fsy
        clc
        rts
fsy     sec
        rts

; Landing: ground top (11), platforms (13-15), block and door.
topsol  cmp #19
        beq tsy
        cmp #20
        beq tsy
        cmp #11
        bcc tsn
        cmp #12
        beq tsn
        cmp #16
        bcs tsn
tsy     sec
        rts
tsn     clc
        rts

; Move actor X two pixels in dirv (1 right, $FF left) unless a solid tile is in the way.
hmove   lda dirv
        bmi hl
        clc
        lda axl,x
        adc #2
        sta nxl
        lda axh,x
        adc #0
        and #3
        sta nxh
        clc
        lda nxl
        adc #7
        sta txl
        lda nxh
        adc #0
        and #3
        sta txh
        jmp hchk
hl      sec
        lda axl,x
        sbc #2
        sta nxl
        lda axh,x
        sbc #0
        and #3
        sta nxh
        lda nxl
        sta txl
        lda nxh
        sta txh
hchk    lda ayh,x
        sta tyy
        jsr tile
        jsr fullsol
        bcs hblk
        lda ayh,x
        clc
        adc #7
        sta tyy
        jsr tile
        jsr fullsol
        bcs hblk
        lda ayh,x
        clc
        adc aht,x
        sec
        sbc #1
        sta tyy
        jsr tile
        jsr fullsol
        bcs hblk
        lda nxl
        sta axl,x
        lda nxh
        sta axh,x
hblk    rts

; Gravity, fall, respawn and landing for actor X.
vphys   clc
        lda avl,x
        adc #$20
        sta avl,x
        lda avh,x
        adc #0
        sta avh,x
        bmi vok
        cmp #6
        bcc vok
        lda #6
        sta avh,x
        lda #0
        sta avl,x
vok     clc
        lda ayl,x
        adc avl,x
        sta ayl,x
        lda ayh,x
        adc avh,x
        sta ayh,x
        cmp #224
        bcc inr
        jmp respawn
inr     lda #0
        sta agd,x
        lda avh,x
        bmi vret
        lda ayh,x
        clc
        adc aht,x
        sta tyy
        sec
        sbc #32
        and #7
        cmp #7
        bcs vret
        lda axl,x
        clc
        adc #1
        sta txl
        lda axh,x
        adc #0
        and #3
        sta txh
        jsr tile
        jsr topsol
        bcs land
        lda axl,x
        clc
        adc #6
        sta txl
        lda axh,x
        adc #0
        and #3
        sta txh
        jsr tile
        jsr topsol
        bcc vret
land    lda row
        asl a
        asl a
        asl a
        clc
        adc #32
        sec
        sbc aht,x
        sta ayh,x
        lda #0
        sta ayl,x
        sta avl,x
        sta avh,x
        lda #1
        sta agd,x
vret    rts

; One actor's turn using istk (joystick bits) and ifir (0 = fire held).
act     lda #0
        sta amv,x
        lda istk
        and #4
        bne a1
        lda #$FF
        sta dirv
        jsr hmove
        lda #1
        sta afc,x
        sta amv,x
a1      lda istk
        and #8
        bne a2
        lda #1
        sta dirv
        jsr hmove
        lda #0
        sta afc,x
        lda #1
        sta amv,x
a2      lda agd,x
        beq a3
        lda ifir
        bne a3
        lda #$FC
        sta avh,x
        lda #$D0
        sta avl,x
        lda #0
        sta agd,x
a3      jsr vphys
        lda amv,x
        beq a4
        inc aac,x
a4      rts

; Carry set when actor X stands on tile A.
onplate sta t4
        lda agd,x
        beq opno
        lda axl,x
        clc
        adc #4
        sta txl
        lda axh,x
        adc #0
        and #3
        sta txh
        lda ayh,x
        clc
        adc aht,x
        sec
        sbc #1
        sta tyy
        jsr tile
        cmp t4
        bne opno
        sec
        rts
opno    clc
        rts

opendoor lda #DOORR0
        sta row
od1     asl a
        clc
        adc #$40
        sta tptr+1
        lda #DOORCOL
        sta tptr
        lda #0
        ldy #0
        sta (tptr),y
        iny
        sta (tptr),y
        inc row
        lda row
        cmp #DOORR1
        bne od1
        lda #$97
        sta LEDADR
        rts

; hpos of actor X relative to the camera (wxl/wxh); 0 hides it
hpos    sec
        lda axl,x
        sbc wxl
        sta t3
        lda axh,x
        sbc wxh
        and #3
        beq hpp
        cmp #3
        bne hph
        lda t3
        cmp #206
        bcc hph
        bcs hpo
hpp     lda t3
        cmp #108
        bcs hph
hpo     lda t3
        clc
        adc #100
        rts
hph     lda #0
        rts

vbi     lda #0
        sta dlin
        sta $4D
        lda $D01F
        and #2
        tay
        bne sw0
        lda selp
        beq sw0
        lda ctl
        eor #1
        sta ctl
sw0     sty selp
        ldx #0
av      cpx ctl
        beq ac
        lda #$0F
        ldy #1
        bne ai
ac      lda $0278
        ldy $0284
ai      sta istk
        sty ifir
        jsr act
        inx
        cpx #2
        bne av

; plates and the AND gate
        ldx #0
        lda #21
        jsr onplate
        lda #0
        rol a
        sta pla
        ldx #1
        lda #22
        jsr onplate
        lda #0
        rol a
        sta plb
        lda #21
        ldy pla
        beq pa1
        ora #$80
pa1     sta PA0
        sta PA1
        lda #22
        ldy plb
        beq pb1
        ora #$80
pb1     sta PB0
        sta PB1
        lda gate
        bne nog
        lda pla
        and plb
        beq nog
        lda #1
        sta gate
        jsr opendoor
nog

; who is controlled, shown on the status line
        lda ctl
        asl a
        asl a
        tax
        ldy #0
hn      lda nm,x
        sta hud+NAMEOFF,y
        inx
        iny
        cpy #4
        bne hn

; camera follows the controlled actor
        ldx ctl
        lda axl,x
        sta wxl
        lda axh,x
        sta wxh
        sec
        lda wxl
        sbc #52
        sta cxl
        lda wxh
        sbc #0
        and #3
        sta cxh
        lda cxl
        sta t1
        lda cxh
        lsr a
        ror t1
        lsr a
        ror t1
        lda t1
        sta coln
        lda cxl
        and #3
        eor #3
        sta hs2
        lda cxl
        sta t1
        lda cxh
        lsr a
        ror t1
        lsr a
        ror t1
        lsr a
        ror t1
        lda t1
        sta colm
        lda cxl
        lsr a
        and #3
        eor #3
        sta hs1
        lda cxl
        sta t1
        lda cxh
        lsr a
        ror t1
        lsr a
        ror t1
        lsr a
        ror t1
        lsr a
        ror t1
        lda t1
        sta colf
        lda cxl
        lsr a
        lsr a
        and #3
        eor #3
        sta HSCROL
        ldy #4
        ldx #6
        lda colf
lp1     sta dl,y
        iny
        iny
        iny
        dex
        bne lp1
        ldx #6
        lda colm
lp2     sta dl,y
        iny
        iny
        iny
        dex
        bne lp2
        ldx #11
        lda coln
lp3     sta dl,y
        iny
        iny
        iny
        dex
        bne lp3

; sprites: clear old, draw new
        lda oldy
        sta dst
        lda #$84
        sta dst+1
        lda #0
        ldy #15
cl0     sta (dst),y
        dey
        bpl cl0
        inc dst+1
        ldy #15
cl1     sta (dst),y
        dey
        bpl cl1
        lda oldd
        sta dst
        lda #$86
        sta dst+1
        lda #0
        ldy #7
cl2     sta (dst),y
        dey
        bpl cl2
        inc dst+1
        ldy #7
cl3     sta (dst),y
        dey
        bpl cl3

        lda agd
        beq hair
        lda amv
        beq hid
        lda aac
        lsr a
        lsr a
        and #1
        clc
        adc #1
        bne hset
hid     lda #0
        beq hset
hair    lda #3
hset    sta anim
        lda afc
        asl a
        asl a
        clc
        adc anim
        asl a
        asl a
        asl a
        asl a
        sta t1
        lda ayh
        sta oldy
        sta dst
        lda #$84
        sta dst+1
        lda #<hp0
        clc
        adc t1
        sta src
        lda #>hp0
        adc #0
        sta src+1
        ldy #15
dh0     lda (src),y
        sta (dst),y
        dey
        bpl dh0
        inc dst+1
        lda #<hp1
        clc
        adc t1
        sta src
        lda #>hp1
        adc #0
        sta src+1
        ldy #15
dh1     lda (src),y
        sta (dst),y
        dey
        bpl dh1

        lda amv+1
        beq still
        lda aac+1
        lsr a
        lsr a
        and #1
still   sta t2
        lda afc+1
        asl a
        clc
        adc t2
        asl a
        asl a
        asl a
        sta t1
        lda ayh+1
        sta oldd
        sta dst
        lda #$86
        sta dst+1
        lda #<dp2
        clc
        adc t1
        sta src
        lda #>dp2
        adc #0
        sta src+1
        ldy #7
dd0     lda (src),y
        sta (dst),y
        dey
        bpl dd0
        inc dst+1
        lda #<dp3
        clc
        adc t1
        sta src
        lda #>dp3
        adc #0
        sta src+1
        ldy #7
dd1     lda (src),y
        sta (dst),y
        dey
        bpl dd1

        ldx #0
        jsr hpos
        sta HPOSP0
        sta HPOSP0+1
        ldx #1
        jsr hpos
        sta HPOSP0+2
        sta HPOSP0+3
        jsr music
        jmp $E462

nm      .byte 47,46,37,0,52,33,51,43

dli     pha
        txa
        pha
        ldx dlin
        lda hs1,x
        tay
        lda cbk,x
        sta WSYNC
        sty HSCROL
        sta COLBK
        lda cp0,x
        sta COLPF0
        lda cp1,x
        sta COLPF1
        lda cp2,x
        sta COLPF2
        lda cp3,x
        sta COLPF3
        cpx #2
        bne nohud
        lda #$E0
        sta CHBASE
nohud   inc dlin
        pla
        tax
        pla
        rti
