; PAGE mode 2x zoom (image Z, id 3). A sub-view of PAGE mode: the page is drawn with the OS ROM 8x8 glyphs doubled
; to 16x16 cells, 20 columns by 9 lines, scrolled sideways (pwx) to follow the cursor. The editing engine is the
; normal one; pzmain replaces pwmain while pzoom = 1. Style codes are not drawn (plain glyphs). docs/ACWRITER-PAGE.md.

; Layout > Page > Z: toggle the zoom
hpgz lda hmode
 cmp #PGV
 bne pzrts
 lda pzoom
 eor #1
 sta pzoom
 lda #2
 sta fl
pzrts rts

; per key redraw, called by the main loop instead of pwmain
pzmain jsr pzcv
 lda pwcv
 clc
 adc pwplm
 sta pwcc
 cmp pwx
 bcs pz1
 sta pwx
 jmp pz3
pz1 sec
 sbc pwx
 cmp #19
 bcc pz3
 lda pwcc
 sec
 sbc #18
 sta pwx
pz3 lda cl
 cmp top
 bcs pz4
 sta top
pz4 lda cl
 sec
 sbc top
 cmp #9
 bcc pz5
 lda cl
 sec
 sbc #8
 sta top
pz5 jsr pzdraw
 lda #0
 sta fl
 rts

; cursor column = visible characters before the cursor on its line
pzcv ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldy #0
 sty pwcv
pzc1 cpy cc
 beq pzc9
 lda (tp),y
 beq pzc9
 cmp #32
 bcc pzc2
 inc pwcv
pzc2 iny
 bne pzc1
pzc9 rts

; the 9 text lines of 16 scanlines each (text area = 144 of its 156 scanlines)
pzdraw lda #0
 sta pwii
pzd1 lda pwii
 asl
 asl
 asl
 asl
 jsr ypos
 jsr pzclr
 lda top
 clc
 adc pwii
 sta t0
 cmp nl
 bcs pzd8
 tax
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 lda #0
 sta v
 sta hi
pzd2 ldy v
 lda (tp),y
 beq pzd8
 cmp #13
 beq pzd8
 cmp #14
 beq pzd8
 inc v
 cmp #32
 bcc pzd2
 jsr pzmap
 sta pwch
 lda hi
 clc
 adc pwplm
 sec
 sbc pwx
 bcc pzd7
 cmp #20
 bcs pzd8
 sta pwsc
 lda pwch
 beq pzd7
 jsr pzblit
pzd7 inc hi
 jmp pzd2
pzd8 lda t0
 cmp cl
 bne pzd9
 jsr pzcur
pzd9 inc pwii
 lda pwii
 cmp #9
 bne pzd1
 rts

; A = character code 32.. -> OS ROM screen code (0 = blank)
pzmap cmp #127
 bcc pzm1
 cmp #160
 beq pzsp
 cmp #173
 beq pzhy
 lda #'?'
 bne pzm1
pzsp lda #32
 bne pzm1
pzhy lda #'-'
pzm1 cmp #96
 bcs pzm2
 sec
 sbc #32
pzm2 rts

; clear 16 scanlines at sp
pzclr lda sp
 sta gp
 lda sp+1
 sta gp+1
 ldx #16
pzk1 lda #0
 ldy #39
pzk2 sta (gp),y
 dey
 bpl pzk2
 lda gp
 clc
 adc #40
 sta gp
 bcc pzk3
 inc gp+1
pzk3 dex
 bne pzk1
 rts

; A = screen code 1..127, pwsc = column 0..19, sp = line top: 8 ROM rows doubled both ways
pzblit sta src
 lda #0
 sta src+1
 asl src
 rol src+1
 asl src
 rol src+1
 asl src
 rol src+1
 lda src+1
 clc
 adc #$E0
 sta src+1
 lda pwsc
 asl
 clc
 adc sp
 sta gp
 lda sp+1
 adc #0
 sta gp+1
 lda #0
 sta pwvy
pzb1 ldy pwvy
 lda (src),y
 sta pwvx
 lsr
 lsr
 lsr
 lsr
 tax
 lda pzdbl,x
 ldy #0
 sta (gp),y
 ldy #40
 sta (gp),y
 lda pwvx
 and #15
 tax
 lda pzdbl,x
 ldy #1
 sta (gp),y
 ldy #41
 sta (gp),y
 lda gp
 clc
 adc #80
 sta gp
 bcc pzb2
 inc gp+1
pzb2 inc pwvy
 lda pwvy
 cmp #8
 bne pzb1
 rts

; invert the 16x16 cell at the cursor column
pzcur lda pwcv
 clc
 adc pwplm
 sec
 sbc pwx
 bcc pzx9
 cmp #20
 bcs pzx9
 asl
 clc
 adc sp
 sta gp
 lda sp+1
 adc #0
 sta gp+1
 ldx #16
pzx1 ldy #0
 lda (gp),y
 eor #$FF
 sta (gp),y
 iny
 lda (gp),y
 eor #$FF
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc pzx2
 inc gp+1
pzx2 dex
 bne pzx1
pzx9 rts

pzdbl dta b($00),b($03),b($0C),b($0F),b($30),b($33),b($3C),b($3F)
 dta b($C0),b($C3),b($CC),b($CF),b($F0),b($F3),b($FC),b($FF)
