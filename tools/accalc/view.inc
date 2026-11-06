; Screen: ANTIC mode F, 320x192 1 bit, 40 text columns x 24 lines of 8x8 Craft glyphs (zfont).
;   line 0 entry bar, line 1 column letters, lines 2..22 grid rows, line 23 status.
lpi = $1511
lpk = $1512
xend = $1513

; A = character 32..127 at (gx,gy), inverse when invm = $FF
putch
 sec
 sbc #32
 sta gp
 lda #0
 sta gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 clc
 lda gp
 adc #<zfont
 sta gp
 lda gp+1
 adc #>zfont
 sta gp+1
 ldx gy
 lda LROWL,x
 clc
 adc gx
 sta scp
 lda LROWH,x
 adc #0
 sta scp+1
 ldx #8
pc1 ldy #0
 lda (gp),y
 eor invm
 sta (scp),y
 inc gp
 bne pc2
 inc gp+1
pc2 lda scp
 clc
 adc #40
 sta scp
 bcc pc3
 inc scp+1
pc3 dex
 bne pc1
 rts

pcx cmp #32
 bcc pq
 cmp #128
 bcc pok
pq lda #'?'
pok jsr putch
 inc gx
 rts

mklines
 lda #<SCR
 sta ptr
 lda #>SCR
 sta ptr+1
 ldx #0
ml1 lda ptr
 sta LROWL,x
 lda ptr+1
 sta LROWH,x
 clc
 lda ptr
 adc #<320
 sta ptr
 lda ptr+1
 adc #>320
 sta ptr+1
 inx
 cpx #24
 bne ml1
 rts

; but each text line is 8 pixel lines = 8*40 bytes
; (LROW is advanced by 320 bytes per text line)

clrscr
 lda #<SCR
 sta ptr
 lda #>SCR
 sta ptr+1
 ldx #30                     ; 7680 bytes = 30 pages
 ldy #0
 tya
cs1 sta (ptr),y
 iny
 bne cs1
 inc ptr+1
 dex
 bne cs1
 rts

; ---- layout
layout
 lda #0
 sta lpi
 lda #3
 sta t1
lo1 lda vc0
 clc
 adc lpi
 cmp #NCOLS
 bcs lo9
 tax
 lda CW,x
 sta t2
 lda t1
 clc
 adc t2
 cmp #41
 bcs lo9
 sta t3
 ldx lpi
 lda t1
 sta VCX,x
 lda t2
 sta VCW,x
 lda t3
 sta t1
 inc lpi
 jmp lo1
lo9 lda lpi
 bne lo10
 ; a column wider than the screen cannot happen (widths are clamped to 12)
 lda #1
 sta lpi
lo10 sta nvc
 rts

; make the cursor visible; returns A <> 0 when the view moved
visible
 lda #0
 sta t3
 lda cr
 cmp vr0
 bcs vi1
 sta vr0
 inc t3
vi1 lda vr0
 clc
 adc #VROWS
 cmp cr
 beq vi2
 bcs vi3
vi2 lda cr
 sec
 sbc #VROWS-1
 sta vr0
 inc t3
vi3 lda cc
 cmp vc0
 bcs vi4
 sta vc0
 inc t3
vi4 jsr layout
 lda vc0
 clc
 adc nvc
 cmp cc
 beq vi5
 bcs vi6
vi5 inc vc0
 inc t3
 jmp vi4
vi6 lda t3
 rts

; fill the rest of line gy from gx to the right edge with spaces
fillto
 lda gx
 cmp #40
 bcs fl9
 lda #32
 jsr pcx
 jmp fillto
fl9 rts

; ---- cell text: record in RECB, fitw = width available; result in TMPS (len first)
ERRT
 dta c'#DIV/0!',b(0)
 dta c'#VALUE!',b(0)
 dta c'#REF!',b(0),b(0),b(0)
 dta c'#NAME?',b(0),b(0)
 dta c'#NUM!',b(0),b(0),b(0)
 dta c'#N/A',b(0),b(0),b(0),b(0)
 dta c'#CIRC!',b(0),b(0)
 dta c'#NULL!',b(0),b(0)
 dta c'#PARSE!',b(0)

ctext
 lda RECB+1
 beq ct0
 cmp #1
 beq ctn
 cmp #2
 beq cts
 cmp #4
 beq cte
 cmp #5
 beq ctb
ct0 lda #0
 sta TMPS
 rts
cts lda RECB+4
 sta rp
 lda RECB+5
 sta rp+1
 jmp hget
ctn ldx #5
ctn1 lda RECB+4,x
 sta BV,x
 dex
 bpl ctn1
 lda RECB+2
 cmp #8
 bcc ctn2
 lda #0
ctn2 jsr fmtnum
nums2t
 ldx nlen
 stx TMPS
 beq ctn4
ctn3 lda NUMS-1,x
 sta TMPS,x
 dex
 bne ctn3
ctn4 rts
cte lda RECB+4
 cmp #9
 bcc cte1
 lda #1
cte1 asl
 asl
 asl
 tax
 ldy #0
cte2 lda ERRT,x
 beq cte3
 iny
 sta TMPS,y
 inx
 cpy #8
 bne cte2
cte3 sty TMPS
 rts
ctb lda RECB+4
 bne ctb1
 ldx #5
ctb0 lda BTXF-1,x
 sta TMPS,x
 dex
 bne ctb0
 lda #5
 sta TMPS
 rts
ctb1 ldx #4
ctb3 lda BTXT-1,x
 sta TMPS,x
 dex
 bne ctb3
 lda #4
 sta TMPS
 rts
BTXT dta c'TRUE'
BTXF dta c'FALSE'
