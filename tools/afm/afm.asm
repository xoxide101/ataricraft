; AFM - Ataricraft File Manager.  Two-pane file manager for Atari DOS 2 / MyDOS (uses CIO only).
; Build: mads afm.asm -o:afm.com

CIOV    = $E456
ICCOM   = $0342
ICBAL   = $0344
ICBAH   = $0345
ICBLL   = $0348
ICBLH   = $0349
ICAX1   = $034A
ICAX2   = $034B
ROWCRS  = $54
COLCRS  = $55
CRSINH  = $02F0
DOSVEC  = $0A
LDHDR   = $05F0
LDST    = $05F2
LDBA    = $05F4
LDBL    = $05F6
LDNAME  = $0580
RUNAD   = $02E0
INITAD  = $02E2

ZP      = $D4
ZP3     = $D8

MAXE    = 120
PANE0   = $5400
PANE1   = $5C00
MARKS   = $6400
LINE    = $4900
FSPEC   = $4940
FSPEC2  = $4980
INBUF   = $49C0
IOBUF   = $5000
VROWS   = 18

; editor / viewer
SAVMSC  = $58
EC      = $E0
EE      = $E2
ET      = $E4
EP      = $E6
ES      = $E8
EA      = $EA
EL      = $EC
EN      = $EE
EV      = $F0
EW      = $F2
EBUF    = $6500
EMAXPG  = $A5

; 16-bit compare: carry set if a>=b, Z set if equal
        .macro cmw
        lda :1+1
        cmp :2+1
        bne ?s
        lda :1
        cmp :2
?s
        .endm

; 16-bit compare against a constant
        .macro cmi
        lda :1+1
        cmp #>:2
        bne ?s
        lda :1
        cmp #<:2
?s
        .endm

        org $2000

start:
        lda #1
        sta CRSINH
        lda #0
        sta inv
        sta act
        ldx #0
        stx sel
        stx sel+1
        stx top
        stx top+1
        lda #1
        sta drv
        lda #2
        sta drv+1
        ldx #0
ks1:    lda kspec,x
        sta FSPEC,x
        inx
        cpx #3
        bcc ks1
        jsr usef1
        ldx #$30
        lda #4
        jsr openF
        jsr doinfo
        jsr drawui
        jsr reloadall
        jsr redraw
        jmp main
jdn:    jmp k_dn
jtab:   jmp k_tab
jup:    jmp k_up
main:
        jsr getkey
        cmp #28
        beq jup
        cmp #'-'
        beq jup
        cmp #'W'
        beq jup
        cmp #29
        beq jdn
        cmp #'='
        beq jdn
        cmp #'S'
        beq jdn
        cmp #127
        beq jtab
        cmp #' '
        beq jtab
        cmp #'1'
        bcc nodrv
        cmp #'9'
        bcs nodrv
        jmp k_drive
nodrv:
        cmp #'C'
        bne c1
        jmp docopy
c1:     cmp #'D'
        bne c2
        jmp dodel
c2:     cmp #'R'
        bne c3
        jmp doren
c3:     cmp #'L'
        bne c4
        jmp dolock
c4:     cmp #'U'
        bne c5
        jmp dounlock
c5:     cmp #'F'
        bne c6
        jmp doformat
c6:     cmp #'X'
        bne c7
        jmp doclear
c7:     cmp #'Q'
        bne c8
        jmp doquit
c8:     cmp #$9B
        bne c9
        jmp dorun
c9:     cmp #'M'
        bne c10
        jmp domkdir
c10:    cmp #'K'
        bne c11
        jmp dormdir
c11:    cmp #'T'
        bne c12
        jmp dotag
c12:    cmp #'A'
        bne c13
        jmp doall
c13:    cmp #'P'
        bne c14
        jmp doprops
c14:    cmp #'/'
        bne c15
        jmp dofind
c15:    cmp #'N'
        bne c16
        jmp fnext
c16:    cmp #'?'
        bne c17
        jmp dohelp
c17:    cmp #'B'
        bne c19
        jmp dobulk
c19:    cmp #'I'
        bne c20
        jsr doinfo
        jsr drawui
        jmp main
c20:    cmp #'E'
        bne c21
        jmp doedit
c21:    cmp #'V'
        bne c22
        jmp doview
c22:    cmp #'G'
        bne c18
        jmp donew
c18:    jmp main

k_tab:
        lda act
        eor #1
        sta act
        jsr redraw
        jmp main

k_up:
        ldx act
        lda sel,x
        beq ku_end
        sta oldsel
        dec sel,x
        lda sel,x
        cmp top,x
        bcs ku_row
        sta top,x
        jsr drawpane
        jmp main
ku_row:
        lda oldsel
        ldx act
        jsr drawrow
        ldx act
        lda sel,x
        jsr drawrow
ku_end: jmp main

k_dn:
        ldx act
        lda sel,x
        clc
        adc #1
        cmp cnt,x
        bcs kd_end
        pha
        lda sel,x
        sta oldsel
        pla
        sta sel,x
        sec
        sbc top,x
        cmp #VROWS
        bcc kd_row
        lda sel,x
        sec
        sbc #VROWS-1
        sta top,x
        jsr drawpane
        jmp main
kd_row:
        lda oldsel
        ldx act
        jsr drawrow
        ldx act
        lda sel,x
        jsr drawrow
kd_end: jmp main

k_drive:
        sec
        sbc #'0'
        ldx act
        sta drv,x
        lda #0
        sta plen,x
        sta sel,x
        sta top,x
        ldx act
        jsr loaddir
        jsr redraw
        jmp main

endir:  ldy #2
        lda (ZP),y
        cmp #'.'
        bne en_dn
        ldx act
        lda plen,x
        beq en_set
        sec
        sbc #1
        sta tmp
        lda pbase,x
        sta tmp+1
en_u:   lda tmp
        beq en_set
        clc
        adc tmp+1
        tay
        dey
        lda PATHS,y
        cmp #'>'
        beq en_set
        dec tmp
        jmp en_u
en_set: ldx act
        lda tmp
        sta plen,x
        jmp en_rl
en_dn:  ldx act
        lda plen,x
        clc
        adc #9
        cmp #25
        bcc en_ok
        jsr msgrow
        jsr putsi
        .byte 'PATH TOO LONG',0
        jmp main
en_ok:  lda pbase,x
        clc
        adc plen,x
        tax
        ldy #2
en_c:   lda (ZP),y
        cmp #' '
        beq en_e
        sta PATHS,x
        inx
        iny
        cpy #10
        bcc en_c
en_e:   lda #'>'
        sta PATHS,x
        inx
        txa
        ldx act
        sec
        sbc pbase,x
        sta plen,x
en_rl:  ldx act
        lda #0
        sta sel,x
        sta top,x
        jsr loaddir
        jsr redraw
        jmp main

dotag:  ldx act
        lda cnt,x
        bne tg_go
        jmp main
tg_go:  lda sel,x
        jsr entp
        ldy #0
        lda (ZP),y
        cmp #':'
        beq tg_mv
        iny
        lda (ZP),y
        cmp #':'
        beq tg_mv
        ldx act
        lda sel,x
        jsr mky
        lda MARKS,y
        eor #1
        sta MARKS,y
        ldx act
        lda sel,x
        jsr drawrow
tg_mv:  jmp k_dn

doall:  jsr cntmk
        beq da_set
        ldx act
        jsr clrmk
        jmp da_dr
da_set: lda #0
        sta cmiv
da_l:   ldx act
        lda cmiv
        cmp cnt,x
        bcs da_dr
        jsr entp
        ldy #0
        lda (ZP),y
        cmp #':'
        beq da_n
        iny
        lda (ZP),y
        cmp #':'
        beq da_n
        ldx act
        lda cmiv
        jsr mky
        lda #1
        sta MARKS,y
da_n:   inc cmiv
        jmp da_l
da_dr:  ldx act
        jsr drawpane
        jmp main

dig:    lda (ZP),y
        sec
        sbc #'0'
        cmp #10
        bcc dg_r
        lda #0
dg_r:   rts

mulacc: cpx #0
        beq ma_r
ma_l:   lda tsec
        clc
        adc mlo
        sta tsec
        bcc ma_n
        inc tsec+1
ma_n:   dex
        bne ma_l
ma_r:   rts

putd16: ldx #0
        stx pzf
pd16_n: lda #0
        sta pdg
pd16_s: lda pvl
        cmp ptlo,x
        lda pvh
        sbc pthi,x
        bcc pd16_p
        lda pvl
        sec
        sbc ptlo,x
        sta pvl
        lda pvh
        sbc pthi,x
        sta pvh
        inc pdg
        jmp pd16_s
pd16_p: lda pdg
        bne pd16_o
        lda pzf
        bne pd16_o
        cpx #4
        bne pd16_x
pd16_o: lda #1
        sta pzf
        lda pdg
        ora #'0'
        jsr putc
pd16_x: inx
        cpx #5
        bcc pd16_n
        rts
ptlo:   .byte <10000,<1000,<100,<10,<1
pthi:   .byte >10000,>1000,>100,>10,>1

doprops:
        jsr needf
        bne pr_go
        jmp main
pr_go:  jsr bstart
        lda #0
        sta tsec
        sta tsec+1
        sta tlk
        sta tdir
        sta tfil
pr_l:   jsr bnext
        bcs pr_e
        jmp pr_done
pr_e:   sta bcu
        ldx act
        lda bcu
        jsr entp
        ldy #0
        lda (ZP),y
        cmp #'*'
        bne pr_nl
        inc tlk
pr_nl:  lda (ZP),y
        cmp #':'
        beq pr_d
        iny
        lda (ZP),y
        cmp #':'
        beq pr_d
        inc tfil
        jmp pr_s
pr_d:   inc tdir
pr_s:   ldy #14
        jsr dig
        tax
        lda #100
        sta mlo
        jsr mulacc
        ldy #15
        jsr dig
        tax
        lda #10
        sta mlo
        jsr mulacc
        ldy #16
        jsr dig
        tax
        lda #1
        sta mlo
        jsr mulacc
        jmp pr_l
pr_done:
        jsr msgrow
        lda bsing
        beq pr_multi
        lda bcu
        ldx act
        jsr mkspec
        lda tdir
        beq pr_f
        jsr putsi
        .byte 'FOLDER ',0
        jmp pr_sz
pr_f:   jsr putsi
        .byte 'FILE ',0
pr_sz:  lda tsec
        sta pvl
        lda tsec+1
        sta pvh
        jsr putd16
        jsr putsi
        .byte ' SECTORS',0
        lda tlk
        beq pr_nlk
        jsr putsi
        .byte ' LOCKED',0
pr_nlk: jsr rowprompt
        jsr putfs
        jmp main
pr_multi:
        lda bn
        sta pvl
        lda #0
        sta pvh
        jsr putd16
        jsr putsi
        .byte ' FILES ',0
        lda tsec
        sta pvl
        lda tsec+1
        sta pvh
        jsr putd16
        jsr putsi
        .byte ' SECTORS ',0
        lda tlk
        sta pvl
        lda #0
        sta pvh
        jsr putd16
        jsr putsi
        .byte ' LOCKED',0
        jsr rowprompt
        ldx act
        jsr mkdrvspec
        jsr putfs
        jmp main

dofind: jsr rowprompt
        jsr putsi
        .byte 'FIND: ',0
        jsr rdline
        bne fd_ok
        jmp cancel
fd_ok:  sta fl
        ldy #0
fd_c:   lda INBUF,y
        sta fbuf,y
        iny
        cpy fl
        bcc fd_c
fnext:  lda fl
        bne fn_go
        jmp main
fn_go:  ldx act
        lda cnt,x
        bne fn_ok
        jmp main
fn_ok:  lda sel,x
        sta fpos
        lda #0
        sta fcnt
fn_l:   inc fpos
        ldx act
        lda fpos
        cmp cnt,x
        bcc fn_c
        lda #0
        sta fpos
fn_c:   jsr matchent
        bcs fn_hit
        inc fcnt
        ldx act
        lda fcnt
        cmp cnt,x
        bcc fn_l
        jsr msgrow
        jsr putsi
        .byte 'NOT FOUND',0
        jmp main
fn_hit: ldx act
        lda fpos
        sta sel,x
        sec
        sbc top,x
        bcc fn_top
        cmp #VROWS
        bcc fn_dr
fn_top: lda sel,x
        sta top,x
fn_dr:  jsr drawpane
        jmp main

matchent:
        ldx act
        lda fpos
        jsr entp
        lda #2
        sta fs
me_s:   lda #0
        sta fj
me_c:   lda fs
        clc
        adc fj
        tay
        ldx fj
        lda (ZP),y
        cmp fbuf,x
        bne me_n
        inc fj
        lda fj
        cmp fl
        bcc me_c
        sec
        rts
me_n:   inc fs
        lda fs
        clc
        adc fl
        cmp #14
        bcc me_s
        clc
        rts

; ---------- new file (text or hex, saved from the editor) ----------
donew:  jsr rowprompt
        jsr putsi
        .byte 'NEW FILE NAME: ',0
        lda #12
        sta rlmax
        jsr rdline
        pha
        lda #8
        sta rlmax
        pla
        bne nw_ok
        jmp cancel
nw_ok:  ldx act
        stx pn
        lda drv,x
        ora #'0'
        sta FSPEC+1
        lda #'D'
        sta FSPEC
        lda #':'
        sta FSPEC+2
        ldx #3
        jsr apath
        ldy #0
nw_c:   lda INBUF,y
        sta FSPEC,x
        inx
        iny
        cpy ri
        bcc nw_c
        lda #$9B
        sta FSPEC,x
        jsr usef1
        ldx #$10
        lda #4
        jsr openF
        bmi nw_new0
        jsr close1
        jsr msgrow
        jsr putsi
        .byte 'FILE ALREADY EXISTS',0
        jmp main
nw_new0: jsr close1
nw_new: lda #1
        sta ednew
        lda #0
        sta edro
        jmp ed_ld

; ---------- editor / viewer ----------
doview: lda #1
        bne ed_set
doedit: lda #0
ed_set: sta edro
        lda #0
        sta ednew
        jsr needf
        bne ed_go
        jmp main
ed_go:  ldx act
        lda sel,x
        jsr mkspec
        ldy #0
        lda (ZP),y
        cmp #':'
        beq ed_nf
        iny
        lda (ZP),y
        cmp #':'
        bne ed_ld
ed_nf:  jsr msgrow
        jsr putsi
        .byte 'NOT A FILE',0
        jmp main
ed_ld:  lda $6A
        sec
        sbc #5
        cmp #EMAXPG
        bcc ed_l1
        lda #EMAXPG
ed_l1:  sta elim+1
        lda #0
        sta elim
        sta edmod
        sta edhex
        sta edkeep
        mwa #EBUF EE
        mwa #EBUF EC
        mwa #EBUF ET
        lda ednew
        beq ed_old
        jmp ed_ok2
ed_old: jsr usef1
        ldx #$10
        lda #4
        jsr openF
        bpl ed_rd
        sty est
        jmp ed_fail
ed_rd:  sec
        lda elim
        sbc EE
        sta EV
        lda elim+1
        sbc EE+1
        sta EV+1
        ora EV
        beq ed_full
        ldx #$10
        lda #7
        sta ICCOM,x
        lda EE
        sta ICBAL,x
        lda EE+1
        sta ICBAH,x
        lda EV
        sta ICBLL,x
        lda EV+1
        sta ICBLH,x
        jsr CIOV
        sty est
        lda ICBLL+$10
        clc
        adc EE
        sta EE
        lda ICBLH+$10
        adc EE+1
        sta EE+1
        lda est
        cmp #1
        beq ed_rd
        cmp #136
        beq ed_ok
        jsr close1
        jmp ed_fail
ed_full:
        ldx #$10
        lda #7
        sta ICCOM,x
        lda #<INBUF
        sta ICBAL,x
        lda #>INBUF
        sta ICBAH,x
        lda #1
        sta ICBLL,x
        lda #0
        sta ICBLH,x
        jsr CIOV
        sty est
        jsr close1
        lda est
        cmp #136
        beq ed_ok2
        jsr msgrow
        jsr putsi
        .byte 'FILE TOO BIG FOR EDITOR',0
        jmp main
ed_fail:
        jsr showerr
        jmp main
ed_ok:  jsr close1
ed_ok2: lda #125
        jsr putraw
ed_loop:
        jsr edfix
        jsr edrender
        lda edkeep
        bne ed_k
        jsr edstat
ed_k:   lda #0
        sta edkeep
        jsr getraw
        jsr edkey
        bcc ed_loop
        jsr reloadact
        jsr drawui
        jmp main

edkey:  cmp #$1B
        bne ek1
        jmp edesc
ek1:    cmp #$1C
        bne ek2
        jsr edup
        clc
        rts
ek2:    cmp #$1D
        bne ek3
        jsr eddn
        clc
        rts
ek3:    cmp #$1E
        bne ek4
        jsr edlf
        clc
        rts
ek4:    cmp #$1F
        bne ek5
        jsr edrt
        clc
        rts
ek5:    cmp #$7E
        bne ek6
        jsr eddel
        clc
        rts
ek6:    ldx edhex
        beq ek6a
        jsr edhexk
        bcs ek_n
ek6a:   cmp #$9B
        beq ek_ins
        cmp #$20
        bcc ek_n
        cmp #$7D
        bcs ek_n
ek_ins: jsr edins
ek_n:   clc
        rts

; hex mode: two hex digits write one byte at the cursor (appends at the end)
eh_no:  lda #0
        sta ehn
        lda ehk
        clc
        rts
eh_x:   sec
        rts
edhexk: sta ehk
        lda edro
        bne eh_no
        lda ehk
        cmp #'0'
        bcc eh_no
        cmp #'9'+1
        bcc eh_d
        and #$DF
        cmp #'A'
        bcc eh_no
        cmp #'G'
        bcs eh_no
        sec
        sbc #'A'-10
        jmp eh_v
eh_d:   sec
        sbc #'0'
eh_v:   sta ehv
        lda ehn
        bne eh_2
        lda ehv
        asl
        asl
        asl
        asl
        sta ehh
        lda #1
        sta ehn
        jsr edmsg22
        jsr putsi
        .byte 'HEX: ENTER SECOND DIGIT',0
        sec
        rts
eh_2:   lda #0
        sta ehn
        lda ehh
        ora ehv
        sta ehb
        cmw EC EE
        bcc eh_ow
        cmw EE elim
        bcc eh_ap
        jmp eh_x
eh_ap:  lda ehb
        ldy #0
        sta (EC),y
        inw EE
        inw EC
        jmp eh_m
eh_ow:  lda ehb
        ldy #0
        sta (EC),y
        inw EC
eh_m:   lda #1
        sta edmod
        sec
        rts

edesc:  jsr getkey
        cmp #'S'
        bne es1
        jmp edsave
es1:    cmp #'Q'
        bne es2
        jmp edquit
es2:    cmp #'H'
        bne es3
        jmp edtoggle
es3:    cmp #'U'
        bne es4
        lda #20
        sta edpc
es3l:   jsr edup
        dec edpc
        bne es3l
        clc
        rts
es4:    cmp #'D'
        bne es5
        lda #20
        sta edpc
es4l:   jsr eddn
        dec edpc
        bne es4l
        clc
        rts
es5:    cmp #'T'
        bne es6
        mwa #EBUF EC
        clc
        rts
es6:    cmp #'E'
        bne es7
        mwa EE EC
        clc
        rts
es7:    clc
        rts

edtoggle:
        lda edhex
        eor #1
        sta edhex
        beq et_t
        mwa #EBUF ET
        clc
        rts
et_t:   mwa EC ET
        inw ET
        clc
        rts

edquit: lda edmod
        beq eq_y
        jsr edclr22
        lda #22
        ldx #0
        jsr setpos
        jsr putsi
        .byte 'DISCARD CHANGES? (Y/N)',0
        jsr getkey
        cmp #'Y'
        beq eq_y
        clc
        rts
eq_y:   sec
        rts

edmsg22:
        jsr edclr22
        lda #22
        ldx #0
        jsr setpos
        lda #1
        sta edkeep
        rts

edsave: lda edro
        beq sv_go
        jsr edmsg22
        jsr putsi
        .byte 'VIEW MODE - CANNOT SAVE',0
        clc
        rts
sv_go:  jsr usef1
        ldx #$10
        lda #8
        jsr openF
        bpl sv_w
        sty est
        jmp sv_err
sv_w:   sec
        lda EE
        sbc #<EBUF
        sta EV
        lda EE+1
        sbc #>EBUF
        sta EV+1
        ora EV
        beq sv_cl
        ldx #$10
        lda #11
        sta ICCOM,x
        lda #<EBUF
        sta ICBAL,x
        lda #>EBUF
        sta ICBAH,x
        lda EV
        sta ICBLL,x
        lda EV+1
        sta ICBLH,x
        jsr CIOV
        sty est
        cpy #1
        bne sv_e2
sv_cl:  jsr close1
        bpl sv_ok
        sty est
        jmp sv_err
sv_e2:  jsr close1
sv_err: jsr edmsg22
        jsr putsi
        .byte 'SAVE FAILED - ERROR ',0
        lda est
        jsr putdec
        clc
        rts
sv_ok:  lda #0
        sta edmod
        jsr edmsg22
        jsr putsi
        .byte 'SAVED',0
        clc
        rts

edclr22:
        clc
        lda SAVMSC
        adc #<880
        sta ES
        lda SAVMSC+1
        adc #>880
        sta ES+1
        ldy #39
        lda #0
ec_l:   sta (ES),y
        dey
        bpl ec_l
        rts

edstat: ldy #39
        lda #$80
est1:   sta (SAVMSC),y
        dey
        bpl est1
        sta inv
        lda #0
        ldx #1
        jsr setpos
        lda edro
        bne est2
        jsr putsi
        .byte 'EDIT ',0
        jmp est3
est2:   jsr putsi
        .byte 'VIEW ',0
est3:   jsr putfs
        lda edmod
        beq est4
        lda #'*'
        jsr putc
est4:   lda #0
        sta inv
        jsr edclr22
        lda #22
        ldx #0
        jsr setpos
        jsr putsi
        .byte 'LEN ',0
        sec
        lda EE
        sbc #<EBUF
        sta pvl
        lda EE+1
        sbc #>EBUF
        sta pvh
        jsr putd16
        jsr putsi
        .byte '  FREE ',0
        sec
        lda elim
        sbc EE
        sta pvl
        lda elim+1
        sbc EE+1
        sta pvh
        jsr putd16
        lda edhex
        beq est5
        jsr putsi
        .byte '  HEX',0
est5:   lda #23
        ldx #0
        jsr setpos
        jsr putsi
        .byte 'ESC S)AVE Q)UIT H)EX U)P D)N T)OP E)ND',0
        rts

; keep cursor on screen by adjusting the top-of-window pointer
edfix:  lda edhex
        beq ef_t
        jmp ef_hex
ef_t:   cmw EC ET
        bcs ef_t1
        jsr edls
        sec
        lda EC
        sbc EA
        sta EV
        lda EC+1
        sbc EA+1
        sta EV+1
        jsr mod40
        sec
        lda EC
        sbc EV
        sta ET
        lda EC+1
        sbc #0
        sta ET+1
        rts
ef_t1:  mwa ET EL
        mwa ET EP
        lda #0
        sta edrw
ef_lp:  cmw EL EE
        bcs ef_dn
        jsr edadv
        cmw EL EC
        bcc ef_ct
        beq ef_ct
        jmp ef_dn
ef_ct:  inc edrw
        lda edrw
        cmp #21
        bcc ef_lp
        mwa EL EN
        mwa EP EL
        jsr edadv
        mwa EL EP
        mwa EN EL
        dec edrw
        jmp ef_lp
ef_dn:  mwa EP ET
        rts

ef_hex: cmw EC EE
        bcc ef_h0
        mwa EE EC
        lda edro
        beq ef_h0
        cmi EC EBUF
        beq ef_h0
        dew EC
ef_h0:  sec
        lda EC
        sbc #<EBUF
        sta EV
        lda EC+1
        sbc #>EBUF
        sta EV+1
        lda EV
        and #$F8
        sta EV
        clc
        lda EV
        adc #<EBUF
        sta EN
        lda EV+1
        adc #>EBUF
        sta EN+1
        cmw EN ET
        bcs ef_h1
        mwa EN ET
        rts
ef_h1:  sec
        lda EN
        sbc ET
        sta EV
        lda EN+1
        sbc ET+1
        bne ef_h2
        lda EV
        cmp #168
        bcc ef_h3
ef_h2:  sec
        lda EN
        sbc #160
        sta ET
        lda EN+1
        sbc #0
        sta ET+1
ef_h3:  rts

; EL advanced by one display row (40 chars or to after the EOL)
edadv:  lda #0
        sta edcn
ea_l:   cmw EL EE
        bcs ea_r
        ldy #0
        lda (EL),y
        inw EL
        cmp #$9B
        beq ea_r
        inc edcn
        lda edcn
        cmp #40
        bcc ea_l
ea_r:   rts

mod40:  lda EV+1
        bne m40s
        lda EV
        cmp #40
        bcc m40d
m40s:   sec
        lda EV
        sbc #40
        sta EV
        bcs mod40
        dec EV+1
        jmp mod40
m40d:   rts

; EA = start of the line holding EC
edls:   mwa EC EA
el1:    cmi EA EBUF
        beq el9
        dew EA
        ldy #0
        lda (EA),y
        cmp #$9B
        bne el1
        inw EA
el9:    rts

; EL = end of line (EOL position or EE), scanning from EL
edle:   cmw EL EE
        bcs ele_r
        ldy #0
        lda (EL),y
        cmp #$9B
        beq ele_r
        inw EL
        jmp edle
ele_r:  rts

edlf:   lda edhex
        beq lf_t
        jmp hxlf
lf_t:   cmi EC EBUF
        beq lf_r
        dew EC
lf_r:   rts

edrt:   lda edhex
        beq rt_t
        jmp hxrt
rt_t:   cmw EC EE
        bcs rt_r
        inw EC
rt_r:   rts

eddn:   lda edhex
        beq dn_t
        jmp hxdn
dn_t:   jsr edls
        sec
        lda EC
        sbc EA
        sta EV
        lda EC+1
        sbc EA+1
        sta EV+1
        mwa EA EL
        jsr edle
        sec
        lda EL
        sbc EA
        sta EW
        lda EL+1
        sbc EA+1
        sta EW+1
        clc
        lda EV
        adc #40
        sta EN
        lda EV+1
        adc #0
        sta EN+1
        cmw EW EN
        bcc dn_nx
        adw EC #40
        rts
dn_nx:  cmw EL EE
        bcs dn_rt
        inw EL
        jsr mod40
        mwa EL EA
        jsr edle
        sec
        lda EL
        sbc EA
        sta EW
        lda EL+1
        sbc EA+1
        bne dn_c
        lda EW
        cmp EV
        bcs dn_c
        sta EV
dn_c:   clc
        lda EA
        adc EV
        sta EC
        lda EA+1
        adc #0
        sta EC+1
dn_rt:  rts

edup:   lda edhex
        beq up_t
        jmp hxup
up_t:   jsr edls
        sec
        lda EC
        sbc EA
        sta EV
        lda EC+1
        sbc EA+1
        sta EV+1
        bne up_p
        lda EV
        cmp #40
        bcs up_p
        cmi EA EBUF
        beq up_r
        lda EV
        sta edcol
        mwa EA EC
        dew EC
        jsr edls
        sec
        lda EC
        sbc EA
        sta EW
        lda EC+1
        sbc EA+1
        sta EW+1
        mwa EW EV
        jsr mod40
        sec
        lda EW
        sbc EV
        sta EN
        lda EW+1
        sbc #0
        sta EN+1
        clc
        lda EN
        adc edcol
        sta EN
        lda EN+1
        adc #0
        sta EN+1
        cmw EN EW
        bcc up_n
        mwa EW EN
up_n:   clc
        lda EA
        adc EN
        sta EC
        lda EA+1
        adc EN+1
        sta EC+1
up_r:   rts
up_p:   sbw EC #40
        rts

; A = character to insert at the cursor
edins:  sta edtmp
        lda edro
        bne ei_r
        lda edhex
        bne ei_r
        cmw EE elim
        bcs ei_r
        mwa EE EL
ei_l:   cmw EL EC
        beq ei_s
        dew EL
        ldy #0
        lda (EL),y
        iny
        sta (EL),y
        jmp ei_l
ei_s:   lda edtmp
        ldy #0
        sta (EC),y
        inw EC
        inw EE
        lda #1
        sta edmod
ei_r:   rts

eddel:  lda edro
        bne dl_r
        cmi EC EBUF
        beq dl_r
        dew EC
        dew EE
        mwa EC EL
dl_l:   cmw EL EE
        bcs dl_d
        ldy #1
        lda (EL),y
        dey
        sta (EL),y
        inw EL
        jmp dl_l
dl_d:   lda #1
        sta edmod
dl_r:   rts

; ATASCII -> screen code
tosc:   sta edtmp
        and #$7F
        cmp #$20
        bcc ts_a
        cmp #$60
        bcs ts_m
        sec
        sbc #$20
        jmp ts_m
ts_a:   clc
        adc #$40
ts_m:   sta ecv
        lda edtmp
        and #$80
        ora ecv
        rts

tohc:   sta edtmp
        and #$7F
        cmp #$20
        bcc th_d
        cmp #$7C
        bcs th_d
        jmp tosc
th_d:   lda #$0E
        rts

edrender:
        lda edhex
        beq er_t
        jmp edhrender
er_t:   clc
        lda SAVMSC
        adc #40
        sta ES
        lda SAVMSC+1
        adc #0
        sta ES+1
        clc
        lda SAVMSC
        adc #<880
        sta edse
        lda SAVMSC+1
        adc #>880
        sta edse+1
        mwa ET EP
        lda #0
        sta ecol
        sta ecf
er_l:   cmw ES edse
        bcc er_c
        jmp er_done
er_c:   cmw EP EC
        bne er_n1
        mwa ES EN
        lda #1
        sta ecf
er_n1:  cmw EP EE
        bne er_n2
        jmp er_fill
er_n2:  ldy #0
        lda (EP),y
        cmp #$9B
        beq er_eol
        jsr tosc
        ldy #0
        sta (ES),y
        inw ES
        inw EP
        inc ecol
        lda ecol
        cmp #40
        bcc er_l
        lda #0
        sta ecol
        jmp er_l
er_eol: lda ecol
        beq er_f40
        lda #40
        sec
        sbc ecol
        jmp er_fc
er_f40: lda #40
er_fc:  tax
        lda #0
        sta ecol
er_fl:  ldy #0
        sta (ES),y
        inw ES
        dex
        bne er_fl
        inw EP
        jmp er_l
er_fill:
        cmw ES edse
        bcs er_done
        lda #0
        tay
        sta (ES),y
        inw ES
        jmp er_fill
er_done:
        lda ecf
        beq er_x
        ldy #0
        lda (EN),y
        eor #$80
        sta (EN),y
er_x:   rts

; hex dump: offset, 8 bytes, 8 chars per row
edhrender:
        clc
        lda SAVMSC
        adc #40
        sta ES
        lda SAVMSC+1
        adc #0
        sta ES+1
        mwa ET EP
        lda #21
        sta edrw
hr_row: ldy #39
        lda #0
hr_c:   sta (ES),y
        dey
        bpl hr_c
        cmw EP EE
        bcc hr_ok
        jmp hr_nx
hr_ok:  sec
        lda EP
        sbc #<EBUF
        sta EV
        lda EP+1
        sbc #>EBUF
        sta EV+1
        ldy #0
        lda EV+1
        jsr hr_h2
        lda EV
        jsr hr_h2
        ldx #0
hr_b:   stx edi
        txa
        clc
        adc EP
        sta EN
        lda EP+1
        adc #0
        sta EN+1
        cmw EN EE
        bcs hr_nx
        lda edi
        asl
        clc
        adc edi
        clc
        adc #5
        sta edy
        ldy #0
        lda (EN),y
        sta ecv
        ldy edy
        lda ecv
        jsr hr_h2
        lda ecv
        jsr tohc
        pha
        lda edi
        clc
        adc #30
        tay
        pla
        sta (ES),y
        ldx edi
        inx
        cpx #8
        bcc hr_b
hr_nx:  adw EP #8
        adw ES #40
        dec edrw
        beq hr_end
        jmp hr_row
hr_end: sec
        lda EC
        sbc ET
        sta EV
        lda EC+1
        sbc ET+1
        bne hr_x
        lda EV
        cmp #168
        bcs hr_x
        lsr
        lsr
        lsr
        tax
        lda EV
        and #7
        sta edi
        clc
        lda SAVMSC
        adc #40
        sta ES
        lda SAVMSC+1
        adc #0
        sta ES+1
hr_m1:  cpx #0
        beq hr_m2
        adw ES #40
        dex
        jmp hr_m1
hr_m2:  lda edi
        asl
        clc
        adc edi
        clc
        adc #5
        tay
        lda (ES),y
        eor #$80
        sta (ES),y
        iny
        lda (ES),y
        eor #$80
        sta (ES),y
        lda edi
        clc
        adc #30
        tay
        lda (ES),y
        eor #$80
        sta (ES),y
hr_x:   rts

hr_h2:  pha
        lsr
        lsr
        lsr
        lsr
        jsr hr_n
        pla
        and #15
hr_n:   cmp #10
        bcc hr_d
        adc #$16
        jmp hr_s
hr_d:   ora #$10
hr_s:   sta (ES),y
        iny
        rts

hxlf:   cmi EC EBUF
        beq hl_r
        dew EC
hl_r:   rts

hxrt:   lda edro
        bne hx_ro
        cmw EC EE
        bcs hr_r2
        inw EC
        rts
hx_ro:  mwa EC EL
        inw EL
        cmw EL EE
        bcs hr_r2
        inw EC
hr_r2:  rts

hxup:   cmi EC EBUF+8
        bcc hu_r
        sbw EC #8
hu_r:   rts

hxdn:   mwa EC EL
        adw EL #8
        cmw EL EE
        bcc hd_ok
        cmi EE EBUF
        beq hd_r
        mwa EE EC
        dew EC
        rts
hd_ok:  mwa EL EC
hd_r:   rts

; extended RAM probe. Must live below $4000 (the PORTB bank window). Only one byte per bank is touched and restored.
; returns A = number of distinct 16 KB banks (0 = none). Combo bits map to PORTB bits 1,2,3,5,6,7.
xdet:   lda $FCD8
        cmp #$4C
        beq xd_go
        lda #0
        rts
xd_go:  php
        sei
        lda #0
        sta $D40E
        lda $D301
        sta xsv
        ora #$10
        sta xmain
        sta $D301
        lda $4000
        sta xorig
        lda #$A5
        sta $4000
        ldx #0
xd_1:   jsr xpv
        sta $D301
        lda $4000
        sta $0600,x
        inx
        cpx #64
        bne xd_1
        ldx #0
xd_2:   jsr xpv
        sta $D301
        txa
        sta $4000
        inx
        cpx #64
        bne xd_2
        lda #0
        sta xcnt
        ldx #0
xd_3:   jsr xpv
        sta $D301
        lda $4000
        stx xtmp
        cmp xtmp
        bne xd_3n
        inc xcnt
xd_3n:  inx
        cpx #64
        bne xd_3
        lda xmain
        sta $D301
        lda $4000
        cmp #$A5
        beq xd_ok2
        lda #0
        sta xcnt
xd_ok2: ldx #0
xd_4:   jsr xpv
        sta $D301
        lda $0600,x
        sta $4000
        inx
        cpx #64
        bne xd_4
        lda xmain
        sta $D301
        lda xorig
        sta $4000
        lda xsv
        sta $D301
        lda #$40
        sta $D40E
        plp
        lda xcnt
        rts

xpv:    txa
        and #7
        asl
        sta xtmp
        txa
        and #$38
        asl
        asl
        ora xtmp
        ora #1
        rts

xsv:    .byte 0
xmain:  .byte 0
xorig:  .byte 0
xcnt:   .byte 0
xtmp:   .byte 0
xkl:    .byte 0
xkh:    .byte 0

; system information screen (also shown at startup, I key)
doinfo:
        lda #125
        jsr putraw
        jsr putsi
        .byte ' ATARICRAFT AFM - SYSTEM INFO',$9B,$9B
        .byte 'COMPUTER: ',0
        lda $FCD8
        cmp #$4C
        beq in_xl
        jsr putsi
        .byte 'ATARI 400/800',0
        jmp in_vid
in_xl:  jsr putsi
        .byte 'ATARI XL/XE  OS REV ',0
        lda $FFF7
        and #$0F
        ora #'0'
        jsr putc
in_vid: jsr putsi
        .byte $9B,'VIDEO:    ',0
        lda $D014
        and #$0E
        beq in_pal
        jsr putsi
        .byte 'NTSC 60HZ',0
        jmp in_ram
in_pal: jsr putsi
        .byte 'PAL 50HZ',0
in_ram: jsr putsi
        .byte $9B,'MEMORY:   ',0
        lda $6A
        lsr
        lsr
        ldx $FCD8
        cpx #$4C
        bne in_m1
        ldx $6A
        cpx #$C0
        bcc in_m1
        lda #64
in_m1:  sta pvl
        lda #0
        sta pvh
        jsr putd16
        jsr putsi
        .byte ' KB (RAMTOP $',0
        lda $6A
        jsr puthex
        jsr putsi
        .byte '00)',$9B,'EXT RAM:  ',0
        jsr xdet
        beq in_nx
        sta pvh
        asl
        asl
        asl
        asl
        sta pvl
        lda pvh
        lsr
        lsr
        lsr
        lsr
        sta pvh
        sta xkh
        lda pvl
        sta xkl
        jsr putd16
        jsr putsi
        .byte ' KB  (TOTAL ',0
        clc
        lda xkl
        adc #64
        sta pvl
        lda xkh
        adc #0
        sta pvh
        jsr putd16
        jsr putsi
        .byte ' KB)',0
        jmp in_xd
in_nx:  jsr putsi
        .byte 'NONE',0
in_xd:  jsr putsi
        .byte $9B,'DOS TOP:  $',0
        lda $2E8
        jsr puthex
        lda $2E7
        jsr puthex
        jsr putsi
        .byte ' (MEMLO)',$9B,'DOS:      ',0
        ldx #3
        lda $0700
        cmp #'M'
        bne in_a1
        ldx #1
        jmp in_got
in_a1:  cmp #'S'
        bne in_a2
        lda $0701
        cmp #'D'
        bne in_a2
        ldx #2
        jmp in_got
in_a2:  lda $0B
        cmp #$17
        bne in_got
        ldx #0
in_got: stx dosid
        cpx #1
        bne in_n1
        jmp in_my
in_n1:  cpx #2
        bne in_n2
        jmp in_sd
in_n2:  cpx #0
        bne in_n3
        jmp in_d2
in_n3:  jsr putsi
        .byte 'UNKNOWN - TRY IT AND SEE',$9B,0
        jmp in_end
in_my:  jsr putsi
        .byte 'MYDOS',$9B,$9B
        .byte 'THIS DOS CAN:',$9B
        .byte ' FOLDERS - MKDIR, RMDIR, > PATHS',$9B
        .byte ' RENAME, LOCK, COPY, DELETE',$9B
        .byte ' BIG DISKS, 128-512 BYTE SECTORS',$9B,$9B
        .byte 'CANNOT:',$9B
        .byte ' LONG NAMES (8.3 NAMES ONLY)',$9B,0
        jmp in_end
in_sd:  jsr putsi
        .byte 'SPARTADOS (X)',$9B,$9B
        .byte 'THIS DOS CAN:',$9B
        .byte ' FOLDERS - MKDIR, RMDIR, > PATHS',$9B
        .byte ' RENAME, LOCK, COPY, DELETE',$9B
        .byte ' LARGE VOLUMES',$9B,$9B
        .byte 'NOTE:',$9B
        .byte ' FREE COUNT READS 999 MAX HERE',$9B,0
        jmp in_end
in_d2:  jsr putsi
        .byte 'ATARI DOS 2.0S / 2.5',$9B,$9B
        .byte 'THIS DOS CAN:',$9B
        .byte ' RENAME, LOCK, COPY, DELETE, FORMAT',$9B,$9B
        .byte 'CANNOT:',$9B
        .byte ' FOLDERS (NO MKDIR / RMDIR)',$9B
        .byte ' MORE THAN 64 FILES PER DISK',$9B,0
in_end: jsr putsi
        .byte $9B,'AFM: TAG COPY DELETE FIND VIEW EDIT',$9B,$9B
        .byte 'PRESS ANY KEY',0
        jsr getkey
        rts

puthex: pha
        lsr
        lsr
        lsr
        lsr
        jsr ph_n
        pla
        and #15
ph_n:   cmp #10
        bcc ph_d
        adc #6
ph_d:   adc #'0'
        jmp putc

dohelp: lda #125
        jsr putraw
        jsr putsi
        .byte ' ATARICRAFT AFM - KEYS',$9B,$9B
        .byte 'W/S OR -/=   MOVE CURSOR',$9B
        .byte 'TAB OR SPACE SWITCH PANE',$9B
        .byte '1-8          CHANGE DRIVE',$9B
        .byte 'RETURN       RUN / OPEN FOLDER',$9B
        .byte '             (.. GOES UP)',$9B,$9B
        .byte 'C COPY  D DELETE  R RENAME',$9B
        .byte 'L LOCK  U UNLOCK  F FORMAT',$9B
        .byte 'X CLEAR DISK/FOLDER',$9B
        .byte 'M MKDIR  K RMDIR',$9B
        .byte 'B BULK MKDIR A-Z / 0-9',$9B
        .byte 'T TAG FILE (MULTI-SELECT)',$9B
        .byte 'A TAG ALL / CLEAR TAGS',$9B
        .byte 'P PROPERTIES (TAGGED FILES TOO)',$9B
        .byte '/ FIND NAME  N FIND NEXT',$9B
        .byte 'V VIEW FILE (H = HEX)',$9B
        .byte 'E EDIT (ESC H = HEX: TYPE 0-9 A-F)',$9B
        .byte 'I INFO  G NEW FILE  Q QUIT',$9B,$9B
        .byte 'COPY/DELETE/LOCK/UNLOCK USE TAGS',$9B
        .byte 'PRESS ANY KEY',0
        jsr getkey
        jsr drawui
        jmp main

doquit:
        lda #0
        sta CRSINH
        lda #125
        jsr putraw
        jmp (DOSVEC)

; ---------- operations ----------

dorun:
        jsr need
        bne ru_go
        jmp main
ru_go:  ldx act
        lda sel,x
        jsr mkspec
        ldy #0
        lda (ZP),y
        cmp #':'
        beq ru_dir
        iny
        lda (ZP),y
        cmp #':'
        bne ru_t0
ru_dir: jmp endir
ru_t0:  lda #0
        sta ei
ru_t:   ldx ei
        ldy #10
ru_c:   lda (ZP),y
        cmp exts,x
        bne ru_nx
        inx
        iny
        cpy #13
        bcc ru_c
        bcs ru_yes
ru_nx:  lda ei
        clc
        adc #3
        sta ei
        cmp #9
        bcc ru_t
        ldy #10
        lda (ZP),y
        cmp #'B'
        bne ru_np
        iny
        lda (ZP),y
        cmp #'A'
        bne ru_np
        iny
        lda (ZP),y
        cmp #'S'
        bne ru_np
        jsr msgrow
        jsr putsi
        .byte 'REM RUN "',0
        jsr putfs
        lda #'"'
        jsr putc
        jmp main
ru_np:  jsr msgrow
        jsr putsi
        .byte 'NOT A PROGRAM',0
        jmp main
ru_yes: ldx #0
ru_cp:  lda FSPEC,x
        sta LDNAME,x
        inx
        cmp #$9B
        bne ru_cp
        ldx #$30
        jsr closeF
        lda #0
        sta CRSINH
        lda #125
        jsr putraw
        jmp ldrun

need:
        ldx act
        lda cnt,x
        bne need_ok
        jsr msgrow
        jsr putsi
        .byte 'NO FILE SELECTED',0
        lda #0
        rts
need_ok:
        lda #1
        rts

needf:  jsr need
        beq nf_r
        ldx act
        lda sel,x
        jsr entp
        ldy #2
        lda (ZP),y
        cmp #'.'
        bne nf_ok
        jsr msgrow
        jsr putsi
        .byte 'NOT A FILE',0
        lda #0
        rts
nf_ok:  lda #1
nf_r:   rts

mky:    cpx #0
        beq mky_0
        ora #$80
mky_0:  tay
        rts

clrmk:  lda #0
        cpx #0
        beq cm_s
        lda #$80
cm_s:   tay
        lda #0
        sta mkn
cm_l:   lda #0
        sta MARKS,y
        iny
        inc mkn
        bpl cm_l
        rts

cntmk:  lda #0
        sta mc
        sta cmiv
cn_l:   ldx act
        lda cmiv
        cmp cnt,x
        bcs cn_d
        jsr mky
        lda MARKS,y
        beq cn_n
        inc mc
cn_n:   inc cmiv
        jmp cn_l
cn_d:   lda mc
        rts

bstart: jsr cntmk
        sta bn
        bne bs_m
        lda #1
        sta bsing
        ldx act
        lda sel,x
        sta bidx
        rts
bs_m:   lda #0
        sta bsing
        sta bidx
        rts

bnext:  lda bsing
        beq bn_m
        lda bidx
        cmp #$FF
        beq bn_no
        pha
        lda #$FF
        sta bidx
        pla
        sec
        rts
bn_no:  clc
        rts
bn_m:   ldx act
bn_l:   lda bidx
        cmp cnt,x
        bcs bn_no
        jsr mky
        lda MARKS,y
        beq bn_s
        lda bidx
        inc bidx
        sec
        rts
bn_s:   inc bidx
        jmp bn_l

batchx: sta bcmd
bx_l:   jsr bnext
        bcc bx_d
        sta bcu
        ldx act
        lda bcu
        jsr mkspec
        lda bcmd
        jsr xioA
        cpy #1
        beq bx_l
        jmp xioFin
bx_d:   ldy #1
        jmp xioFin

docopy:
        jsr needf
        bne dc_go
        jmp main
dc_go:
        ldx act
        lda act
        eor #1
        tay
        lda drv,x
        cmp drv,y
        bne dc_diff
        lda plen
        cmp plen+1
        bne dc_diff
        ldy #0
dc_pc:  cpy plen
        bcs dc_same
        lda PATHS,y
        cmp PATHS+24,y
        bne dc_diff
        iny
        bne dc_pc
dc_same:
        jsr msgrow
        jsr putsi
        .byte 'SAME FOLDER IN BOTH PANES',0
        jmp main
dc_diff:
        jsr bstart
dc_next:
        jsr bnext
        bcs dc_one
        jmp dc_all
dc_one: sta bcu
        ldx act
        lda bcu
        jsr mkspec
        ldx act
        lda plen,x
        clc
        adc #3
        sta ei2
        lda act
        eor #1
        sta pn
        tax
        lda drv,x
        ora #'0'
        sta FSPEC2+1
        lda #'D'
        sta FSPEC2
        lda #':'
        sta FSPEC2+2
        ldx #$43
        jsr apath
        ldy ei2
dc_cp:  lda FSPEC,y
        sta FSPEC,x
        inx
        iny
        cmp #$9B
        bne dc_cp
        jsr msgrow
        jsr putsi
        .byte 'COPYING ',0
        jsr putfs
        jsr usef1
        ldx #$10
        lda #4
        jsr openF
        bpl dc_o2
        jmp dc_err
dc_o2:  jsr usef2
        ldx #$20
        lda #8
        jsr openF
        bpl dc_loop
        sty est
        jsr close1
        jmp dc_err2
dc_loop:
        ldx #$10
        jsr bget
        sty cpst
        lda ICBLL+$10
        sta lenlo
        lda ICBLH+$10
        sta lenhi
        ora lenlo
        beq dc_fin
        ldx #$20
        jsr bput
        bpl dc_chk
        sty est
        jsr close2
        jsr close1
        jmp dc_err2
dc_chk: lda cpst
        cmp #1
        beq dc_loop
dc_fin: lda cpst
        cmp #1
        beq dc_ok
        cmp #136
        beq dc_ok
        sta est
        jsr close2
        jsr close1
        jmp dc_err2
dc_ok:  ldx #$20
        jsr closeF
        bpl dc_ok2
        sty est
        jsr close1
        jmp dc_err2
dc_ok2: jsr close1
        jmp dc_next
dc_all: jsr reloadoth
        jsr redraw
        jsr msgrow
        jsr putsi
        .byte 'COPIED OK',0
        jmp main
dc_err: sty est
dc_err2:
        jsr reloadoth
        jsr redraw
        jsr showerr
        jmp main

close1: ldx #$10
        jmp closeF
close2: ldx #$20
        jmp closeF

dodel:
        jsr needf
        bne dd_go
        jmp main
dd_go:  jsr bstart
        lda bn
        bne dd_m
        ldx act
        lda sel,x
        jsr mkspec
        jsr rowprompt
        jsr putsi
        .byte 'DELETE ',0
        jsr putfs
        jmp dd_ask
dd_m:   jsr rowprompt
        jsr putsi
        .byte 'DELETE ',0
        lda bn
        sta pvl
        lda #0
        sta pvh
        jsr putd16
        jsr putsi
        .byte ' TAGGED FILES',0
dd_ask: jsr askyn
        beq dd_do
        jmp cancel
dd_do:  jsr bstart
        lda #33
        jmp batchx

dolock:
        jsr needf
        bne dl_go
        jmp main
dl_go:  jsr bstart
        lda #35
        jmp batchx

dounlock:
        jsr needf
        bne du_go
        jmp main
du_go:  jsr bstart
        lda #36
        jmp batchx

doformat:
        ldx act
        lda drv,x
        ora #'0'
        sta fmtdrv
        jsr rowprompt
        jsr putsi
        .byte 'FORMAT D'
fmtdrv: .byte '1: ERASES ALL DATA',0
        jsr askyn
        beq df_do
        jmp cancel
df_do:  ldx act
        lda #0
        sta plen,x
        jsr mkdrvspec
        lda #254
        jmp xioDone

doclear:
        ldx act
        jsr mkdrvspec
        jsr rowprompt
        jsr putsi
        .byte 'DELETE ALL FILES ON ',0
        jsr putfs
        jsr askyn
        beq dx_do
        jmp cancel
dx_do:  lda #36
        jsr xioA
        lda #33
        jmp xioDone

doren:
        jsr needf
        bne dr_go
        jmp main
dr_go:  ldx act
        lda sel,x
        jsr mkspec
        jsr rowprompt
        jsr putsi
        .byte 'NEW NAME FOR ',0
        jsr putfs
        jsr putsi
        .byte ': ',0
        lda #0
        sta CRSINH
        lda #0
        sta ri
rn_l:   jsr getkey
        cmp #$9B
        beq rn_e
        cmp #$7E
        bne rn_n
        lda ri
        beq rn_l
        dec ri
        lda #$7E
        jsr putc
        jmp rn_l
rn_n:   ldx ri
        cpx #12
        bcs rn_l
        cmp #' '
        bcc rn_l
        cmp #$7B
        bcs rn_l
        sta INBUF,x
        inc ri
        jsr putc
        jmp rn_l
rn_e:   ldx ri
        lda #$9B
        sta INBUF,x
        lda #1
        sta CRSINH
        ldx #0
dr_a:   lda FSPEC,x
        cmp #$9B
        beq dr_b1
        sta FSPEC2,x
        inx
        bne dr_a
dr_b1:  lda #','
        sta FSPEC2,x
        inx
        ldy #0
dr_c1:  lda INBUF,y
        sta FSPEC2,x
        cmp #$9B
        beq dr_d
        inx
        iny
        cpy #13
        bcc dr_c1
        lda #$9B
        sta FSPEC2,x
dr_d:   lda INBUF
        cmp #$9B
        bne dr_e
        jmp cancel
dr_e:   lda #<FSPEC2
        sta spl
        lda #>FSPEC2
        sta sph
        lda #32
        jsr xioA2
        jmp xioFin

cancel:
        jsr redraw
        jsr msgrow
        jsr putsi
        .byte 'CANCELLED',0
        jmp main

domkdir:
        jsr rowprompt
        jsr putsi
        .byte 'NEW DIR NAME: ',0
        jsr rdline
        bne mk_ok
        jmp cancel
rdline: lda #0
        sta CRSINH
        sta ri
mk_l:   jsr getkey
        cmp #$9B
        beq mk_e
        cmp #$7E
        bne mk_n
        lda ri
        beq mk_l
        dec ri
        lda #$7E
        jsr putc
        jmp mk_l
mk_n:   ldx ri
        cpx rlmax
        bcs mk_l
        cmp #' '
        bcc mk_l
        cmp #$7B
        bcs mk_l
        sta INBUF,x
        inc ri
        jsr putc
        jmp mk_l
mk_e:   lda #1
        sta CRSINH
        lda ri
        rts
mk_ok:  ldx act
        stx pn
        lda drv,x
        ora #'0'
        sta FSPEC+1
        lda #'D'
        sta FSPEC
        lda #':'
        sta FSPEC+2
        ldx #3
        jsr apath
        ldy #0
mk_c:   lda INBUF,y
        sta FSPEC,x
        inx
        iny
        cpy ri
        bcc mk_c
        lda #$9B
        sta FSPEC,x
        lda #8
        sta xa1
        lda #1
        sta isd
        lda #42
        jmp xioDone

dormdir:
        jsr need
        bne rm_go
        jmp main
rm_go:  ldx act
        lda sel,x
        jsr mkspec
        ldy #0
        lda (ZP),y
        cmp #':'
        beq rm_ok
        iny
        lda (ZP),y
        cmp #':'
        beq rm_ok
rm_nd:  jsr msgrow
        jsr putsi
        .byte 'NOT A DIRECTORY',0
        jmp main
rm_ok:  ldy #2
        lda (ZP),y
        cmp #'.'
        bne rm_ok2
        jmp rm_nd
rm_ok2: jsr rowprompt
        jsr putsi
        .byte 'REMOVE DIR ',0
        jsr putfs
        jsr askyn
        beq rm_do
        jmp cancel
rm_do:  lda #1
        sta isd
        lda #43
        jsr xioA
        cpy #1
        beq rm_fin
        lda #33
        jsr xioA
rm_fin: jmp xioFin

; B: make one-character folders A-Z and/or 0-9; existing ones are skipped
dobulk:
        jsr rowprompt
        jsr putsi
        .byte 'BULK A)-Z 0)-9 B)OTH: ',0
        jsr getkey
        ldx #1
        cmp #'A'
        beq bk_go
        ldx #2
        cmp #'0'
        beq bk_go
        ldx #3
        cmp #'B'
        beq bk_go
        jmp cancel
bk_err: lda #1
        sta isd
        ldy est
        jmp xioFin
bk_go:  stx bkm
        lda #0
        sta bkn
        sta bke
        lda bkm
        and #1
        beq bk_d
        lda #'A'
        sta bkch
bk_l1:  jsr bkone
        bcs bk_err
        inc bkch
        lda bkch
        cmp #'Z'+1
        bcc bk_l1
bk_d:   lda bkm
        and #2
        beq bk_end
        lda #'0'
        sta bkch
bk_l2:  jsr bkone
        bcs bk_err
        inc bkch
        lda bkch
        cmp #'9'+1
        bcc bk_l2
bk_end: ldy #1
        sty est
        lda #0
        sta xa1
        jsr reloadact
        jsr redraw
        jsr msgrow
        jsr putsi
        .byte 'CREATED ',0
        lda bkn
        sta pvl
        lda #0
        sta pvh
        jsr putd16
        jsr putsi
        .byte ' FOLDERS',0
        lda bke
        beq bk_fin
        jsr putsi
        .byte ' (LAST ERR ',0
        sta pvl
        lda #0
        sta pvh
        jsr putd16
        lda #')'
        jsr putc
bk_fin: jmp main

; carry set only when this DOS has no directories
bkone:  jsr msgrow
        jsr putsi
        .byte 'MAKING ',0
        lda bkch
        jsr putc
        ldx act
        stx pn
        lda drv,x
        ora #'0'
        sta FSPEC+1
        lda #'D'
        sta FSPEC
        lda #':'
        sta FSPEC+2
        ldx #3
        jsr apath
        lda bkch
        sta FSPEC,x
        inx
        lda #$9B
        sta FSPEC,x
        lda #8
        sta xa1
        lda #42
        jsr xioA
        sty est
        cpy #1
        bne bko_e
        inc bkn
        clc
        rts
bko_e:  sty bke
        cpy #146
        beq bko_x
        cpy #168
        beq bko_x
        clc
        rts
bko_x:  sec
        rts

xioDone:
        jsr xioA
xioFin: sty est
        lda #0
        sta xa1
        jsr reloadact
        jsr redraw
        lda est
        cmp #1
        beq xd_ok
        lda isd
        beq xd_er
        lda #0
        sta isd
        lda est
        cmp #146
        beq xd_nd
        cmp #168
        bne xd_er
xd_nd:  jsr msgrow
        jsr putsi
        .byte 'NO DIRS ON THIS DOS',0
        jmp main
xd_er:  jsr showerr
        jmp main
xd_ok:  lda #0
        sta isd
        jsr msgrow
        jsr putsi
        .byte 'DONE',0
        jmp main

xioA:   ldx #<FSPEC
        stx spl
        ldx #>FSPEC
        stx sph
xioA2:  ldx #$10
        sta ICCOM,x
        lda spl
        sta ICBAL,x
        lda sph
        sta ICBAH,x
        lda xa1
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        jmp CIOV

; ---------- CIO helpers ----------
usef1:  lda #<FSPEC
        sta spl
        lda #>FSPEC
        sta sph
        rts
usef2:  lda #<FSPEC2
        sta spl
        lda #>FSPEC2
        sta sph
        rts

openF:  sta ICAX1,x
        lda #3
        sta ICCOM,x
        lda spl
        sta ICBAL,x
        lda sph
        sta ICBAH,x
        lda #0
        sta ICAX2,x
        sta ICAX2+1,x
        sta ICAX2+2,x
        sta ICAX2+3,x
        sta ICAX2+4,x
        jmp CIOV

closeF: lda #12
        sta ICCOM,x
        jmp CIOV

bget:   lda #7
        sta ICCOM,x
        lda #<IOBUF
        sta ICBAL,x
        lda #>IOBUF
        sta ICBAH,x
        lda #0
        sta ICBLL,x
        lda #4
        sta ICBLH,x
        jmp CIOV

bput:   lda #11
        sta ICCOM,x
        lda #<IOBUF
        sta ICBAL,x
        lda #>IOBUF
        sta ICBAH,x
        lda lenlo
        sta ICBLL,x
        lda lenhi
        sta ICBLH,x
        jmp CIOV

getkey: jsr getraw
        cmp #'a'
        bcc gk_r
        cmp #'z'+1
        bcs gk_r
        and #$DF
gk_r:   rts

getraw: ldx #$30
        lda #7
        sta ICCOM,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        jmp CIOV

askyn:  jsr putsi
        .byte '  (Y/N)',0
        jsr getkey
        cmp #'Y'
        rts

; ---------- directory ----------
reloadall:
        ldx #0
        jsr loaddir
        ldx #1
        jsr loaddir
        rts

; Re-read only the pane(s) an operation can have changed: the pane itself, plus the other one when it shows the same drive.
reloadact:
        lda act
        jmp reloadpn
reloadoth:
        lda act
        eor #1
reloadpn:
        sta rpn
        tax
        jsr loaddir
        lda rpn
        eor #1
        tay
        ldx rpn
        lda drv,x
        cmp drv,y
        bne rp_x
        tya
        tax
        jsr loaddir
rp_x:   rts
rpn:    .byte 0

mkdrvspec:
        stx pn
        lda drv,x
        ora #'0'
        sta FSPEC+1
        lda #'D'
        sta FSPEC
        lda #':'
        sta FSPEC+2
        ldx #3
        jsr apath
        lda #'*'
        sta FSPEC,x
        inx
        lda #'.'
        sta FSPEC,x
        inx
        lda #'*'
        sta FSPEC,x
        inx
        lda #$9B
        sta FSPEC,x
        rts

apath:  ldy pn
        lda plen,y
        beq ap_z
        sta apn
        lda pbase,y
        tay
ap_l:   lda PATHS,y
        sta FSPEC,x
        inx
        iny
        dec apn
        bne ap_l
ap_z:   rts

loaddir:
        stx lp
        lda #0
        sta cnt,x
        jsr clrmk
        lda frbase,x
        tay
        lda #' '
        sta frb,y
        sta frb+1,y
        sta frb+2,y
        sta frb+3,y
        lda #'-'
        sta frb+4,y
        lda plen,x
        beq ld_np
        lda #0
        jsr entp
        ldy #16
        lda #' '
ldp_z:  sta (ZP),y
        dey
        bpl ldp_z
        ldy #1
        lda #':'
        sta (ZP),y
        ldy #2
        lda #'.'
        sta (ZP),y
        iny
        sta (ZP),y
        ldx lp
        lda #1
        sta cnt,x
ld_np:  ldx lp
        jsr mkdrvspec
        jsr usef1
        ldx #$10
        lda #6
        jsr openF
        bpl ld_op
        jmp ld_done
ld_op:
ld_loop:
        ldy #39
        lda #$20
ld_f:   sta LINE,y
        dey
        bpl ld_f
        ldx #$10
        lda #5
        sta ICCOM,x
        lda #<LINE
        sta ICBAL,x
        lda #>LINE
        sta ICBAH,x
        lda #40
        sta ICBLL,x
        lda #0
        sta ICBLH,x
        jsr CIOV
        bmi ld_done
        lda LINE
        cmp #'0'
        bcc ld_ent
        cmp #'9'+1
        bcs ld_ent
        ldy #1
fr_s:   lda LINE,y
        cmp #' '
        beq fr_f
        iny
        cpy #6
        bcc fr_s
        bcs ld_ent
fr_f:   lda LINE+1,y
        cmp #'F'
        bne ld_ent
        ldx lp
        lda frbase,x
        clc
        adc #4
        tax
fr_c:   dey
        bmi fr_d
        lda LINE,y
        sta frb,x
        dex
        bpl fr_c
fr_d:   jmp ld_loop
ld_ent: ldx lp
        lda cnt,x
        cmp #MAXE
        bcs ld_loop
        jsr entp
        ldy #16
ld_c:   lda LINE,y
        sta (ZP),y
        dey
        bpl ld_c
        ldx lp
        inc cnt,x
        jmp ld_loop
ld_done:
        ldx #$10
        jsr closeF
        ldx lp
        lda cnt,x
        bne ld_c1
        lda #0
        sta sel,x
        sta top,x
        rts
ld_c1:  lda sel,x
        cmp cnt,x
        bcc ld_c2
        lda cnt,x
        sec
        sbc #1
        sta sel,x
ld_c2:  lda top,x
        cmp sel,x
        bcc ld_c3
        beq ld_c3
        lda sel,x
        sta top,x
ld_c3:  lda sel,x
        sec
        sbc top,x
        cmp #VROWS
        bcc ld_c4
        lda sel,x
        sec
        sbc #VROWS-1
        sta top,x
ld_c4:  rts

entp:   sta eidx
        sta tmp
        lda #0
        sta tmp+1
        ldy #4
ep1:    asl tmp
        rol tmp+1
        dey
        bne ep1
        clc
        lda tmp
        adc eidx
        sta tmp
        bcc ep2
        inc tmp+1
ep2:    clc
        lda tmp
        adc panelo,x
        sta ZP
        lda tmp+1
        adc panehi,x
        sta ZP+1
        rts
panelo: .byte <PANE0,<PANE1
panehi: .byte >PANE0,>PANE1

mkspec: stx pn
        pha
        lda drv,x
        ora #'0'
        sta tmpd
        pla
        jsr entp
        ldx #0
        lda #'D'
        sta FSPEC,x
        inx
        lda tmpd
        sta FSPEC,x
        inx
        lda #':'
        sta FSPEC,x
        inx
        jsr apath
        ldy #2
mn1:    lda (ZP),y
        cmp #$20
        beq mn2
        sta FSPEC,x
        inx
        iny
        cpy #10
        bcc mn1
mn2:    ldy #10
        lda (ZP),y
        cmp #$20
        beq mn4
        lda #'.'
        sta FSPEC,x
        inx
mn3:    lda (ZP),y
        cmp #$20
        beq mn4
        sta FSPEC,x
        inx
        iny
        cpy #13
        bcc mn3
mn4:    lda #$9B
        sta FSPEC,x
        rts

; ---------- screen ----------
setpos: sta ROWCRS
        stx COLCRS
        lda #0
        sta COLCRS+1
        rts

putc:   ora inv
putraw: sta pc_a
        stx pc_x
        sty pc_y
        lda #11
        sta ICCOM
        lda #0
        sta ICBLL
        sta ICBLH
        lda pc_a
        ldx #0
        jsr CIOV
        ldy pc_y
        ldx pc_x
        rts

putsi:  pla
        sta ZP3
        pla
        sta ZP3+1
        ldy #0
ps1:    inc ZP3
        bne ps2
        inc ZP3+1
ps2:    lda (ZP3),y
        beq ps3
        jsr putc
        jmp ps1
ps3:    lda ZP3+1
        pha
        lda ZP3
        pha
        rts

putfs:  ldx #0
pf1:    lda FSPEC,x
        cmp #$9B
        beq pf2
        jsr putc
        inx
        bne pf1
pf2:    rts

putdec: sta dv
        ldx #0
pd_h:   cmp #100
        bcc pd_hd
        sbc #100
        inx
        jmp pd_h
pd_hd:  pha
        txa
        ora #'0'
        jsr putc
        pla
        ldx #0
pd_t:   cmp #10
        bcc pd_td
        sbc #10
        inx
        jmp pd_t
pd_td:  pha
        txa
        ora #'0'
        jsr putc
        pla
        ora #'0'
        jmp putc

msgrow: lda #0
        sta inv
        lda #20
        jmp clrrow
rowprompt:
        lda #0
        sta inv
        lda #21
clrrow: pha
        ldx #0
        jsr setpos
        ldy #39
cr1:    lda #$20
        jsr putc
        dey
        bne cr1
        pla
        ldx #0
        jsr setpos
        rts

showerr:
        jsr msgrow
        jsr putsi
        .byte 'ERROR ',0
        lda est
        jmp putdec

drawui:
        lda #0
        sta inv
        lda #125
        jsr putraw
redraw: jsr rowprompt
        lda #$80
        sta inv
        lda #0
        ldx #0
        jsr setpos
        jsr putsi
        .byte ' ATARICRAFT AFM  DOS2/MYDOS FILE MGR ',0
        lda #0
        sta inv
        lda #22
        ldx #0
        jsr setpos
        jsr putsi
        .byte 'C)OPY D)EL R)EN M)KDIR K)RMDIR P)ROPS',0
        lda #23
        ldx #0
        jsr setpos
        jsr putsi
        .byte 'T)AG A)LL /)FIND I)NFO ?)MORE Q)UIT',0
        ldx #0
        jsr drawhdr
        ldx #1
        jsr drawhdr
        ldx #0
        jsr drawpane
        ldx #1
        jsr drawpane
        rts

drawhdr:
        stx hp
        lda #0
        sta inv
        cpx act
        bne dh1
        lda #$80
        sta inv
dh1:    lda #1
        ldx #0
        ldy hp
        beq dh2
        ldx #20
dh2:    jsr setpos
        jsr putsi
        .byte 'D',0
        ldx hp
        lda drv,x
        ora #'0'
        jsr putc
        lda #':'
        jsr putc
        lda #' '
        jsr putc
        ldx hp
        lda frbase,x
        sta fi
        lda #5
        sta fj
fd_l:   ldx fi
        lda frb,x
        jsr putc
        inc fi
        dec fj
        bne fd_l
        jsr putsi
        .byte ' FREE ',0
        ldx hp
        lda plen,x
        sec
        sbc #5
        bcs hp_o
        lda #0
hp_o:   sta hs
        lda #0
        sta fi
hp_l:   ldx hp
        lda fi
        clc
        adc hs
        cmp plen,x
        bcs hp_s
        clc
        adc pbase,x
        tax
        lda PATHS,x
        jmp hp_p
hp_s:   lda #' '
hp_p:   jsr putc
        inc fi
        lda fi
        cmp #5
        bcc hp_l
        lda #0
        sta inv
        rts

drawpane:
        stx dp
        lda #0
        sta dr
dp1:    ldx dp
        lda top,x
        clc
        adc dr
        jsr drawrow
        inc dr
        lda dr
        cmp #VROWS
        bcc dp1
        rts

drawrow:
        jmp drawrow2
dr_r0:  rts
drawrow2:        sta rdx
        stx rpane
        sec
        sbc top,x
        bmi dr_r0
        cmp #VROWS
        bcs dr_r0
        clc
        adc #2
        ldx #0
        ldy rpane
        beq dr_c
        ldx #20
dr_c:   jsr setpos
        lda #0
        sta inv
        ldx rpane
        cpx act
        bne dr_ni
        lda rdx
        cmp sel,x
        bne dr_ni
        lda #$80
        sta inv
dr_ni:  ldx rpane
        lda rdx
        cmp cnt,x
        bcs dr_blank
        jsr mky
        lda MARKS,y
        beq dr_pm0
        lda #'+'
        bne dr_pm1
dr_pm0: lda #' '
dr_pm1: sta pmk
        ldx rpane
        lda rdx
        cmp sel,x
        bne dr_m0
        lda pmk
        cmp #'+'
        beq dr_hash
        lda #'>'
        jmp dr_m
dr_hash: lda #'#'
        jmp dr_m
dr_m0:  lda pmk
dr_m:   jsr putc
        lda rdx
        ldx rpane
        jsr entp
        ldy #0
dr_l:   lda (ZP),y
        jsr putc
        iny
        cpy #17
        bcc dr_l
        jmp dr_end
dr_blank:
        ldy #18
dr_b:   lda #' '
        jsr putc
        dey
        bne dr_b
dr_end: lda #0
        sta inv
        lda #' '
        jsr putc
        lda rpane
        bne dr_ret
        lda #'|'
        jsr putc
dr_ret: lda #0
        sta inv
        rts

; ---------- data ----------
kspec:  .byte 'K:',$9B
exts:   .byte 'COMXEXOBX'
ei:     .byte 0
drv:    .byte 1,2
cnt:    .byte 0,0
sel:    .byte 0,0
top:    .byte 0,0
frb:    .byte ' ',' ',' ',' ','-',' ',' ',' ',' ','-'
frbase: .byte 0,5
fi:     .byte 0
fj:     .byte 0
act:    .byte 0
inv:    .byte 0
spl:    .byte 0
sph:    .byte 0
est:    .byte 0
cpst:   .byte 0
lenlo:  .byte 0
lenhi:  .byte 0
oldsel: .byte 0
lp:     .byte 0
eidx:   .byte 0
tmp:    .word 0
tmpd:   .byte 0
pn:     .byte 0
apn:    .byte 0
ei2:    .byte 0
isd:    .byte 0
mkn:    .byte 0
mc:     .byte 0
cmiv:   .byte 0
bn:     .byte 0
bsing:  .byte 0
bidx:   .byte 0
bcu:    .byte 0
bcmd:   .byte 0
pmk:    .byte 0
tsec:   .word 0
tlk:    .byte 0
tdir:   .byte 0
tfil:   .byte 0
mlo:    .byte 0
pvl:    .byte 0
pvh:    .byte 0
pzf:    .byte 0
pdg:    .byte 0
fl:     .byte 0
fpos:   .byte 0
fcnt:   .byte 0
fs:     .byte 0
fbuf:   .ds 8
hs:     .byte 0
plen:   .byte 0,0
pbase:  .byte 0,24
PATHS:  .ds 48
xa1:    .byte 0
dv:     .byte 0
hp:     .byte 0
dp:     .byte 0
dr:     .byte 0
rdx:    .byte 0
rpane:  .byte 0
ri:     .byte 0
bkm:    .byte 0
edro:   .byte 0
rlmax:  .byte 8
ednew:  .byte 0
ehn:    .byte 0
ehh:    .byte 0
ehv:    .byte 0
ehb:    .byte 0
ehk:    .byte 0
edmod:  .byte 0
edhex:  .byte 0
edkeep: .byte 0
ecol:   .byte 0
ecf:    .byte 0
edtmp:  .byte 0
ecv:    .byte 0
edcn:   .byte 0
edpc:   .byte 0
edrw:   .byte 0
edi:    .byte 0
edy:    .byte 0
edcol:  .byte 0
edse:   .byte 0,0
elim:   .byte 0,0
dosid:  .byte 0
bkn:    .byte 0
bke:    .byte 0
bkch:   .byte 0
pc_a:   .byte 0
pc_x:   .byte 0
pc_y:   .byte 0
        run start

; ---------- XEX loader (own segment at $0600, runs after AFM exits) ----------

        org $0600
ld_io:  sta ICCOM,x
        lda LDBA
        sta ICBAL,x
        lda LDBA+1
        sta ICBAH,x
        lda LDBL
        sta ICBLL,x
        lda LDBL+1
        sta ICBLH,x
        jmp CIOV
ld_rd2: sta LDBA
        lda #>LDHDR
        sta LDBA+1
        lda #2
        sta LDBL
        lda #0
        sta LDBL+1
        ldx #$10
        lda #7
        jsr ld_io
        cpy #$80
        rts
ld_init: jmp (INITAD)
ld_run: jmp (RUNAD)
ld_fail: jmp (DOSVEC)
ldrun:  ldx #$10
        lda #12
        jsr ld_io
        lda #<LDNAME
        sta LDBA
        lda #>LDNAME
        sta LDBA+1
        lda #0
        ldy #4
ld_z:   sta ICAX2+$10,y
        dey
        bpl ld_z
        lda #4
        sta ICAX1+$10
        ldx #$10
        lda #3
        jsr ld_io
        bmi ld_fail
        lda #0
        ldy #3
ld_zr:  sta RUNAD,y
        dey
        bpl ld_zr
        lda #<LDHDR
        jsr ld_rd2
        bcs ld_fail
        lda LDHDR
        and LDHDR+1
        cmp #$FF
        bne ld_fail
ld_seg: lda #<LDST
        jsr ld_rd2
        bcs ld_fin
        lda LDST
        and LDST+1
        cmp #$FF
        beq ld_seg
        lda #<LDHDR
        jsr ld_rd2
        bcs ld_fail
        sec
        lda LDHDR
        sbc LDST
        sta LDBL
        lda LDHDR+1
        sbc LDST+1
        sta LDBL+1
        bcc ld_fail
        inc LDBL
        bne ld_l1
        inc LDBL+1
ld_l1:  lda LDST
        sta LDBA
        lda LDST+1
        sta LDBA+1
        ldx #$10
        lda #7
        jsr ld_io
        bpl ld_ok
        jmp ld_fail
ld_ok:  lda INITAD
        ora INITAD+1
        beq ld_seg
        jsr ld_init
        lda #0
        sta INITAD
        sta INITAD+1
        beq ld_seg
ld_fin: ldx #$10
        lda #12
        jsr ld_io
        lda RUNAD
        ora RUNAD+1
        beq ld_dos
        jsr ld_run
ld_dos: jmp (DOSVEC)
