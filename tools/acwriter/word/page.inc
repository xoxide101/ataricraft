; PAGE mode (hmode = 4): a true-width page view. The editing engine is the normal one (insert, delete,
; reflow, cursor keys); only the drawing differs. The page is up to 144 columns of 4 px cells with the
; 12-row Craft cell (2 headroom rows, cap line, baseline, 3 descender rows), so lines advance 12 scanlines.
; Paper columns are scrolled horizontally to follow the cursor. Docs: docs/ACWRITER-PAGE.md.

; --------------------------------------------------------------- commands (Layout menu)
hpgv lda hmode
 cmp #PGV
 beq pwleave
 cmp #0
 bne pwrts
 lda lm
 sta pwsl
 lda rm
 sta pwsr
 lda #PGV
 sta hmode
 lda #0
 sta pwx
 sta pwsp
 jsr pwcalc
 jsr pwsetlm
 jsr pwrewrap
 lda cl
 sta pwol
 jmp pwdone
pwleave lda #0
 sta hmode
 lda pwsl
 sta lm
 lda pwsr
 sta rm
 jsr pwrewrap
 lda #$FF
 sta t0
 lda #2
 sta fl
 lda #1
 sta bd
 jsr ribbon
 jmp status
pwrts rts
pwdone lda #2
 sta fl
 lda #1
 sta bd
 rts

hpgpap lda pwpap
 clc
 adc #1
 cmp #3
 bcc pwp1
 lda #0
pwp1 sta pwpap
 jmp pwapply
hpgpit lda pwpit
 clc
 adc #1
 cmp #3
 bcc pwq1
 lda #0
pwq1 sta pwpit
 jsr pwdefm
 lda #0
 sta pwnt
 jmp pwapply
hpglm lda pwplm
 clc
 adc #1
 cmp #11
 bcc pwm1x
 lda #0
pwm1x sta pwplm
 jmp pwapply
hprm lda pwprm
 clc
 adc #1
 cmp #11
 bcc pwn1x
 lda #0
pwn1x sta pwprm
 jmp pwapply
hpgtl lda #0
 beq pwtset
hpgtc lda #1
 bne pwtset
hpgtr lda #2
pwtset sta pwb
 lda hmode
 cmp #PGV
 bne pwtx9
 jsr pwcvis
 lda pwcv
 clc
 adc pwplm
 sta pwcc
 ldx #0
pwt1 cpx pwnt
 bcs pwt3
 lda pwtp,x
 cmp pwcc
 beq pwt4
 inx
 bne pwt1
pwt3 cpx #8
 bcs pwtx9
 inc pwnt
 lda pwcc
 sta pwtp,x
pwt4 lda pwb
 sta pwtk,x
 lda #2
 sta fl
pwtx9 rts
hpgtx lda #0
 sta pwnt
 lda #2
 sta fl
 rts

pwdefm ldx pwpit
 lda pwdlm,x
 sta pwplm
 lda pwdrm,x
 sta pwprm
 rts

; derived values from paper, pitch and margins
pwcalc lda pwpap
 asl
 clc
 adc pwpap
 clc
 adc pwpit
 tax
 lda pwpc,x
 sta pwcols
 sec
 sbc pwplm
 sec
 sbc pwprm
 sta pwwid
 ldx pwpap
 lda pwln,x
 sec
 sbc #12
 sta pwlpp
 rts

pwsetlm lda #0
 sta lm
 lda pwwid
 sec
 sbc #1
 sta rm
 rts

pwapply jsr pwcalc
 lda hmode
 cmp #PGV
 bne pwap9
 jsr pwsetlm
 jsr pwrewrap
 lda #2
 sta fl
pwap9 rts

; re-break every paragraph at the current width, keeping the cursor on the same byte
pwrewrap jsr curptr
 lda src
 sta pwo
 lda src+1
 sta pwo+1
 lda #0
 sta pwii
pww1 lda pwii
 cmp nl
 bcs pww2
 sta cl
 lda #0
 sta cc
 jsr reflow
 inc pwii
 jmp pww1
pww2 jsr scan
 lda #0
 sta cl
 ldx #1
pww3 cpx nl
 bcs pww5
 lda pwo
 cmp LPL,x
 lda pwo+1
 sbc LPH,x
 bcc pww5
 stx cl
 inx
 bne pww3
pww5 ldx cl
 lda pwo
 sec
 sbc LPL,x
 sta cc
 jmp fixcc

; --------------------------------------------------------------- per key redraw (main loop, PAGE mode)
pwmain lda dend+1
 cmp #$90
 bcc pwm0a
 jmp pwleave
pwm0a lda #0
 sta pwchg
 jsr pwcvis
 lda cl
 cmp top
 bcs pwm1b
 sta top
 inc pwchg
pwm1b lda cl
 sec
 sbc top
 cmp #13
 bcc pwm2b
 lda cl
 sec
 sbc #12
 sta top
 inc pwchg
pwm2b lda pwcols
 sec
 sbc #80
 cmp pwx
 bcs pwm3
 sta pwx
 inc pwchg
pwm3 lda pwcv
 clc
 adc pwplm
 sta pwcc
 cmp pwx
 bcc pwm4
 sec
 sbc pwx
 cmp #2
 bcs pwm5
pwm4 lda pwcc
 sec
 sbc #2
 bcs pwm6
 lda #0
pwm6 cmp pwx
 beq pwm8
 sta pwx
 inc pwchg
 bne pwm8
pwm5 cmp #78
 bcc pwm8
 lda pwcc
 sec
 sbc #77
 sta pwx
 inc pwchg
pwm8 lda pwchg
 bne pwmf
 lda fl
 cmp #2
 beq pwmf
 lda pwol
 cmp cl
 beq pwm9
 jsr pwdrawl
pwm9 lda cl
 jsr pwdrawl
 jmp pwm10
pwmf jsr pwfull
pwm10 lda cl
 sta pwol
 lda #0
 sta fl
 rts

; Tab: spaces up to the next tab stop right of the cursor, else the next multiple of 5 (all kinds act as left tabs)
pwtab jsr pwcvis
 lda pwcv
 clc
 adc pwplm
 sta pwa
 lda #5
pwy0 cmp pwa
 bcc pwy0a
 bne pwy3
pwy0a clc
 adc #5
 bne pwy0
pwy3 sta pwb
 ldx pwnt
 beq pwy8
pwy1 lda pwtp-1,x
 cmp pwa
 bcc pwy2
 beq pwy2
 cmp pwb
 bcs pwy2
 sta pwb
pwy2 dex
 bne pwy1
pwy8 lda pwb
 sec
 sbc pwa
 sta pwa
pwy9 lda #32
 jsr insert
 dec pwa
 bne pwy9
 rts

; cursor column = characters before the cursor on its line
pwcvis ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldy #0
 sty pwcv
pwv1 cpy cc
 beq pwv9
 lda (tp),y
 beq pwv9
 cmp #32
 bcc pwv2
 inc pwcv
pwv2 iny
 bne pwv1
pwv9 rts

; draw line A if it is on screen
pwdrawl sta t0
 sec
 sbc top
 bcc pwd9
 cmp #13
 bcs pwd9
 sta pwrow
 jsr pwypos
 jmp pwline
pwd9 rts

; sp = top scanline of text row pwrow
pwypos lda pwrow
 asl
 asl
 sta pwcc
 asl
 clc
 adc pwcc
 jmp ypos

pwfull lda #0
 sta pwrow
pwf1 jsr pwypos
 lda top
 clc
 adc pwrow
 sta t0
 jsr pwline
 inc pwrow
 lda pwrow
 cmp #13
 bne pwf1
 lda #156
 jsr ypos
 lda sp
 sta gp
 lda sp+1
 sta gp+1
 ldx #4
 jsr pwclr
 jsr pwruler
 rts

; clear X text scanlines at gp (40 bytes each)
pwclr lda #0
 ldy #39
pwc1 sta (gp),y
 dey
 bpl pwc1
 lda gp
 clc
 adc #40
 sta gp
 bcc pwc2
 inc gp+1
pwc2 dex
 bne pwclr
 rts

; draw document line t0 into the 12 scanlines at sp
pwline lda sp
 sta gp
 lda sp+1
 sta gp+1
 ldx #12
 jsr pwclr
 lda t0
 beq pwl0
 sec
pwl00 sbc pwlpp
 beq pwl01
 bcs pwl00
 bcc pwl0
pwl01 ldy #39
 lda #$AA
pwl02 sta (sp),y
 dey
 bpl pwl02
pwl0 lda t0
 cmp nl
 bcc pwj4
 jmp pwl8
pwj4
 tax
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 lda #0
 sta v
 sta hi
 sta pwsp
 lda #80
 sta lo
pwl1 ldy v
 lda (tp),y
 beq pwl8
 cmp #13
 beq pwl8
 cmp #14
 beq pwl8
 inc v
 cmp #32
 bcs pwl3
 cmp #11
 bne pwl2
 lda pwsp
 eor #1
 bne pwls
pwl2 cmp #12
 bne pwl1
 lda pwsp
 eor #2
pwls sta pwsp
 lda #80
 ldx pwsp
 beq pwlx
 lda #200
 cpx #2
 beq pwlx
 lda #0
pwlx sta lo
 jmp pwl1
pwl3 cmp #127
 bcc pwl4
 cmp #160
 beq pwsp1
 cmp #173
 beq pwhy
 lda #'?'
 bne pwl4
pwsp1 lda #32
 bne pwl4
pwhy lda #'-'
pwl4 sta pwch
 lda hi
 clc
 adc pwplm
 sec
 sbc pwx
 bcc pwl7
 cmp #80
 bcs pwl7
 sta pwsc
 lda pwch
 cmp #32
 beq pwl7
 jsr pwblit
pwl7 inc hi
 jmp pwl1
pwl8 lda t0
 cmp cl
 bne pwl9
 jsr pwcur
pwl9 rts

; block cursor over the cell at the cursor column (rows 2..9)
pwcur lda pwcv
 clc
 adc pwplm
 sec
 sbc pwx
 bcc pwcx
 cmp #80
 bcs pwcx
 sta pwsc
 lda sp
 clc
 adc #80
 sta gp
 lda sp+1
 adc #0
 sta gp+1
 lda pwsc
 lsr
 tay
 lda #$F0
 bcc pwcu1
 lda #$0F
pwcu1 sta pwcc
 ldx #8
pwcu2 lda pwcc
 eor (gp),y
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc pwcu3
 inc gp+1
pwcu3 dex
 bne pwcu2
pwcx rts

; --------------------------------------------------------------- glyph blitter
; A = character 32..127, pwsc = screen column (0..79), sp = row top, lo = byte offset of the first
; glyph row (80 normal, 0 superscript, 200 subscript). Cells are 4 px: two per byte.
.macro ge pl
 lda :pl,x
 ora (gp),y
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc @+
 inc gp+1
@
.endm
.macro go pl
 lda :pl,x
 lsr
 lsr
 lsr
 lsr
 ora (gp),y
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc @+
 inc gp+1
@
.endm
pwblit sec
 sbc #32
 tax
 lda sp
 clc
 adc lo
 sta gp
 lda sp+1
 adc #0
 sta gp+1
 lda lo
 cmp #80
 beq pwn
 jmp pwsq
pwn lda pwsc
 lsr
 tay
 bcc pwj3
 jmp pwbo
pwj3
 ge pwp2
 ge pwp3
 ge pwp4
 ge pwp5
 ge pwp6
 ge pwp7
 ge pwp8
 lda lo
 cmp #200
 beq pwbx
 lda pwtix,x
 beq pwbx
 tax
 lda pwtl-1,x
 ora (gp),y
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc pwbe1
 inc gp+1
pwbe1 lda pwtl,x
 ora (gp),y
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc pwbe2
 inc gp+1
pwbe2 lda pwtl+1,x
 ora (gp),y
 sta (gp),y
pwbx rts
pwbo go pwp2
 go pwp3
 go pwp4
 go pwp5
 go pwp6
 go pwp7
 go pwp8
 lda lo
 cmp #200
 bne pwj2
 jmp pwbx
pwj2
 lda pwtix,x
 bne pwj1
 jmp pwbx
pwj1
 tax
 lda pwtl-1,x
 lsr
 lsr
 lsr
 lsr
 ora (gp),y
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc pwbo1
 inc gp+1
pwbo1 lda pwtl,x
 lsr
 lsr
 lsr
 lsr
 ora (gp),y
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc pwbo2
 inc gp+1
pwbo2 lda pwtl+1,x
 lsr
 lsr
 lsr
 lsr
 ora (gp),y
 sta (gp),y
 rts

; sup / sub glyphs: 5 rows (lo = 0 superscript, 200 subscript). Glyphs with ink in plane row 2 or 3 draw source rows
; 2,3,5,6,8, all others rows 4..8 (docs/FONT.md). The plane address is patched into sqa4; no descender tails.
pwsq lda pwsc
 lsr
 sta pwdl
 lda #0
 rol
 sta pwdh
 lda pwp2,x
 ora pwp3,x
 beq sqa1
 lda #0
 beq sqa2
sqa1 lda #5
sqa2 sta pwvw
sqa3 ldy pwvw
 lda pwal,y
 sta sqa4+1
 lda pwah,y
 sta sqa4+2
sqa4 lda $FFFF,x
 ldy pwdh
 beq sqa5
 lsr
 lsr
 lsr
 lsr
sqa5 ldy pwdl
 ora (gp),y
 sta (gp),y
 lda gp
 clc
 adc #40
 sta gp
 bcc sqa6
 inc gp+1
sqa6 inc pwvw
 lda pwvw
 cmp #5
 beq sqa7
 cmp #10
 bne sqa3
sqa7 rts
pwal dta l(pwp2),l(pwp3),l(pwp5),l(pwp6),l(pwp8),l(pwp4),l(pwp5),l(pwp6),l(pwp7),l(pwp8)
pwah dta h(pwp2),h(pwp3),h(pwp5),h(pwp6),h(pwp8),h(pwp4),h(pwp5),h(pwp6),h(pwp7),h(pwp8)

; --------------------------------------------------------------- ruler strip
pwruler lda #<(SCR+320)
 sta gp
 lda #>(SCR+320)
 sta gp+1
 ldx #8
 jsr pwclr
 lda #<(SCR+240)
 sta sp
 lda #>(SCR+240)
 sta sp+1
 lda #80
 sta lo
 lda #0
 sta pwii
pwr1 sta pwsc
 clc
 adc pwx
 sta pwcc
 jsr pwrch
 jsr pwblit
 inc pwii
 lda pwii
 cmp #80
 bne pwr1
 rts

; A = ruler character for paper column pwcc
pwrch lda pwcc
 cmp pwplm
 bne pwk1
 lda #'['
 rts
pwk1 lda pwplm
 clc
 adc pwwid
 tax
 dex
 cpx pwcc
 bne pwk2
 lda #']'
 rts
pwk2 ldx #0
pwk3 cpx pwnt
 bcs pwk5
 lda pwtp,x
 cmp pwcc
 beq pwk4
 inx
 bne pwk3
pwk4 ldy pwtk,x
 lda pwtc,y
 rts
pwk5 lda pwcols
 lsr
 cmp pwcc
 bne pwk6
 lda #'|'
 rts
pwk6 lda pwcc
 beq pwk8
 jsr mod10
 cmp #0
 bne pwk8
 txa
 jsr mod10
 clc
 adc #'0'
 rts
pwk8 lda #'.'
 rts

pwtc dta c'LCR'
pwpc dta b(85),b(102),b(144),b(82),b(99),b(140),b(85),b(102),b(144)
pwln dta b(66),b(70),b(84)
pwdlm dta b(3),b(4),b(5)
pwdrm dta b(2),b(2),b(3)

; --------------------------------------------------------------- status line and page navigator
pwst lda #0
 sta bi
 lda #<pws1
 ldx #>pws1
 jsr putstr
 lda cl
 clc
 adc #1
 jsr putnum
 lda #<s2
 ldx #>s2
 jsr putstr
 lda pwcv
 clc
 adc #1
 jsr putnum
 lda #' '
 jsr putc
 ldx pwpap
 lda pwnl,x
 pha
 lda pwnh,x
 tax
 pla
 jsr putstr
 ldx pwpit
 lda pwil,x
 pha
 lda pwih,x
 tax
 pla
 jsr putstr
 lda #<fm
 ldx #>fm
 jsr putstr
 lda pwplm
 jsr putnum
 lda #'-'
 jsr putc
 lda pwprm
 jsr putnum
 jsr stfin
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #ROWS
 sta rr
 lda #$FF
 sta t0
 jsr rowsetup
 jsr drawtext
 jsr hls
 jmp pwnav

pws1 dta c'Ln ',b(0)
pws2 dta c' Pg ',b(0)
pwnl dta l(pwnl0),l(pwnl1),l(pwnl2)
pwnh dta h(pwnl0),h(pwnl1),h(pwnl2)
pwnl0 dta c'Letter ',b(0)
pwnl1 dta c'A4 ',b(0)
pwnl2 dta c'Legal ',b(0)
pwil dta l(pwz0),l(pwz1),l(pwz2)
pwih dta h(pwz0),h(pwz1),h(pwz2)
pwz0 dta c'10cpi',b(0)
pwz1 dta c'12cpi',b(0)
pwz2 dta c'17cpi',b(0)

; a / b scaled: A = (pwa * pwb) / pwc
pwscl lda #0
 sta pwdl
 sta pwdh
 ldx pwa
 beq pwsd1
pwsm lda pwdl
 clc
 adc pwb
 sta pwdl
 bcc pwsm2
 inc pwdh
pwsm2 dex
 bne pwsm
pwsd1 ldy #0
pwsd2 lda pwdl
 sec
 sbc pwc
 tax
 lda pwdh
 sbc #0
 bcc pwsd3
 sta pwdh
 stx pwdl
 iny
 bne pwsd2
pwsd3 tya
 rts

; 24 x 8 px mini page at the right end of the status row; the solid box is the part on screen
pwnav lda pwx
 sta pwa
 lda #22
 sta pwb
 lda pwcols
 sta pwc
 jsr pwscl
 sta pwvx
 lda #80
 ldx pzoom
 beq pwn00
 lda #20
pwn00 sta pwa
 jsr pwscl
 sta pwvw
 lda pwvx
 clc
 adc pwvw
 cmp #23
 bcc pwn0
 lda #22
 sec
 sbc pwvw
 sta pwvx
pwn0 lda top
pwn1 cmp pwlpp
 bcc pwn2
 sec
 sbc pwlpp
 bcs pwn1
pwn2 sta pwa
 lda #4
 sta pwb
 lda pwlpp
 sta pwc
 jsr pwscl
 sta pwvy
 lda #0
 sta pwm0
 sta pwm1
 sta pwm2
 ldy pwvw
 lda pwvx
 clc
 adc #1
 sta pwii
pwn3 lda pwii
 lsr
 lsr
 lsr
 tax
 lda pwii
 and #7
 sta pwcc
 stx pwch
 ldx pwcc
 lda pwbit,x
 ldx pwch
 ora pwm0,x
 sta pwm0,x
 inc pwii
 dey
 bne pwn3
 lda #ROWS
 sta rr
 jsr rowptr
 lda sp
 clc
 adc #37
 sta sp
 bcc pwn4
 inc sp+1
pwn4 ldx #0
pwn5 stx pwii
 lda #$FF
 sta pwcc
 sta pwch
 sta pwsc
 cpx #0
 beq pwn9
 cpx #7
 beq pwn9
 lda #$80
 sta pwcc
 lda #0
 sta pwch
 lda #1
 sta pwsc
 txa
 sec
 sbc #1
 cmp pwvy
 bcc pwn9
 sbc pwvy
 cmp #2
 bcs pwn9
 lda pwcc
 ora pwm0
 sta pwcc
 lda pwm1
 sta pwch
 lda pwsc
 ora pwm2
 sta pwsc
pwn9 ldy #0
 lda pwcc
 sta (sp),y
 iny
 lda pwch
 sta (sp),y
 iny
 lda pwsc
 sta (sp),y
 lda sp
 clc
 adc #40
 sta sp
 bcc pwna
 inc sp+1
pwna ldx pwii
 inx
 cpx #8
 bne pwn5
 rts
pwbit dta b($80),b($40),b($20),b($10),b(8),b(4),b(2),b(1)
