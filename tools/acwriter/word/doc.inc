; key handling
handle
 lda sv_on
 beq hn_s
 jmp spkey
hn_s lda ed_rp
 beq hn_r
 jmp exrkey
hn_r lda ed_on
 beq hn_e
 jsr expre
 bcc hn_e
 rts
hn_e lda pkon
 beq hn00
 jmp pkkey
hn00 lda cmdon
 beq hn0
 jsr cmdkey
 lda hmode
 beq hnr
 cmp #PGV
 beq hnr
 jmp pgafter
hnr rts
hn0 lda hmode
 beq hn0z
 cmp #PGV
 beq hn0z
 jmp pagekey
hn0z lda kk
 cmp #$F1
 bne hn0y
 lda #2
 jmp pgto
hn0y lda mn
 beq hn0a
 jmp menukey
hn0a lda kk
 cmp #$1B
 bne hn0b
 jmp menuopen
hn0b lda kk
 cmp #$18
 bne hn0k
 jmp cmdopen
hn0k cmp #$0B
 bne hn0m
 jmp hspell
hn0m jsr exkeys
 bcc hn0n
 rts
hn0n lda kk
hn1 cmp #$7F
 bne hn2
 lda hmode
 cmp #PGV
 bne hn1a
 jmp pwtab
hn1a jmp ribnext
hn2 cmp #$1C
 bne h1
 jmp kup
h1 cmp #$1D
 bne h2
 jmp kdown
h2 cmp #$1E
 bne h3
 jmp kleft
h3 cmp #$1F
 bne h4
 jmp kright
h4 cmp #$7E
 bne h5
 jmp delete
h5 cmp #$9B
 bne h6
 lda #13
 jmp insert
h6 cmp #2
 bne h7
 lda #1
 jmp insert
h7 cmp #9
 bne h8
 lda hmode
 cmp #PGV
 bne h7a
 jmp pwtab
h7a lda #2
 jmp insert
h8 cmp #$15
 bne h9
 lda #3
 jmp insert
h9 cmp #32
 bcc hx
 cmp #127
 bcs hx
 jmp insert
hx rts

; X = line; A = paragraph attribute marker found in the first line's header within pcs..pch1-1
; (0 = none); pal = the paragraph's first line, pidx = the marker's offset
pfind stx pal
pfd0 ldx pal
 beq pfd2
 dex
 lda LPL,x
 sta src
 lda LPH,x
 sta src+1
 ldy #0
pfd1 lda (src),y
 beq pfd2
 cmp #13
 beq pfd2
 cmp #14
 beq pfd3
 iny
 bne pfd1
 beq pfd2
pfd3 stx pal
 jmp pfd0
pfd2 ldx pal
 lda LPL,x
 sta src
 lda LPH,x
 sta src+1
 ldy #0
pfd4 lda (src),y
 cmp #5
 bcc pfd8
 cmp #13
 bcc pfd6
 cmp #15
 bcc pfd8
 cmp #32
 bcs pfd8
pfd6 cmp pcs
 bcc pfd5
 cmp pch1
 bcc pfd9
pfd5 iny
 bne pfd4
pfd8 lda #0
pfd9 sty pidx
 ora #0
 rts

; alignment marker (15 centre, 16 right, 17 justify) of the paragraph at line X
paln lda #15
 sta pcs
 lda #18
 sta pch1
 jmp pfind

; X = line; A = text width after indent and bullet; pof = offset, pbu = bullet marker
lwid stx lwx
 lda #0
 sta pof
 lda #18
 sta pcs
 lda #19
 sta pch1
 ldx lwx
 jsr pfind
 beq lw1
 lda lwx
 cmp pal
 bne lw1
 lda #4
 sta pof
lw1 lda #19
 sta pcs
 lda #21
 sta pch1
 ldx lwx
 jsr pfind
 sta pbu
 beq lw2
 lda pof
 clc
 adc #2
 sta pof
lw2 lda #25
 sta pcs
 lda #31
 sta pch1
 ldx lwx
 jsr pfind
 sta pwi
 lda #5
 sta pcs
 lda #11
 sta pch1
 ldx lwx
 jsr pfind
 beq lwh1
 sec
 sbc #4
 asl
 asl
 sta lht
 lda pwi
 bne lwh2
 lda #26
 sta pwi
 bne lwh2
lwh1 lda #8
 sta lht
lwh2 lda rm
 sec
 sbc lm
 clc
 adc #1
 sec
 sbc pof
 ldx pwi
 beq lw3
 jmp szcap
lw3 rts
; X = line; A = style bits carried into it from earlier lines of its paragraph
pstyle stx psl
 jsr paln
 lda #0
 sta psb
 lda pal
 sta psx
pst1 lda psx
 cmp psl
 bcs pst9
 tax
 lda LPL,x
 sta src
 lda LPH,x
 sta src+1
 ldy #0
pst2 lda (src),y
 beq pst3
 cmp #13
 beq pst3
 cmp #14
 beq pst3
 cmp #5
 bcs pst5
 tax
 lda stab-1,x
 eor psb
 sta psb
pst4 iny
 bne pst2
pst5 cmp #11
 bcc pst4
 cmp #13
 bcs pst4
 tax
 lda stb2-11,x
 eor psb
 sta psb
 jmp pst4
pst3 inc psx
 jmp pst1
pst9 lda psb
 rts

; keep the cursor after the paragraph header markers
fixcc ldx cl
 lda LPL,x
 sta src
 lda LPH,x
 sta src+1
 ldy #0
fx1 lda (src),y
 cmp #5
 bcc fx2
 cmp #13
 bcc fx1b
 cmp #15
 bcc fx2
 cmp #32
 bcs fx2
fx1b iny
 bne fx1
fx2 cpy cc
 bcc fx3
 sty cc
fx3 rts

curptr
 ldx cl
 lda LPL,x
 clc
 adc cc
 sta src
 lda LPH,x
 adc #0
 sta src+1
 rts

; A = style bits in effect at the cursor (1 bold, 2 italic, 4 underline)
curstyle
 ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldx cl
 jsr pstyle
 sta cst
 ldy #0
cs1 cpy cc
 beq cs2
 lda (tp),y
 cmp #5
 bcs cs3
 tax
 lda stab-1,x
 eor cst
 sta cst
cs3 iny
 bne cs1
cs2 lda cst
 and #7
 rts

linelen
 ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldy #0
ll1 lda (tp),y
 beq ll2
 cmp #13
 beq ll2
 cmp #14
 beq ll2
 iny
 bne ll1
ll2 tya
 rts

clamp
 jsr linelen
 cmp cc
 bcs cl1
 sta cc
cl1 rts

kup
 lda cl
 beq ku1
 dec cl
 jsr clamp
ku1 rts

kdown
 lda cl
 clc
 adc #1
 cmp nl
 bcs kd1
 inc cl
 jsr clamp
kd1 rts

kleft
 lda cc
 beq kl1
 dec cc
kl1 rts

kright
 jsr linelen
 cmp cc
 beq kr1
 inc cc
kr1 rts

memup
 lda dend
 sec
 sbc src
 sta lo
 lda dend+1
 sbc src+1
 sta hi
 lda dend
 clc
 adc #1
 sta gp
 lda dend+1
 adc #0
 sta gp+1
 lda dend
 clc
 adc #2
 sta sp
 lda dend+1
 adc #0
 sta sp+1
 lda src
 clc
 adc #1
 sta dst
 lda src+1
 adc #0
 sta dst+1
 ldx hi
 beq mu2
mu1 dec gp+1
 dec sp+1
 ldy #0
mu1b dey
 lda (gp),y
 sta (sp),y
 cpy #0
 bne mu1b
 dex
 bne mu1
mu2 ldy lo
mu3 lda (src),y
 sta (dst),y
 dey
 cpy #$FF
 bne mu3
 rts

insert
 sta tmp
 lda dend+1
 cmp #$90
 bcc ins0
 rts
ins0 jsr curptr
 jsr memup
 inc16 dend
in4 ldy #0
 lda tmp
 sta (src),y
 cmp #13
 beq in4b
 cmp #14
 bne in5
in4b inc cl
 lda #0
 sta cc
 lda #2
 sta fl
 jmp scan
in5 inc cc
 lda #1
 sta fl
 ldx cl
 inx
in7 cpx nl
 bcs in8
 inc LPL,x
 bne in9
 inc LPH,x
in9 inx
 bne in7
in8 jsr reflow
 lda fl
 cmp #2
 beq in6
 jsr linelen
 cmp cc
 bne in6
 lda #3
 sta fl
in6 rts

; reflow: line breaks made by wrap are soft (byte 14). Starting at the cursor line (or the
; line above when that one ends in a soft break) join each soft break back into a space,
; then re-break at the last space that fits the right margin. Stops early once a break
; lands where it already was, since everything below is then unchanged.
reflow
 lda #0
 sta rfc
 sta rfj
 lda rm
 sec
 sbc lm
 clc
 adc #1
 sta cst
 lda cl
 sta rfl
 beq rf1
 tax
 dex
 jsr rfptr
 jsr rfterm
 cmp #14
 bne rf1
 dec rfl
rf1 lda #0
 sta rfj
 lda #$FF
 sta rfk
 ldx rfl
 jsr lwid
 sta cst
 ldx rfl
 jsr rfptr
 jsr rfterm
 cmp #14
 bne rf3
 sty rfk
 lda #32
 sta (tp),y
 lda cl
 sec
 sbc rfl
 cmp #1
 bne rf3
 lda cl
 sec
 sbc #1
 sta cl
 lda cc
 clc
 adc rfk
 clc
 adc #1
 sta cc
 lda #1
 sta rfj
rf3 ldy #0
 sty hi
 lda #$FF
 sta lo
rf4 lda (tp),y
 beq rf8
 cmp #13
 beq rf8
 cmp #5
 bcc rf7
 cmp #13
 bcc rf7
 cmp #15
 bcc rfv
 cmp #32
 bcc rf7
rfv cmp #32
 bne rf6
 lda hi
 cmp cst
 beq rf5
 bcs rf6
rf5 sty lo
rf6 inc hi
rf7 iny
 bne rf4
rf8 lda hi
 cmp cst
 beq rf9
 bcs rf10
rf9 lda rfk
 cmp #$FF
 beq rfdone
 lda #1
 sta rfc
 jsr scan
 jmp rf1
rf10 lda lo
 cmp #$FF
 bne rf11
 lda rfk
 cmp #$FF
 beq rfnos
 bne rfsame
rf11 lda lo
 cmp rfk
 beq rfsame
 tay
 lda #14
 sta (tp),y
 lda cl
 cmp rfl
 bne rf12
 lda lo
 cmp cc
 bcs rf12
 lda cc
 sec
 sbc lo
 sec
 sbc #1
 sta cc
 inc cl
rf12 lda #1
 sta rfc
 inc rfl
 jsr scan
 jmp rf1
rfsame ldy rfk
 lda #14
 sta (tp),y
 lda rfj
 beq rfdone
 inc cl
 lda cc
 sec
 sbc rfk
 sec
 sbc #1
 sta cc
 jmp rfdone
rfnos lda cl
 cmp rfl
 bne rfdone
 lda cc
 beq rfdone
 dec cc
 lda #14
 jsr insert
 inc cc
 lda #2
 sta fl
 rts
rfdone lda rfc
 beq rfret
 lda #2
 sta fl
rfret rts

rfptr lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 rts

rfterm ldy #0
rft1 lda (tp),y
 beq rft2
 cmp #13
 beq rft2
 cmp #14
 beq rft2
 iny
 bne rft1
rft2 rts

delete
 lda cc
 bne dl1
 lda cl
 beq dlx
 ldx cl
 lda LPL,x
 sec
 sbc #1
 sta src
 lda LPH,x
 sbc #0
 sta src+1
 dex
 lda src
 sec
 sbc LPL,x
 sta cc
 dec cl
 lda #2
 sta fl
 jmp dl2
dl1 dec cc
 jsr curptr
 lda #1
 sta fl
dl2 ldy #1
 lda (src),y
 ldy #0
 sta (src),y
 cmp #0
 beq dl3
 inc16 src
 jmp dl2
dl3 jsr scan
 jmp reflow
dlx rts

; status line
