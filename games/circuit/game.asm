; Circuit Runner demo: parallax side scroller. Hero robot plus robot Pomeranian following.
; Screen: ANTIC mode 4, three bands scrolling at 1/4, 1/2 and full speed (DLI sets HSCROL and colours per band).
; Rows live at $4000 + row*$200 (256 columns plus 44 repeated), so a coarse scroll is just a new LMS low byte.
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

wxl   = $80
wxh   = $81
yl    = $82
yh    = $83
vyl   = $84
vyh   = $85
gnd   = $86
face  = $87
anim  = $88
acnt  = $89
mov   = $8A
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
hidx  = $99
dogx  = $9A
dogy  = $9B
src   = $9C
dst   = $9E
tptr  = $A0
histxl = $0600
histxh = $0620
histy  = $0640

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
        lda #$84
        sta $02C4
        lda #$96
        sta $02C5
        lda #$AC
        sta $02C6
        lda #$2E
        sta $02C7
        lda #$00
        sta $02C8
        lda #$9A
        sta $02C0
        lda #$0E
        sta $02C1
        lda #$2A
        sta $02C2
        lda #$9C
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
        sta mov
        sta anim
        sta acnt
        sta face
        sta oldy
        sta oldd
        jsr respawn
        lda #$3E
        sta $022F
        lda #$C0
        sta $D40E
main    jmp main

respawn lda #64
        sta wxl
        lda #0
        sta wxh
        sta yl
        sta vyl
        sta vyh
        sta gnd
        lda #100
        sta yh
        ldx #31
rh      lda wxl
        sta histxl,x
        lda wxh
        sta histxh,x
        lda yh
        sta histy,x
        dex
        bpl rh
        lda #0
        sta hidx
        rts

; A = sample offset into the hero; tptr = row base. Carry set if the tile is solid on top.
chk     clc
        adc wxl
        sta t1
        lda wxh
        adc #0
        lsr a
        ror t1
        lsr a
        ror t1
        ldy t1
        lda (tptr),y
        and #$7F
        cmp #11
        bcc nosol
        cmp #12
        beq nosol
        cmp #16
        bcs nosol
        sec
        rts
nosol   clc
        rts

vbi     lda #0
        sta dlin
        sta mov
        sta $4D
        lda $0278
        sta t1
        and #4
        bne nl
        sec
        lda wxl
        sbc #2
        sta wxl
        lda wxh
        sbc #0
        and #3
        sta wxh
        lda #1
        sta face
        sta mov
nl      lda t1
        and #8
        bne nr
        clc
        lda wxl
        adc #2
        sta wxl
        lda wxh
        adc #0
        and #3
        sta wxh
        lda #0
        sta face
        lda #1
        sta mov
nr      lda gnd
        beq nojump
        lda $0284
        bne nojump
        lda #$FC
        sta vyh
        lda #$D0
        sta vyl
        lda #0
        sta gnd
nojump  clc
        lda vyl
        adc #$20
        sta vyl
        lda vyh
        adc #0
        sta vyh
        bmi vok
        cmp #6
        bcc vok
        lda #6
        sta vyh
        lda #0
        sta vyl
vok     clc
        lda yl
        adc vyl
        sta yl
        lda yh
        adc vyh
        sta yh
        cmp #224
        bcc inr
        jsr respawn
inr     lda #0
        sta gnd
        lda vyh
        bmi noland
        lda yh
        clc
        adc #16
        sec
        sbc #32
        sta t2
        lsr a
        lsr a
        lsr a
        sta row
        cmp #12
        bcc noland
        cmp #23
        bcs noland
        lda t2
        and #7
        cmp #7
        bcs noland
        lda #0
        sta tptr
        lda row
        asl a
        clc
        adc #$40
        sta tptr+1
        lda #1
        jsr chk
        bcs land
        lda #6
        jsr chk
        bcc noland
land    lda row
        asl a
        asl a
        asl a
        clc
        adc #16
        sta yh
        lda #0
        sta yl
        sta vyl
        sta vyh
        lda #1
        sta gnd
noland  lda gnd
        bne ong
        lda #3
        bne seta
ong     lda mov
        bne mv
        lda #0
        beq seta
mv      inc acnt
        lda acnt
        lsr a
        lsr a
        and #1
        clc
        adc #1
seta    sta anim

; camera and scroll bands
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

; follow history for the dog
        ldx hidx
        lda wxl
        sta histxl,x
        lda wxh
        sta histxh,x
        lda yh
        sta histy,x
        txa
        clc
        adc #1
        and #31
        sta hidx
        clc
        adc #8
        and #31
        tax
        lda wxl
        sec
        sbc histxl,x
        sta t1
        lda histy,x
        clc
        adc #8
        sta dogy
        lda #100
        sec
        sbc t1
        ldx face
        beq dr
        clc
        adc #12
        jmp dsx
dr      sec
        sbc #12
dsx     sta dogx

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

        lda face
        asl a
        asl a
        clc
        adc anim
        asl a
        asl a
        asl a
        asl a
        sta t1
        lda yh
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

        lda mov
        beq still
        lda acnt
        lsr a
        lsr a
        and #1
still   sta t2
        lda face
        asl a
        clc
        adc t2
        asl a
        asl a
        asl a
        sta t1
        lda dogy
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

        lda #100
        sta HPOSP0
        sta HPOSP0+1
        lda dogx
        sta HPOSP0+2
        sta HPOSP0+3
        jmp $E462

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
