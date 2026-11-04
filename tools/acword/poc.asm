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
COLS = $06C0
ROWL = $0700
ROWH = $0720
ROWS = 22

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
mkey = $A2

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
 sta fl
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
 lda #<helpmsg
 sta tp
 lda #>helpmsg
 sta tp+1
 lda #ROWS+1
 sta rr
 jsr rowsetup
 jsr drawtext
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
 jsr visible
 lda fl
 cmp #2
 bne lp1
 jsr full
 jmp lp2
lp1 cmp #1
 bne lp2
 jsr redrawcur
lp2 jsr tend
 sta mkey
 jsr status
 jmp loop

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
 sta pbv
 sta shv
 tax
mt1 lda pbv
 sta COLB,x
 lda shv
 sta COLS,x
 lda shv
 clc
 adc #6
 cmp #8
 bcc mt2
 sbc #8
 inc pbv
mt2 sta shv
 inx
 cpx #53
 bne mt1
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
 ldx rr
 lda ROWL,x
 sta rs
 sta sp
 lda ROWH,x
 sta rs+1
 sta sp+1
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
 jsr drawchar
 inc col
 lda col
 cmp #53
 beq dtend
dtnext
 inc16 tp
 jmp dt1
dtend rts

; A = ascii; draws at col on the row in rs
drawchar
 cmp #96
 bcs dc1
 sec
 sbc #32
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
 adc #$E0
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
 lda #0
 sta ry
dc2 ldy ry
 lda (gp),y
 asl
 sta v
 lda style
 and #2
 beq dc5
 cpy #3
 bcs dc3
 lsr v
 lsr v
 jmp dc5
dc3 cpy #5
 bcc dc5
 asl v
 asl v
dc5 lda style
 and #1
 beq dc6
 lda v
 lsr
 ora v
 sta v
dc6 lda style
 and #4
 beq dc7
 cpy #7
 bne dc7
 lda #$FC
 sta v
dc7 lda v
 sta hi
 lda #0
 sta lo
 ldx shf
 beq dc9
dc8 lsr hi
 ror lo
 dex
 bne dc8
dc9 ldy #0
 lda (sp),y
 ora hi
 sta (sp),y
 iny
 lda (sp),y
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

; scrolling
scrolldown
 inc top
 lda #<(SCR+320)
 sta src
 lda #>(SCR+320)
 sta src+1
 lda #<SCR
 sta dst
 lda #>SCR
 sta dst+1
 ldx #26
 ldy #0
sd1 lda (src),y
 sta (dst),y
 iny
 bne sd1
 inc src+1
 inc dst+1
 dex
 bne sd1
sd2 lda (src),y
 sta (dst),y
 iny
 cpy #64
 bne sd2
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
 lda #<(SCR+6656)
 sta src
 lda #>(SCR+6656)
 sta src+1
 lda #<(SCR+320+6656)
 sta dst
 lda #>(SCR+320+6656)
 sta dst+1
 ldy #63
su1 lda (src),y
 sta (dst),y
 dey
 bpl su1
 ldx #26
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
 lda kk
 cmp #$1C
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

insert
 sta tmp
 jsr curptr
 lda src
 sta dst
 lda src+1
 sta dst+1
in1 ldy #0
 lda (dst),y
 beq in2
 inc16 dst
 jmp in1
in2 ldy #0
 lda (dst),y
 iny
 sta (dst),y
 lda dst
 cmp src
 bne in3
 lda dst+1
 cmp src+1
 beq in4
in3 dec16 dst
 jmp in2
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
 jmp scan

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
helpmsg dta c'^B bold ^I italic ^U underline  Ctrl-arrows move',b(0)

 .macro body
 dta b(1),c'ACWord',b(1),c' hi-res page: 320 x 176 pixels',b(13)
 dta c'Normal, ',b(1),c'bold',b(1),c', ',b(2),c'italic',b(2),c' and ',b(4-1),c'underline',b(3),c' text.',b(13)
 dta c'The quick brown fox jumps over a lazy dog 0123456789',b(13)
 dta b(13)
 dta c'Every glyph is drawn bit by bit at 6 pixels per',b(13)
 dta c'character, so 53 columns fit across the page and',b(13)
 dta c'the cursor can sit on any of 22 text lines.',b(13)
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

 run start
