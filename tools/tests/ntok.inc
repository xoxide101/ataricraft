; Shared command-line tokenizer and buffer builder for the N: sample apps ('; @tok').
; gettoks: A/Y = prompt string. Takes the line CMD.COM left at $0480 (HAND: $A5, text, EOL), or asks
; with the prompt, and splits it into up to 5 tokens at TOK + n*64 (token 4 keeps the rest of the line).
; Each token ends with $9B and unused tokens are empty. Uses zero page $80-$94; apps use $A0 and up.
tp      = $80
ip      = $81
op      = $82
tx      = $8B
bpos    = $8C
tpl     = $8D
tph     = $8E
spl     = $8F
sph     = $90
dv      = $93
pz      = $94
TOK     = $3600

gettoks sta spl
        sty sph
        lda $0480
        cmp #$A5
        bne gt_ask
        ldy #0
gt_h1   lda $0481,y
        sta LINE,y
        iny
        cmp #$9B
        bne gt_h1
        lda #$5A
        sta $0480
        jmp gt_parse
gt_ask  lda spl
        ldy sph
        jsr puts
        lda #<LINE
        ldy #>LINE
        jsr getrec
gt_parse ldx #4
gt_i1   lda tlo,x
        sta tpl
        lda thi,x
        sta tph
        lda #$9B
        ldy #0
        sta (tpl),y
        dex
        bpl gt_i1
        lda #0
        sta tp
        sta ip
gt_next ldy ip
gt_sp   lda LINE,y
        cmp #' '
        bne gt_got
        iny
        bne gt_sp
gt_got  sty ip
        cmp #$9B
        beq gt_done
        ldx tp
        cpx #5
        bcs gt_done
        lda tlo,x
        sta tpl
        lda thi,x
        sta tph
        lda #0
        sta op
gt_cp   ldy ip
        lda LINE,y
        cmp #$9B
        beq gt_end
        cmp #' '
        bne gt_st
        lda tp
        cmp #4
        bcc gt_end
        lda #' '
gt_st   ldy op
        sta (tpl),y
        inc op
        inc ip
        jmp gt_cp
gt_end  ldy op
        lda #$9B
        sta (tpl),y
        inc tp
        jmp gt_next
gt_done rts

; token X empty? Z set when it is
tokempty lda tlo,x
        sta tpl
        lda thi,x
        sta tph
        ldy #0
        lda (tpl),y
        cmp #$9B
        rts

bstart  lda #0
        sta bpos
        rts

; append the $9B-terminated string at A/Y to BUF
bapp    sta spl
        sty sph
        ldy #0
ba_1    lda (spl),y
        cmp #$9B
        beq ba_2
        ldx bpos
        sta BUF,x
        inc bpos
        iny
        bne ba_1
ba_2    rts

; append token X to BUF
appt    lda tlo,x
        ldy thi,x
        jmp bapp

; write BUF plus an EOL (the device turns it into CRLF/LF per the translation mode)
bsend   ldx bpos
        lda #$9B
        sta BUF,x
        inx
        txa
        jmp nwrite

; copy BUF (bpos bytes) plus a $9B to SPEC
mkspec  ldx bpos
        lda #$9B
        sta BUF,x
        inx
        stx tx
        ldx #0
ms_1    lda BUF,x
        sta SPEC,x
        inx
        cpx tx
        bne ms_1
        rts

; print A as a decimal number without leading zeros
pdec    sta dv
        lda #0
        sta pz
        ldx #100
        jsr pd_dig
        ldx #10
        jsr pd_dig
        lda dv
        ora #'0'
        jmp putc
pd_dig  ldy #0
pd_1    lda dv
        stx tx
        cmp tx
        bcc pd_2
        sbc tx
        sta dv
        iny
        bne pd_1
pd_2    tya
        ora pz
        beq pd_3
        lda #1
        sta pz
        tya
        ora #'0'
        jsr putc
pd_3    rts

; read everything the device has (until status shows no data) and print it
rdall   jsr nstat
        cpy #1
        bne rd_q
        lda STAT
        ora STAT+1
        beq rd_q
        jsr nread
        jsr pbuf
        jmp rdall
rd_q    rts

tlo     .byte 0,64,128,192,0
thi     .byte $36,$36,$36,$36,$37
