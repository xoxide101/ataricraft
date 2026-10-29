; Multi-program boot menu: 6 boot sectors at $0700, directory in sectors 7-13 (36 entries x 24 bytes), programs from sector 14.
; Entry: name[16] ASCII space padded, start sector (u16), length (u24). Keys 1-9,0 then A-Z pick an entry.
; Needs no DOS. buildMenuAtr() in diskconv.js patches the entry count at $0709.
        opt h-
        org $0700
        .byte 0,6
        .word $0700,$0706
        jmp start
count   .byte 0

buf     = $0A00
V       = $0A80
cnt     = V
bpos    = V+3
secl    = V+4
sech    = V+5
lo      = V+6
hi      = V+7
elo     = V+8
ehi     = V+9
len     = V+10
dbl     = V+13
dbh     = V+14
idx     = V+15
ndir    = V+16
line    = V+32
table   = $0B00
ptr     = $E0
tp      = $E2

start   cld
        lda #7
        sta secl
        lda #0
        sta sech
        sta $02e0
        sta $02e1
        sta $02e2
        sta $02e3
        lda #<table
        sta dbl
        lda #>table
        sta dbh
        lda #7
        sta ndir
ld1     jsr rdsec
        lda dbl
        clc
        adc #128
        sta dbl
        bcc ld2
        inc dbh
ld2     dec ndir
        bne ld1

        lda #<title
        sta $0344
        lda #>title
        sta $0345
        lda #22
        jsr put

        lda #0
        sta idx
        lda #<table
        sta tp
        lda #>table
        sta tp+1
ml      lda idx
        cmp count
        bcs mdone
        cmp #9
        bcc k1
        beq k0
        clc
        adc #'A'-10
        jmp kset
k1      clc
        adc #'1'
        jmp kset
k0      lda #'0'
kset    sta line
        lda #' '
        sta line+1
        ldy #15
cn      lda (tp),y
        sta line+2,y
        dey
        bpl cn
        lda #$9b
        sta line+18
        lda #<line
        sta $0344
        lda #>line
        sta $0345
        lda #19
        jsr put
        lda tp
        clc
        adc #24
        sta tp
        bcc nt
        inc tp+1
nt      inc idx
        jmp ml

mdone   lda #3
        sta $0352
        lda #<kname
        sta $0354
        lda #>kname
        sta $0355
        lda #4
        sta $035a
        lda #0
        sta $035b
        ldx #$10
        jsr $e456
gk      lda #7
        sta $0352
        lda #0
        sta $0358
        sta $0359
        ldx #$10
        jsr $e456
        cmp #'a'
        bcc g1
        sbc #$20
g1      cmp #'0'
        bcc gk
        cmp #'9'+1
        bcs g2
        cmp #'0'
        beq g0
        sec
        sbc #'1'
        jmp gok
g0      lda #9
        jmp gok
g2      cmp #'A'
        bcc gk
        cmp #'Z'+1
        bcs gk
        sec
        sbc #'A'-10
gok     cmp count
        bcs gk
        sta idx
        lda #12
        sta $0352
        ldx #$10
        jsr $e456

        lda #<table
        sta tp
        lda #>table
        sta tp+1
        ldx idx
        beq gotp
tpl     lda tp
        clc
        adc #24
        sta tp
        bcc tp2
        inc tp+1
tp2     dex
        bne tpl
gotp    ldy #16
        lda (tp),y
        sta secl
        iny
        lda (tp),y
        sta sech
        iny
        lda (tp),y
        sta len
        iny
        lda (tp),y
        sta len+1
        iny
        lda (tp),y
        sta len+2
        lda #0
        sta cnt
        sta cnt+1
        sta cnt+2
        lda #128
        sta bpos
        lda #<buf
        sta dbl
        lda #>buf
        sta dbh

main    lda cnt
        cmp len
        lda cnt+1
        sbc len+1
        lda cnt+2
        sbc len+2
        bcs done
        jsr getb
        sta lo
        jsr getb
        sta hi
        and lo
        cmp #$ff
        beq main
        jsr getb
        sta elo
        jsr getb
        sta ehi
        lda lo
        sta ptr
        lda hi
        sta ptr+1
cp      jsr getb
        ldy #0
        sta (ptr),y
        lda ptr
        cmp elo
        bne nx
        lda ptr+1
        cmp ehi
        beq segend
nx      inc ptr
        bne cp
        inc ptr+1
        jmp cp
segend  lda lo
        cmp #$e2
        bne main
        lda hi
        cmp #2
        bne main
        lda elo
        cmp #$e3
        bne main
        jsr doinit
        jmp main

doinit  jmp ($02e2)

done    lda $02e0
        ora $02e1
        beq nrun
        jmp ($02e0)
nrun    jmp ($000a)

getb    ldx bpos
        cpx #128
        bcc gb1
        jsr rdsec
        ldx #0
gb1     lda buf,x
        inx
        stx bpos
        inc cnt
        bne gb2
        inc cnt+1
        bne gb2
        inc cnt+2
gb2     rts

put     sta $0348
        lda #0
        sta $0349
        lda #9
        sta $0342
        ldx #0
        jmp $e456

rdsec   lda #$31
        sta $0300
        lda #1
        sta $0301
        lda #$52
        sta $0302
        lda #$40
        sta $0303
        lda dbl
        sta $0304
        lda dbh
        sta $0305
        lda #7
        sta $0306
        lda #128
        sta $0308
        lda #0
        sta $0309
        lda secl
        sta $030a
        lda sech
        sta $030b
        jsr $e459
        bmi rerr
        inc secl
        bne rok
        inc sech
rok     rts
rerr    inc $d01a
        jmp rdsec

kname   .byte 'K:',$9b
title   .byte 'ATARICRAFT GAME MENU',$9b,$9b
