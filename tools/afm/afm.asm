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
        jsr drawui
        jsr reloadall
        jsr drawui
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
        bne c18
        jmp dobulk
c18:    jmp main

k_tab:
        lda act
        eor #1
        sta act
        jsr drawui
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
        jsr reloadall
        jsr drawui
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
        jsr reloadall
        jsr drawui
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
        sta cmi
da_l:   ldx act
        lda cmi
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
        lda cmi
        jsr mky
        lda #1
        sta MARKS,y
da_n:   inc cmi
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
        .byte 'Q QUIT',$9B,$9B
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
        sta cmi
cn_l:   ldx act
        lda cmi
        cmp cnt,x
        bcs cn_d
        jsr mky
        lda MARKS,y
        beq cn_n
        inc mc
cn_n:   inc cmi
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
dc_all: jsr reloadall
        jsr drawui
        jsr msgrow
        jsr putsi
        .byte 'COPIED OK',0
        jmp main
dc_err: sty est
dc_err2:
        jsr reloadall
        jsr drawui
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
        jsr drawui
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
        cpx #8
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
        jsr reloadall
        jsr drawui
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
        jsr reloadall
        jsr drawui
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

getkey: ldx #$30
        lda #7
        sta ICCOM,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        cmp #'a'
        bcc gk_r
        cmp #'z'+1
        bcs gk_r
        and #$DF
gk_r:   rts

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
        .byte 'T)AG A)LL /)FIND ?)MORE TAB Q)UIT',0
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
cmi:    .byte 0
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
