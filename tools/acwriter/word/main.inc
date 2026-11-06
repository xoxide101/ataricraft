
start
 lda PORTB
 ora #2
 sta PORTB
 jsr bk_cnt
 jsr bk_det
 lda sv_xe
 beq stn
 jsr ovstage
stn jsr mktab
 jsr mkfont
 jsr mkst
 jsr openk
 lda #<dl
 sta SDLSTL
 lda #>dl
 sta SDLSTL+1
 lda #$22
 sta SDMCTL
 lda #$0F
 sta COLOR2
 lda #$00
 sta COLOR1
 lda #$04
 sta COLOR4
 lda #$0F
 sta tcb
 lda #0
 sta tci
 lda #<dli1
 sta VDSLST
 lda #>dli1
 sta VDSLST+1
 lda #$C0
 sta NMIEN
 lda #0
 sta cl
 sta cc
 sta top
 sta dfrom
 sta fl
 sta cmode
 sta cmdon
 sta clen
 sta cmsg
 sta bd
 sta ps
 sta sd
 sta lm
 sta iv
 sta mn
 sta th
 sta mhl
 sta rz
 sta anyv
 sta hmode
 sta pwpap
 sta pwpit
 sta pwx
 sta pwnt
 sta hback
 sta hsel
 sta hchd
 sta sv_on
 sta sv_dl
 sta sv_ni
 sta sg_n
 sta sg_c
 ldx #39
mied sta $14C0,x
 dex
 bpl mied
 lda #63
 sta rm
 lda #3
 sta pwplm
 lda #2
 sta pwprm
 jsr pwcalc
 jsr bk_det
 lda sv_xe
 bne stx1
 lda #39
 sta cmsg
stx1 lda #0
 jsr scan
 lda RTCLOK+2
 sta tm
 jsr full
 jsr tend
 sta mfull
 lda RTCLOK+2
 sta tm
 jsr scrolldown
 jsr tend
 sta mscr
 jsr scrollup
 lda #0
 sta mkey
 jsr ribbon
 jsr bar
 jsr status
 lda #1
 jsr gopage

loop
 lda #0
 sta ATRACT
 lda CONSOL
 and #1
 bne lc0
 lda hchd
 bne lc1
 inc hchd
 bne lhelp
lc0 lda #0
 sta hchd
lc1 lda HELPFG
 beq lc2
 lda #0
 sta HELPFG
lhelp lda RTCLOK+2
 sta tm
 lda #$F1
 jmp lgotk
lc2 lda CH
 cmp #$FF
 bne lgot
 lda sd
 beq loop
 lda RTCLOK+2
 sec
 sbc lt
 cmp #30
 bcc loop
 lda #0
 sta sd
 jsr status
 jmp loop
lgot
 lda RTCLOK+2
 sta tm
 jsr getkey
lgotk sta kk
 lda #0
 sta fl
 jsr hdl2
 lda hmode
 cmp #PGV
 bne lgo1
 lda pzoom
 bne lgz
 jsr pwmain
 jmp lp2
lgz jsr pzmain
 jmp lp2
lgo1 jsr tend
 sta $A4
 jsr visible
 jsr tend
 sta $A5
 lda fl
 cmp #2
 bne lp1
 jsr full
 jmp lp2
lp1 cmp #3
 bne lp1b
 jsr appendcur
 jmp lp2
lp1b cmp #1
 bne lp2
 jsr redrawcur
lp2 jsr tend
 sta mkey
 lda kk
 cmp #32
 bcc lsync
 cmp #127
 bcs lsync
 cmp #'.'
 bne lq1
 lda #1
 sta ps
 bne ldefer
lq1 cmp #32
 bne lq2
 lda ps
 beq ldefer
 cmp #1
 bne lsync
 lda #2
 sta ps
 bne ldefer
lq2 lda #0
 sta ps
ldefer lda #1
 sta sd
 lda RTCLOK+2
 sta lt
 jmp lq3
lsync lda #0
 sta ps
 sta sd
 jsr status
lq3 lda bd
 beq lp3
 lda #0
 sta bd
 jsr ribbon
 jsr bar
lp3 jmp loop

tend
 lda RTCLOK+2
 sec
 sbc tm
 rts

openk
 ldx #$20
 lda #3
 sta ICCOM,x
 lda #<kname
 sta ICBAL,x
 lda #>kname
 sta ICBAH,x
 lda #4
 sta ICAX1,x
 lda #0
 sta ICAX2,x
 jmp CIOV

getkey
 ldx #$20
 lda #7
 sta ICCOM,x
 lda #0
 sta ICBLL,x
 sta ICBLH,x
 jmp CIOV

