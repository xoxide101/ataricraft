; arj.asm - ARJ.COM, a stand-alone ARJ lister/extractor for any Atari DOS.
; Methods: 0 stored, 1-3 (LZ77 + Huffman, as ARJ's 26K window; here a 22K ring), 4 (fastest). CRC-32 checked, header
; CRC-32 checked. Encrypted, multi-volume and non-file entries are skipped; the last path component is mapped to 8.3.
; A member whose match distance reaches beyond the 22K ring stops with WINDOW TOO SMALL.
; At the ARJ> prompt: L ARJFILE | X ARJFILE [DEST] [MEMBER] | T ARJFILE [MEMBER]   (blank line = exit)
;
; Usage notes
;   L  list: one line per file (8.3 name, unpacked size, packed size, method, month-day).
;   X  extract: DEST is a drive/folder prefix (default D:); MEMBER limits it to one 8.3 name.
;   T  test: decode and compare the CRC-32 without writing a file.   Q or a blank line leaves via DOSVEC.
;   An archive name without ":" gets "D:" in front. Only the last path component of a name is used (conv83, uniq).
;
; ARJ layout handled (little endian). Every header: $60 $EA, basic header size (2 bytes, 0 = end of archive),
; the basic header (copied into HDR, at most 255 bytes), its CRC-32, then extended headers (2-byte size, data,
; 4-byte CRC; size 0 ends the list). Fields of the basic header as used here (offsets within HDR):
;   +0 first header size (the file name starts at HDR[HDR+0], zero terminated)  +4 flags (bit 0 = encrypted)
;   +5 method (0 stored, 1-3 LZ77+Huffman, 4 "fastest")  +6 file type (0 binary, 1 text, 2 main header/comment,
;   3 folder, 4 label)  +10 DOS date (day = bits 0-4, month = bits 5-8)  +12 packed size  +16 original size
;   +20 CRC-32 of the original data. The packed data follows the headers directly. Types 2, 3 and 4 are not
;   extracted; their data (if any) is skipped.
;
; Structure: prompt -> members (header walk: rdhdr) -> domember -> procdata -> lzmain (methods 1-3) or
;   fmain (method 4) -> outb (ring + CRC-32 + output buffer). Methods 1-3 use LZH-style blocks (newblk/rdpt build
;   three canonical Huffman tables, getsym/getdist/copym expand), method 4 uses fixed unary-prefixed codes.
;
; Memory map: code from CODE ($3800, lib\sys.asm) up to $4CFF (checked by the .if at the end); $4D00-$50FF CRC-32
;   tables (one page per byte); $5100 input buffer; $5200 output buffer; $5300 HDR; $5400 variables; $5600-$5C00
;   Huffman counts/symbols; $5C00 code lengths (512); $5E00 name; $6400-$BBFF = 22K ring buffer (the window).
; Zero page: $B0 wp (ring write), $B2 sp (match source), $B4-$BA table pointers, $BC ex, $C0 lp, $C2 q.
;   IOCB 2 ($20) = archive, IOCB 3 ($30) = output file.
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

; ---- start: build the CRC-32 tables, print the banner, fall into the command loop ----
start:  jsr crctab
        jsr putsi
        .byte 'ARJ 0.1  ARJ LISTER/EXTRACTOR',EOL
        .byte 'L ARJ | X ARJ [DEST] [MEMBER] | T ARJ',EOL
        .byte 'STORED, METHODS 1-4. Q QUITS',EOL,0
; ---- command loop: read a line, mode (L=0, X=1 extract, T=2 test) -> 'mode', then parse
; ARCHIVE [DEST] [MEMBER] into FSPEC / DEST / MEMB. 'psp' keeps the stack pointer so abort can unwind.
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
; archive name has no ':' -> prefix "D:"; DEST defaults to "D:" and MEMB to empty (= all members)
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
pm_go:  lda #4          ; OPEN for input on IOCB 2
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

; ---- bye: close both files and return to DOS ----
bye:    ldx #$20
        jsr fclose
        ldx #$30
        jsr fclose
        jmp (DOSVEC)

; ---- abort: close IOCB 2 (archive) and IOCB 3 (output), restore the stack saved at the prompt and re-prompt.
; Used by every fatal error path; the error text has already been printed.
abort:  ldx #$30
        jsr fclose
        ldx #$20
        jsr fclose
        ldx psp
        txs
        jmp prompt
; ---- fatal error messages: print text then abort ----
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

; ---- CRC32 tables (poly $EDB88320, reflected) ----
; Builds the 256 entries one byte-column per page: CRT0 = bits 0-7 ... CRT3 = bits 24-31 of each entry.
; For each X: shift the 32-bit value (lenh:lenl:th:tl) right 8 times, XORing the polynomial ($EDB88320)
; whenever a 1 bit falls out. Clobbers A,X,Y,tl,th,lenl,lenh.
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
; Table-driven update: index = (crc xor byte) & $FF, new crc = (crc >> 8) xor table[index]. The right
; shift by 8 is done by moving c1->c0, c2->c1, c3->c2. The CRC is kept un-inverted ($FFFFFFFF start,
; see crcinit); the final value is complemented when compared. Clobbers A,X.
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
; fill: read up to 255 bytes of the archive into INBUF. Out: ilen = count read, ipos = 0,
; carry set if nothing was read (EOF). Clobbers A,X.
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

; same, but the end of the file is an error (jumps to ferr_eof, which aborts). Clobbers A,X.
getbyt: jsr getbyte
        jcs ferr_eof
        rts

; next byte of the member's packed data (s0..s3 counts what is left; zeros after the end, like the host decoder)
; Decrements the 32-bit count s3:s2:s1:s0 (with borrow) before reading, so the packed size bounds the reads
; and what the decoder did not consume can be skipped later by skip32. Clobbers A,X.
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

; one bit, most significant first (the ARJ Huffman bit order). bb = current byte, bn = bits left.
; Out: A = bit, Z set if 0. Clobbers A.
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
; Shifts vl/vh left and ORs in each new bit. Clobbers A,gcnt.
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
; Reads and discards a 32-bit count (s3:s2:s1:s0, counted down to 0 with borrow). The file is read
; sequentially, so skipping means reading. Clobbers A,X,s0-s3.
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
; Stores the byte at wp (ring $6400..$BBFF, wp wraps to the start), updates the CRC, counts down the
; remaining output size rm0..rm3, and if wr<>0 appends it to OUTBUF, flushing 256 bytes when opos wraps to 0.
; Clobbers A,X,Y,ob.
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
; Each table has counts per code length (17 low bytes at TCn, 17 high bytes at TCn+32) and the symbols sorted by
; code (low/high byte arrays). 0 = literal/length (up to 510 symbols), 1 = distance, 2 = code-length codes.
; Tables 1 and 2 have symbols < 256, so their high bytes go to the SYMZ scratch sink.
; X = table number -> pcl/pch/psl/psh
; Out: pcl/pch = counts low/high, psl/psh = symbol low/high arrays. Clobbers A.
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
; Canonical Huffman construction: pass 1 (p1) counts how many symbols have each length; ofl turns the counts
; into the first slot of each length in the sorted symbol list; pass 2 (p2) walks the lengths again and drops
; symbol number il/ih into the next free slot of its length (length 0 = unused symbol).
; In: lp = lengths (one byte each), nl/nh = count. Clobbers A,X,Y,q,kl,kh,il,ih,tl,th,ex.
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
; Canonical decode, one bit at a time. cdl/cdh = code so far, fl/fh = first code of the current length,
; il/ih = index of the first symbol of that length, dln = current length (1..16). For each length the code
; is compared against first+count; if smaller the symbol is sym[index + (code - first)]. Otherwise the first
; code doubles, the code shifts left and the next bit is read. More than 16 bits -> BAD DATA.
; Clobbers A,Y,tl,th,kl,kh,ex and the decode state above.
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
; Methods 1-3 code the data in blocks, each with its own tables (same scheme as LHA's -lh4/-lh5 family):
; rdpt reads one table of code lengths. Block header: 16-bit symbol count, then the code-length table (table 2),
; the literal/length table (table 0, 510 symbols, lengths run-length coded with table 2) and the distance table
; (table 1, pnp symbols). A table whose length count is 0 is a single constant symbol (cfl/cvl/cvh) and costs no bits.
; read a table: pn symbols, pb bits for the length count, ps = position after which 2 bits of zero run follow (255 = none)
; Each length is 3 bits; 7 means 7 plus a unary extension (one extra 1-bit per step, up to 16).
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
; The table-2 table has 19 symbols (5-bit count) and a 2-bit zero run after the 3rd entry. Then a 9-bit count of
; literal/length entries is read; each decoded table-2 symbol means: 0 = one zero length, 1 = 3+4-bit zeros,
; 2 = 20+9-bit zeros, >=3 = a length of (symbol-2). The distance table follows (pnp symbols, 5-bit count).
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
; getsym: next literal/length symbol -> vl/vh, starting a new block (newblk) when the block's symbol count
; blkl/blkh has run out. Clobbers everything decode does.
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

; getdist: distance code from table 1 -> dl/dh (distance minus 1). Code 0 and 1 are the values themselves;
; code n >= 2 means n-1 extra bits: dl/dh = (1 << (n-1)) OR the extra bits.
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
; A distance that does not fit the ring (high byte >= >RINGSZ) sets wf (WINDOW TOO SMALL) and zeroes the
; remaining-output count so decoding stops. Otherwise sp = wp - dist - 1, wrapped into the ring, and bytes are
; copied one at a time through outb (so overlapping matches work) until lenl/lenh or the output size runs out.
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
; Symbol < 256 is a literal; otherwise it is a match with length = symbol - 253 (symbol 256 = length 3).
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

; ---- method 4 ("fastest") ----
; No Huffman tables: lengths and distances use an unary-prefixed code with a growing number of extra bits.
; length: vl = bits read as in the host decoder (0 = literal)
; Counts up to 7 leading 1-bits (tk); the number of extra bits is tk and the value is the sum of the prefix
; weights 1,2,4.. (mlk) plus those extra bits. Result in vl; 0 means a literal follows. Clobbers A,X,mlk,mhk,tk.
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
; Same idea starting at 9 extra bits: a unary prefix of up to 4 one-bits (tk 9..13) adds 512, 1024, ... to the
; base (mlk/mhk, kl/kh holds the next weight), then tk extra bits are added. Result is distance minus 1.
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

; method 4 main loop: a length of 0 is followed by an 8-bit literal, otherwise the match length is value+2
; and a distance follows; runs until the output size is reached.
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
; Rejects flag bit 0 (encrypted) and methods >= 5. Sets CRC = $FFFFFFFF, clears wf/bn/opos/blkl/blkh, sets wp to the
; ring start, loads the remaining-output count rm0..rm3 from the original size (HDR+16). Method 0 copies bytes,
; 1-3 -> lzmain (pnp = 17 distance symbols), 4 -> fmain. Carry clear on return means "ran".
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
; Reads the 2-byte header size (rejects >= $0B00), the header bytes into HDR (only the first 255 are stored, all
; feed the CRC), compares the stored CRC-32 (HEADER CRC ERROR on mismatch), then skips the extended headers
; (each: 2-byte size, that many bytes + 4 for its CRC). A bad signature on the first header gives NOT AN ARJ
; ARCHIVE (fst = 0), later it is BAD DATA. End of file (EOF) between headers is treated as the end.
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

; members: loop over headers. Type 2 (the archive's main header) is passed over; types 0 and 1 (binary, text)
; are given a name (getname, conv83, uniq) and passed to domember; folders and labels are only skipped.
; s0..s3 is loaded with the packed size (HDR+12) so the data after the header is skipped (skip32) whatever
; domember did not consume. nfl/nfh counts files processed.
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
        jsr uniq
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
; The name is at HDR[HDR+0] (zero terminated); '/' or '\' restarts the copy; at most 127 chars kept.
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
; Pass 1 finds st = index after the last '/', '\' or $FF and ld = index after the last '.' in that part (0 if
; none). Then up to 8 stem chars (st..be) and up to 3 extension chars are copied through fixc. An empty stem
; leaves NAMEB empty. Clobbers A,X,Y,st,ld,be,ec.
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
; want=1 when mode is X/T and the name matches the filter. L mode prints a listing line; X opens DEST+NAMEB on
; IOCB 3 and writes the output; both X and T run procdata, then compare the running CRC (complemented) with the
; stored CRC-32 at HDR+20 and print OK / CRC ERROR; a match that reached outside the ring prints WINDOW TOO SMALL.
; Encrypted entries and unsupported methods are reported and skipped.
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
        lda #8          ; OPEN for output on IOCB 3 (creates/overwrites)
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
dm_k:   lda c0,x        ; stored CRC-32 is the complement of the running value
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

; print 'X' (extracting) or 'T' (testing) before the name
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
; print the 3-letter method name from mtab: index = method (0-4), anything higher shows '???'. Clobbers A,X,Y,tl.
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

; one listing line: name padded to 13, original size (HDR+16), packed size (HDR+12), method, then the date
; as MM-DD. DOS date word at HDR+10: day = bits 0-4, month = bits 5-8 (the top month bit is HDR+11 bit 0).
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

; A (0-99) -> two decimal digits
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
; Repeated subtraction of the powers of ten in table pw (10^7 .. 1); dv keeps the remainder (tv = scratch).
; Clobbers A,X,Y,kl,kh,tv.
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
; print dig[1..7] (the top digit is dropped, so sizes above 9,999,999 would show truncated)
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
