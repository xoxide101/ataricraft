putc
 ldx bi
 sta BUF,x
 inc bi
 rts

putstr
 sta src
 stx src+1
 ldy #0
ps1 lda (src),y
 beq ps2
 jsr putc
 iny
 bne ps1
ps2 rts

putnum
 sta tmp
 ldx #'0'
pn1 lda tmp
 cmp #100
 bcc pn2
 sbc #100
 sta tmp
 inx
 bne pn1
pn2 ldy #0
 cpx #'0'
 beq pn3
 txa
 jsr putc
 ldy #1
pn3 ldx #'0'
pn4 lda tmp
 cmp #10
 bcc pn5
 sbc #10
 sta tmp
 inx
 bne pn4
pn5 cpx #'0'
 bne pn6
 cpy #0
 beq pn7
pn6 txa
 jsr putc
pn7 lda tmp
 clc
 adc #'0'
 jmp putc

putn16
 lda #0
 sta t0
 sta hi
pq1 ldx t0
 ldy #'0'
pq2 lda src
 sec
 sbc p1l,x
 pha
 lda src+1
 sbc p1h,x
 bcc pq3
 sta src+1
 pla
 sta src
 iny
 bne pq2
pq3 pla
 tya
 cmp #'0'
 bne pq4
 ldx hi
 beq pq5
pq4 sta hi
 jsr putc
pq5 inc t0
 lda t0
 cmp #4
 bne pq1
 lda src
 clc
 adc #'0'
 jmp putc
p1l dta l(10000),l(1000),l(100),l(10)
p1h dta h(10000),h(1000),h(100),h(10)

tabstops dta b(8,16,24,32,40,48,56,$FF)

mod10
 ldx #0
m10a cmp #10
 bcc m10b
 sbc #10
 inx
 bne m10a
m10b rts

