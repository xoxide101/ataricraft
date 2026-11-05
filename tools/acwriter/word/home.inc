; Start menu, help and convert pages. Each page is a read-only document in the Craft text
; format (a stream of lines with paragraph markers) that the normal page engine draws, so the
; scaled logo uses the same width/height markers as the editor. While a page is shown the
; user's document stays at DOC; cl, cc, top, anyv, lm and rm are saved and restored.
; hmode: 0 editor, 1 home, 2 help, 3 convert.
EL0  = 5
NENT = 8

; the editor calls these; pages draw their own bars
ribbon lda hmode
 beq hrb0
 cmp #PGV
 beq hrb0
 jmp pgrib
hrb0 jmp ribbon0
bar lda hmode
 beq hbr0
 cmp #PGV
 beq hbr0
 jmp pgbar
hbr0 jmp bar0
status lda hmode
 beq hst0
 cmp #PGV
 bne hst1
 jmp pwst
hst1 jmp pgst
hst0 jmp status0

hhome lda #1
 jmp pgto
hhelp lda #2
pgto pha
 lda hmode
 sta hback
 pla
gopage
 pha
 lda hmode
 bne gp1
 lda cl
 sta svcl
 lda cc
 sta svcc
 lda top
 sta svtop
 lda anyv
 sta svanyv
 lda lm
 sta svlm
 lda rm
 sta svrm
gp1 pla
 sta hmode
 lda #0
 sta lm
 sta cc
 sta top
 sta cmdon
 sta mn
 sta cmsg
 lda #63
 sta rm
 lda #1
 sta anyv
pgshow
 ldx hmode
 lda pgl-1,x
 pha
 lda pgh-1,x
 tax
 pla
 jsr scanat
 lda #0
 sta top
 sta cc
 lda hmode
 cmp #1
 bne pgs1
 jsr hpatch
 lda #EL0
 clc
 adc hsel
 bne pgs2
pgs1 lda #0
pgs2 sta cl
 jsr full
 jsr ribbon
 jsr status
 jmp bar

leavepage
 lda #0
 sta hmode
 lda svlm
 sta lm
 lda svrm
 sta rm
 lda svanyv
 sta anyv
 jsr scan
 lda svcl
 sta cl
 lda svcc
 sta cc
 lda svtop
 sta top
 lda #$FF
 sta t0
 lda #2
 sta fl
 lda #1
 sta bd
 jsr ribbon
 jsr bar
 jmp status

; back from a file prompt: redraw the page (an import may have replaced DOC)
pgafter
 lda cmdon
 bne pgaf1
 jsr pgshow
 lda #1
 sta bd
pgaf1 rts

pgrib
 lda #0
 sta bi
 ldx hmode
 lda ptl-1,x
 pha
 lda pth-1,x
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
 lda #$FF
 sta t0
 jsr rowsetup
 jmp drawtext

pgst
 lda #$FF
 sta t0
 sta rr
 jsr rowsetup
 jsr hlr
 lda #0
 sta bi
 ldx hmode
 lda pil-1,x
 pha
 lda pih-1,x
 tax
 pla
 jsr putstr
 lda #0
 jsr putc
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #ROWS
 sta rr
 jsr rowsetup
 jsr drawtext
 jmp hls

pgbar
 lda #$FF
 sta t0
 lda cmdon
 ora cmsg
 beq pgb1
 jmp bar0
pgb1 lda #0
 sta bi
 jsr putc
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #ROWS+1
 sta rr
 jsr rowsetup
 jmp drawtext

; the selected entry is drawn inverse: code 4 around its text, code 31 (skipped) around the others
hpatch
 ldx #0
hp1 stx hk
 txa
 clc
 adc #EL0
 tax
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 lda #31
 ldx hk
 cpx hsel
 bne hp2
 lda #4
hp2 sta hv
 ldy #2
 sta (tp),y
hp3 iny
 lda (tp),y
 cmp #13
 bne hp3
 dey
 lda hv
 sta (tp),y
 ldx hk
 inx
 cpx #NENT
 bne hp1
 rts

hredraw clc
 adc #EL0
 sta cl
 jmp redrawcur

hmv ldx hsel
 stx hold
 sta hsel
 jsr hpatch
 lda hold
 jsr hredraw
 lda hsel
 jsr hredraw
 lda #EL0
 clc
 adc hsel
 sta cl
 rts

pagekey
 lda kk
 cmp #$1B
 bne pgk1
 jmp pgesc
pgk1 cmp #$F1
 bne pgk2
 lda hmode
 cmp #2
 beq pkz
 lda #2
 jmp pgto
pgk2 cmp #'a'
 bcc pgk3
 cmp #'{'
 bcs pgk3
 and #$DF
 sta kk
pgk3 cmp #'T'
 bne pgk4
 jmp hcol
pgk4 ldx hmode
 cpx #2
 beq helpkey
 cpx #3
 bne pgk5
 jmp convkey
pgk5 cmp #$1C
 bne hk1
 lda hsel
 bne hk0
 lda #NENT
hk0 sec
 sbc #1
 jmp hmv
hk1 cmp #$1D
 bne hk2
 lda hsel
 clc
 adc #1
 cmp #NENT
 bcc hk1a
 lda #0
hk1a jmp hmv
hk2 cmp #$9B
 bne hk3
 lda hsel
 jmp pgact
hk3 ldx #NENT-1
hk4 cmp hkeys,x
 beq hk5
 dex
 bpl hk4
pkz rts
hk5 txa
 jmp pgact

helpkey
 cmp #$1C
 bne he1
 lda top
 beq pkz
 dec top
 jmp hesc
he1 cmp #$1D
 bne he2
 jsr hemax
 cmp top
 beq pkz
 bcc pkz
 inc top
 jmp hesc
he2 cmp #32
 bne he3
 jsr hemax
 sec
 sbc top
 bcc pkz
 beq pkz
 cmp #16
 bcc he2a
 lda #16
he2a clc
 adc top
 sta top
 jmp hesc
he3 cmp #'B'
 beq he4
 cmp #$7E
 bne pkz
he4 lda top
 sec
 sbc #16
 bcs he5
 lda #0
he5 sta top
hesc lda top
 sta cl
 lda #2
 sta fl
 rts

; A = highest useful top line of the page (0 when it fits)
hemax lda nl
 sec
 sbc #ROWS
 bcs hem1
 lda #0
hem1 rts

convkey
 cmp #$9B
 beq cv1
 cmp #'I'
 bne cv2
cv1 lda #3
 sta fop
 jmp fask
cv2 cmp #'E'
 bne pkz
 jmp leavepage

pgesc
 lda hmode
 cmp #1
 bne pe1
 jmp leavepage
pe1 cmp #2
 bne pe2
 lda hback
 beq pe3
 jmp gopage
pe3 jmp leavepage
pe2 lda #1
 jmp gopage

pgact
 tax
 lda paj_h,x
 pha
 lda paj_l,x
 pha
 rts

pa_new jsr leavepage
 jsr hnew
 jmp status
pa_open jsr leavepage
 jmp hopen
pa_save jsr leavepage
 jmp hsave
pa_sas jsr leavepage
 jmp hsas
pa_conv lda #3
 jmp pgto
pa_help lda #2
 jmp pgto
pa_edit jmp leavepage
pa_quit lda #$40
 sta NMIEN
 jmp ($000A)

paj_l dta l(pa_new-1),l(pa_open-1),l(pa_save-1),l(pa_sas-1),l(pa_conv-1),l(pa_help-1),l(pa_edit-1),l(pa_quit-1)
paj_h dta h(pa_new-1),h(pa_open-1),h(pa_save-1),h(pa_sas-1),h(pa_conv-1),h(pa_help-1),h(pa_edit-1),h(pa_quit-1)
hkeys dta c'NOSACHEQ'

pgl dta l(homedoc),l(helpdoc),l(convdoc)
pgh dta h(homedoc),h(helpdoc),h(convdoc)
ptl dta l(pgt1),l(pgt2),l(pgt3)
pth dta h(pgt1),h(pgt2),h(pgt3)
pil dta l(pgi1),l(pgi2),l(pgi3)
pih dta h(pgi1),h(pgi2),h(pgi3)
pgt1 dta c' AC Writer 0.1    Start menu',b(0)
pgt2 dta c' AC Writer 0.1    Help',b(0)
pgt3 dta c' AC Writer 0.1    Convert / import',b(0)
pgi1 dta c'Letter key, or Up/Down + Return.  T colours',b(0)
pgi2 dta c'Up/Down scroll  Space page  B back  Esc return',b(0)
pgi3 dta c'I or Return: choose file  E edit  Esc back',b(0)

impmsg
 lda #<ims1
 ldx #>ims1
 jsr putstr
 lda isz
 sta src
 lda isz+1
 sta src+1
 jsr putn16
 lda #<ims2
 ldx #>ims2
 jsr putstr
 lda cmsg
 cmp #12
 bne ims9
 lda #<ims3
 ldx #>ims3
 jmp putstr
ims9 rts
ims1 dta c'Imported ',b(0)
ims2 dta c' chars.',b(0)
ims3 dta c' Cut: page full.',b(0)

