; calc.asm - CALC.COM, a command line calculator for any Atari DOS.
; Type a sum and press Return:  2+3*4   (1+2)^3   SQR(16)   -2^2   ANS/7
; + - * / ^ and ( ) work, with the usual order.  ANS = last answer, PI, SQR LN LOG EXP ABS.
; Empty line or Q gives back the DOS.  Uses the OS floating point ROM (about 9 digits).
;
; Structure: main loop reads a line with CIO get-record into ibuf, then a recursive-descent
;   parser (expr/term/pow/unary/prim) evaluates it directly with the OS floating point ROM.
;   Each binary operator: left result is pushed on a software stack (stk, 6 bytes per FP
;   number, max 15 deep), the right operand is parsed, swp restores left into FR0 and right
;   into FR1, and the FP routine is called. FP routines return carry set on error.
; FP numbers are 6-byte BCD floats. ROM entry points are listed below (FR0=$D4 and FR1=$E0
;   are the OS floating point registers; INBUFF/CIX are the text input pointer/index for AFP).
; Variables: ip = parse index into ibuf, sph = stack height in bytes, err = error code
;   (1 FP error/overflow, 2 syntax/unknown name, 3 math domain, 4 trailing junk), idx/nn =
;   temporaries. FP storage: ans (last answer), sa/sx (sqrt), pb/pe/rs (power), pic (PI), half.
        icl 'lib\sys.asm'

AFP     = $D800         ; ASCII at (INBUFF)+CIX -> FR0
FASC    = $D8E6         ; FR0 -> ASCII at (INBUFF), last char has bit 7 set
IFP     = $D9AA         ; 16-bit integer in FR0/FR0+1 -> FP
FPI     = $D9D2         ; FP in FR0 -> integer in FR0/FR0+1
FSUB    = $DA60         ; FR0 = FR0 - FR1
FADD    = $DA66         ; FR0 = FR0 + FR1
FMUL    = $DADB         ; FR0 = FR0 * FR1
FDIV    = $DB28         ; FR0 = FR0 / FR1
FLD0R   = $DD89         ; load FR0 from address X(lo)/Y(hi)
FLD1R   = $DD98         ; load FR1 from address X/Y
FST0R   = $DDA7         ; store FR0 to address X/Y
FMOVE   = $DDB6         ; FR1 = FR0
EXPF    = $DDC0         ; FR0 = e^FR0
LOGF    = $DECD         ; FR0 = ln(FR0)
LOG10F  = $DED1         ; FR0 = log10(FR0)
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

; Startup: print banner (inline string), clear ANS to 0. main: prompt, read a line (IOCB 0,
;   command 5, max 62 chars), skip leading blanks and any '>' (allows pasting prompts),
;   quit on EOL or Q, else parse; leftover text after the expression is error 4.
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
; Each routine leaves its value in FR0 and sets err on failure. They use peek to look at
;   the next non-blank character. '^' is right-associative; unary minus binds looser than
;   '^' (so -2^2 = -4). Clobbers A,X,Y, FR0/FR1.
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
        beq un9                 ; zero stays +0
        eor #$80                ; flip FP sign bit
        sta FR0
un9     rts

; prim: '(' expr ')' | number (AFP parses at ibuf+CIX) | name (word). Errors -> err=2.
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
; word: collect up to 8 letters into wbuf (zero terminated), look it up in ftab (list of
;   zero-terminated names, end marked by an extra 0); the match index idx selects the action:
;   0 ANS, 1 PI (constants), 2 SQR, 3 LN, 4 LOG, 5 EXP, 6 ABS (functions need "(" expr ")").
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
        and #$7F                ; ABS: clear the sign bit
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

; square root: LN guess, then three Newton steps  (x = EXP(LN(a)/2); x = (a/x + x)/2, x3)
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
;   (so a negative base with a non-whole exponent is error 3). A zero exponent gives 1, a
;   zero base gives 0. Whole-number test: FPI then IFP round trip must equal |exponent|.
;   A negative whole exponent is computed as 1/(base^|y|).
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
; chk: after an FP call, carry set -> err=1 (overflow / domain).
chk     bcc ck9
        lda #1
        sta err
ck9     rts

; peek: skip blanks at ip, return next char in A (not consumed). fold: upper-case A.
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

; push: save FR0 (6 bytes) on the software stack stk; stack full (>=90 bytes) -> err=1.
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

; print FR0 and keep it as ANS. FASC leaves the text at (INBUFF) with bit 7 set on the last
;   character; it is copied to obuf (bit stripped) and a trailing '.' (integer result) dropped.
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

; putc: print char A via CIO put-char (command 11, length 0) on IOCB 0.
putc    ldx #0
        stx ICBLL
        stx ICBLH
        ldx #11
        stx ICCOM
        ldx #0
        jmp CIOV

; putsi: print the zero-terminated string stored right after the JSR, then resume after it
;   (pops the return address, walks the string, pushes the address of its final 0).
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

; Data. pic = PI and half = 0.5 as 6-byte BCD floats (exponent byte $40 = 100^0, $3F = 100^-1;
;   mantissa as BCD digit pairs: 03.14159265 and 50 x 100^-1).
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
