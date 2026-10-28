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
        lda #0
        sta V_FLG
        lda #43
        jsr xio1
        jmi failr
        clc
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
