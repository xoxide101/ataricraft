; run.asm - running programs (.COM), plug-ins (.CMX) and scripts (.BAT).

copyldr:
        ldx #0
cl_l:   lda ldrimg,x
        sta $0600,x
        inx
        bne cl_l
        rts
ldrimg: ins 'bin\loader.bin',6

; X / LOAD: run a program named exactly as typed
cmd_x:  jsr needtok
        jcs failr
        jsr mkspec
        lda #4
        ldx #$10
        jsr fopen1
        bmi x_fail
        jsr copyldr
        lda #0
        sta $0603
        jmp $0600
x_fail: sec
        rts

; try to open FSPEC + suffix (A/X = suffix, EOL ended). Returns N set when it does not exist.
tryext: sta T0
        stx T0+1
        ldy #0
te_f:   lda FSPEC,y
        cmp #EOL
        beq te_g
        iny
        bne te_f
te_g:   sty V_A2
        lda #0
        sta N2
te_c:   sty N3
        ldy N2
        lda (T0),y
        ldy N3
        sta FSPEC,y
        iny
        inc N2
        cmp #EOL
        bne te_c
        lda #4
        ldx #$10
        jsr fopen1
        rts
unext:  ldy V_A2
        lda #EOL
        sta FSPEC,y
        rts

s_cmx:  .byte '.CMX',EOL
s_com:  .byte '.COM',EOL
s_bat:  .byte '.BAT',EOL

runext: jsr mkspec
        ldx #0
re_d:   lda TOK,x
        beq re_nd
        cmp #'.'
        beq re_dot
        inx
        bne re_d
re_dot: inx
        lda TOK,x
        sta N4
        inx
        lda TOK,x
        sta N5
        lda #4
        ldx #$10
        jsr fopen1
        bmi re_bad
        lda N4
        cmp #'B'
        jeq run_bat
        lda N5
        cmp #'M'
        jeq run_cmx
        bne run_com
re_nd:  lda #<s_cmx
        ldx #>s_cmx
        jsr tryext
        jpl run_cmx
        jsr unext
        lda #<s_com
        ldx #>s_com
        jsr tryext
        jpl run_com
        jsr unext
        lda #<s_bat
        ldx #>s_bat
        jsr tryext
        jpl run_bat
re_bad: jsr putsi
        .byte 'BAD COMMAND',EOL,0
        clc
        rts

; pass the rest of the command line to the program (see lib\hand.asm)
sethand:
        lda #0
        sta $0480
        jsr argend
        beq sh_r
        ldy #0
sh_c:   lda (ARG),y
        sta $0481,y
        cmp #EOL
        beq sh_d
        iny
        cpy #100
        bcc sh_c
        lda #EOL
        sta $0481,y
sh_d:   lda #$A5
        sta $0480
sh_r:   rts

run_com:
        jsr sethand
        jsr copyldr
        lda #0
        sta $0603
        jmp $0600

run_cmx:
        jsr copyldr
        lda #1
        sta $0603
        jsr $0600
        lda RUNAD
        ora RUNAD+1
        beq rc_x
        lda RUNAD
        sta jmpv
        lda RUNAD+1
        sta jmpv+1
        jsr dojmp
        rts
rc_x:   clc
        rts

; script: the file is open on IOCB 1, move it to IOCB 5 so commands can use the others
run_bat:
        ldx #$10
        jsr fclose
        lda V_BAT
        beq rb_ok
        jsr putsi
        .byte 'NESTED BATCH FILES NOT SUPPORTED',EOL,0
        sec
        rts
rb_ok:  lda #1
        sta V_BAT
        lda #4
        ldx #$50
        jsr fopen1
        bmi rb_end
rb_l:   lda #<LINE
        sta V_SPL
        lda #>LINE
        sta V_SPH
        ldx #$50
        jsr rdrec
        bmi rb_end
        lda LINE
        cmp #EOL
        beq rb_l
        lda #<LINE
        ldx #>LINE
        jsr pstr
        jsr putnl
        jsr runline
        lda V_QUIT
        beq rb_l
rb_end: ldx #$50
        jsr fclose
        lda #0
        sta V_BAT
        clc
        rts
