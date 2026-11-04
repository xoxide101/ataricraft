; tui.inc - text-mode UI library for the Atari 8-bit (GR.0, 40x24): boxes, menu bar, pop-up menus, dialogs, mouse.
; Include it once, after your own code (it has no ORG).  All drawing writes screen RAM through SAVMSC ($58).
; Input: keyboard (through the K: handler vector) plus an Atari ST mouse on port 2 (decoded from STICK1/STRIG1);
;        the pointer is an inverse-video cell.  Without a mouse everything works from the keyboard.
; Pop-ups overwrite what is under them; the caller redraws afterwards.
;
; Zero page used: $E0-$EF.  Set TX,TY,TW,TH (and TCH/TINV/SP as noted), then JSR.
;   tui_box   framed, cleared window               tui_fill  fill a rectangle with TCH
;   tui_str   print zero-terminated ATASCII at SP  tui_inv   toggle inverse on TW cells of row TY
;   tui_event wait for a key (TKEY) or click (MX,MY); A=1 key, A=2 click
;   tui_bar   menu bar from a string list (ends with an empty string)    tui_barhit  A=title under MX, or $FF
;   tui_menu  pop-up menu from a string list at TX,TY; A=chosen item (0-based) or $FF if cancelled
;   tui_msg   centred message box (SP = text) closed by Return/Esc or a click on [ OK ]

TX    = $E0
TY    = $E1
TW    = $E2
TH    = $E3
TCH   = $E4
TINV  = $E5
SP    = $E6
DP    = $E8
T1    = $EA
T2    = $EB
BL    = $EC
BM    = $ED
BR    = $EE
TKEY  = $EF

tui_calc
        lda TY
        sta DP
        lda #0
        sta DP+1
        ldx #3
tc1     asl DP
        rol DP+1
        dex
        bne tc1
        lda DP
        sta T1
        lda DP+1
        sta T2
        asl DP
        rol DP+1
        asl DP
        rol DP+1
        clc
        lda DP
        adc T1
        sta DP
        lda DP+1
        adc T2
        sta DP+1
        clc
        lda DP
        adc TX
        sta DP
        lda DP+1
        adc #0
        sta DP+1
        clc
        lda DP
        adc $58
        sta DP
        lda DP+1
        adc $59
        sta DP+1
        rts

tui_nextrow
        clc
        lda DP
        adc #40
        sta DP
        bcc tn1
        inc DP+1
tn1     rts

tui_row
        ldy #0
        lda BL
        sta (DP),y
        ldx TW
        dex
        dex
        beq tr2
        bmi tr2
tr1     iny
        lda BM
        sta (DP),y
        dex
        bne tr1
tr2     iny
        lda BR
        sta (DP),y
        jmp tui_nextrow

tui_box
        jsr tui_calc
        lda #17
        sta BL
        lda #18
        sta BM
        lda #5
        sta BR
        jsr tui_row
        lda TH
        sec
        sbc #2
        sta T1
        beq tb2
tb1     lda #124
        sta BL
        sta BR
        lda #0
        sta BM
        jsr tui_row
        dec T1
        bne tb1
tb2     lda #26
        sta BL
        lda #18
        sta BM
        lda #3
        sta BR
        jmp tui_row

tui_fill
        jsr tui_calc
        lda TH
        sta T1
tf1     ldy #0
        ldx TW
tf2     lda TCH
        sta (DP),y
        iny
        dex
        bne tf2
        jsr tui_nextrow
        dec T1
        bne tf1
        rts

tui_inv
        jsr tui_calc
        ldy #0
ti1     lda (DP),y
        eor #$80
        sta (DP),y
        iny
        cpy TW
        bne ti1
        rts

; prints at TX,TY; returns the length in A
tui_str
        jsr tui_calc
        ldy #0
ts1     lda (SP),y
        beq ts9
        cmp #$60
        bcs ts2
        cmp #$20
        bcc ts3
        sec
        sbc #$20
        jmp ts2
ts3     clc
        adc #$40
ts2     ora TINV
        sta (DP),y
        iny
        bne ts1
ts9     tya
        rts

; step SP to the next string in a list; carry set if the string just passed was the empty end marker
tui_nextstr
        ldy #0
        lda (SP),y
        php
tns1    lda (SP),y
        beq tns2
        iny
        bne tns1
tns2    iny
        tya
        clc
        adc SP
        sta SP
        bcc tns3
        inc SP+1
tns3    plp
        beq tns4
        clc
        rts
tns4    sec
        rts

; ---- mouse (Atari ST on port 2 as quadrature) and keyboard ----
MX      .byte 20
MY      .byte 12
mxa     .byte 0
mya     .byte 0
mq      .byte 0
mold    .byte 0
mbtn    .byte 0
mfirst  .byte 1
minv    .byte 0,3,1,2,12,15,13,14,4,7,5,6,8,11,9,10

tui_cur
        lda MX
        sta TX
        lda MY
        sta TY
        lda #1
        sta TW
        jmp tui_inv

; A = new phase, T1 = old phase (0-3) -> A = 0, 1 or $FF
tui_ph
        sec
        sbc T1
        and #3
        cmp #1
        beq php1
        cmp #3
        beq php3
        lda #0
        rts
php1    lda #1
        rts
php3    lda #$FF
        rts

tui_mpoll
        lda $0279
        and #$0F
        tax
        lda minv,x
        sta mq
        lda mfirst
        beq mp1
        lda mq
        sta mold
        lda #0
        sta mfirst
mp1     lda mold
        and #3
        sta T1
        lda mq
        and #3
        jsr tui_ph
        clc
        adc mxa
        sta mxa
        lda mold
        lsr
        lsr
        sta T1
        lda mq
        lsr
        lsr
        jsr tui_ph
        clc
        adc mya
        sta mya
        lda mq
        sta mold
        lda mxa
        bmi mxn
        cmp #3
        bcc mxd
        lda #0
        sta mxa
        lda MX
        cmp #39
        bcs mxd
        inc MX
        bne mxd
mxn     cmp #$FE
        bcs mxd
        lda #0
        sta mxa
        lda MX
        beq mxd
        dec MX
mxd     lda mya
        bmi myn
        cmp #3
        bcc myd
        lda #0
        sta mya
        lda MY
        cmp #23
        bcs myd
        inc MY
        bne myd
myn     cmp #$FE
        bcs myd
        lda #0
        sta mya
        lda MY
        beq myd
        dec MY
myd     rts

; K: handler get-byte entry (vector table at $E420, entries are address-1)
tui_key
        lda $E425
        pha
        lda $E424
        pha
        rts

OX      .byte 0
OY      .byte 0
last    .byte 0

tui_event
        jsr tui_cur
te0     lda $14
        cmp last
        beq te0
        sta last
        lda $02FC
        cmp #$FF
        bne te_key
        lda MX
        sta OX
        lda MY
        sta OY
        jsr tui_mpoll
        lda MX
        cmp OX
        bne te_mv
        lda MY
        cmp OY
        beq te_btn
te_mv   lda MX
        pha
        lda MY
        pha
        lda OX
        sta MX
        lda OY
        sta MY
        jsr tui_cur
        pla
        sta MY
        pla
        sta MX
        jsr tui_cur
te_btn  lda $0285
        bne te_up
        lda mbtn
        bne te0
        lda #1
        sta mbtn
        jsr tui_cur
        lda #2
        rts
te_up   lda #0
        sta mbtn
        beq te0
te_key  jsr tui_key
        sta TKEY
        jsr tui_cur
        lda #1
        rts

; ---- menu bar ----
bidx    .byte 0
bcol    .byte 0
barn    .byte 0
barx    .byte 0,0,0,0,0,0,0,0,0

tui_bar
        lda #$80
        sta TCH
        lda #0
        sta TX
        sta TY
        sta bidx
        lda #1
        sta TH
        sta bcol
        lda #40
        sta TW
        jsr tui_fill
tb_lp   ldy #0
        lda (SP),y
        beq tb_dn
        ldx bidx
        lda bcol
        sta barx,x
        sta TX
        lda #0
        sta TY
        lda #$80
        sta TINV
        jsr tui_str
        clc
        adc #2
        adc bcol
        sta bcol
        inc bidx
        jsr tui_nextstr
        jmp tb_lp
tb_dn   ldx bidx
        lda bcol
        sta barx,x
        stx barn
        lda #0
        sta TINV
        rts

tui_barhit
        lda MY
        bne bh_no
        ldx barn
bh_lp   dex
        bmi bh_no
        lda MX
        cmp barx,x
        bcc bh_lp
        cmp barx+1,x
        bcs bh_no
        txa
        rts
bh_no   lda #$FF
        rts

; ---- pop-up menu ----
msp     .word 0
mn      .byte 0
mmax    .byte 0
mtx     .byte 0
mty     .byte 0
sel     .byte 0
mi      .byte 0

tui_hl
        lda mtx
        clc
        adc #1
        sta TX
        lda mty
        clc
        adc #1
        adc sel
        sta TY
        lda mmax
        clc
        adc #2
        sta TW
        jmp tui_inv

tui_menu
        lda TX
        sta mtx
        lda TY
        sta mty
        lda SP
        sta msp
        lda SP+1
        sta msp+1
        lda #0
        sta mn
        sta mmax
        sta sel
tm_p1   ldy #0
        lda (SP),y
        beq tm_p2
tm_l    lda (SP),y
        beq tm_ld
        iny
        bne tm_l
tm_ld   cpy mmax
        bcc tm_sk
        sty mmax
tm_sk   inc mn
        jsr tui_nextstr
        jmp tm_p1
tm_p2   lda mmax
        clc
        adc #4
        sta TW
        lda mn
        clc
        adc #2
        sta TH
        lda mtx
        sta TX
        lda mty
        sta TY
        jsr tui_box
        lda msp
        sta SP
        lda msp+1
        sta SP+1
        ldx #0
        lda #0
        sta TINV
tm_it   stx mi
        lda mtx
        clc
        adc #2
        sta TX
        lda mty
        sec
        adc mi
        sta TY
        jsr tui_str
        jsr tui_nextstr
        ldx mi
        inx
        cpx mn
        bne tm_it
tm_lp   jsr tui_hl
        jsr tui_event
        pha
        jsr tui_hl
        pla
        cmp #2
        beq tm_clk
        lda TKEY
        cmp #$9B
        beq tm_ok
        cmp #$1B
        beq tm_no
        cmp #$1C
        beq tm_up
        cmp #$1D
        bne tm_lp
        inc sel
        lda sel
        cmp mn
        bcc tm_lp
        lda #0
        sta sel
        beq tm_lp
tm_up   lda sel
        bne tm_u1
        lda mn
tm_u1   sec
        sbc #1
        sta sel
        jmp tm_lp
tm_ok   lda sel
        rts
tm_no   lda #$FF
        rts
tm_clk  lda MY
        sec
        sbc mty
        beq tm_no
        cmp mn
        beq tm_c1
        bcs tm_no
tm_c1   sta T2
        lda MX
        cmp mtx
        bcc tm_no
        sec
        sbc mtx
        beq tm_no
        sta T1
        lda mmax
        clc
        adc #2
        cmp T1
        bcc tm_no
        dec T2
        lda T2
        sta sel
        rts

; ---- message box ----
okstr   .byte '[ OK ]',0
mgw     .byte 0

tui_msg
        ldy #0
tg1     lda (SP),y
        beq tg2
        iny
        bne tg1
tg2     tya
        clc
        adc #4
        cmp #12
        bcs tg3
        lda #12
tg3     sta TW
        sta mgw
        lda #40
        sec
        sbc TW
        lsr
        sta TX
        lda #9
        sta TY
        lda #5
        sta TH
        jsr tui_box
        lda SP
        pha
        lda SP+1
        pha
        lda TX
        clc
        adc #2
        sta TX
        inc TY
        lda #0
        sta TINV
        jsr tui_str
        pla
        sta SP+1
        pla
        sta SP
        lda #40
        sec
        sbc mgw
        lsr
        sta mtx
        lda mgw
        sec
        sbc #6
        lsr
        clc
        adc mtx
        sta TX
        sta mtx
        lda #12
        sta TY
        lda #<okstr
        sta SP
        lda #>okstr
        sta SP+1
        lda #$80
        sta TINV
        jsr tui_str
        lda #0
        sta TINV
tg_lp   jsr tui_event
        cmp #2
        beq tg_clk
        lda TKEY
        cmp #$9B
        beq tg_dn
        cmp #$1B
        bne tg_lp
tg_dn   rts
tg_clk  lda MY
        cmp #12
        bne tg_lp
        lda MX
        cmp mtx
        bcc tg_lp
        sec
        sbc mtx
        cmp #6
        bcs tg_lp
        rts
