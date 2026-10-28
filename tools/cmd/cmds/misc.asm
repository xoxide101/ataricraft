; misc.asm - memory, environment and system commands.

cmd_cls:
        lda #$7D
        jsr putc
        clc
        rts

cmd_pause:
        jsr putsi
        .byte 'PRESS ANY KEY',0
        jsr getkey
        jsr putnl
        clc
        rts

cmd_mem:
        sec
        lda #0
        sbc MEMLO
        sta N0
        lda RAMTOP
        sbc MEMLO+1
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' BYTES FREE UNDER DOS',EOL,'RAM ',0
        lda RAMTOP
        lsr
        lsr
        sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsi
        .byte 'K',EOL,0
        clc
        rts

cmd_peek:
        jsr needtok
        jcs failr
        jsr parsenum
        jcs mm_bad
        ldy #0
        lda (N0),y
        jsr puthex8
        jsr putnl
        clc
        rts
mm_bad: lda #165
        sta V_ERR
        sec
        rts

cmd_poke:
        jsr needtok
        jcs failr
        jsr parsenum
        jcs mm_bad
        lda N0
        sta T1
        lda N1
        sta T1+1
        jsr needtok
        jcs failr
        jsr parsenum
        jcs mm_bad
        ldy #0
        lda N0
        sta (T1),y
        clc
        rts

; print 8 bytes at T0 labelled with V_A0
dumpline:
        ldx V_A0+1
        lda V_A0
        jsr puthex16
        lda #' '
        jsr putc
        ldy #0
dl_h:   lda (T0),y
        jsr puthex8
        lda #' '
        jsr putc
        iny
        cpy #8
        bcc dl_h
        ldy #0
dl_a:   lda (T0),y
        cmp #32
        bcc dl_d
        cmp #123
        bcc dl_o
dl_d:   lda #'.'
dl_o:   jsr putc
        iny
        cpy #8
        bcc dl_a
        jsr putnl
        clc
        lda T0
        adc #8
        sta T0
        bcc dl_n
        inc T0+1
dl_n:   clc
        lda V_A0
        adc #8
        sta V_A0
        bcc dl_r
        inc V_A0+1
dl_r:   rts

cmd_mdump:
        jsr needtok
        jcs failr
        jsr parsenum
        jcs mm_bad
        lda N0
        sta T0
        sta V_A0
        lda N1
        sta T0+1
        sta V_A0+1
        lda #8
        sta V_A1
        jsr nexttok
        beq md_l
        jsr parsenum
        jcs mm_bad
        lsr N1
        ror N0
        lsr N1
        ror N0
        lsr N1
        ror N0
        lda N0
        bne md_s
        lda #1
md_s:   sta V_A1
md_l:   jsr dumpline
        dec V_A1
        beq md_d
        jsr keyhit
        bcc md_l
md_d:   clc
        rts

cmd_dump:
        jsr needtok
        jcs failr
        jsr mkspec
        lda #4
        ldx #$10
        jsr fopen1
        jmi ty_fail
        lda #0
        sta V_A0
        sta V_A0+1
dm_r:   lda #0
        sta V_BLL
        lda #1
        sta V_BLH
        ldx #$10
        jsr bget
        lda V_ERR
        sta V_A2
        lda ICBLL+$10
        clc
        adc #7
        sta N0
        lda ICBLH+$10
        adc #0
        sta N1
        lsr N1
        ror N0
        lsr N1
        ror N0
        lsr N1
        ror N0
        lda ICBLL+$10
        ora ICBLH+$10
        beq dm_e
        lda N0
        sta V_A1
        lda #<IOBUF
        sta T0
        lda #>IOBUF
        sta T0+1
dm_l:   jsr dumpline
        dec V_A1
        bne dm_l
        lda V_A2
        bmi dm_e
        jsr getkey
        cmp #27
        bne dm_r
dm_e:   ldx #$10
        jsr fclose
        clc
        rts

; copy the rest of the line (ARG) to the buffer at A/X as text + EOL + 0
cprest: sta T1
        stx T1+1
        jsr argend
        ldy #0
        lda (ARG),y
        cmp #EOL
        beq cr_d
cr_l:   lda (ARG),y
        cmp #EOL
        beq cr_d
        sta (T1),y
        iny
        cpy #120
        bcc cr_l
cr_d:   lda #EOL
        sta (T1),y
        iny
        lda #0
        sta (T1),y
        clc
        rts

cmd_set:
        jsr argend
        bne st_add
        lda #<ENVB
        sta T0
        lda #>ENVB
        sta T0+1
st_p:   ldy #0
        lda (T0),y
        beq st_x
        lda T0
        ldx T0+1
        jsr pstr
        jsr putnl
st_s:   ldy #0
        lda (T0),y
        iny
        cmp #EOL
        bne st_s
        tya
        clc
        adc T0
        sta T0
        bcc st_p
        inc T0+1
        jmp st_p
st_x:   clc
        rts
st_add: lda #<ENVB
        sta T1
        lda #>ENVB
        sta T1+1
st_f:   ldy #0
        lda (T1),y
        beq st_e
st_n:   ldy #0
        lda (T1),y
        iny
        cmp #EOL
        bne st_n
        tya
        clc
        adc T1
        sta T1
        bcc st_f
        inc T1+1
        jmp st_f
st_e:   lda T1
        ldx T1+1
        jmp cprest

cmd_path:
        jsr argend
        bne pa_s
        lda #<PATHV
        ldx #>PATHV
        jsr pstr
        jsr putnl
        clc
        rts
pa_s:   lda #<PATHV
        ldx #>PATHV
        jsr cprest
        clc
        rts

cmd_prompt:
        jsr argend
        bne pr_s
        lda #0
        sta PROMPTV
        clc
        rts
pr_s:   lda #<PROMPTV
        ldx #>PROMPTV
        jsr cprest
        clc
        rts

cmd_cold:
        lda #0
        sta COLDST
        jmp $E477

cmd_basic:
        lda #0
        sta BASICF
        lda PORTB
        and #$FD
        sta PORTB
        lda #0
        sta COLDST
        jmp $E477

cmd_help:
        lda #<cmdtab
        sta T0
        lda #>cmdtab
        sta T0+1
hp_n:   ldy #0
        lda (T0),y
        beq hp_d
hp_p:   lda (T0),y
        beq hp_e
        jsr putc
        iny
        bne hp_p
hp_e:   lda #' '
        jsr putc
        iny
        iny
        iny
        tya
        clc
        adc T0
        sta T0
        bcc hp_n
        inc T0+1
        jmp hp_n
hp_d:   jsr putnl
        jsr putsi
        .byte 'ANYTHING ELSE RUNS NAME.CMX / .COM / .BAT',EOL,0
        clc
        rts

cmd_stub:
        jsr putsi
        .byte 'NOT IN CMD 0.1 YET (USE THE DOS MENU OR AFM)',EOL,0
        clc
        rts

cmd_exit:
        lda #1
        sta V_QUIT
        clc
        rts

cmd_ver:
        jsr putsi
        .byte 'CMD 0.1 ON ',0
        jsr putdosname
        jsr putnl
        clc
        rts

cmd_echo:
        jsr argend
        beq ce_d
        lda ARG
        ldx ARG+1
        jsr pstr
ce_d:   jsr putnl
        clc
        rts

cmd_dir:
        jsr nexttok
        bne cd_a
        lda #'*'
        sta TOK
        lda #'.'
        sta TOK+1
        lda #'*'
        sta TOK+2
        lda #0
        sta TOK+3
cd_a:   jsr mkspec
        jsr lncwd
        jsr dopen
        bmi cd_fail
cd_l:   jsr dnext
        bcs cd_end
        jsr dname
        jsr lnshow
        lda #<DREC
        ldx #>DREC
        jsr pstr
        lda LNB
        beq cd_nl
        jsr putsi
        .byte '  ',0
        lda #<LNB
        ldx #>LNB
        jsr pstr
cd_nl:  jsr putnl
        jsr keyhit
        jmp cd_l
cd_end: jsr dclose
        lda V_FREE
        sta N0
        lda V_FREE+1
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' FREE SECTORS',EOL,0
        clc
        rts
cd_fail:
        jsr dclose
        sec
        rts
