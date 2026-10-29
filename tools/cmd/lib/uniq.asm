; uniq.asm - keep the 8.3 names of one archive run unique (used by the tools whose members can have long names).
; Call right after conv83. A name whose hash was already used by an earlier member is renamed: its base is cut to
; at most 6 characters and two digits (the member's number, then the next ones if that is taken too) are added.
; The first member of a run (nfl=nfh=0) clears the table. The table holds 90 members; later ones are not tracked.
UQN     = DB+$0240              ; hashes stored
UQH0    = DB+$0241
UQH1    = DB+$0242
UQK     = DB+$0243              ; rename attempt
UQB     = DB+$0244              ; base length kept
UQD     = DB+$0245              ; digits value
UQE     = DB+$0248              ; extension copy (up to 5 + NUL)
UQT     = DB+$0250              ; table, 2 bytes per member

uniq:   lda NAMEB
        bne uq_a
        rts
uq_a:   lda nfl
        ora nfh
        bne uq_b
        sta UQN
uq_b:   lda #0
        sta UQK
uq_h:   jsr uq_hash
        ldx #0
uq_s:   cpx UQN
        bcs uq_new
        txa
        asl
        tay
        lda UQT,y
        cmp UQH0
        bne uq_n
        lda UQT+1,y
        cmp UQH1
        beq uq_dup
uq_n:   inx
        bne uq_s
uq_new: lda UQN
        cmp #90
        bcs uq_r
        asl
        tay
        lda UQH0
        sta UQT,y
        lda UQH1
        sta UQT+1,y
        inc UQN
uq_r:   rts
uq_dup: inc UQK
        lda UQK
        cmp #100
        bcs uq_r
        ; extension (from the dot) -> UQE
        ldy #0
uq_f:   lda NAMEB,y
        beq uq_nd
        cmp #'.'
        beq uq_d
        iny
        bne uq_f
uq_nd:  sty UQB
        lda #0
        sta UQE
        beq uq_c
uq_d:   sty UQB
        ldx #0
uq_x:   lda NAMEB,y
        sta UQE,x
        beq uq_c
        inx
        iny
        cpx #5
        bcc uq_x
        lda #0
        sta UQE,x
uq_c:   lda UQB
        cmp #7
        bcc uq_k
        lda #6
        sta UQB
uq_k:   ; number = member count + 1 + attempt, mod 100
        lda nfl
        clc
        adc UQK
        sta UQD
uq_m:   cmp #100
        bcc uq_t
        sec
        sbc #100
        sta UQD
        bcs uq_m
uq_t:   ldx #'0'
uq_10:  lda UQD
        cmp #10
        bcc uq_o
        sec
        sbc #10
        sta UQD
        inx
        bne uq_10
uq_o:   ldy UQB
        txa
        sta NAMEB,y
        iny
        lda UQD
        clc
        adc #'0'
        sta NAMEB,y
        iny
        ldx #0
uq_e:   lda UQE,x
        sta NAMEB,y
        bne uq_e1
        jmp uq_h
uq_e1:  inx
        iny
        bne uq_e
        jmp uq_h

uq_hash: ldy #0
        sty UQH0
        sty UQH1
uq_hl:  lda NAMEB,y
        beq uq_hd
        clc
        adc UQH0
        sta UQH0
        lda UQH1
        asl
        adc #0
        eor UQH0
        sta UQH1
        iny
        bne uq_hl
uq_hd:  rts
