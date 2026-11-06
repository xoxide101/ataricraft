; Number helpers on the 6 byte BCD (OS floating point) format: BV holds a number.
;   byte 0 = sign<<7 | (exponent + 64), exponent in base 100; bytes 1-5 = ten BCD digits (first pair is the integer pair).
; rounding and formatting work on the digits directly (exact); the OS ROM does the arithmetic.

; BV digits -> DG[1..10] (DG[0] = 0, room for a carry)
unpack
 lda #0
 sta DG
 ldx #0
 ldy #1
up1 lda BV+1,x
 pha
 lsr
 lsr
 lsr
 lsr
 sta DG,y
 iny
 pla
 and #$0F
 sta DG,y
 iny
 inx
 cpx #5
 bne up1
 rts

; BV = BV rounded to rn decimals (signed; negative = tens, hundreds). rmode 0 half away from zero, 1 truncate.
; rlost <> 0 when nonzero digits were dropped.
bround
 lda #0
 sta rlost
 lda BV+1
 bne br1
 rts
br1 jsr unpack
 lda BV
 and #$7F
 sec
 sbc #64
 sta pl
 bpl br3
 lda #$FF
 bne br4
br3 lda #0
br4 sta ph
 asl pl
 rol ph
 clc
 lda pl
 adc #2
 sta pl
 bcc br5
 inc ph
br5 lda rn
 bpl br6
 lda #$FF
 bne br7
br6 lda #0
br7 sta nh
 clc
 lda pl
 adc rn
 sta pl
 lda ph
 adc nh
 sta ph
 bmi br5z
 bne br5d
 lda pl
 cmp #10
 bcc br5ok
br5d rts
br5z jmp brz
br5ok sta t3
 tay
 iny
 lda #0
 sta ru
 lda rmode
 bne br8
 lda DG,y
 cmp #5
 bcc br8
 inc ru
br8 lda DG,y
 ora rlost
 sta rlost
 lda #0
 sta DG,y
 iny
 cpy #11
 bne br8
 lda ru
 beq brpack
 ldy t3
brc lda DG,y
 clc
 adc #1
 cmp #10
 bcc brs
 lda #0
 sta DG,y
 dey
 bpl brc
 jmp brpack
brs sta DG,y
brpack
 lda DG
 bne brcar
 ldx #0
 ldy #1
bk1 lda DG,y
 asl
 asl
 asl
 asl
 ora DG+1,y
 sta BV+1,x
 iny
 iny
 inx
 cpx #5
 bne bk1
 beq brchk
brcar sta BV+1
 ldx #1
 ldy #1
bk2 lda DG,y
 asl
 asl
 asl
 asl
 ora DG+1,y
 sta BV+1,x
 iny
 iny
 inx
 cpx #5
 bne bk2
 inc BV
brchk lda BV+1
 ora BV+2
 ora BV+3
 ora BV+4
 ora BV+5
 bne brdone
 beq brzero
brz lda #1
 sta rlost
brzero ldx #5
 lda #0
bz1 sta BV,x
 dex
 bpl bz1
brdone rts

; append A to NUMS
putn
 ldx nlen
 sta NUMS,x
 inc nlen
 rts

; BV -> NUMS text (nlen chars). nd = decimals ($FF = as many as the digits give), thou = commas, dol = '$'.
; Uses DG; scientific form when the exponent is very large or small (general) or the number has more than 12 integer digits.
numgen
 lda #0
 sta nlen
 sta t3                      ; t3 = sign flag
 lda BV+1
 bne ng0
 lda #1                      ; zero: "0"
 sta dpi
 lda #0
 sta dpih
 jsr unpack
 jmp ng2
ng0 lda BV
 bpl ng1
 inc t3
ng1 jsr unpack
 lda BV
 and #$7F
 sec
 sbc #64
 sta dpi
 bpl ng1a
 lda #$FF
 bne ng1b
ng1a lda #0
ng1b sta dpih
 asl dpi
 rol dpih
 clc
 lda dpi
 adc #2
 sta dpi
 bcc ng2
 inc dpih
ng2 lda t3
 beq ng3
 lda #'-'
 jsr putn
ng3 lda dol
 beq ng4
 lda #'$'
 jsr putn
ng4
; first nonzero digit f -> t1 (11 when none)
 ldy #1
ng5 lda DG,y
 bne ng6
 iny
 cpy #11
 bne ng5
ng6 sty t1
 cpy #11
 beq ngplain
; x10 = dpi - f (signed 16) -> pl,ph
 sec
 lda dpi
 sbc t1
 sta pl
 lda dpih
 sbc #0
 sta ph
 lda nd
 cmp #$FF
 bne ngfix
 lda ph
 bmi ngneg
 bne ngsci
 lda pl
 cmp #11
 bcs ngsci
 bcc ngplain
ngneg cmp #$FF
 bne ngsci
 lda pl
 cmp #$F9                    ; x10 < -7
 bcc ngsci
 bcs ngplain
ngfix lda dpih
 bne ngplain
 lda dpi
 cmp #13
 bcs ngsci
ngplain jmp ngp

; scientific: d[.ddd]E+xx
ngsci
 ldy t1
 lda DG,y
 clc
 adc #'0'
 jsr putn
 ldy #10                     ; last nonzero digit
ns1 lda DG,y
 bne ns2
 dey
 bne ns1
ns2 cpy t1
 beq ns4
 lda #'.'
 jsr putn
 sty t2
 ldy t1
 iny
ns3 sty t4
 lda DG,y
 clc
 adc #'0'
 jsr putn
 ldy t4
 iny
 cpy t2
 beq ns3x
 bcc ns3
ns3x
ns4 lda #'E'
 jsr putn
 lda ph
 bpl ns5
 lda #'-'
 jsr putn
 sec
 lda #0
 sbc pl
 sta pl
 jmp ns6
ns5 lda #'+'
 jsr putn
ns6 lda pl
 ldx #'0'
ns7 cmp #10
 bcc ns8
 sbc #10
 inx
 bne ns7
ns8 sta t2
 txa
 jsr putn
 lda t2
 clc
 adc #'0'
 jmp putn

; plain decimal
ngp
 lda dpih
 bmi ngp0
 bne ngp0
 lda dpi
 bne ngp1
ngp0 lda #0                  ; integer part is 0 (dpi <= 0)
 sta IDIG
 lda #1
 sta t2                      ; digits in IDIG
 jmp ngp4
ngp1 sta t2
 ldx #0
 ldy #1
ngp2 cpy #11
 bcs ngp2z
 lda DG,y
 jmp ngp2s
ngp2z lda #0
ngp2s sta IDIG,x
 inx
 iny
 cpx t2
 bne ngp2
; strip leading zeros, keep one
 ldx #0
ngp3 lda t2
 cmp #1
 beq ngp3x
 lda IDIG,x
 bne ngp3x
 inx
 dec t2
 jmp ngp3
ngp3x
 ; digits IDIG[x..x+t2) ; emit
 stx t1
 lda t2
 sta t4
ngp3e ldx t1
 lda IDIG,x
 clc
 adc #'0'
 jsr putn
 inc t1
 dec t4
 beq ngp5
 lda thou
 beq ngp3e
 lda t4
ngp3m cmp #3
 bcc ngp3n
 beq ngp3c
 sec
 sbc #3
 jmp ngp3m
ngp3n jmp ngp3e
ngp3c lda #','
 jsr putn
 jmp ngp3e
ngp4 lda IDIG
 clc
 adc #'0'
 jsr putn
ngp5
; fraction
 lda nd
 cmp #$FF
 beq ngfg
 lda nd
 bne ngfx
 jmp ngpct
ngfx lda #'.'
 jsr putn
 lda #1
 sta t1
ngf1 lda dpi
 clc
 adc t1
 sta t2
 lda dpih
 adc #0
 bmi ngf2z
 bne ngf2z
 lda t2
 beq ngf2z
 cmp #11
 bcs ngf2z
 tay
 lda DG,y
 jmp ngf2p
ngf2z lda #0
ngf2p clc
 adc #'0'
 jsr putn
 inc t1
 lda t1
 cmp nd
 bcc ngf1
 beq ngf1
 jmp ngpct
; general: up to the last nonzero digit
ngfg ldy #10
ngg1 lda DG,y
 bne ngg2
 dey
 bne ngg1
ngg2 sty t2                  ; last nonzero index (0 = none)
 lda dpih
 bmi ngg3
 bne ngpct
 lda t2
 cmp dpi
 bcc ngpct
 beq ngpct
ngg3 lda t2
 beq ngpct
 lda #'.'
 jsr putn
 lda #1
 sta t1
ngg4 lda dpi
 clc
 adc t1
 sta t4
 lda dpih
 adc #0
 bmi ngg5
 bne ngg5
 lda t4
 beq ngg5
 tay
 lda DG,y
 jmp ngg6
ngg5 lda #0
ngg6 clc
 adc #'0'
 jsr putn
 inc t1
 lda dpi
 clc
 adc t1
 sta t4
 lda dpih
 adc #0
 bmi ngg4
 bne ngpct
 lda t4
 cmp t2
 bcc ngg4
 beq ngg4
ngpct lda pct
 beq ngend
 lda #'%'
 jsr putn
ngend rts

; BV -> NUMS using the format table row in A; fits fitw characters, '#' when it cannot.
fmtnum
 tax
 lda FMND,x
 sta nd
 sta ndsv
 lda FMFL,x
 pha
 and #1
 sta thou
 pla
 pha
 lsr
 and #1
 sta pct
 pla
 lsr
 lsr
 and #1
 sta dol
 lda BV+1
 beq fn0
 lda pct
 beq fn0
 inc BV
fn0 ldx #5
fn1 lda BV,x
 sta BVS,x
 dex
 bpl fn1
 lda #0
 sta rmode
 lda ndsv
 cmp #$FF
 beq fngen
 sta rn
 jsr bround
 jsr numgen
 lda nlen
 cmp fitw
 bcc fnok
 beq fnok
fngen lda #$FF
 sta nd
 lda #15
 sta fnc
fng1 ldx #5
fng2 lda BVS,x
 sta BV,x
 dex
 bpl fng2
 lda fnc
 sta rn
 jsr bround
 jsr numgen
 lda nlen
 cmp fitw
 bcc fnok
 beq fnok
 dec fnc
 bpl fng1
 lda fitw
 sta nlen
 lda #'#'
 ldx nlen
fnh dex
 bmi fnok
 sta NUMS,x
 bpl fnh
fnok rts

; 0 General 1 0 2 0.00 3 #,##0 4 #,##0.00 5 0% 6 0.00% 7 $#,##0.00 (others show as General)
FMND dta b($FF),b(0),b(2),b(0),b(2),b(0),b(2),b(2)
 :40 dta b($FF)
FMFL dta b(0),b(0),b(0),b(1),b(1),b(2),b(2),b(5)
 :40 dta b(0)
