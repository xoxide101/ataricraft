; cmd.asm - CMD, a DOS-style command shell for Atari DOS 2.x, MyDOS, SpartaDOS and BW-DOS.
        icl 'lib\sys.asm'
        org CODE

start:  jsr ioinit
        jsr dosdet
        jsr cwdinit
        lda #0
        sta V_LNL
        sta V_LNL+1
        sta V_QUIT
        jsr putsi
        .byte 'CMD 0.1  ',0
        jsr putdosname
        jsr putnl
        jsr putsi
        .byte 'TYPE HELP FOR COMMANDS',EOL,0
loop:   jsr putnl
        lda #<CWD
        ldx #>CWD
        jsr pstr
        lda #'>'
        jsr putc
        jsr getline
        lda #<LINE
        sta ARG
        lda #>LINE
        sta ARG+1
        jsr nexttok
        beq loop
        jsr upcmd
        jsr dispatch
        lda V_QUIT
        beq loop
        jmp (DOSVEC)

upcmd:  ldx #0
uc_l:   lda TOK,x
        beq uc_d
        jsr toupper
        sta TOK,x
        inx
        bne uc_l
uc_d:   rts

dispatch:
        lda #<cmdtab
        sta T0
        lda #>cmdtab
        sta T0+1
dp_n:   ldy #0
        lda (T0),y
        beq dp_no
dp_c:   lda (T0),y
        cmp TOK,y
        bne dp_nx
        cmp #0
        beq dp_hit
        iny
        bne dp_c
dp_nx:  ldy #0
dp_s:   lda (T0),y
        iny
        cmp #0
        bne dp_s
        tya
        clc
        adc #2
        adc T0
        sta T0
        bcc dp_n
        inc T0+1
        jmp dp_n
dp_hit: iny
        lda (T0),y
        sta jmpv
        iny
        lda (T0),y
        sta jmpv+1
        jsr dojmp
        bcc dp_ok
        jmp err
dp_ok:  rts
dojmp:  jmp (jmpv)
jmpv:   .word 0
dp_no:  jsr putsi
        .byte 'BAD COMMAND',EOL,0
        rts

err:    jsr putsi
        .byte 'ERROR ',0
        lda V_ERR
        sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putnl
        rts

cmdtab:
        .byte 'DIR',0
        .word cmd_dir
        .byte 'TYPE',0
        .word cmd_type
        .byte 'ECHO',0
        .word cmd_echo
        .byte 'VER',0
        .word cmd_ver
        .byte 'EXIT',0
        .word cmd_exit
        .byte 'QUIT',0
        .word cmd_exit
        .byte 0

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

cmd_type:
        jsr nexttok
        bne ct_a
        lda #1
        sta V_ERR
        sec
        rts
ct_a:   jsr mkspec
        lda #4
        ldx #$10
        jsr fopen1
        bmi ct_fail
ct_l:   lda #<IOBUF
        sta V_SPL
        lda #>IOBUF
        sta V_SPH
        ldx #$10
        jsr rdrec
        bmi ct_end
        lda #<IOBUF
        ldx #>IOBUF
        jsr pstr
        jsr putnl
        jsr keyhit
        bcc ct_l
ct_end: ldx #$10
        jsr fclose
        clc
        rts
ct_fail:
        ldx #$10
        jsr fclose
        sec
        rts

        icl 'lib\io.asm'
        icl 'lib\dos.asm'
        icl 'lib\path.asm'

        run start
