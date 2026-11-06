; ACWriter proof of concept: 320x192 1-bit page, 6px glyphs, bold/italic/underline,
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
DOC  = $6400
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

; start menu, help and convert pages (word/home.inc) and text import (word/import.inc)
HELPFG = $02DC
CONSOL = $D01F
hmode  = $1330
hback  = $1331
svcl   = $1332
svcc   = $1333
svtop  = $1334
svanyv = $1335
svlm   = $1336
svrm   = $1337
hchd   = $1338
isz    = $1339
hsel   = $133B
hold   = $133C
hk     = $133D
hv     = $133E
icol   = $1340
ispa   = $1341
iscol  = $1343
iinv   = $1344
ibol   = $1345
ilead  = $1346
icen   = $1347
ilcnt  = $1348
ihad   = $1349
ifc    = $134A
ipcr   = $134B
itr    = $134C
ilsa   = $134D
ilsc   = $134F
ibyte  = $1350
ichr   = $1351

; spell checker (word/spell.inc)
sv_on  = $1352               ; 1 while the prompt is shown
sv_ln  = $1353               ; scan position
sv_co  = $1354
sv_us  = $1355               ; unknown word: start, end, line
sv_ue  = $1356
sv_ul  = $1357
sv_wl  = $1358               ; letters in SWB
sv_bad = $1359
sv_cap = $135A
sv_ms  = $135B
sv_xe  = $135C               ; 1 = table in XE bank 1
sv_tb  = $135D               ; hi byte of table base (window or RAM)
sv_dl  = $135E               ; 1 = dictionary loaded
sv_ni  = $135F               ; ignore list entries
sv_sg  = $1360               ; suggestions
sv_k   = $1361
sv_pg  = $1362               ; table pages (hi byte count)
sv_n   = $1363
sv_i   = $1364
sv_si  = $1365
sv_pl  = $1366               ; hi byte of mask low page = pages-1
sv_bo  = $1367               ; byte offset in table (2)
sv_pr  = $1369               ; probe position (4)
sv_h2  = $136D               ; step (4)
sv_x   = $1371               ; hash (4)
sv_fx  = $1375               ; hash of the word shown (4)
sv_pc  = $1379               ; probe count
sv_wo  = $137A               ; original length of the word shown
sv_sl  = $137B               ; length of the word being tested
sv_ty  = $137C
sv_hm  = $137D               ; byte at probe
sv_t   = $137E
SWO    = $13A0               ; copy of the unknown word (24)
SCB    = $13C0               ; candidate word (26)
sv_m1  = $13E0               ; mask bytes of the bit index
sv_m2  = $13E1
sv_ss  = $13E2
sv_hc  = $13E3
sv_pi  = $13E4
DNM2   = $1470               ; fallback dictionary name (H:EN.CDC)
NCMD   = 65

; selection, clipboard, find / replace (word/edit.inc)
FND    = $1480               ; find text, lower case (32)
RPL    = $14A0               ; replacement text (32)
ed_on  = $14C0               ; 1 = a selection exists
ed_hl  = $14C1               ; 1 = its two highlight codes are in the document
ed_rp  = $14C2               ; 1 = replace prompt (Y/N/A/Esc) active
ed_fl  = $14C3               ; find text length
ed_rl  = $14C4               ; replacement length
ed_cnt = $14C5               ; replacements made
ed_l   = $14C6
ed_dn  = $14E2               ; set by Cut (1) / Paste (2) so the main loop can realign the font table
ed_cl  = $14C8               ; clipboard length (2)
ed_ap  = $14CA               ; selection anchor, raw document pointer
ed_cp  = $14CC               ; cursor pointer
ed_h1  = $14CE               ; pointers of the highlight codes
ed_h2  = $14D0
ed_q   = $14D2               ; work pointer
ed_n   = $14D4               ; work count
ed_ps  = $14D6               ; search range
ed_pe  = $14D8
ed_ep  = $14DA
ed_lo  = $14DC               ; selection sorted
ed_hi  = $14DE
ed_t   = $14E0
CLIP   = $9C80               ; clipboard, 384 bytes
CLIPMAX = 384
