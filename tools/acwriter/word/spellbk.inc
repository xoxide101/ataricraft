; Dictionary table access for the spell checker. Lives at $9300, outside the $4000-$7FFF window of the
; 130XE extended bank, so it stays visible while the bank is switched in. Interrupts are masked
; (NMIEN off) while the bank is mapped because the code at $4000-$4BFF is hidden then.

 org DNM
 dta c'D1:EN.CDC',b($9B)
 org DNM2
 dta c'H:EN.CDC',b($9B)

 org $9300

; A = byte at table offset sv_bo (16 bit)
bk_get
 lda sv_bo+1
 clc
 adc sv_tb
 sta bkg1+2
 sta bkg2+2
 ldx sv_bo
 lda sv_xe
 beq bkg0
 jsr bk_in
bkg1 lda $FF00,x
 tay
 jsr bk_out
 tya
 rts
bkg0
bkg2 lda $FF00,x
 rts

; copy LDB (256 bytes) to table page A
bk_put
 clc
 adc sv_tb
 sta bkp1+2
 lda sv_xe
 beq bkp0
 jsr bk_in
 jsr bkp
 jmp bk_out
bkp0
bkp ldy #0
bkp2 lda LDB,y
bkp1 sta $FF00,y
 iny
 bne bkp2
 rts

bk_in
 sei
 lda #0
 sta NMIEN
 lda PORTB
 sta sv_t
 and #$E3
 ora #$04
 sta PORTB
 rts

bk_out
 lda sv_t
 sta PORTB
 lda #$C0
 sta NMIEN
 cli
 rts

; bank 3 holds the loaded typefaces ($4000.., 1 KB each). fb_put: copy LDB to bank 3 page A ($40..$7F)
fb_put
 sta fbp+2
 jsr fb_in
 ldy #0
fbq lda LDB,y
fbp sta $FF00,y
 iny
 bne fbq
 jmp bk_out

; fb_get8: copy the 8 bytes at (src) in bank 3 to FG8
fb_get8
 jsr fb_in
 ldy #7
fbg lda (src),y
 sta FG8,y
 dey
 bpl fbg
 jmp bk_out

fb_in
 sei
 lda #0
 sta NMIEN
 lda PORTB
 sta sv_t
 and #$E3
 ora #$0C
 sta PORTB
 rts

; sv_nb = number of distinct extended-RAM banks the CPU can reach through PORTB bits 2,3,5,6,7 (1 = none, 4 = 130XE,
; 16 = Rambo / Compy-Shop 320K, 32 = 576K and up). Every bank-bit combination gets its own signature at $4000; combinations
; that alias the same bank read back the same signature. The original bytes are restored.
bk_cnt
 sei
 lda #0
 sta NMIEN
 lda PORTB
 sta sv_t
 ldx #31
bkc1 jsr bkc_sel
 lda $4000
 sta BUF,x
 lda #0
 sta BUF+$40,x
 dex
 bpl bkc1
 ldx #0
bkc2 jsr bkc_sel
 txa
 sta $4000
 inx
 cpx #32
 bne bkc2
 ldx #0
bkc3 jsr bkc_sel
 ldy $4000
 lda #1
 sta BUF+$40,y
 inx
 cpx #32
 bne bkc3
 ldx #31
bkc4 jsr bkc_sel
 lda BUF,x
 sta $4000
 dex
 bpl bkc4
 lda #0
 tay
bkc5 clc
 adc BUF+$40,y
 iny
 cpy #32
 bne bkc5
 sta sv_nb
 lda sv_t
 sta PORTB
 lda #$C0
 sta NMIEN
 cli
 rts
bkc_sel
 txa
 and #3
 asl
 asl
 sta tmp
 txa
 and #$1C
 asl
 asl
 asl
 ora tmp
 sta tmp
 lda sv_t
 and #3
 ora tmp
 sta PORTB
 rts

; sv_xe = 1 when bank 1 is a separate 16 KB of RAM (130XE), else 0
bk_det
 lda #0
 sta sv_xe
 sei
 sta NMIEN
 lda $7FFF
 sta sv_hm
 lda PORTB
 pha
 and #$E3
 ora #$04
 sta PORTB
 lda $7FFF
 sta sv_ty
 lda #$A5
 sta $7FFF
 pla
 pha
 sta PORTB
 lda #$5A
 sta $7FFF
 lda PORTB
 and #$E3
 ora #$04
 sta PORTB
 lda $7FFF
 cmp #$A5
 bne bkd1
 inc sv_xe
 lda sv_ty
 sta $7FFF
bkd1 pla
 sta PORTB
 lda sv_hm
 sta $7FFF
 lda #$C0
 sta NMIEN
 cli
 rts
