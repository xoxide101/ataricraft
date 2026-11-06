; Cell entry and editing: a printable key starts entry (mode 1), Return stores, Esc cancels.
; ^E edits the cell, Backspace clears it, ^F cycles the number format (0-7), ^B toggles bold.
; Text starting with = is a formula (stored without the =), a complete AFP number is a number, anything else is text.

FASC   = $D8E6                ; FR0 -> ASCII at INBUFF, last character has bit 7 set

; nav mode keys not handled by navkey (key = code)
edkey
 lda key
 cmp #$7E
 beq ed_clr
 cmp #$05
 beq ed_edit
 cmp #$06
 beq ed_fmt
 cmp #$02
 beq ed_bold
 cmp #32
 bcc edx
 cmp #127
 bcs edx
 sta EBUF
 lda #1
 sta elen
ed_go lda #1
 sta mode
 lda #0
 sta msg
 jsr drawbar
 jmp drawstat
edx rts

ed_clr
 jsr edclear
 jmp ed_redraw

ed_redraw
 jsr recalc
 lda #0
 sta msg
 jsr visible
 jmp drawall

ed_cell
 lda cr
 sta qr
 lda cc
 sta qc
 jmp rdrec

ed_fmt
 jsr ed_cell
 lda RECB+2
 clc
 adc #1
 cmp #8
 bcc ef1
 lda #0
ef1 sta RECB+2
 jsr wrrec
 lda #1
 sta dirty
 jmp drawall

ed_bold
 jsr ed_cell
 lda RECB+3
 eor #1
 sta RECB+3
 jsr wrrec
 lda #1
 sta dirty
 jmp drawall

; ^E: load the cell text into EBUF
ed_edit
 jsr ed_cell
 lda #0
 sta elen
 lda RECB
 cmp #3
 bne ee1
 lda RECB+10
 sta rp
 lda RECB+11
 sta rp+1
 jsr hget
 lda #'='
 sta EBUF
 ldx #0
ee0 cpx TMPS
 bcs ee0a
 lda TMPS+1,x
 sta EBUF+1,x
 inx
 bne ee0
ee0a inx
 stx elen
 jmp ed_go
ee1 cmp #2
 bne ee2
 lda RECB+4
 sta rp
 lda RECB+5
 sta rp+1
 jsr hget
 ldx #0
ee1a cpx TMPS
 bcs ee1b
 lda TMPS+1,x
 sta EBUF,x
 inx
 bne ee1a
ee1b stx elen
 jmp ed_go
ee2 cmp #1
 bne ee9
 ldx #<(RECB+4)
 ldy #>(RECB+4)
 jsr FLD0R
 jsr FASC
 ldy #0
ee2a lda (INBUFF),y
 sta svb
 and #$7F
 sta EBUF,y
 iny
 lda svb
 bpl ee2a
 sty elen
ee3 ldx #0
ee3a cpx elen
 bcs ee9
 lda EBUF,x
 cmp #'.'
 bne ee3n
 inx
 cpx elen
 beq ee3d
 lda EBUF,x
 dex
 cmp #'E'
 bne ee3n
ee3d stx t1
 txa
 tax
ee3s inx
 cpx elen
 bcs ee3e
 lda EBUF,x
 sta EBUF-1,x
 jmp ee3s
ee3e dec elen
 jmp ee3
ee3n inx
 jmp ee3a
ee9 jmp ed_go

; ---- entry mode keys
entrykey
 lda key
 cmp #$9B
 beq ecommit
 cmp #$1B
 beq ecancel
 cmp #$7E
 beq ebs
 cmp #32
 bcc ek9
 cmp #127
 bcs ek9
 ldx elen
 cpx #100
 bcs ek9
 sta EBUF,x
 inc elen
ek9 jmp drawbar
ebs lda elen
 beq ek9
 dec elen
 jmp drawbar
ecancel
 lda #0
 sta mode
 sta msg
 jsr drawbar
 jmp drawstat

; remove the formula list entry for (qr,qc) when the cell is a formula; zero the value of the cell
edclear
 jsr ed_cell
 jsr edzero
 jsr wrrec
 lda #1
 sta dirty
 rts

edzero
 lda RECB
 cmp #3
 bne ez1
 jsr fldel
ez1 lda #0
 sta RECB
 sta RECB+1
 ldx #11
ez2 sta RECB+4,x
 dex
 bpl ez2
 rts

ecommit
 lda #0
 sta mode
 jsr ed_cell
 lda elen
 bne ec0
 jsr edclear
 jmp ec_done
ec0 jsr edzero
 lda EBUF
 cmp #'='
 bne ec2
 lda elen
 cmp #2
 bcs ec_f
ec2 ldx elen
 lda #0
 sta EBUF,x
 lda #<EBUF
 sta INBUFF
 lda #>EBUF
 sta INBUFF+1
 lda #0
 sta CIX
 jsr AFP
 bcs ec_txt
 lda CIX
 cmp elen
 bne ec_txt
 ldx #<(RECB+4)
 ldy #>(RECB+4)
 jsr FST0R
 lda #1
 sta RECB
 sta RECB+1
 jmp ec_put
ec_txt
 lda elen
 sta TMPS
 ldx #0
et1 cpx elen
 bcs et2
 lda EBUF,x
 sta TMPS+1,x
 inx
 bne et1
et2 jsr hput
 bcs ec_full
 lda rp
 sta RECB+4
 lda rp+1
 sta RECB+5
 lda #2
 sta RECB
 sta RECB+1
 jmp ec_put
ec_f
 lda fcnt+1
 cmp #>MAXF
 bcs ec_nof
 lda elen
 sec
 sbc #1
 sta TMPS
 ldx #0
ef2 cpx TMPS
 bcs ef3
 lda EBUF+1,x
 sta TMPS+1,x
 inx
 bne ef2
ef3 jsr hput
 bcs ec_full
 lda rp
 sta RECB+10
 lda rp+1
 sta RECB+11
 lda #3
 sta RECB
 jsr wrrec
 jsr fladd
 jmp ec_done2
ec_put
 jsr wrrec
ec_done2
 lda #1
 sta dirty
ec_done
 lda cr
 cmp #NROWS-1
 bcs ec_d1
 inc cr
ec_d1 jmp ed_redraw
ec_full
 lda #9
 bne ec_err
ec_nof
 lda #12
ec_err pha
 jsr wrrec
 jsr recalc
 pla
 sta msg
 jsr visible
 jmp drawall

; ---- formula list maintenance (the list holds the cell addresses of the formula cells)
flptr
 lda fli
 sta ptr
 lda fli+1
 clc
 adc #>FLL
 sta ptr+1
 rts

; C set when (qr,qc) is in the list; fli = its index
flfind
 lda #0
 sta fli
 sta fli+1
flf1 lda fli
 cmp fcnt
 bne flf2
 lda fli+1
 cmp fcnt+1
 beq flfz
flf2 jsr flptr
 ldy #0
 lda (ptr),y
 cmp qr
 bne flfn
 lda ptr+1
 clc
 adc #>(FLH-FLL)
 sta ptr+1
 lda (ptr),y
 cmp qc
 beq flfy
flfn inc fli
 bne flf1
 inc fli+1
 jmp flf1
flfy sec
 rts
flfz clc
 rts

fldel
 jsr flfind
 bcc fld9
fld1 lda fcnt
 sec
 sbc #1
 tax
 lda fcnt+1
 sbc #0
 cmp fli+1
 bne fld2
 cpx fli
 beq fld8
fld2 jsr flptr
 ldy #1
 lda (ptr),y
 dey
 sta (ptr),y
 lda ptr+1
 clc
 adc #>(FLH-FLL)
 sta ptr+1
 iny
 lda (ptr),y
 dey
 sta (ptr),y
 inc fli
 bne fld1
 inc fli+1
 jmp fld1
fld8 lda fcnt
 bne fld8a
 dec fcnt+1
fld8a dec fcnt
fld9 rts

fladd
 lda fcnt
 sta fli
 lda fcnt+1
 sta fli+1
 jsr flptr
 ldy #0
 lda qr
 sta (ptr),y
 lda ptr+1
 clc
 adc #>(FLH-FLL)
 sta ptr+1
 lda qc
 sta (ptr),y
 inc fcnt
 bne fla9
 inc fcnt+1
fla9 rts
