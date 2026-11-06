; .XCS saver. Three passes over the same generator (genpay):
;   wrm=2 counts the pool (strings, bytes), cells, rows and the payload length
;   wrm=0 computes the CRC-16 and the plain checksum
;   wrm=1 writes the header, the payload and the CRC to the file
; Pool order: custom formats, sheet name, then every string a cell references (no de-duplication).
; Only sheet 1 is written; names and charts are not kept (the loader skips them).

; emit byte A to the current pass (preserves X, Y)
sxb
 sta svb
 txa
 pha
 tya
 pha
 lda wrm
 cmp #1
 beq sxb1
 inc tlen
 bne sxb0
 inc tlen+1
sxb0 lda wrm
 bne sxb9
 lda svb
 jsr crcb
 lda svb
 clc
 adc sum
 sta sum
 bcc sxb9
 inc sum+1
 jmp sxb9
sxb1 lda svb
 jsr sxput
sxb9 pla
 tay
 pla
 tax
 rts

sxput
 ldx wpos
 sta IOBUF,x
 inx
 stx wpos
 cpx #128
 bcc sxp9
 jsr sxflush
sxp9 rts

sxflush
 lda wpos
 beq sxf9
 sta w16
 lda #0
 sta w16+1
 sta wpos
 lda #11
 ldx #<IOBUF
 ldy #>IOBUF
 jsr fblk
 cpy #$80
 bcc sxf9
 lda #2
 jmp ldabort
sxf9 rts

; emit the heap string at rp as a pool entry (rp = 0 -> empty string)
sxstr
 lda rp
 ora rp+1
 bne sxs1
 sta TMPS
 beq sxs2
sxs1 jsr hget
sxs2 ldy #0
sxs3 lda TMPS,y
 jsr sxb
 cpy TMPS
 beq sxs4
 iny
 bne sxs3
sxs4 inc sidxp
 bne sxs5
 inc sidxp+1
sxs5 rts

; emit a u16 pool reference and advance it
sxref
 lda sci
 jsr sxb
 lda sci+1
 jsr sxb
 inc sci
 bne sxr9
 inc sci+1
sxr9 rts

sxp4                        ; rp = string pointer at RECB+4
 lda RECB+4
 sta rp
 lda RECB+5
 sta rp+1
 rts

; C set when the record in RECB is a stored cell
sxex
 lda RECB
 ora RECB+2
 ora RECB+3
 beq sxe0
 sec
 rts
sxe0 clc
 rts

; svw=0: emit the strings of the cell; svw=1: emit the cell
sxcell
 lda svw
 bne sxc_w
 lda RECB
 cmp #3
 bne sxc1
 lda RECB+10
 sta rp
 lda RECB+11
 sta rp+1
 jsr sxstr
 lda RECB+1
 cmp #2
 bne sxc9
 jmp sxc2
sxc1 cmp #2
 bne sxc9
sxc2 jsr sxp4
 jmp sxstr
sxc9 rts
sxc_w
 lda wrm
 cmp #2
 bne sxw0
 inc tcells
 bne sxw0a
 inc tcells+1
sxw0a lda qc
 cmp tmaxc
 bcc sxw0b
 clc
 adc #1
 sta tmaxc
sxw0b lda qr
 cmp tmaxr
 bcc sxw0
 clc
 adc #1
 sta tmaxr
sxw0 lda qc
 jsr sxb
 lda RECB
 and #7
 ldx RECB+2
 beq sxw1
 ora #8
sxw1 ldx RECB+3
 beq sxw2
 ora #16
sxw2 jsr sxb
 lda RECB+2
 beq sxw3
 jsr sxb
sxw3 lda RECB+3
 beq sxw4
 jsr sxb
sxw4 lda RECB
 and #7
 cmp #1
 beq sxnum
 cmp #2
 beq sxstrc
 cmp #3
 beq sxform
 cmp #4
 beq sxbyte
 cmp #5
 beq sxbyte
 rts
sxbyte
 lda RECB+4
 jmp sxb
sxstrc
 jmp sxref
sxnum
 ldx #0
sxn1 lda RECB+4,x
 jsr sxb
 inx
 cpx #6
 bne sxn1
 rts
sxform
 jsr sxref
 lda RECB+1
 cmp #1
 beq sxf_n
 cmp #2
 beq sxf_s
 cmp #4
 beq sxf_b
 cmp #5
 beq sxf_b
 lda #0
 jmp sxb
sxf_n
 lda #1
 jsr sxb
 jmp sxnum
sxf_s
 lda #2
 jsr sxb
 jmp sxref
sxf_b
 lda RECB+1
 jsr sxb
 jmp sxbyte

; walk the grid in row order; svw selects what sxcell does
sxwalk
 lda #0
 sta svrow
sxk0 lda svrow
 sta qr
 lda #0
 sta svcnt
 sta svcol
sxk1 lda svcol
 sta qc
 jsr rdrec
 jsr sxex
 bcc sxk2
 inc svcnt
sxk2 inc svcol
 lda svcol
 cmp #NCOLS
 bne sxk1
 lda svcnt
 beq sxk8
 lda svw
 beq sxk3
 lda wrm
 cmp #2
 bne sxk2a
 inc tnrows
 bne sxk2a
 inc tnrows+1
sxk2a lda svrow
 jsr sxb
 lda #0
 jsr sxb
 lda svcnt
 sec
 sbc #1
 jsr sxb
sxk3 lda #0
 sta svcol
sxk4 lda svcol
 sta qc
 jsr rdrec
 jsr sxex
 bcc sxk5
 jsr sxcell
sxk5 inc svcol
 lda svcol
 cmp #NCOLS
 bne sxk4
sxk8 inc svrow
 lda svrow
 cmp #NROWS
 beq sxk9
 jmp sxk0
sxk9 rts

genpay
 lda #0
 sta tlen
 sta tlen+1
 sta sidxp
 sta sidxp+1
 lda #1
 jsr sxb
 lda #1
 jsr sxb
 lda #0
 jsr sxb
 lda ncfm
 jsr sxb
 lda #0
 jsr sxb
 lda #0
 jsr sxb
 lda nstro
 jsr sxb
 lda nstro+1
 jsr sxb
 lda pbytes
 jsr sxb
 lda pbytes+1
 jsr sxb
 lda #0
 sta svi
sxg1 lda svi
 cmp ncfm
 beq sxg2
 asl
 tax
 lda CFM,x
 sta rp
 lda CFM+1,x
 sta rp+1
 jsr sxstr
 inc svi
 jmp sxg1
sxg2 lda shname
 sta rp
 lda shname+1
 sta rp+1
 jsr sxstr
 lda #0
 sta svw
 jsr sxwalk
 lda wrm
 cmp #2
 bne sxg3
 lda sidxp
 sta nstro
 lda sidxp+1
 sta nstro+1
 sec
 lda tlen
 sbc #10
 sta pbytes
 lda tlen+1
 sbc #0
 sta pbytes+1
sxg3 lda #0
 sta svi
sxg4 lda svi
 cmp ncfm
 beq sxg5
 jsr sxb
 lda #0
 jsr sxb
 inc svi
 lda svi
 jmp sxg4
sxg5 lda ncfm
 jsr sxb
 lda #0
 jsr sxb
 lda sfr
 jsr sxb
 lda sfc
 jsr sxb
 lda dcw
 jsr sxb
 ldx #0
 ldy #0
sxg6 lda CWR,x
 beq sxg6a
 iny
sxg6a inx
 cpx #NCOLS
 bne sxg6
 tya
 jsr sxb
 ldx #0
sxg7 lda CWR,x
 beq sxg7a
 txa
 jsr sxb
 lda CWR,x
 jsr sxb
sxg7a inx
 cpx #NCOLS
 bne sxg7
 lda tnrows
 jsr sxb
 lda tnrows+1
 jsr sxb
 lda ncfm
 clc
 adc #1
 sta sci
 lda #0
 sta sci+1
 lda #1
 sta svw
 jmp sxwalk

save
 tsx
 stx ldsp
 lda #0
 sta lderr
 sta nstro
 sta nstro+1
 sta pbytes
 sta pbytes+1
 sta tcells
 sta tcells+1
 sta tnrows
 sta tnrows+1
 sta tmaxc
 sta tmaxr
 sta wpos
 lda #2
 sta wrm
 jsr genpay
 lda #0
 sta wrm
 sta sum
 sta sum+1
 lda #$FF
 sta crc
 sta crc+1
 jsr genpay
 lda crc
 clc
 adc sum
 sta sum
 bcc sv1
 inc sum+1
sv1 lda crc+1
 clc
 adc sum
 sta sum
 bcc sv2
 inc sum+1
sv2 lda tlen
 clc
 adc #2
 sta svl
 lda tlen+1
 adc #0
 sta svl+1
 bcc sv3
 lda #2
 jmp ldabort
sv3 lda #8
 jsr fopen
 cpy #$80
 bcc sv4
 lda #2
 jmp ldabort
sv4 lda #1
 sta wrm
 lda #0
 sta svi
sv5 ldx svi
 lda hmag,x
 jsr sxput
 inc svi
 lda svi
 cmp #4
 bne sv5
 lda #1
 jsr sxput
 lda #'S'
 jsr sxput
 lda #0
 jsr sxput
 lda #0
 jsr sxput
 lda svl
 jsr sxput
 lda svl+1
 jsr sxput
 lda tcells
 jsr sxput
 lda tcells+1
 jsr sxput
 lda tmaxc
 jsr sxput
 lda tmaxr
 jsr sxput
 lda sum
 jsr sxput
 lda sum+1
 jsr sxput
 jsr genpay
 lda crc
 jsr sxput
 lda crc+1
 jsr sxput
 jsr sxflush
 jsr fclose
 lda #5
 sta msg
 lda #0
 sta dirty
 rts
