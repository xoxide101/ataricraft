; zoo.asm - ZOO.COM, a stand-alone Rahul Dhesi ZOO lister/extractor for any Atari DOS.
; Methods: 0 stored, 1 LZW (9..13 bit codes) and 2 LZH (the -lh5- coder, 8K ring). CRC-16 checked. Deleted entries are
; skipped; the short 8.3 name of each entry is used (long names and directories of type 2 entries are ignored).
; Reads the archive front to back and follows the directory chain; an archive whose chain runs backwards cannot be read.
; LZW: a 13 bit table; very long strings are limited by a 1K stack, and the ring is not used. Larger problems: use the host side (AFM/WebATM, web/js/archives.js -> 7-Zip).
; At the ZOO> prompt: L ZOOFILE | X ZOOFILE [DEST] [MEMBER] | T ZOOFILE [MEMBER]   (blank line = exit)
        icl 'lib\sys.asm'

STK     = $5C00         ; LZW string stack (1K), built backwards while a code is unwound
STKEND  = $6000
PGM     = $5B00         ; LZW page map: physical page of each 256-entry slice of the three tables
PGLO    = $4D           ; first page of the low table memory ($4D00..$5AFF), the rest is $6B00..$BBFF
CRL     = $6400         ; CRC-16 tables
CRH     = $6500
INBUF   = $6600
OUTBUF  = $6700
HDR     = $6800         ; main header (32 bytes) and directory entry (51 bytes)
NAMEF   = HDR+38        ; short file name of an entry
VARS    = $6900
DEST    = $69C0
MEMB    = $6A00
TC0     = $6B00         ; Huffman tables: counts for length 0..16 (17 low bytes, 17 high bytes at +32)
TC1     = $6B40
TC2     = $6B80
SYML0   = $6C00         ; table 0 symbols (up to 510): low bytes
SYMH0   = $6E00         ; high bytes
SYML1   = $7000         ; table 1 (distance) symbols
SYML2   = $7040         ; table 2 (code length) symbols
SYMZ    = $7080         ; sink for the unused high bytes of tables 1 and 2
OFFL    = $70C0         ; per-length offsets while building a table
OFFH    = $70E0
LENS    = $7100         ; code lengths (512)
; LZW string tables (entry = code - 256, 31 pages each) are spread over free pages through the page map and overlay
; the Huffman tables (never both in one member)
LZWN    = 31
PGSUF   = PGM           ; character
PGPL    = PGM+LZWN      ; prefix code, low byte
PGPH    = PGM+2*LZWN    ; prefix code, high byte
; ring buffer $8000..$9FFF (8K)

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
dln     = th+1
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
rm0     = dig+8         ; 32-bit output bytes left
rm1     = rm0+1
rm2     = rm1+1
rm3     = rm2+1
blkl    = rm3+1         ; symbols left in the current LZH block
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
dj      = dh+1
tk      = dj+1
mlk     = tk+1
mhk     = mlk+1
pos0    = mhk+1         ; 32-bit position of the next archive byte
pos1    = pos0+1
pos2    = pos1+1
pos3    = pos2+1
nx0     = pos3+1        ; 32-bit position of the next directory entry
nx1     = nx0+1
nx2     = nx1+1
nx3     = nx2+1
tg0     = nx3+1         ; 32-bit seek target
tg1     = tg0+1
tg2     = tg1+1
tg3     = tg2+1
lwd     = tg3+1         ; LZW code width
lmx0    = lwd+1         ; code that needs one more bit
lmx1    = lmx0+1
lfr0    = lmx1+1        ; next free code
lfr1    = lfr0+1
lol0    = lfr1+1        ; previous code
lol1    = lol0+1
lhv     = lol1+1        ; 1 once a previous code exists
lfc     = lhv+1         ; first character of the previous string
lnc     = lfc+1         ; first character of the current string
lcu0    = lnc+1         ; code being decoded
lcu1    = lcu0+1
rng     = lcu1+1        ; 1 when the ring must not be written (LZW tables occupy that memory)

wp      = $B0           ; ring write pointer
sp      = $B2           ; ring read pointer for matches
pcl     = $B4           ; current table: counts low / high, symbols low / high
pch     = $B6
psl     = $B8
psh     = $BA
ex      = $BC
lp      = $C0           ; lengths pointer for table builds
q       = $C2
kp      = $C4           ; LZW string stack pointer
pp      = $8C           ; page pointer into the LZW arrays, its low byte stays 0

        org CODE
        icl 'lib\io.asm'
        icl 'lib\hand.asm'

start:  jsr crctab
        jsr putsi
        .byte 'ZOO 0.1  ZOO LISTER/EXTRACTOR',EOL
        .byte 'L ZOO | X ZOO [DEST] [MEMBER] | T ZOO',EOL
        .byte 'STORED, LZW, LZH. Q QUITS',EOL,0
prompt: tsx
        stx psp
        jsr putnl
        jsr putsi
        .byte 'ZOO>',0
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
        sta pos0
        sta pos1
        sta pos2
        sta pos3
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
ferr_stk:
        jsr putsi
        .byte EOL,'LZW STRING TOO LONG FOR THIS FILE',EOL,0
        jmp abort
ferr_seek:
        jsr putsi
        .byte EOL,'ENTRY ORDER NEEDS A BACKWARD SEEK',EOL,0
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
        inc pos0
        bne gb_c
        inc pos1
        bne gb_c
        inc pos2
        bne gb_c
        inc pos3
gb_c:   clc
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

; one bit, least significant first, returned in the carry
getbitl:
        lda bn
        bne gl_g
        jsr getdb
        sta bb
        lda #8
        sta bn
gl_g:   dec bn
        lsr bb
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

; read forward up to the position in tg0..tg3
seekto: sec
        lda tg0
        sbc pos0
        sta s0
        lda tg1
        sbc pos1
        sta s1
        lda tg2
        sbc pos2
        sta s2
        lda tg3
        sbc pos3
        sta s3
        jcc ferr_seek
        jmp skip32

; Z set when no output bytes are left
remz:   lda rm0
        ora rm1
        ora rm2
        ora rm3
        rts

; ---- output: A = byte into the ring, the CRC and (when writing) the file ----
outb:   sta ob
        jsr crcb
        lda rng
        bne ob_w
        ldy #0
        lda ob
        sta (wp),y
        inc wp
        bne ob_w
        inc wp+1
        lda wp+1
        cmp #$A0
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
        cmp #$A0
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

; ---- canonical Huffman tables (as in lzh.asm, code lengths up to 16) ----
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

; ---- LZH block tables ----
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

; ---- shared LZ loop ----
getsym: lda blkl
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
        ldx #1
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
        and #$1F
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
        cmp #$A0
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

; ---- LZW (method 1) ----
; code of lwd bits, least significant bit first -> vl/vh
getcode:
        lda #0
        sta vl
        sta vh
        lda lwd
        sta gcnt
gc_l:   jsr getbitl
        ror vh
        ror vl
        dec gcnt
        bne gc_l
        lda #16
        sec
        sbc lwd
        sta gcnt
gc_s:   lsr vh
        ror vl
        dec gcnt
        bne gc_s
        rts

lzclr:  lda #9
        sta lwd
        lda #0
        sta lmx0
        sta lhv
        lda #2
        sta lmx1
        lda #258&255
        sta lfr0
        lda #258/256
        sta lfr1
        rts

push:   ldy #0
        sta (kp),y
        inc kp
        bne pu_k
        inc kp+1
pu_k:   lda kp+1
        cmp #>STKEND
        jcs ferr_stk
        rts

lzinit: lda #PGLO
        sta tl
        lda #0
        sta pp
        tax
li_l:   lda tl
        sta PGM,x
        inc tl
        lda tl
        cmp #$5B
        bne li_n
        lda #$6B
        sta tl
li_n:   inx
        cpx #3*LZWN
        bne li_l
        rts

lzw:    jsr lzinit
        jsr lzclr
lw_l:   jsr remz
        beq lw_d
        jsr getcode
        lda vh
        cmp #1
        bne lw_n
        lda vl
        beq lw_c
        cmp #1
        beq lw_d
lw_n:   lda vl
        sta lcu0
        lda vh
        sta lcu1
        lda #<STK
        sta kp
        lda #>STK
        sta kp+1
        lda lhv
        bne lw_s
        lda lcu1
        jne ferr_data
        lda lcu0
        sta lfc
        sta lol0
        lda #0
        sta lol1
        lda #1
        sta lhv
        lda lfc
        jsr outb
        jmp lw_l
lw_c:   jsr lzclr
        jmp lw_l
lw_d:   rts
lw_s:   lda lcu0
        cmp lfr0
        lda lcu1
        sbc lfr1
        bcc lw_u
        lda lcu0
        cmp lfr0
        jne ferr_data
        lda lcu1
        cmp lfr1
        jne ferr_data
        lda lfc
        jsr push
        lda lol0
        sta vl
        lda lol1
        sta vh
        jmp lw_w
lw_u:   lda lcu0
        sta vl
        lda lcu1
        sta vh
lw_w:   lda vh
        beq lw_t
        tax
        lda PGSUF-1,x
        sta pp+1
        ldy vl
        lda (pp),y
        jsr push
        ldx vh
        lda PGPL-1,x
        sta pp+1
        ldy vl
        lda (pp),y
        pha
        ldx vh
        lda PGPH-1,x
        sta pp+1
        lda (pp),y
        sta vh
        pla
        sta vl
        jmp lw_w
lw_t:   lda vl
        sta lnc
        jsr push
lw_o:   lda kp
        bne lw_p
        lda kp+1
        cmp #>STK
        beq lw_e
lw_p:   lda kp
        bne lw_q
        dec kp+1
lw_q:   dec kp
        ldy #0
        lda (kp),y
        jsr outb
        jmp lw_o
lw_e:   lda lfr1
        cmp #LZWN+1
        bcs lw_g
        tax
        lda PGSUF-1,x
        sta pp+1
        ldy lfr0
        lda lnc
        sta (pp),y
        lda PGPL-1,x
        sta pp+1
        lda lol0
        sta (pp),y
        lda PGPH-1,x
        sta pp+1
        lda lol1
        sta (pp),y
        inc lfr0
        bne lw_g
        inc lfr1
lw_g:   lda lcu0
        sta lol0
        lda lcu1
        sta lol1
        lda lnc
        sta lfc
lw_f:   lda lfr0
        cmp lmx0
        lda lfr1
        sbc lmx1
        jcc lw_l
        lda lwd
        cmp #13
        jcs lw_l
        inc lwd
        asl lmx0
        rol lmx1
        jmp lw_l

; run the member's data through the decoder; carry set when the method is not supported
procdata:
        lda #0
        sta c0
        sta c1
        sta bn
        sta opos
        sta rng
        sta blkl
        sta blkh
        sta wp
        lda #$80
        sta wp+1
        ldx #3
pd_x:   lda HDR+10,x
        sta tg0,x
        dex
        bpl pd_x
        jsr seekto
        ldx #3
pd_a:   lda HDR+24,x
        sta s0,x
        lda HDR+20,x
        sta rm0,x
        dex
        bpl pd_a
        lda HDR+5
        beq pd_0
        cmp #1
        beq pd_1
        cmp #2
        beq pd_2
        sec
        rts
pd_0:   jsr remz
        beq pd_k
        jsr getdb
        jsr outb
        jmp pd_0
pd_1:   inc rng
        jsr lzw
        jmp pd_k
pd_2:   lda #14
        sta pnp
        jsr fillring
        jsr lzmain
pd_k:   clc
        rts

; ---- archive walk ----
; main header: 20 byte text, tag $FDC4A7DC, offset of the first entry
rdmain: lda #0
        sta tl
rm_l:   jsr getbyt
        ldy tl
        sta HDR,y
        iny
        sty tl
        cpy #32
        bne rm_l
        ldx #3
rm_t:   lda HDR+20,x
        cmp ztag,x
        bne rm_b
        lda HDR+24,x
        sta nx0,x
        dex
        bpl rm_t
        rts
rm_b:   jsr putsi
        .byte 'NOT A ZOO ARCHIVE',EOL,0
        jmp abort
ztag:   .byte $DC,$A7,$C4,$FD

members:
        jsr rdmain
mem:    ldx #3
mm_t:   lda nx0,x
        sta tg0,x
        dex
        bpl mm_t
        jsr seekto
        lda #0
        sta tl
mm_r:   jsr getbyt
        ldy tl
        sta HDR,y
        iny
        sty tl
        cpy #51
        bne mm_r
        ldx #3
mm_g:   lda HDR,x
        cmp ztag,x
        jne ferr_data
        lda HDR+6,x
        sta nx0,x
        dex
        bpl mm_g
        lda nx0
        ora nx1
        ora nx2
        ora nx3
        beq mem_d
        lda HDR+30
        bne mem
        ldx #0
mm_n:   lda NAMEF,x
        beq mm_e
        inx
        cpx #13
        bcc mm_n
mm_e:   stx nf
        jsr conv83
        jsr uniq
        lda NAMEB
        beq mem
        jsr domember
        inc nfl
        bne mem
        inc nfh
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

; list, extract or test the entry in HDR
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
        rts
dm_chk: lda wr
        beq dm_v
        lda opos
        beq dm_fc
        ldx #0
        jsr wrout
dm_fc:  ldx #$30
        jsr fclose
dm_v:   lda c0
        cmp HDR+18
        bne dm_bad
        lda c1
        cmp HDR+19
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
mname:  lda HDR+5
        cmp #3
        bcc mn_k
        lda #3
mn_k:   sta tl
        asl
        clc
        adc tl
        tax
        ldy #3
mn_l:   lda mtab,x
        jsr putc
        inx
        dey
        bne mn_l
        rts
mtab:   .byte 'STOLZWLZH???'

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
ll_a:   lda HDR+20,x
        sta dv,x
        dex
        bpl ll_a
        jsr dec32
        jsr putdig
        ldx #3
ll_c:   lda HDR+24,x
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
        lda HDR+14
        lsr
        lsr
        lsr
        lsr
        lsr
        sta tl
        lda HDR+15
        and #1
        asl
        asl
        asl
        ora tl
        jsr put2d
        lda #'-'
        jsr putc
        lda HDR+14
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
        .if * > PGLO*256
        .error 'ZOO code overlaps the LZW tables'
        .endif
        run start
