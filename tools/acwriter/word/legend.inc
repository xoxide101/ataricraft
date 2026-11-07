; legend: append one entry per superscript run (up to 15 chars) at the end of the document (part of image S)
hleg lda nl
 sta lgn
 lda #0
 sta lgl
lg1 lda lgl
 cmp lgn
 bcc lg1a
 jmp lgdone
lg1a lda #0
 sta lgy
lg2 ldx lgl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldy lgy
lg3 lda (tp),y
 beq lg9
 cmp #13
 beq lg9
 cmp #14
 beq lg9
 iny
 cmp #11
 bne lg3
 ldx #0
lg4 lda (tp),y
 beq lg9
 cmp #13
 beq lg9
 cmp #14
 beq lg9
 iny
 cmp #11
 beq lg5
 cpx #15
 bcs lg4
 sta LGB,x
 inx
 bne lg4
lg5 stx lgc
 sty lgy
 cpx #0
 beq lg2
 jsr lgemit
 jmp lg2
lg9 inc lgl
 jmp lg1
lgdone lda #2
 sta fl
 lda #1
 sta bd
 rts
lgemit lda nl
 sec
 sbc #1
 sta cl
 jsr linelen
 sta cc
 lda #13
 jsr insert
 lda #11
 jsr insert
 ldx #0
le1 stx lgx
 lda LGB,x
 jsr insert
 ldx lgx
 inx
 cpx lgc
 bne le1
 lda #11
 jsr insert
 lda #32
 jmp insert
