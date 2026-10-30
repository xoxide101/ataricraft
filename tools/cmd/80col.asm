; 80col.asm - 80COL.COM  /ON  /OFF  : an 80 column text screen for E: (DOS menu, BASIC, tools).
; The driver (res80.asm) sits in the top 12K of RAM; RAMTOP is lowered below it.  The hi-res text uses
; ANTIC mode F, 4 x 8 pixel characters.  BASIC GRAPHICS modes other than 0 still work and bring the
; normal display back; GRAPHICS 0 (and a warm start) returns to 80 columns.
        icl 'lib\sys.asm'
        icl 'lib\r80.inc'

HAND    = $0480
ibuf    = $0600
sp      = $CB
dp      = $CD
vp      = $D0
bh      = $D2
SETVBV  = $E45C
VVBLKD  = $0224
MEMTOP  = $02E5
SDLSTL  = $0230
IOCB0PT = $0346
VOFF    = $1FC0

        org CODE
start   lda #EOL
        sta ibuf
        lda HAND
        cmp #$A5
        bne ask
        ldy #0
cp      lda HAND+1,y
        sta ibuf,y
        iny
        cmp #EOL
        bne cp
        lda #0
        sta HAND
        beq parse
ask     lda #<m_ask
        ldy #>m_ask
        jsr pr
        lda #<ibuf
        sta ICBAL
        lda #>ibuf
        sta ICBAH
        lda #5
        sta ICCOM
        lda #60
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV
parse   ldy #0
pq      lda ibuf,y          ; the screen editor hands back the prompt too: start after the "?"
        cmp #EOL
        beq p0
        cmp #'?'
        beq pq1
        iny
        bne pq
pq1     iny
        bne p1
p0      ldy #0
p1      lda ibuf,y
        cmp #' '
        beq p2
        cmp #'/'
        beq p2
        and #$DF
        cmp #'O'
        bne usage
        iny
        lda ibuf,y
        and #$DF
        cmp #'N'
        bne *+5
        jmp doon
        cmp #'F'
        bne usage
        jmp dooff
usage   lda #<m_use
        ldy #>m_use
        jmp prx
p2      iny
        bne p1

; carry clear and bh = base page when the driver is installed
isact   ldx #0
ia1     lda HATABS,x
        beq ia_no
        cmp #'E'
        beq ia2
        inx
        inx
        inx
        bne ia1
ia_no   sec
        rts
ia2     lda HATABS+2,x
        cmp #$70
        bcc ia_no
        cmp #$D0
        bcs ia_no
        sta sp+1
        and #$F0
        sec
        sbc #$20
        sta bh
        lda HATABS+1,x
        sec
        sbc #3
        sta sp
        bcs ia3
        dec sp+1
ia3     ldy #0
        lda (sp),y
        cmp #'8'
        bne ia_no
        iny
        lda (sp),y
        cmp #'0'
        bne ia_no
        iny
        lda (sp),y
        cmp #'C'
        bne ia_no
        clc
        rts

; vp = the driver's variables
setvp   lda #<VOFF
        sta vp
        lda bh
        clc
        adc #>VOFF
        sta vp+1
        rts

doon    jsr isact
        bcs on1
        lda #<m_already
        ldy #>m_already
        jmp prx
on1     lda RAMTOP
        cmp #$C0
        bne on1a
        ldx #<blob9
        ldy #>blob9
        lda #<blob9e
        sta bel
        lda #>blob9e
        sta beh
        jmp on2
on1a    cmp #$A0
        bne on1b
        ldx #<blob7
        ldy #>blob7
        lda #<blob7e
        sta bel
        lda #>blob7e
        sta beh
        jmp on2
on1b    cmp #$80
        bne on1c
        ldx #<blob5
        ldy #>blob5
        lda #<blob5e
        sta bel
        lda #>blob5e
        sta beh
        jmp on2
on1c    cmp #$80
        bcs on1d
        lda #<m_16
        ldy #>m_16
        jmp prx
on1d    lda #<m_mem
        ldy #>m_mem
        jmp prx
on2     stx sp
        sty sp+1
        lda RAMTOP
        sec
        sbc #RESP
        sta bh
; copy the binary blob: optional $FFFF, then start,end,data ...
cb1     ldy #0
        lda (sp),y
        iny
        and (sp),y
        cmp #$FF
        bne cb2
        jsr adv2
cb2     ldy #0
        lda (sp),y
        sta dp
        iny
        lda (sp),y
        sta dp+1
        iny
        lda (sp),y
        sta cnt
        iny
        lda (sp),y
        sta cnt+1
        lda cnt
        sec
        sbc dp
        sta cnt
        lda cnt+1
        sbc dp+1
        sta cnt+1
        inc cnt
        bne cb3
        inc cnt+1
cb3     jsr adv4
cb4     ldy #0
        lda (sp),y
        sta (dp),y
        inc sp
        bne cb5
        inc sp+1
cb5     inc dp
        bne cb6
        inc dp+1
cb6     lda cnt
        bne cb7
        dec cnt+1
cb7     dec cnt
        lda cnt
        ora cnt+1
        bne cb4
        lda sp
        cmp bel
        bne cb9
        lda sp+1
        cmp beh
        beq cdone
cb9     jmp cb1
cdone   jsr setvp
        ; remember what we replace
        ldx #0
oe1     lda HATABS,x
        cmp #'E'
        beq oe2
        inx
        inx
        inx
        jmp oe1
oe2     stx tx
        ldy #0
        lda HATABS+1,x
        sta (vp),y
        iny
        lda HATABS+2,x
        sta (vp),y
        iny
        lda RAMTOP
        sta (vp),y
        iny
        lda $0C
        sta (vp),y
        iny
        lda $0D
        sta (vp),y
        iny
        lda VVBLKD
        sta (vp),y
        iny
        lda VVBLKD+1
        sta (vp),y
        iny
        lda MEMTOP
        sta (vp),y
        iny
        lda MEMTOP+1
        sta (vp),y
        lda bh
        sta RAMTOP
        jsr gr0
        ; driver entry points
        ldy #$38
        lda (vp),y
        sta tpl
        iny
        lda (vp),y
        sta tph
        iny
        lda (vp),y
        sta dsl
        iny
        lda (vp),y
        sta dsh
        iny
        lda (vp),y
        sta vbl
        iny
        lda (vp),y
        sta vbh
        iny
        lda (vp),y
        sta inl
        iny
        lda (vp),y
        sta inh
        jsr callin
        ldx tx
        lda tpl
        sta HATABS+1,x
        lda tph
        sta HATABS+2,x
        lda tpl
        sta sp
        lda tph
        sta sp+1
        ldy #6
        lda (sp),y
        sta IOCB0PT
        iny
        lda (sp),y
        sta IOCB0PT+1
        lda dsl
        sta $0C
        lda dsh
        sta $0D
        lda bh
        clc
        adc #>$0F00
        sta SDLSTL+1
        lda #<$0F00
        sta SDLSTL
        ldx vbh
        ldy vbl
        lda #7
        jsr SETVBV
        lda #<m_on
        ldy #>m_on
        jmp prx

callin  jmp (inl)

dooff   jsr isact
        bcc of1
        lda #<m_not
        ldy #>m_not
        jmp prx
of1     jsr setvp
        ldy #5
        lda (vp),y
        sta tpl
        iny
        lda (vp),y
        tax
        ldy tpl
        lda #7
        jsr SETVBV
        ldy #3
        lda (vp),y
        sta $0C
        iny
        lda (vp),y
        sta $0D
        ldx #0
of2     lda HATABS,x
        cmp #'E'
        beq of3
        inx
        inx
        inx
        jmp of2
of3     ldy #0
        lda (vp),y
        sta HATABS+1,x
        sta sp
        iny
        lda (vp),y
        sta HATABS+2,x
        sta sp+1
        ldy #6
        lda (sp),y
        sta IOCB0PT
        iny
        lda (sp),y
        sta IOCB0PT+1
        ldy #2
        lda (vp),y
        sta RAMTOP
        jsr gr0
        lda #<m_off
        ldy #>m_off
        jmp prx

; GRAPHICS 0 through S: on IOCB 6, which makes the OS rebuild its screen below RAMTOP
gr0     ldx #$60
        lda #3
        sta ICCOM,x
        lda #<sname
        sta ICBAL,x
        lda #>sname
        sta ICBAH,x
        lda #12
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        jsr CIOV
        ldx #$60
        lda #12
        sta ICCOM,x
        jmp CIOV
sname   dta c'S:',EOL

adv2    lda sp
        clc
        adc #2
        sta sp
        bcc a2
        inc sp+1
a2      rts
adv4    lda sp
        clc
        adc #4
        sta sp
        bcc a4
        inc sp+1
a4      rts

; print the EOL terminated text at A/Y, then return to DOS
prx     jsr pr
        jmp (DOSVEC)
pr      sta ICBAL
        sty ICBAH
        lda #9
        sta ICCOM
        lda #0
        sta ICBLH
        lda #255
        sta ICBLL
        ldx #0
        jmp CIOV

cnt     dta a(0)
bel     dta 0
beh     dta 0
tx      dta 0
tpl     dta 0
tph     dta 0
dsl     dta 0
dsh     dta 0
vbl     dta 0
vbh     dta 0
inl     dta 0
inh     dta 0
m_ask   dta c'80 COLUMNS: ON OR OFF? ',EOL
m_use   dta c'USAGE: 80COL /ON  or  80COL /OFF',EOL
m_on    dta c'80 COLUMN SCREEN ON',EOL
m_off   dta c'80 COLUMN SCREEN OFF',EOL
m_already dta c'80 COLUMNS ALREADY ON',EOL
m_not   dta c'80 COLUMNS NOT ON',EOL
m_mem   dta c'UNSUPPORTED RAMTOP (32K OR MORE)',EOL
m_16    dta c'REQUIRES 32K OR MORE',EOL

blob9   ins 'bin\r9000.bin'
blob9e
blob7   ins 'bin\r7000.bin'
blob7e
blob5   ins 'bin\r5000.bin'
blob5e
        run start
