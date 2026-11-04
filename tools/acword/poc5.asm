; ACWord proof of concept: 320x192 1-bit page, 6px glyphs, bold/italic/underline,
; typing, scrolling, and frame timing. Stock 64K XL/XE. Build: mads poc.asm -o:poc.xex
SDMCTL = $022F
SDLSTL = $0230
COLOR1 = $02C5
COLOR2 = $02C6
COLOR4 = $02C8
CH     = $02FC
RTCLOK = $12
ATRACT = $4D
PORTB  = $D301
CIOV   = $E456
ICCOM  = $0342
ICBAL  = $0344
ICBAH  = $0345
ICBLL  = $0348
ICBLH  = $0349
ICAX1  = $034A
ICAX2  = $034B

SCR  = $A060
DOC  = $5000
LPL  = $9000
LPH  = $9100
BUF  = $0600
COLB = $0680
COLS = $0740
FNT  = $0900
ROWL = $0700
ROWH = $0720
ROWS = 21

src  = $80
dst  = $82
tp   = $84
sp   = $86
gp   = $88
rs   = $8A
col  = $8C
style= $8D
v    = $8E
hi   = $8F
lo   = $90
ry   = $91
shf  = $92
cl   = $93
cc   = $94
top  = $95
nl   = $96
t0   = $97
tmp  = $98
rr   = $99
fl   = $9A
bi   = $9B
kk   = $9C
tm   = $9D
pbv  = $9E
shv  = $9F
mfull= $A0
mscr = $A1
mkey= $A2
dfrom= $A3
dend = $A6
cmode= $A8
cmdon= $A9
clen = $AA
bd   = $AB
cmsg = $AC
CMDB = $0E00
SHH  = $0C00
SHL  = $0D00
mh   = $AD
ml   = $AE

.macro inc16 p
 inc :p
 bne @+
 inc :p+1
@
.endm

.macro dec16 p
 lda :p
 bne @+
 dec :p+1
@ dec :p
.endm

 org $2000

start
 lda PORTB
 ora #2
 sta PORTB
 jsr mktab
 jsr mkfont
 jsr openk
 lda #<dl
 sta SDLSTL
 lda #>dl
 sta SDLSTL+1
 lda #$22
 sta SDMCTL
 lda #$0F
 sta COLOR2
 lda #$00
 sta COLOR1
 lda #$04
 sta COLOR4
 lda #0
 sta cl
 sta cc
 sta top
 sta dfrom
 sta fl
 sta cmode
 sta cmdon
 sta clen
 sta cmsg
 sta bd
 jsr scan
 lda RTCLOK+2
 sta tm
 jsr full
 jsr tend
 sta mfull
 lda RTCLOK+2
 sta tm
 jsr scrolldown
 jsr tend
 sta mscr
 jsr scrollup
 lda #0
 sta mkey
 jsr ribbon
 jsr bar
 jsr status

loop
 lda #0
 sta ATRACT
 lda CH
 cmp #$FF
 beq loop
 lda RTCLOK+2
 sta tm
 jsr getkey
 sta kk
 lda #0
 sta fl
 jsr handle
 jsr tend
 sta $A4
 jsr visible
 jsr tend
 sta $A5
 lda fl
 cmp #2
 bne lp1
 jsr full
 jmp lp2
lp1 cmp #3
 bne lp1b
 jsr appendcur
 jmp lp2
lp1b cmp #1
 bne lp2
 jsr redrawcur
lp2 jsr tend
 sta mkey
 jsr status
 lda bd
 beq lp3
 lda #0
 sta bd
 jsr ribbon
 jsr bar
lp3 jmp loop

tend
 lda RTCLOK+2
 sec
 sbc tm
 rts

openk
 ldx #$20
 lda #3
 sta ICCOM,x
 lda #<kname
 sta ICBAL,x
 lda #>kname
 sta ICBAH,x
 lda #4
 sta ICAX1,x
 lda #0
 sta ICAX2,x
 jmp CIOV

getkey
 ldx #$20
 lda #7
 sta ICCOM,x
 lda #0
 sta ICBLL,x
 sta ICBLH,x
 jmp CIOV

mktab
 lda #0
 sta tmp
 sta gp+1
 tax
mt1 lda tmp
 lsr
 lsr
 lsr
 sta t0
 lda gp+1
 asl
 asl
 asl
 asl
 asl
 ora t0
 sta COLB,x
 lda tmp
 and #7
 asl
 asl
 asl
 asl
 asl
 sta COLS,x
 lda tmp
 clc
 adc #5
 sta tmp
 bcc mt2
 inc gp+1
mt2 inx
 cpx #64
 bne mt1
 jsr mksh
 lda #<SCR
 sta src
 lda #>SCR
 sta src+1
 ldx #0
mt3 lda src
 sta ROWL,x
 lda src+1
 sta ROWH,x
 lda src
 clc
 adc #<320
 sta src
 lda src+1
 adc #>320
 sta src+1
 inx
 cpx #24
 bne mt3
 rts

; rebuild line pointer table
scan
 lda #<DOC
 sta tp
 lda #>DOC
 sta tp+1
 ldx #0
sc1 lda tp
 sta LPL,x
 lda tp+1
 sta LPH,x
 inx
sc2 ldy #0
 lda (tp),y
 beq sc3
 inc16 tp
 cmp #13
 bne sc2
 jmp sc1
sc3 stx nl
 lda tp
 sta dend
 lda tp+1
 sta dend+1
 rts

full
 lda #0
 sta rr
fu1 lda top
 clc
 adc rr
 sta t0
 jsr drawdoc
 inc rr
 lda rr
 cmp #ROWS
 bne fu1
 rts

appendcur
 lda cl
 sec
 sbc top
 sta rr
 jsr rowptr
 ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 lda cc
 sec
 sbc #1
 sta dfrom
 jsr drawtext
 lda #0
 sta dfrom
 rts

redrawcur
 lda cl
 sec
 sbc top
 sta rr
 lda cl
 sta t0
 jmp drawdoc

drawdoc
 jsr rowsetup
 lda t0
 cmp nl
 bcs dd0
 tax
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 jmp drawtext
dd0 rts

rowsetup
 jsr rowptr
 ldy #0
 tya
rs1 sta (sp),y
 iny
 bne rs1
 inc sp+1
rs2 sta (sp),y
 iny
 cpy #64
 bne rs2
 rts

rowptr
 ldx rr
 inx
 lda ROWL,x
 sta rs
 sta sp
 lda ROWH,x
 sta rs+1
 sta sp+1
 rts

drawtext
 lda #0
 sta col
 sta style
dt1 ldy #0
 lda (tp),y
 beq dtend
 cmp #13
 beq dtend
 cmp #4
 bcs dtchar
 tax
 lda stab-1,x
 eor style
 sta style
 jmp dtnext
dtchar
 lda col
 cmp dfrom
 bcc dtskip
 ldy #0
 lda (tp),y
 jsr drawchar
dtskip
 inc col
 lda col
 cmp #64
 beq dtend
dtnext
 inc16 tp
 jmp dt1
dtend rts

; A = ascii; draws at col on the row in rs
drawchar
 cmp #128
 bcc dc0
 lda #32
dc0 sec
 sbc #32
 bcs dc1
 lda #0
dc1 sta gp
 lda #0
 sta gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 lda gp+1
 clc
 adc #>FNT
 sta gp+1
 ldx col
 lda COLB,x
 clc
 adc rs
 sta sp
 lda rs+1
 adc #0
 sta sp+1
 lda COLS,x
 sta shf
 ora #31
 tax
 lda SHH,x
 eor #$FF
 sta mh
 lda SHL,x
 eor #$FF
 sta ml
 lda #0
 sta ry
dc2 ldy ry
 lda (gp),y
 sta v
 lda style
 and #1
 beq dc6
 lda v
 lsr
 ora v
 sta v
dc6 lda v
 asl
 sta v
 lda style
 and #2
 beq dc7
 ldy ry
 cpy #4
 bcs dc7
 lsr v
dc7 lda style
 and #4
 beq dc8
 ldy ry
 cpy #7
 bne dc8
 lda #$1F
 sta v
dc8 lda v
 ora shf
 tax
 lda SHH,x
 sta hi
 lda SHL,x
 sta lo
 ldy #0
 lda (sp),y
 and mh
 ora hi
 sta (sp),y
 iny
 lda (sp),y
 and ml
 ora lo
 sta (sp),y
 lda sp
 clc
 adc #40
 sta sp
 bcc dca
 inc sp+1
dca inc ry
 lda ry
 cmp #8
 bne dc2
 rts

stab dta b(1),b(2),b(4)

mksh
 ldx #0
ms1 txa
 and #$1F
 asl
 asl
 asl
 sta hi
 lda #0
 sta lo
 txa
 lsr
 lsr
 lsr
 lsr
 lsr
 tay
 beq ms3
ms2 lsr hi
 ror lo
 dey
 bne ms2
ms3 lda hi
 sta SHH,x
 lda lo
 sta SHL,x
 inx
 bne ms1
 rts

mkfont
 ldx #0
 lda #<FNT
 sta dst
 lda #>FNT
 sta dst+1
mf1 ldy #0
 lda f4_0,x
 sta (dst),y
 iny
 lda f4_1,x
 sta (dst),y
 iny
 lda f4_2,x
 sta (dst),y
 iny
 lda f4_3,x
 sta (dst),y
 iny
 lda f4_4,x
 sta (dst),y
 iny
 lda f4_5,x
 sta (dst),y
 iny
 lda f4_6,x
 sta (dst),y
 iny
 lda #0
 sta (dst),y
 lda dst
 clc
 adc #8
 sta dst
 bcc mf2
 inc dst+1
mf2 inx
 cpx #96
 bne mf1
 rts

cmdkey
 lda kk
 cmp #$9B
 beq ckrun
 cmp #$1B
 beq ckoff
 cmp #$7E
 beq ckbs
 cmp #$7F
 beq cktab
 cmp #32
 bcc ckx
 cmp #127
 bcs ckx
 cmp #'A'
 bcc ck1
 cmp #'['
 bcs ck1
 ora #$20
ck1 ldx clen
 cpx #60
 bcs ckx
 sta CMDB,x
 inc clen
ckx lda #1
 sta bd
 rts
ckbs lda clen
 beq ckx
 dec clen
 jmp ckx
ckoff lda #0
 sta cmdon
 sta cmsg
 jmp ckx
ckrun lda #0
 sta cmdon
 sta cmsg
 lda #1
 sta bd
 lda clen
 beq ckx
 jmp runcmd

cktab lda #<cmdtab
 sta src
 lda #>cmdtab
 sta src+1
tc1 ldy #0
 lda (src),y
 beq ckx
tc2 cpy clen
 beq tcok
 lda (src),y
 cmp CMDB,y
 bne tcn
 iny
 bne tc2
tcn jsr nxtcmd
 jmp tc1
tcok ldy #0
tc3 lda (src),y
 sta CMDB,y
 beq tc4
 iny
 bne tc3
tc4 sty clen
 jmp ckx

nxtcmd
 ldy #0
nx1 lda (src),y
 iny
 cmp #0
 bne nx1
 tya
 clc
 adc src
 sta src
 bcc nx2
 inc src+1
nx2 rts

runcmd
 ldx clen
 lda #0
 sta CMDB,x
 sta tmp
 lda #<cmdtab
 sta src
 lda #>cmdtab
 sta src+1
rc1 ldy #0
 lda (src),y
 beq rcbad
rc2 lda (src),y
 cmp CMDB,y
 bne rcn
 cmp #0
 beq rcok
 iny
 bne rc2
rcn jsr nxtcmd
 inc tmp
 jmp rc1
rcbad lda #2
 sta cmsg
 rts
rcok lda #1
 sta cmsg
 lda tmp
 cmp #3
 bcs rd1
 clc
 adc #1
 jmp insert
rd1 bne rd2
 lda #0
 sta cl
 sta cc
 lda #2
 sta fl
 rts
rd2 cmp #4
 bne rd3
 lda nl
 sec
 sbc #1
 sta cl
 lda #0
 sta cc
 lda #2
 sta fl
 rts
rd3 sec
 sbc #5
 sta cmode
 rts

ribbon
 lda #0
 sta bi
 sta tmp
rbl ldx tmp
 lda #' '
 cpx cmode
 bne rb1
 lda #'['
rb1 jsr putc
 ldx tmp
 lda tabl,x
 pha
 lda tabh,x
 tax
 pla
 jsr putstr
 ldx tmp
 lda #' '
 cpx cmode
 bne rb2
 lda #']'
rb2 jsr putc
 inc tmp
 lda tmp
 cmp #4
 bne rbl
 lda #'|'
 jsr putc
 lda #' '
 jsr putc
 ldx cmode
 lda tooll,x
 pha
 lda toolh,x
 tax
 pla
 jsr putstr
 lda #0
 jsr putc
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #$FF
 sta rr
 jsr rowsetup
 jmp drawtext

bar
 lda #0
 sta bi
 lda cmdon
 beq br1
 lda #<s6
 ldx #>s6
 jsr putstr
 ldx clen
 lda #'_'
 sta CMDB,x
 lda #0
 sta CMDB+1,x
 lda #<CMDB
 ldx #>CMDB
 jsr putstr
 jmp br9
br1 lda cmsg
 bne br2
 lda #<helpmsg
 ldx #>helpmsg
 jmp br8
br2 cmp #1
 bne br3
 lda #<s7
 ldx #>s7
 jmp br8
br3 lda #<s8
 ldx #>s8
br8 jsr putstr
br9 lda #0
 jsr putc
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #ROWS+1
 sta rr
 jsr rowsetup
 jmp drawtext

tn0 dta c'Edit',b(0)
tn1 dta c'Format',b(0)
tn2 dta c'Insert',b(0)
tn3 dta c'File',b(0)
tabl dta l(tn0),l(tn1),l(tn2),l(tn3)
tabh dta h(tn0),h(tn1),h(tn2),h(tn3)
tl0 dta c'^B Bold ^I Ital ^U Undl ^X Cmd',b(0)
tl1 dta c'Align Size Margins Page',b(0)
tl2 dta c'Box Line Art Font',b(0)
tl3 dta c'Open Save Print Preview',b(0)
tooll dta l(tl0),l(tl1),l(tl2),l(tl3)
toolh dta h(tl0),h(tl1),h(tl2),h(tl3)
cmdtab dta c'bold',b(0),c'italic',b(0),c'underline',b(0),c'top',b(0),c'end',b(0)
 dta c'edit',b(0),c'format',b(0),c'insert',b(0),c'file',b(0),b(0)
s6 dta c'Command: ',b(0)
s7 dta c'Done.',b(0)
s8 dta c'Unknown command. Try: bold italic underline top end edit format insert file',b(0)

; scrolling
scrolldown
 inc top
 lda #<(SCR+640)
 sta src
 lda #>(SCR+640)
 sta src+1
 lda #<(SCR+320)
 sta dst
 lda #>(SCR+320)
 sta dst+1
 ldx #25
 ldy #0
sd1 lda (src),y
 sta (dst),y
 iny
 bne sd1
 inc src+1
 inc dst+1
 dex
 bne sd1
 lda #ROWS-1
 sta rr
 lda top
 clc
 adc #ROWS-1
 sta t0
 lda #0
 sta fl
 jmp drawdoc

scrollup
 dec top
 lda #<(SCR+6720)
 sta src
 lda #>(SCR+6720)
 sta src+1
 lda #<(SCR+7040)
 sta dst
 lda #>(SCR+7040)
 sta dst+1
 ldx #25
su2 dec src+1
 dec dst+1
 ldy #0
su3 dey
 lda (src),y
 sta (dst),y
 cpy #0
 bne su3
 dex
 bne su2
 lda #0
 sta rr
 lda top
 sta t0
 sta fl
 jmp drawdoc

visible
 lda cl
 cmp top
 bcs vb
 lda top
 sec
 sbc cl
 cmp #1
 bne vtop
 lda fl
 cmp #2
 beq vtop
 jmp scrollup
vtop
 lda cl
 sta top
 lda #2
 sta fl
 rts
vb lda cl
 sec
 sbc top
 cmp #ROWS
 bcc vok
 bne vbot
 lda fl
 cmp #2
 beq vbot
 jmp scrolldown
vbot
 lda cl
 sec
 sbc #ROWS-1
 sta top
 lda #2
 sta fl
vok rts

; key handling
handle
 lda cmdon
 beq hn0
 jmp cmdkey
hn0 lda kk
 cmp #$18
 bne hn1
 lda #1
 sta cmdon
 sta bd
 lda #0
 sta clen
 sta cmsg
 rts
hn1 cmp #$7F
 bne hn2
 lda cmode
 clc
 adc #1
 and #3
 sta cmode
 lda #1
 sta bd
 rts
hn2 cmp #$1C
 bne h1
 jmp kup
h1 cmp #$1D
 bne h2
 jmp kdown
h2 cmp #$1E
 bne h3
 jmp kleft
h3 cmp #$1F
 bne h4
 jmp kright
h4 cmp #$7E
 bne h5
 jmp delete
h5 cmp #$9B
 bne h6
 lda #13
 jmp insert
h6 cmp #2
 bne h7
 lda #1
 jmp insert
h7 cmp #9
 bne h8
 lda #2
 jmp insert
h8 cmp #$15
 bne h9
 lda #3
 jmp insert
h9 cmp #32
 bcc hx
 cmp #127
 bcs hx
 jmp insert
hx rts

curptr
 ldx cl
 lda LPL,x
 clc
 adc cc
 sta src
 lda LPH,x
 adc #0
 sta src+1
 rts

linelen
 ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldy #0
ll1 lda (tp),y
 beq ll2
 cmp #13
 beq ll2
 iny
 bne ll1
ll2 tya
 rts

clamp
 jsr linelen
 cmp cc
 bcs cl1
 sta cc
cl1 rts

kup
 lda cl
 beq ku1
 dec cl
 jsr clamp
ku1 rts

kdown
 lda cl
 clc
 adc #1
 cmp nl
 bcs kd1
 inc cl
 jsr clamp
kd1 rts

kleft
 lda cc
 beq kl1
 dec cc
kl1 rts

kright
 jsr linelen
 cmp cc
 beq kr1
 inc cc
kr1 rts

memup
 lda dend
 sec
 sbc src
 sta lo
 lda dend+1
 sbc src+1
 sta hi
 lda dend
 clc
 adc #1
 sta gp
 lda dend+1
 adc #0
 sta gp+1
 lda dend
 clc
 adc #2
 sta sp
 lda dend+1
 adc #0
 sta sp+1
 lda src
 clc
 adc #1
 sta dst
 lda src+1
 adc #0
 sta dst+1
 ldx hi
 beq mu2
mu1 dec gp+1
 dec sp+1
 ldy #0
mu1b dey
 lda (gp),y
 sta (sp),y
 cpy #0
 bne mu1b
 dex
 bne mu1
mu2 ldy lo
mu3 lda (src),y
 sta (dst),y
 dey
 cpy #$FF
 bne mu3
 rts

insert
 sta tmp
 jsr curptr
 jsr memup
 inc16 dend
in4 ldy #0
 lda tmp
 sta (src),y
 cmp #13
 bne in5
 inc cl
 lda #0
 sta cc
 lda #2
 sta fl
 jmp scan
in5 inc cc
 lda #1
 sta fl
 ldx cl
 inx
in7 cpx nl
 bcs in8
 inc LPL,x
 bne in9
 inc LPH,x
in9 inx
 bne in7
in8 jsr linelen
 cmp cc
 bne in6
 lda #3
 sta fl
in6 rts

delete
 lda cc
 bne dl1
 lda cl
 beq dlx
 ldx cl
 lda LPL,x
 sec
 sbc #1
 sta src
 lda LPH,x
 sbc #0
 sta src+1
 dex
 lda src
 sec
 sbc LPL,x
 sta cc
 dec cl
 lda #2
 sta fl
 jmp dl2
dl1 dec cc
 jsr curptr
 lda #1
 sta fl
dl2 ldy #1
 lda (src),y
 ldy #0
 sta (src),y
 cmp #0
 beq dl3
 inc16 src
 jmp dl2
dl3 jmp scan
dlx rts

; status line
putc
 ldx bi
 sta BUF,x
 inc bi
 rts

putstr
 sta src
 stx src+1
 ldy #0
ps1 lda (src),y
 beq ps2
 jsr putc
 iny
 bne ps1
ps2 rts

putnum
 sta tmp
 ldx #'0'
pn1 lda tmp
 cmp #100
 bcc pn2
 sbc #100
 sta tmp
 inx
 bne pn1
pn2 ldy #0
 cpx #'0'
 beq pn3
 txa
 jsr putc
 ldy #1
pn3 ldx #'0'
pn4 lda tmp
 cmp #10
 bcc pn5
 sbc #10
 sta tmp
 inx
 bne pn4
pn5 cpx #'0'
 bne pn6
 cpy #0
 beq pn7
pn6 txa
 jsr putc
pn7 lda tmp
 clc
 adc #'0'
 jmp putc

status
 lda #0
 sta bi
 lda #<s1
 ldx #>s1
 jsr putstr
 lda cl
 clc
 adc #1
 jsr putnum
 lda #<s2
 ldx #>s2
 jsr putstr
 lda cc
 jsr putnum
 lda #<s3
 ldx #>s3
 jsr putstr
 lda mfull
 jsr putnum
 lda #<s4
 ldx #>s4
 jsr putstr
 lda mscr
 jsr putnum
 lda #<s5
 ldx #>s5
 jsr putstr
 lda mkey
 jsr putnum
 lda #'f'
 jsr putc
 lda #0
 jsr putc
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #ROWS
 sta rr
 jsr rowsetup
 jmp drawtext

s1 dta c'Ln ',b(0)
s2 dta c' Col ',b(0)
s3 dta c'  full ',b(0)
s4 dta c'f  scroll ',b(0)
s5 dta c'f  key ',b(0)
kname dta c'K:',b($9B)
helpmsg dta c'^X command  Tab mode  ^B bold ^I italic ^U underline  Ctrl-arrows move',b(0)

 .macro body
 dta b(1),c'ACWord',b(1),c' hi-res page: 64 columns x 21 lines',b(13)
 dta c'Normal, ',b(1),c'bold',b(1),c', ',b(2),c'italic',b(2),c' and ',b(4-1),c'underline',b(3),c' text.',b(13)
 dta c'The quick brown fox jumps over a lazy dog 0123456789',b(13)
 dta b(13)
 dta c'Every glyph is drawn bit by bit at 5 pixels per',b(13)
 dta c'character, so 64 columns fit across the page and',b(13)
 dta c'the cursor can sit on any of 21 text lines.',b(13)
 dta b(13)
 dta b(1),b(2),c'Bold italic',b(2),b(1),c' works too, and ',b(3),b(1),c'bold underline',b(1),b(3),c'.',b(13)
 dta c'Type here: letters insert, Return splits a line,',b(13)
 dta c'backspace deletes and joins lines, Ctrl-arrows move',b(13)
 dta b(13)
 dta c'Scrolling is a block copy of 21 rows followed by',b(13)
 dta c'drawing a single new line at the edge.',b(13)
 dta b(13)
 dta c'Objects, not bitmaps: the document is a short',b(13)
 dta c'text stream with style codes, so it stays tiny.',b(13)
 dta b(13)
 dta c'A 1-page document fits in a few KB on a stock',b(13)
 dta c'64K XL or XE, leaving the rest for art and fonts.',b(13)
 dta b(13)
 dta c'-- end of this block --',b(13)
 .endm

 org DOC
 body
 body
 dta b(0)

 org $9200
dl :3 dta $70
 dta $4F,a(SCR)
 :99 dta $0F
 dta $4F,a(SCR+4000)
 :91 dta $0F
 dta $41,a(dl)

 org $9400
 icl 'font4.inc'

 run start
