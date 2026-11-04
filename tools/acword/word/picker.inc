; symbol picker: a grid of the extended glyphs (Latin-1 on page 0, Atari graphics on page 1)
hpick lda #1
 sta pkon
 lda #0
 sta pks
 sta pkp
 lda #5
 sta cmsg
 lda #1
 sta bd
 jmp pkdraw

pkdraw lda #4
 sta pkr
pk1 ldx pkr
 lda ROWL,x
 sta sp
 lda ROWH,x
 sta sp+1
 lda #8
 sta zh
 jsr rs1
 inc pkr
 lda pkr
 cmp #17
 bne pk1
 lda pkp
 beq pk2
 lda #128
 ldx #32
 bne pk3
pk2 lda #160
 ldx #96
pk3 sta pkb
 stx pkn
 lda #0
 sta pki
 sta pfn
pk4 lda pki
 lsr
 lsr
 lsr
 lsr
 asl
 clc
 adc #5
 tax
 lda ROWL,x
 sta rs
 lda ROWH,x
 sta rs+1
 lda pki
 and #15
 sta pkc
 asl
 clc
 adc pkc
 clc
 adc #8
 sta col
 lda #0
 sta style
 lda pki
 cmp pks
 bne pk5
 lda #8
 sta style
pk5 lda pkb
 clc
 adc pki
 jsr drawchar
 inc pki
 lda pki
 cmp pkn
 bne pk4
 rts

pkkey lda kk
 cmp #$1B
 beq pkcl
 cmp #$9B
 beq pkent
 cmp #9
 beq pktab
 cmp #$1C
 beq pkup
 cmp #$1D
 beq pkdn
 cmp #$1E
 beq pklf
 cmp #$1F
 beq pkrt
pkrd rts
pkup lda pks
 sec
 sbc #16
 bcc pkrd
 sta pks
 jmp pkdraw
pkdn lda pks
 clc
 adc #16
 cmp pkn
 bcs pkrd
 sta pks
 jmp pkdraw
pklf lda pks
 beq pkrd
 dec pks
 jmp pkdraw
pkrt lda pks
 clc
 adc #1
 cmp pkn
 bcs pkrd
 sta pks
 jmp pkdraw
pktab lda pkp
 eor #1
 sta pkp
 lda #0
 sta pks
 jmp pkdraw
pkcl lda #0
 sta pkon
 sta cmsg
 lda #2
 sta fl
 lda #1
 sta bd
 rts
pkent lda pkb
 clc
 adc pks
 pha
 lda #0
 sta pkon
 sta cmsg
 pla
 jsr insert
 lda #2
 sta fl
 lda #1
 sta bd
 rts

