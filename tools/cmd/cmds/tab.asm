; tab.asm - COMPLETE ON|OFF: opt-in line editor with Tab completion for CMD.
; Off (the default) CMD reads lines with the OS screen editor, which has cursor editing but no Tab key.
; On, CMD reads keys itself: Return, Backspace and Tab only. Tab completes a command name
; (first word) or a file/folder name (any later word) as far as every match agrees.

cmd_complete:
        jsr nexttok
        beq cc_show
        lda TOK+1
        jsr toupper
        cmp #'N'
        bne cc_f
        lda #1
        sta TABF
        jmp cc_show
cc_f:   cmp #'F'
        bne cc_show
        lda #0
        sta TABF
cc_show:
        jsr putsi
        .byte 'TAB COMPLETION ',0
        lda TABF
        beq cc_off
        jsr putsi
        .byte 'ON (RETURN, BACKSPACE, TAB ONLY)',EOL,0
        clc
        rts
cc_off: jsr putsi
        .byte 'OFF',EOL,0
        clc
        rts

; read one line into LINE (called instead of getline by the main loop)
getlinet:
        lda TABF
        bne gt_on
        jmp getline
gt_on:  lda #0
        sta TC_N
gt_k:   ldx #$70
        lda #7
        sta ICCOM,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        cmp #EOL
        beq gt_done
        cmp #$7E
        beq gt_bs
        cmp #$7F
        beq gt_tab
        cmp #$09
        beq gt_tab
        cmp #$20
        bcc gt_k
        cmp #$7B
        bcs gt_k
        jsr tc_put
        jmp gt_k
gt_bs:  lda TC_N
        beq gt_k
        dec TC_N
        lda #$7E
        jsr putc
        jmp gt_k
gt_tab: jsr tc_complete
        jmp gt_k
gt_done:
        ldx TC_N
        lda #EOL
        sta LINE,x
        jmp putc

; add A to the line and echo it (ignored when the line is full)
tc_put: ldx TC_N
        cpx #100
        bcs tc_pr
        sta LINE,x
        inc TC_N
        jmp putc
tc_pr:  rts

; compare the candidate at (T1) with the typed name part LINE[TC_PS..TC_N); on a match fold it into the common text
tc_try: lda TC_N
        sec
        sbc TC_PS
        sta TC_PL
        ldy #0
tt_c:   cpy TC_PL
        bcs tt_m
        lda (T1),y
        beq tt_no
        sta N5
        tya
        clc
        adc TC_PS
        tax
        lda LINE,x
        jsr toupper
        cmp N5
        bne tt_no
        iny
        bne tt_c
tt_m:   lda TC_CNT
        bne tt_cm
        ldx #0
tt_f:   lda (T1),y
        sta TC_CM,x
        beq tt_fd
        inx
        iny
        bne tt_f
tt_fd:  lda TC_D
        sta TC_D1
        inc TC_CNT
tt_no:  rts
tt_cm:  ldx #0
tt_l:   lda TC_CM,x
        beq tt_t
        lda (T1),y
        cmp TC_CM,x
        bne tt_t
        iny
        inx
        bne tt_l
tt_t:   lda #0
        sta TC_CM,x
        lda TC_CNT
        cmp #255
        beq tt_no
        inc TC_CNT
        rts

tc_complete:
        lda #0
        sta TC_CNT
        sta TC_D
        sta TC_D1
        sta TC_CM
; TC_TS = start of the last word, TC_SP = 1 when the line has an earlier word
        ldx TC_N
        stx TC_PS
        lda #0
        sta TC_SP
tc_w:   dex
        bmi tc_wd
        lda LINE,x
        cmp #' '
        bne tc_w
        inc TC_SP
tc_wd:  inx
        stx TC_TS
        stx TC_PS
        lda TC_SP
        jne tc_files
; ---- command names ----
        lda #<cmdtab
        sta T0
        lda #>cmdtab
        sta T0+1
tc_cn:  ldy #0
        lda (T0),y
        jeq tc_done
        lda T0
        sta T1
        lda T0+1
        sta T1+1
        jsr tc_try
        ldy #0
tc_cl:  lda (T0),y
        iny
        cmp #0
        bne tc_cl
        tya
        clc
        adc #2
        adc T0
        sta T0
        bcc tc_cn
        inc T0+1
        jmp tc_cn
; ---- files and folders: split the word into folder part and name part ----
tc_files:
        ldx TC_N
tc_s:   cpx TC_TS
        beq tc_sd
        dex
        lda LINE,x
        cmp #'>'
        beq tc_sf
        cmp #'\'
        beq tc_sf
        cmp #'/'
        beq tc_sf
        cmp #':'
        bne tc_s
tc_sf:  inx
        stx TC_PS
tc_sd:  ldx TC_TS
        ldy #0
tc_dp:  cpx TC_PS
        bcs tc_dd
        lda LINE,x
        sta TOK,y
        inx
        iny
        bne tc_dp
tc_dd:  lda #'*'
        sta TOK,y
        iny
        lda #'.'
        sta TOK,y
        iny
        lda #'*'
        sta TOK,y
        iny
        lda #0
        sta TOK,y
        jsr mkspec
        jsr dopen
        bmi tc_done
tc_f:   jsr dnext
        bcs tc_fe
        lda DREC+2
        cmp #'.'
        beq tc_f
        jsr dname
        lda #0
        sta TC_D
        jsr isdirrec
        bne tc_nd
        inc TC_D
tc_nd:  lda #<NAMEB
        sta T1
        lda #>NAMEB
        sta T1+1
        jsr tc_try
        jmp tc_f
tc_fe:  jsr dclose
tc_done:
        lda TC_CNT
        beq tc_r
        ldx #0
tc_a:   lda TC_CM,x
        beq tc_ad
        txa
        pha
        lda TC_CM,x
        jsr tc_put
        pla
        tax
        inx
        bne tc_a
tc_ad:  lda TC_CNT
        cmp #1
        bne tc_r
        lda TC_SP
        beq tc_spc
        lda TC_D1
        beq tc_r
        lda #'>'
        jmp tc_put
tc_spc: lda #' '
        jmp tc_put
tc_r:   rts
