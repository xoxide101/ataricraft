; path.asm - current folder, file specs, LONGNAME.TXT and the directory reader.

cwdinit:
        ldx #0
ci_l:   lda cwd0,x
        sta CWD,x
        beq ci_d
        inx
        bne ci_l
ci_d:   rts
cwd0:   .byte 'D1:',0

; Build a file spec from TOK into FSPEC (mkspec) or FSPEC2 (mkspec2).
; Device prefixes (D2:, N:, H1: ...) are kept; anything else is joined to the current folder.
; Names that are not 8.3 are looked up in LONGNAME.TXT unless the DOS (SpartaDOS X) takes them as they are.
mkspec: lda #<FSPEC
        sta T1
        lda #>FSPEC
        sta T1+1
        jmp mkspecp
mkspec2:
        lda #<FSPEC2
        sta T1
        lda #>FSPEC2
        sta T1+1
mkspecp:
        lda #0
        sta N5
        ldx #0
ms_f:   lda TOK,x
        beq ms_nd
        cmp #':'
        beq ms_dv
        inx
        cpx #5
        bcc ms_f
ms_nd:  ldy #0
ms_c:   lda CWD,y
        beq ms_cd
        sta (T1),y
        iny
        bne ms_c
ms_cd:  lda TOK
        cmp #'>'
        beq ms_rt
        cmp #'\'
        bne ms_nm
ms_rt:  ldy #3
        jmp ms_nm
ms_dv:  lda TOK
        jsr toupper
        cmp #'N'
        bne ms_d2
        inc N5
ms_d2:  ldy #0
ms_nm:  ldx #0
ms_nl:  lda TOK,x
        beq ms_end
        ldx N5
        bne ms_raw
        ldx #0
        jsr ms_ld
        cmp #'\'
        beq ms_gt
        cmp #'/'
        bne ms_up
ms_gt:  lda #'>'
ms_up:  jsr toupper
        jmp ms_st
ms_raw: jsr ms_ld
ms_st:  sta (T1),y
        iny
        inc ms_x
        ldx ms_x
        cpy #60
        bcc ms_nl
ms_end: lda #EOL
        sta (T1),y
        lda #0
        sta ms_x
        jmp lnresolve
ms_ld:  ldx ms_x
        lda TOK,x
        rts
ms_x:   .byte 0

; second look at the last component of the spec at T1: if it is not 8.3, try LONGNAME.TXT
lnresolve:
        lda V_DOS
        cmp #2
        beq lr_x
        lda N5
        bne lr_x
        ldy #0
        sty N0
lr_s:   lda (T1),y
        cmp #EOL
        beq lr_e
        cmp #'>'
        beq lr_m
        cmp #':'
        bne lr_n
lr_m:   iny
        sty N0
        dey
lr_n:   iny
        bne lr_s
lr_e:   sty N1
        ldy N0
        ldx #0
lr_c:   cpy N1
        beq lr_cd
        lda (T1),y
        sta LNB,x
        inx
        iny
        cpx #40
        bcc lr_c
lr_cd:  lda #0
        sta LNB,x
        jsr is83
        bcc lr_x
        jsr lnload
        bcs lr_x
        jsr lnfind
        bcs lr_x
        ldy N0
        ldx #0
lr_w:   lda NAMEB,x
        beq lr_wd
        sta (T1),y
        inx
        iny
        jmp lr_w
lr_wd:  lda #EOL
        sta (T1),y
lr_x:   rts

; carry set when the name in LNB is not a plain 8.3 name
is83:   lda #$FF
        sta N2
        lda #0
        sta N3
        ldx #0
is_l:   lda LNB,x
        beq is_d
        cmp #' '
        beq is_y
        cmp #'.'
        bne is_nx
        inc N3
        stx N2
is_nx:  inx
        bne is_l
is_d:   cpx #0
        beq is_n
        lda N3
        cmp #2
        bcs is_y
        lda N2
        cmp #$FF
        bne is_dot
        cpx #9
        bcs is_y
        bcc is_n
is_dot: cmp #9
        bcs is_y
        txa
        sec
        sbc N2
        cmp #5
        bcs is_y
is_n:   clc
        rts
is_y:   sec
        rts

; load LONGNAME.TXT from the folder part of the spec at T1 (N0 = length of that part) into LNMEM
lnload: ldy #0
ll_c:   cpy N0
        beq ll_n
        lda (T1),y
        sta SCR,y
        iny
        jmp ll_c
ll_n:   ldx #0
ll_a:   lda lnname,x
        sta SCR,y
        iny
        inx
        cpx #13
        bcc ll_a
        lda #<SCR
        sta V_SPL
        lda #>SCR
        sta V_SPH
        lda #4
        ldx #$40
        jsr fopen
        bmi ll_f
        lda #0
        sta V_BLL
        lda #$0F
        sta V_BLH
        lda #<LNMEM
        sta V_BPL
        lda #>LNMEM
        sta V_BPH
        ldx #$40
        jsr bgetp
        lda ICBLL+$40
        sta V_LNL
        lda ICBLH+$40
        sta V_LNL+1
        ldx #$40
        jsr fclose
        clc
        rts
ll_f:   lda #0
        sta V_LNL
        sta V_LNL+1
        sec
        rts
lnname: .byte 'LONGNAME.TXT',EOL

; load LONGNAME.TXT for the folder in CWD (used by DIR); no match data is kept when there is none
lncwd:  lda #<CWD
        sta T1
        lda #>CWD
        sta T1+1
        ldy #0
lc_l:   lda CWD,y
        beq lc_d
        iny
        bne lc_l
lc_d:   sty N0
        jmp lnload

lnbegin:
        lda #<LNMEM
        sta T0
        lda #>LNMEM
        sta T0+1
        lda V_LNL
        clc
        adc #<LNMEM
        sta V_LE
        lda V_LNL+1
        adc #>LNMEM
        sta V_LE+1
        lda V_LNL
        ora V_LNL+1
        bne lb_ok
        sec
        rts
lb_ok:  clc
        rts

lnend:  lda T0+1
        cmp V_LE+1
        bcc le_ok
        bne le_no
        lda T0
        cmp V_LE
        bcc le_ok
le_no:  sec
        rts
le_ok:  clc
        rts

lnnext: ldy #0
ln_l:   lda (T0),y
        iny
        cmp #EOL
        beq ln_d
        cpy #0
        bne ln_l
        inc T0+1
        jmp ln_l
ln_d:   tya
        clc
        adc T0
        sta T0
        bcc ln_r
        inc T0+1
ln_r:   rts

; long name in LNB -> short name in NAMEB. Carry clear when found.
lnfind: jsr lnbegin
        bcs lf_no
lf_line:
        jsr lnend
        bcs lf_no
        ldy #0
lf_b:   lda (T0),y
        cmp #EOL
        beq lf_nx
        cmp #'|'
        beq lf_f
        iny
        bne lf_b
        beq lf_nx
lf_f:   iny
        ldx #0
lf_c:   lda (T0),y
        cmp #'|'
        beq lf_e
        cmp #EOL
        beq lf_e
        jsr toupper
        sta N2
        lda LNB,x
        jsr toupper
        cmp N2
        bne lf_nx
        inx
        iny
        bne lf_c
        beq lf_nx
lf_e:   lda LNB,x
        bne lf_nx
        ldy #0
        ldx #0
lf_s:   lda (T0),y
        cmp #' '
        beq lf_sd
        cmp #'|'
        beq lf_sd
        sta NAMEB,x
        inx
        iny
        cpy #12
        bcc lf_s
lf_sd:  lda #0
        sta NAMEB,x
        clc
        rts
lf_nx:  jsr lnnext
        jmp lf_line
lf_no:  sec
        rts

; short name in NAMEB -> long name in LNB (empty when the file has none)
lnshow: lda #0
        sta LNB
        lda V_LNL
        ora V_LNL+1
        beq ls_r
        jsr lnbegin
        bcs ls_r
ls_line:
        jsr lnend
        bcs ls_r
        ldx #0
        ldy #0
ls_c:   lda NAMEB,x
        beq ls_e
        cmp (T0),y
        bne ls_nx
        inx
        iny
        jmp ls_c
ls_e:   lda (T0),y
        cmp #' '
        beq ls_f
        cmp #'|'
        bne ls_nx
ls_f:   lda (T0),y
        cmp #'|'
        beq ls_g
        cmp #EOL
        beq ls_r
        iny
        bne ls_f
        beq ls_nx
ls_g:   iny
        ldx #0
ls_g2:  lda (T0),y
        cmp #'|'
        beq ls_z
        cmp #EOL
        beq ls_z
        sta LNB,x
        inx
        iny
        cpx #40
        bcc ls_g2
ls_z:   lda #0
        sta LNB,x
ls_r:   rts
ls_nx:  jsr lnnext
        jmp ls_line

; ---- directory reader (IOCB 3) ----
; dopen: FSPEC holds the pattern. dnext: carry clear + record in DREC, carry set at the end (free sectors then in V_FREE).
dopen:  lda #6
        ldx #$30
        jmp fopen1
dclose: ldx #$30
        jmp fclose
dnext:  ldx #$30
        lda #<DREC
        sta V_SPL
        lda #>DREC
        sta V_SPH
        jsr rdrec
        bmi dn_end
        lda DREC
        cmp #'0'
        bcc dn_ent
        cmp #'9'+1
        bcs dn_ent
        ldx #0
dn_f:   lda DREC,x
        cmp #'0'
        bcc dn_fd
        cmp #'9'+1
        bcs dn_fd
        sta TOK,x
        inx
        cpx #6
        bcc dn_f
dn_fd:  lda #0
        sta TOK,x
        jsr parsenum
        lda N0
        sta V_FREE
        lda N1
        sta V_FREE+1
dn_end: sec
        rts
dn_ent: clc
        rts

; DREC -> NAMEB as NAME.EXT (zero ended)
dname:  ldx #0
        ldy #2
dn_n:   lda DREC,y
        cmp #' '
        beq dn_e
        sta NAMEB,x
        inx
        iny
        cpy #10
        bcc dn_n
dn_e:   ldy #10
        lda DREC,y
        cmp #' '
        beq dn_z
        lda #'.'
        sta NAMEB,x
        inx
dn_x:   lda DREC,y
        cmp #' '
        beq dn_z
        sta NAMEB,x
        inx
        iny
        cpy #13
        bcc dn_x
dn_z:   lda #0
        sta NAMEB,x
        rts

; Z set when DREC is a folder
isdirrec:
        lda DREC
        cmp #':'
        beq idr_y
        lda DREC+1
        cmp #':'
idr_y:  rts
