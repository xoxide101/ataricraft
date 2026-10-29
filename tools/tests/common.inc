; Shared equates and helpers for the Ataricraft test programs (MADS). Text goes straight to GR.0 screen RAM.
CIOV    = $E456
ICCOM   = $0342
ICBAL   = $0344
ICBAH   = $0345
ICBLL   = $0348
ICBLH   = $0349
ICAX1   = $034A
ICAX2   = $034B
SAVMSC  = $58
RAMTOP  = $6A
ATRACT  = $4D
RTCLOK  = $12
CH      = $02FC
CRSINH  = $02F0
KEYDEF  = $79
NMIEN   = $D40E
WSYNC   = $D40A
CONSOL  = $D01F
TRIG0   = $D010
PALNTS  = $D014
PORTA   = $D300
PORTB   = $D301
POT0    = $D200
ALLPOT  = $D208
POTGO   = $D20B
RANDOM  = $D20A
KBCODE  = $D209
SKSTAT  = $D20F
IRQST   = $D20E

sp      = $80           ; screen write pointer
sa      = $82           ; string pointer
si      = $84           ; string index
v16     = $86           ; 16-bit value for putdec
t1      = $88
t2      = $89
t3      = $8A
t4      = $8B

; A = ATASCII char to the E: device (clear screen = $7D)
eput    tax
        lda #11
        sta ICCOM
        lda #0
        sta ICBLL
        sta ICBLH
        txa
        ldx #0
        jmp CIOV

; X = column, Y = row -> sp
locate  lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        cpy #0
        beq loc2
loc1    clc
        lda sp
        adc #40
        sta sp
        bcc loc3
        inc sp+1
loc3    dey
        bne loc1
loc2    txa
        clc
        adc sp
        sta sp
        bcc loc4
        inc sp+1
loc4    rts

; A = ATASCII -> screen code written at sp, sp advances
putc    cmp #$20
        bcs pc1
        clc
        adc #$40
        bne pc3
pc1     cmp #$60
        bcs pc3
        sec
        sbc #$20
pc3     ldy #0
        sta (sp),y
        inc sp
        bne pc4
        inc sp+1
pc4     rts

; A/Y = address of a zero-terminated string
puts    sta sa
        sty sa+1
        lda #0
        sta si
ps1     ldy si
        lda (sa),y
        beq ps2
        jsr putc
        inc si
        bne ps1
ps2     rts

puthex  pha
        lsr
        lsr
        lsr
        lsr
        jsr hexd
        pla
        and #$0F
hexd    tax
        lda hextab,x
        jmp putc
hextab  .byte '0123456789ABCDEF'

; v16 -> decimal, leading zeros suppressed
putdec  lda #0
        sta t3
        ldx #0
pd1     lda #'0'
        sta t1
pd2     lda v16
        cmp declo,x
        lda v16+1
        sbc dechi,x
        bcc pd3
        lda v16
        sbc declo,x
        sta v16
        lda v16+1
        sbc dechi,x
        sta v16+1
        inc t1
        bne pd2
pd3     lda t1
        cmp #'0'
        bne pd4
        cpx #4
        beq pd4
        lda t3
        beq pd5
pd4     lda #1
        sta t3
        lda t1
        jsr putc
pd5     inx
        cpx #5
        bne pd1
        rts
declo   .byte <10000,<1000,<100,<10,1
dechi   .byte >10000,>1000,>100,>10,0

; wait for the next frame
vsync   lda RTCLOK+2
vs1     cmp RTCLOK+2
        beq vs1
        rts

; wait for a key; returns the CH code in A (and clears it)
getkey  lda #$FF
        sta CH
gk1     lda #0
        sta ATRACT
        lda CH
        cmp #$FF
        beq gk1
        pha
        lda #$FF
        sta CH
        pla
        rts
