; ribbon.inc - shared WOW-series shell: menu bar, command bar, Tab completion.
; Included by an app (ACWriter, later ACSpread/ACDBase). The app provides:
;   NMENU        number of menus; tabl/tabh name strings, tooll/toolh hint strings per menu
;   items        draws the item line of menu cmode (shown while mn = 2)
;   mn           menu state: 0 off, 1 waiting for a menu letter, 2 waiting for an item letter
;   cmdtab       command names, each 0-terminated, table ends with an extra 0
;   cmdexec      runs command number A (position in cmdtab); sets fl as the editor expects
;   appmsg       draws a custom message with putstr/putnum when cmsg = 3
;   helpmsg      idle text of the command bar
;   rowsetup, drawtext, putc, putstr, ROWS, BUF, CMDB, and the zero-page variables
;   kk (key), cmode, cmdon, clen, bd, cmsg, tmp, src, tp, rr, bi

; key handling while the command bar is open
cmdkey
 lda kk
 cmp #$9B
 beq ckrun
 cmp #$1B
 beq ckoff
 cmp #$7E
 beq ckbs
 cmp #$7F
 beq cktab
 cmp #32
 bcc ckx
 cmp #127
 bcs ckx
 cmp #'A'
 bcc ck1
 cmp #'['
 bcs ck1
 ora #$20
ck1 ldx clen
 cpx #60
 bcs ckx
 sta CMDB,x
 inc clen
ckx lda #1
 sta bd
 rts
ckbs lda clen
 beq ckx
 dec clen
 jmp ckx
ckoff lda #0
 sta fpr
 sta cmdon
 sta cmsg
 jmp ckx
ckrun lda #0
 sta cmdon
 sta cmsg
 lda #1
 sta bd
 lda clen
 beq ckr0
 lda fpr
 beq ckr1
 lda #0
 sta fpr
 jmp dofile
ckr0 lda #0
 sta fpr
 jmp ckx
ckr1 jmp runcmd

; Tab completes the typed prefix to the first matching command
cktab lda #<cmdtab
 sta src
 lda #>cmdtab
 sta src+1
tc1 ldy #0
 lda (src),y
 beq ckx
tc2 cpy clen
 beq tcok
 lda (src),y
 cmp CMDB,y
 bne tcn
 iny
 bne tc2
tcn jsr nxtcmd
 jmp tc1
tcok ldy #0
tc3 lda (src),y
 sta CMDB,y
 beq tc4
 iny
 bne tc3
tc4 sty clen
 jmp ckx

nxtcmd
 ldy #0
nx1 lda (src),y
 iny
 cmp #0
 bne nx1
 tya
 clc
 adc src
 sta src
 bcc nx2
 inc src+1
nx2 rts

runcmd
 ldx clen
 lda #0
 sta CMDB,x
 sta tmp
 lda #<cmdtab
 sta src
 lda #>cmdtab
 sta src+1
rc1 ldy #0
 lda (src),y
 beq rcbad
rc2 lda (src),y
 cmp CMDB,y
 bne rcn
 cmp #0
 beq rcok
 iny
 bne rc2
rcn jsr nxtcmd
 inc tmp
 jmp rc1
rcbad lda #2
 sta cmsg
 rts
rcok lda #1
 sta cmsg
 lda tmp
 jmp cmdexec

; Tab key: next / previous menu
ribnext
 lda cmode
 clc
 adc #1
 cmp #NMENU
 bcc rbn1
 lda #0
rbn1 sta cmode
 lda #1
 sta bd
 rts

ribprev
 lda cmode
 bne rbp1
 lda #NMENU
rbp1 sec
 sbc #1
 sta cmode
 lda #1
 sta bd
 rts

; Ctrl-X: open the command bar
cmdopen
 lda #1
 sta cmdon
 sta bd
 lda #0
 sta clen
 sta cmsg
 sta mn
 rts

ribbon
 lda #0
 sta bi
 sta tmp
rbl lda #' '
 jsr putc
 ldx tmp
 cpx cmode
 bne rb1
 lda #1
 jsr putc
rb1 ldx tmp
 lda tabl,x
 pha
 lda tabh,x
 tax
 pla
 jsr putstr
 ldx tmp
 cpx cmode
 bne rb2
 lda #1
 jsr putc
rb2 inc tmp
 lda tmp
 cmp #NMENU
 bne rbl
 lda #' '
 jsr putc
 ldx cmode
 lda tooll,x
 pha
 lda toolh,x
 tax
 pla
 jsr putstr
 lda #0
 jsr putc
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #$FE
 sta rr
 jsr rowsetup
 jmp drawtext

bar
 lda #0
 sta bi
 lda mn
 beq br0
 cmp #1
 bne brm
 lda #<rs10
 ldx #>rs10
 jsr putstr
 jmp br9
brm jsr items
 jmp br9
br0 lda cmdon
 beq br1
 lda #<rs6
 ldx #>rs6
 ldy fpr
 beq br0a
 lda #<rs12
 ldx #>rs12
br0a jsr putstr
 ldx clen
 lda #'_'
 sta CMDB,x
 lda #0
 sta CMDB+1,x
 lda #<CMDB
 ldx #>CMDB
 jsr putstr
 jmp br9
br1 lda cmsg
 bne br2
 lda #<helpmsg
 ldx #>helpmsg
 jmp br8
br2 cmp #1
 bne br3
 lda #<rs7
 ldx #>rs7
 jmp br8
br3 cmp #3
 bne br4
 jsr appmsg
 jmp br9
br4 cmp #4
 bne br5
 lda #<rs9
 ldx #>rs9
 jmp br8
br5 cmp #5
 bne br6
 lda #<rs11
 ldx #>rs11
 jmp br8
br6 cmp #6
 bne br6b
 lda #<rs13
 ldx #>rs13
 jmp br8
br6b cmp #7
 bne br6c
 lda #<rs14
 ldx #>rs14
 jmp br8
br6c cmp #8
 bne br6d
 lda #<rs15
 ldx #>rs15
 jsr putstr
 lda fer
 jsr putnum
 jmp br9
br6d cmp #9
 bne br6e
 lda #<rs16
 ldx #>rs16
 jmp br8
br6e cmp #10
 bne br6f
 lda #<rs17
 ldx #>rs17
 jmp br8
br6f lda #<rs8
 ldx #>rs8
br8 jsr putstr
br9 lda #0
 jsr putc
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #ROWS+1
 sta rr
 jsr rowsetup
 jmp drawtext

rs6 dta c'Command: ',b(0)
rs7 dta c'Done.',b(0)
rs8 dta c'Unknown command. Press Tab after a few letters to complete.',b(0)
rs9 dta c'Not in the proof of concept yet.',b(0)
rs11 dta c'Symbols: arrows pick, Enter inserts, Spc page, Esc cancels',b(0)
rs12 dta c'File name (D1: is the default): ',b(0)
rs13 dta c'Saved.',b(0)
rs14 dta c'Loaded.',b(0)
rs15 dta c'Disk error ',b(0)
rs16 dta c'Not an ACWriter file, or it is damaged.',b(0)
rs17 dta c'That file is too big for the page.',b(0)
rs10 dta c'Menu: press the highlighted letter.  Esc cancels.',b(0)
