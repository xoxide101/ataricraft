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
        jsr nexttok
        beq hp_all
        jmp hp_topic
hp_all: lda #<cmdtab
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
        .byte 'ANYTHING ELSE RUNS NAME.CMX / .COM / .BAT',EOL
        .byte 'TOOLS: ARC ZIP LZH ALF DCM DISC',EOL
        .byte 'HELP TOOLNAME SHOWS ITS COMMANDS',EOL,0
        clc
        rts

hp_topic:
        lda #<topics
        sta T0
        lda #>topics
        sta T0+1
tp_n:   ldy #0
        lda (T0),y
        beq tp_no
tp_c:   lda TOK,y
        cmp #'a'
        bcc tp_u
        cmp #'z'+1
        bcs tp_u
        and #$DF
tp_u:   cmp (T0),y
        bne tp_nx
        cmp #0
        beq tp_hit
        iny
        bne tp_c
tp_nx:  ldy #0
tp_s1:  lda (T0),y
        iny
        cmp #0
        bne tp_s1
tp_s2:  lda (T0),y
        iny
        cmp #0
        bne tp_s2
        tya
        clc
        adc T0
        sta T0
        bcc tp_n
        inc T0+1
        jmp tp_n
tp_hit: iny
tp_p:   lda (T0),y
        beq tp_d
        jsr putc
        iny
        bne tp_p
tp_d:   clc
        rts
tp_no:  jsr putsi
        .byte 'NO HELP FOR THAT. TRY HELP',EOL,0
        clc
        rts

; HELP name: name,0,text,0 (name+text must stay under 250 bytes)
topics:
        .byte 'COMPLETE',0
        .byte 'COMPLETE ON|OFF',EOL
        .byte 'ON: TAB COMPLETES COMMANDS AND NAMES',EOL
        .byte 'KEYS: RETURN BACKSPACE TAB ONLY',EOL,0
        .byte 'ARC',0
        .byte 'ARC L FILE.ARC   LIST',EOL
        .byte 'ARC T FILE.ARC   TEST',EOL
        .byte 'ARC X FILE.ARC [DEST] [MEMBER]',EOL
        .byte 'SEA ARC METHODS 1-4 AND 8',EOL,0
        .byte 'ZIP',0
        .byte 'ZIP L|T|X FILE.ZIP [DEST] [MEMBER]',EOL
        .byte 'STORED AND DEFLATE MEMBERS',EOL,0
        .byte 'LZH',0
        .byte 'LZH L|T|X FILE.LZH [DEST] [MEMBER]',EOL
        .byte 'LHA METHODS LH0 LH1 LH4 LH5',EOL,0
        .byte 'ALF',0
        .byte 'ALF L|T|X FILE.ALF [DEST] [MEMBER]',EOL
        .byte 'ATARI LZ.COM ARCHIVES',EOL,0
        .byte 'DCM',0
        .byte 'DCM X FILE.DCM [DEST.ATR]',EOL
        .byte 'DISKCOMM IMAGE TO ATR',EOL,0
        .byte 'DISC',0
        .byte 'DISC D9:   (OR D10:)  CD/HDD IMAGE',EOL
        .byte 'D LIST  T FILE  X FILE  I INFO  Q',EOL
        .byte 'QUOTE NAMES WITH SPACES',EOL
        .byte 'ISO 9660, UDF, FAT12/16/32',EOL,0
        .byte 0

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

; ---- DATE and TIME: kept in memory for this session (the 8-bit has no clock) ----
cmd_date:
        ldx #0
        beq dtm_go
cmd_time:
        ldx #$10
dtm_go: stx V_A0
        jsr argend
        bne dtm_set
        ldx V_A0
        lda DATEB,x
        bne dtm_show
        jsr putsi
        .byte 'NOT SET. GIVE A VALUE, E.G. DATE 10-28-26',EOL,0
        clc
        rts
dtm_show:
        lda V_A0
        clc
        adc #<DATEB
        ldx #>DATEB
        jsr pstr
        jsr putnl
        clc
        rts
dtm_set:
        ldx V_A0
        ldy #0
dtm_c:  lda (ARG),y
        cmp #EOL
        beq dtm_d
        sta DATEB,x
        inx
        iny
        cpy #15
        bcc dtm_c
dtm_d:  lda #0
        sta DATEB,x
        clc
        rts
