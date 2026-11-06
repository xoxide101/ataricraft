; Document segments: bank copy of the whole DOC area. Resident (the bank window hides $4000-$7FFF, DOC included),
; so every page goes through LDB. Segment i is kept in extended bank number 4+i; page 44 of the bank carries the length.
; sg_x: X = bank number, A bit 0 = 0 saves DOC to the bank, 1 loads DOC from it (dend is set from the length page).
sg_x
 stx sgbk
 and #1
 sta sgd
 lda #0
 sta sgp
sgl lda sgp
 clc
 adc #>DOC
 sta sgs+2
 sta sgt+2
 lda sgp
 clc
 adc #$40
 sta sgw+2
 sta sgr+2
 lda sgd
 bne sgld
 lda sgp
 cmp #44
 beq sgmeta
 ldy #0
sgs lda $FF00,y
 sta LDB,y
 iny
 bne sgs
 beq sgbp
sgmeta ldy #0
 tya
sgz sta LDB,y
 iny
 bne sgz
 lda dend
 sec
 sbc #<DOC
 sta LDB
 lda dend+1
 sbc #>DOC
 sta LDB+1
sgbp jsr sg_in
 ldy #0
sgq lda LDB,y
sgw sta $FF00,y
 iny
 bne sgq
 jsr bk_out
 jmp sgnx
sgld jsr sg_in
 ldy #0
sgr lda $FF00,y
 sta LDB,y
 iny
 bne sgr
 jsr bk_out
 lda sgp
 cmp #44
 beq sgdn
 ldy #0
sgu lda LDB,y
sgt sta $FF00,y
 iny
 bne sgu
sgnx inc sgp
 lda sgp
 cmp #45
 bcs sgx9
 jmp sgl
sgx9 rts
sgdn lda LDB
 clc
 adc #<DOC
 sta dend
 lda LDB+1
 adc #>DOC
 sta dend+1
 ldy #0
 tya
 sta (dend),y
 rts

sg_in sei
 lda #0
 sta NMIEN
 lda PORTB
 sta sv_t
 ldx sgbk
 jmp bkc_sel
