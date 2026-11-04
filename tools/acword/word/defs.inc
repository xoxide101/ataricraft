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
CMDB = $1200
SHH  = $1000
SHL  = $1100
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
lht  = $0500
vis  = $0501
anyv = $0502
zy   = $0503
zx   = $0504
zl   = $0505
zh   = $0506
dlt   = $0507
wrpf = $0508
zyc  = $0509
YT   = $0510
HM   = $9E00
pit  = $EB
avl  = $EC
avh  = $ED
gxl  = $EE
gxh  = $EF
szh  = $F0
zw0  = $F1
zw1  = $F2
zw2  = $F3
zm0  = $F4
zm1  = $F5
zm2  = $F6
zzs  = $F7
zbx  = $F8
stp  = $F9
stq  = $FB
zvi  = $FD
zti  = $FE
ztq  = $FF
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

SYM  = $0C00
pkon = $1310
pks  = $1311
pkp  = $1312
pkb  = $1313
pkn  = $1314
pkr  = $1315
pkc  = $1316
pki  = $1317
