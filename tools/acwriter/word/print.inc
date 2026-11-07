; File > Print to P: (overlay image R, id 5). Format of the output and the limits: docs/PRINT.md.
; Modes (first letter typed at the prompt): t plain text, e Epson ESC/P text, b bitmap 60 dpi, d bitmap 120 dpi.
; The document is read straight from DOC; every output byte goes through outb into a buffer in LDB, which is sent
; with CIO put-chars on IOCB 4. No byte of graphics data is $9B (the OS handler ends a frame at EOL).
ESC = 27
FF  = 12
IOP = $40

prt
 lda CMDB
 ldx #0
 cmp #'t'
 beq pr1
 inx
 cmp #'e'
 beq pr1
 inx
 cmp #'b'
 beq pr1
 inx
 cmp #'d'
 beq pr1
 lda #40
 sta cmsg
 rts
pr1 stx md
 lda #0
 sta perr
 sta ob
 sta pg
 sta cs
 sta st
 ldx #IOP
 lda #3
 sta ICCOM,x
 lda #<pdev
 sta ICBAL,x
 lda #>pdev
 sta ICBAH,x
 lda #8
 sta ICAX1,x
 lda #0
 sta ICAX2,x
 jsr CIOV
 cpy #$80
 bcc pr2
 sty fer
 lda #8
 sta cmsg
 rts
pr2 lda md
 bne pr2a
 jmp pr5
pr2a jsr outi
 dta 2,ESC,'@'
 jsr outi
 dta 2,ESC,'C'
 ldx pwpap
 lda pln,x
 jsr outb
 lda md
 cmp #1
 bne pr4
 lda pwpit
 beq pr3p
 cmp #1
 bne pr3c
 jsr outi
 dta 2,ESC,'M'
 jmp pr5
pr3c jsr outi
 dta 3,ESC,'P',15
 jmp pr5
pr3p jsr outi
 dta 2,ESC,'P'
 jmp pr5
pr4 jsr outi
 dta 3,ESC,'3',0
 lda md
 sec
 sbc #2
 sta t1
 asl
 clc
 adc t1
 clc
 adc pwpit
 asl
 asl
 asl
 tax
 ldy #0
pr4a lda dt,x
 sta dtab,y
 inx
 iny
 cpy #8
 bne pr4a
 lda dtab
 clc
 adc dtab+1
 clc
 adc dtab+2
 clc
 adc dtab+3
 sta dsm
 lda dtab+4
 clc
 adc dtab+5
 clc
 adc dtab+6
 clc
 adc dtab+7
 sta dsm+1
pr5 lda #<DOC
 sta src
 lda #>DOC
 sta src+1
 lda #1
 sta newpar
dl1 ldy #0
 lda (src),y
 beq dl9
 lda perr
 bne dl9
 lda pg
 bne dl2
 jsr topm
dl2 jsr pline
 inc pg
 lda pg
 cmp pwlpp
 bcc dl1
 lda #0
 sta pg
 lda #FF
 jsr outb
 jmp dl1
dl9 lda pg
 beq dl10
 lda #FF
 jsr outb
dl10 jsr flush
 ldx #IOP
 lda #12
 sta ICCOM,x
 jsr CIOV
 lda perr
 bne dl11
 lda #1
 sta cmsg
 rts
dl11 lda #8
 sta cmsg
 rts

; top margin of a page: 6 blank lines (1 inch)
topm lda md
 cmp #2
 bcs tm2
 ldx #6
tm1 lda #$9B
 jsr outb
 dex
 bne tm1
 rts
tm2 jsr outi
 dta 3,ESC,'J',216
 rts

; one document line: paragraph markers, layout, then the mode's output
pline lda newpar
 beq pl2
 lda #0
 sta al
 sta bu
 sta in1
 sta newpar
 lda #1
 sta first
plm ldy #0
 lda (src),y
 cmp #32
 bcs pl2
 cmp #15
 bcs plm1
 cmp #5
 bcc pl2
 cmp #11
 bcs pl2
 bcc plm2
plm1 cmp #17
 bcc plms
 beq plm2
 cmp #18
 bne plm5
 lda #4
 sta in1
 bne plm2
plm5 cmp #19
 bne plm6
 lda #'*'
 sta bu
 bne plm2
plm6 cmp #20
 bne plm2
 lda #'-'
 sta bu
 bne plm2
plms sta al
plm2 inc16 src
 jmp plm
pl2 ldx #0
 lda first
 beq pl2c
 ldy in1
 beq pl2b
pl2a lda #32
 sta pfx,x
 inx
 dey
 bne pl2a
pl2b lda bu
 beq pl2e
 sta pfx,x
 inx
 lda #32
 sta pfx,x
 inx
 bne pl2e
pl2c lda bu
 beq pl2e
 lda #32
 sta pfx,x
 inx
 sta pfx,x
 inx
pl2e stx pn
 lda src
 sta s0
 lda src+1
 sta s0+1
 lda st
 sta st0
 lda #0
 sta nch
pl4 jsr getc
 bcs pl5
 inc nch
 bne pl4
 dec nch
pl5 lda s0
 sta src
 lda s0+1
 sta src+1
 lda st0
 sta st
 lda pwwid
 sec
 sbc pn
 bcs pl6
 lda #0
pl6 cmp nch
 bcs pl7
 sta nch
pl7 lda nch
 sta nchs
 lda pwwid
 sec
 sbc pn
 sec
 sbc nch
 ldx al
 cpx #16
 beq pl8
 cpx #15
 bne pl9
 lsr
 jmp pl8
pl9 lda #0
pl8 clc
 adc pwplm
 sta lb0
 lda md
 cmp #2
 bcs plb
 jsr ginit
pt1 jsr gcell
 bcs pt9
 jsr mapc
 pha
 lda md
 beq pt2
 lda cst
 and #$37
 jsr sync
pt2 pla
 jsr outb
 jmp pt1
pt9 lda md
 beq pt10
 lda #0
 jsr sync
pt10 lda #$9B
 jsr outb
 jmp plz
plb lda pn
 clc
 adc nchs
 bne plb1
 jsr outi
 dta 3,ESC,'J',36
 jmp plz
plb1 lda lb0
 clc
 adc pn
 clc
 adc nchs
 sta ncell
 lda #0
 sta nd
 sta nd+1
 tax
plb2 cpx ncell
 bcs plb4
 txa
 and #1
 tay
 lda nd
 clc
 adc dsm,y
 sta nd
 bcc plb3
 inc nd+1
plb3 inx
 bne plb2
plb4 lda #0
 sta xt
 lda nd
 cmp #$9B
 bne plb5
 inc nd
 inc xt
plb5 lda #0
 sta pas
 jsr bhead
 jsr bpass
 jsr outi
 dta 4,$9B,ESC,'J',24
 lda #1
 sta pas
 jsr bhead
 jsr bpass
 jsr outi
 dta 4,$9B,ESC,'J',12
plz jsr lend
 lda #0
 sta first
 lda eol
 cmp #13
 bne plz9
 lda #1
 sta newpar
 lda #0
 sta st
plz9 rts

; ESC * m n1 n2
bhead jsr outi
 dta 2,ESC,'*'
 lda md
 sec
 sbc #2
 jsr outb
 lda nd
 jsr outb
 lda nd+1
 jmp outb

; one pass over the line's cells; pas 0 = rows 0..7, pas 1 = rows 8..11
bpass jsr ginit
 lda #0
 sta ci
 sta pc
 sta po
bp1 jsr gcell
 bcs bp9
 jsr mapc
 cmp #127
 bcc bp2
 lda #'?'
bp2 jsr gbuild
 lda ci
 and #1
 asl
 asl
 sta ti
 ldx #0
bp3 lda pas
 bne bp3b
 lda ghi,x
 jmp bp3c
bp3b lda glo,x
 and #$F0
bp3c sta cur
 txa
 clc
 adc ti
 tay
 lda dtab,y
 sta dn
 beq bp7
bp5 jsr dotout
 dec dn
 bne bp5
bp7 inx
 cpx #4
 bne bp3
 inc ci
 jmp bp1
bp9 lda xt
 beq bp10
 lda #0
 jsr outb
bp10 rts

; one dot column: italic slants rows 0..3 by one dot (pass 0), bold ORs the previous column
dotout lda cur
 sta nw
 lda cst
 and #2
 beq do1
 lda pas
 bne do1
 lda pc
 and #$F0
 sta t1
 lda cur
 and #$0F
 ora t1
 sta nw
do1 lda cur
 sta pc
 lda cst
 and #1
 beq do3
 lda nw
 ora po
 ldy nw
 sty po
 jmp do4
do3 lda nw
 sta po
do4 cmp #$9B
 bne do5
 lda #$9A
do5 jmp outb

; A = character 32..126: 3 glyph columns + a gap column as 16 bit words (row 0 = bit 15), style cst
gbuild sec
 sbc #32
 tay
 lda #0
 sta rb
 sta rb+1
 sta rb+9
 sta rb+10
 sta rb+11
 lda pwp2,y
 sta rb+2
 lda pwp3,y
 sta rb+3
 lda pwp4,y
 sta rb+4
 lda pwp5,y
 sta rb+5
 lda pwp6,y
 sta rb+6
 lda pwp7,y
 sta rb+7
 lda pwp8,y
 sta rb+8
 lda pwtix,y
 beq gb1
 tax
 lda pwtl-1,x
 sta rb+9
 lda pwtl,x
 sta rb+10
 lda pwtl+1,x
 sta rb+11
gb1 ldx #0
gb2 lda gmk,x
 sta gm
 lda #0
 sta wl
 sta wh
 ldy #0
gb3 lda rb,y
 and gm
 cmp #1
 rol wl
 rol wh
 iny
 cpy #12
 bne gb3
 ldy #4
gb4 asl wl
 rol wh
 dey
 bne gb4
 lda cst
 and #16
 beq gb5
 asl wl
 rol wh
 asl wl
 rol wh
 jmp gb7
gb5 lda cst
 and #32
 beq gb7
 ldy #3
gb6 lsr wh
 ror wl
 dey
 bne gb6
gb7 lda cst
 and #4
 beq gb7a
 lda wl
 ora #$20
 sta wl
gb7a lda cst
 and #$40
 beq gb8
 lda wh
 ora #$04
 sta wh
gb8 lda wh
 sta ghi,x
 lda wl
 sta glo,x
 inx
 cpx #3
 beq gbx
 jmp gb2
gbx lda #0
 sta ghi+3
 lda cst
 and #$40
 beq gb9a
 lda #$04
 sta ghi+3
gb9a lda cst
 and #4
 beq gb9
 lda #$20
gb9 sta glo+3
 rts

; ---- the cell stream of a line: left blanks, indent/bullet prefix, then the characters
ginit lda s0
 sta src
 lda s0+1
 sta src+1
 lda st0
 sta st
 lda lb0
 sta lb
 lda #0
 sta pf
 lda nchs
 sta nch
 rts
gcell lda lb
 beq gc1
 dec lb
 lda #0
 sta cst
 lda #32
 clc
 rts
gc1 lda pf
 cmp pn
 bcs gc2
 tax
 inc pf
 lda #0
 sta cst
 lda pfx,x
 clc
 rts
gc2 lda nch
 beq gcx
 dec nch
 jsr getc
 bcs gcx
 pha
 lda st
 sta cst
 pla
 clc
 rts
gcx sec
 rts
lend jsr getc
 bcc lend
 rts

; next character of the line (carry clear), applying style toggles; carry set at a line end (eol = 13, 14 or 0)
getc ldy #0
 lda (src),y
 bne gt1
 sta eol
 sec
 rts
gt1 inc16 src
 cmp #32
 bcs gtok
 cmp #13
 beq gte
 cmp #14
 beq gte
 bcs gt2
 tax
 lda tgb,x
 eor st
 sta st
 jmp getc
gt2 cmp #21
 bne getc
 lda st
 eor #$40
 sta st
 jmp getc
gte sta eol
 sec
 rts
gtok clc
 rts

; Latin-1 and Craft code to what the printer gets
mapc cmp #160
 bne mc1
 lda #32
 rts
mc1 cmp #173
 bne mc2
 lda #'-'
 rts
mc2 cmp #127
 bcc mc3
 cmp #161
 bcs mc3
 lda #'?'
mc3 rts

; make the printer's ESC/P styles equal A (1 bold, 2 italic, 4 underline, 16 sup, 32 sub)
sync sta wnt
 eor cs
 sta dif
 beq sy9
 ldx #0
sy1 lsr dif
 bcc sy4
 lda wnt
 and bmk,x
 beq sy2
 ldy son,x
 bpl sy3
sy2 ldy sof,x
sy3 lda pool,y
 beq sy4
 jsr outb
 iny
 bne sy3
sy4 inx
 lda dif
 bne sy1
 lda wnt
 sta cs
sy9 rts

; inline string: JSR outi, count, bytes
outi pla
 clc
 adc #1
 sta tp
 pla
 adc #0
 sta tp+1
 ldy #0
 lda (tp),y
 sta ocn
oi1 iny
 lda (tp),y
 jsr outb
 cpy ocn
 bne oi1
 tya
 clc
 adc tp
 tax
 lda tp+1
 adc #0
 pha
 txa
 pha
 rts

outb sty oby
 ldy ob
 sta LDB,y
 iny
 sty ob
 cpy #200
 bcc ob9
 jsr flush
ob9 ldy oby
 rts

flush lda ob
 beq fl9
 stx fxs
 lda perr
 bne fl8
 ldx #IOP
 lda #11
 sta ICCOM,x
 lda #<LDB
 sta ICBAL,x
 lda #>LDB
 sta ICBAH,x
 lda ob
 sta ICBLL,x
 lda #0
 sta ICBLH,x
 jsr CIOV
 cpy #$80
 bcc fl8
 sty fer
 lda #1
 sta perr
fl8 lda #0
 sta ob
 ldx fxs
fl9 rts

pdev dta c'P:',b($9B)
pln dta b(66,70,84)
tgb dta b(0,1,2,4,8,0,0,0,0,0,0,16,32)
bmk dta b(1,2,4,8,16,32)
gmk dta b($80,$40,$20)
; ESC/P style strings: bold, italic, underline, (inverse: none), superscript, subscript
pool dta b(ESC),c'E',b(0)
 dta b(ESC),c'F',b(0)
 dta b(ESC),c'4',b(0)
 dta b(ESC),c'5',b(0)
 dta b(ESC),c'-1',b(0)
 dta b(ESC),c'-0',b(0)
 dta b(0)
 dta b(ESC),c'S0',b(0)
 dta b(ESC),c'T',b(0)
 dta b(ESC),c'S1',b(0)
son dta b(0,6,12,20,21,28)
sof dta b(3,9,16,20,25,25)
; dots per source pixel column (3 glyph columns and the gap), two cells (even, odd) per table:
; 60 dpi 10/12/17 cpi, then 120 dpi 10/12/17 cpi
dt dta b(2,1,2,1,2,1,2,1)
 dta b(2,1,1,1,2,1,1,1)
 dta b(1,1,1,1,1,1,1,0)
 dta b(3,3,3,3,3,3,3,3)
 dta b(3,2,3,2,3,2,3,2)
 dta b(2,2,2,1,2,2,2,1)

 icl 'craftpg.inc'

md dta b(0)
perr dta b(0)
ob dta b(0)
oby dta b(0)
fxs dta b(0)
ocn dta b(0)
pg dta b(0)
cs dta b(0)
st dta b(0)
st0 dta b(0)
eol dta b(0)
nch dta b(0)
nchs dta b(0)
pn dta b(0)
lb dta b(0)
lb0 dta b(0)
pf dta b(0)
al dta b(0)
bu dta b(0)
in1 dta b(0)
newpar dta b(0)
first dta b(0)
cst dta b(0)
wnt dta b(0)
dif dta b(0)
t1 dta b(0)
s0 dta a(0)
ncell dta b(0)
nd dta a(0)
xt dta b(0)
pas dta b(0)
ci dta b(0)
pc dta b(0)
po dta b(0)
ti dta b(0)
dn dta b(0)
cur dta b(0)
nw dta b(0)
gm dta b(0)
wl dta b(0)
wh dta b(0)
dsm dta b(0,0)
pfx :8 dta b(0)
dtab :8 dta b(0)
rb :12 dta b(0)
ghi :4 dta b(0)
glo :4 dta b(0)
