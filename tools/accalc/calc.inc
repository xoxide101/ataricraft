; Formula evaluator and recalculation. Numbers are the 6 byte OS floating point (BCD) format.
; Value stack entries (8 bytes at VSTK + offset): byte 0 type, bytes 1.. payload
;   0 blank, 1 number (6 bytes), 2 string (heap pointer), 4 error (code in byte 1), 5 bool (byte 1), 6 reference/range (r1,c1,r2,c2)
; Excel precedence: comparison < + - < * / < ^ (left to right) < unary minus < %.

K1   dta b($40),b($01),b(0),b(0),b(0),b(0)
K100 dta b($41),b($01),b(0),b(0),b(0),b(0)
K10  dta b($40),b($10),b(0),b(0),b(0),b(0)
KHF  dta b($3F),b($50),b(0),b(0),b(0),b(0)

FTAB
 dta c'SUM',b(0,1)
 dta c'AVERAGE',b(0,2)
 dta c'MIN',b(0,3)
 dta c'MAX',b(0,4)
 dta c'COUNT',b(0,5)
 dta c'PRODUCT',b(0,6)
 dta c'ABS',b(0,7)
 dta c'INT',b(0,8)
 dta c'SQRT',b(0,9)
 dta c'ROUND',b(0,10)
 dta c'MOD',b(0,11)
 dta c'IF',b(0,12)
 dta c'AND',b(0,13)
 dta c'OR',b(0,14)
 dta c'NOT',b(0,15)
 dta b(0)

; hard parse error: unwind to calccell and give #PARSE!
perr
 ldx evsp
 txs
 lda #8
 jsr seterr0
 jmp cfin

seterr0
 sta VSTK+1
 lda #4
 sta VSTK
 lda #8
 sta vsp
 rts

vpush
 lda vsp
 clc
 adc #8
 cmp #$80
 bcs perr
 sta vsp
 rts

nextc
 ldx pp
nc1 lda FBUF,x
 cmp #32
 bne nc2
 inx
 bne nc1
nc2 stx pp
 cmp #0
 rts

; X = entry offset: FR0 / FR1 <- number of the entry
vld0
 inx
 ldy #>VSTK
 jmp FLD0R
vld1
 inx
 ldy #>VSTK
 jmp FLD1R

; FR0 -> entry at offset X (type number)
st0
 lda #1
 sta VSTK,x
 inx
 ldy #>VSTK
 jmp FST0R

; entry X (number) -> BV / BV -> entry X
e2bv
 ldy #0
e2b1 lda VSTK+1,x
 sta BV,y
 inx
 iny
 cpy #6
 bne e2b1
 rts
bv2e
 lda #1
 sta VSTK,x
 ldy #0
b2e1 lda BV,y
 sta VSTK+1,x
 inx
 iny
 cpy #6
 bne b2e1
 rts

; error in entry X
puterr
 sta VSTK+1,x
 lda #4
 sta VSTK,x
 rts

; replace the reference at X by the cell value
derefx
 stx dxs
 lda VSTK+1,x
 sta qr
 lda VSTK+2,x
 sta qc
 jsr rdrec
 ldx dxs
 lda RECB+1
 sta VSTK,x
 ldy #0
dvr1 lda RECB+4,y
 sta VSTK+1,x
 inx
 iny
 cpy #6
 bne dvr1
 ldx dxs
 rts

; make entry X a number (type 1) or an error (type 4); carry set when it is an error
getnumv
 lda VSTK,x
 cmp #6
 bne gn1
 jsr derefx
 lda VSTK,x
gn1 cmp #1
 beq gnok
 cmp #4
 beq gnerr
 cmp #0
 beq gnblank
 cmp #5
 beq gnbool
 lda #1
 jsr puterr
 sec
 rts
gnblank lda #1
 sta VSTK,x
gnok clc
 rts
gnerr sec
 rts
gnbool lda VSTK+1,x
 pha
 lda #1
 sta VSTK,x
 lda #0
 sta VSTK+1,x
 sta VSTK+2,x
 pla
 beq gnok
 lda #$40
 sta VSTK+1,x
 lda #1
 sta VSTK+2,x
 clc
 rts

; both operands (vsp-16, vsp-8) numeric. carry set: result (an error) is in the first slot and vsp was reduced.
prep2
 ldx vsp
 txa
 sec
 sbc #16
 tax
 jsr getnumv
 bcs pe1
 ldx vsp
 txa
 sec
 sbc #8
 tax
 jsr getnumv
 bcc pe2
 ; b is an error: copy to a
 lda VSTK+1,x
 pha
 txa
 sec
 sbc #8
 tax
 pla
 jsr puterr
pe1 lda vsp
 sec
 sbc #8
 sta vsp
 sec
 rts
pe2 clc
 rts

; A = operator, operands on the stack
binop
 sta opc
 jsr prep2
 bcc bo0
 rts
bo0 lda vsp
 sec
 sbc #8
 sta vsp
 sec
 sbc #8
 sta t3                       ; offset of a
 lda opc
 cmp #'^'
 bne bo1
 jmp dopow
bo1 ldx t3
 jsr vld0
 ldx vsp
 jsr vld1
 lda opc
 cmp #'+'
 bne bo2
 jsr FADD
 jmp bofin
bo2 cmp #'-'
 bne bo3
 jsr FSUB
 jmp bofin
bo3 cmp #'*'
 bne bo4
 jsr FMUL
 jmp bofin
bo4 lda FR1+1
 bne bo5
 lda #0
 ldx t3
 jmp puterr
bo5 jsr FDIV
bofin bcc bof2
 lda #4
 ldx t3
 jmp puterr
bof2 ldx t3
 jmp st0

; a ^ b : integer exponents by squaring, others through LOG10/EXP10
dopow
 ldx vsp
 jsr e2bv
 lda BV
 and #$80
 sta neg
 lda BV
 and #$7F
 sta BV
 ldx #5
dp0 lda BV,x
 sta TB,x
 dex
 bpl dp0
 lda #0
 sta rn
 lda #1
 sta rmode
 lda t3
 pha
 jsr bround
 pla
 sta t3
 lda rlost
 beq dpint
 jmp dpfrac
dpint
 ldx #<BV
 ldy #>BV
 jsr FLD0R
 jsr FPI
 bcc dpi1
 lda #4
 ldx t3
 jmp puterr
dpi1 lda FR0
 sta pwn
 lda FR0+1
 sta pwn+1
 ldx t3
 jsr e2bv
 ldx #5
dp1 lda BV,x
 sta TA,x
 dex
 bpl dp1
 ldx #5
dp2 lda K1,x
 sta TB,x
 dex
 bpl dp2
dpl lda pwn
 ora pwn+1
 beq dpend
 lda pwn
 and #1
 beq dpsq
 ldx #<TB
 ldy #>TB
 jsr FLD0R
 ldx #<TA
 ldy #>TA
 jsr FLD1R
 jsr FMUL
 bcs dperr
 ldx #<TB
 ldy #>TB
 jsr FST0R
dpsq lsr pwn+1
 ror pwn
 lda pwn
 ora pwn+1
 beq dpend
 ldx #<TA
 ldy #>TA
 jsr FLD0R
 ldx #<TA
 ldy #>TA
 jsr FLD1R
 jsr FMUL
 bcs dperr
 ldx #<TA
 ldy #>TA
 jsr FST0R
 jmp dpl
dperr lda #4
 ldx t3
 jmp puterr
dpend ldx #<TB
 ldy #>TB
 jsr FLD0R
 lda neg
 beq dpout
 lda FR0+1
 bne dpinv
 lda #0
 ldx t3
 jmp puterr
dpinv jsr FMOVE
 ldx #<K1
 ldy #>K1
 jsr FLD0R
 jsr FDIV
 bcs dperr
dpout ldx t3
 jmp st0
dpfrac
 ; non-integer exponent: base must be positive
 ldx t3
 jsr e2bv
 lda BV+1
 bne dpf1
 lda neg
 bne dpz1
 ldx t3                      ; 0 ^ positive = 0
 lda #1
 sta VSTK,x
 lda #0
 sta VSTK+1,x
 sta VSTK+2,x
 rts
dpz1 lda #0
 ldx t3
 jmp puterr
dpf1 lda BV
 bpl dpf2
 lda #4
 ldx t3
 jmp puterr
dpf2 ldx #<BV
 ldy #>BV
 jsr FLD0R
 jsr LOG10
 bcs dperr
 ldx #<TB
 ldy #>TB
 jsr FLD1R
 lda neg
 beq dpf3
 lda FR1
 ora #$80
 sta FR1
dpf3 jsr FMUL
 bcs dpe2
 jsr EXP10
 bcs dpe2
 ldx t3
 jmp st0
dpe2 jmp dperr

; comparison: operator in cmpop
docmp
 jsr prep2
 bcc dc0
 rts
dc0 lda vsp
 sec
 sbc #8
 sta vsp
 sec
 sbc #8
 sta t3
 tax
 jsr vld0
 ldx vsp
 jsr vld1
 jsr FSUB
 ldx t3
 lda #5
 sta VSTK,x
 ; t1 = 0 equal, 1 greater, 2 less
 lda FR0+1
 bne dcc1
 ldy #0
 beq dc3
dcc1 lda FR0
 bmi dc2
 ldy #1
 bne dc3
dc2 ldy #2
dc3 lda cmpop
 cmp #1
 bne dq2
 cpy #0
 beq dqt
 bne dqf
dq2 cmp #2
 bne dq3
 cpy #1
 beq dqt
 bne dqf
dq3 cmp #3
 bne dq4
 cpy #2
 beq dqt
 bne dqf
dq4 cmp #4
 bne dq5
 cpy #1
 bne dqt
 beq dqf
dq5 cmp #5
 bne dq6
 cpy #2
 bne dqt
 beq dqf
dq6 cpy #0
 bne dqt
dqf lda #0
 beq dqs
dqt lda #1
dqs ldx t3
 sta VSTK+1,x
 rts

; ---- grammar
fexpr
 jsr gadd
fqc jsr nextc
 ldy #1
 cmp #'='
 beq fq9
 cmp #'>'
 bne fq1
 inc pp
 ldx pp
 lda FBUF,x
 cmp #'='
 bne fq0
 inc pp
 ldy #5
 bne fq8
fq0 ldy #2
 bne fq8
fq1 cmp #'<'
 bne fqend
 inc pp
 ldx pp
 lda FBUF,x
 cmp #'>'
 bne fq2
 inc pp
 ldy #6
 bne fq8
fq2 cmp #'='
 bne fq3
 inc pp
 ldy #4
 bne fq8
fq3 ldy #3
 bne fq8
fq9 inc pp
fq8 tya
 pha
 jsr gadd
 pla
 sta cmpop
 jsr docmp
 jmp fqc
fqend rts

gadd
 jsr gmul
fa1 jsr nextc
 cmp #'+'
 beq fa2
 cmp #'-'
 bne fa9
fa2 inc pp
 pha
 jsr gmul
 pla
 jsr binop
 jmp fa1
fa9 rts

gmul
 jsr fpow
fm1 jsr nextc
 cmp #'*'
 beq fm2
 cmp #'/'
 bne fm9
fm2 inc pp
 pha
 jsr fpow
 pla
 jsr binop
 jmp fm1
fm9 rts

fpow
 jsr funary
fp1 jsr nextc
 cmp #'^'
 bne fp9
 inc pp
 jsr funary
 lda #'^'
 jsr binop
 jmp fp1
fp9 rts

funary
 jsr nextc
 cmp #'-'
 bne fu1
 inc pp
 jsr funary
 ldx vsp
 txa
 sec
 sbc #8
 tax
 jsr getnumv
 bcs fu9
 lda VSTK+2,x
 beq fu9
 lda VSTK+1,x
 eor #$80
 sta VSTK+1,x
fu9 rts
fu1 cmp #'+'
 bne fu2
 inc pp
 jmp funary
fu2 jsr fprim
fpc jsr nextc
 cmp #'%'
 bne fpc9
 inc pp
 ldx vsp
 txa
 sec
 sbc #8
 tax
 jsr getnumv
 bcs fpc9
 stx t3
 jsr vld0
 ldx #<K100
 ldy #>K100
 jsr FLD1R
 jsr FDIV
 ldx t3
 jsr st0
 jmp fpc
fpc9 rts

; read a cell reference at pp (letters A-P, digits); returns qr, qc; carry set when not a reference
rdref
 ldx pp
 lda FBUF,x
 cmp #'$'
 bne rf_a
 inx
 lda FBUF,x
rf_a sec
 sbc #'A'
 cmp #NCOLS
 bcs rf_bad
 sta qc
 inx
 lda FBUF,x
 cmp #'$'
 bne rf_b
 inx
rf_b lda #0
 sta t1
 sta t2
 ldy #0
rf_c lda FBUF,x
 sec
 sbc #'0'
 cmp #10
 bcs rf_d
 sta t4
 ; t1:t2 = t1:t2 * 10 + digit (row <= 255 enough, check later)
 lda t1
 asl
 sta t3
 asl
 asl
 clc
 adc t3
 bcs rf_bad
 adc t4
 bcs rf_bad
 sta t1
 inx
 iny
 jmp rf_c
rf_d cpy #0
 beq rf_bad
 stx pp
 lda t1
 beq rf_bad
 sec
 sbc #1
 cmp #NROWS
 bcs rf_bad
 sta qr
 clc
 rts
rf_bad sec
 rts

fprim
 jsr nextc
 bne fpr0
 jmp perr
fpr0 cmp #'('
 bne fpr1
 inc pp
 jsr fexpr
 jsr nextc
 cmp #')'
 beq fpr0a
 jmp perr
fpr0a inc pp
 rts
fpr9b jmp perr
fpr1 cmp #'.'
 beq fnumb
 cmp #'0'
 bcc fpr2
 cmp #'9'+1
 bcs fpr2
fnumb lda #<FBUF
 sta INBUFF
 lda #>FBUF
 sta INBUFF+1
 lda pp
 sta CIX
 jsr AFP
 bcc fnn1
 jmp perr
fnn1 lda CIX
 sta pp
 jsr vpush
 ldx vsp
 txa
 sec
 sbc #8
 tax
 jmp st0
fpr2 cmp #'$'
 beq fpr3
 cmp #'A'
 bcc fpr9b
 cmp #'Z'+1
 bcs fpr9b
fpr3 ; identifier or reference
 lda pp
 pha
 jsr rdref
 bcs fid1
 ; a reference; check it is not followed by '(' (functions never start like a ref but "A1" could be a name)
 pla
 jsr vpush
 ldx vsp
 txa
 sec
 sbc #8
 tax
 lda #6
 sta VSTK,x
 lda qr
 sta VSTK+1,x
 lda qc
 sta VSTK+2,x
 jsr nextc
 cmp #':'
 beq frg
 ldx vsp
 txa
 sec
 sbc #8
 tax
 lda VSTK+1,x
 sta VSTK+3,x
 lda VSTK+2,x
 sta VSTK+4,x
 rts
frg inc pp
 jsr nextc
 jsr rdref
 bcc frg1
 jmp perr
frg1 ldx vsp
 txa
 sec
 sbc #8
 tax
 ; normalise so that r1<=r2, c1<=c2
 lda qr
 cmp VSTK+1,x
 bcs frg2
 pha
 lda VSTK+1,x
 sta VSTK+3,x
 pla
 sta VSTK+1,x
 jmp frg3
frg2 sta VSTK+3,x
frg3 lda qc
 cmp VSTK+2,x
 bcs frg4
 pha
 lda VSTK+2,x
 sta VSTK+4,x
 pla
 sta VSTK+2,x
 rts
frg4 sta VSTK+4,x
 rts
fpr9 jmp perr
; identifier: letters
fid1 pla
 sta pp
 ldy #0
 ldx pp
fid2 lda FBUF,x
 cmp #'A'
 bcc fid3
 cmp #'Z'+1
 bcs fid3
 cpy #9
 bcs fid3
 sta ID,y
 iny
 inx
 jmp fid2
fid3 lda #0
 sta ID,y
 sty idl
 cpy #0
 bne fid4
 jmp perr
fid4 stx pp
 jsr nextc
 cmp #'('
 beq ffn
 ; TRUE / FALSE
 lda ID
 cmp #'T'
 bne fb1
 lda ID+1
 cmp #'R'
 bne fnm
 lda #1
 jmp fbool
fb1 cmp #'F'
 bne fnm
 lda ID+1
 cmp #'A'
 bne fnm
 lda #0
fbool pha
 jsr vpush
 ldx vsp
 txa
 sec
 sbc #8
 tax
 lda #5
 sta VSTK,x
 pla
 sta VSTK+1,x
 rts
fnm jsr vpush
 ldx vsp
 txa
 sec
 sbc #8
 tax
 lda #3
 jmp puterr
ffn jsr fnlook
 bcs ffn1
 inc unsup
 ; unknown function: skip the arguments by parsing them, result is #NAME?
 lda #0
 sta fid
ffn1 lda fid
 pha
 lda vsp
 pha
 inc pp
 jsr nextc
 cmp #')'
 beq fnoarg
fa_l jsr fexpr
 jsr nextc
 cmp #','
 bne fa_e
 inc pp
 jmp fa_l
fa_e cmp #')'
 beq fnoarg
 jmp perr
fnoarg inc pp
 pla
 sta fbase
 pla
 sta fid
 jmp fcall

fnlook
 lda #<FTAB
 sta ptr
 lda #>FTAB
 sta ptr+1
fl1 ldy #0
 lda (ptr),y
 beq flz9
fl2 lda (ptr),y
 beq fl3
 cmp ID,y
 bne flnext
 iny
 jmp fl2
fl3 cpy idl
 bne flnext
 iny
 lda (ptr),y
 sta fid
 sec
 rts
flnext ldy #0
fl4 lda (ptr),y
 iny
 cmp #0
 bne fl4
 iny
 tya
 clc
 adc ptr
 sta ptr
 bcc fl5
 inc ptr+1
fl5 jmp fl1
flz9 clc
 rts

; function call: arguments between fbase and vsp; result into the slot at fbase
fcall
 lda fid
 bne fc1
 jmp fcunk
fc1 cmp #7
 bcs fc2
 jmp fagg
fc2 cmp #12
 bne fc3
 jmp fif
fc3 cmp #13
 bcc fc4
 jmp fbl
fc4 ; 7 ABS 8 INT 9 SQRT 10 ROUND 11 MOD
 lda vsp
 sec
 sbc fbase
 sta t1
 lda fid
 cmp #10
 bcs fc5
 lda t1
 cmp #8
 beq fc6
 jmp perr
fc5 lda t1
 cmp #16
 beq fc6
 jmp perr
fc6 ldx fbase
 jsr getnumv
 bcc fc6a
 jmp fres
fc6a lda fid
 cmp #10
 bcs fc7
 cmp #7
 bne fc6b
 lda VSTK+1,x
 and #$7F
 sta VSTK+1,x
 jmp fres
fc6b cmp #8
 bne fc6c
 jmp fint
fc6c jmp fsqrt
fc7 ldx fbase
 txa
 clc
 adc #8
 tax
 jsr getnumv
 bcc fc7a
 lda VSTK+1,x
 pha
 ldx fbase
 pla
 jsr puterr
 jmp fres
fc7a lda fid
 cmp #10
 bne fc7b
 jmp fround
fc7b jmp fmod

fcunk
 ldx fbase
 lda #3
 jsr puterr
 jmp fres

; leave only the result at fbase
fres
 lda fbase
 clc
 adc #8
 sta vsp
 rts

; --- aggregates SUM AVERAGE MIN MAX COUNT PRODUCT
fagg
 lda #0
 sta acn
 sta acn+1
 sta fhave
 ldx #5
 lda #0
fg0 sta FACC,x
 dex
 bpl fg0
 lda fid
 cmp #6
 bne fg1
 ldx #5
fg0a lda K1,x
 sta FACC,x
 dex
 bpl fg0a
fg1 lda fbase
 sta t3
fg2 lda t3
 cmp vsp
 bcc fg3
 jmp fgdone
fg3 tax
 lda VSTK,x
 cmp #6
 beq fgrange
 cmp #4
 bne fg4
 jmp fgerr
fg4 cmp #1
 beq fgnum
 cmp #5
 beq fgbool
fgnext lda t3
 clc
 adc #8
 sta t3
 jmp fg2
fgbool jsr getnumv
fgnum ldx t3
 jsr e2bv
 jsr agg1
 bcs fgnumerr
 jmp fgnext
fgnumerr jmp fgovf
fgrange
 lda VSTK+1,x
 sta rr
 lda VSTK+3,x
 sta r2
 lda VSTK+2,x
 sta c1
 lda VSTK+4,x
 sta c2
fgr1 lda c1
 sta rc
fgr2 lda rr
 sta qr
 lda rc
 sta qc
 jsr rdrec
 lda RECB+1
 cmp #1
 beq fgrn
 cmp #4
 bne fgrs
 lda RECB+4
 sta t1
 jmp fgerrc
fgrn ldx #5
fgr3 lda RECB+4,x
 sta BV,x
 dex
 bpl fgr3
 jsr agg1
 bcc fgrs
 jmp fgovf
fgrs lda rc
 cmp c2
 bcs fgr4
 inc rc
 jmp fgr2
fgr4 lda rr
 cmp r2
 bcs fgr5
 inc rr
 jmp fgr1
fgr5 jmp fgnext
fgerrc ldx fbase
 lda t1
 jsr puterr
 jmp fres
fgerr lda VSTK+1,x
 ldx fbase
 jsr puterr
 jmp fres
fgovf ldx fbase
 lda #4
 jsr puterr
 jmp fres
fgdone
 lda fid
 cmp #5
 bne fd1
 jmp fdcount
fd1 cmp #2
 bne fd2
 lda acn
 ora acn+1
 bne fd1a
 ldx fbase
 lda #0
 jsr puterr
 jmp fres
fd1a ldx #<FACC
 ldy #>FACC
 jsr FLD0R
 jsr fdiv_acn
 jmp fdst
fd2 cmp #3
 bcs fd3
 jmp fdacc                    ; SUM
fd3 cmp #6
 bne fd4
 lda acn
 ora acn+1
 beq fdzero
 jmp fdacc                    ; PRODUCT
fd4 lda fhave                 ; MIN / MAX
 beq fdzero
 ldx #<FBEST
 ldy #>FBEST
 jsr FLD0R
 jmp fdst
fdacc ldx #<FACC
 ldy #>FACC
 jsr FLD0R
 jmp fdst
fdzero jsr ZFR0
 jmp fdst
fdcount lda acn
 sta FR0
 lda acn+1
 sta FR0+1
 jsr IFP
fdst ldx fbase
 jsr st0
 jmp fres
fdiv_acn
 lda acn
 sta t1
 jsr FMOVE
 lda acn
 sta FR0
 lda acn+1
 sta FR0+1
 jsr IFP
 jsr FMOVE                    ; FR1 = count
 ldx #<FACC
 ldy #>FACC
 jsr FLD0R
 jmp FDIV

; accumulate the number in BV; carry set on overflow
agg1
 inc acn
 bne ag0
 inc acn+1
ag0 lda fid
 cmp #5
 bne ag1
 clc
 rts
ag1 cmp #3
 bcc agsum
 cmp #5
 bcc agmm
 ; PRODUCT
 ldx #<FACC
 ldy #>FACC
 jsr FLD0R
 ldx #<BV
 ldy #>BV
 jsr FLD1R
 jsr FMUL
 bcs ag9
 jmp agst
agsum ldx #<FACC
 ldy #>FACC
 jsr FLD0R
 ldx #<BV
 ldy #>BV
 jsr FLD1R
 jsr FADD
 bcs ag9
agst ldx #<FACC
 ldy #>FACC
 jsr FST0R
 clc
ag9 rts
agmm lda fhave
 bne agm1
 inc fhave
 jmp agtake
agm1 ldx #<BV
 ldy #>BV
 jsr FLD0R
 ldx #<FBEST
 ldy #>FBEST
 jsr FLD1R
 jsr FSUB
 lda FR0+1
 beq agmx
 lda fid
 cmp #3
 bne agmax
 lda FR0
 bmi agtake
 jmp agmx
agmax lda FR0
 bmi agmx
agtake ldx #5
agt1 lda BV,x
 sta FBEST,x
 dex
 bpl agt1
agmx clc
 rts

; IF(cond, a[, b])
fif
 lda vsp
 sec
 sbc fbase
 cmp #16
 bcs fif0
 jmp perr
fif0 cmp #17
 bcc fif1
 cmp #24
 beq fif1
 jmp perr
fif1 pha
 ldx fbase
 jsr getnumv
 pla
 bcc fif2
 jmp fres                     ; condition is an error
fif2 cmp #24
 beq fif3
 ; two arguments: else part is FALSE
 jsr vpush
 ldx vsp
 txa
 sec
 sbc #8
 tax
 lda #5
 sta VSTK,x
 lda #0
 sta VSTK+1,x
fif3 ldx fbase
 lda VSTK+2,x
 beq fif4                     ; zero: take else (third)
 ; true: second -> result
 txa
 clc
 adc #8
 tax
 jmp fif5
fif4 txa
 clc
 adc #16
 tax
fif5 ldy #0
fif6 lda VSTK,x
 sta FTMP,y
 inx
 iny
 cpy #8
 bne fif6
 ldx fbase
 ldy #0
fif7 lda FTMP,y
 sta VSTK,x
 inx
 iny
 cpy #8
 bne fif7
 jmp fres

; AND / OR / NOT on numbers and booleans
fbl
 lda fid
 cmp #15
 bne fbl2
 lda vsp
 sec
 sbc fbase
 cmp #8
 beq fbl1
 jmp perr
fbl1 ldx fbase
 jsr getnumv
 bcc fbl1a
 jmp fres
fbl1a lda VSTK+2,x
 beq fbl1t
 lda #0
 beq fbl1s
fbl1t lda #1
fbl1s sta VSTK+1,x
 lda #5
 sta VSTK,x
 jmp fres
fbl2 lda fid
 cmp #13
 bne fbl3
 lda #1
 bne fbl4
fbl3 lda #0
fbl4 sta t4                    ; accumulator: AND starts true, OR false
 lda fbase
 sta t3
fbl5 lda t3
 cmp vsp
 bcs fbl9
 tax
 jsr getnumv
 bcc fbl6
 lda VSTK+1,x
 ldx fbase
 jsr puterr
 jmp fres
fbl6 lda VSTK+2,x
 beq fbl7
 lda #1
 bne fbl8
fbl7 lda #0
fbl8 sta t2
 lda fid
 cmp #13
 bne fbl8o
 lda t4
 and t2
 sta t4
 jmp fbl8n
fbl8o lda t4
 ora t2
 sta t4
fbl8n lda t3
 clc
 adc #8
 sta t3
 jmp fbl5
fbl9 ldx fbase
 lda t4
 sta VSTK+1,x
 lda #5
 sta VSTK,x
 jmp fres

; INT(x) in the slot at fbase (X = fbase)
fint
 jsr e2bv
 lda #0
 sta rn
 lda #1
 sta rmode
 jsr bround
 lda rlost
 beq fint1
 lda BV
 bpl fint1
 ldx #<BV
 ldy #>BV
 jsr FLD0R
 ldx #<K1
 ldy #>K1
 jsr FLD1R
 jsr FSUB
 bcs fint2
 ldx fbase
 jsr st0
 jmp fres
fint1 ldx fbase
 jsr bv2e
 jmp fres
fint2 ldx fbase
 lda #4
 jsr puterr
 jmp fres

; SQRT(x): LOG10/EXP10 first guess, then Newton steps
fsqrt
 lda VSTK+1,x
 bpl fsq1
 lda #4
 jsr puterr
 jmp fres
fsq1 lda VSTK+2,x
 bne fsq2
 jmp fres                     ; 0
fsq2 jsr e2bv
 ldx #<BV
 ldy #>BV
 jsr FLD0R
 jsr LOG10
 bcs fsqe
 ldx #<KHF
 ldy #>KHF
 jsr FLD1R
 jsr FMUL
 jsr EXP10
 bcs fsqe
 ldx #<TA
 ldy #>TA
 jsr FST0R                    ; TA = guess
 lda #5
 sta t4
fsq3 ldx #<BV
 ldy #>BV
 jsr FLD0R
 ldx #<TA
 ldy #>TA
 jsr FLD1R
 jsr FDIV                     ; x / g
 bcs fsqe
 ldx #<TA
 ldy #>TA
 jsr FLD1R
 jsr FADD                     ; x/g + g
 ldx #<KHF
 ldy #>KHF
 jsr FLD1R
 jsr FMUL                     ; * 0.5
 ldx #<TA
 ldy #>TA
 jsr FST0R
 dec t4
 bne fsq3
 ldx fbase
 jsr st0
 jmp fres
fsqe ldx fbase
 lda #4
 jsr puterr
 jmp fres

; ROUND(x, n)
fround
 ldx fbase
 txa
 clc
 adc #8
 tax
 jsr e2bv
 lda BV
 and #$80
 sta neg
 lda BV
 and #$7F
 sta BV
 ldx #<BV
 ldy #>BV
 jsr FLD0R
 jsr FPI
 bcc fro1
 lda #15
 sta FR0
 lda #0
 sta FR0+1
fro1 lda FR0+1
 beq fro2
 lda #15
 sta FR0
fro2 lda FR0
 cmp #16
 bcc fro3
 lda #15
fro3 ldx neg
 beq fro4
 eor #$FF
 clc
 adc #1
fro4 sta rn
 ldx fbase
 jsr e2bv
 lda #0
 sta rmode
 jsr bround
 ldx fbase
 jsr bv2e
 jmp fres

; MOD(a, b) = a - b * floor(a / b)
fmod
 ldx fbase
 txa
 clc
 adc #8
 tax
 lda VSTK+2,x
 bne fmo1
 lda #0
 jsr puterr
 jmp fres
fmo1 ldx fbase
 jsr vld0
 ldx fbase
 txa
 clc
 adc #8
 tax
 jsr vld1
 jsr FDIV
 bcs fmoe
 ldx #5
fmo2 lda FR0,x
 sta BV,x
 dex
 bpl fmo2
 lda #0
 sta rn
 lda #1
 sta rmode
 jsr bround
 lda rlost
 beq fmo3
 lda BV
 bpl fmo3
 ldx #<BV
 ldy #>BV
 jsr FLD0R
 ldx #<K1
 ldy #>K1
 jsr FLD1R
 jsr FSUB
 ldx #<BV
 ldy #>BV
 jsr FST0R
fmo3 ldx #<BV
 ldy #>BV
 jsr FLD0R
 ldx fbase
 txa
 clc
 adc #8
 tax
 jsr vld1
 jsr FMUL                     ; b * floor
 bcs fmoe
 jsr FMOVE
 ldx fbase
 jsr vld0
 jsr FSUB                     ; a - b*floor
 bcs fmoe
 ldx fbase
 jsr st0
 jmp fres
fmoe ldx fbase
 lda #4
 jsr puterr
 jmp fres

; ---- evaluate one formula cell (er, ec)
calccell
 lda er
 sta qr
 lda ec
 sta qc
 jsr rdrec
 lda RECB
 cmp #3
 beq ccok
 rts
ccok
 ldx #9
cc0 lda RECB+1,x
 sta OLDV,x
 dex
 bpl cc0
 lda RECB+10
 sta rp
 lda RECB+11
 sta rp+1
 jsr hget
 ldy #0
cc1 cpy TMPS
 bcs cc3
 lda TMPS+1,y
 cmp #'a'
 bcc cc2
 cmp #'z'+1
 bcs cc2
 sec
 sbc #$20
cc2 sta FBUF,y
 iny
 bne cc1
cc3 lda #0
 sta FBUF,y
 sta pp
 sta vsp
 sta unsup
 tsx
 stx evsp
 jsr fexpr
 jsr nextc
 beq cc4
 jmp perr
cc4 lda vsp
 cmp #8
 beq cfin
 jmp perr

cfin
 lda #0
 sta vsp
 ldx #0
 lda VSTK
 cmp #6
 bne cf1
 jsr derefx
 lda VSTK
cf1 cmp #0
 bne cf2
 lda #1
 sta VSTK
cf2 lda er
 sta qr
 lda ec
 sta qc
 jsr rdrec
 lda unsup
 beq cf3
 lda RECB+1
 beq cfk
 jmp cfret
cfk                    ; keep the cached value of an unsupported function
 lda #3
 sta VSTK+1
 lda #4
 sta VSTK
cf3 ldx #5
 lda #0
cf4 sta RECB+4,x
 dex
 bpl cf4
 lda VSTK
 sta RECB+1
 ldx #0
cf5 lda VSTK+1,x
 sta RECB+4,x
 inx
 cpx #6
 bne cf5
 lda RECB+1
 cmp #4
 bne cf6
 lda #0                       ; errors: only the code byte matters
 sta RECB+5
 sta RECB+6
 sta RECB+7
 sta RECB+8
 sta RECB+9
cf6 lda RECB+1
 cmp #5
 bne cf7
 lda #0
 sta RECB+5
 sta RECB+6
 sta RECB+7
 sta RECB+8
 sta RECB+9
cf7 ldx #8
cf8 lda RECB+1,x
 cmp OLDV,x
 bne cf9
 dex
 bpl cf8
 rts
cf9 lda circm
 beq cf10
 lda #4
 sta RECB+1
 lda #6
 sta RECB+4
 lda #0
 sta RECB+5
 sta RECB+6
 sta RECB+7
 sta RECB+8
 sta RECB+9
cf10 inc chg
 jmp wrrec
cfret rts

; recalculate all formulas until nothing changes (at most 40 passes, then the cells still changing become #CIRC!)
recalc
 lda #0
 sta npass
 sta circm
rcp lda #0
 sta chg
 sta fli
 sta fli+1
rcl lda fli
 cmp fcnt
 bne rcl1
 lda fli+1
 cmp fcnt+1
 beq rcend
rcl1 lda fli
 sta ptr
 lda fli+1
 clc
 adc #>FLL
 sta ptr+1
 ldy #0
 lda (ptr),y
 sta er
 lda ptr+1
 clc
 adc #>(FLH-FLL)
 sta ptr+1
 lda (ptr),y
 sta ec
 jsr calccell
 inc fli
 bne rcl
 inc fli+1
 jmp rcl
rcend lda chg
 beq rcdone
 lda circm
 bne rcdone
 inc npass
 lda npass
 cmp #40
 bcc rcp
 lda #1
 sta circm
 jmp rcp
rcdone lda #0
 sta circm
 lda #6
 sta msg
 rts
