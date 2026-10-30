; nano.asm - NANO.COM, a full screen text editor with nano style keys for any Atari DOS.
; NANO FILE.TXT from CMD, or run it from the DOS menu and type the name at the prompt.
; The text lives in $6000-$BBFF (about 23K).  A new file name starts an empty buffer.
; Keys:  Ctrl+arrows (or ^B ^F ^P ^N) move   ^A start of line   ^E end of line   ^V / ^Y page down / up
;        ^D or Ctrl+Delete delete character   BACKSPACE delete left   ^K cut line   ^U paste
;        ^W search   ^O write file   ^X exit   ^C show position   ^G help
        icl 'lib\sys.asm'

BUF     = $6000
MAXL    = $5BFF
CLIP    = $5400
CLIPMAX = $0800
TROWS   = 20
SHFLOK  = $02BE
SAVMSC  = $58

cur     = $80
len     = $82
top     = $84
p       = $86
q       = $88
sp      = $8A
src     = $8C
dst     = $8E
cnt     = $90
t       = $92
tp      = $94
want    = $96
cl      = $98
cvt     = $9A
cvu     = $9B
tmp     = $9C
rowc    = $9D
crow    = $9E
ccol    = $9F
scol    = $A0
inv     = $A1
vfl     = $A2
mod     = $A3
key     = $A4
pk      = $A5
fl      = $A6
fmax    = $A7
pi      = $A8
fb      = $A9
pl      = $AB
hr      = $AD
oldshf  = $AE
erc     = $AF
pcnt    = $B0
tflag   = $B1

        org CODE
start   lda #1
        sta CRSINH
        lda SHFLOK
        sta oldshf
        lda #EOL
        sta fn
        sta inb
        sta pb
        lda HAND
        cmp #$A5
        bne ask
        ldy #0
h1      lda HAND+1,y
        cmp #' '
        bne h2
        iny
        bne h1
h2      ldx #0
h3      lda HAND+1,y
        cmp #EOL
        beq h4
        cmp #' '
        beq h4
        sta fn,x
        inx
        iny
        cpx #58
        bcc h3
h4      lda #EOL
        sta fn,x
        lda #0
        sta HAND
        jmp named

ask     jsr putsi
        .byte 'NANO FILE? ',0
        lda #<fn
        sta ICBAL
        lda #>fn
        sta ICBAH
        lda #5
        sta ICCOM
        lda #58
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV

named   lda #0
        sta mod
        sta cur
        sta cur+1
        sta top
        sta top+1
        sta cl
        sta cl+1
        sta vfl
        sta key
        sta tflag
        lda fn
        cmp #EOL
        beq nb
        cmp #' '
        beq nb
        jsr fixname
        jsr loadf
        jmp go
nb      jsr newbuf

go      ldx #$70
        lda #12
        sta ICCOM,x
        jsr CIOV
        ldx #$70
        lda #3
        sta ICCOM,x
        lda #<kspec
        sta ICBAL,x
        lda #>kspec
        sta ICBAH,x
        lda #4
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        lda #125
        jsr putc
        lda #0
        sta SHFLOK
        lda tflag
        beq loop
        cmp #1
        bne go1
        jsr msg0
        jsr pstr
        .byte 'File too long - cut off',0
        jsr msg1
        jmp loop
go1     jsr msg0
        jsr pstr
        .byte 'New File',0
        jsr msg1

; ---- main loop ----
loop    lda key
        sta pk
        jsr fixtop
        jsr draw
        jsr getk
        sta key
        pha
        jsr clr21
        pla
        ldx #0
dk1     cmp ktab,x
        beq dk2
        inx
        cpx #NK
        bcc dk1
        ldx #0
        stx vfl
        cmp #32
        bcc dk9
        cmp #125
        bcs dk9
        jsr inschr
dk9     jmp loop
dk2     cpx #6
        bcc dk3
        ldy #0
        sty vfl
dk3     lda ktl,x
        sta T0
        lda kth,x
        sta T0+1
        jmp (T0)

ktab    .byte 28,16,29,14,25,22
        .byte 30,2,31,6,1,5,4,254,126,155,127,11,21,23,15,24,7,3
NK      = *-ktab
ktl     .byte <kup,<kup,<kdn,<kdn,<kpu,<kpd
        .byte <klf,<klf,<krt,<krt,<khome,<kend,<kdel,<kdel,<kbs,<knl,<ktb,<kcut,<kpaste,<ksrch,<kwrite,<kexit,<khelp,<kpos
kth     .byte >kup,>kup,>kdn,>kdn,>kpu,>kpd
        .byte >klf,>klf,>krt,>krt,>khome,>kend,>kdel,>kdel,>kbs,>knl,>ktb,>kcut,>kpaste,>ksrch,>kwrite,>kexit,>khelp,>kpos

; ---- key handlers ----
kup     jsr cup
        jmp loop
kdn     jsr cdn
        jmp loop
kpu     lda #TROWS-1
        sta pcnt
kpu1    jsr cup
        dec pcnt
        bne kpu1
        jmp loop
kpd     lda #TROWS-1
        sta pcnt
kpd1    jsr cdn
        dec pcnt
        bne kpd1
        jmp loop

klf     lda cur
        ora cur+1
        beq klx
        lda cur
        bne kl1
        dec cur+1
kl1     dec cur
klx     jmp loop

krt     jsr canfwd
        bcs krx
        lda t
        sta cur
        lda t+1
        sta cur+1
krx     jmp loop

khome   lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda t
        sta cur
        lda t+1
        sta cur+1
        jmp loop
kend    lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lend
        lda t
        sta cur
        lda t+1
        sta cur+1
        jmp loop

kdel    jsr canfwd
        bcs kdx
        lda #1
        sta cnt
        lda #0
        sta cnt+1
        jsr delgap
        lda #1
        sta mod
kdx     jmp loop

kbs     lda cur
        ora cur+1
        beq kbx
        lda cur
        bne kb1
        dec cur+1
kb1     dec cur
        lda #1
        sta cnt
        lda #0
        sta cnt+1
        jsr delgap
        lda #1
        sta mod
kbx     jmp loop

knl     lda #EOL
        jsr inschr
        jmp loop
ktb     lda #' '
        jsr inschr
        lda #' '
        jsr inschr
        jmp loop

; ^K cut the current line into the clipboard (repeat to add more lines)
kcut    lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda t
        sta dst
        lda t+1
        sta dst+1
        jsr lend
        sec
        lda t
        sbc dst
        sta cnt
        lda t+1
        sbc dst+1
        sta cnt+1
        lda t
        clc
        adc #1
        sta src
        lda t+1
        adc #0
        sta src+1
        lda cnt
        clc
        adc #1
        sta tp
        lda cnt+1
        adc #0
        sta tp+1
        lda src
        cmp len
        lda src+1
        sbc len+1
        bcc kc1
        lda cnt
        ora cnt+1
        bne kc1
        jmp loop
kc1     lda pk
        cmp #11
        beq kc2
        lda #0
        sta cl
        sta cl+1
kc2     lda cl
        clc
        adc tp
        sta t
        lda cl+1
        adc tp+1
        sta t+1
        lda t
        cmp #<(CLIPMAX+1)
        lda t+1
        sbc #>(CLIPMAX+1)
        bcc kc2a
        jsr msg0
        jsr pstr
        .byte 'Cut buffer full',0
        jsr msg1
        jmp loop
kc2a    lda cl
        clc
        adc #<CLIP
        sta p
        lda cl+1
        adc #>CLIP
        sta p+1
        lda dst
        sta q
        lda dst+1
        clc
        adc #>BUF
        sta q+1
        lda tp
        sta t
        lda tp+1
        sta t+1
        jsr copyup
        lda cl
        clc
        adc tp
        sta cl
        lda cl+1
        adc tp+1
        sta cl+1
        lda dst
        sta cur
        lda dst+1
        sta cur+1
        lda src
        cmp len
        lda src+1
        sbc len+1
        bcs kc3
        inc cnt
        bne kc3
        inc cnt+1
kc3     lda cnt
        ora cnt+1
        beq kc4
        jsr delgap
        lda #1
        sta mod
kc4     jmp loop

; ^U paste
kpaste  lda cl
        ora cl+1
        bne kp1
        jsr msg0
        jsr pstr
        .byte 'Cut buffer is empty',0
        jsr msg1
        jmp loop
kp1     lda cl
        sta cnt
        lda cl+1
        sta cnt+1
        jsr insgap
        bcc kp2
        jsr msg0
        jsr pstr
        .byte 'Buffer full',0
        jsr msg1
        jmp loop
kp2     jsr setp
        lda #<CLIP
        sta q
        lda #>CLIP
        sta q+1
        lda cl
        sta t
        lda cl+1
        sta t+1
        jsr copyup
        lda cur
        clc
        adc cl
        sta cur
        lda cur+1
        adc cl+1
        sta cur+1
        lda #1
        sta mod
        jmp loop

; ^W search (case blind, wraps around, same text is offered again)
ksrch   lda #<inb
        sta fb
        lda #>inb
        sta fb+1
        lda #<lbs
        sta pl
        lda #>lbs
        sta pl+1
        lda #28
        sta fmax
        jsr prompt
        php
        jsr clr21
        plp
        bcc ks9
        lda inb
        cmp #EOL
        beq ks9
        lda cur
        sta p
        lda cur+1
        sta p+1
        lda len
        sta cnt
        lda len+1
        sta cnt+1
ks1     inc p
        bne ks2
        inc p+1
ks2     lda p
        cmp len
        lda p+1
        sbc len+1
        bcc ks3
        lda #0
        sta p
        sta p+1
ks3     lda p
        sta q
        lda p+1
        clc
        adc #>BUF
        sta q+1
        ldx #0
        ldy #0
ks4     lda inb,x
        cmp #EOL
        beq kfound
        jsr fold
        sta tmp
        lda (q),y
        jsr fold
        cmp tmp
        bne ks5
        inx
        iny
        bne ks4
ks5     lda cnt
        bne ks6
        dec cnt+1
ks6     dec cnt
        lda cnt
        ora cnt+1
        bne ks1
        jsr msg0
        jsr pstr
        .byte 'Not found',0
        jsr msg1
ks9     jmp loop
kfound  lda p
        sta cur
        lda p+1
        sta cur+1
        jmp loop

kwrite  jsr wrfile
        jmp loop

kexit   lda mod
        beq quit
        jsr msg0
        jsr pstr
        .byte 'Save changes? Y/N, ESC cancels',0
        jsr msg1
        jsr getk
        jsr fold
        cmp #'N'
        beq quit
        cmp #'Y'
        bne kx9
        jsr wrfile
        bcs kx9
        jmp quit
kx9     jmp loop
quit    jmp bye

; ^C show line and column
kpos    lda cur
        sta t
        lda cur+1
        sta t+1
        jsr cnteol
        lda cnt
        clc
        adc #1
        sta tp
        lda cnt+1
        adc #0
        sta tp+1
        lda len
        sta t
        lda len+1
        sta t+1
        jsr cnteol
        lda cnt
        sta dst
        lda cnt+1
        sta dst+1
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda cur
        sec
        sbc t
        sta src
        lda cur+1
        sbc t+1
        sta src+1
        inc src
        bne kpz
        inc src+1
kpz     jsr msg0
        jsr pstr
        .byte 'Line ',0
        lda tp
        sta t
        lda tp+1
        sta t+1
        jsr dnum
        lda #'/'
        jsr pch
        lda dst
        sta t
        lda dst+1
        sta t+1
        jsr dnum
        jsr pstr
        .byte '  Col ',0
        lda src
        sta t
        lda src+1
        sta t+1
        jsr dnum
        jsr msg1
        jmp loop

; ^G help screen
khelp   lda #1
        sta hr
kh1     lda #0
        sta inv
        lda hr
        jsr rowclr
        inc hr
        lda hr
        cmp #24
        bcc kh1
        lda #$80
        sta inv
        lda #0
        jsr rowclr
        lda #1
        sta scol
        jsr pstr
        .byte 'NANO HELP    any key goes back',0
        lda #0
        sta inv
        lda #1
        sta hr
        jsr hnl
        jsr pstr
        .byte '^O  Write the file out',0
        jsr hnl
        jsr pstr
        .byte '^X  Exit, asks to save changes',0
        jsr hnl
        jsr pstr
        .byte '^W  Search (same text again: Enter)',0
        jsr hnl
        jsr pstr
        .byte '^K  Cut line, repeat to add lines',0
        jsr hnl
        jsr pstr
        .byte '^U  Paste the cut text',0
        jsr hnl
        jsr pstr
        .byte '^C  Show line and column',0
        jsr hnl
        jsr pstr
        .byte '^A  Start of line   ^E  End of line',0
        jsr hnl
        jsr pstr
        .byte '^V  Page down       ^Y  Page up',0
        jsr hnl
        jsr pstr
        .byte '^D  Delete character under cursor',0
        jsr hnl
        jsr pstr
        .byte 'BACKSPACE  Delete left',0
        jsr hnl
        jsr pstr
        .byte 'TAB  Two spaces',0
        jsr hnl
        jsr pstr
        .byte 'Move: Ctrl + arrow keys, or',0
        jsr hnl
        jsr pstr
        .byte '      ^B left ^F right ^P up ^N down',0
        jsr hnl
        jsr hnl
        jsr pstr
        .byte 'The text area holds about 23K.',0
        jsr hnl
        jsr pstr
        .byte 'In a prompt: ESC cancels.',0
        jsr getk
        jmp loop

hnl     inc hr
        lda #0
        sta inv
        lda hr
        jsr rowclr
        lda #1
        sta scol
        rts

; ---- editing primitives ----
; carry clear when the cursor is not on the final EOL; t = cur+1
canfwd  lda cur
        clc
        adc #1
        sta t
        lda cur+1
        adc #0
        sta t+1
        lda t
        cmp len
        lda t+1
        sbc len+1
        rts

setp    lda cur
        sta p
        lda cur+1
        clc
        adc #>BUF
        sta p+1
        rts

; insert one character from A at the cursor
inschr  sta tmp
        lda #1
        sta cnt
        lda #0
        sta cnt+1
        jsr insgap
        bcc ic1
        jsr msg0
        jsr pstr
        .byte 'Buffer full',0
        jsr msg1
        rts
ic1     jsr setp
        lda tmp
        ldy #0
        sta (p),y
        inc cur
        bne ic2
        inc cur+1
ic2     lda #1
        sta mod
        rts

; open a gap of cnt bytes at the cursor (carry set = no room)
insgap  clc
        lda len
        adc cnt
        sta t
        lda len+1
        adc cnt+1
        sta t+1
        bcs ig9
        lda t
        cmp #<(MAXL+1)
        lda t+1
        sbc #>(MAXL+1)
        bcs ig9
        lda t
        sta src
        lda t+1
        sta src+1
        lda len
        sta q
        lda len+1
        clc
        adc #>BUF
        sta q+1
        lda src
        sta p
        lda src+1
        clc
        adc #>BUF
        sta p+1
        sec
        lda len
        sbc cur
        sta t
        lda len+1
        sbc cur+1
        sta t+1
        jsr copydn
        lda src
        sta len
        lda src+1
        sta len+1
        clc
        rts
ig9     sec
        rts

; delete cnt bytes at the cursor
delgap  clc
        lda cur
        adc cnt
        sta q
        lda cur+1
        adc cnt+1
        clc
        adc #>BUF
        sta q+1
        jsr setp
        sec
        lda len
        sbc cur
        sta t
        lda len+1
        sbc cur+1
        sta t+1
        sec
        lda t
        sbc cnt
        sta t
        lda t+1
        sbc cnt+1
        sta t+1
        jsr copyup
        sec
        lda len
        sbc cnt
        sta len
        lda len+1
        sbc cnt+1
        sta len+1
        rts

; copy t bytes from q up to p, lowest address first (p below q, or no overlap)
copyup  lda t+1
        beq cu2
cu1     ldy #0
cu1a    lda (q),y
        sta (p),y
        iny
        bne cu1a
        inc q+1
        inc p+1
        dec t+1
        bne cu1
cu2     lda t
        beq cu4
        ldy #0
cu3     lda (q),y
        sta (p),y
        iny
        cpy t
        bne cu3
cu4     rts

; copy t bytes backwards, q and p point just past the end of source and destination
copydn  lda t
        beq cd2
        sec
        lda q
        sbc t
        sta q
        bcs cd0a
        dec q+1
cd0a    sec
        lda p
        sbc t
        sta p
        bcs cd0b
        dec p+1
cd0b    ldy t
cd1     dey
        lda (q),y
        sta (p),y
        cpy #0
        bne cd1
cd2     lda t+1
        beq cd5
cd3     dec q+1
        dec p+1
        ldy #255
cd4     lda (q),y
        sta (p),y
        dey
        cpy #255
        bne cd4
        dec t+1
        bne cd3
cd5     rts

; t = offset of the start of the line holding offset t
lstart  lda t
        sta q
        lda t+1
        clc
        adc #>BUF
        sta q+1
ls1     lda q
        bne ls2
        lda q+1
        cmp #>BUF
        beq ls9
ls2     lda q
        bne ls3
        dec q+1
ls3     dec q
        ldy #0
        lda (q),y
        cmp #EOL
        bne ls1
        inc q
        bne ls9
        inc q+1
ls9     lda q
        sta t
        lda q+1
        sec
        sbc #>BUF
        sta t+1
        rts

; t = offset of the EOL that ends the line holding offset t
lend    lda t
        sta q
        lda t+1
        clc
        adc #>BUF
        sta q+1
le1     ldy #0
        lda (q),y
        cmp #EOL
        beq le9
        inc q
        bne le1
        inc q+1
        bne le1
le9     lda q
        sta t
        lda q+1
        sec
        sbc #>BUF
        sta t+1
        rts

; cnt = number of EOLs before offset t
cnteol  lda #0
        sta cnt
        sta cnt+1
        lda #<BUF
        sta q
        lda #>BUF
        sta q+1
ce1     lda t
        ora t+1
        beq ce9
        ldy #0
        lda (q),y
        cmp #EOL
        bne ce2
        inc cnt
        bne ce2
        inc cnt+1
ce2     inc q
        bne ce3
        inc q+1
ce3     lda t
        bne ce4
        dec t+1
ce4     dec t
        jmp ce1
ce9     rts

; remember the wanted column for up / down
setwant lda vfl
        bne sw9
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        sec
        lda cur
        sbc t
        sta want
        lda cur+1
        sbc t+1
        sta want+1
        lda #1
        sta vfl
sw9     rts

; t = line start, src = offset of its EOL: cur = t + min(want, length)
placecol sec
        lda src
        sbc t
        sta cnt
        lda src+1
        sbc t+1
        sta cnt+1
        lda want
        cmp cnt
        lda want+1
        sbc cnt+1
        bcs pc1
        lda want
        sta cnt
        lda want+1
        sta cnt+1
pc1     clc
        lda t
        adc cnt
        sta cur
        lda t+1
        adc cnt+1
        sta cur+1
        rts

cup     jsr setwant
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda t
        ora t+1
        beq cu9
        lda t
        bne cup1
        dec t+1
cup1    dec t
        lda t
        sta src
        lda t+1
        sta src+1
        jsr lstart
        jsr placecol
cu9     rts

cdn     jsr setwant
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lend
        lda t
        clc
        adc #1
        sta p
        lda t+1
        adc #0
        sta p+1
        lda p
        cmp len
        lda p+1
        sbc len+1
        bcs cdn9
        lda p
        sta t
        lda p+1
        sta t+1
        jsr lend
        lda t
        sta src
        lda t+1
        sta src+1
        lda p
        sta t
        lda p+1
        sta t+1
        jsr placecol
cdn9    rts

; ---- view window ----
setfp   lda len
        sta src
        lda len+1
        clc
        adc #>BUF
        sta src+1
        rts
setcq   lda cur
        sta dst
        lda cur+1
        clc
        adc #>BUF
        sta dst+1
        rts

; p moves to the start of the next screen row (rows are 40 characters, EOL ends a row)
vnext   ldx #0
vn1     lda p
        cmp src
        lda p+1
        sbc src+1
        bcs vn9
        ldy #0
        lda (p),y
        inc p
        bne vn2
        inc p+1
vn2     cmp #EOL
        beq vn9
        inx
        cpx #40
        bcc vn1
vn9     rts

; scroll top so the cursor is on screen
fixtop  jsr setfp
        jsr setcq
        lda cur
        cmp top
        lda cur+1
        sbc top+1
        bcs ft2
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda t
        sta p
        lda t+1
        clc
        adc #>BUF
        sta p+1
ft1     lda p
        sta tp
        lda p+1
        sta tp+1
        jsr vnext
        lda dst
        cmp p
        lda dst+1
        sbc p+1
        bcs ft1
        lda tp
        sta top
        lda tp+1
        sec
        sbc #>BUF
        sta top+1
        rts
ft2     lda top
        sta p
        lda top+1
        clc
        adc #>BUF
        sta p+1
        lda #0
        sta cnt
        sta cnt+1
ft3     jsr vnext
        lda dst
        cmp p
        lda dst+1
        sbc p+1
        bcc ft4
        inc cnt
        bne ft3
        inc cnt+1
        jmp ft3
ft4     lda cnt+1
        bne ft5
        lda cnt
        cmp #TROWS
        bcc ft9
ft5     sec
        lda cnt
        sbc #TROWS-1
        sta cnt
        lda cnt+1
        sbc #0
        sta cnt+1
        lda top
        sta p
        lda top+1
        clc
        adc #>BUF
        sta p+1
ft6     jsr vnext
        lda cnt
        bne ft7
        dec cnt+1
ft7     dec cnt
        lda cnt
        ora cnt+1
        bne ft6
        lda p
        sta top
        lda p+1
        sec
        sbc #>BUF
        sta top+1
ft9     rts

; ---- screen ----
draw    lda #0
        sta ATRACT
        jsr setfp
        jsr setcq
        lda #$FF
        sta crow
        lda top
        sta p
        lda top+1
        clc
        adc #>BUF
        sta p+1
        lda #1
        sta rowc
dw1     lda #0
        sta inv
        lda rowc
        jsr rowclr
        lda p
        cmp src
        lda p+1
        sbc src+1
        bcs dw9
        ldx #0
dw2     cpx #40
        bcs dw9
        lda p
        cmp dst
        bne dw3
        lda p+1
        cmp dst+1
        bne dw3
        stx ccol
        lda rowc
        sta crow
dw3     ldy #0
        lda (p),y
        inc p
        bne dw4
        inc p+1
dw4     cmp #EOL
        beq dw9
        jsr conv
        pha
        txa
        tay
        pla
        sta (sp),y
        inx
        jmp dw2
dw9     inc rowc
        lda rowc
        cmp #TROWS+1
        bcc dw1
; title row
        lda #$80
        sta inv
        lda #0
        jsr rowclr
        lda #1
        sta scol
        jsr pstr
        .byte 'NANO  ',0
        lda fn
        cmp #EOL
        beq dt1
        lda #<fn
        sta T1
        lda #>fn
        sta T1+1
        jsr pmem
        jmp dt2
dt1     jsr pstr
        .byte 'New Buffer',0
dt2     lda mod
        beq dt3
        lda #32
        sta scol
        jsr pstr
        .byte 'Modified',0
dt3     lda #22
        jsr rowclr
        jsr pstr
        .byte '^G Help  ^O Write  ^W Search  ^K Cut',0
        lda #23
        jsr rowclr
        jsr pstr
        .byte '^X Exit  ^U Paste  ^C Pos  ^V/^Y Page',0
        lda crow
        cmp #$FF
        beq dtx
        jsr setrow
        ldy ccol
        lda (sp),y
        eor #$80
        sta (sp),y
dtx     rts

; A = row: sp = screen address of that row
setrow  tax
        lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        cpx #0
        beq sr9
sr1     lda sp
        clc
        adc #40
        sta sp
        bcc sr2
        inc sp+1
sr2     dex
        bne sr1
sr9     rts

; fill row A with the inv byte, column pointer to 0
rowclr  jsr setrow
        ldy #39
        lda inv
rc1     sta (sp),y
        dey
        bpl rc1
        lda #0
        sta scol
        rts

; screen code for the ATASCII byte in A (result in A)
conv    sta cvt
        and #$7F
        cmp #32
        bcc cv1
        cmp #96
        bcs cv2
        sec
        sbc #32
        bcs cv2
cv1     adc #64
cv2     sta cvu
        lda cvt
        and #$80
        ora cvu
        rts

; write ATASCII A at the screen column scol, then advance
pch     jsr conv
        ora inv
        ldy scol
        sta (sp),y
        inc scol
        rts

; print the 0 terminated text that follows the jsr
pstr    pla
        sta T0
        pla
        sta T0+1
ps1     inc T0
        bne ps2
        inc T0+1
ps2     ldy #0
        lda (T0),y
        beq ps3
        jsr pch
        jmp ps1
ps3     lda T0+1
        pha
        lda T0
        pha
        rts

; print the EOL terminated text at T1
pmem    lda #0
        sta pi
pm1     ldy pi
        lda (T1),y
        cmp #EOL
        beq pm9
        jsr pch
        inc pi
        bne pm1
pm9     rts

; print t as a decimal number without leading zeros
dnum    ldx #0
        lda #0
        sta cnt
dn1     lda #0
        sta cnt+1
dn2     lda t
        sec
        sbc dl,x
        pha
        lda t+1
        sbc dh,x
        bcc dn3
        sta t+1
        pla
        sta t
        inc cnt+1
        jmp dn2
dn3     pla
        lda cnt+1
        ora cnt
        bne dn4
        cpx #4
        bne dn5
dn4     lda #1
        sta cnt
        lda cnt+1
        ora #'0'
        jsr pch
dn5     inx
        cpx #5
        bcc dn1
        rts
dl      .byte <10000,<1000,<100,<10,<1
dh      .byte >10000,>1000,>100,>10,>1

; message line (row 21): "[ text ]"
msg0    lda #0
        sta inv
        lda #21
        jsr rowclr
        lda #'['
        jsr pch
        lda #' '
        jmp pch
msg1    lda #' '
        jsr pch
        lda #']'
        jmp pch
clr21   lda #0
        sta inv
        lda #21
        jmp rowclr

fold    cmp #'a'
        bcc fo9
        cmp #'z'+1
        bcs fo9
        and #$DF
fo9     rts

; line input on row 21: pl = label, fb = text (EOL terminated, edited in place), fmax = longest
; carry set = Enter, carry clear = ESC
prompt  ldy #0
pr0     lda (fb),y
        cmp #EOL
        beq pr1
        iny
        bne pr0
pr1     sty fl
prl     lda #0
        sta inv
        lda #21
        jsr rowclr
        lda pl
        sta T1
        lda pl+1
        sta T1+1
        jsr pmem
        lda fb
        sta T1
        lda fb+1
        sta T1+1
        jsr pmem
        lda #$80
        ldy scol
        sta (sp),y
        jsr getk
        cmp #EOL
        beq pracc
        cmp #27
        beq prcan
        cmp #3
        beq prcan
        cmp #126
        bne pr2
        ldy fl
        beq prl
        dey
        sty fl
        lda #EOL
        sta (fb),y
        jmp prl
pr2     cmp #32
        bcc prl
        cmp #125
        bcs prl
        ldy fl
        cpy fmax
        bcs prl
        sta (fb),y
        iny
        lda #EOL
        sta (fb),y
        sty fl
        jmp prl
pracc   sec
        rts
prcan   clc
        rts

; ---- files ----
fixname ldx #0
fx1     lda fn,x
        cmp #':'
        beq fx9
        cmp #EOL
        beq fx2
        cmp #' '
        beq fx2
        inx
        bne fx1
fx2     lda #EOL
        sta fn+2,x
fx3     lda fn-1,x
        sta fn+1,x
        dex
        bpl fx3
        lda #'D'
        sta fn
        lda #':'
        sta fn+1
fx9     rts

newbuf  lda #1
        sta len
        lda #0
        sta len+1
        lda #EOL
        sta BUF
        rts

loadf   ldx #$10
        lda #3
        sta ICCOM,x
        lda #<fn
        sta ICBAL,x
        lda #>fn
        sta ICBAH,x
        lda #4
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        bpl lf1
        cpy #170
        beq lfnew
        jmp fail
lfnew   jsr newbuf
        lda #2
        sta tflag
        rts
lf1     ldx #$10
        lda #7
        sta ICCOM,x
        lda #<BUF
        sta ICBAL,x
        lda #>BUF
        sta ICBAH,x
        lda #<MAXL
        sta ICBLL,x
        lda #>MAXL
        sta ICBLH,x
        jsr CIOV
        cpy #136
        beq lf2
        tya
        bpl lf1t
        jmp fail
lf1t    lda #1
        sta tflag
lf2     ldx #$10
        lda ICBLL,x
        sta len
        lda ICBLH,x
        sta len+1
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda len
        ora len+1
        bne lf3
        jmp newbuf
lf3     lda len
        sta q
        lda len+1
        clc
        adc #>BUF
        sta q+1
        lda q
        bne lf4
        dec q+1
lf4     dec q
        ldy #0
        lda (q),y
        cmp #EOL
        beq lf9
        inc q
        bne lf5
        inc q+1
lf5     lda #EOL
        sta (q),y
        inc len
        bne lf9
        inc len+1
lf9     rts

; ^O: ask for the name and write the buffer. Carry clear = written.
wrfile  ldx #0
wf1     lda fn,x
        sta pb,x
        cmp #EOL
        beq wf2
        inx
        cpx #60
        bcc wf1
wf2     lda #<pb
        sta fb
        lda #>pb
        sta fb+1
        lda #<lbw
        sta pl
        lda #>lbw
        sta pl+1
        lda #28
        sta fmax
        jsr prompt
        php
        jsr clr21
        plp
        bcc wf8
        lda pb
        cmp #EOL
        beq wf8
        ldx #0
wf3     lda pb,x
        sta fn,x
        cmp #EOL
        beq wf4
        inx
        cpx #60
        bcc wf3
wf4     jmp savefile
wf8     jsr msg0
        jsr pstr
        .byte 'Cancelled',0
        jsr msg1
        sec
        rts

savefile jsr fixname
        ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
        ldx #$10
        lda #3
        sta ICCOM,x
        lda #<fn
        sta ICBAL,x
        lda #>fn
        sta ICBAH,x
        lda #8
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        bmi sv1
        ldx #$10
        lda #11
        sta ICCOM,x
        lda #<BUF
        sta ICBAL,x
        lda #>BUF
        sta ICBAH,x
        lda len
        sta ICBLL,x
        lda len+1
        sta ICBLH,x
        jsr CIOV
        sty erc
        ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda erc
        bmi sv2
        lda #0
        sta mod
        jsr msg0
        jsr pstr
        .byte 'Wrote ',0
        lda len
        sta t
        lda len+1
        sta t+1
        jsr dnum
        jsr pstr
        .byte ' bytes',0
        jsr msg1
        clc
        rts
sv1     sty erc
        ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
sv2     jsr msg0
        jsr pstr
        .byte 'Error ',0
        lda erc
        sta t
        lda #0
        sta t+1
        jsr dnum
        jsr pstr
        .byte ' writing the file',0
        jsr msg1
        sec
        rts

; ---- console / keyboard ----
putc    ldx #0
        stx ICBLL
        stx ICBLH
        ldx #11
        stx ICCOM
        ldx #0
        jmp CIOV

putsi   pla
        sta T0
        pla
        sta T0+1
        ldy #0
pi1     inc T0
        bne pi2
        inc T0+1
pi2     lda (T0),y
        beq pi3
        jsr putc
        ldy #0
        jmp pi1
pi3     lda T0+1
        pha
        lda T0
        pha
        rts

getk    ldx #$70
        lda #7
        sta ICCOM,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        sta ATRACT
        jsr CIOV
        cpy #128
        bcc gk1
        lda #0
gk1     rts

fail    jsr putsi
        .byte 'CAN',39,'T OPEN OR READ THE FILE',EOL,0
bye     ldx #$70
        lda #12
        sta ICCOM,x
        jsr CIOV
        ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda oldshf
        sta SHFLOK
        lda #0
        sta CRSINH
        lda #125
        jsr putc
        jmp (DOSVEC)

HAND    = $0480
kspec   .byte 'K:',EOL
lbs     .byte 'Search: ',EOL
lbw     .byte 'Write to: ',EOL
inb     .ds 32
pb      .ds 64
fn      .ds 64
        run start
