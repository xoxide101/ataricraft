; ACWord proof of concept: 320x192 1-bit page, 6px glyphs, bold/italic/underline,
; typing, scrolling, and frame timing. Stock 64K XL/XE. Build: mads poc.asm -o:poc.xex
SDMCTL = $022F
SDLSTL = $0230
COLOR1 = $02C5
COLOR2 = $02C6
COLOR4 = $02C8
VDSLST = $0200
NMIEN  = $D40E
WSYNC  = $D40A
COLPF1 = $D017
COLPF2 = $D018
tcb    = $BB
tci    = $BC
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
ROWS = 20

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
cnt  = $AF
rz   = $B3
zs   = $B4
rc   = $B5
rn   = $B6
lm   = $B7
rm   = $B8
iv   = $B9
th   = $BA
mn   = $BD
bf   = $BE
lim  = $BF
lft  = $C0
px   = $C1
cv   = $C3
tbm  = $C4
tbi  = $C5
i1   = $C6
i2   = $C7
ug   = $C8
gw   = $C9
cx   = $CA
ck   = $CB
pold = $CC
mhl  = $CD
cst  = $CE
rfl  = $CF
rfk  = $D0
rfc  = $D1
rfj  = $D2
pal  = $D3
pam  = $D4
pln  = $D5
scl  = $D6
scc  = $D7
pao  = $D8
jsn  = $D9
jq   = $DA
jr   = $DB
jon  = $DC
ptm  = $DD
psl  = $DE
psx  = $DF
psb  = $E0
pcs  = $E1
pch1 = $E2
pidx = $E3
pof  = $E4
pbu  = $E5
pwd  = $E6
lwx  = $E7
pfn  = $E8
pwi  = $E9
pwh  = $EA
ps   = $B0
sd   = $B1
lt   = $B2

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
 lda #$0F
 sta tcb
 lda #0
 sta tci
 lda #<dli1
 sta VDSLST
 lda #>dli1
 sta VDSLST+1
 lda #$C0
 sta NMIEN
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
 sta ps
 sta sd
 sta lm
 sta iv
 sta mn
 sta th
 sta mhl
 sta rz
 lda #63
 sta rm
 lda #0
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
 bne lgot
 lda sd
 beq loop
 lda RTCLOK+2
 sec
 sbc lt
 cmp #30
 bcc loop
 lda #0
 sta sd
 jsr status
 jmp loop
lgot
 lda RTCLOK+2
 sta tm
 jsr getkey
 sta kk
 lda #0
 sta fl
 jsr handle
 jsr fixcc
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
 lda kk
 cmp #32
 bcc lsync
 cmp #127
 bcs lsync
 cmp #'.'
 bne lq1
 lda #1
 sta ps
 bne ldefer
lq1 cmp #32
 bne lq2
 lda ps
 beq ldefer
 cmp #1
 bne lsync
 lda #2
 sta ps
 bne ldefer
lq2 lda #0
 sta ps
ldefer lda #1
 sta sd
 lda RTCLOK+2
 sta lt
 jmp lq3
lsync lda #0
 sta ps
 sta sd
 jsr status
lq3 lda bd
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
 beq sc4
 cmp #14
 bne sc2
sc4 jmp sc1
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
 lda lm
 bne apr
 lda #15
 sta pcs
 lda #32
 sta pch1
 ldx cl
 jsr pfind
 beq apc
apr
 jmp redrawcur
apc
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
 sta pfn
 sta pwi
 sta pwh
 sta col
 sta style
 sta bf
 lda #64
 sta lim
 lda rr
 cmp #$FF
 beq dt0
 cmp #$FE
 beq dtb
 cmp #ROWS
 bcc dt0
dtb inc bf
 lda #53
 sta lim
dt0 lda rr
 cmp #$FE
 beq dtpx
 cmp #ROWS+1
 bne dtal
 lda mn
 cmp #2
 bne dtal
dtpx jmp pxtext
dtal lda bf
 beq dtal2
 jmp dt1
dtal2 ldx t0
 jsr pstyle
 sta style
 ldx t0
 jsr paln
 sta pam
 ldx t0
 jsr lwid
 sta pwd
 lda #22
 sta pcs
 lda #24
 sta pch1
 ldx t0
 jsr pfind
 sta pfn
 lda #0
 sta jon
 sta jsn
 ldy #0
 ldx #0
dla1 lda (tp),y
 beq dla9
 cmp #13
 beq dla9
 cmp #14
 beq dla9
 cmp #5
 bcc dla2
 cmp #15
 bcc dlav
 cmp #32
 bcc dla2
dlav cmp #32
 bne dlax
 inc jsn
dlax inx
dla2 iny
 bne dla1
dla9 stx pln
 lda (tp),y
 sta ptm
 lda pwd
 sec
 sbc pln
 bcs dla4
 lda #0
dla4 sta pln
 lda #0
 ldx pam
 cpx #16
 bne dlc
 lda pln
 ldx pwi
 beq dlr
 asl
dlr jmp dlb
dlc cpx #15
 bne dld
 lda pln
 ldx pwi
 bne dlb
 lsr
 jmp dlb
dld cpx #17
 bne dlb
 lda pwi
 beq dld2
 lda #0
 beq dlb
dld2 lda ptm
 cmp #14
 bne dlb
 lda jsn
 beq dlb
 lda pln
 beq dlb
 ldx #0
dlq cmp jsn
 bcc dlq2
 sbc jsn
 inx
 bne dlq
dlq2 sta jr
 stx jq
 lda #1
 sta jon
 lda #0
dlb clc
 adc lm
 clc
 adc pof
 sta col
 lda pbu
 beq dt1
 lda t0
 cmp pal
 bne dt1
 lda col
 pha
 lda lm
 sta col
 ldx #'*'
 lda pbu
 cmp #19
 beq dlbb
 ldx #'-'
dlbb txa
 jsr drawchar
 pla
 sta col
dt1 ldy #0
 lda (tp),y
 beq dtend
 cmp #13
 beq dtend
 cmp #14
 beq dtend
 cmp #5
 bcc dtsty
 cmp #15
 bcc dtchar
 cmp #32
 bcs dtchar
 jmp dtnext
dtsty tax
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
 ldx bf
 bne dtc6
 jsr drawchar
 jsr wide2
 jmp dtskip
dtc6 jsr drawchar6
dtskip
 inc col
 jsr wadd
 lda jon
 beq dtj2
 ldy #0
 lda (tp),y
 cmp #32
 bne dtj2
 lda col
 clc
 adc jq
 sta col
 lda jr
 beq dtj2
 dec jr
 inc col
dtj2 lda col
 cmp lim
 bcs dtend
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
 jsr bld
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
dc8 lda style
 and #8
 beq dc9
 lda v
 eor #$1F
 sta v
dc9 jsr lite
 lda v
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

stab dta b(1),b(2),b(4),b(8)

wide2 lda pwi
 beq w29
 inc col
 lda #1
 sta pwh
 ldy #0
 lda (tp),y
 jsr drawchar
 lda #0
 sta pwh
 dec col
w29 rts

wadd lda pwi
 beq wa9
 inc col
wa9 rts

WL dta b(0),b(0),b(0),b(0),b(1),b(1),b(1),b(1),b(6),b(6),b(6),b(6),b(7),b(7),b(7),b(7),b(24),b(24),b(24),b(24),b(25),b(25),b(25),b(25),b(30),b(30),b(30),b(30),b(31),b(31),b(31),b(31)
WR dta b(0),b(3),b(12),b(15),b(16),b(19),b(28),b(31),b(0),b(3),b(12),b(15),b(16),b(19),b(28),b(31),b(0),b(3),b(12),b(15),b(16),b(19),b(28),b(31),b(0),b(3),b(12),b(15),b(16),b(19),b(28),b(31)

bld ldx pfn
 cpx #23
 bne bl9
 ora #1
bl9 rts

lite lda pfn
 cmp #22
 bne lt1
 lda ry
 and #1
 beq lt1
 lda v
 and #$15
 sta v
lt1 lda pwi
 beq lt9
 ldx v
 lda pwh
 bne lt2
 lda WL,x
 sta v
 rts
lt2 lda WR,x
 sta v
lt9 rts

; 5x7 bar font, 6px pitch: A = ascii; draws at col on the row in rs
drawchar6
 cmp #128
 bcc d60
 lda #32
d60 sec
 sbc #32
 bcs d61
 lda #0
d61 sta gp
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
 adc #>BFNT
 sta gp+1
 lda #0
 sta lft
 lda style
 and #8
 beq d6n
 lda col
 beq d6n
 inc lft
d6n lda col
 asl
 clc
 adc col
 ldx lft
 beq d6o
 sec
 sbc #1
d6o pha
 lsr
 lsr
 clc
 adc rs
 sta sp
 lda rs+1
 adc #0
 sta sp+1
 pla
 and #3
 asl
 ldx lft
 beq d6p
 clc
 adc #1
d6p sta shf
 lda #$FC
 ldx lft
 beq d6q
 lda #$FE
d6q sta mh
 lda #0
 sta ml
 ldx shf
 beq d63
d62 lsr mh
 ror ml
 dex
 bne d62
d63 lda mh
 eor #$FF
 sta mh
 lda ml
 eor #$FF
 sta ml
 lda #0
 sta ry
d64 ldy ry
 lda (gp),y
 sta v
 lda style
 and #1
 beq d65
 lda v
 lsr
 ora v
 and #$FC
 sta v
d65 lda style
 and #2
 beq d66
 ldy ry
 cpy #4
 bcs d66
 lsr v
d66 lda style
 and #4
 beq d67
 ldy ry
 cpy #7
 bne d67
 lda #$FC
 sta v
d67 lda style
 and #8
 beq d68
 lda lft
 beq d67a
 lsr v
 lda v
 eor #$FE
 sta v
 jmp d68
d67a lda v
 eor #$FC
 sta v
d68 lda v
 sta hi
 lda #0
 sta lo
 ldx shf
 beq d6a
d69 lsr hi
 ror lo
 dex
 bne d69
d6a ldy #0
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
 bcc d6b
 inc sp+1
d6b inc ry
 lda ry
 cmp #8
 beq d6c
 jmp d64
d6c rts

; Pixel-graphics text for the menu bar and item line.
; Codes: 1 = selected-name box, 4 = hotkey box (both inverse; they cancel when nested),
; 3 = underline. Glyphs use proportional widths with a 1px gap.
pxtext
 lda #0
 sta px
 sta px+1
 sta i1
 sta i2
 sta ug
pt1 ldy #0
 lda (tp),y
 beq ptend
 cmp #13
 beq ptend
 cmp #5
 bcs ptchr
 cmp #3
 beq ptul
 ldx #0
 cmp #1
 bne pt4
 lda mhl
 bne pttog
 beq ptul
pt4 cmp #4
 bne ptnext
 ldx #1
pttog lda i1,x
 eor #1
 sta i1,x
 lda i1
 eor i2
 beq ptp0
 lda #$FF
ptp0 jsr putcol
 jsr pxinc
 jmp ptnext
ptul lda ug
 eor #1
 sta ug
ptnext inc16 tp
 jmp pt1
ptend rts

ptchr cmp #128
 bcc pc0
 lda #32
pc0 sec
 sbc #32
 bcs pc1
 lda #0
pc1 sta gp
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
 adc #>BFNT
 sta gp+1
 ldy #7
 lda #0
pcw1 ora (gp),y
 dey
 bpl pcw1
 and #$F8
 sta cv
 bne pcwn
 ldx #3
 jmp pcw3
pcwn ldx #5
pcw2 lda cv
 and #8
 bne pcw3
 lsr cv
 dex
 bne pcw2
pcw3 stx gw
 ldx #0
 stx cx
pcl ldx cx
 cpx gw
 bne pcg
 lda #0
 jmp pcu
pcg lda bm8,x
 sta ck
 ldy #0
pcr lda (gp),y
 and ck
 cmp #1
 rol cv
 iny
 cpy #8
 bne pcr
 lda cv
pcu sta cv
 lda ug
 beq pci
 lda cv
 ora #1
 sta cv
pci lda i1
 eor i2
 beq pcp
 lda cv
 eor #$FF
 sta cv
pcp lda cv
 jsr putcol
 jsr pxinc
 inc cx
 ldx cx
 cpx gw
 beq pcl
 bcc pcl
 jmp ptnext

pxinc
 inc px
 bne pxi1
 inc px+1
pxi1 rts

; A = 8-pixel column bitmap (bit 7 = top scanline) drawn at pixel px on the row in rs
putcol
 sta cv
 lda px+1
 lsr
 lda px
 ror
 lsr
 lsr
 cmp #40
 bcs pcrt
 clc
 adc rs
 sta sp
 lda rs+1
 adc #0
 sta sp+1
 lda px
 and #7
 tax
 lda bm8,x
 sta tbm
 eor #$FF
 sta tbi
 ldx #8
 ldy #0
pcl1 asl cv
 bcc pcc
 lda (sp),y
 ora tbm
 jmp pcwr
pcc lda (sp),y
 and tbi
pcwr sta (sp),y
 lda sp
 clc
 adc #40
 sta sp
 bcc pcn
 inc sp+1
pcn dex
 bne pcl1
pcrt rts

bm8 dta b($80),b($40),b($20),b($10),b($08),b($04),b($02),b($01)

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

; --- app command layer (shell is in ribbon.inc) ---
cmdexec
 cmp #29
 bcc ce0
 lda #17
ce0 tax
 lda cejh,x
 pha
 lda cejl,x
 pha
 rts

hst txa
 clc
 adc #1
 jmp insert
htop lda #0
 sta cl
 sta cc
 lda #2
 sta fl
 rts
hend lda nl
 sec
 sbc #1
 sta cl
 lda #0
 sta cc
 lda #2
 sta fl
 rts
hmenu txa
 sec
 sbc #11
 sta cmode
 lda #2
 sta mn
 lda #1
 sta bd
 rts
hlin lda #64
 sta cnt
cnl lda #'-'
 jsr insert
 dec cnt
 bne cnl
 lda #2
 sta fl
 lda #1
 sta bd
 rts
hnew lda #0
 sta DOC
 sta cl
 sta cc
 sta top
 jsr scan
 lda #2
 sta fl
 rts
hsize lda #3
 sta cmsg
 rts
hrul lda rz
 eor #1
 sta rz
 jmp ruler
hbar lda iv
 eor #1
 sta iv
 jmp status
hstub lda #4
 sta cmsg
 rts
hhil lda mhl
 eor #1
 sta mhl
 rts
hmar lda lm
 beq hm1
 cmp #4
 beq hm2
 lda #0
 sta lm
 lda #63
 sta rm
 jsr status
 lda #2
 sta fl
 rts
hm1 lda #4
 sta lm
 lda #59
 sta rm
 jsr status
 lda #2
 sta fl
 rts
hm2 lda #8
 sta lm
 lda #55
 sta rm
 jsr status
 lda #2
 sta fl
 rts
; paragraph alignment: an invisible marker byte at the start of the paragraph's first line (15 centre, 16 right)
hal lda #0
 beq hsa
hac lda #15
 bne hsa
har lda #16
 bne hsa
haj lda #17
hsa sta pam
 lda #15
 sta pcs
 lda #18
 sta pch1
hset lda cl
 sta scl
 lda cc
 sta scc
 ldx cl
 jsr pfind
 sta pao
 lda pal
 sta cl
 lda pao
 beq hs1
 ldx pidx
 inx
 stx cc
 jsr delete
 lda scl
 cmp cl
 bne hs1
 lda scc
 cmp pidx
 bcc hs1
 beq hs1
 dec scc
hs1 lda pam
 beq hs2
 lda #0
 sta cc
 lda pam
 jsr insert
 lda scl
 cmp cl
 bne hs2
 inc scc
hs2 lda scl
 sta cl
 lda scc
 sta cc
 lda #2
 sta fl
 rts

hind lda #18
 sta pcs
 lda #19
 sta pch1
 ldx cl
 jsr pfind
 beq hi1
 lda #0
 beq hi2
hi1 lda #18
hi2 sta pam
 jmp hset
hbul lda #19
 sta pcs
 lda #21
 sta pch1
 ldx cl
 jsr pfind
 beq hb1
 cmp #19
 beq hb2
 lda #0
 beq hb3
hb1 lda #19
 bne hb3
hb2 lda #20
hb3 sta pam
 jmp hset

hlg lda #25
 bne hsz
hsm lda #0
hsz sta pam
 lda #25
 sta pcs
 lda #26
 sta pch1
 jmp hset

hfont lda #22
 sta pcs
 lda #24
 sta pch1
 ldx cl
 jsr pfind
 beq hf1
 cmp #22
 beq hf2
 lda #0
 beq hf3
hf1 lda #22
 bne hf3
hf2 lda #23
hf3 sta pam
 jmp hset

hcol lda th
 eor #1
 sta th
 beq ct0
 lda #$94
 sta tcb
 lda #$0A
 sta tci
 sta COLOR2
 lda #0
 sta COLOR1
 rts
ct0 lda #$0F
 sta tcb
 sta COLOR2
 lda #0
 sta tci
 sta COLOR1
 rts

cejl dta l(hst-1),l(hst-1),l(hst-1),l(htop-1),l(hend-1),l(hnew-1),l(hsize-1),l(hrul-1),l(hbar-1),l(hcol-1),l(hlin-1)
 dta l(hmenu-1),l(hmenu-1),l(hmenu-1),l(hmenu-1),l(hmenu-1),l(hmenu-1),l(hstub-1),l(hhil-1),l(hmar-1),l(hal-1),l(hac-1),l(har-1),l(haj-1),l(hind-1),l(hbul-1),l(hfont-1),l(hlg-1),l(hsm-1)
cejh dta h(hst-1),h(hst-1),h(hst-1),h(htop-1),h(hend-1),h(hnew-1),h(hsize-1),h(hrul-1),h(hbar-1),h(hcol-1),h(hlin-1)
 dta h(hmenu-1),h(hmenu-1),h(hmenu-1),h(hmenu-1),h(hmenu-1),h(hmenu-1),h(hstub-1),h(hhil-1),h(hmar-1),h(hal-1),h(hac-1),h(har-1),h(haj-1),h(hind-1),h(hbul-1),h(hfont-1),h(hlg-1),h(hsm-1)

; menu keys: Esc opens, then a menu letter, then an item letter
menuopen
 lda #1
 sta mn
 sta bd
 lda #0
 sta cmsg
 rts

menukey
 lda kk
 cmp #$1B
 bne mk1
 lda #0
 sta mn
 lda #1
 sta bd
 rts
mk1 cmp #$7F
 bne mk2
 jsr ribnext
 lda #2
 sta mn
 rts
mk2 cmp #$1F
 bne mk3
 jsr ribnext
 lda #2
 sta mn
 rts
mk3 cmp #$1E
 bne mk4
 jsr ribprev
 lda #2
 sta mn
 rts
mk4 cmp #'a'
 bcc mk5
 cmp #'{'
 bcs mk5
 sec
 sbc #$20
mk5 sta kk
 lda mn
 cmp #1
 bne mk7
 ldx #0
mk6 lda mhot,x
 cmp kk
 beq mk6f
 inx
 cpx #NMENU
 bne mk6
 rts
mk6f stx cmode
 lda #2
 sta mn
 lda #1
 sta bd
 rts
mk7 ldx cmode
 lda ipl,x
 sta src
 lda iph,x
 sta src+1
 ldy #0
mk8 lda (src),y
 beq mk9
 cmp kk
 beq mk8f
 iny
 iny
 bne mk8
mk8f iny
 lda (src),y
 pha
 lda #0
 sta mn
 lda #1
 sta cmsg
 sta bd
 pla
 jmp cmdexec
mk9 rts

items
 ldx cmode
 lda itl,x
 pha
 lda ith,x
 tax
 pla
 jmp putstr

mhot dta c'FESCPD'
ipl dta l(ip0),l(ip1),l(ip2),l(ip3),l(ip4),l(ip5)
iph dta h(ip0),h(ip1),h(ip2),h(ip3),h(ip4),h(ip5)
ip0 dta c'N',b(5),c'O',b(17),c'S',b(17),c'A',b(17),c'X',b(17),b(0)
ip1 dta c'U',b(17),c'T',b(17),c'C',b(17),c'P',b(17),c'O',b(3),c'E',b(4),b(0)
ip2 dta c'F',b(17),c'N',b(17),c'R',b(17),c'G',b(17),b(0)
ip3 dta c'R',b(17),c'B',b(0),c'I',b(1),c'U',b(2),c'S',b(28),c'L',b(27),c'O',b(26),b(0)
ip4 dta c'L',b(20),c'C',b(21),c'R',b(22),c'J',b(23),c'B',b(25),c'I',b(24),b(0)
ip5 dta c'R',b(7),c'T',b(17),c'M',b(19),c'B',b(8),c'C',b(9),c'Z',b(6),c'L',b(10),c'H',b(18),b(0)

itl dta l(it0),l(it1),l(it2),l(it3),l(it4),l(it5)
ith dta h(it0),h(it1),h(it2),h(it3),h(it4),h(it5)
it0 dta b(3),c'N',b(3),c'ew  ',b(3),c'O',b(3),c'pen  ',b(3),c'S',b(3),c'ave  Save-',b(3),c'A',b(3),c's  E',b(3),c'x',b(3),c'it',b(0)
it1 dta b(3),c'U',b(3),c'ndo  Cu',b(3),c't',b(3),c'  ',b(3),c'C',b(3),c'opy  ',b(3),c'P',b(3),c'aste  T',b(3),c'o',b(3),c'p  ',b(3),c'E',b(3),c'nd',b(0)
it2 dta b(3),c'F',b(3),c'ind  ',b(3),c'N',b(3),c'ext  ',b(3),c'R',b(3),c'eplace  ',b(3),c'G',b(3),c'oto',b(0)
it3 dta b(3),c'R',b(3),c'egular ',b(3),c'B',b(3),c'old ',b(3),c'I',b(3),c'talic ',b(3),c'U',b(3),c'nderline ',b(3),c'S',b(3),c'maller ',b(3),c'L',b(3),c'arger F',b(3),c'o',b(3),c'nts',b(0)
it4 dta b(3),c'L',b(3),c'eft  ',b(3),c'C',b(3),c'enter  ',b(3),c'R',b(3),c'ight  ',b(3),c'J',b(3),c'ustify  ',b(3),c'B',b(3),c'ullet  ',b(3),c'I',b(3),c'ndent',b(0)
it5 dta b(3),c'R',b(3),c'uler  ',b(3),c'T',b(3),c'abs  ',b(3),c'M',b(3),c'argins  ',b(3),c'B',b(3),c'ars  ',b(3),c'C',b(3),c'olor  Si',b(3),c'z',b(3),c'e  ',b(3),c'L',b(3),c'ine  ',b(3),c'H',b(3),c'ilite',b(0)

dli1
 pha
 txa
 pha
 lda #<dli2
 sta VDSLST
 lda #>dli2
 sta VDSLST+1
 lda tci
 ldx tcb
 sta WSYNC
 sta COLPF1
 stx COLPF2
 pla
 tax
 pla
 rti

dli2
 pha
 txa
 pha
 lda #<dli1
 sta VDSLST
 lda #>dli1
 sta VDSLST+1
 lda COLOR1
 ldx COLOR2
 sta WSYNC
 sta COLPF1
 stx COLPF2
 pla
 tax
 pla
 rti

appmsg
 lda #<m1
 ldx #>m1
 jsr putstr
 lda nl
 jsr putnum
 lda #<m2
 ldx #>m2
 jsr putstr
 lda dend+1
 sec
 sbc #>DOC
 jsr putnum
 lda #<m3
 ldx #>m3
 jmp putstr

m1 dta c'Document: ',b(0)
m2 dta c' lines, about ',b(0)
m3 dta c' x 256 bytes.',b(0)

NMENU = 6
tn0 dta b(4),c'F',b(4),c'ile',b(0)
tn1 dta b(4),c'E',b(4),c'dit',b(0)
tn2 dta b(4),c'S',b(4),c'earch',b(0)
tn3 dta b(4),c'C',b(4),c'haracter',b(0)
tn4 dta b(4),c'P',b(4),c'aragraph',b(0)
tn5 dta b(4),c'D',b(4),c'ocument',b(0)
tabl dta l(tn0),l(tn1),l(tn2),l(tn3),l(tn4),l(tn5)
tabh dta h(tn0),h(tn1),h(tn2),h(tn3),h(tn4),h(tn5)
tl0 dta c'  Esc',b(0)
tooll dta l(tl0),l(tl0),l(tl0),l(tl0),l(tl0),l(tl0)
toolh dta h(tl0),h(tl0),h(tl0),h(tl0),h(tl0),h(tl0)
cmdtab dta c'bold',b(0),c'italic',b(0),c'underline',b(0),c'top',b(0),c'end',b(0)
 dta c'new',b(0),c'size',b(0),c'ruler',b(0),c'bars',b(0),c'color',b(0),c'line',b(0)
 dta c'file',b(0),c'edit',b(0),c'search',b(0),c'character',b(0),c'paragraph',b(0),c'document',b(0),b(0)

 icl 'ribbon.inc'

; scrolling
scrolldown
 inc top
 lda #<(SCR+960)
 sta src
 lda #>(SCR+960)
 sta src+1
 lda #<(SCR+640)
 sta dst
 lda #>(SCR+640)
 sta dst+1
 ldx #24
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
 ldx #24
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
hn0 lda mn
 beq hn0a
 jmp menukey
hn0a lda kk
 cmp #$1B
 bne hn0b
 jmp menuopen
hn0b lda kk
 cmp #$18
 bne hn1
 jmp cmdopen
hn1 cmp #$7F
 bne hn2
 jmp ribnext
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

; X = line; A = paragraph attribute marker found in the first line's header within pcs..pch1-1
; (0 = none); pal = the paragraph's first line, pidx = the marker's offset
pfind stx pal
pfd0 ldx pal
 beq pfd2
 dex
 lda LPL,x
 sta src
 lda LPH,x
 sta src+1
 ldy #0
pfd1 lda (src),y
 beq pfd2
 cmp #13
 beq pfd2
 cmp #14
 beq pfd3
 iny
 bne pfd1
 beq pfd2
pfd3 stx pal
 jmp pfd0
pfd2 ldx pal
 lda LPL,x
 sta src
 lda LPH,x
 sta src+1
 ldy #0
pfd4 lda (src),y
 cmp #15
 bcc pfd8
 cmp #32
 bcs pfd8
 cmp pcs
 bcc pfd5
 cmp pch1
 bcc pfd9
pfd5 iny
 bne pfd4
pfd8 lda #0
pfd9 sty pidx
 ora #0
 rts

; alignment marker (15 centre, 16 right, 17 justify) of the paragraph at line X
paln lda #15
 sta pcs
 lda #18
 sta pch1
 jmp pfind

; X = line; A = text width after indent and bullet; pof = offset, pbu = bullet marker
lwid stx lwx
 lda #0
 sta pof
 lda #18
 sta pcs
 lda #19
 sta pch1
 ldx lwx
 jsr pfind
 beq lw1
 lda lwx
 cmp pal
 bne lw1
 lda #4
 sta pof
lw1 lda #19
 sta pcs
 lda #21
 sta pch1
 ldx lwx
 jsr pfind
 sta pbu
 beq lw2
 lda pof
 clc
 adc #2
 sta pof
lw2 lda #25
 sta pcs
 lda #26
 sta pch1
 ldx lwx
 jsr pfind
 sta pwi
 lda rm
 sec
 sbc lm
 clc
 adc #1
 sec
 sbc pof
 ldx pwi
 beq lw3
 lsr
lw3 rts
; X = line; A = style bits carried into it from earlier lines of its paragraph
pstyle stx psl
 jsr paln
 lda #0
 sta psb
 lda pal
 sta psx
pst1 lda psx
 cmp psl
 bcs pst9
 tax
 lda LPL,x
 sta src
 lda LPH,x
 sta src+1
 ldy #0
pst2 lda (src),y
 beq pst3
 cmp #13
 beq pst3
 cmp #14
 beq pst3
 cmp #5
 bcs pst4
 tax
 lda stab-1,x
 eor psb
 sta psb
pst4 iny
 bne pst2
pst3 inc psx
 jmp pst1
pst9 lda psb
 rts

; keep the cursor after the paragraph header markers
fixcc ldx cl
 lda LPL,x
 sta src
 lda LPH,x
 sta src+1
 ldy #0
fx1 lda (src),y
 cmp #15
 bcc fx2
 cmp #32
 bcs fx2
 iny
 bne fx1
fx2 cpy cc
 bcc fx3
 sty cc
fx3 rts

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

; A = style bits in effect at the cursor (1 bold, 2 italic, 4 underline)
curstyle
 ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldx cl
 jsr pstyle
 sta cst
 ldy #0
cs1 cpy cc
 beq cs2
 lda (tp),y
 cmp #5
 bcs cs3
 tax
 lda stab-1,x
 eor cst
 sta cst
cs3 iny
 bne cs1
cs2 lda cst
 and #7
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
 cmp #14
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
 beq in4b
 cmp #14
 bne in5
in4b inc cl
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
in8 jsr reflow
 lda fl
 cmp #2
 beq in6
 jsr linelen
 cmp cc
 bne in6
 lda #3
 sta fl
in6 rts

; reflow: line breaks made by wrap are soft (byte 14). Starting at the cursor line (or the
; line above when that one ends in a soft break) join each soft break back into a space,
; then re-break at the last space that fits the right margin. Stops early once a break
; lands where it already was, since everything below is then unchanged.
reflow
 lda #0
 sta rfc
 sta rfj
 lda rm
 sec
 sbc lm
 clc
 adc #1
 sta cst
 lda cl
 sta rfl
 beq rf1
 tax
 dex
 jsr rfptr
 jsr rfterm
 cmp #14
 bne rf1
 dec rfl
rf1 lda #0
 sta rfj
 lda #$FF
 sta rfk
 ldx rfl
 jsr lwid
 sta cst
 ldx rfl
 jsr rfptr
 jsr rfterm
 cmp #14
 bne rf3
 sty rfk
 lda #32
 sta (tp),y
 lda cl
 sec
 sbc rfl
 cmp #1
 bne rf3
 lda cl
 sec
 sbc #1
 sta cl
 lda cc
 clc
 adc rfk
 clc
 adc #1
 sta cc
 lda #1
 sta rfj
rf3 ldy #0
 sty hi
 lda #$FF
 sta lo
rf4 lda (tp),y
 beq rf8
 cmp #13
 beq rf8
 cmp #5
 bcc rf7
 cmp #15
 bcc rfv
 cmp #32
 bcc rf7
rfv cmp #32
 bne rf6
 lda hi
 cmp cst
 beq rf5
 bcs rf6
rf5 sty lo
rf6 inc hi
rf7 iny
 bne rf4
rf8 lda hi
 cmp cst
 beq rf9
 bcs rf10
rf9 lda rfk
 cmp #$FF
 beq rfdone
 lda #1
 sta rfc
 jsr scan
 jmp rf1
rf10 lda lo
 cmp #$FF
 bne rf11
 lda rfk
 cmp #$FF
 beq rfnos
 bne rfsame
rf11 lda lo
 cmp rfk
 beq rfsame
 tay
 lda #14
 sta (tp),y
 lda cl
 cmp rfl
 bne rf12
 lda lo
 cmp cc
 bcs rf12
 lda cc
 sec
 sbc lo
 sec
 sbc #1
 sta cc
 inc cl
rf12 lda #1
 sta rfc
 inc rfl
 jsr scan
 jmp rf1
rfsame ldy rfk
 lda #14
 sta (tp),y
 lda rfj
 beq rfdone
 inc cl
 lda cc
 sec
 sbc rfk
 sec
 sbc #1
 sta cc
 jmp rfdone
rfnos lda cl
 cmp rfl
 bne rfdone
 lda cc
 beq rfdone
 dec cc
 lda #14
 jsr insert
 inc cc
 lda #2
 sta fl
 rts
rfdone lda rfc
 beq rfret
 lda #2
 sta fl
rfret rts

rfptr lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 rts

rfterm ldy #0
rft1 lda (tp),y
 beq rft2
 cmp #13
 beq rft2
 cmp #14
 beq rft2
 iny
 bne rft1
rft2 rts

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
dl3 jsr scan
 jmp reflow
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

putn16
 lda #0
 sta t0
 sta hi
pq1 ldx t0
 ldy #'0'
pq2 lda src
 sec
 sbc p1l,x
 pha
 lda src+1
 sbc p1h,x
 bcc pq3
 sta src+1
 pla
 sta src
 iny
 bne pq2
pq3 pla
 tya
 cmp #'0'
 bne pq4
 ldx hi
 beq pq5
pq4 sta hi
 jsr putc
pq5 inc t0
 lda t0
 cmp #4
 bne pq1
 lda src
 clc
 adc #'0'
 jmp putc
p1l dta l(10000),l(1000),l(100),l(10)
p1h dta h(10000),h(1000),h(100),h(10)

tabstops dta b(8,16,24,32,40,48,56,$FF)

mod10
 ldx #0
m10a cmp #10
 bcc m10b
 sbc #10
 inx
 bne m10a
m10b rts

rulch
 sta rc
 cmp cc
 bne rk1
 lda #'^'
 rts
rk1 cmp lm
 bne rk2
 lda #'['
 rts
rk2 cmp rm
 bne rk3
 lda #']'
 rts
rk3 ldx #0
rk4 lda tabstops,x
 cmp #$FF
 beq rk6
 cmp rc
 beq rk5
 inx
 bne rk4
rk5 lda #'v'
 rts
rk6 lda rz
 bne rkdot
 lda rc
 beq rkdot
 jsr mod10
 cmp #0
 bne rkdot
 txa
 clc
 adc #'0'
 rts
rkdot lda #'.'
 rts

ruler
 lda #0
 sta rn
 lda rz
 bne rzm
rn1 lda rn
 jsr rulch
 ldx rn
 sta BUF,x
 inc rn
 lda rn
 cmp #64
 bne rn1
 beq rdraw
rzm lda cc
 and #$E0
 cmp #64
 bcc rzs
 lda #32
rzs sta zs
rz1 lda zs
 clc
 adc rn
 jsr mod10
 clc
 adc #'0'
 pha
 lda rn
 asl
 tax
 pla
 sta BUF,x
 lda zs
 clc
 adc rn
 jsr rulch
 pha
 lda rn
 asl
 tax
 inx
 pla
 sta BUF,x
 inc rn
 lda rn
 cmp #32
 bne rz1
rdraw lda #0
 sta BUF+64
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #$FF
 sta rr
 jsr rowsetup
 jsr drawtext
 jmp hlr

hlr
 lda iv
 beq hlr0
 jmp invrow
hlr0 jsr rowptr
 inc sp+1
 ldy #24
hl1 lda #$FF
 sta (sp),y
 iny
 cpy #64
 bne hl1
 rts

hls
 lda iv
 beq hls0
 jmp invrow
hls0 jsr rowptr
 ldy #0
hl2 lda #$FF
 sta (sp),y
 iny
 cpy #40
 bne hl2
 rts

invrow
 jsr rowptr
 ldy #0
iv1 lda (sp),y
 eor #$FF
 sta (sp),y
 iny
 bne iv1
 inc sp+1
iv2 lda (sp),y
 eor #$FF
 sta (sp),y
 iny
 cpy #64
 bne iv2
 rts

status
 jsr ruler
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
 lda #' '
 jsr putc
 lda dend
 sec
 sbc #<DOC
 sta src
 lda dend+1
 sbc #>DOC
 sta src+1
 jsr putn16
 lda #<s3
 ldx #>s3
 jsr putstr
 lda #>LPL
 sec
 sbc dend+1
 lsr
 lsr
 jsr putnum
 lda #<s4
 ldx #>s4
 jsr putstr
 lda lm
 bne sm1
 lda rm
 cmp #63
 beq sm2
sm1 lda #<fm
 ldx #>fm
 jsr putstr
 lda lm
 jsr putnum
 lda #'-'
 jsr putc
 lda rm
 jsr putnum
sm2 jsr curstyle
 lsr
 bcc sg1
 pha
 lda #<fbl
 ldx #>fbl
 jsr putstr
 pla
sg1 lsr
 bcc sg2
 pha
 lda #<fit
 ldx #>fit
 jsr putstr
 pla
sg2 lsr
 bcc sg3
 lda #<fun
 ldx #>fun
 jsr putstr
sg3 lda rz
 beq sf1
 lda #<fz
 ldx #>fz
 jsr putstr
sf1 lda iv
 beq sf2
 lda #<fi
 ldx #>fi
 jsr putstr
sf2 lda th
 beq sf3
 lda #<fb
 ldx #>fb
 jsr putstr
sf3 lda #0
 jsr putc
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #ROWS
 sta rr
 jsr rowsetup
 jsr drawtext
 jmp hls

s1 dta c'Ln ',b(0)
s2 dta c' Col ',b(0)
s3 dta c' ch ',b(0)
s4 dta c'K free',b(0)
fm dta c' M ',b(0)
fbl dta c' ',b(4),c'BLD',b(4),b(0)
fit dta c' ',b(4),c'ITA',b(4),b(0)
fun dta c' ',b(4),c'UND',b(4),b(0)
fz dta c' ',b(4),c'ZUM',b(4),b(0)
fi dta c' ',b(4),c'INV',b(4),b(0)
fb dta c' ',b(4),c'BLU',b(4),b(0)
kname dta c'K:',b($9B)
helpmsg dta c'^X command  Tab mode  ^B bold ^I italic ^U underline  Ctrl-arrows move',b(0)

 .macro body
 dta b(1),c'ACWord',b(1),c' hi-res page: 64 columns x 20 lines',b(13)
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
 :14 dta $0F
 dta $8F
 :84 dta $0F
 dta $4F,a(SCR+4000)
 :74 dta $0F
 dta $8F
 :16 dta $0F
 dta $41,a(dl)

 org $9400
 icl 'font4.inc'

BFNT = $9800
 org BFNT
 icl 'font6.inc'

 run start
