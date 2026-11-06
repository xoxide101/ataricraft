; Overlay manager (resident part). The spell, edit and page code is assembled at SLA (one shared slot in
; main RAM) and stored in 130XE bank 2; a stub swaps the right image in before jumping to the routine.
; Needs the 128K machine (sv_xe = 1). Image ids: 0 = edit, 1 = spell, 2 = page.
ovid  = $14F8                  ; image now in the slot ($FF = none)
ovsa  = $14F9
ovsx  = $14FA
ovsy  = $14FB
ovtg  = $14FC                  ; 2 bytes, followed by ovrq: the stub's inline data (target, image id)
ovrq  = $14FE

; ovstub name, target, image: 9 bytes; the JSR leaves the address of the inline data on the stack
 .macro ovstub
 sta ovsa
 jsr ovc
 dta a(:1),b(:2)
 .endm

ovc stx ovsx
 sty ovsy
 pla
 clc
 adc #1
 sta ovq+1
 pla
 adc #0
 sta ovq+2
 ldy #2
ovq lda $FFFF,y
 sta ovtg,y
 dey
 bpl ovq
 lda ovid
 cmp ovrq
 beq ov_go
 lda sv_xe
 beq ov_no
 lda ovid
 cmp #2
 bcc ov_sw
 cmp #4
 beq ov_sw
 lda ovrq
 cmp #2
 bcs ov_sw
 lda hmode
 cmp #PGV
 beq ov_no
ov_sw jsr ovlsw
ov_go ldx ovsx
 ldy ovsy
 lda ovsa
 jmp (ovtg)
; refused: no extended RAM, or an edit/spell command while the page view is running
ov_no lda #40
 sta cmsg
 ldx ovsx
 ldy ovsy
 clc
 rts

hspell ovstub S.hspell,1
hsetdict ovstub S.hsetdict,1
spkey ovstub S.spkey,1
sp_setname ovstub S.sp_setname,1
o_spm20 ovstub S.spm20,1
exrkey ovstub E.exrkey,0
expre ovstub E.expre,0
exkeys ovstub E.exkeys,0
exdone ovstub E.exdone,0
excx ovstub E.excx,0
excut ovstub E.excut,0
excopy ovstub E.excopy,0
expaste ovstub E.expaste,0
exmark ovstub E.exmark,0
exfind ovstub E.exfind,0
exnext ovstub E.exnext,0
exrepl ovstub E.exrepl,0
exgoto ovstub E.exgoto,0
o_exrepm ovstub E.exrepm,0
hpgv ovstub P.hpgv,2
hpgpap ovstub P.hpgpap,2
hpgpit ovstub P.hpgpit,2
hpglm ovstub P.hpglm,2
hprm ovstub P.hprm,2
hpgtl ovstub P.hpgtl,2
hpgtc ovstub P.hpgtc,2
hpgtr ovstub P.hpgtr,2
hpgtx ovstub P.hpgtx,2
pwtab ovstub P.pwtab,2
pwsetlm ovstub P.pwsetlm,2
pwcalc ovstub P.pwcalc,2
pwst ovstub P.pwst,2
pwmain ovstub P.pwmain,2
o_prt ovstub R.prt,5
hpgz ovstub Z.hpgz,3
pzmain ovstub Z.pzmain,3
hface ovstub Z.hface,3
o_fnload ovstub Z.fnload,3
o_fsplit ovstub Z.fsplit,3
o_fjoin ovstub Z.fjoin,3
; New document / text import: forget the per-paragraph fonts (kept out of line so earlier routines keep their addresses)
hnew2 lda #0
 sta fpn
 sta sg_n
 sta sg_c
 jmp scan
fbm2 lda #0
 sta fpn
 sta fns
 sta sg_n
 sta sg_c
 jmp doimport
o_fclip ovstub Z.fclip,3
o_sgsave ovstub E.sgsave,0
o_sgload ovstub E.sgload,0
exsgn ovstub E.exsgn,0
exsgp ovstub E.exsgp,0
; the key handler plus fixcc, then the font table realignment after Cut / Paste
hdl2 jsr handle
 lda ed_dn
 beq hdl3
 jsr fcgo
hdl3 jmp fixcc
; after Cut (ed_dn 1) / Paste (2): realign the per-paragraph font table
fcgo ldx ed_dn
 lda #0
 sta ed_dn
 lda fpn
 beq fcg9
 dex
 txa
 jmp o_fclip
fcg9 rts
o_fsave ovstub Z.fsave,3
o_ftag ovstub Z.ftag,3
o_fpend ovstub Z.fpend,3
