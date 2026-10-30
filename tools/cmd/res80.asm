; res80.asm - the resident part of 80COL.COM: an 80 x 24 text screen driver for E:.
; Assembled twice by build.cjs (BASE = $9000 for RAMTOP $C0, $7000 for RAMTOP $A0), so the same
; 80COL.COM works with and without the BASIC cartridge.  The screen is ANTIC mode F (1 bit, 320 x 192),
; each character is 4 x 8 pixels (3 x 5 glyph) packed two per byte.
;
; memory (offsets from BASE):
;   +$0000  screen rows 0-11 (320 bytes each, so none crosses a 4K boundary)
;   +$0F00  display list
;   +$1000  screen rows 12-23
;   +$1F00  font     +$1FC0  variables
;   +$2000  tables, code, then the text shadow (24 x 80) and the line buffer
        icl 'lib\sys.asm'
        icl 'lib\r80.inc'

DLB     = BASE+$0F00
FONT    = BASE+$1F00
VARS    = BASE+$1FC0
CODEB   = BASE+$2000

ptr     = $CB
ptr2    = $CD
ta      = $CF
tb      = $D0
tc      = $D1

SDLSTL  = $0230
BRKKEY  = $11
MEMTOP  = $02E5
VVBLKD  = $0224
SETVBV  = $E45C
IOCB0PT = $0346

        org FONT
        icl 'lib\font80.inc'

        org VARS
v_orge  dta a(0)
v_ort   dta 0
v_odos  dta a(0)
v_ovbi  dta a(0)
v_omt   dta a(0)
v_curx  dta 0
v_cury  dta 0
escf    dta 0
chr     dta 0
savx    dta 0
rety    dta 1
lpos    dta 0
llen    dta 0
dch     dta 0
dcol    dta 0
drow    dta 0
gl      dta 0
gh      dta 0
imask   dta 0
tmpv    dta 0
glen    dta 0
gr1     dta 0
kvec    dta a(0)
savzp   dta 0,0,0,0,0,0,0
gr      dta 0,0,0,0,0,0,0,0
        org VARS+$38
        dta a(htab),a(rdosini),a(rvbi),a(rinit)

        org CODEB
        dta c'80C'
htab    dta a(h_ok-1),a(h_ok-1),a(h_get-1),a(h_put-1),a(h_ok-1),a(h_spec-1)
        jmp h_ok

ord     :24 dta #
wrapf   :24 dta 0
slolo   :12 dta l(BASE+320*#)
        :12 dta l(BASE+$1000+320*#)
slohi   :12 dta h(BASE+320*#)
        :12 dta h(BASE+$1000+320*#)
shlo    :24 dta l(SHAD+80*#)
shhi    :24 dta h(SHAD+80*#)
cnt80l  :24 dta l(80*(23-#))
cnt80h  :24 dta h(80*(23-#))

h_ok    ldy #1
        rts
h_spec  ldy #$92
        rts

; ---- CIO entry points -------------------------------------------------
h_put   sta chr
        stx savx
        jsr saveall
        lda #1
        sta rety
        lda chr
        jsr putch
        jmp leave

h_get   stx savx
        jsr saveall
        lda #1
        sta rety
        lda lpos
        cmp llen
        bcc hg_ret
hg_loop jsr curon
hg_w    lda BRKKEY
        beq hg_brk
        lda CH
        cmp #$FF
        beq hg_w
        jsr curoff
        jsr kget
        cmp #EOL
        beq hg_cr
        jsr putch
        jmp hg_loop
hg_cr   jsr gather
hg_ret  ldx lpos
        lda lbuf,x
        sta chr
        inc lpos
        jmp leave
hg_brk  jsr curoff
        lda #$FF
        sta BRKKEY
        lda #$80
        sta rety
        lda #EOL
        sta chr
        jmp leave

saveall ldx #6
sv1     lda ptr,x
        sta savzp,x
        dex
        bpl sv1
        rts

leave   ldx #6
lv1     lda savzp,x
        sta ptr,x
        dex
        bpl lv1
        ldx savx
        ldy rety
        lda chr
        rts

; A = next key from the real keyboard handler
kget    ldx #0
kg1     lda HATABS,x
        beq kg_none
        cmp #'K'
        beq kg2
        inx
        inx
        inx
        bne kg1
kg_none lda #EOL
        rts
kg2     lda HATABS+1,x
        sta ptr
        lda HATABS+2,x
        sta ptr+1
        ldy #4
        lda (ptr),y
        clc
        adc #1
        sta kvec
        iny
        lda (ptr),y
        adc #0
        sta kvec+1
        jmp (kvec)

; ---- put one character --------------------------------------------------
putch   sta chr
        lda escf
        beq pc_1
        lda #0
        sta escf
        jmp pc_draw
pc_1    lda chr
        cmp #EOL
        bne pc_2
        lda #0
        sta v_curx
        jmp linefeed
pc_2    cmp #125
        bne *+5
        jmp clrscr
        cmp #126
        bne *+5
        jmp bksp
        cmp #127
        bne *+5
        jmp tabk
        cmp #27
        beq setesc
        cmp #28
        bcc pc_ret
        cmp #32
        bcc cursmv
        cmp #156
        bne *+5
        jmp dellin
        cmp #157
        bne *+5
        jmp inslin
        cmp #254
        bne *+5
        jmp delchr
        cmp #255
        bne *+5
        jmp inschr
        cmp #253
        beq pc_ret
        cmp #128
        bcc pc_draw
        cmp #160
        bcc pc_ret
pc_draw lda v_curx
        sta dcol
        lda v_cury
        sta drow
        lda chr
        jsr putcell
        inc v_curx
        lda v_curx
        cmp #80
        bcc pc_ret
        lda #0
        sta v_curx
        ldx v_cury
        lda #1
        sta wrapf,x
        jmp linefeed
pc_ret  rts

setesc  lda #1
        sta escf
        rts

cursmv  cmp #30
        bcs cm_h
        cmp #29
        beq cm_dn
        dec v_cury
        bpl cm_r
        lda #23
        sta v_cury
cm_r    rts
cm_dn   inc v_cury
        lda v_cury
        cmp #24
        bcc cm_r
        lda #0
        sta v_cury
        rts
cm_h    cmp #31
        beq cm_rt
        dec v_curx
        bpl cm_r
        lda #79
        sta v_curx
        rts
cm_rt   inc v_curx
        lda v_curx
        cmp #80
        bcc cm_r
        lda #0
        sta v_curx
        rts

bksp    lda v_curx
        beq pc_ret
        dec v_curx
        lda v_curx
        sta dcol
        lda v_cury
        sta drow
        lda #$20
        jmp putcell

tabk    lda v_curx
        and #$F8
        clc
        adc #8
        cmp #80
        bcc tb1
        lda #0
        sta v_curx
        jmp linefeed
tb1     sta v_curx
        rts

linefeed lda v_cury
        cmp #23
        bcs lf_s
        inc v_cury
        rts
lf_s    lda #0
        jmp dellines

; ---- editing ----------------------------------------------------------
delchr  lda v_cury
        jsr shrow
        ldy v_curx
dc1     cpy #79
        beq dc2
        iny
        lda (ptr2),y
        dey
        sta (ptr2),y
        iny
        bne dc1
dc2     lda #$20
        sta (ptr2),y
        jmp redrw

inschr  lda v_cury
        jsr shrow
        ldy #79
ic1     cpy v_curx
        beq ic2
        dey
        lda (ptr2),y
        iny
        sta (ptr2),y
        dey
        jmp ic1
ic2     lda #$20
        sta (ptr2),y
        jmp redrw

; redraw the current row from the cursor to the end from the shadow
redrw   lda v_curx
        sta dcol
        lda v_cury
        sta drow
        jsr shrow
rd1     ldy dcol
        lda (ptr2),y
        sta dch
        jsr drawat
        inc dcol
        lda dcol
        cmp #80
        bne rd1
        rts

dellin  lda v_cury
        jsr dellines
        lda #0
        sta v_curx
        rts

; delete row A, rows below move up, a blank row appears at the bottom
dellines sta tb
        tax
        lda ord,x
        sta tc
dl1     cpx #23
        beq dl2
        lda ord+1,x
        sta ord,x
        lda wrapf+1,x
        sta wrapf,x
        inx
        bne dl1
dl2     lda tc
        sta ord+23
        lda #0
        sta wrapf+23
        lda tc
        jsr clrslot
        ldx tb
        lda shlo,x
        sta ptr
        lda shhi,x
        sta ptr+1
        lda ptr
        clc
        adc #80
        sta ptr2
        lda ptr+1
        adc #0
        sta ptr2+1
        lda cnt80h,x
        sta tc
        beq dl4
dl3     ldy #0
dl3a    lda (ptr2),y
        sta (ptr),y
        iny
        bne dl3a
        inc ptr+1
        inc ptr2+1
        dec tc
        bne dl3
dl4     lda cnt80l,x
        beq dl6
        sta tc
        ldy #0
dl5     lda (ptr2),y
        sta (ptr),y
        iny
        cpy tc
        bne dl5
dl6     lda #23
        jsr shrow
        jsr blankrow
        jmp mkdl

; blank the shadow row at ptr2
blankrow ldy #79
        lda #$20
br1     sta (ptr2),y
        dey
        bpl br1
        rts

inslin  lda ord+23
        sta tc
        ldx #23
il1     cpx v_cury
        beq il2
        lda ord-1,x
        sta ord,x
        lda wrapf-1,x
        sta wrapf,x
        dex
        jmp il1
il2     lda tc
        sta ord,x
        lda #0
        sta wrapf,x
        stx tb
        lda tc
        jsr clrslot
        ldx tb
        lda #<(SHAD+1920)
        sta ptr
        lda #>(SHAD+1920)
        sta ptr+1
        lda #<(SHAD+1840)
        sta ptr2
        lda #>(SHAD+1840)
        sta ptr2+1
        lda cnt80l,x
        sta gl
        lda cnt80h,x
        sta gh
il3     lda gl
        ora gh
        beq il5
        lda ptr
        bne il3a
        dec ptr+1
il3a    dec ptr
        lda ptr2
        bne il3b
        dec ptr2+1
il3b    dec ptr2
        ldy #0
        lda (ptr2),y
        sta (ptr),y
        lda gl
        bne il3c
        dec gh
il3c    dec gl
        jmp il3
il5     lda v_cury
        jsr shrow
        jsr blankrow
        lda #0
        sta v_curx
        jmp mkdl

; ---- screen / shadow bookkeeping --------------------------------------------
; ptr = screen address of the slot of row A
rowptr  tax
        lda ord,x
        tax
        lda slolo,x
        sta ptr
        lda slohi,x
        sta ptr+1
        rts

; ptr2 = shadow row A
shrow   tax
        lda shlo,x
        sta ptr2
        lda shhi,x
        sta ptr2+1
        rts

; zero slot A (320 bytes)
clrslot tax
        lda slolo,x
        sta ptr
        lda slohi,x
        sta ptr+1
        lda #0
        tay
cs1     sta (ptr),y
        iny
        bne cs1
        inc ptr+1
cs2     sta (ptr),y
        iny
        cpy #64
        bne cs2
        rts

; rewrite the LMS address of every row in the display list
mkdl    lda #0
        sta ta
        lda #4
        sta tc
mk1     ldx ta
        lda ord,x
        tax
        ldy tc
        lda slolo,x
        sta DLB,y
        lda slohi,x
        sta DLB+1,y
        lda tc
        clc
        adc #10
        sta tc
        inc ta
        lda ta
        cmp #24
        bne mk1
        rts

clrscr  lda #0
        sta tmpv
cl1     lda tmpv
        jsr clrslot
        inc tmpv
        lda tmpv
        cmp #24
        bne cl1
        lda #<SHAD
        sta ptr
        lda #>SHAD
        sta ptr+1
        lda #$20
        ldx #7
cl2     ldy #0
cl3     sta (ptr),y
        iny
        bne cl3
        inc ptr+1
        dex
        bne cl2
cl4     sta (ptr),y
        iny
        cpy #128
        bne cl4
        ldx #23
        lda #0
cl5     sta wrapf,x
        dex
        bpl cl5
        sta v_curx
        sta v_cury
        sta escf
        sta lpos
        sta llen
        rts

; called once by the installer: build the display list and clear everything
rinit   lda #$70
        sta DLB
        sta DLB+1
        sta DLB+2
        ldy #3
        lda #24
        sta ta
ri1     lda #$4F
        sta DLB,y
        iny
        iny
        iny
        ldx #7
        lda #$0F
ri2     sta DLB,y
        iny
        dex
        bne ri2
        dec ta
        bne ri1
        lda #$41
        sta DLB,y
        lda #<DLB
        sta DLB+1,y
        lda #>DLB
        sta DLB+2,y
        jsr mkdl
        jmp clrscr

; ---- drawing -------------------------------------------------------------
; ptr = screen byte of cell (dcol,drow), ta = 1 if the odd (right) nibble
cellptr lda drow
        jsr rowptr
        lda dcol
        and #1
        sta ta
        lda dcol
        lsr
        clc
        adc ptr
        sta ptr
        bcc cp1
        inc ptr+1
cp1     rts

add40   lda ptr
        clc
        adc #40
        sta ptr
        bcc a40
        inc ptr+1
a40     rts

; draw char A at (dcol,drow) and remember it in the shadow
putcell sta dch
        jsr drawat
        lda drow
        jsr shrow
        ldy dcol
        lda dch
        sta (ptr2),y
        rts

; draw dch at (dcol,drow); bit 7 = inverse
drawat  lda #0
        bit dch
        bpl da_n
        lda #$0F
da_n    sta imask
        ldx #7
        lda #0
da_c    sta gr,x
        dex
        bpl da_c
        lda dch
        and #$7F
        sec
        sbc #32
        bcc da_p
        cmp #95
        bcs da_p
        asl
        tax
        lda FONT,x
        sta gl
        lda FONT+1,x
        sta gh
        lda #1
        bit gh
        bpl da_s0
        lda #3
da_s0   sta tb
        asl gl
        rol gh
        ldy #5
da_r    lda #0
        sta ta
        ldx #3
da_b    asl gl
        rol gh
        rol ta
        dex
        bne da_b
        lda ta
        asl
        ldx tb
        sta gr,x
        inc tb
        dey
        bne da_r
da_p    jsr cellptr
        ldx #0
da_l    lda gr,x
        eor imask
        ldy ta
        bne da_o
        asl
        asl
        asl
        asl
        sta tc
        ldy #0
        lda (ptr),y
        and #$0F
        ora tc
        jmp da_s
da_o    sta tc
        ldy #0
        lda (ptr),y
        and #$F0
        ora tc
da_s    sta (ptr),y
        jsr add40
        inx
        cpx #8
        bne da_l
        rts

; invert the cursor cell
xorcell lda v_curx
        sta dcol
        lda v_cury
        sta drow
        jsr cellptr
        lda #$F0
        ldy ta
        beq xc_m
        lda #$0F
xc_m    sta tc
        ldx #8
xc_l    ldy #0
        lda (ptr),y
        eor tc
        sta (ptr),y
        jsr add40
        dex
        bne xc_l
        rts

curon   lda CRSINH
        bne co_r
        jmp xorcell
co_r    rts
curoff  = curon

; ---- the logical line under the cursor goes to lbuf ----------------------------
gather  ldx v_cury
ga1     cpx #0
        beq ga2
        lda wrapf-1,x
        beq ga2
        dex
        bne ga1
ga2     stx tb
        ldx v_cury
ga3     cpx #23
        beq ga4
        lda wrapf,x
        beq ga4
        txa
        sec
        sbc tb
        cmp #2
        bcs ga4
        inx
        bne ga3
ga4     stx gr1
        lda #<lbuf
        sta ptr
        lda #>lbuf
        sta ptr+1
        lda tb
        sta tmpv
        lda #0
        sta glen
ga5     lda tmpv
        jsr shrow
        ldy #0
ga6     lda (ptr2),y
        sta (ptr),y
        iny
        cpy #80
        bne ga6
        lda ptr
        clc
        adc #80
        sta ptr
        bcc ga7
        inc ptr+1
ga7     lda glen
        clc
        adc #80
        sta glen
        lda tmpv
        cmp gr1
        beq ga8
        inc tmpv
        bne ga5
ga8     ldx glen
ga9     beq ga10
        lda lbuf-1,x
        cmp #$20
        bne ga10
        dex
        bne ga9
ga10    lda #EOL
        sta lbuf,x
        inx
        stx llen
        lda #0
        sta lpos
        sta v_curx
        lda gr1
        sta v_cury
        jmp linefeed

; ---- hooks -----------------------------------------------------------------
; deferred VBI: when the OS puts up its own GRAPHICS 0 list, swap ours back in
rvbi    lda SDLSTL+1
        cmp #>DLB
        bne vb1
        lda SDLSTL
        cmp #<DLB
        beq vb9
vb1     lda SDLSTL
        sta vbm+1
        sta vbn+1
        lda SDLSTL+1
        sta vbm+2
        sta vbn+2
        ldy #3
vbm     lda $FFFF,y
        cmp #$42
        bne vb9
        ldy #6
vbn     lda $FFFF,y
        cmp #$02
        bne vb9
        lda #<DLB
        sta SDLSTL
        lda #>DLB
        sta SDLSTL+1
vb9     jmp (v_ovbi)

; DOSINI: a warm start gives the memory back and resets the vectors, so take it again
rdosini jsr rdo_old
        lda #>BASE
        sta RAMTOP
        lda #$FF
        sta MEMTOP
        lda #>BASE-1
        sta MEMTOP+1
        lda htab+6
        sta IOCB0PT
        lda htab+7
        sta IOCB0PT+1
        ldx #>rvbi
        ldy #<rvbi
        lda #7
        jsr SETVBV
        rts
rdo_old jmp (v_odos)

SHAD    = *
lbuf    = SHAD+1920
        ert lbuf+241>BASE+RESZ
