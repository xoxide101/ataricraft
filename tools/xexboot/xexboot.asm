; Boot-sector XEX loader: 3 boot sectors at $0700, binary stream starts at disk sector 4 (128-byte sectors).
; xexToAtr() patches the 24-bit stream length at $0709. Needs no DOS.
        opt h-
        org $0700
        .byte 0,3
        .word $0700,$0706
        jmp start
len     .byte 0,0,0

buf     = $0880
cnt     = $0A00
bpos    = cnt+3
secl    = cnt+4
sech    = cnt+5
lo      = cnt+6
hi      = cnt+7
elo     = cnt+8
ehi     = cnt+9
ptr     = $E0

start   cld
        lda #0
        sta cnt
        sta cnt+1
        sta cnt+2
        sta sech
        lda #4
        sta secl
        lda #128
        sta bpos

main    lda cnt
        cmp len
        lda cnt+1
        sbc len+1
        lda cnt+2
        sbc len+2
        bcs done
        jsr getb
        sta lo
        jsr getb
        sta hi
        and lo
        cmp #$ff
        beq main
        jsr getb
        sta elo
        jsr getb
        sta ehi
        lda lo
        sta ptr
        lda hi
        sta ptr+1
cp      jsr getb
        ldy #0
        sta (ptr),y
        lda ptr
        cmp elo
        bne nx
        lda ptr+1
        cmp ehi
        beq segend
nx      inc ptr
        bne cp
        inc ptr+1
        jmp cp
segend  lda lo
        cmp #$e2
        bne main
        lda hi
        cmp #2
        bne main
        lda elo
        cmp #$e3
        bne main
        jsr doinit
        jmp main

doinit  jmp ($02e2)

done    lda $02e0
        ora $02e1
        beq nrun
        jmp ($02e0)
nrun    jmp ($000a)

getb    ldx bpos
        cpx #128
        bcc gb1
        jsr rdsec
        ldx #0
gb1     lda buf,x
        inx
        stx bpos
        inc cnt
        bne gb2
        inc cnt+1
        bne gb2
        inc cnt+2
gb2     rts

rdsec   lda #$31
        sta $0300
        lda #1
        sta $0301
        lda #$52
        sta $0302
        lda #$40
        sta $0303
        lda #<buf
        sta $0304
        lda #>buf
        sta $0305
        lda #7
        sta $0306
        lda #128
        sta $0308
        lda #0
        sta $0309
        lda secl
        sta $030a
        lda sech
        sta $030b
        jsr $e459
        bmi rerr
        inc secl
        bne rok
        inc sech
rok     rts
rerr    inc $d01a
        jmp rdsec

        .ds 384-(*-$0700)
