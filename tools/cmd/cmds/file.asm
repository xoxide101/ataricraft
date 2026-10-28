; file.asm - file and folder commands. Each returns carry clear for OK, carry set with V_ERR on failure.

needtok:
        jsr nexttok
        bne nk_ok
        lda #165
        sta V_ERR
        sec
        rts
nk_ok:  clc
        rts

okr:    clc
        rts
failr:  sec
        rts

reqdirs:
        jsr hasdirs
        bcc rq_ok
        jsr putsi
        .byte 'NO FOLDERS ON THIS DOS',EOL,0
        lda #168
        sta V_ERR
        sec
rq_ok:  rts

cmd_del:
        jsr needtok
        jcs failr
        jsr mkspec
        lda #0
        sta V_FLG
        lda #33
        jsr xio1
        jmi failr
        clc
        rts

cmd_ren:
        jsr needtok
        jcs failr
        jsr mkspec
        jsr nexttok
        bne rn_a
        lda #165
        sta V_ERR
        sec
        rts
rn_a:   ldy #0
rn_f:   lda FSPEC,y
        cmp #EOL
        beq rn_g
        iny
        bne rn_f
rn_g:   lda #','
        sta FSPEC,y
        iny
        ldx #0
rn_c:   lda TOK,x
        beq rn_d
        jsr toupper
        sta FSPEC,y
        inx
        iny
        bne rn_c
rn_d:   lda #EOL
        sta FSPEC,y
        lda #0
        sta V_FLG
        lda #32
        jsr xio1
        jmi failr
        clc
        rts

cmd_attrib:
        jsr nexttok
        bne at_a
        lda #165
        sta V_ERR
        sec
        rts
at_a:   lda TOK
        ldx #35
        cmp #'+'
        beq at_g
        ldx #36
        cmp #'-'
        beq at_g
        lda #165
        sta V_ERR
        jsr putsi
        .byte 'USE ATTRIB +R FILE  OR  ATTRIB -R FILE',EOL,0
        sec
        rts
at_g:   stx V_A2
        jsr needtok
        jcs failr
        jsr mkspec
        lda #0
        sta V_FLG
        lda V_A2
        jsr xio1
        jmi failr
        clc
        rts

cmd_md: jsr reqdirs
        jcs failr
        jsr needtok
        jcs failr
        jsr mkspec
        lda #8
        sta V_FLG
        lda #42
        jsr xio1
        jmi failr
        clc
        rts

cmd_rd: jsr reqdirs
        jcs failr
        jsr needtok
        jcs failr
        jsr mkspec
        jsr rmdirx
        jmi failr
        clc
        rts

; remove the folder in FSPEC: XIO 43 (SpartaDOS, BW-DOS), or XIO 33 when the DOS has no XIO 43 (MyDOS)
rmdirx: lda #0
        sta V_FLG
        lda #43
        jsr xio1
        cmp #168
        bne rx_r
        lda #0
        sta V_FLG
        lda #33
        jsr xio1
rx_r:   lda V_ERR
        rts

cmd_pwd:
        lda #<CWD
        ldx #>CWD
        jsr pstr
        jsr putnl
        clc
        rts

cmd_cd: jsr nexttok
        beq cmd_pwd
        jsr reqdirs
        jcs failr
        lda TOK
        cmp #'.'
        bne cd_abs
        lda TOK+1
        cmp #'.'
        bne cd_abs
        ldy #0
cu_l:   lda CWD,y
        beq cu_e
        iny
        bne cu_l
cu_e:   dey
        lda CWD,y
        cmp #':'
        beq cu_ok
cu_b:   dey
        lda CWD,y
        cmp #'>'
        beq cu_cut
        cmp #':'
        bne cu_b
cu_cut: lda #0
        sta CWD+1,y
        cpy #3
        bne cu_ok
        sta CWD+3
cu_ok:  clc
        rts
cd_abs: jsr mkspec
        ldy #0
cb_f:   lda FSPEC,y
        cmp #EOL
        beq cb_e
        iny
        bne cb_f
cb_e:   dey
        lda FSPEC,y
        cmp #'>'
        beq cb_k
        cmp #':'
        beq cb_k
        iny
        lda #'>'
        sta FSPEC,y
cb_k:   iny
        sty V_A1
        ldx #0
cb_c:   lda FSPEC,x
        sta FSPEC2,x
        inx
        cpx V_A1
        bcc cb_c
        lda #'*'
        sta FSPEC,y
        iny
        lda #'.'
        sta FSPEC,y
        iny
        lda #'*'
        sta FSPEC,y
        iny
        lda #EOL
        sta FSPEC,y
        jsr dopen
        bmi cb_bad
        jsr dclose
        ldx #0
cb_s:   lda FSPEC2,x
        sta CWD,x
        inx
        cpx V_A1
        bcc cb_s
        lda #0
        sta CWD,x
        clc
        rts
cb_bad: lda V_ERR
        pha
        jsr dclose
        pla
        sta V_ERR
        sec
        rts

; fail exit: close both file IOCBs keeping the error code
cpy_fail:
        lda V_ERR
        pha
        ldx #$10
        jsr fclose
        ldx #$20
        jsr fclose
        pla
        sta V_ERR
        sec
        rts

cmd_append:
        lda #9
        bne cpy_go
cmd_copy:
        lda #8
cpy_go: sta V_A2
        jsr needtok
        jcs failr
        jsr mkspec
        jsr needtok
        jcs failr
        jsr mkspec2
        lda #4
        ldx #$10
        jsr fopen1
        jmi cpy_fail
        lda V_A2
        ldx #$20
        jsr fopen2
        jmi cpy_fail
cpy_l:  lda #0
        sta V_BLL
        lda #$10
        sta V_BLH
        ldx #$10
        jsr bget
        lda V_ERR
        sta V_A1
        lda ICBLL+$10
        sta V_BLL
        lda ICBLH+$10
        sta V_BLH
        ora V_BLL
        beq cpy_e
        ldx #$20
        jsr bput
        jmi cpy_fail
        lda V_A1
        bpl cpy_l
cpy_e:  lda V_A1
        bpl cpy_d
        cmp #136
        beq cpy_d
        sta V_ERR
        jmp cpy_fail
cpy_d:  ldx #$10
        jsr fclose
        ldx #$20
        jsr fclose
        clc
        rts

; drive prefix of the current folder + *.* into FSPEC
dfspec: ldx #0
df_c:   lda CWD,x
        sta FSPEC,x
        inx
        cpx #3
        bcc df_c
        lda #'*'
        sta FSPEC+3
        lda #'.'
        sta FSPEC+4
        lda #'*'
        sta FSPEC+5
        lda #EOL
        sta FSPEC+6
        rts

cmd_df: jsr dfspec
        lda #0
        sta V_CNT
        sta V_CNT+1
        sta V_FREE
        sta V_FREE+1
        jsr dopen
        bmi df_f
df_l:   jsr dnext
        bcs df_e
        inc V_CNT
        bne df_l
        inc V_CNT+1
        jmp df_l
df_e:   jsr dclose
        lda V_CNT
        sta N0
        lda V_CNT+1
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' FILES  ',0
        lda V_FREE
        sta N0
        lda V_FREE+1
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' FREE SECTORS',EOL,0
        clc
        rts
df_f:   jsr dclose
        sec
        rts

cmd_more:
        lda #1
        bne ty_go
cmd_type:
        lda #0
ty_go:  sta V_A2
        lda #0
        sta V_A1
        jsr needtok
        jcs failr
        jsr mkspec
        lda #4
        ldx #$10
        jsr fopen1
        jmi ty_fail
ty_l:   lda #<IOBUF
        sta V_SPL
        lda #>IOBUF
        sta V_SPH
        ldx #$10
        jsr rdrec
        bmi ty_end
        lda #<IOBUF
        ldx #>IOBUF
        jsr pstr
        jsr putnl
        lda V_A2
        beq ty_k
        inc V_A1
        lda V_A1
        cmp #20
        bcc ty_l
        lda #0
        sta V_A1
        jsr putsi
        .byte '-- MORE (ESC QUITS) --',EOL,0
        jsr getkey
        cmp #27
        beq ty_end
        jmp ty_l
ty_k:   jsr keyhit
        bcc ty_l
ty_end: ldx #$10
        jsr fclose
        clc
        rts
ty_fail:
        lda V_ERR
        pha
        ldx #$10
        jsr fclose
        pla
        sta V_ERR
        sec
        rts

cmd_find:
        jsr needtok
        jcs failr
        ldx #0
fd_p:   lda TOK,x
        jsr toupper
        sta SCR,x
        beq fd_pd
        inx
        bne fd_p
fd_pd:  jsr needtok
        jcs failr
        jsr mkspec
        lda #4
        ldx #$10
        jsr fopen1
        jmi ty_fail
fd_l:   lda #<IOBUF
        sta V_SPL
        lda #>IOBUF
        sta V_SPH
        ldx #$10
        jsr rdrec
        bmi ty_end
        lda #<IOBUF
        sta T0
        lda #>IOBUF
        sta T0+1
fd_s:   ldy #0
fd_c:   lda SCR,y
        beq fd_hit
        jsr toupper
        sta N2
        lda (T0),y
        cmp #EOL
        beq fd_l
        jsr toupper
        cmp N2
        bne fd_n
        iny
        bne fd_c
fd_n:   inc T0
        bne fd_s
        inc T0+1
        jmp fd_s
fd_hit: lda #<IOBUF
        ldx #>IOBUF
        jsr pstr
        jsr putnl
        jmp fd_l

; ---- COMP file1 file2: byte compare, first 8 differences shown ----
getb:   lda #7
        sta ICCOM,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        sty V_ERR
        rts

cmd_comp:
        jsr needtok
        jcs failr
        jsr mkspec
        jsr needtok
        jcs failr
        jsr mkspec2
        lda #4
        ldx #$10
        jsr fopen1
        jmi cpy_fail
        lda #4
        ldx #$20
        jsr fopen2
        jmi cpy_fail
        lda #0
        sta V_CNT
        sta V_CNT+1
        sta V_A1
cq_l:   ldx #$10
        jsr getb
        sta N2
        lda V_ERR
        sta N3
        ldx #$20
        jsr getb
        sta N4
        lda N3
        bpl cq_a
        cmp #136
        bne cq_e1
cq_a:   lda V_ERR
        bpl cq_b
        cmp #136
        bne cq_e2
cq_b:   lda N3
        bmi cq_f1
        lda V_ERR
        jmi cq_len
        lda N2
        cmp N4
        beq cq_n
        lda V_A1
        cmp #$FF
        beq cq_s
        inc V_A1
cq_s:   lda V_A1
        cmp #9
        bcs cq_n
        jsr putsi
        .byte 'DIFF AT $',0
        ldx V_CNT+1
        lda V_CNT
        jsr puthex16
        lda #' '
        jsr putc
        lda N2
        jsr puthex8
        lda #' '
        jsr putc
        lda N4
        jsr puthex8
        jsr putnl
cq_n:   inc V_CNT
        bne cq_l
        inc V_CNT+1
        jmp cq_l
cq_e1:  sta V_ERR
        jmp cpy_fail
cq_e2:  jmp cpy_fail
cq_f1:  lda V_ERR
        bpl cq_len
        lda V_A1
        bne cq_cnt
        jsr putsi
        .byte 'FILES MATCH',EOL,0
        jmp cpy_d
cq_cnt: sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' DIFFERENCES',EOL,0
        jmp cpy_d
cq_len: jsr putsi
        .byte 'LENGTHS DIFFER AT $',0
        ldx V_CNT+1
        lda V_CNT
        jsr puthex16
        jsr putnl
        jmp cpy_d

; ---- FORMAT Dn: ----
cmd_format:
        jsr needtok
        jcs failr
        lda TOK
        jsr toupper
        cmp #'D'
        jne fmt_bad
        lda TOK+1
        cmp #'1'
        jcc fmt_bad
        cmp #'9'
        jcs fmt_bad
        lda TOK+2
        cmp #':'
        jne fmt_bad
        lda TOK+3
        jne fmt_bad
        jsr putsi
        .byte 'ERASE ALL DATA ON ',0
        lda #<TOK
        ldx #>TOK
        jsr pstr
        jsr putsi
        .byte '? Y/N ',0
        jsr getkey
        pha
        jsr putnl
        pla
        cmp #'Y'
        bne fmt_no
        lda TOK
        jsr toupper
        sta FSPEC
        lda TOK+1
        sta FSPEC+1
        lda #':'
        sta FSPEC+2
        lda #EOL
        sta FSPEC+3
        lda #0
        sta V_FLG
        lda #254
        jsr xio1
        jmi failr
        jsr putsi
        .byte 'FORMATTED',EOL,0
        clc
        rts
fmt_no: jsr putsi
        .byte 'CANCELLED',EOL,0
        clc
        rts
fmt_bad:
        jsr putsi
        .byte 'USE FORMAT D2:  (D1: TO D8:)',EOL,0
        lda #165
        sta V_ERR
        sec
        rts

; ---- DELTREE folder: delete a folder and everything below it ----
TP      = IOBUF

tpcopy: ldy #0
tpc_l:  lda TP,y
        cmp #EOL
        beq tpc_d
        sta FSPEC,y
        iny
        bne tpc_l
tpc_d:  rts

cmd_deltree:
        jsr reqdirs
        jcs failr
        jsr needtok
        jcs failr
        jsr mkspec
        ldy #0
dtr_c:  lda FSPEC,y
        cmp #EOL
        beq dtr_cd
        sta TP,y
        iny
        bne dtr_c
dtr_cd: dey
        lda TP,y
        cmp #':'
        beq dtr_root
        cmp #'>'
        beq dtr_ok
        iny
        lda #'>'
        sta TP,y
dtr_ok: iny
        sty V_A0
        sty V_A0+1
        lda #EOL
        sta TP,y
        jsr putsi
        .byte 'DELETE EVERYTHING IN ',0
        lda #<TP
        ldx #>TP
        jsr pstr
        jsr putsi
        .byte '? Y/N ',0
        jsr getkey
        pha
        jsr putnl
        pla
        cmp #'Y'
        beq dtr_scan
        jsr putsi
        .byte 'CANCELLED',EOL,0
        clc
        rts
dtr_root:
        jsr putsi
        .byte 'GIVE A FOLDER NAME, NOT A WHOLE DISK',EOL,0
        lda #165
        sta V_ERR
        sec
        rts
dtr_scan:
        jsr tpcopy
        lda #'*'
        sta FSPEC,y
        iny
        lda #'.'
        sta FSPEC,y
        iny
        lda #'*'
        sta FSPEC,y
        iny
        lda #EOL
        sta FSPEC,y
        jsr dopen
        jmi dtr_err
dtr_nx: jsr dnext
        bcs dtr_empty
        lda DREC+2
        cmp #'.'
        beq dtr_nx
        jsr dname
        jsr dclose
        jsr isdirrec
        beq dtr_dir
        jsr tpcopy
        ldx #0
dtr_nm: lda NAMEB,x
        beq dtr_nd
        sta FSPEC,y
        iny
        inx
        bne dtr_nm
dtr_nd: lda #EOL
        sta FSPEC,y
        lda #0
        sta V_FLG
        lda #33
        jsr xio1
        jmi failr
        jmp dtr_scan
dtr_dir:
        ldy V_A0+1
        ldx #0
dtr_ap: lda NAMEB,x
        beq dtr_ad
        sta TP,y
        iny
        inx
        bne dtr_ap
dtr_ad: lda #'>'
        sta TP,y
        iny
        lda #EOL
        sta TP,y
        sty V_A0+1
        jmp dtr_scan
dtr_empty:
        jsr dclose
        jsr tpcopy
        dey
        lda #EOL
        sta FSPEC,y
        jsr rmdirx
        jmi failr
        lda V_A0+1
        cmp V_A0
        beq dtr_done
        ldy V_A0+1
        dey
dtr_b:  dey
        lda TP,y
        cmp #'>'
        bne dtr_b
        iny
        sty V_A0+1
        lda #EOL
        sta TP,y
        jmp dtr_scan
dtr_done:
        jsr putsi
        .byte 'DELETED',EOL,0
        clc
        rts
dtr_err:
        lda V_ERR
        pha
        jsr dclose
        pla
        sta V_ERR
        sec
        rts
