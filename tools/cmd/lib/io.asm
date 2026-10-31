; io.asm - console, CIO helpers, number printing and the argument tokenizer.
;
; Included by CMD.COM and every stand-alone tool (after lib\sys.asm, which defines the equates).
; IOCB use: IOCB 0 ($00) = E: screen editor, IOCB 7 ($70) = K: keyboard, IOCB 1 ($10) = the
; default file channel; the caller picks the IOCB by passing X = IOCB number * 16.
; Calling conventions (shared by the routines below):
;   - Every CIO wrapper leaves the CIO status in Y, also copies it to V_ERR and returns it in A
;     (A = Y, so N is set on any error status >= 128; Y = 1 means OK).
;   - Argument/work slots: ARG ($D4) = cursor into the command line, T0/T1 = scratch pointers,
;     N0..N5 = 16-bit number scratch, V_SPL/V_SPH = pointer to a file spec,
;     V_BLL/V_BLH = block length, V_BPL/V_BPH = block buffer pointer (default IOBUF).
;   - putc preserves A, X and Y; most others clobber A, X, Y.

; ---- console (IOCB 0, E:) ----
; print the character in A through CIO command 11 (put chars) with a zero length, which makes
; CIO transfer just the single byte in A. Preserves A, X, Y.
putc:   sta V_PCH
        stx V_PSX
        sty V_PSY
        lda #11
        sta ICCOM
        lda #0
        sta ICBLL
        sta ICBLH
        lda V_PCH
        ldx #0
        jsr CIOV
        ldx V_PSX
        ldy V_PSY
        lda V_PCH
        rts

; print a newline (ATASCII EOL, $9B)
putnl:  lda #EOL
        jmp putc

; print the string that follows the JSR, ended by a zero byte.
; Trick: the return address on the stack points at the last byte of the JSR, so it is used as
; the string pointer, then pushed back past the terminating zero so RTS resumes after the text.
putsi:  pla
        sta T0
        pla
        sta T0+1
        ldy #0
ps_l:   inc T0
        bne ps_g
        inc T0+1
ps_g:   lda (T0),y
        beq ps_d
        jsr putc
        jmp ps_l
ps_d:   lda T0+1
        pha
        lda T0
        pha
        rts

; print the string at A(lo)/X(hi) up to EOL or zero (neither printed)
pstr:   sta T0
        stx T0+1
        ldy #0
pst_l:  lda (T0),y
        beq pst_d
        cmp #EOL
        beq pst_d
        jsr putc
        iny
        bne pst_l
pst_d:  rts

; print N0/N1 as an unsigned decimal, no leading zeros (N5 = "digit printed" flag).
; Repeated subtraction of 10000,1000,100,10,1 (ptab); Y indexes ptab in words. Clobbers N0-N2, N5.
putdec16:
        lda #0
        sta N5
        ldy #0
pd_d:   ldx #0
pd_t:   lda N0
        sec
        sbc ptab,y
        sta N2
        lda N1
        sbc ptab+1,y
        bcc pd_p
        sta N1
        lda N2
        sta N0
        inx
        jmp pd_t
pd_p:   txa
        ora N5
        bne pd_pr
        cpy #8
        bne pd_nx
pd_pr:  lda #1
        sta N5
        txa
        ora #'0'
        jsr putc
pd_nx:  iny
        iny
        cpy #10
        bcc pd_d
        rts
ptab:   .word 10000,1000,100,10,1

; print A as two hex digits (hexd prints the low nibble of A as one digit)
puthex8:
        pha
        lsr
        lsr
        lsr
        lsr
        jsr hexd
        pla
        and #$0F
hexd:   clc
        adc #'0'
        cmp #'9'+1
        bcc hx_o
        adc #6
hx_o:   jmp putc

; print X(hi)/A(lo) as four hex digits
puthex16:
        pha
        txa
        jsr puthex8
        pla
        jmp puthex8

; pad with spaces: Y = count
putsp:  lda #' '
        jsr putc
        dey
        bne putsp
        rts

; ---- keyboard (IOCB 7 = K:) ----
kspec:  .byte 'K:',EOL
; open K: on IOCB 7 (mode 4 = read); call once at start-up
ioinit: ldx #$70
        lda #<kspec
        sta V_SPL
        lda #>kspec
        sta V_SPH
        lda #4
        jsr fopen
        rts

; wait for a key from K: (CIO get chars, one byte); lower case is folded to upper case. Returns A.
getkey: ldx #$70
        lda #7                  ; CIO get characters
        sta ICCOM,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        cmp #'a'
        bcc gk_r
        cmp #'z'+1
        bcs gk_r
        and #$DF
gk_r:   rts

; non-blocking: carry set and key in A if a key is waiting
keyhit: lda CH
        cmp #$FF                ; CH = $FF means no key pressed
        beq kh_n
        jsr getkey
        sec
        rts
kh_n:   clc
        rts

; read a line from the screen editor (IOCB 0) into LINE, max 120 bytes, EOL terminated.
; CIO status is returned in Y (not copied to V_ERR).
getline:
        lda #<LINE
        sta ICBAL
        lda #>LINE
        sta ICBAH
        lda #5                  ; CIO get record
        sta ICCOM
        lda #120
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jmp CIOV

; ---- CIO files ----
; fopen: A = ICAX1 mode (4 read, 8 write, 9 append, 12 update, 6 directory), X = IOCB*16,
; V_SPL/V_SPH = file spec. Returns Y/N flag like CIO. fopen1/fopen2 use FSPEC/FSPEC2 as the spec.
; The IOCB is closed first (command 12) so a stale open channel never causes error 129.
fopen1: pha
        lda #<FSPEC
        sta V_SPL
        lda #>FSPEC
        sta V_SPH
        pla
        jmp fopen
fopen2: pha
        lda #<FSPEC2
        sta V_SPL
        lda #>FSPEC2
        sta V_SPH
        pla
fopen:  pha
        stx V_PSX
        lda #12                 ; CIO close
        sta ICCOM,x
        jsr CIOV
        ldx V_PSX
        pla
        sta ICAX1,x
        lda #3                  ; CIO open
        sta ICCOM,x
        lda V_SPL
        sta ICBAL,x
        lda V_SPH
        sta ICBAH,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        sty V_ERR
        tya
        rts

; close IOCB X (CIO command 12); status in Y, V_ERR and A
fclose: lda #12
        sta ICCOM,x
        jsr CIOV
        sty V_ERR
        tya
        rts

; block read into IOBUF, length V_BLL/V_BLH. Y = status (136 = end of file); actual length in ICBLL,x/ICBLH,x
; bgetp is the same but reads into the buffer at V_BPL/V_BPH.
bget:   lda #<IOBUF
        sta V_BPL
        lda #>IOBUF
        sta V_BPH
bgetp:  lda #7                  ; CIO get characters (binary block)
        sta ICCOM,x
        lda V_BPL
        sta ICBAL,x
        lda V_BPH
        sta ICBAH,x
        lda V_BLL
        sta ICBLL,x
        lda V_BLH
        sta ICBLH,x
        jsr CIOV
        sty V_ERR
        tya
        rts

; block write from IOBUF (bput) or from V_BPL/V_BPH (bputp), length V_BLL/V_BLH, to IOCB X
bput:   lda #<IOBUF
        sta V_BPL
        lda #>IOBUF
        sta V_BPH
bputp:  lda #11                 ; CIO put characters
        sta ICCOM,x
        lda V_BPL
        sta ICBAL,x
        lda V_BPH
        sta ICBAH,x
        lda V_BLL
        sta ICBLL,x
        lda V_BLH
        sta ICBLH,x
        jsr CIOV
        sty V_ERR
        tya
        rts

; read a text record from IOCB X into the buffer at V_SPL/V_SPH (max 79 bytes)
rdrec:  lda #5                  ; CIO get record
        sta ICCOM,x
        lda V_SPL
        sta ICBAL,x
        lda V_SPH
        sta ICBAH,x
        lda #79
        sta ICBLL,x
        lda #0
        sta ICBLH,x
        jsr CIOV
        sty V_ERR
        tya
        rts

; write a text record from V_SPL/V_SPH (ended by EOL) to IOCB X
wrrec:  lda #9                  ; CIO put record
        sta ICCOM,x
        lda V_SPL
        sta ICBAL,x
        lda V_SPH
        sta ICBAH,x
        lda #80
        sta ICBLL,x
        lda #0
        sta ICBLH,x
        jsr CIOV
        sty V_ERR
        tya
        rts

; XIO on the spec at V_SPL/V_SPH: A = command, V_FLG = ICAX1. Returns Y/N like CIO.
; Typical commands: 32 rename, 33 delete, 35 lock, 36 unlock, 42 make dir (MyDOS/Sparta).
; xio uses IOCB 1; xiox takes X = IOCB*16; xio1/xio2 use FSPEC/FSPEC2 as the spec.
xio:    ldx #$10
xiox:   sta ICCOM,x
        lda V_SPL
        sta ICBAL,x
        lda V_SPH
        sta ICBAH,x
        lda V_FLG
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        sty V_ERR
        tya
        rts
xio1:   pha
        lda #<FSPEC
        sta V_SPL
        lda #>FSPEC
        sta V_SPH
        pla
        jmp xio
xio2:   pha
        lda #<FSPEC2
        sta V_SPL
        lda #>FSPEC2
        sta V_SPH
        pla
        jmp xio

; ---- text helpers ----
; A = upper case of A (a-z only)
toupper:
        cmp #'a'
        bcc tu_r
        cmp #'z'+1
        bcs tu_r
        and #$DF
tu_r:   rts

; advance the ARG pointer by one
arginc: inc ARG
        bne ai_r
        inc ARG+1
ai_r:   rts

; next blank-separated (or "quoted") token from ARG into TOK (NUL terminated, max 60 chars).
; Z set when there is none. ARG is advanced past the token; X = token length on return.
nexttok:
nt_sk:  ldy #0
        lda (ARG),y
        cmp #' '
        bne nt_go
        jsr arginc
        jmp nt_sk
nt_go:  ldx #0
        cmp #EOL
        beq nt_end
        cmp #0
        beq nt_end
        cmp #'"'
        bne nt_pl
        jsr arginc
nt_q:   ldy #0
        lda (ARG),y
        cmp #EOL
        beq nt_end
        cmp #0
        beq nt_end
        cmp #'"'
        beq nt_qe
        sta TOK,x
        inx
        jsr arginc
        jmp nt_q
nt_qe:  jsr arginc
        jmp nt_end
nt_pl:  ldy #0
        lda (ARG),y
        cmp #EOL
        beq nt_end
        cmp #0
        beq nt_end
        cmp #' '
        beq nt_end
        sta TOK,x
        inx
        cpx #60
        bcs nt_end
        jsr arginc
        jmp nt_pl
nt_end: lda #0
        sta TOK,x
        cpx #0
        rts

; Z set when ARG is at the end of the line
argend: ldy #0
        lda (ARG),y
        cmp #EOL
        beq ae_y
        cmp #0
        beq ae_y
        cmp #' '
        bne ae_n
        jsr arginc
        jmp argend
ae_y:   lda #0
        rts
ae_n:   lda #1
        rts

; parse an unsigned decimal or $hex number from TOK into N0/N1. Carry set if TOK is not a number.
; Decimal: N = N*10 + digit, done as (N*4 + N)*2 + digit. Hex: shift left 4 and OR the digit.
; No overflow check: values wrap modulo 65536. Clobbers N2, N4, N5.
parsenum:
        lda #0
        sta N0
        sta N1
        ldx #0
        lda TOK
        beq pn_bad
        cmp #'$'
        beq pn_hex
pn_dl:  lda TOK,x
        beq pn_ok
        sec
        sbc #'0'
        cmp #10
        bcs pn_bad
        sta N2
        lda N0
        sta N4
        lda N1
        sta N5
        asl N0
        rol N1
        asl N0
        rol N1
        clc
        lda N0
        adc N4
        sta N0
        lda N1
        adc N5
        sta N1
        asl N0
        rol N1
        clc
        lda N0
        adc N2
        sta N0
        bcc pn_nx
        inc N1
pn_nx:  inx
        jmp pn_dl
pn_hex: inx
pn_hl:  lda TOK,x
        beq pn_ok
        jsr toupper
        sec
        sbc #'0'
        cmp #10
        bcc pn_hd
        sbc #7
        cmp #10
        bcc pn_bad
        cmp #16
        bcs pn_bad
pn_hd:  sta N2
        asl N0
        rol N1
        asl N0
        rol N1
        asl N0
        rol N1
        asl N0
        rol N1
        lda N0
        ora N2
        sta N0
        inx
        jmp pn_hl
pn_ok:  clc
        rts
pn_bad: sec
        rts
