; dos.asm - which DOS is running and what it can do.
; V_DOS: 0 = DOS 2.0/2.5, 1 = MyDOS, 2 = SpartaDOS (X), 3 = other (BW-DOS ...)
dosdet: ldx #3
        lda $0700
        cmp #'M'
        bne dd_a1
        ldx #1
        bne dd_go
dd_a1:  cmp #'S'
        bne dd_a2
        lda $0701
        cmp #'D'
        bne dd_a2
        ldx #2
        bne dd_go
dd_a2:  lda $0B
        cmp #$17
        bne dd_go
        ldx #0
dd_go:  stx V_DOS
        rts

; carry clear when this DOS has folders
hasdirs:
        lda V_DOS
        beq hd_no
        clc
        rts
hd_no:  sec
        rts

; print the DOS name
putdosname:
        ldx V_DOS
        bne pdn_1
        jsr putsi
        .byte 'ATARI DOS 2.0/2.5',0
        rts
pdn_1:  cpx #1
        bne pdn_2
        jsr putsi
        .byte 'MYDOS',0
        rts
pdn_2:  cpx #2
        bne pdn_3
        jsr putsi
        .byte 'SPARTADOS',0
        rts
pdn_3:  jsr putsi
        .byte 'OTHER DOS (BW-DOS ...)',0
        rts
