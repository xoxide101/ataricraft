; lzh.asm - LZH.COM, a stand-alone LHA/LZH lister/extractor for any Atari DOS.
; Headers: level 0 and level 1. Methods: -lh0- (stored), -lh1- (adaptive Huffman, 4K ring), -lh4- (4K) and -lh5- (8K).
; -lh6-/-lh7- (32K/64K rings), level 2 headers and other packers are listed but reported UNSUPPORTED; use the host side
; (AFM/WebATM, web/js/archives.js -> lzh.js / 7-Zip) for those. CRC-16 checked. Reads the archive front to back.
; Mirrors web/js/lzh.js (the reference decoder, tested on every sample).
; At the LZH> prompt: L LZHFILE | X LZHFILE [DEST] [MEMBER] | T LZHFILE [MEMBER]   (blank line = exit)
        icl 'lib\sys.asm'

CRL     = $6400         ; CRC-16 tables
CRH     = $6500
DCODE   = $6600         ; -lh1- static distance code, built at start
DLEN    = $6700
TC0     = $6800         ; Huffman tables: counts for length 0..16 (17 low bytes, 17 high bytes at +32)
TC1     = $6840
TC2     = $6880
SYML0   = $6900         ; table 0 symbols (up to 510): low bytes
SYMH0   = $6B00         ; high bytes
SYML1   = $6D00         ; table 1 (distance) symbols
SYML2   = $6D40         ; table 2 (code length) symbols
SYMZ    = $6E00         ; sink for the unused high bytes of tables 1 and 2
OFFL    = $6E40         ; per-length offsets while building a table
OFFH    = $6E60
LENS    = $6F00         ; code lengths (512)
INBUF   = $7100
OUTBUF  = $7200
HDR     = $7300         ; whole header (up to 252 bytes)
NAMEF   = HDR+22        ; raw file name inside the header
VARS    = $7500
DEST    = $75C0
MEMB    = $7600
; -lh1- adaptive tree, split into low/high byte arrays, each page aligned
FRL     = $A000         ; freq[0..627]
FRH     = $A300
SNL     = $A600         ; son[0..626]
SNH     = $A900
PRL     = $AC00         ; prnt[0..940]
PRH     = $B000
; ring buffer $8000.. (4K for lh1/lh4, 8K for lh5)

NCHAR   = 314
TT      = 627
RR      = 626

ipos    = VARS
ilen    = ipos+1
bb      = ilen+1
bn      = bb+1
opos    = bn+1
mode    = opos+1        ; 0 list 1 extract 2 test
wr      = mode+1        ; 1 while the member is being written to a file
c0      = wr+1          ; running CRC-16
c1      = c0+1
ob      = c1+1
gcnt    = ob+1
vl      = gcnt+1
vh      = vl+1
cdl     = vh+1
cdh     = cdl+1
fl      = cdh+1
fh      = fl+1
il      = fh+1
ih      = il+1
kl      = ih+1
kh      = kl+1
tl      = kh+1
th      = tl+1
dln    = th+1
lenl    = dln+1
lenh    = lenl+1
nl      = lenh+1
nh      = nl+1
nf      = nh+1
st      = nf+1
ld      = st+1
be      = ld+1
ec      = be+1
want    = ec+1
psp     = want+1
nfl     = psp+1
nfh     = nfl+1
s0      = nfh+1         ; 32-bit packed bytes left / skip counter
s1      = s0+1
s2      = s1+1
s3      = s2+1
dv      = s3+1          ; 4 bytes
tv      = dv+4          ; 4 bytes
dig     = tv+4          ; 8 digits
meth    = dig+8         ; 1 lh1, 4 lh4, 5 lh5
wend    = meth+1        ; page after the ring
wmask   = wend+1        ; ring page mask
rm0     = wmask+1       ; 32-bit output bytes left
rm1     = rm0+1
rm2     = rm1+1
rm3     = rm2+1
blkl    = rm3+1         ; symbols left in the current -lh4-/-lh5- block
blkh    = blkl+1
pn      = blkh+1        ; readpt parameters: symbol count, bits for the count, special skip position, table number
pb      = pn+1
ps      = pb+1
ptb     = ps+1
pnp     = ptb+1         ; number of distance symbols
pk      = pnp+1
pi      = pk+1
pcv     = pi+1
cil     = pcv+1
cih     = cil+1
ckl     = cih+1
ckh     = ckl+1
rnl     = ckh+1
rnh     = rnl+1
cfl     = rnh+1         ; per table: 1 when the table is a single constant symbol (3 bytes)
cvl     = cfl+3
cvh     = cvl+3
dl      = cvh+3
dh      = dl+1
iv      = dh+1
dj      = iv+1
hcrl    = dj+1
hcrh    = hcrl+1
hs      = hcrh+1
lim     = hs+1
lvl     = lim+1
e1      = lvl+1
e2      = e1+1
esl     = e2+1
esh     = esl+1
tk      = esh+1
gi      = tk+1
gp      = gi+1
gl      = gp+1
gc      = gl+1
mlk     = gc+1
mhk     = mlk+1

wp      = $B0           ; ring write pointer
sp      = $B2           ; ring read pointer for matches
pcl     = $B4           ; current table: counts low / high, symbols low / high
pch     = $B6
psl     = $B8
psh     = $BA
ex      = $BC
lp      = $C0           ; lengths pointer for table builds
q       = $C2
cc      = $80           ; -lh1- work values (16 bit each)
ll      = $82
kk      = $84
ii      = $86
jj      = $88
tq      = $8A
pp      = $8C           ; page pointer into the tree arrays, its low byte stays 0
mm      = $8E
m1      = $90

        .macro GET16 lo,hi,idx,dst
        lda :3+1
        clc
        adc #>:1
        sta pp+1
        ldy :3
        lda (pp),y
        sta :4
        lda :3+1
        clc
        adc #>:2
        sta pp+1
        lda (pp),y
        sta :4+1
        .endm

        .macro PUT16 lo,hi,idx,src
        lda :3+1
        clc
        adc #>:1
        sta pp+1
        ldy :3
        lda :4
        sta (pp),y
        lda :3+1
        clc
        adc #>:2
        sta pp+1
        lda :4+1
        sta (pp),y
        .endm

        .macro INC16 v
        inc :1
        bne *+4
        inc :1+1
        .endm

        .macro DEC16 v
        lda :1
        bne *+4
        dec :1+1
        dec :1
        .endm

        .macro ADDI d,s,n
        clc
        lda :2
        adc #<:3
        sta :1
        lda :2+1
        adc #>:3
        sta :1+1
        .endm

        org CODE
        icl 'lib\io.asm'
        icl 'lib\hand.asm'

start:  jsr crctab
        jsr gend
        jsr putsi
        .byte 'LZH 0.1  LHA/LZH LISTER/EXTRACTOR',EOL
        .byte 'L LZH | X LZH [DEST] [MEMBER] | T LZH',EOL
        .byte 'LH0 LH1 LH4 LH5 ONLY. Q QUITS',EOL,0
prompt: tsx
        stx psp
        jsr putnl
        jsr putsi
        .byte 'LZH>',0
        jsr getlineh
        lda #<LINE
        sta ARG
        lda #>LINE
        sta ARG+1
        jsr nexttok
        jeq bye
        lda TOK
        jsr toupper
        cmp #'Q'
        jeq bye
        ldx #0
        cmp #'L'
        beq pm
        inx
        cmp #'X'
        beq pm
        inx
        cmp #'T'
        beq pm
usage:  jsr putsi
        .byte 'USE L, X OR T FOLLOWED BY THE ARCHIVE',EOL,0
        jmp prompt
pm:     stx mode
        jsr nexttok
        beq usage
        ldx #0
ck_l:   lda TOK,x
        beq ck_no
        cmp #':'
        beq ck_ye
        inx
        bne ck_l
ck_no:  lda #<FSPEC
        sta T1
        lda #>FSPEC
        sta T1+1
        ldy #0
        lda #'D'
        sta (T1),y
        iny
        lda #':'
        sta (T1),y
        iny
        jmp ck_cp
ck_ye:  lda #<FSPEC
        sta T1
        lda #>FSPEC
        sta T1+1
        ldy #0
ck_cp:  jsr cpt
        lda #'D'
        sta DEST
        lda #':'
        sta DEST+1
        lda #EOL
        sta DEST+2
        sta MEMB
        lda mode
        cmp #2
        beq pm_m
        jsr nexttok
        beq pm_go
        lda #<DEST
        sta T1
        lda #>DEST
        sta T1+1
        ldy #0
        jsr cpt
pm_m:   jsr nexttok
        beq pm_go
        lda #<MEMB
        sta T1
        lda #>MEMB
        sta T1+1
        ldy #0
        jsr cpt
pm_go:  lda #4
        ldx #$20
        jsr fopen1
        bpl pm_ok
        jsr putsi
        .byte 'CANNOT OPEN THE ARCHIVE',EOL,0
        jmp prompt
pm_ok:  lda #0
        sta nfl
        sta nfh
        sta ipos
        sta ilen
        jsr members
        ldx #$20
        jsr fclose
        lda nfl
        sta N0
        lda nfh
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' FILE(S)',EOL,0
        jmp prompt

bye:    ldx #$20
        jsr fclose
        ldx #$30
        jsr fclose
        jmp (DOSVEC)

; stop everything that is open and go back to the prompt
abort:  ldx #$30
        jsr fclose
        ldx #$20
        jsr fclose
        ldx psp
        txs
        jmp prompt
ferr_eof:
        jsr putsi
        .byte EOL,'UNEXPECTED END OF ARCHIVE',EOL,0
        jmp abort
ferr_data:
        jsr putsi
        .byte EOL,'BAD DATA',EOL,0
        jmp abort

; copy TOK (upper cased) to (T1)+Y and end it with EOL
cpt:    ldx #0
cp1:    lda TOK,x
        beq cp2
        jsr toupper
        sta (T1),y
        inx
        iny
        bne cp1
cp2:    lda #EOL
        sta (T1),y
        rts

; ---- CRC-16 table (poly $A001, reflected) ----
crctab: ldx #0
ct_l:   stx tl
        lda #0
        sta th
        ldy #8
ct_b:   lsr th
        ror tl
        bcc ct_n
        lda tl
        eor #$01
        sta tl
        lda th
        eor #$A0
        sta th
ct_n:   dey
        bne ct_b
        lda tl
        sta CRL,x
        lda th
        sta CRH,x
        inx
        bne ct_l
        rts

; A = byte -> running CRC-16
crcb:   eor c0
        tax
        lda c1
        eor CRL,x
        sta c0
        lda CRH,x
        sta c1
        rts

; -lh1- static distance code: 64 prefixes (3 bits x1, 4 x3, 5 x8, 6 x12, 7 x24, 8 x16) as 256 entry tables
gend:   lda #0
        sta gi
        sta gp
gd_n:   lda gi
        ldx #3
        cmp #1
        bcc gd_l
        inx
        cmp #4
        bcc gd_l
        inx
        cmp #12
        bcc gd_l
        inx
        cmp #24
        bcc gd_l
        inx
        cmp #48
        bcc gd_l
        inx
gd_l:   stx gl
        lda #$80
        dex
        beq gd_c
gd_s:   lsr
        dex
        bne gd_s
gd_c:   sta gc
        ldx gp
        ldy gc
gd_f:   lda gi
        sta DCODE,x
        lda gl
        sta DLEN,x
        inx
        dey
        bne gd_f
        stx gp
        inc gi
        lda gi
        cmp #64
        bne gd_n
        rts

; ---- input ----
fill:   lda #<INBUF
        sta V_BPL
        lda #>INBUF
        sta V_BPH
        lda #255
        sta V_BLL
        lda #0
        sta V_BLH
        ldx #$20
        jsr bgetp
        lda ICBLL+$20
        sta ilen
        lda #0
        sta ipos
        lda ilen
        beq fl_e
        clc
        rts
fl_e:   sec
        rts

; next archive byte in A, carry set at the end of the file
getbyte:
        ldx ipos
        cpx ilen
        bcc gb_ok
        jsr fill
        bcs gb_r
        ldx #0
gb_ok:  lda INBUF,x
        inc ipos
        clc
gb_r:   rts

; same, but the end of the file is an error
getbyt: jsr getbyte
        jcs ferr_eof
        rts

; next byte of the member's packed data (s0..s3 counts what is left; zeros after the end, like the host decoder)
getdb:  lda s0
        ora s1
        ora s2
        ora s3
        beq gdb_z
        lda s0
        bne gdb_a
        lda s1
        bne gdb_b
        lda s2
        bne gdb_c
        dec s3
gdb_c:  dec s2
gdb_b:  dec s1
gdb_a:  dec s0
        jmp getbyt
gdb_z:  lda #0
        rts

; one bit, most significant first
getbit: lda bn
        bne gt_g
        jsr getdb
        sta bb
        lda #8
        sta bn
gt_g:   dec bn
        asl bb
        lda #0
        rol
        rts

; X = number of bits (0-16) -> vl/vh, first bit read is the most significant
getbits:
        stx gcnt
        lda #0
        sta vl
        sta vh
gbl:    lda gcnt
        beq gbd
        jsr getbit
        asl vl
        rol vh
        ora vl
        sta vl
        dec gcnt
        jmp gbl
gbd:    rts

; skip s0..s3 archive bytes
skip32: lda s0
        ora s1
        ora s2
        ora s3
        beq sk_d
        jsr getbyt
        lda s0
        bne sk_a
        lda s1
        bne sk_b
        lda s2
        bne sk_c
        dec s3
sk_c:   dec s2
sk_b:   dec s1
sk_a:   dec s0
        jmp skip32
sk_d:   rts

; Z set when no output bytes are left
remz:   lda rm0
        ora rm1
        ora rm2
        ora rm3
        rts

; ---- output: A = byte into the ring, the CRC and (when writing) the file ----
outb:   sta ob
        jsr crcb
        ldy #0
        lda ob
        sta (wp),y
        inc wp
        bne ob_w
        inc wp+1
        lda wp+1
        cmp wend
        bne ob_w
        lda #$80
        sta wp+1
ob_w:   lda rm0
        bne ob_a
        lda rm1
        bne ob_b
        lda rm2
        bne ob_c
        dec rm3
ob_c:   dec rm2
ob_b:   dec rm1
ob_a:   dec rm0
        lda wr
        beq ob_r
        ldx opos
        lda ob
        sta OUTBUF,x
        inx
        stx opos
        bne ob_r
        lda #0
        ldx #1
        jsr wrout
ob_r:   rts

; write A/X bytes of OUTBUF to the output file (IOCB 3)
wrout:  sta V_BLL
        stx V_BLH
        lda #<OUTBUF
        sta V_BPL
        lda #>OUTBUF
        sta V_BPH
        ldx #$30
        jsr bputp
        bmi wr_e
        rts
wr_e:   jsr putsi
        .byte EOL,'WRITE ERROR',EOL,0
        jmp abort

; fill the ring with spaces
fillring:
        lda #0
        sta q
        lda #$80
        sta q+1
        ldy #0
fr_l:   lda #$20
        sta (q),y
        iny
        bne fr_l
        inc q+1
        lda q+1
        cmp wend
        bne fr_l
        rts

; zero the 512 code lengths
clrl:   lda #0
        tax
cl_l:   sta LENS,x
        sta LENS+$100,x
        inx
        bne cl_l
        rts

; ---- canonical Huffman tables (as in zip.asm, code lengths up to 16) ----
; X = table number -> pcl/pch/psl/psh
settab: lda tcl,x
        sta pcl
        clc
        adc #32
        sta pch
        lda tch,x
        sta pcl+1
        sta pch+1
        lda tsl,x
        sta psl
        lda tsh,x
        sta psl+1
        lda thl,x
        sta psh
        lda thh,x
        sta psh+1
        rts
tcl:    .byte <TC0,<TC1,<TC2
tch:    .byte >TC0,>TC1,>TC2
tsl:    .byte <SYML0,<SYML1,<SYML2
tsh:    .byte >SYML0,>SYML1,>SYML2
thl:    .byte <SYMH0,<SYMZ,<SYMZ
thh:    .byte >SYMH0,>SYMZ,>SYMZ

; build table X from nl/nh lengths at lp
build:  jsr settab
        ldy #16
        lda #0
bz:     sta (pcl),y
        sta (pch),y
        dey
        bpl bz
        lda lp
        sta q
        lda lp+1
        sta q+1
        lda nl
        sta kl
        lda nh
        sta kh
p1:     lda kl
        ora kh
        beq p1d
        ldy #0
        lda (q),y
        tay
        lda (pcl),y
        clc
        adc #1
        sta (pcl),y
        bcc p1n
        lda (pch),y
        adc #0
        sta (pch),y
p1n:    inc q
        bne p1m
        inc q+1
p1m:    lda kl
        bne p1k
        dec kh
p1k:    dec kl
        jmp p1
p1d:    lda #0
        sta OFFL+1
        sta OFFH+1
        ldy #1
ofl:    lda OFFL,y
        clc
        adc (pcl),y
        sta OFFL+1,y
        lda OFFH,y
        adc (pch),y
        sta OFFH+1,y
        iny
        cpy #16
        bcc ofl
        lda lp
        sta q
        lda lp+1
        sta q+1
        lda nl
        sta kl
        lda nh
        sta kh
        lda #0
        sta il
        sta ih
p2:     lda kl
        ora kh
        beq p2d
        ldy #0
        lda (q),y
        beq p2n
        tax
        lda OFFL,x
        sta tl
        lda OFFH,x
        sta th
        inc OFFL,x
        bne p2o
        inc OFFH,x
p2o:    clc
        lda psl
        adc tl
        sta ex
        lda psl+1
        adc th
        sta ex+1
        ldy #0
        lda il
        sta (ex),y
        clc
        lda psh
        adc tl
        sta ex
        lda psh+1
        adc th
        sta ex+1
        lda ih
        sta (ex),y
p2n:    inc q
        bne p2p
        inc q+1
p2p:    inc il
        bne p2q
        inc ih
p2q:    lda kl
        bne p2k
        dec kh
p2k:    dec kl
        jmp p2
p2d:    rts

; X = table -> symbol in vl/vh (bits are read most significant first)
decode: jsr settab
        lda #0
        sta cdl
        sta cdh
        sta fl
        sta fh
        sta il
        sta ih
        lda #1
        sta dln
dc_l:   jsr getbit
        ora cdl
        sta cdl
        ldy dln
        lda (pcl),y
        sta kl
        lda (pch),y
        sta kh
        clc
        lda fl
        adc kl
        sta tl
        lda fh
        adc kh
        sta th
        lda cdl
        cmp tl
        lda cdh
        sbc th
        bcc dc_f
        clc
        lda il
        adc kl
        sta il
        lda ih
        adc kh
        sta ih
        lda tl
        asl
        sta fl
        lda th
        rol
        sta fh
        asl cdl
        rol cdh
        inc dln
        lda dln
        cmp #17
        bcc dc_l
        jmp ferr_data
dc_f:   sec
        lda cdl
        sbc fl
        sta tl
        lda cdh
        sbc fh
        sta th
        clc
        lda tl
        adc il
        sta tl
        lda th
        adc ih
        sta th
        clc
        lda psl
        adc tl
        sta ex
        lda psl+1
        adc th
        sta ex+1
        ldy #0
        lda (ex),y
        sta vl
        clc
        lda psh
        adc tl
        sta ex
        lda psh+1
        adc th
        sta ex+1
        lda (ex),y
        sta vh
        rts

; X = table -> symbol in vl/vh; a table with a single symbol takes no bits
dsym:   lda cfl,x
        beq ds_d
        lda cvl,x
        sta vl
        lda cvh,x
        sta vh
        rts
ds_d:   jmp decode

; ---- -lh4- / -lh5- block tables ----
; read a table: pn symbols, pb bits for the length count, ps = position after which 2 bits of zero run follow (255 = none)
rdpt:   jsr clrl
        ldx pb
        jsr getbits
        lda vl
        sta pk
        bne rp_k
        ldx pb
        jsr getbits
        ldx ptb
        lda vl
        sta cvl,x
        lda vh
        sta cvh,x
        lda #1
        sta cfl,x
        rts
rp_k:   ldx ptb
        lda #0
        sta cfl,x
        sta pi
rp_l:   lda pi
        cmp pk
        bcs rp_b
        ldx #3
        jsr getbits
        lda vl
        sta pcv
        cmp #7
        bne rp_s
rp_u:   jsr getbit
        beq rp_s
        inc pcv
        lda pcv
        cmp #17
        bcc rp_u
rp_s:   lda pcv
        cmp #17
        jcs ferr_data
        ldy pi
        sta LENS,y
        inc pi
        lda pi
        cmp ps
        bne rp_l
        ldx #2
        jsr getbits
        lda pi
        clc
        adc vl
        sta pi
        jmp rp_l
rp_b:   lda #<LENS
        sta lp
        lda #>LENS
        sta lp+1
        lda pn
        sta nl
        lda #0
        sta nh
        ldx ptb
        jmp build

; start of a block: size, literal/length table (table 0, coded with table 2), distance table (table 1)
newblk: ldx #16
        jsr getbits
        lda vl
        sta blkl
        lda vh
        sta blkh
        lda #19
        sta pn
        lda #5
        sta pb
        lda #3
        sta ps
        lda #2
        sta ptb
        jsr rdpt
        ldx #9
        jsr getbits
        lda vl
        sta ckl
        lda vh
        sta ckh
        ora vl
        bne nb_c
        ldx #9
        jsr getbits
        lda vl
        sta cvl
        lda vh
        sta cvh
        lda #1
        sta cfl
        jmp nb_p
nb_c:   lda #0
        sta cfl
        sta cil
        sta cih
        jsr clrl
nb_l:   lda cil
        cmp ckl
        lda cih
        sbc ckh
        jcs nb_e
        ldx #2
        jsr dsym
        lda vl
        cmp #3
        bcs nb_n
        cmp #1
        bcc nb_1
        beq nb_4
        ldx #9
        jsr getbits
        lda vl
        clc
        adc #20
        sta rnl
        lda vh
        adc #0
        sta rnh
        jmp nb_a
nb_1:   lda #1
        sta rnl
        lda #0
        sta rnh
        jmp nb_a
nb_4:   ldx #4
        jsr getbits
        lda vl
        clc
        adc #3
        sta rnl
        lda #0
        sta rnh
nb_a:   lda cil
        clc
        adc rnl
        sta cil
        lda cih
        adc rnh
        sta cih
        jmp nb_l
nb_n:   sec
        sbc #2
        sta tk
        lda cih
        cmp #2
        jcs ferr_data
        ldy cil
        lda tk
        ldx cih
        bne nb_h
        sta LENS,y
        jmp nb_i
nb_h:   sta LENS+$100,y
nb_i:   inc cil
        jne nb_l
        inc cih
        jmp nb_l
nb_e:   lda #<LENS
        sta lp
        lda #>LENS
        sta lp+1
        lda #<510
        sta nl
        lda #>510
        sta nh
        ldx #0
        jsr build
nb_p:   lda pnp
        sta pn
        lda #4
        sta pb
        lda #$FF
        sta ps
        lda #1
        sta ptb
        jmp rdpt

; ---- -lh1- (adaptive Huffman, "LZHUF") ----
; X = zero page address of a 16 bit value; carry clear when it is below TT
cmpT:   lda 1,x
        cmp #>TT
        bne cT_r
        lda 0,x
        cmp #<TT
cT_r:   rts

h1init: lda #0
        sta pp
        sta ii
        sta ii+1
h1_a:   lda #1
        sta kk
        lda #0
        sta kk+1
        PUT16 FRL,FRH,ii,kk
        ADDI tq,ii,TT
        PUT16 SNL,SNH,ii,tq
        PUT16 PRL,PRH,tq,ii
        INC16 ii
        lda ii
        cmp #<NCHAR
        bne h1_a
        lda ii+1
        cmp #>NCHAR
        bne h1_a
        lda #0
        sta ii
        sta ii+1
        lda #<NCHAR
        sta jj
        lda #>NCHAR
        sta jj+1
h1_b:   GET16 FRL,FRH,ii,kk
        ADDI tq,ii,1
        GET16 FRL,FRH,tq,ll
        clc
        lda kk
        adc ll
        sta kk
        lda kk+1
        adc ll+1
        sta kk+1
        PUT16 FRL,FRH,jj,kk
        PUT16 SNL,SNH,jj,ii
        PUT16 PRL,PRH,ii,jj
        PUT16 PRL,PRH,tq,jj
        ADDI ii,ii,2
        INC16 jj
        ldx #jj
        jsr cmpT
        jcc h1_b
        lda #$FF
        sta kk
        sta kk+1
        lda #<TT
        sta tq
        lda #>TT
        sta tq+1
        PUT16 FRL,FRH,tq,kk
        lda #0
        sta kk
        sta kk+1
        lda #<RR
        sta tq
        lda #>RR
        sta tq+1
        PUT16 PRL,PRH,tq,kk
        rts

; rebuild the tree with halved frequencies
reconst:
        lda #0
        sta ii
        sta ii+1
        sta jj
        sta jj+1
r1_l:   GET16 SNL,SNH,ii,kk
        ldx #kk
        jsr cmpT
        bcc r1_n
        GET16 FRL,FRH,ii,ll
        INC16 ll
        lsr ll+1
        ror ll
        PUT16 FRL,FRH,jj,ll
        PUT16 SNL,SNH,jj,kk
        INC16 jj
r1_n:   INC16 ii
        ldx #ii
        jsr cmpT
        jcc r1_l
        lda #0
        sta ii
        sta ii+1
        lda #<NCHAR
        sta jj
        lda #>NCHAR
        sta jj+1
r2_l:   GET16 FRL,FRH,ii,kk
        ADDI tq,ii,1
        GET16 FRL,FRH,tq,ll
        clc
        lda kk
        adc ll
        sta kk
        lda kk+1
        adc ll+1
        sta kk+1
        PUT16 FRL,FRH,jj,kk
        sec
        lda jj
        sbc #1
        sta ll
        lda jj+1
        sbc #0
        sta ll+1
r2_k:   GET16 FRL,FRH,ll,tq
        lda kk
        cmp tq
        lda kk+1
        sbc tq+1
        bcs r2_f
        DEC16 ll
        jmp r2_k
r2_f:   INC16 ll
        lda jj
        sta mm
        lda jj+1
        sta mm+1
r2_m:   lda ll
        cmp mm
        lda ll+1
        sbc mm+1
        bcs r2_s
        sec
        lda mm
        sbc #1
        sta m1
        lda mm+1
        sbc #0
        sta m1+1
        GET16 FRL,FRH,m1,tq
        PUT16 FRL,FRH,mm,tq
        GET16 SNL,SNH,m1,tq
        PUT16 SNL,SNH,mm,tq
        lda m1
        sta mm
        lda m1+1
        sta mm+1
        jmp r2_m
r2_s:   PUT16 FRL,FRH,ll,kk
        PUT16 SNL,SNH,ll,ii
        ADDI ii,ii,2
        INC16 jj
        ldx #jj
        jsr cmpT
        jcc r2_l
        lda #0
        sta ii
        sta ii+1
r3_l:   GET16 SNL,SNH,ii,kk
        PUT16 PRL,PRH,kk,ii
        ldx #kk
        jsr cmpT
        bcs r3_n
        ADDI tq,kk,1
        PUT16 PRL,PRH,tq,ii
r3_n:   INC16 ii
        ldx #ii
        jsr cmpT
        bcc r3_l
        rts

; cc = symbol that was just coded: bump its frequency and keep the tree sorted
update: lda #<RR
        sta tq
        lda #>RR
        sta tq+1
        GET16 FRL,FRH,tq,kk
        lda kk
        bne u_go
        lda kk+1
        cmp #$80
        bne u_go
        jsr reconst
u_go:   ADDI tq,cc,TT
        GET16 PRL,PRH,tq,cc
u_l:    GET16 FRL,FRH,cc,kk
        INC16 kk
        PUT16 FRL,FRH,cc,kk
        ADDI ll,cc,1
        GET16 FRL,FRH,ll,tq
        lda tq
        cmp kk
        lda tq+1
        sbc kk+1
        jcs u_nx
u_f:    INC16 ll
        GET16 FRL,FRH,ll,tq
        lda tq
        cmp kk
        lda tq+1
        sbc kk+1
        bcc u_f
        DEC16 ll
        GET16 FRL,FRH,ll,tq
        PUT16 FRL,FRH,cc,tq
        PUT16 FRL,FRH,ll,kk
        GET16 SNL,SNH,cc,ii
        PUT16 PRL,PRH,ii,ll
        ldx #ii
        jsr cmpT
        bcs u_s1
        ADDI tq,ii,1
        PUT16 PRL,PRH,tq,ll
u_s1:   GET16 SNL,SNH,ll,jj
        PUT16 SNL,SNH,ll,ii
        PUT16 PRL,PRH,jj,cc
        ldx #jj
        jsr cmpT
        bcs u_s2
        ADDI tq,jj,1
        PUT16 PRL,PRH,tq,cc
u_s2:   PUT16 SNL,SNH,cc,jj
        lda ll
        sta cc
        lda ll+1
        sta cc+1
u_nx:   GET16 PRL,PRH,cc,cc
        lda cc
        ora cc+1
        jne u_l
        rts

; next literal/length symbol -> vl/vh
h1char: lda #<RR
        sta tq
        lda #>RR
        sta tq+1
        GET16 SNL,SNH,tq,cc
h1_c:   ldx #cc
        jsr cmpT
        bcs h1_d
        jsr getbit
        clc
        adc cc
        sta tq
        lda cc+1
        adc #0
        sta tq+1
        GET16 SNL,SNH,tq,cc
        jmp h1_c
h1_d:   sec
        lda cc
        sbc #<TT
        sta cc
        lda cc+1
        sbc #>TT
        sta cc+1
        lda cc
        sta vl
        lda cc+1
        sta vh
        jmp update

; match distance -> dl/dh: static code for the upper 6 bits, then 6 raw bits
h1pos:  ldx #8
        jsr getbits
        lda vl
        sta iv
        tax
        lda DCODE,x
        sta dl
        lda #0
        sta dh
        ldy #6
h1_s:   asl dl
        rol dh
        dey
        bne h1_s
        lda DLEN,x
        sec
        sbc #2
        sta dj
h1_x:   lda dj
        beq h1_y
        jsr getbit
        sta tk
        asl iv
        lda iv
        ora tk
        sta iv
        dec dj
        jmp h1_x
h1_y:   lda iv
        and #$3F
        ora dl
        sta dl
        rts

; ---- shared LZ loop ----
getsym: lda meth
        cmp #1
        bne gs_5
        jmp h1char
gs_5:   lda blkl
        ora blkh
        bne gs_a
        jsr newblk
gs_a:   lda blkl
        bne gs_b
        dec blkh
gs_b:   dec blkl
        ldx #0
        jmp dsym

getdist:
        lda meth
        cmp #1
        bne gt_5
        jmp h1pos
gt_5:   ldx #1
        jsr dsym
        lda vl
        sta dl
        lda #0
        sta dh
        lda vl
        cmp #2
        bcc gt_r
        sec
        sbc #1
        sta dj
        tax
        jsr getbits
        lda #1
        sta mlk
        lda #0
        sta mhk
        ldx dj
gt_l:   asl mlk
        rol mhk
        dex
        bne gt_l
        lda vl
        ora mlk
        sta dl
        lda vh
        ora mhk
        sta dh
gt_r:   rts

; decode until the output size is reached (blkl/blkh = 0, ring and tables prepared)
lzmain: jsr remz
        beq lz_d
        jsr getsym
        lda vh
        bne lz_m
        lda vl
        jsr outb
        jmp lzmain
lz_m:   sec
        lda vl
        sbc #253
        sta lenl
        lda vh
        sbc #0
        sta lenh
        jsr getdist
        sec
        lda wp
        sbc dl
        sta sp
        lda wp+1
        sbc dh
        sta sp+1
        lda sp
        bne lz_1
        dec sp+1
lz_1:   dec sp
        lda sp+1
        and wmask
        ora #$80
        sta sp+1
lz_c:   lda lenl
        ora lenh
        beq lzmain
        jsr remz
        beq lz_d
        ldy #0
        lda (sp),y
        sta tk
        inc sp
        bne lz_2
        inc sp+1
        lda sp+1
        cmp wend
        bne lz_2
        lda #$80
        sta sp+1
lz_2:   lda tk
        jsr outb
        lda lenl
        bne lz_3
        dec lenh
lz_3:   dec lenl
        jmp lz_c
lz_d:   rts

; run the member's data through the decoder; carry set when the method is not supported
procdata:
        lda #0
        sta c0
        sta c1
        sta bn
        sta opos
        sta blkl
        sta blkh
        ldx #3
pd_a:   lda HDR+7,x
        sta s0,x
        lda HDR+11,x
        sta rm0,x
        dex
        bpl pd_a
        lda HDR+3
        cmp #'l'
        bne pd_u
        lda HDR+4
        cmp #'h'
        bne pd_u
        lda HDR+5
        cmp #'0'
        beq pd_0
        cmp #'1'
        beq pd_1
        cmp #'4'
        beq pd_4
        cmp #'5'
        beq pd_5
pd_u:   sec
        rts
pd_0:   lda #$90
        sta wend
        lda #0
        sta wp
        lda #$80
        sta wp+1
pd_0l:  jsr remz
        beq pd_k
        jsr getdb
        jsr outb
        jmp pd_0l
pd_1:   lda #1
        sta meth
        lda #$0F
        sta wmask
        lda #$90
        sta wend
        jsr fillring
        lda #$C4
        sta wp
        lda #$8F
        sta wp+1
        jsr h1init
        jmp pd_g
pd_4:   lda #4
        sta meth
        lda #13
        sta pnp
        lda #$0F
        sta wmask
        lda #$90
        sta wend
        jmp pd_r
pd_5:   lda #5
        sta meth
        lda #14
        sta pnp
        lda #$1F
        sta wmask
        lda #$A0
        sta wend
pd_r:   jsr fillring
        lda #0
        sta wp
        lda #$80
        sta wp+1
pd_g:   jsr lzmain
pd_k:   clc
        rts

; ---- archive walk ----
; read the next header into HDR (level 1: skip the extended headers and take them off the packed size);
; carry set at the end of the entries
rdlh:   jsr getbyte
        jcs rl_e
        sta hs
        sta HDR
        cmp #0
        jeq rl_e
        cmp #250
        jcs rl_e
        clc
        adc #2
        sta lim
        lda #1
        sta tl
rl_h:   jsr getbyt
        ldy tl
        sta HDR,y
        iny
        sty tl
        cpy lim
        bne rl_h
        lda HDR+2
        cmp #'-'
        jne rl_e
        lda HDR+6
        cmp #'-'
        jne rl_e
        lda HDR+20
        cmp #2
        bcc rl_v
        jsr putsi
        .byte 'UNSUPPORTED HEADER LEVEL',EOL,0
        sec
        rts
rl_v:   sta lvl
        lda HDR+21
        sta nf
        tax
        lda HDR+22,x
        sta hcrl
        lda HDR+23,x
        sta hcrh
        lda lvl
        beq rl_ok
        ldx hs
        lda HDR,x
        sta esl
        lda HDR+1,x
        sta esh
rl_x:   lda esl
        ora esh
        beq rl_ok
        sec
        lda HDR+7
        sbc esl
        sta HDR+7
        lda HDR+8
        sbc esh
        sta HDR+8
        lda HDR+9
        sbc #0
        sta HDR+9
        lda HDR+10
        sbc #0
        sta HDR+10
        lda esl
        sta kl
        lda esh
        sta kh
rl_b:   jsr getbyt
        tax
        lda e2
        sta e1
        stx e2
        lda kl
        bne rl_d
        dec kh
rl_d:   dec kl
        lda kl
        ora kh
        bne rl_b
        lda e1
        sta esl
        lda e2
        sta esh
        jmp rl_x
rl_ok:  clc
        rts
rl_e:   sec
        rts

members:
mem:    jsr rdlh
        jcs mem_d
        jsr conv83
        jsr uniq
        ldx #3
mem_s:  lda HDR+7,x
        sta s0,x
        dex
        bpl mem_s
        lda NAMEB
        beq mem_k
        lda HDR+5
        cmp #'d'
        beq mem_k
        jsr domember
        inc nfl
        bne mem
        inc nfh
        jmp mem
mem_k:  jsr skip32
        jmp mem
mem_d:  rts

; NAMEF (nf chars) -> 8.3 name in NAMEB; NAMEB[0]=0 for a folder entry
conv83: ldy #0
        sty st
        sty ld
c1l:    cpy nf
        bcs cv2
        lda NAMEF,y
        cmp #'/'
        beq c1s
        cmp #'\'
        beq c1s
        cmp #$FF
        beq c1s
        cmp #'.'
        bne c1n
        iny
        sty ld
        dey
        jmp c1n
c1s:    iny
        sty st
        lda #0
        sta ld
        dey
c1n:    iny
        jmp c1l
cv2:    lda nf
        sta be
        lda ld
        beq cv3
        sec
        sbc #1
        sta be
cv3:    ldx #0
        ldy st
c4:     cpy be
        bcs c6
        cpx #8
        bcs c5
        lda NAMEF,y
        jsr fixc
        sta NAMEB,x
        inx
c5:     iny
        jmp c4
c6:     lda ld
        beq c9
        cpx #0
        beq c9
        lda #'.'
        sta NAMEB,x
        inx
        lda #0
        sta ec
        ldy ld
c7:     cpy nf
        bcs c8
        lda ec
        cmp #3
        bcs c8
        lda NAMEF,y
        jsr fixc
        sta NAMEB,x
        inx
        inc ec
        iny
        jmp c7
c8:     lda ec
        bne c9
        dex
c9:     lda #0
        sta NAMEB,x
        rts

        icl 'lib\uniq.asm'

; A = char -> upper case letter, digit or underscore
fixc:   jsr toupper
        cmp #'A'
        bcc fx_n
        cmp #'Z'+1
        bcc fx_k
        cmp #'_'
        beq fx_k
        bne fx_u
fx_n:   cmp #'0'
        bcc fx_u
        cmp #'9'+1
        bcc fx_k
fx_u:   lda #'_'
fx_k:   rts

; carry clear when the member filter is empty or equals NAMEB
matchq: lda MEMB
        cmp #EOL
        beq mq_y
        ldy #0
mq_l:   lda MEMB,y
        cmp #EOL
        bne mq_c
        lda NAMEB,y
        bne mq_n
        beq mq_y
mq_c:   cmp NAMEB,y
        bne mq_n
        iny
        bne mq_l
mq_n:   sec
        rts
mq_y:   clc
        rts

; list, extract or test the member whose header is in HDR (s0..s3 = its packed size)
domember:
        lda #0
        sta want
        lda mode
        beq dm_s
        jsr matchq
        bcs dm_s
        lda #1
        sta want
dm_s:   lda want
        jne dm_full
        jsr skip32
        lda mode
        bne dm_r
        jsr listline
dm_r:   rts
dm_full:
        lda mode
        cmp #1
        bne dm_t
        ldy #0
dm_d:   lda DEST,y
        cmp #EOL
        beq dm_e
        sta FSPEC2,y
        iny
        bne dm_d
dm_e:   ldx #0
dm_f:   lda NAMEB,x
        beq dm_g
        sta FSPEC2,y
        inx
        iny
        bne dm_f
dm_g:   lda #EOL
        sta FSPEC2,y
        lda #8
        ldx #$30
        jsr fopen2
        bpl dm_w
        jsr putsi
        .byte 'CANNOT CREATE ',0
        jsr putname
        jsr putnl
        lda #0
        sta want
        jmp dm_s
dm_w:   lda #1
        sta wr
        jmp dm_go
dm_t:   lda #0
        sta wr
dm_go:  jsr putc_mode
        lda #' '
        jsr putc
        jsr putname
        lda #' '
        jsr putc
        jsr procdata
        bcc dm_chk
        lda wr
        beq dm_nu
        ldx #$30
        jsr fclose
dm_nu:  jsr putsi
        .byte 'UNSUPPORTED METHOD',EOL,0
        jmp skip32
dm_chk: lda wr
        beq dm_v
        lda opos
        beq dm_fc
        ldx #0
        jsr wrout
dm_fc:  ldx #$30
        jsr fclose
dm_v:   jsr skip32
        lda c0
        cmp hcrl
        bne dm_bad
        lda c1
        cmp hcrh
        bne dm_bad
        jsr putsi
        .byte 'OK',EOL,0
        rts
dm_bad: jsr putsi
        .byte 'CRC ERROR',EOL,0
        rts

putc_mode:
        lda mode
        cmp #1
        bne pm_t
        lda #'X'
        jmp putc
pm_t:   lda #'T'
        jmp putc

putname:
        ldy #0
pn1:    lda NAMEB,y
        beq pn2
        jsr putc
        iny
        bne pn1
pn2:    rts

; ---- listing ----
mname:  ldx #0
mn_l:   lda HDR+3,x
        jsr toupper
        jsr putc
        inx
        cpx #3
        bcc mn_l
        rts

listline:
        ldy #0
ll_n:   lda NAMEB,y
        beq ll_p
        jsr putc
        iny
        cpy #13
        bcc ll_n
ll_p:   sty tl
        lda #13
        sec
        sbc tl
        tay
        jsr putsp
        ldx #3
ll_a:   lda HDR+11,x
        sta dv,x
        dex
        bpl ll_a
        jsr dec32
        jsr putdig
        ldx #3
ll_c:   lda HDR+7,x
        sta dv,x
        dex
        bpl ll_c
        jsr dec32
        jsr putdig
        lda #' '
        jsr putc
        jsr mname
        lda #' '
        jsr putc
        lda HDR+17
        lsr
        lsr
        lsr
        lsr
        lsr
        sta tl
        lda HDR+18
        and #1
        asl
        asl
        asl
        ora tl
        jsr put2d
        lda #'-'
        jsr putc
        lda HDR+17
        and #31
        jsr put2d
        jmp putnl

put2d:  ldx #0
p2_l:   cmp #10
        bcc p2_d
        sbc #10
        inx
        bne p2_l
p2_d:   pha
        txa
        ora #'0'
        jsr putc
        pla
        ora #'0'
        jmp putc

; dv (32 bit) -> 8 digits in dig, leading zeros turned into spaces
dec32:  ldy #0
d3_p:   sty kl
        lda #0
        sta kh
d3_t:   tya
        asl
        asl
        tax
        sec
        lda dv
        sbc pw,x
        sta tv
        lda dv+1
        sbc pw+1,x
        sta tv+1
        lda dv+2
        sbc pw+2,x
        sta tv+2
        lda dv+3
        sbc pw+3,x
        bcc d3_d
        sta dv+3
        lda tv
        sta dv
        lda tv+1
        sta dv+1
        lda tv+2
        sta dv+2
        inc kh
        jmp d3_t
d3_d:   lda kh
        ora #'0'
        sta dig,y
        iny
        cpy #8
        bcc d3_p
        ldy #0
d3_z:   lda dig,y
        cmp #'0'
        bne d3_r
        cpy #7
        beq d3_r
        lda #' '
        sta dig,y
        iny
        bne d3_z
d3_r:   rts
putdig: ldy #1
pg_l:   lda dig,y
        jsr putc
        iny
        cpy #8
        bcc pg_l
        rts
pw:     .dword 10000000
        .dword 1000000
        .dword 100000
        .dword 10000
        .dword 1000
        .dword 100
        .dword 10
        .dword 1
        run start
