; calc.asm - CALC.COM, a command line calculator for any Atari DOS.
; Type a sum and press Return:  2+3*4   (1+2)^3   SQR(16)   -2^2   ANS/7
; + - * / ^ and ( ) work, with the usual order.  ANS = last answer, PI, SQR LN LOG EXP ABS.
; Empty line or Q gives back the DOS.  Uses the OS floating point ROM (about 9 digits).
        icl 'lib\sys.asm'

AFP     = $D800
FASC    = $D8E6
IFP     = $D9AA
FPI     = $D9D2
FSUB    = $DA60
FADD    = $DA66
FMUL    = $DADB
FDIV    = $DB28
FLD0R   = $DD89
FLD1R   = $DD98
FST0R   = $DDA7
FMOVE   = $DDB6
EXPF    = $DDC0
LOGF    = $DECD
LOG10F  = $DED1
FR0     = $D4
FR1     = $E0
CIX     = $F2
INBUFF  = $F3

ip      = $80
sph     = $81
err     = $82
idx     = $83
nn      = $84
sptr    = $86

        org CODE
start   jsr putsi
        .byte 'CALC  type a sum, Return = answer',EOL
        .byte 'ops + - * / ^ ( )   ANS PI',EOL
        .byte 'SQR LN LOG EXP ABS   Q or empty = quit',EOL,0
        ldx #5
        lda #0
st1     sta ans,x
        dex
        bpl st1

main    jsr putsi
        .byte '> ',0
        ldx #0
        lda #<ibuf
        sta ICBAL
        lda #>ibuf
        sta ICBAH
        lda #5
        sta ICCOM
        lda #62
        sta ICBLL
        lda #0
        sta ICBLH
        jsr CIOV
        lda #0
        sta sph
        sta err
        ldy #0
sk1     lda ibuf,y
        cmp #'>'
        beq sk2
        cmp #' '
        bne sk3
sk2     iny
        bne sk1
sk3     sty ip
        lda ibuf,y
        cmp #EOL
        beq quit
        jsr fold
        cmp #'Q'
        beq quit
        jsr expr
        jsr peek
        cmp #EOL
        beq ev2
        lda #4
        sta err
ev2     lda err
        bne bad
        jsr show
        jmp main
bad     jsr putsi
        .byte 'Error',EOL,0
        jmp main
quit    jmp (DOSVEC)

; ---- parser: expr = term {+|- term}, term = pow {*|/ pow}, pow = unary [^ pow] ----
expr    jsr term
ex1     jsr peek
        cmp #'+'
        beq exa
        cmp #'-'
        beq exs
        rts
exa     inc ip
        jsr push
        jsr term
        jsr swp
        jsr FADD
        jsr chk
        jmp ex1
exs     inc ip
        jsr push
        jsr term
        jsr swp
        jsr FSUB
        jsr chk
        jmp ex1

term    jsr pow
tm1     jsr peek
        cmp #'*'
        beq tma
        cmp #'/'
        beq tmd
        rts
tma     inc ip
        jsr push
        jsr pow
        jsr swp
        jsr FMUL
        jsr chk
        jmp tm1
tmd     inc ip
        jsr push
        jsr pow
        jsr swp
        jsr FDIV
        jsr chk
        jmp tm1

pow     jsr unary
        jsr peek
        cmp #'^'
        bne pw9
        inc ip
        jsr push
        jsr pow
        jsr swp
        jmp dopow
pw9     rts

unary   jsr peek
        cmp #'-'
        beq un1
        cmp #'+'
        bne prim
        inc ip
        jmp pow
un1     inc ip
        jsr pow
        lda FR0
        beq un9
        eor #$80
        sta FR0
un9     rts

prim    jsr peek
        cmp #'('
        bne pm1
        inc ip
        jsr expr
        jsr peek
        cmp #')'
        bne pmerr
        inc ip
        rts
pmerr   lda #2
        sta err
        rts
pm1     cmp #'.'
        beq num
        cmp #'0'
        bcc pm2
        cmp #'9'+1
        bcc num
pm2     jsr fold
        cmp #'A'
        bcc pmerr
        cmp #'Z'+1
        bcs pmerr
        jmp word
num     lda #<ibuf
        sta INBUFF
        lda #>ibuf
        sta INBUFF+1
        lda ip
        sta CIX
        jsr AFP
        bcs pmerr
        lda CIX
        sta ip
        rts

; name: ANS PI SQR LN LOG EXP ABS
word    ldx #0
        ldy ip
wd1     lda ibuf,y
        jsr fold
        cmp #'A'
        bcc wd2
        cmp #'Z'+1
        bcs wd2
        sta wbuf,x
        inx
        iny
        cpx #8
        bcc wd1
wd2     lda #0
        sta wbuf,x
        sty ip
        lda #0
        sta idx
        tay
mt0     ldx #0
mt1     lda ftab,y
        cmp wbuf,x
        bne mt3
        cmp #0
        beq matched
        iny
        inx
        bne mt1
mt3     lda ftab,y
        beq mt5
        iny
        bne mt3
mt5     iny
        lda ftab,y
        beq nomatch
        inc idx
        jmp mt0
nomatch lda #2
        sta err
        rts
matched lda idx
        bne m1
        ldx #<ans
        ldy #>ans
        jmp FLD0R
m1      cmp #1
        bne m2
        ldx #<pic
        ldy #>pic
        jmp FLD0R
m2      pha
        jsr peek
        cmp #'('
        bne arge
        inc ip
        jsr expr
        jsr peek
        cmp #')'
        bne arge
        inc ip
        pla
        cmp #2
        beq fsqr
        cmp #3
        beq fln
        cmp #4
        beq flg
        cmp #5
        beq fex
        lda FR0
        and #$7F
        sta FR0
        rts
arge    pla
        lda #2
        sta err
        rts
fln     jsr LOGF
        jmp chk
flg     jsr LOG10F
        jmp chk
fex     jsr EXPF
        jmp chk

; square root: LN guess, then three Newton steps
fsqr    lda FR0
        beq sq9
        bmi sqerr
        ldx #<sa
        ldy #>sa
        jsr FST0R
        jsr LOGF
        bcs sqerr
        ldx #<half
        ldy #>half
        jsr FLD1R
        jsr FMUL
        jsr EXPF
        bcs sqerr
        lda #3
        sta nn
sq1     ldx #<sx
        ldy #>sx
        jsr FST0R
        ldx #<sa
        ldy #>sa
        jsr FLD0R
        ldx #<sx
        ldy #>sx
        jsr FLD1R
        jsr FDIV
        ldx #<sx
        ldy #>sx
        jsr FLD1R
        jsr FADD
        ldx #<half
        ldy #>half
        jsr FLD1R
        jsr FMUL
        dec nn
        bne sq1
sq9     rts
sqerr   lda #3
        sta err
        rts

; FR0 = base, FR1 = exponent.  Whole exponents up to 255 multiply out, others use EXP(y*LN x)
dopow   ldx #<pb
        ldy #>pb
        jsr FST0R
        ldy #5
dp0     lda FR1,y
        sta pe,y
        dey
        bpl dp0
        lda pe
        bne dp1
        jmp one
dp1     lda pb
        bne dp2
        rts
dp2     ldy #5
dp2a    lda pe,y
        sta FR0,y
        dey
        bpl dp2a
        lda FR0
        and #$7F
        sta FR0
        jsr FPI
        bcs dpfrac
        lda FR0+1
        bne dpfrac
        lda FR0
        sta nn
        jsr IFP
        lda pe
        and #$7F
        cmp FR0
        bne dpfrac
        ldy #5
dc1     lda pe,y
        cmp FR0,y
        bne dpfrac
        dey
        bne dc1
        jsr one
        ldx #<rs
        ldy #>rs
        jsr FST0R
dp3     ldx #<rs
        ldy #>rs
        jsr FLD0R
        ldx #<pb
        ldy #>pb
        jsr FLD1R
        jsr FMUL
        bcs dperr
        ldx #<rs
        ldy #>rs
        jsr FST0R
        dec nn
        bne dp3
        lda pe
        bpl dp4
        jsr FMOVE
        jsr one
        jsr FDIV
        jmp chk
dp4     rts
dpfrac  lda pb
        bmi dperr
        ldx #<pb
        ldy #>pb
        jsr FLD0R
        jsr LOGF
        bcs dperr
        ldx #<pe
        ldy #>pe
        jsr FLD1R
        jsr FMUL
        bcs dperr
        jsr EXPF
        jmp chk
dperr   lda #3
        sta err
        rts
one     lda #1
        sta FR0
        lda #0
        sta FR0+1
        jmp IFP

; ---- helpers ----
chk     bcc ck9
        lda #1
        sta err
ck9     rts

peek    ldy ip
pk1     lda ibuf,y
        cmp #' '
        bne pk2
        iny
        bne pk1
pk2     sty ip
        rts

fold    cmp #'a'
        bcc fo9
        cmp #'z'+1
        bcs fo9
        and #$DF
fo9     rts

push    ldx sph
        cpx #90
        bcc ph1
        lda #1
        sta err
        rts
ph1     ldy #0
ph2     lda FR0,y
        sta stk,x
        inx
        iny
        cpy #6
        bcc ph2
        stx sph
        rts

; FR1 = right (FR0), FR0 = left (popped)
swp     jsr FMOVE
        ldx sph
        beq sw9
        txa
        sec
        sbc #6
        tax
        stx sph
        ldy #0
sw1     lda stk,x
        sta FR0,y
        inx
        iny
        cpy #6
        bcc sw1
sw9     rts

; print FR0 and keep it as ANS
show    ldx #<ans
        ldy #>ans
        jsr FST0R
        jsr FASC
        ldy #0
sh1     lda (INBUFF),y
        pha
        and #$7F
        sta obuf,y
        pla
        bmi sh2
        iny
        cpy #20
        bcc sh1
sh2     lda obuf,y
        cmp #'.'
        bne sh3
        dey
sh3     sty nn
        lda #'='
        jsr putc
        lda #' '
        jsr putc
        ldy #0
sh4     sty idx
        lda obuf,y
        jsr putc
        ldy idx
        cpy nn
        beq sh5
        iny
        bne sh4
sh5     lda #EOL
        jmp putc

putc    ldx #0
        stx ICBLL
        stx ICBLH
        ldx #11
        stx ICCOM
        ldx #0
        jmp CIOV

putsi   pla
        sta sptr
        pla
        sta sptr+1
        ldy #0
pi1     inc sptr
        bne pi2
        inc sptr+1
pi2     lda (sptr),y
        beq pi3
        jsr putc
        ldy #0
        jmp pi1
pi3     lda sptr+1
        pha
        lda sptr
        pha
        rts

ftab    .byte 'ANS',0,'PI',0,'SQR',0,'LN',0,'LOG',0,'EXP',0,'ABS',0,0
pic     .byte $40,$03,$14,$15,$92,$65
half    .byte $3F,$50,0,0,0,0
ans     .ds 6
sa      .ds 6
sx      .ds 6
pb      .ds 6
pe      .ds 6
rs      .ds 6
stk     .ds 96
wbuf    .ds 10
obuf    .ds 24
ibuf    .ds 64
        run start
