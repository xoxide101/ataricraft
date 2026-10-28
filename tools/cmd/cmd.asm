; cmd.asm - CMD, a DOS-style command shell for Atari DOS 2.x, MyDOS, SpartaDOS and BW-DOS.
; Plug-ins (NAME.CMX, built with org PLUG) call the API table below; see README.md.
        icl 'lib\sys.asm'
        org CODE
        jmp start
        .byte API_VER
api:    jmp putc
        jmp putnl
        jmp pstr
        jmp putdec16
        jmp nexttok
        jmp mkspec
        jmp fopen
        jmp fclose
        jmp bget
        jmp bput
        jmp rdrec
        jmp wrrec
        jmp getline
        jmp getkey
        jmp fnsio

start:  jsr ioinit
        jsr dosdet
        jsr cwdinit
        lda #0
        sta V_LNL
        sta V_LNL+1
        sta V_QUIT
        sta V_BAT
        sta ENVB
        sta PATHV
        sta PROMPTV
        jsr putsi
        .byte 'CMD 0.1  ',0
        jsr putdosname
        jsr putnl
        jsr putsi
        .byte 'TYPE HELP FOR COMMANDS',EOL,0
        ldx #0
st_a:   lda s_auto,x
        sta TOK,x
        inx
        cpx #9
        bcc st_a
        jsr mkspec
        lda #<s_bat
        ldx #>s_bat
        jsr tryext
        bmi loop
        jsr run_bat
loop:   lda V_QUIT
        bne bye
        jsr putnl
        lda PROMPTV
        beq lp_d
        lda #<PROMPTV
        ldx #>PROMPTV
        jsr pstr
        jmp lp_g
lp_d:   lda #<CWD
        ldx #>CWD
        jsr pstr
        ldy #0
lp_e:   lda CWD,y
        beq lp_z
        iny
        bne lp_e
lp_z:   dey
        lda CWD,y
        cmp #'>'
        beq lp_g
        lda #'>'
        jsr putc
lp_g:   jsr getline
        jsr runline
        jmp loop
bye:    jmp (DOSVEC)
s_auto: .byte 'AUTOEXEC',0

runline:
        lda #<LINE
        sta ARG
        lda #>LINE
        sta ARG+1
        jsr nexttok
        beq rl_r
        jsr upcmd
        jsr dispatch
rl_r:   rts

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
dp_no:  jmp runext

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
        .byte 'DIRS',0
        .word cmd_dir
        .byte 'TYPE',0
        .word cmd_type
        .byte 'MORE',0
        .word cmd_more
        .byte 'LESS',0
        .word cmd_more
        .byte 'ECHO',0
        .word cmd_echo
        .byte 'VER',0
        .word cmd_ver
        .byte 'EXIT',0
        .word cmd_exit
        .byte 'QUIT',0
        .word cmd_exit
        .byte 'COPY',0
        .word cmd_copy
        .byte 'APPEND',0
        .word cmd_append
        .byte 'DEL',0
        .word cmd_del
        .byte 'DELETE',0
        .word cmd_del
        .byte 'ERASE',0
        .word cmd_del
        .byte 'REN',0
        .word cmd_ren
        .byte 'RENAME',0
        .word cmd_ren
        .byte 'RENDIR',0
        .word cmd_ren
        .byte 'ATTRIB',0
        .word cmd_attrib
        .byte 'MD',0
        .word cmd_md
        .byte 'MKDIR',0
        .word cmd_md
        .byte 'CREDIR',0
        .word cmd_md
        .byte 'RD',0
        .word cmd_rd
        .byte 'RMDIR',0
        .word cmd_rd
        .byte 'DELDIR',0
        .word cmd_rd
        .byte 'CD',0
        .word cmd_cd
        .byte 'CHDIR',0
        .word cmd_cd
        .byte 'CWD',0
        .word cmd_cd
        .byte 'PWD',0
        .word cmd_pwd
        .byte 'DF',0
        .word cmd_df
        .byte 'CHKDSK',0
        .word cmd_df
        .byte 'FIND',0
        .word cmd_find
        .byte 'CLS',0
        .word cmd_cls
        .byte 'PAUSE',0
        .word cmd_pause
        .byte 'MEM',0
        .word cmd_mem
        .byte 'PEEK',0
        .word cmd_peek
        .byte 'POKE',0
        .word cmd_poke
        .byte 'DUMP',0
        .word cmd_dump
        .byte 'MDUMP',0
        .word cmd_mdump
        .byte 'SET',0
        .word cmd_set
        .byte 'PATH',0
        .word cmd_path
        .byte 'PROMPT',0
        .word cmd_prompt
        .byte 'COLD',0
        .word cmd_cold
        .byte 'BASIC',0
        .word cmd_basic
        .byte 'X',0
        .word cmd_x
        .byte 'LOAD',0
        .word cmd_x
        .byte 'BLOAD',0
        .word cmd_x
        .byte 'FN',0
        .word cmd_fn
        .byte 'NGET',0
        .word cmd_copy
        .byte 'HELP',0
        .word cmd_help
        .byte 'MAN',0
        .word cmd_help
        .byte 'ATR',0
        .word cmd_stub
        .byte 'BOOT',0
        .word cmd_stub
        .byte 'CAR',0
        .word cmd_stub
        .byte 'CHTD',0
        .word cmd_stub
        .byte 'CHVOL',0
        .word cmd_stub
        .byte 'CLR',0
        .word cmd_stub
        .byte 'COMP',0
        .word cmd_stub
        .byte 'CON',0
        .word cmd_stub
        .byte 'DATE',0
        .word cmd_stub
        .byte 'DELTREE',0
        .word cmd_stub
        .byte 'DEV',0
        .word cmd_stub
        .byte 'ED',0
        .word cmd_stub
        .byte 'FMT',0
        .word cmd_stub
        .byte 'FORMAT',0
        .word cmd_stub
        .byte 'KEY',0
        .word cmd_keytest
        .byte 'KEYTEST',0
        .word cmd_keytest
        .byte 'MEMTEST',0
        .word cmd_memtest
        .byte 'RAMTEST',0
        .word cmd_memtest
        .byte 'INPUT',0
        .word cmd_input
        .byte 'JOY',0
        .word cmd_input
        .byte 'COLOR',0
        .word cmd_color
        .byte 'MONITOR',0
        .word cmd_monitor
        .byte 'MAP',0
        .word cmd_stub
        .byte 'MENU',0
        .word cmd_stub
        .byte 'RS232',0
        .word cmd_stub
        .byte 'SAVE',0
        .word cmd_stub
        .byte 'SETPATHS',0
        .word cmd_stub
        .byte 'SIOSET',0
        .word cmd_stub
        .byte 'SORTDIR',0
        .word cmd_stub
        .byte 'SWAP',0
        .word cmd_stub
        .byte 'TD',0
        .word cmd_stub
        .byte 'TIME',0
        .word cmd_stub
        .byte 'UNERASE',0
        .word cmd_stub
        .byte 'VERIFY',0
        .word cmd_stub
        .byte 0

        icl 'cmds\file.asm'
        icl 'cmds\misc.asm'
        icl 'cmds\run.asm'
        icl 'cmds\test.asm'
        icl 'lib\io.asm'
        icl 'lib\dos.asm'
        icl 'lib\path.asm'
        icl 'lib\fn.asm'

        run start
