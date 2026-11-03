; CIO-level test of tools/afm/nhandler.inc: installs the N: handler, then through IOCB #1 reads a directory,
; reads a file, writes a file and reads it back, and does mkdir (XIO 42).  Results land at $2F00-$37FF.
; Build: mads nhtest.asm -o:nhtest.xex
        org $9000
        icl '../afm/nhandler.inc'
ICCOM = $0342
ICBAL = $0344
ICBLL = $0348
ICAX1 = $034A
ICAX2 = $034B
CIOV  = $E456
RES   = $2F00

        org $3800
main:   jsr nh_install
        php
        pla
        sta RES            ; processor status after install (carry = 0 means installed)
        ; --- directory
        ldx #<spec_dir
        ldy #>spec_dir
        lda #6
        jsr open
        sty RES+1
        lda #<$3000
        sta ICBAL+$10
        lda #>$3000
        sta ICBAL+$11
        lda #<512
        sta ICBLL+$10
        lda #>512
        sta ICBLL+$11
        lda #7
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        sty RES+2
        lda ICBLL+$10
        sta RES+3
        lda ICBLL+$11
        sta RES+4
        jsr close
        sty RES+5
        ; --- read hello.txt
        ldx #<spec_hello
        ldy #>spec_hello
        lda #4
        jsr open
        sty RES+6
        lda #<$3400
        sta ICBAL+$10
        lda #>$3400
        sta ICBAL+$11
        lda #<64
        sta ICBLL+$10
        lda #0
        sta ICBLL+$11
        lda #7
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        sty RES+7
        lda ICBLL+$10
        sta RES+8
        jsr close
        ; --- write out.txt
        ldx #<spec_out
        ldy #>spec_out
        lda #8
        jsr open
        sty RES+9
        lda #<msg
        sta ICBAL+$10
        lda #>msg
        sta ICBAL+$11
        lda #6
        sta ICBLL+$10
        lda #0
        sta ICBLL+$11
        lda #11
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        sty RES+10
        jsr close
        sty RES+11
        ; --- read it back
        ldx #<spec_out
        ldy #>spec_out
        lda #4
        jsr open
        lda #<$3600
        sta ICBAL+$10
        lda #>$3600
        sta ICBAL+$11
        lda #32
        sta ICBLL+$10
        lda #0
        sta ICBLL+$11
        lda #7
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        lda ICBLL+$10
        sta RES+12
        jsr close
        ; --- mkdir through XIO 42
        lda #<spec_mk
        sta ICBAL+$10
        lda #>spec_mk
        sta ICBAL+$11
        lda #42
        sta ICCOM+$10
        lda #0
        sta ICAX1+$10
        sta ICAX2+$10
        ldx #$10
        jsr CIOV
        sty RES+13
        ; --- open of a missing file
        ldx #<spec_miss
        ldy #>spec_miss
        lda #4
        jsr open
        sty RES+14
        lda #$AA
        sta RES+15         ; done marker
hang:   jmp hang

; open IOCB #1: X/Y = spec address, A = aux1
open:   stx ICBAL+$10
        sty ICBAL+$11
        sta ICAX1+$10
        lda #0
        sta ICAX2+$10
        lda #3
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        rts
close:  lda #12
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        rts

spec_dir:   .byte 'N:SD:/',$9B
spec_hello: .byte 'N:SD:/hello.txt',$9B
spec_out:   .byte 'N:SD:/out.txt',$9B
spec_mk:    .byte 'N:SD:/newdir',$9B
spec_miss:  .byte 'N:SD:/nope.txt',$9B
msg:        .byte 'HELLO',$9B

        run main
