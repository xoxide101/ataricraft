; .XCS loader (CIO, IOCB #3). Streams the payload through rdb; every failure unwinds to load's caller via ldabort.
; The checksum and CRC are verified after parsing (a mismatch is reported, the data stays loaded).

fopen
 sta t3
 ldx #$30
 lda #3
 sta ICCOM,x
 lda #<FNB
 sta ICBAL,x
 lda #>FNB
 sta ICBAH,x
 lda t3
 sta ICAX1,x
 lda #0
 sta ICAX2,x
 jmp CIOV

; A = command, X/Y = buffer, w16 = length
fblk
 sta ICCOM+$30
 stx ICBAL+$30
 sty ICBAH+$30
 lda w16
 sta ICBLL+$30
 lda w16+1
 sta ICBLH+$30
 ldx #$30
 jmp CIOV

fclose
 ldx #$30
 lda #12
 sta ICCOM,x
 jmp CIOV

; A = message index
ldabort
 pha
 ldx ldsp
 txs
 jsr fclose
 pla
 sta msg
 lda #1
 sta lderr
 rts

crcb
 eor crc+1
 sta crc+1
 ldx #8
cb1 asl crc
 rol crc+1
 bcc cb2
 lda crc+1
 eor #$10
 sta crc+1
 lda crc
 eor #$21
 sta crc
cb2 dex
 bne cb1
 rts

; fetch the next chunk of the payload into IOBUF (<= 128 bytes; never leaves 1 byte for the next chunk)
refill
 lda remh
 ora remh+1
 bne rf1
 lda #8
 jmp ldabort
rf1 lda remh+1
 bne rfbig
 lda remh
 cmp #129
 bcc rfset
 bne rfbig
 lda #126
 bne rfset
rfbig lda #128
rfset sta rlen
 cmp #2
 bcs rf1a
 lda #8
 jmp ldabort
rf1a sta w16
 lda #0
 sta w16+1
 lda #7
 ldx #<IOBUF
 ldy #>IOBUF
 jsr fblk
 cpy #$80
 bcc rf2
 lda #2
 jmp ldabort
rf2 sec
 lda remh
 sbc rlen
 sta remh
 bcs rf2a
 dec remh+1
rf2a lda #0
 sta rpos
 sta t3
 lda remh
 ora remh+1
 bne rf3
 lda rlen
 sec
 sbc #2
 sta t3
rf3 lda remh
 ora remh+1
 beq rf3a
 lda #$FF
 sta t3
rf3a ldx #0
rf4 stx rfx
 lda IOBUF,x
 sta rft
 clc
 adc sum
 sta sum
 bcc rf5
 inc sum+1
rf5 ldx rfx
 cpx t3
 bcc rf6
 txa
 sec
 sbc t3
 tay
 lda rft
 sta scrc,y
 jmp rf7
rf6 lda rft
 jsr crcb
rf7 ldx rfx
 inx
 cpx rlen
 bne rf4
 rts

; next payload byte in A (X, Y preserved)
rdb
 txa
 pha
 tya
 pha
 lda rpos
 cmp rlen
 bcc rd2
 ldx #3
rb1 lda t1,x
 pha
 dex
 bpl rb1
 lda w16
 pha
 lda w16+1
 pha
 jsr refill
 pla
 sta w16+1
 pla
 sta w16
 ldx #0
rb2 pla
 sta t1,x
 inx
 cpx #4
 bne rb2
rd2 ldx rpos
 lda IOBUF,x
 inc rpos
 sta fx
 pla
 tay
 pla
 tax
 lda fx
 rts

rd16
 jsr rdb
 sta w16
 jsr rdb
 sta w16+1
 rts

; skip w16 bytes
skipw
 lda w16
 ora w16+1
 beq sk9
 jsr rdb
 lda w16
 bne sk1
 dec w16+1
sk1 dec w16
 jmp skipw
sk9 rts

; w16 = A * X
mulax
 sta t3
 lda #0
 sta w16
 sta w16+1
 lda t3
 beq mx9
mx1 txa
 clc
 adc w16
 sta w16
 bcc mx2
 inc w16+1
mx2 dec t3
 bne mx1
mx9 rts

; rp = pool string address of index w16 (0 when out of range)
pptr
 lda w16
 sta pi
 lda w16+1
 sta pi+1
 cmp #$20
 bcc pp1
 lda #0
 sta rp
 sta rp+1
 rts
pp1 jmp ptget

; RECB,y <- rp
stptr
 lda rp
 sta RECB,y
 lda rp+1
 sta RECB+1,y
 rts

; clamp A to 4..12
clampw
 cmp #4
 bcs cl1
 lda #4
cl1 cmp #13
 bcc cl2
 lda #12
cl2 rts

load
 tsx
 stx ldsp
 lda #0
 sta lderr
 sta ncell
 sta ncell+1
 sta ndrop
 sta ndrop+1
 sta fdrop
 sta fcnt
 sta fcnt+1
 sta nstr
 sta nstr+1
 sta rpos
 sta rlen
 sta sfr
 sta sfc
 sta ncfm
 sta shname
 sta shname+1
 sta hp
 lda #$40
 sta hp+1
 lda #$FF
 sta crc
 sta crc+1
 lda #0
 sta sum
 sta sum+1
 jsr clrgrid
 ldx #15
 lda #9
 sta dcw
ld0 lda #9
 sta CW,x
 lda #0
 sta CWR,x
 dex
 bpl ld0
 lda #4
 jsr fopen
 cpy #$80
 bcc ld1
 lda #2
 jmp ldabort
ld1 lda #16
 sta w16
 lda #0
 sta w16+1
 lda #7
 ldx #<HDR
 ldy #>HDR
 jsr fblk
 cpy #$80
 bcc ld2
 lda #3
 jmp ldabort
ld2 ldx #3
ld3 lda HDR,x
 cmp hmag,x
 beq ld3a
 lda #3
 jmp ldabort
ld3a dex
 bpl ld3
 lda HDR+5
 cmp #'S'
 beq ld3b
 lda #3
 jmp ldabort
ld3b lda HDR+8
 sta remh
 lda HDR+9
 sta remh+1
 lda HDR+14
 sta hsum
 lda HDR+15
 sta hsum+1
 jsr rdb
 cmp #1
 beq ld4
 lda #4
 jmp ldabort
ld4 jsr rdb
 sta nsheet
 jsr rdb
 sta nnm
 jsr rdb
 sta nfm2
 jsr rdb
 sta ncht
 jsr rdb
 jsr rd16
 lda w16
 sta nstr
 lda w16+1
 sta nstr+1
 jsr rd16
 lda #0
 sta pi
 sta pi+1
; string pool
ls0 lda pi
 cmp nstr
 bne ls1
 lda pi+1
 cmp nstr+1
 beq ls9
ls1 jsr rdb
 sta slen
 bpl ls3
 and #$7F
 sta w16+1
 jsr rdb
 sta w16
 jsr skipw
 lda #0
 sta rp
 sta rp+1
 jmp ls6
ls3 sta TMPS
 tax
 beq ls5
 ldy #1
ls4 jsr rdb
 sta TMPS,y
 iny
 dex
 bne ls4
ls5 jsr hput
 bcc ls6
 lda #10
 jmp ldabort
ls6 lda pi+1
 cmp #$20
 bcs ls7
 jsr ptset
ls7 inc pi
 bne ls0
 inc pi+1
 jmp ls0
ls9
; custom formats
 lda #0
 sta fnl
 sta ncfm
lf1 lda fnl
 cmp nfm2
 beq lf9
 jsr rd16
 lda fnl
 cmp #16
 bcs lf2
 jsr pptr
 lda fnl
 asl
 tax
 lda rp
 sta CFM,x
 lda rp+1
 sta CFM+1,x
 inc ncfm
lf2 inc fnl
 jmp lf1
lf9 lda nnm
 ldx #4
 jsr mulax
 jsr skipw
 lda ncht
 ldx #11
 jsr mulax
 jsr skipw
; sheets
 lda #0
 sta sidx
lsh lda sidx
 cmp nsheet
 bne lsh1
 jmp lfin
lsh1 lda #0
 sta skp
 lda sidx
 beq lsh2
 inc skp
lsh2 jsr rd16
 lda skp
 bne lsh3
 jsr pptr
 lda rp
 sta shname
 lda rp+1
 sta shname+1
lsh3 jsr rdb
 ldx skp
 bne lsh4
 sta sfr
lsh4 jsr rdb
 ldx skp
 bne lsh5
 sta sfc
lsh5 jsr rdb
 ldx skp
 bne lsh6
 sta dcw
 jsr clampw
 ldx #15
lsh5a sta CW,x
 dex
 bpl lsh5a
lsh6 jsr rdb
 sta cwn
lcw lda cwn
 beq lcw9
 jsr rdb
 sta t1
 jsr rdb
 ldx skp
 bne lcw1
 ldx t1
 cpx #NCOLS
 bcs lcw1
 sta CWR,x
 jsr clampw
 sta CW,x
lcw1 dec cwn
 jmp lcw
lcw9 jsr rd16
 lda w16
 sta rrow
 lda w16+1
 sta rrow+1
lrow lda rrow
 ora rrow+1
 bne lrow1
 jmp lnext
lrow1 lda rrow
 bne lrow2
 dec rrow+1
lrow2 dec rrow
 jsr rd16
 lda w16
 sta qr
 lda w16+1
 sta fhave
 jsr rdb
 sta rcnt
 inc rcnt
 lda rcnt
 bne lcell
 ; 256 cells: handled as rcnt = 0 -> loop 256 times
lcell jsr rdb
 sta qc
 jsr rdb
 sta fl
 ldx #15
 lda #0
lc0 sta RECB,x
 dex
 bpl lc0
 lda fl
 and #7
 sta RECB
 lda fl
 and #8
 beq lc1
 jsr rdb
 sta RECB+2
lc1 lda fl
 and #16
 beq lc2
 jsr rdb
 sta RECB+3
lc2 lda RECB
 cmp #1
 beq lcnum
 cmp #2
 beq lcstr
 cmp #3
 beq lcfor
 cmp #4
 beq lcerr
 cmp #5
 beq lcerr
 jmp lcst
lcnum jsr rdnum
 lda #1
 sta RECB+1
 jmp lcst
lcstr jsr rd16
 jsr pptr
 ldy #4
 jsr stptr
 lda #2
 sta RECB+1
 jmp lcst
lcerr jsr rdb
 sta RECB+4
 lda RECB
 sta RECB+1
 jmp lcst
lcfor jsr rd16
 jsr pptr
 ldy #10
 jsr stptr
 jsr rdb
 cmp #1
 bne lf_a
 jsr rdnum
 lda #1
 sta RECB+1
 jmp lcst
lf_a cmp #2
 bne lf_b
 jsr rd16
 jsr pptr
 ldy #4
 jsr stptr
 lda #2
 sta RECB+1
 jmp lcst
lf_b cmp #5
 beq lf_c
 cmp #4
 bne lcst
lf_c sta RECB+1
 jsr rdb
 sta RECB+4
lcst lda skp
 bne lcdrop0
 lda fhave
 bne lcdrop
 lda qr
 cmp #NROWS
 bcs lcdrop
 lda qc
 cmp #NCOLS
 bcs lcdrop
 lda RECB
 cmp #3
 bne lcput
 lda fcnt+1
 cmp #>MAXF
 bcc lcreg
 ; formula list full: keep the cached value as a plain cell
 lda RECB+1
 sta RECB
 inc fdrop
 jmp lcput
lcreg lda fcnt
 sta ptr
 lda fcnt+1
 clc
 adc #>FLL
 sta ptr+1
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
 bne lcput
 inc fcnt+1
lcput jsr wrrec
 inc ncell
 bne lcn
 inc ncell+1
lcn jmp lcdone
lcdrop inc ndrop
 bne lcdone
 inc ndrop+1
lcdrop0
lcdone dec rcnt
 beq lcdn2
 jmp lcell
lcdn2 jmp lrow
lnext inc sidx
 jmp lsh
lfin
 lda remh
 ora remh+1
 bne lfin2
 lda rpos
 clc
 adc #2
 cmp rlen
 bcs lfin3
lfin2 jsr rdb
 jmp lfin
lfin3 jsr fclose
 lda #1
 sta msg
 lda crc
 cmp scrc
 bne lbad
 lda crc+1
 cmp scrc+1
 bne lbad
 lda sum
 cmp hsum
 bne lbad
 lda sum+1
 cmp hsum+1
 bne lbad
 jmp lend
lbad lda #7
 sta msg
lend lda #0
 sta cr
 sta cc
 sta vr0
 sta vc0
 sta dirty
 rts

rdnum
 ldy #4
rn1 jsr rdb
 sta RECB,y
 iny
 cpy #10
 bne rn1
 rts

hmag dta c'CRFT'
