; arj.asm - ARJ.COM, a stand-alone ARJ lister/extractor for any Atari DOS.
; Methods: 0 stored, 1-3 (LZ77 + Huffman, as ARJ's 26K window; here a 22K ring), 4 (fastest). CRC-32 checked, header
; CRC-32 checked. Encrypted, multi-volume and non-file entries are skipped; the last path component is mapped to 8.3.
; A member whose match distance reaches beyond the 22K ring stops with WINDOW TOO SMALL.
; At the ARJ> prompt: L ARJFILE | X ARJFILE [DEST] [MEMBER] | T ARJFILE [MEMBER]   (blank line = exit)
        icl 'lib\sys.asm'

CRT0    = $4D00         ; CRC32 tables, one page per byte of the 32-bit entry
CRT1    = $4E00
CRT2    = $4F00
CRT3    = $5000
INBUF   = $5100
OUTBUF  = $5200
HDR     = $5300         ; basic header of the current entry (first 255 bytes)
VARS    = $5400
DEST    = $54C0
MEMB    = $5500
TC0     = $5600         ; Huffman tables: counts for length 0..16 (17 low bytes, 17 high bytes at +32)
TC1     = $5640
TC2     = $5680
SYML0   = $5700         ; table 0 symbols (up to 510): low bytes
SYMH0   = $5900         ; high bytes
SYML1   = $5B00         ; table 1 (distance) symbols
SYML2   = $5B40         ; table 2 (code length) symbols
SYMZ    = $5B80         ; sink for the unused high bytes of tables 1 and 2
OFFL    = $5BC0         ; per-length offsets while building a table
OFFH    = $5BE0
LENS    = $5C00         ; code lengths (512)
NAMEF   = $5E00         ; last path component of the entry name (up to 127 characters)
RING    = $6400         ; ring buffer $6400..$BBFF (22K)
RINGEND = $BC00
RINGSZ  = RINGEND-RING

ipos    = VARS
ilen    = ipos+1
bb      = ilen+1
bn      = bb+1
opos    = bn+1
mode    = opos+1        ; 0 list 1 extract 2 test
wr      = mode+1        ; 1 while the member is being written to a file
c0      = wr+1          ; running CRC-32
c1      = c0+1
c2      = c1+1
c3      = c2+1
ob      = c3+1
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
pos0    = mhk+1
hl      = pos0          ; basic header size, remaining header bytes
hh      = hl+1
fst     = hh+1          ; 0 before the first header has been read
wf      = fst+1         ; 1 when a match reached beyond the ring

wp      = $B0           ; ring write pointer
sp      = $B2           ; ring read pointer for matches
pcl     = $B4           ; current table: counts low / high, symbols low / high
pch     = $B6
psl     = $B8
psh     = $BA
ex      = $BC
lp      = $C0           ; lengths pointer for table builds
q       = $C2

        org CODE
        icl 'lib\io.asm'
        icl 'lib\hand.asm'

start:  jsr crctab
        jsr putsi
        .byte 'ARJ 0.1  ARJ LISTER/EXTRACTOR',EOL
        .byte 'L ARJ | X ARJ [DEST] [MEMBER] | T ARJ',EOL
        .byte 'STORED, METHODS 1-4. BLANK LINE EXITS',EOL,0
prompt: tsx
        stx psp
        jsr putnl
        jsr putsi
        .byte 'ARJ>',0
        jsr getlineh
        lda #<LINE
        sta ARG
        lda #>LINE
        sta ARG+1
        jsr nexttok
        jeq bye
        lda TOK
        jsr toupper
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
        sta fst
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
ferr_hcrc:
        jsr putsi
        .byte EOL,'HEADER CRC ERROR',EOL,0
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

; ---- CRC32 tables (poly $EDB88320) ----
crctab: ldx #0
ct_l:   stx tl
        lda #0
        sta th
        sta lenl
        sta lenh
        ldy #8
ct_b:   lsr lenh
        ror lenl
        ror th
        ror tl
        bcc ct_n
        lda tl
        eor #$20
        sta tl
        lda th
        eor #$83
        sta th
        lda lenl
        eor #$B8
        sta lenl
        lda lenh
        eor #$ED
        sta lenh
ct_n:   dey
        bne ct_b
        lda tl
        sta CRT0,x
        lda th
        sta CRT1,x
        lda lenl
        sta CRT2,x
        lda lenh
        sta CRT3,x
        inx
        bne ct_l
        rts

; A = byte -> running CRC32
crcb:   eor c0
        tax
        lda c1
        eor CRT0,x
        sta c0
        lda c2
        eor CRT1,x
        sta c1
        lda c3
        eor CRT2,x
        sta c2
        lda CRT3,x
        sta c3
        rts

; running CRC32 = $FFFFFFFF
crcinit:
        lda #$FF
        sta c0
        sta c1
        sta c2
        sta c3
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
        cmp #>RINGEND
        bne ob_w
        lda #>RING
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
        lda #5
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

; ---- LZ77 copy: lenl/lenh bytes from distance dl/dh + 1 back in the ring ----
copym:  lda dh
        cmp #>RINGSZ
        bcc cm_o
        lda #1
        sta wf
        lda #0
        sta rm0
        sta rm1
        sta rm2
        sta rm3
        rts
cm_o:   sec
        lda wp
        sbc dl
        sta sp
        lda wp+1
        sbc dh
        sta sp+1
        lda sp
        bne cm_1
        dec sp+1
cm_1:   dec sp
        lda sp+1
        cmp #>RING
        bcs cm_c
        clc
        adc #>RINGSZ
        sta sp+1
cm_c:   lda lenl
        ora lenh
        beq cm_d
        jsr remz
        beq cm_d
        ldy #0
        lda (sp),y
        sta tk
        inc sp
        bne cm_2
        inc sp+1
        lda sp+1
        cmp #>RINGEND
        bne cm_2
        lda #>RING
        sta sp+1
cm_2:   lda tk
        jsr outb
        lda lenl
        bne cm_3
        dec lenh
cm_3:   dec lenl
        jmp cm_c
cm_d:   rts

; methods 1-3: decode until the output size is reached
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
        jsr copym
        jmp lzmain
lz_d:   rts

; ---- method 4 ----
; length: vl = bits read as in the host decoder (0 = literal)
declen: lda #0
        sta mlk
        sta tk
        lda #1
        sta mhk
dl_l:   lda tk
        cmp #7
        bcs dl_e
        jsr getbit
        beq dl_e
        lda mlk
        clc
        adc mhk
        sta mlk
        asl mhk
        inc tk
        jmp dl_l
dl_e:   ldx tk
        jsr getbits
        lda vl
        clc
        adc mlk
        sta vl
        rts

; distance -> dl/dh
decptr: lda #0
        sta mlk
        sta mhk
        sta kl
        lda #2
        sta kh
        lda #9
        sta tk
dp_l:   lda tk
        cmp #13
        bcs dp_e
        jsr getbit
        beq dp_e
        clc
        lda mlk
        adc kl
        sta mlk
        lda mhk
        adc kh
        sta mhk
        asl kl
        rol kh
        inc tk
        jmp dp_l
dp_e:   ldx tk
        jsr getbits
        clc
        lda vl
        adc mlk
        sta dl
        lda vh
        adc mhk
        sta dh
        rts

fmain:  jsr remz
        beq fm_d
        jsr declen
        lda vl
        bne fm_m
        ldx #8
        jsr getbits
        lda vl
        jsr outb
        jmp fmain
fm_m:   clc
        adc #2
        sta lenl
        lda #0
        adc #0
        sta lenh
        jsr decptr
        jsr copym
        jmp fmain
fm_d:   rts

; run the member's data through the decoder; carry set when the method is not supported or the entry is encrypted
procdata:
        lda HDR+4
        and #1
        bne pd_u
        lda HDR+5
        cmp #5
        bcs pd_u
        jsr crcinit
        lda #0
        sta wf
        sta bn
        sta opos
        sta blkl
        sta blkh
        sta wp
        lda #>RING
        sta wp+1
        ldx #3
pd_a:   lda HDR+16,x
        sta rm0,x
        dex
        bpl pd_a
        lda HDR+5
        beq pd_0
        cmp #4
        beq pd_4
        lda #17
        sta pnp
        jsr lzmain
        jmp pd_k
pd_0:   jsr remz
        beq pd_k
        jsr getdb
        jsr outb
        jmp pd_0
pd_4:   jsr fmain
pd_k:   clc
        rts
pd_u:   sec
        rts

; ---- archive walk ----
; one header: $60 $EA, size, header bytes, CRC32, extended headers; hl/hh = 0 at the end of the archive
rdhdr:  jsr getbyte
        jcs rh_z
        cmp #$60
        jne rh_b
        jsr getbyt
        cmp #$EA
        jne rh_b
        jsr getbyt
        sta hl
        jsr getbyt
        sta hh
        lda #1
        sta fst
        lda hl
        ora hh
        jeq rh_e
        lda hh
        cmp #$0B
        jcs ferr_data
        jsr crcinit
        lda hl
        sta kl
        lda hh
        sta kh
        lda #0
        sta tl
rh_l:   jsr getbyt
        pha
        ldy tl
        sta HDR,y
        cpy #255
        beq rh_f
        inc tl
rh_f:   pla
        jsr crcb
        lda kl
        bne rh_k
        dec kh
rh_k:   dec kl
        lda kl
        ora kh
        bne rh_l
        lda #0
        sta tk
rh_c:   jsr getbyt
        ldy tk
        sta dv,y
        iny
        sty tk
        cpy #4
        bne rh_c
        ldx #3
rh_v:   lda c0,x
        eor #$FF
        cmp dv,x
        jne ferr_hcrc
        dex
        bpl rh_v
rh_x:   jsr getbyt
        sta s0
        jsr getbyt
        sta s1
        ora s0
        jeq rh_e
        lda s0
        clc
        adc #4
        sta s0
        bcc rh_y
        inc s1
rh_y:   lda #0
        sta s2
        sta s3
        jsr skip32
        jmp rh_x
rh_z:   lda #0
        sta hl
        sta hh
rh_e:   rts
rh_b:   lda fst
        jne ferr_data
        jsr putsi
        .byte 'NOT AN ARJ ARCHIVE',EOL,0
        jmp abort

members:
mem:    jsr rdhdr
        lda hl
        ora hh
        beq mem_d
        lda HDR+6
        cmp #2
        beq mem
        ldx #3
mm_s:   lda HDR+12,x
        sta s0,x
        dex
        bpl mm_s
        lda HDR+6
        beq mm_f
        cmp #1
        bne mm_k
mm_f:   jsr getname
        jsr conv83
        lda NAMEB
        beq mm_k
        jsr domember
        inc nfl
        bne mm_k
        inc nfh
mm_k:   jsr skip32
        jmp mem
mem_d:  rts

; the last path component of the name that follows the fixed header part -> NAMEF, nf
getname:
        ldy HDR
        ldx #0
gn_l:   lda HDR,y
        beq gn_e
        cmp #'/'
        beq gn_s
        cmp #'\'
        bne gn_c
gn_s:   ldx #0
        jmp gn_n
gn_c:   cpx #127
        bcs gn_n
        sta NAMEF,x
        inx
gn_n:   iny
        bne gn_l
gn_e:   stx nf
        rts

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
dm_nu:  lda HDR+4
        and #1
        beq dm_um
        jsr putsi
        .byte 'ENCRYPTED, SKIPPED',EOL,0
        rts
dm_um:  jsr putsi
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
dm_v:   lda wf
        bne dm_w2
        ldx #3
dm_k:   lda c0,x
        eor #$FF
        cmp HDR+20,x
        bne dm_bad
        dex
        bpl dm_k
        jsr putsi
        .byte 'OK',EOL,0
        rts
dm_w2:  jsr putsi
        .byte 'WINDOW TOO SMALL',EOL,0
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
        cmp #5
        bcc mn_k
        lda #5
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
mtab:   .byte 'STOLZ1LZ2LZ3FST???'

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
ll_a:   lda HDR+16,x
        sta dv,x
        dex
        bpl ll_a
        jsr dec32
        jsr putdig
        ldx #3
ll_c:   lda HDR+12,x
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
        lda HDR+10
        lsr
        lsr
        lsr
        lsr
        lsr
        sta tl
        lda HDR+11
        and #1
        asl
        asl
        asl
        ora tl
        jsr put2d
        lda #'-'
        jsr putc
        lda HDR+10
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
        .if * > $4D00
        .error 'ARJ code overlaps the tables'
        .endif
        run start
