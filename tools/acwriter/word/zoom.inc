; PAGE mode 2x zoom (image Z, id 3). A sub-view of PAGE mode: the page is drawn with the Craft 8x8 face (zfont.inc) doubled
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
 sta fzf
 sta fzp
 lda fpn
 beq pzd0
 ldx top
 jsr fpara
 sta fzp
pzd0 lda #0
 sta pwii
pzd1 lda pwii
 asl
 asl
 asl
 asl
 jsr ypos
 jsr pzclr
 lda #0
 sta pwsp
 lda top
 clc
 adc pwii
 sta t0
 cmp nl
 bcs pzd8
 lda fpn
 beq pzd1a
 lda fzp
 jsr ffind
 sta fzf
pzd1a ldx t0
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
 bcs pzd3
 cmp #11
 bne pzda
 lda pwsp
 eor #1
 jmp pzdb
pzda cmp #12
 bne pzd2
 lda pwsp
 eor #2
pzdb sta pwsp
 jmp pzd2
pzd3 jsr pzmap
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
pzd9 lda fpn
 beq pzd9b
 lda t0
 clc
 adc #1
 cmp nl
 bcs pzd9b
 tax
 lda LPL,x
 sec
 sbc #1
 sta tp
 lda LPH,x
 sbc #0
 sta tp+1
 ldy #0
 lda (tp),y
 cmp #13
 bne pzd9b
 inc fzp
pzd9b inc pwii
 lda pwii
 cmp #9
 beq pzd9c
 jmp pzd1
pzd9c rts

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
 lda fzf
 beq pzbr
 asl
 asl
 clc
 adc #$3C
 clc
 adc src+1
 sta src+1
 jsr fb_get8
 lda #<FG8
 sta src
 lda #>FG8
 sta src+1
 jmp pzbg
pzbr lda src+1
 cmp #3
 bcc pzbq
 sbc #1
pzbq sta src+1
 lda src
 clc
 adc #<zfont
 sta src
 lda src+1
 adc #>zfont
 sta src+1
pzbg lda pwsc
 asl
 clc
 adc sp
 sta gp
 lda sp+1
 adc #0
 sta gp+1
 lda pwsp
 beq pzbn
 jmp pzss
pzbn lda #0
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

; sup / sub: 5 (capital-set) or 4 (x-height set) source rows doubled; superscript at the top of the cell, subscript 6 scanlines lower
pzss ldy #0
 lda (src),y
 ldy #1
 ora (src),y
 beq pzs0
 lda #0
 ldx #0
 beq pzs1
pzs0 lda #80
 ldx #6
pzs1 stx pwvy
 ldy pwsp
 cpy #2
 bne pzs2
 pha
 lda gp
 clc
 adc #240
 sta gp
 bcc pzs8
 inc gp+1
pzs8 pla
pzs2 clc
 adc gp
 sta gp
 bcc pzs3
 inc gp+1
pzs3 ldy pwvy
 lda pzrl,y
 bmi pzs9
 tay
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
 bcc pzs4
 inc gp+1
pzs4 inc pwvy
 jmp pzs3
pzs9 rts
pzrl dta 0,1,3,4,5,$FF,2,3,4,5,$FF

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

 icl 'zfont.inc'
pzdbl dta b($00),b($03),b($0C),b($0F),b($30),b($33),b($3C),b($3F)
 dta b($C0),b($C3),b($CC),b($CF),b($F0),b($F3),b($FC),b($FF)
