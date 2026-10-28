; fn.asm - FujiNet hooks. SIO device $70 for the adapter, N: for network files (use COPY N:HTTP://... name).
; Plug-ins reach this through the API table (fnsio): fill DCOMND, DSTATS, DBUF*, DBYT*, DAUX* then call it.
fnsio:  lda #$70
        sta DDEVIC
        lda #1
        sta DUNIT
        lda #15
        sta DTIMLO
        jsr SIOV
        rts

; carry clear when an N: handler is installed
hasnet: ldx #0
hn_l:   lda HATABS,x
        beq hn_no
        cmp #'N'
        beq hn_y
        inx
        inx
        inx
        bne hn_l
hn_no:  sec
        rts
hn_y:   clc
        rts

cmd_fn: lda #$E8
        sta DCOMND
        lda #$40
        sta DSTATS
        lda #<IOBUF
        sta DBUFLO
        lda #>IOBUF
        sta DBUFHI
        lda #140
        sta DBYTLO
        lda #0
        sta DBYTHI
        sta DAUX1
        sta DAUX2
        jsr fnsio
        cpy #1
        beq fn_ok
        jsr putsi
        .byte 'NO FUJINET ON THE SIO BUS',EOL,0
        jmp fn_n
fn_ok:  jsr putsi
        .byte 'FUJINET ',0
        lda #<(IOBUF+125)
        ldx #>(IOBUF+125)
        jsr pstr
        jsr putnl
        jsr putsi
        .byte 'SSID ',0
        lda #<IOBUF
        ldx #>IOBUF
        jsr pstr
        jsr putnl
        jsr putsi
        .byte 'IP ',0
        ldy #0
fn_ip:  lda IOBUF+97,y
        sta N0
        sty N3
        lda #0
        sta N1
        jsr putdec16
        ldy N3
        iny
        cpy #4
        bcs fn_ie
        lda #'.'
        jsr putc
        jmp fn_ip
fn_ie:  jsr putnl
fn_n:   jsr hasnet
        bcs fn_nn
        jsr putsi
        .byte 'N: HANDLER PRESENT',EOL,0
        clc
        rts
fn_nn:  jsr putsi
        .byte 'NO N: HANDLER (LOAD THE FUJINET N: DRIVER)',EOL,0
        clc
        rts
