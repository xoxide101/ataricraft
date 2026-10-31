; loader.asm - tiny binary loader copied to page 6 so it survives a program that overwrites CMD.
; $0603 = mode: 0 = run the program (then back to DOS), 1 = load only and return (plug-ins).
; The file is already open on IOCB 1 ($10).
; Built to bin\loader.bin (exactly 256 bytes, padded) and embedded in CMD by cmds\run.asm
; (copyldr copies it to $0600; entry = $0600 = jmp ldr).
; Parses the standard Atari DOS binary load format: optional $FFFF header, then segments of
; start word, end word, data. After each segment INITAD is called if the segment set it;
; at the end RUNAD is jumped to (mode 0) or the loader RTSs (mode 1). If RUNAD is 0, DOSVEC is used.
; Shared locations: lmode ($0603), lbuf = last 2-byte header word, lstart/llen = segment start/length.
        icl 'lib\sys.asm'
        org $0600
        jmp ldr
lmode:  .byte 0
lbuf:   .word 0
lstart: .word 0
llen:   .word 0

; read 2 bytes from IOCB 1 into lbuf; returns Y/N = CIO status (N set on EOF/error)
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

; main loop: clear RUNAD/INITAD, then loop over segments
ldr:    lda #0
        sta RUNAD
        sta RUNAD+1
        sta INITAD
        sta INITAD+1
lseg:   jsr rd2
        bmi ldone               ; EOF = no more segments
        lda lbuf
        and lbuf+1
        cmp #$FF                ; $FFFF header word: skip and read the real start address
        beq lseg
        lda lbuf
        sta lstart
        lda lbuf+1
        sta lstart+1
        jsr rd2
        bmi ldone
        sec                     ; length = end - start + 1
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
lcall:  jmp (INITAD)            ; JSR here = indirect call of the segment's init routine
ldone:  lda #12                 ; CIO close
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
