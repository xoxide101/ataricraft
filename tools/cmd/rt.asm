; rt.asm - RAM tester image, copied to $0500 (2 pages) by MEMTEST.
; It runs below $4000 so the $4000-$7FFF bank window can be switched under it.
; Entry points: $0500 rt_det, $0503 rt_pg, $0506 rt_adr, $0509 pb.
        icl 'lib\sys.asm'
        org $0500
B       = $0400         ; 64 bytes (cassette buffer): detection results / address-test save area
SV      = B+64          ; 64 bytes: saved bytes
        jmp rt_det
        jmp rt_pg
        jmp rt_adr
        jmp pb

; A = bank number (6 bits) -> A = PORTB value that maps that bank in at $4000.
; T1 holds the PORTB value in force before testing (only bit 0, OS ROM, is kept).
pb:     sta N2
        lda T1
        and #1
        ldy #0
pb1:    lsr N2
        bcc pb2
        ora bits,y
pb2:    iny
        cpy #6
        bne pb1
        rts
bits:   .byte $04,$08,$40,$20,$80,$02

; skip the self-test ROM window ($5000-$57FF) when bit 7 of the bank value is 0
skp:    lda T0
        bmi sk_n
        lda N1
        cmp #$50
        bcc sk_n
        cmp #$58
        bcs sk_n
        sec
        rts
sk_n:   clc
        rts

; find which of the 64 bank numbers give distinct memory at $4000.
; B[c] = c EOR $5A when bank c is its own memory. N4 <> 0 means there is no extended RAM.
rt_det: php
        sei
        lda PORTB
        sta T1
        ldx #63
d1:     txa
        jsr pb
        sta PORTB
        lda $4000
        sta SV,x
        dex
        bpl d1
        lda T1
        ora #$10
        sta PORTB
        lda $4000
        sta N3
        lda #0
        sta $4000
        ldx #0
d2:     txa
        jsr pb
        sta PORTB
        txa
        eor #$5A
        sta $4000
        inx
        cpx #64
        bne d2
        ldx #0
d3:     txa
        jsr pb
        sta PORTB
        lda $4000
        sta B,x
        inx
        cpx #64
        bne d3
        lda T1
        ora #$10
        sta PORTB
        lda $4000
        sta N4
        lda N3
        sta $4000
        ldx #63
d4:     txa
        jsr pb
        sta PORTB
        lda SV,x
        sta $4000
        dex
        bpl d4
        lda T1
        sta PORTB
        plp
        rts

; contents-preserving pattern test of pages N1..N4-1 with PORTB = T0
; carry set on error: N1:N0 = address, N2 = pattern written, N3 = value read
rt_pg:  php
        sei
        lda PORTB
        sta T1
        lda T0
        sta PORTB
        lda #0
        sta N0
pg0:    jsr skp
        bcs pgn
        ldy #0
pg2:    lda (N0),y
        sta N5
        ldx #3
pg3:    lda pat,x
        sta (N0),y
        cmp (N0),y
        bne pgbad
        dex
        bpl pg3
        lda N5
        sta (N0),y
        iny
        bne pg2
pgn:    inc N1
        lda N1
        cmp N4
        bne pg0
        lda T1
        sta PORTB
        plp
        clc
        rts
pgbad:  sta N2
        lda (N0),y
        sta N3
        lda N5
        sta (N0),y
        sty N0
        lda T1
        sta PORTB
        plp
        sec
        rts
pat:    .byte $00,$FF,$55,$AA

; address line test of the bank in T0: one signature per page, then one per
; address bit inside page $40. carry set on error: N2 = expected, N3 = read,
; T1+1 = page, T0+1 = offset
rt_adr: php
        sei
        lda PORTB
        sta T1
        lda T0
        sta PORTB
        lda #0
        sta N0
        sta T1+1
        lda #<op_s
        jsr runp
        lda #<op_w
        jsr runp
        lda #<op_v
        jsr runp
        lda #<op_r
        jsr runp
        lda #<op_s
        jsr runo
        lda #<op_w
        jsr runo
        lda #<op_v
        jsr runo
        lda #<op_r
        jsr runo
        lda T1
        sta PORTB
        plp
        lda T1+1
        bne ra_b
        clc
        rts
ra_b:   sec
        rts

runp:   sta lpj+1
        lda #$40
        sta N1
        ldx #0
        ldy #0
rp1:    jsr skp
        bcs rp2
lpj:    jsr op_s
rp2:    inc N1
        inx
        cpx #64
        bne rp1
        rts

runo:   sta lqj+1
        lda #$40
        sta N1
        ldx #0
ro1:    ldy offs,x
lqj:    jsr op_s
        inx
        cpx #8
        bne ro1
        rts
offs:   .byte 1,2,4,8,16,32,64,128

op_s:   lda (N0),y
        sta B,x
        rts
op_w:   tya
        eor N1
        sta (N0),y
        rts
op_v:   lda T1+1
        bne ov1
        tya
        eor N1
        cmp (N0),y
        beq ov1
        sta N2
        lda (N0),y
        sta N3
        lda N1
        sta T1+1
        sty T0+1
ov1:    rts
op_r:   lda B,x
        sta (N0),y
        rts

        .rept $0700-*
        .byte 0
        .endr
