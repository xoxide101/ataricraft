; run.asm - running programs (.COM), plug-ins (.CMX) and scripts (.BAT).
;
; Part of CMD.COM (included from cmd.asm). Programs are run through the 256-byte loader
; (loader.asm) which is copied to $0600 so it survives programs that overwrite CMD.
; Interface with the loader: the file is open on IOCB 1 ($10), $0603 (lmode) = 0 run / 1 load only.
; Hand-off line for tools: $0480 (flag) / $0481.. (text), see lib\hand.asm.
; Return convention for commands: carry clear = OK, carry set = failure (V_ERR holds the code).

; copy the loader image (embedded from bin\loader.bin) to $0600
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
        sta $0603               ; lmode = 0: run, never returns to CMD
        jmp $0600
x_fail: sec
        rts

; try to open FSPEC + suffix (A/X = suffix lo/hi, EOL ended). Returns N set when it does not exist.
; V_A2 remembers the original spec length so unext can cut the suffix off again.
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
unext:  ldy V_A2                ; undo tryext: put the EOL back where the suffix began
        lda #EOL
        sta FSPEC,y
        rts

s_cmx:  .byte '.CMX',EOL
s_com:  .byte '.COM',EOL
s_bat:  .byte '.BAT',EOL

; run the program named in TOK. With an extension (.BAT / .CMX / anything else = .COM) it is
; opened directly; without one the suffixes .CMX, .COM, .BAT are tried in that order.
; N4/N5 = the two characters after the dot (only the first letter, B, and the second, M, are tested).
; Prints BAD COMMAND when nothing is found.
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

; pass the rest of the command line to the program (see lib\hand.asm). Copies up to ~100 bytes
; of the remaining line to $0481 and sets the $A5 "line waiting" flag at $0480.
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

; .COM: run through the loader (mode 0); control does not come back to CMD
run_com:
        jsr sethand
        jsr copyldr
        lda #0
        sta $0603
        jmp $0600

; .CMX plug-in: load only (mode 1), then call its RUNAD through dojmp (JMP (jmpv), defined in
; cmd.asm) so the plug-in can return to CMD with RTS.
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

; script: the file is open on IOCB 1; it is closed and reopened on IOCB 5 ($50) so commands can
; use the other IOCBs. Each line is echoed and run via runline. Nesting is refused (V_BAT).
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
