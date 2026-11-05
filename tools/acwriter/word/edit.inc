; Selection, clipboard (Cut / Copy / Paste), Find, Find next, Replace, Goto line, Home / End. See docs/EDIT.md.
; A selection is an anchor (^S mark) and the cursor, both kept as raw pointers into the document. While it
; is shown, two inverse codes (4) are inserted at its ends; they are removed again before any other work
; (ex_hloff), so the document never keeps them. The clipboard holds raw document bytes, style codes included.

.macro cmp16 a,b
 lda :a
 cmp :b
 lda :a+1
 sbc :b+1
.endm
.macro mv16 a,b
 lda :a
 sta :b
 lda :a+1
 sta :b+1
.endm

; ---------------------------------------------------------------- pointers
exgcp jsr curptr
 mv16 src,ed_cp
 rts

; ed_q -> cl, cc
exp2c ldx #0
xp1 inx
 cpx nl
 bcs xp3
 lda LPH,x
 cmp ed_q+1
 bcc xp1
 bne xp3
 lda ed_q
 cmp LPL,x
 bcs xp1
xp3 dex
 stx cl
 lda ed_q
 sec
 sbc LPL,x
 sta cc
 rts

exsrt cmp16 ed_ap,ed_cp
 bcs xs1
 mv16 ed_ap,ed_lo
 mv16 ed_cp,ed_hi
 rts
xs1 mv16 ed_cp,ed_lo
 mv16 ed_ap,ed_hi
 rts

; open a gap of ed_n bytes at ed_q; carry set = no room
exgap clc
 lda dend
 adc ed_n
 sta dst
 lda dend+1
 adc ed_n+1
 sta dst+1
 cmp #$90
 bcc xg0
 sec
 rts
xg0 mv16 dend,gp
xg1 ldy #0
 lda (gp),y
 sta (dst),y
 lda gp
 cmp ed_q
 bne xg2
 lda gp+1
 cmp ed_q+1
 beq xg9
xg2 dec16 gp
 dec16 dst
 jmp xg1
xg9 clc
 lda dend
 adc ed_n
 sta dend
 lda dend+1
 adc ed_n+1
 sta dend+1
 clc
 rts

; remove ed_n bytes at ed_q
exdel clc
 lda ed_q
 adc ed_n
 sta src
 lda ed_q+1
 adc ed_n+1
 sta src+1
 mv16 ed_q,dst
xd1 ldy #0
 lda (src),y
 sta (dst),y
 beq xd2
 inc16 src
 inc16 dst
 jmp xd1
xd2 rts

; store A at ed_q
exstb pha
 mv16 ed_q,src
 ldy #0
 pla
 sta (src),y
 rts

; copy ed_n bytes from src to dst
excpy lda ed_n
 ora ed_n+1
 beq xc9
xc1 ldy #0
 lda (src),y
 sta (dst),y
 inc16 src
 inc16 dst
 lda ed_n
 bne xc2
 dec ed_n+1
xc2 dec ed_n
 lda ed_n
 ora ed_n+1
 bne xc1
xc9 rts

; ---------------------------------------------------------------- highlight
exone lda #1
 sta ed_n
 lda #0
 sta ed_n+1
 rts

exadj cmp16 ed_ap,ed_q
 bcc xa1
 inc16 ed_ap
xa1 cmp16 ed_cp,ed_q
 bcc xa2
 inc16 ed_cp
xa2 rts

; show the selection ed_ap..ed_cp (cp = cursor) as inverse
exhlon lda ed_ap
 cmp ed_cp
 bne xh1
 lda ed_ap+1
 cmp ed_cp+1
 beq xh9
xh1 lda dend+1
 cmp #$90
 bcs xh9
 jsr exsrt
 mv16 ed_hi,ed_q
 jsr exone
 jsr exgap
 lda #4
 jsr exstb
 jsr exadj
 mv16 ed_lo,ed_q
 jsr exone
 jsr exgap
 lda #4
 jsr exstb
 jsr exadj
 mv16 ed_lo,ed_h1
 mv16 ed_hi,ed_h2
 inc16 ed_h2
 lda #1
 sta ed_hl
 jsr scan
 mv16 ed_cp,ed_q
 jsr exp2c
 lda #2
 sta fl
xh9 rts

exhloff lda ed_hl
 beq xo9
 mv16 ed_h2,ed_q
 jsr exd1
 mv16 ed_h1,ed_q
 jsr exd1
 lda #0
 sta ed_hl
 jsr scan
 mv16 ed_cp,ed_q
 jsr exp2c
 lda #2
 sta fl
xo9 rts

exd1 jsr exone
 jsr exdel
 cmp16 ed_q,ed_ap
 bcs xd1a
 dec16 ed_ap
xd1a cmp16 ed_q,ed_cp
 bcs xd1b
 dec16 ed_cp
xd1b rts

; selection off, highlight removed
exoff jsr exhloff
 lda #0
 sta ed_on
 lda #2
 sta fl
 lda #1
 sta bd
 rts

exmark lda ed_on
 beq xm1
 jmp exoff
xm1 jsr exgcp
 mv16 ed_cp,ed_ap
 lda #1
 sta ed_on
 lda #34
 sta cmsg
 lda #1
 sta bd
 rts

; ---------------------------------------------------------------- keys while a selection exists
expre jsr exhloff
 lda kk
 cmp #$1B
 bne xr1
 jsr exoff
 sec
 rts
xr1 cmp #$1C
 bne xr2
 jsr kup
 jmp xrmv
xr2 cmp #$1D
 bne xr3
 jsr kdown
 jmp xrmv
xr3 cmp #$1E
 bne xr4
 jsr kleft
 jmp xrmv
xr4 cmp #$1F
 bne xr5
 jsr kright
 jmp xrmv
xr5 cmp #1
 bne xr6
 jsr exhome
 jmp xrmv
xr6 cmp #5
 bne xr7
 jsr exend
xrmv jsr exgcp
 jsr exhlon
 sec
 rts
xr7 cmp #19
 bne xr8
 jsr exoff
 sec
 rts
xr8 cmp #25
 bne xr9
 jsr excopy
 sec
 rts
xr9 cmp #4
 bne xr10
 jsr excut
 sec
 rts
xr10 cmp #16
 bne xr11
 jsr expaste
 sec
 rts
xr11 lda #0
 sta ed_on
 clc
 rts

; keys with no selection; carry set = handled
exkeys lda kk
 ldx #9
xk1 cmp exkt,x
 beq xk2
 dex
 bpl xk1
 clc
 rts
xk2 jsr xk3
 sec
 rts
xk3 lda exjh,x
 pha
 lda exjl,x
 pha
 rts
exkt dta b(1),b(4),b(5),b(6),b(7),b(12),b(16),b(18),b(19),b(25)
exjl dta l(exhome-1),l(excut-1),l(exend-1),l(exfind-1),l(exnext-1),l(exgoto-1),l(expaste-1),l(exrepl-1),l(exmark-1),l(excopy-1)
exjh dta h(exhome-1),h(excut-1),h(exend-1),h(exfind-1),h(exnext-1),h(exgoto-1),h(expaste-1),h(exrepl-1),h(exmark-1),h(excopy-1)

; command table hook: commands other than cut/copy/paste/mark end the selection
excx ldx ed_on
 beq xcx9
 pha
 jsr exhloff
 pla
 cmp #45
 bcc xcx1
 cmp #49
 bcc xcx9
xcx1 lda #0
 sta ed_on
xcx9 rts

exhome lda #0
 sta cc
 jmp fixcc

exend jsr linelen
 sta cc
 rts

; ---------------------------------------------------------------- clipboard
; ed_lo, ed_hi, ed_n = the selection, or the cursor line when nothing is selected
exrng lda ed_on
 beq xrg1
 jsr exgcp
 jsr exsrt
 lda ed_lo
 cmp ed_hi
 bne xrg9
 lda ed_lo+1
 cmp ed_hi+1
 bne xrg9
xrg1 ldx cl
 lda LPL,x
 sta ed_lo
 lda LPH,x
 sta ed_lo+1
 inx
 cpx nl
 bcc xrg2
 mv16 dend,ed_hi
 jmp xrg9
xrg2 lda LPL,x
 sta ed_hi
 lda LPH,x
 sta ed_hi+1
xrg9 sec
 lda ed_hi
 sbc ed_lo
 sta ed_n
 lda ed_hi+1
 sbc ed_lo+1
 sta ed_n+1
 rts

; carry set (and cmsg) when ed_n is 0 or does not fit the clipboard
exfit lda ed_n
 ora ed_n+1
 bne xf1
 lda #28
 sta cmsg
 sec
 rts
xf1 lda ed_n+1
 cmp #2
 bcs xf3
 cmp #1
 bne xf2
 lda ed_n
 cmp #$81
 bcs xf3
xf2 clc
 rts
xf3 lda #29
 sta cmsg
 sec
 rts

; selection (or line) -> clipboard
exclip jsr exrng
 jsr exfit
 bcs xcl9
 mv16 ed_n,ed_cl
 mv16 ed_lo,src
 lda #<CLIP
 sta dst
 lda #>CLIP
 sta dst+1
 jsr excpy
 clc
xcl9 rts

exfin jsr exhloff
 lda #0
 sta ed_on
 lda #2
 sta fl
 lda #1
 sta bd
 rts

excopy jsr exclip
 bcs xcp9
 lda #30
 sta cmsg
xcp9 jmp exfin

excut jsr exclip
 bcs xct9
 mv16 ed_lo,ed_q
 mv16 ed_cl,ed_n
 jsr exdel
 jsr scan
 jsr exp2c
 jsr reflow
 lda #0
 sta ed_on
 lda #31
 sta cmsg
xct9 jmp exfin

expaste lda #0
 sta ed_on
 lda ed_cl
 ora ed_cl+1
 bne xpa1
 lda #35
 sta cmsg
 jmp exfin
xpa1 jsr exhloff
 jsr exgcp
 mv16 ed_cp,ed_q
 mv16 ed_cl,ed_n
 jsr exgap
 bcc xpa2
 lda #36
 sta cmsg
 jmp exfin
xpa2 mv16 ed_q,dst
 lda #<CLIP
 sta src
 lda #>CLIP
 sta src+1
 mv16 ed_cl,ed_n
 jsr excpy
 clc
 lda ed_cp
 adc ed_cl
 sta ed_ep
 lda ed_cp+1
 adc ed_cl+1
 sta ed_ep+1
 jsr scan
 mv16 ed_cp,ed_q
 jsr exp2c
 lda cl
 sta ed_l
xpa3 lda ed_l
 sta cl
 lda #0
 sta cc
 jsr reflow
 mv16 ed_ep,ed_q
 jsr exp2c
 lda ed_l
 cmp cl
 bcs xpa4
 inc ed_l
 jmp xpa3
xpa4 jmp exfin

; ---------------------------------------------------------------- find
exnorm cmp #14
 bne xn1
 lda #32
xn1 cmp #'A'
 bcc xn2
 cmp #'['
 bcs xn2
 ora #$20
xn2 rts

; first match of FND in ed_ps..ed_pe; carry set = found at ed_q
exfnd mv16 ed_ps,gp
xf10 cmp16 gp,ed_pe
 bcs xf19
 ldy #0
xf11 lda (gp),y
 jsr exnorm
 cmp FND,y
 bne xf12
 iny
 cpy ed_fl
 bcc xf11
 mv16 gp,ed_q
 sec
 rts
xf12 inc16 gp
 jmp xf10
xf19 clc
 rts

; select the match at ed_q
exmsel mv16 ed_q,ed_ap
 clc
 lda ed_q
 adc ed_fl
 sta ed_cp
 lda ed_q+1
 adc #0
 sta ed_cp+1
 lda #1
 sta ed_on
 jmp exhlon

; search forward from the cursor; carry set = selected
exfwd jsr exgcp
 mv16 ed_cp,ed_ps
 mv16 dend,ed_pe
 jsr exfnd
 bcc xfw9
 jsr exmsel
 sec
xfw9 rts

exsrch jsr exfwd
 bcs xsr1
 lda #<DOC
 sta ed_ps
 lda #>DOC
 sta ed_ps+1
 mv16 ed_cp,ed_pe
 jsr exfnd
 bcc xsr2
 jsr exmsel
xsr1 lda #38
 sta cmsg
 lda #1
 sta bd
 rts
xsr2 lda #27
 sta cmsg
 lda #1
 sta bd
 rts

exfind lda #5
 sta fop
 jmp fask

exnext lda ed_fl
 beq exfind
 jmp exsrch

exrepl lda #6
 sta fop
 jmp fask

exgoto lda #8
 sta fop
 jmp fask

; the typed text is in CMDB[0..clen): find text (fop 5, 6), replacement (7), line number (8)
exdone lda fop
 cmp #7
 bcs xdn1
 ldy #0
xdn0 cpy clen
 bcs xdn0e
 cpy #32
 bcs xdn0e
 lda CMDB,y
 jsr exnorm
 sta FND,y
 iny
 bne xdn0
xdn0e sty ed_fl
 lda fop
 cmp #5
 bne xdn00
 jmp exsrch
xdn00 lda #7
 sta fop
 jmp fask
xdn1 bne xdn2
 ldy #0
xdn1a cpy clen
 bcs xdn1e
 cpy #32
 bcs xdn1e
 lda CMDB,y
 sta RPL,y
 iny
 bne xdn1a
xdn1e sty ed_rl
 lda #0
 sta ed_cnt
 jsr exfwd
 bcs xdn1f
 lda #27
 sta cmsg
 rts
xdn1f lda #1
 sta ed_rp
 lda #32
 sta cmsg
 rts
xdn2 lda #0
 sta ed_t
 ldy #0
xdn2a cpy clen
 bcs xdn2e
 lda CMDB,y
 sec
 sbc #'0'
 cmp #10
 bcs xdn2e
 sta tmp
 lda ed_t
 cmp #26
 bcs xdn2e
 asl
 sta ed_n
 asl
 asl
 clc
 adc ed_n
 clc
 adc tmp
 sta ed_t
 iny
 bne xdn2a
xdn2e lda ed_t
 beq xdn2f
 sec
 sbc #1
 cmp nl
 bcc xdn2g
xdn2f lda nl
 sec
 sbc #1
xdn2g sta cl
 lda #0
 sta cc
 jsr fixcc
 lda #2
 sta fl
 lda #1
 sta cmsg
 rts

; ---------------------------------------------------------------- replace
; replace the selection with RPL, leave the cursor after it
exrep1 jsr exsrt
 mv16 ed_lo,ed_q
 sec
 lda ed_hi
 sbc ed_lo
 sta ed_n
 lda ed_hi+1
 sbc ed_lo+1
 sta ed_n+1
 jsr exdel
 lda ed_rl
 beq xrp1
 sta ed_n
 lda #0
 sta ed_n+1
 jsr exgap
 bcs xrp1
 mv16 ed_q,dst
 lda #<RPL
 sta src
 lda #>RPL
 sta src+1
 lda ed_rl
 sta ed_n
 lda #0
 sta ed_n+1
 jsr excpy
xrp1 jsr scan
 clc
 lda ed_lo
 adc ed_rl
 sta ed_q
 lda ed_lo+1
 adc #0
 sta ed_q+1
 jsr exp2c
 jsr reflow
 jsr exgcp
 lda #0
 sta ed_on
 inc ed_cnt
 rts

exrend lda #0
 sta ed_rp
 sta ed_on
 lda #33
 sta cmsg
 lda #2
 sta fl
 lda #1
 sta bd
 rts

; keys at the Replace? prompt
exrkey jsr exhloff
 lda kk
 cmp #$1B
 bne xrk1
 lda #0
 sta ed_rp
 sta ed_on
 lda #37
 sta cmsg
 lda #2
 sta fl
 lda #1
 sta bd
 rts
xrk1 cmp #'a'
 bcc xrk2
 cmp #'{'
 bcs xrk2
 sec
 sbc #$20
xrk2 cmp #'Y'
 beq xrky
 cmp #$9B
 beq xrky
 cmp #'N'
 beq xrkn
 cmp #'A'
 beq xrka
 jmp exhlon
xrky jsr exrep1
xrkn jsr exfwd
 bcs xrks
 jmp exrend
xrks lda #32
 sta cmsg
 lda #1
 sta bd
 rts
xrka jsr exrep1
 jsr exfwd
 bcc xrkz
 jsr exhloff
 jmp xrka
xrkz jmp exrend

exrepm lda #<exrm1
 ldx #>exrm1
 jsr putstr
 lda ed_cnt
 jsr putnum
 lda #<exrm2
 ldx #>exrm2
 jmp putstr
exrm1 dta c'Replaced ',b(0)
exrm2 dta c' time(s).',b(0)

; prompt texts (exprl/exprh) live in msgs.inc (resident)
