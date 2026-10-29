; GFXTEST.COM - steps through OS graphics modes 0-15, filling screen RAM with a counter pattern. Any key = next, ESC = exit.
        org $2000
        jmp start
        icl 'common.inc'

IOCB6   = $60
mode    = $8C
cnt     = $8D           ; 16-bit fill count
pat     = $8F

start   lda #0
        sta mode
next    jsr openmode
        jsr fill
        jsr label
        jsr getkey
        cmp #$1C
        beq done
        inc mode
        lda mode
        cmp #16
        bcc next
done    lda #0
        sta mode
        jsr openmode
        lda #$7D
        jmp eput

openmode ldx #IOCB6
        lda #12
        sta ICCOM,x
        jsr CIOV
        ldx #IOCB6
        lda #3
        sta ICCOM,x
        lda #<scr
        sta ICBAL,x
        lda #>scr
        sta ICBAL+1,x
        lda #$1C
        sta ICAX1,x
        lda mode
        sta ICAX2,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        lda #1
        sta CRSINH
        lda #$94
        sta $02C6
        lda #$0F
        sta $02C5
        lda #$94
        sta $02C8
        rts
fill    ldx mode
        lda szlo,x
        sta cnt
        lda szhi,x
        sta cnt+1
        lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        lda mode
        bne f0
        lda sp
        clc
        adc #120
        sta sp
        bcc f00
        inc sp+1
f00     sec
        lda cnt
        sbc #120
        sta cnt
        lda cnt+1
        sbc #0
        sta cnt+1
f0      lda #0
        sta pat
        ldy #0
f1      lda pat
        sta (sp),y
        inc pat
        inc sp
        bne f2
        inc sp+1
f2      lda cnt
        bne f3
        dec cnt+1
f3      dec cnt
        lda cnt
        ora cnt+1
        bne f1
        rts

; print the mode's description through E:
label   ldx mode
        lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        lda mode
        beq lb0
        lda $0294
        sta sp
        lda $0295
        sta sp+1
lb0     lda ltab,x
        pha
        lda ltab+16,x
        tay
        pla
        jmp puts

scr     .byte 'S:',155
szlo    .byte <960,<400,<200,<200,<400,<800,<1600,<3200,<6400,<6400,<6400,<6400,<800,<400,<3200,<6400
szhi    .byte >960,>400,>200,>200,>400,>800,>1600,>3200,>6400,>6400,>6400,>6400,>800,>400,>3200,>6400
ltab    .byte <l0,<l1,<l2,<l3,<l4,<l5,<l6,<l7,<l8,<l9,<l10,<l11,<l12,<l13,<l14,<l15
        .byte >l0,>l1,>l2,>l3,>l4,>l5,>l6,>l7,>l8,>l9,>l10,>l11,>l12,>l13,>l14,>l15
l0      .byte 'GR.0  text 40x24, 2 colours (ANTIC 2)',0
l1      .byte 'GR.1  text 20x24, 5 colours',0
l2      .byte 'GR.2  text 20x12, 5 colours',0
l3      .byte 'GR.3  40x24, 4 colours',0
l4      .byte 'GR.4  80x48, 2 colours',0
l5      .byte 'GR.5  80x48, 4 colours',0
l6      .byte 'GR.6  160x96, 2 colours',0
l7      .byte 'GR.7  160x96, 4 colours',0
l8      .byte 'GR.8  320x192, 2 colours',0
l9      .byte 'GR.9  GTIA 80x192, 16 luminances',0
l10     .byte 'GR.10 GTIA 80x192, 9 colours',0
l11     .byte 'GR.11 GTIA 80x192, 16 hues',0
l12     .byte 'GR.12 text 40x24, 5 colours (ANTIC 4)',0
l13     .byte 'GR.13 text 40x12, 5 colours (ANTIC 5)',0
l14     .byte 'GR.14 160x192, 2 colours (XL/XE)',0
l15     .byte 'GR.15 160x192, 4 colours (XL/XE)',0
        run start

