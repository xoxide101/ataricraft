; Spacer: a paragraph marked 24 draws as a hatched frame the width of the margins, lht scanlines tall.
; Text never flows into it, so it reserves room for an image or a gap.

; A = column, X = addend; returns A = (column*5 + X) / 8
b5 sta zm0
 stx zm1
 sta zw0
 lda #0
 sta zw1
 asl zw0
 rol zw1
 asl zw0
 rol zw1
 lda zw0
 clc
 adc zm0
 sta zw0
 bcc b51
 inc zw1
b51 lda zw0
 clc
 adc zm1
 sta zw0
 bcc b52
 inc zw1
b52 lsr zw1
 ror zw0
 lsr zw1
 ror zw0
 lsr zw1
 ror zw0
 lda zw0
 rts

spdraw lda lm
 ldx #7
 jsr b5
 sta zl
 lda rm
 clc
 adc #1
 ldx #0
 jsr b5
 sec
 sbc #1
 sta zx
 lda rs
 sta sp
 lda rs+1
 sta sp+1
 lda #0
 sta zyc
sp1 lda zyc
 beq spe
 clc
 adc #1
 cmp lht
 beq spe
 lda zyc
 and #1
 beq sph
 lda #$55
 bne spm
sph lda #$AA
 bne spm
spe lda #$FF
spm sta zm0
 and #$7F
 ora #$80
 sta zm1
 lda zm0
 and #$FE
 ora #1
 sta zm2
 ldy zl
 lda zm1
 sta (sp),y
 iny
spi cpy zx
 bcs spx
 lda zm0
 sta (sp),y
 iny
 bne spi
spx lda zm2
 sta (sp),y
 lda sp
 clc
 adc #40
 sta sp
 bcc sp2
 inc sp+1
sp2 inc zyc
 lda zyc
 cmp lht
 bne sp1
 rts
