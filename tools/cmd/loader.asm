; loader.asm - tiny binary loader copied to page 6 so it survives a program that overwrites CMD.
; $0603 = mode: 0 = run the program (then back to DOS), 1 = load only and return (plug-ins).
; The file is already open on IOCB 1 ($10).
        icl 'lib\sys.asm'
        org $0600
        jmp ldr
lmode:  .byte 0
lbuf:   .word 0
lstart: .word 0
llen:   .word 0

rd2:    lda #<lbuf
        sta ICBAL+$10
        lda #>lbuf
        sta ICBAH+$10
        lda #2
        sta ICBLL+$10
        lda #0
        sta ICBLH+$10
        lda #7
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        tya
        rts

ldr:    lda #0
        sta RUNAD
        sta RUNAD+1
        sta INITAD
        sta INITAD+1
lseg:   jsr rd2
        bmi ldone
        lda lbuf
        and lbuf+1
        cmp #$FF
        beq lseg
        lda lbuf
        sta lstart
        lda lbuf+1
        sta lstart+1
        jsr rd2
        bmi ldone
        sec
        lda lbuf
        sbc lstart
        sta llen
        lda lbuf+1
        sbc lstart+1
        sta llen+1
        inc llen
        bne lrd
        inc llen+1
lrd:    lda lstart
        sta ICBAL+$10
        lda lstart+1
        sta ICBAH+$10
        lda llen
        sta ICBLL+$10
        lda llen+1
        sta ICBLH+$10
        lda #7
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        lda INITAD
        ora INITAD+1
        beq lseg
        jsr lcall
        lda #0
        sta INITAD
        sta INITAD+1
        beq lseg
lcall:  jmp (INITAD)
ldone:  lda #12
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        lda lmode
        bne lret
        lda RUNAD
        ora RUNAD+1
        beq ltodos
        jmp (RUNAD)
ltodos: jmp (DOSVEC)
lret:   rts
        .rept 256-(*-$0600)
        .byte 0
        .endr
