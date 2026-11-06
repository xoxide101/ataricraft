; Extended RAM (130XE): the $4000-$7FFF window shows one of four 16 KB banks.
;   bank 0, 1  cell records, 64 rows each, one 256 byte page per row, 16 records of 16 bytes
;   bank 2     string pool index table (2 bytes per pool string, up to 8192)
;   bank 3     string heap (len byte + Latin-1 text), append only
; All code that opens the window lives outside $4000-$7FFF. PORTB bits 2,3 pick the bank, bit 4 = 0 lets the CPU see it,
; bit 7 stays 1 (0 would map the self-test ROM at $5000), bit 0 keeps the OS ROM (floating point package) on.

bopen
 asl
 asl
 and #$0C
 sta t4
 lda pb0
 and #$E3
 ora t4
 sta PORTB
 rts

bclose
 lda pb0
 sta PORTB
 rts

; bp = record address of (qr,qc); A = bank
recaddr
 lda qr
 and #$3F
 clc
 adc #$40
 sta bp+1
 lda qc
 asl
 asl
 asl
 asl
 sta bp
 lda qr
 lsr
 lsr
 lsr
 lsr
 lsr
 lsr
 rts

rdrec
 jsr recaddr
 jsr bopen
 ldy #15
rr1 lda (bp),y
 sta RECB,y
 dey
 bpl rr1
 jmp bclose

wrrec
 jsr recaddr
 jsr bopen
 ldy #15
wr1 lda RECB,y
 sta (bp),y
 dey
 bpl wr1
 jmp bclose

; zero both record banks
clrgrid
 lda #0
 sta t3
cg0 lda t3
 jsr bopen
 lda #0
 sta bp
 lda #$40
 sta bp+1
 ldx #$40
 ldy #0
 tya
cg1 sta (bp),y
 iny
 bne cg1
 inc bp+1
 dex
 bne cg1
 jsr bclose
 inc t3
 lda t3
 cmp #2
 bne cg0
 rts

; append the string in TMPS (len byte first) to the heap; carry set = heap full. Returns the address in rp.
hput
 lda TMPS
 clc
 adc hp
 sta t1
 lda hp+1
 adc #0
 sta t2
 inc t1
 bne hp1
 inc t2
hp1 lda t2
 cmp #$80
 bcs hpfull
 lda hp
 sta bp
 lda hp+1
 sta bp+1
 lda #3
 jsr bopen
 ldy TMPS
hp2 lda TMPS,y
 sta (bp),y
 dey
 bpl hp2
 jsr bclose
 lda hp
 sta rp
 lda hp+1
 sta rp+1
 lda t1
 sta hp
 lda t2
 sta hp+1
 clc
 rts
hpfull sec
 rts

; copy the heap string at rp to TMPS
hget
 lda rp
 sta bp
 lda rp+1
 sta bp+1
 lda #3
 jsr bopen
 ldy #0
 lda (bp),y
 sta TMPS
 tay
hg1 lda (bp),y
 sta TMPS,y
 dey
 bpl hg1
 jmp bclose

ptaddr
 lda pi
 asl
 sta bp
 lda pi+1
 rol
 ora #$40
 sta bp+1
 rts

; rp = pool address of string pi
ptget
 jsr ptaddr
 lda #2
 jsr bopen
 ldy #0
 lda (bp),y
 sta rp
 iny
 lda (bp),y
 sta rp+1
 jmp bclose

ptset
 jsr ptaddr
 lda #2
 jsr bopen
 ldy #0
 lda rp
 sta (bp),y
 iny
 lda rp+1
 sta (bp),y
 jmp bclose
