; Shared N: helpers (included at the end of an app by tools/tests/buildapp.cjs). Device N1: ($71).

; one SIO call using cmd/stats/bl/bh/ll/lh/al/ah; Y = status (1 = ok)
sio     lda #$71
        sta DDEVIC
        lda #1
        sta DDEVIC+1
        lda cmd
        sta DDEVIC+2
        lda stats
        sta DDEVIC+3
        lda bl
        sta DDEVIC+4
        lda bh
        sta DDEVIC+5
        lda #$0F
        sta DDEVIC+6
        lda ll
        sta DDEVIC+8
        lda lh
        sta DDEVIC+9
        lda al
        sta DDEVIC+10
        lda ah
        sta DDEVIC+11
        jsr SIOV
        rts

; shorthand: a command with no data (A = command byte, X = aux1, Y = aux2)
nsimple sta cmd
        stx al
        sty ah
        lda #0
        sta stats
        sta ll
        sta lh
        lda #<BUF
        sta bl
        lda #>BUF
        sta bh
        jmp sio

; send the 256-byte buffer at A/Y (command in cmd, aux in al/ah)
nsend   sta bl
        sty bh
        lda #$80
        sta stats
        lda #0
        sta ll
        lda #1
        sta lh
        jmp sio

; open SPEC; aux1 in X, aux2 in Y
nopen   lda #'O'
        sta cmd
        stx al
        sty ah
        lda #<SPEC
        ldy #>SPEC
        jmp nsend

nclose  lda #'C'
        ldx #0
        ldy #0
        jmp nsimple

; status into STAT (4 bytes: avail lo, avail hi, connected, error)
nstat   lda #'S'
        sta cmd
        lda #$40
        sta stats
        lda #<STAT
        sta bl
        lda #>STAT
        sta bh
        lda #4
        sta ll
        lda #0
        sta lh
        sta al
        sta ah
        jmp sio

; read what status reports (max 255 bytes) into BUF; ln = count
nread   lda STAT+1
        beq nr1
        lda #255
        sta STAT
nr1     lda STAT
        sta ln
        sta ll
        sta al
        lda #'R'
        sta cmd
        lda #$40
        sta stats
        lda #<BUF
        sta bl
        lda #>BUF
        sta bh
        lda #0
        sta lh
        sta ah
        jmp sio

; write A bytes from BUF
nwrite  sta ll
        sta al
        lda #'W'
        sta cmd
        lda #$80
        sta stats
        lda #<BUF
        sta bl
        lda #>BUF
        sta bh
        lda #0
        sta lh
        sta ah
        jmp sio

; print ln bytes of BUF on the screen
pbuf    lda ln
        beq pbret
        sta ICBLL
        lda #0
        sta ICBLH
        lda #<BUF
        sta ICBAL
        lda #>BUF
        sta ICBAH
        lda #$0B
        sta ICCOM
        ldx #0
        jsr CIOV
pbret   rts

; read a screen line into the buffer at A/Y; X = length including the EOL
getrec  sta ICBAL
        sty ICBAH
        lda #$05
        sta ICCOM
        lda #200
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV
        ldx ICBLL
        rts

; read a URL line into SPEC+2 with the N: prefix
geturl  lda #<(SPEC+2)
        ldy #>(SPEC+2)
        jsr getrec
        lda #'N'
        sta SPEC
        lda #':'
        sta SPEC+1
        rts

; print one byte on the screen, registers preserved
putc    sta pc
        stx sx
        sty sy
        lda #$0B
        sta ICCOM
        lda #0
        sta ICBLL
        sta ICBLH
        lda pc
        ldx #0
        jsr CIOV
        ldx sx
        ldy sy
        rts

; print the EOL-terminated string at A/Y
puts    sta ICBAL
        sty ICBAH
        lda #$09
        sta ICCOM
        lda #255
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jmp CIOV

cmd     .byte 0
stats   .byte 0
bl      .byte 0
bh      .byte 0
ll      .byte 0
lh      .byte 0
al      .byte 0
ah      .byte 0
