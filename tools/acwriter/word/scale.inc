PWt dta b(3),b(5),b(8),b(10),b(13),b(15)
ST = $9C00

; build the horizontal stretch tables: for each size 1..6 and 5-bit cell, a left-aligned 16-bit pixel word
mkst ldx #1
mst1 stx szh
 lda PWt-1,x
 sta pit
 txa
 sec
 sbc #1
 ldy #0
 sty stp
 lsr
 ror stp
 lsr
 ror stp
 clc
 adc #>ST
 sta stp+1
 lda stp
 clc
 adc #32
 sta stq
 lda stp+1
 adc #0
 sta stq+1
 lda #0
 sta zvi
mst2 lda #0
 sta zw0
 sta zw1
 ldx pit
 dex
 stx zti
mst3 lda zti
 asl
 asl
 clc
 adc zti
 ldx #0
mst4 cmp pit
 bcc mst5
 sbc pit
 inx
 bne mst4
mst5 stx ztq
 lda #4
 sec
 sbc ztq
 tax
 lda zvi
mst6 cpx #0
 beq mst7
 lsr
 dex
 jmp mst6
mst7 lsr
 ror zw0
 ror zw1
 dec zti
 bpl mst3
 ldy zvi
 lda zw0
 sta (stp),y
 lda zw1
 sta (stq),y
 inc zvi
 lda zvi
 cmp #32
 bne mst2
 ldx szh
 inx
 cpx #7
 bne mst1
 rts

; A = width in cells; sets pit, avl/avh (pixels), returns A = characters that fit
szcap sta zbx
 lda #0
 sta avh
 lda zbx
 asl
 rol avh
 asl
 rol avh
 clc
 adc zbx
 bcc szc1
 inc avh
szc1 sta avl
 lda pwi
 sec
 sbc #24
 sta szh
 tax
 lda PWt-1,x
 sta pit
 lda avl
 sta zw0
 lda avh
 sta zw1
 ldx #0
szc2 lda zw0
 sec
 sbc pit
 tay
 lda zw1
 sbc #0
 bcc szc3
 sta zw1
 sty zw0
 inx
 bne szc2
szc3 txa
 rts

; sized paragraphs: gx = pixel x of the first character after margin, indent and alignment
szgx lda pwi
 beq zg9
 lda #0
 sta zm0
 sta zm1
 ldx pln
 beq zg2
zg1 lda zm0
 clc
 adc pit
 sta zm0
 bcc zg1b
 inc zm1
zg1b dex
 bne zg1
zg2 lda avl
 sec
 sbc zm0
 sta zm0
 lda avh
 sbc zm1
 sta zm1
 bcs zg3
 lda #0
 sta zm0
 sta zm1
zg3 lda pam
 cmp #16
 beq zg4
 cmp #15
 bne zg5
 lsr zm1
 ror zm0
 jmp zg4
zg5 lda #0
 sta zm0
 sta zm1
zg4 lda lm
 clc
 adc pof
 sta zbx
 lda #0
 sta gxh
 lda zbx
 asl
 rol gxh
 asl
 rol gxh
 clc
 adc zbx
 bcc zg6
 inc gxh
zg6 clc
 adc zm0
 sta gxl
 lda gxh
 adc zm1
 sta gxh
zg9 rts

szchar ldy #0
 lda (tp),y
 bit cumeas
 bmi szc9
 jsr szdraw
szc9
 lda gxl
 clc
 adc pit
 sta gxl
 bcc szn1
 inc gxh
szn1 lda gxl
 clc
 adc pit
 tay
 lda gxh
 adc #0
 cmp #1
 bcc szn2
 bne szn3
 cpy #$41
 bcs szn3
szn2 jmp dtnext
szn3 jmp dtend

; A = ascii; draws one scaled character at pixel (gx) on the row in rs
szdraw cmp #128
 bcc szd0
 cmp #160
 beq szsp
 cmp #173
 bne szd0
 lda #'-'
 bne szd0
szsp lda #32
szd0 sec
 sbc #32
 bcs szd1
 lda #0
szd1 sta gp
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
 adc #>FNT
 sta gp+1
 lda gxl
 and #7
 sta zzs
 lda gxl
 lsr
 lsr
 lsr
 sta zbx
 lda gxh
 asl
 asl
 asl
 asl
 asl
 ora zbx
 sta zbx
 lda szh
 sec
 sbc #1
 ldy #0
 sty stp
 lsr
 ror stp
 lsr
 ror stp
 clc
 adc #>ST
 sta stp+1
 lda stp
 clc
 adc #32
 sta stq
 lda stp+1
 adc #0
 sta stq+1
 lda #0
 sta zm0
 sta zm1
 sta zm2
 ldx pit
szm1 sec
 ror zm0
 ror zm1
 dex
 bne szm1
 ldx zzs
 beq szm3
szm2 lsr zm0
 ror zm1
 ror zm2
 dex
 bne szm2
szm3 lda zm0
 eor #$FF
 sta zm0
 lda zm1
 eor #$FF
 sta zm1
 lda zm2
 eor #$FF
 sta zm2
 lda rs
 clc
 adc zbx
 sta sp
 lda rs+1
 adc #0
 sta sp+1
 lda lht
 lsr
 lsr
 sec
 sbc #1
 sta zx
 asl
 clc
 adc zx
 asl
 asl
 asl
 sta src
 lda #>HM
 sta src+1
 lda #0
 sta zyc
szr1 ldy zyc
 lda (src),y
 sta ry
 tay
 lda (gp),y
 sta v
 lda style
 jsr bld
 and #1
 beq szr2
 lda v
 lsr
 ora v
 sta v
szr2 lda v
 asl
 sta v
 lda style
 and #2
 beq szr3
 ldy ry
 cpy #4
 bcs szr3
 lsr v
szr3 lda style
 and #4
 beq szr4
 ldy ry
 cpy #7
 bne szr4
 lda #$1F
 sta v
szr4 lda style
 and #8
 beq szr5
 lda v
 eor #$1F
 sta v
szr5 jsr lite
 ldy v
 lda (stp),y
 sta zw0
 lda (stq),y
 sta zw1
 lda #0
 sta zw2
 ldx zzs
 beq szr7
szr6 lsr zw0
 ror zw1
 ror zw2
 dex
 bne szr6
szr7 ldy #0
 lda (sp),y
 and zm0
 ora zw0
 sta (sp),y
 iny
 lda (sp),y
 and zm1
 ora zw1
 sta (sp),y
 iny
 lda (sp),y
 and zm2
 ora zw2
 sta (sp),y
 lda sp
 clc
 adc #40
 sta sp
 bcc szr8
 inc sp+1
szr8 inc zyc
 lda zyc
 cmp lht
 beq szrx
 jmp szr1
szrx rts
bld ldx pfn
 cpx #23
 bne bl9
 ora #1
bl9 rts

lite lda pfn
 cmp #22
 bne lt1
 lda ry
 and #1
 beq lt1
 lda v
 and #$15
 sta v
lt1
lt9 rts

