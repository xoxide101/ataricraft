; 5x7 bar font, 6px pitch: A = ascii; draws at col on the row in rs
drawchar6
 cmp #128
 bcc d60
 lda #32
d60 sec
 sbc #32
 bcs d61
 lda #0
d61 sta gp
 lda #0
 sta gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 lda gp+1
 clc
 adc #>BFNT
 sta gp+1
 lda #0
 sta lft
 lda style
 and #8
 beq d6n
 lda col
 beq d6n
 inc lft
d6n lda col
 asl
 clc
 adc col
 ldx lft
 beq d6o
 sec
 sbc #1
d6o pha
 lsr
 lsr
 clc
 adc rs
 sta sp
 lda rs+1
 adc #0
 sta sp+1
 pla
 and #3
 asl
 ldx lft
 beq d6p
 clc
 adc #1
d6p sta shf
 lda #$FC
 ldx lft
 beq d6q
 lda #$FE
d6q sta mh
 lda #0
 sta ml
 ldx shf
 beq d63
d62 lsr mh
 ror ml
 dex
 bne d62
d63 lda mh
 eor #$FF
 sta mh
 lda ml
 eor #$FF
 sta ml
 lda #0
 sta ry
d64 ldy ry
 lda (gp),y
 sta v
 lda style
 and #1
 beq d65
 lda v
 lsr
 ora v
 and #$FC
 sta v
d65 lda style
 and #2
 beq d66
 ldy ry
 cpy #4
 bcs d66
 lsr v
d66 lda style
 and #4
 beq d67
 ldy ry
 cpy #7
 bne d67
 lda #$FC
 sta v
d67 lda style
 and #8
 beq d68
 lda lft
 beq d67a
 lsr v
 lda v
 eor #$FE
 sta v
 jmp d68
d67a lda v
 eor #$FC
 sta v
d68 lda v
 sta hi
 lda #0
 sta lo
 ldx shf
 beq d6a
d69 lsr hi
 ror lo
 dex
 bne d69
d6a ldy #0
 lda (sp),y
 and mh
 ora hi
 sta (sp),y
 iny
 lda (sp),y
 and ml
 ora lo
 sta (sp),y
 lda sp
 clc
 adc #40
 sta sp
 bcc d6b
 inc sp+1
d6b inc ry
 lda ry
 cmp #8
 beq d6c
 jmp d64
d6c rts

; Pixel-graphics text for the menu bar and item line.
; Codes: 1 = selected-name box, 4 = hotkey box (both inverse; they cancel when nested),
; 3 = underline. Glyphs use proportional widths with a 1px gap.
pxtext
 lda #0
 sta px
 sta px+1
 sta i1
 sta i2
 sta ug
pt1 ldy #0
 lda (tp),y
 beq ptend
 cmp #13
 beq ptend
 cmp #5
 bcs ptchr
 cmp #3
 beq ptul
 ldx #0
 cmp #1
 bne pt4
 lda mhl
 bne pttog
 beq ptul
pt4 cmp #4
 bne ptnext
 ldx #1
pttog lda i1,x
 eor #1
 sta i1,x
 lda i1
 eor i2
 beq ptp0
 lda #$FF
ptp0 jsr putcol
 jsr pxinc
 jmp ptnext
ptul lda ug
 eor #1
 sta ug
ptnext inc16 tp
 jmp pt1
ptend rts

ptchr cmp #128
 bcc pc0
 lda #32
pc0 sec
 sbc #32
 bcs pc1
 lda #0
pc1 sta gp
 lda #0
 sta gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 lda gp+1
 clc
 adc #>BFNT
 sta gp+1
 ldy #7
 lda #0
pcw1 ora (gp),y
 dey
 bpl pcw1
 and #$F8
 sta cv
 bne pcwn
 ldx #3
 jmp pcw3
pcwn ldx #5
pcw2 lda cv
 and #8
 bne pcw3
 lsr cv
 dex
 bne pcw2
pcw3 stx gw
 ldx #0
 stx cx
pcl ldx cx
 cpx gw
 bne pcg
 lda #0
 jmp pcu
pcg lda bm8,x
 sta ck
 ldy #0
pcr lda (gp),y
 and ck
 cmp #1
 rol cv
 iny
 cpy #8
 bne pcr
 lda cv
pcu sta cv
 lda ug
 beq pci
 lda cv
 ora #1
 sta cv
pci lda i1
 eor i2
 beq pcp
 lda cv
 eor #$FF
 sta cv
pcp lda cv
 jsr putcol
 jsr pxinc
 inc cx
 ldx cx
 cpx gw
 beq pcl
 bcc pcl
 jmp ptnext

pxinc
 inc px
 bne pxi1
 inc px+1
pxi1 rts

; A = 8-pixel column bitmap (bit 7 = top scanline) drawn at pixel px on the row in rs
putcol
 sta cv
 lda px+1
 lsr
 lda px
 ror
 lsr
 lsr
 cmp #40
 bcs pcrt
 clc
 adc rs
 sta sp
 lda rs+1
 adc #0
 sta sp+1
 lda px
 and #7
 tax
 lda bm8,x
 sta tbm
 eor #$FF
 sta tbi
 ldx #8
 ldy #0
pcl1 asl cv
 bcc pcc
 lda (sp),y
 ora tbm
 jmp pcwr
pcc lda (sp),y
 and tbi
pcwr sta (sp),y
 lda sp
 clc
 adc #40
 sta sp
 bcc pcn
 inc sp+1
pcn dex
 bne pcl1
pcrt rts

bm8 dta b($80),b($40),b($20),b($10),b($08),b($04),b($02),b($01)

su_d = *
 org SUA4
mksh
 ldx #0
ms1 txa
 and #$1F
 asl
 asl
 asl
 sta hi
 lda #0
 sta lo
 txa
 lsr
 lsr
 lsr
 lsr
 lsr
 tay
 beq ms3
ms2 lsr hi
 ror lo
 dey
 bne ms2
ms3 lda hi
 sta SHH,x
 lda lo
 sta SHL,x
 inx
 bne ms1
 rts

mkfont
 ldx #0
 lda #<FNT
 sta dst
 lda #>FNT
 sta dst+1
mf1 ldy #0
 lda f4_0,x
 sta (dst),y
 iny
 lda f4_1,x
 sta (dst),y
 iny
 lda f4_2,x
 sta (dst),y
 iny
 lda f4_3,x
 sta (dst),y
 iny
 lda f4_4,x
 sta (dst),y
 iny
 lda f4_5,x
 sta (dst),y
 iny
 lda f4_6,x
 sta (dst),y
 iny
 lda #0
 sta (dst),y
 lda dst
 clc
 adc #8
 sta dst
 bcc mf2
 inc dst+1
mf2 inx
 cpx #96
 bne mf1
 rts
 org su_d

