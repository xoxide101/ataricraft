; zip.asm - ZIP.COM, a stand-alone PKZIP lister/extractor for any Atari DOS.
; Methods: 0 stored and 8 deflate (CRC32 checked). Other PKZIP methods (shrink, reduce, implode, deflate64, bzip2, lzma)
; are listed but reported UNSUPPORTED; encrypted entries and zip64 are not supported. Use the host side (AFM/WebATM,
; web/js/archives.js -> 7-Zip) for those. Reads the archive front to back (local headers), so it needs no seeking.
; Window: back references reach 14336 bytes ($8000-$B7FF ring); farther ones stop with "WINDOW TOO SMALL".
; At the ZIP> prompt: L ZIPFILE | X ZIPFILE [DEST] [MEMBER] | T ZIPFILE [MEMBER]   (blank line = exit)
;
; Usage notes
;   L  list: one line per member (8.3 name, size, packed size, method, date).
;   X  extract: DEST is a drive/folder prefix (default D:); MEMBER limits it to one 8.3 name.
;   T  test: decode and check the CRC without writing any file.
;   Q (or a blank line) leaves through DOSVEC. Archive names without ":" get "D:" prepended.
;   Long and folder names in the archive are folded to upper case 8.3 (conv83, uniq); folder entries are skipped.
;
; ZIP layout handled (little endian), local file header, 30 bytes, kept in HDR:
;   +0 'PK',3,4  +4 version  +6 flags (bit0 encrypted, bit3 sizes follow in a data descriptor)
;   +8 method  +10 time  +12 date  +14 CRC32  +18 packed size  +22 unpacked size
;   +26 name length  +28 extra field length, then the name, the extra field and the packed data.
; The central directory is never read; the walk ends at the first record that is not 'PK',3,4.
; With flag bit 3 the real CRC and sizes come from the descriptor after the data (optional 'PK',7,8 first).
;
; Structure: prompt/command parser -> members (walk) -> domember (decide) -> procdata (stored or inflate)
;   -> outb (window + CRC32 + output buffer).  inflate = block loop (stored/fixed/dynamic), build (canonical
;   Huffman tables), decode (bit-by-bit canonical decode) and codes (LZ77 literal/length+distance expansion).
;
; Memory map: code at CODE ($3800, lib\sys.asm) up to the tables; $6400-$67FF CRC32 tables (one page per byte);
;   $6800-$6D7F Huffman counts/symbols; $6F00 code lengths; $7100 input buffer (255); $7200 output buffer (256);
;   $7300 HDR; $7340 raw name; $7400 variables; $80-$B7 pages = 14336-byte sliding window (ring, wp/sp wrap).
; Zero page: $B0 wp (window write), $B2 sp (match source), $B4-$BA table pointers, $BC ex (temp pointer),
;   $C0 lp (code-length source), $C2 q, $C4 lq (LENS write), $C6 lend.  IOCB 2 ($20) = archive, IOCB 3 ($30) = output.
        icl 'lib\sys.asm'

CRT0    = $6400         ; CRC32 tables, one page per byte of the 32-bit entry
CRT1    = $6500
CRT2    = $6600
CRT3    = $6700
TC0     = $6800         ; table 0 (literal/length) counts: 16 low bytes, 16 high bytes at +16
TC1     = $6820         ; table 1 (distance)
TC2     = $6840         ; table 2 (code lengths)
SYML0   = $6900         ; table 0 symbols, low bytes (288)
SYMH0   = $6B00         ; table 0 symbols, high bytes
SYML1   = $6D00         ; table 1 symbols (32)
SYML2   = $6D40         ; table 2 symbols (19)
SYMZ    = $6E00         ; scratch sink for the unused high bytes of tables 1 and 2
OFFL    = $6E40         ; per-length offsets while building a table
OFFH    = $6E50
LENS    = $6F00         ; code lengths (up to 320 + repeat overshoot)
INBUF   = $7100
OUTBUF  = $7200
HDR     = $7300         ; local file header (30 bytes)
NAMEF   = $7340         ; raw file name from the archive (up to 120 chars)
VARS    = $7400
DEST    = $74C0
MEMB    = $7500
DB      = $7540         ; data descriptor scratch (8 bytes)
WIN     = $80           ; window pages $80..$B7
WINEND  = $B8

ipos    = VARS+0
ilen    = VARS+1
bb      = VARS+2
bn      = VARS+3
opos    = VARS+4
mode    = VARS+5        ; 0 list 1 extract 2 test
wr      = VARS+6        ; 1 while the member is being written to a file
c0      = VARS+7        ; running CRC32
c1      = VARS+8
c2      = VARS+9
c3      = VARS+10
ob      = VARS+11
gcnt    = VARS+12
ml      = VARS+13
mh      = VARS+14
vl      = VARS+15
vh      = VARS+16
cdl     = VARS+17
cdh     = VARS+18
fl      = VARS+19
fh      = VARS+20
il      = VARS+21
ih      = VARS+22
kl      = VARS+23
kh      = VARS+24
tl      = VARS+25
th      = VARS+26
dlen    = VARS+27
lc      = VARS+28
dc      = VARS+29
lenl    = VARS+30
lenh    = VARS+31
dsl     = VARS+32
dsh     = VARS+33
hlitl   = VARS+34
hdist   = VARS+35
hclen   = VARS+36
totl    = VARS+37
toth    = VARS+38
fin     = VARS+39
prevv   = VARS+40
nl      = VARS+41
nh      = VARS+42
s0      = VARS+43       ; 32-bit skip/copy counter
s1      = VARS+44
s2      = VARS+45
s3      = VARS+46
nf      = VARS+47
st      = VARS+48
ld      = VARS+49
be      = VARS+50
ec      = VARS+51
want    = VARS+52
psp     = VARS+53
nfl     = VARS+54
nfh     = VARS+55
rrl     = VARS+56
rrh     = VARS+57
dv      = VARS+58       ; 4 bytes
tv      = VARS+62       ; 4 bytes
dig     = VARS+66       ; 8 digits
lendh   = VARS+74
lq      = $C4           ; zero page: LENS write pointer
lend    = $C6           ; end of the lengths being read
wp      = $B0           ; window write pointer
sp      = $B2           ; window read pointer for matches
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

; ---- start: build the CRC tables, print the banner, fall into the command loop ----
start:  jsr crctab
        jsr putsi
        .byte 'ZIP 0.1  PKZIP LISTER/EXTRACTOR',EOL
        .byte 'L ZIP | X ZIP [DEST] [MEMBER] | T ZIP',EOL
        .byte 'STORED+DEFLATE ONLY. Q QUITS',EOL,0
; ---- command loop: read a line, pick the mode (L=0, X=1 extract, T=2 test) into 'mode', then
; parse ARCHIVE [DEST] [MEMBER] into FSPEC / DEST / MEMB. 'psp' keeps the stack pointer so abort can unwind.
prompt: tsx
        stx psp
        jsr putnl
        jsr putsi
        .byte 'ZIP>',0
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
ferr_win:
        jsr putsi
        .byte EOL,'WINDOW TOO SMALL FOR THIS FILE',EOL,0
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
; shift by 8 is done by moving c1->c0, c2->c1, c3->c2. The CRC is kept un-inverted ($FFFFFFFF start);
; the final value is complemented when compared. Clobbers A,X.
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
        clc
gb_r:   rts

; same, but the end of the file is an error (jumps to ferr_eof, which aborts). Clobbers A,X.
getbyt: jsr getbyte
        jcs ferr_eof
        rts

; Bit reader: deflate bits are taken LSB first from bb; bn = bits left in bb.
; Out: A = next bit (0/1), Z flag set if 0. Clobbers A.
getbit: lda bn
        bne gt_g
        jsr getbyt
        sta bb
        lda #8
        sta bn
gt_g:   dec bn
        lsr bb
        lda #0
        rol
        rts

; X = number of bits (0-13) -> vl/vh, first bit is the least significant
; Loops getbit, ORing each 1 bit into vl/vh at the mask ml/mh (1,2,4,...). Clobbers A,gcnt,ml,mh.
getbits:
        stx gcnt
        lda #0
        sta vl
        sta vh
        lda #1
        sta ml
        lda #0
        sta mh
gbl:    lda gcnt
        beq gbd
        jsr getbit
        beq gb0
        lda vl
        ora ml
        sta vl
        lda vh
        ora mh
        sta vh
gb0:    asl ml
        rol mh
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

; ---- output: A = byte into the window, the CRC and (when writing) the file ----
; Stores the byte at wp (the window is a ring of pages WIN..WINEND-1, wp wraps back to WIN), updates the CRC,
; and if wr<>0 appends it to OUTBUF, flushing 256 bytes to the file when opos wraps to 0. Clobbers A,X,Y,ob.
outb:   sta ob
        jsr crcb
        ldy #0
        lda ob
        sta (wp),y
        inc wp
        bne ob_w
        inc wp+1
        lda wp+1
        cmp #WINEND
        bne ob_w
        lda #WIN
        sta wp+1
ob_w:   lda wr
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

; ---- Huffman tables ----
; Three tables share the same layout: counts per code length (16 low bytes at TCn, 16 high bytes at TCn+16),
; and symbols sorted by code (low byte / high byte arrays). 0 = literal/length, 1 = distance, 2 = code lengths.
; Tables 1 and 2 have symbols < 256, so their high bytes go to the SYMZ scratch sink.
; X = table number -> pcl/pch/psl/psh
; Out: pcl/pch = counts low/high, psl/psh = symbol low/high arrays. Clobbers A.
settab: lda tcl,x
        sta pcl
        clc
        adc #16
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
; Canonical Huffman construction (as in zlib's puff): pass 1 counts how many symbols have each length
; (p1 loop); ofl turns the counts into the first slot of each length in the sorted symbol list; pass 2 (p2)
; walks the lengths again and drops symbol number il/ih into the next free slot of its length
; (length 0 = unused symbol). In: lp = lengths (one byte each), nl/nh = count. Clobbers A,X,Y,q,kl,kh,il,ih,tl,th,ex.
build:  jsr settab
        ldy #15
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
        cpy #15
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

; X = table -> symbol in vl/vh
; Canonical decode, one bit at a time (puff style). cdl/cdh = code so far, fl/fh = first code of the current
; length, il/ih = index of the first symbol of that length, dlen = current length (1..15). For each length the
; code is compared against first+count; if smaller the symbol is sym[index + (code - first)]. Else the
; first code doubles, the code shifts left and the next bit is read. More than 15 bits -> BAD DATA.
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
        sta dlen
dc_l:   jsr getbit
        ora cdl
        sta cdl
        ldy dlen
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
        inc dlen
        lda dlen
        cmp #16
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

; ---- inflate ----
; Decodes one deflate stream (RFC 1951) from the archive: a loop over blocks. Each block starts with a
; final-block bit (fin) and a 2-bit type: 0 stored, 1 fixed Huffman, 2 dynamic Huffman, 3 = error.
; Output goes through outb. Returns with carry clear after the final block. Clobbers everything.
inflate:
        lda #0
        sta bn
blk:    jsr getbit
        sta fin
        ldx #2
        jsr getbits
        lda vl
        jeq stored
        cmp #1
        beq fixed
        cmp #2
        jeq dynamic
        jmp ferr_data
; fixed Huffman block: literal/length lengths 0-143 = 8, 144-255 = 9 (done by the fx1 loop for the first 256),
; 256-279 = 7, 280-287 = 8 (fx4 loop); distance table = 30 codes of 5 bits. Then decode with 'codes'.
fixed:  ldx #0
        lda #<LENS
        sta lq
        lda #>LENS
        sta lq+1
fx1:    lda #8
        cpx #144
        bcc fx2
        lda #9
fx2:    ldy #0
        sta (lq),y
        inc lq
        bne fx3
        inc lq+1
fx3:    inx
        bne fx1
        ldy #0
fx4:    lda #7
        cpy #24
        bcc fx5
        lda #8
fx5:    sta LENS+256,y
        iny
        cpy #32
        bcc fx4
        lda #<LENS
        sta lp
        lda #>LENS
        sta lp+1
        lda #<288
        sta nl
        lda #>288
        sta nh
        ldx #0
        jsr build
        ldy #29
        lda #5
fx6:    sta LENS,y
        dey
        bpl fx6
        lda #30
        sta nl
        lda #0
        sta nh
        ldx #1
        jsr build
        jmp codes

; dynamic Huffman block: read HLIT, HDIST, HCLEN. hlitl = HLIT+1 (the literal/length count is 256+hlitl, so
; nh=1 is used with it); hdist = HDIST+1; hclen = HCLEN+4.
; Read HCLEN 3-bit code-length-code lengths in the permuted order clord into LENS[0..18]; build table 2 from them;
; then decode hlitl+256+hdist code lengths with table 2 into LENS (16 = repeat previous 3-6x, 17 = zeros 3-10x,
; 18 = zeros 11-138x); finally build table 0 (literal/length) and table 1 (distance) from LENS.
dynamic:
        ldx #5
        jsr getbits
        lda vl
        clc
        adc #1
        sta hlitl
        ldx #5
        jsr getbits
        lda vl
        clc
        adc #1
        sta hdist
        ldx #4
        jsr getbits
        lda vl
        clc
        adc #4
        sta hclen
        ldy #18
        lda #0
dy0:    sta LENS,y
        dey
        bpl dy0
        ldy #0
dy1:    cpy hclen
        bcs dy2
        sty th
        ldx #3
        jsr getbits
        ldy th
        ldx clord,y
        lda vl
        sta LENS,x
        iny
        bne dy1
dy2:    lda #<LENS
        sta lp
        lda #>LENS
        sta lp+1
        lda #19
        sta nl
        lda #0
        sta nh
        ldx #2
        jsr build
        clc
        lda hlitl
        adc hdist
        sta totl
        lda #1
        adc #0
        sta toth
        lda #<LENS
        sta lq
        sta lend
        lda #>LENS
        sta lq+1
        clc
        lda totl
        adc lend
        sta lend
        lda toth
        adc lq+1
        sta lend+1
        lda #0
        sta prevv
dy3:    lda lq+1
        cmp lend+1
        bcc dy4
        bne dy9
        lda lq
        cmp lend
        bcs dy9
dy4:    ldx #2
        jsr decode
        lda vl
        cmp #16
        bcs dy5
        jsr putlen
        jmp dy3
dy5:    bne dy6
        ldx #2
        jsr getbits
        lda vl
        clc
        adc #3
        tax
        lda prevv
        jmp dyr
dy6:    cmp #17
        bne dy7
        ldx #3
        jsr getbits
        lda vl
        clc
        adc #3
        tax
        lda #0
        jmp dyr
dy7:    ldx #7
        jsr getbits
        lda vl
        clc
        adc #11
        tax
        lda #0
dyr:    sta th
dyl:    lda th
        jsr putlen
        dex
        bne dyl
        jmp dy3
dy9:    lda #<LENS
        sta lp
        lda #>LENS
        sta lp+1
        lda hlitl
        sta nl
        lda #1
        sta nh
        ldx #0
        jsr build
        clc
        lda #<LENS
        adc hlitl
        sta lp
        lda #>LENS
        adc #1
        sta lp+1
        lda hdist
        sta nl
        lda #0
        sta nh
        ldx #1
        jsr build
        jmp codes

; A = length value -> next LENS slot (X is kept)
; Also remembers it in prevv for code 16 (repeat previous length). Clobbers Y.
putlen: sta prevv
        ldy #0
        sta (lq),y
        inc lq
        bne pl_r
        inc lq+1
pl_r:   rts

; ---- codes: the LZ77 symbol loop of a Huffman block ----
; Decode a literal/length symbol (table 0): < 256 literal -> outb; 256 end of block; 257-285 length: base from
; lbl/lbh plus 'lext' extra bits. Then a distance symbol (table 1): base from dbl/dbh plus 'dext' extra bits.
; Distances above 14336 ($3800) cannot be served by the window -> WINDOW TOO SMALL. The match source sp = wp -
; distance, wrapped by +$3800 (the window size) when it falls below page WIN; bytes are copied one at a time
; through outb so overlapping matches (distance < length) work. Tables here are indexed by symbol-257 / symbol.
codes:  ldx #0
        jsr decode
        lda vh
        bne cd_s
        lda vl
        jsr outb
        jmp codes
cd_s:   lda vl          ; 256 = end of block
        jeq cd_end
        cmp #30         ; symbol-256 = 1..29 are valid lengths (257-285); 286/287 are invalid
        jcs ferr_data
        sec
        sbc #1
        sta lc
        tax
        lda lext,x
        tax
        jsr getbits
        ldx lc
        clc
        lda lbl,x
        adc vl
        sta lenl
        lda lbh,x
        adc vh
        sta lenh
        ldx #1
        jsr decode
        lda vl
        cmp #30
        jcs ferr_data
        sta dc
        tax
        lda dext,x
        tax
        jsr getbits
        ldx dc
        clc
        lda dbl,x
        adc vl
        sta dsl
        lda dbh,x
        adc vh
        sta dsh
        lda dsh         ; distance must be <= $3800 (window size); $3800 itself is allowed
        cmp #$38
        bcc cd_ok
        bne cd_w
        lda dsl
        beq cd_ok
cd_w:   jmp ferr_win
cd_ok:  sec
        lda wp
        sbc dsl
        sta sp
        lda wp+1
        sbc dsh
        sta sp+1
        cmp #WIN
        bcs cd_c
        clc
        adc #$38        ; wrap: add the window size ($38 pages)
        sta sp+1
cd_c:   ldy #0
        lda (sp),y
        jsr outb
        inc sp
        bne cd_n
        inc sp+1
        lda sp+1
        cmp #WINEND
        bne cd_n
        lda #WIN
        sta sp+1
cd_n:   lda lenl
        bne cd_k
        dec lenh
cd_k:   dec lenl
        lda lenl
        ora lenh
        bne cd_c
        jmp codes
cd_end: lda fin
        jeq blk
        rts

; stored block: discard the partial byte (bn=0), read LEN (lenl/lenh), skip NLEN (2 bytes, not verified),
; then copy LEN bytes through outb.
stored: lda #0
        sta bn
        jsr getbyt
        sta lenl
        jsr getbyt
        sta lenh
        jsr getbyt
        jsr getbyt
st_l:   lda lenl
        ora lenh
        beq st_d
        jsr getbyt
        jsr outb
        lda lenl
        bne st_k
        dec lenh
st_k:   dec lenl
        jmp st_l
st_d:   lda fin
        jeq blk
        rts

; Deflate tables. clord = order in which code-length code lengths are stored. lbl/lbh = base length for
; symbols 257-285 (low/high; 258 = $102), lext = extra bits (0 for 285). dbl/dbh = base distance for codes
; 0-29, dext = extra bits (0-13). Distance codes 30 and 31 are rejected in 'codes'.
clord:  .byte 16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15
lbl:    .byte 3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,2
lbh:    .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1
lext:   .byte 0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0
dbl:    .byte 1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,1,129,1,1,1,1,1,1,1,1,1,1,1,1
dbh:    .byte 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,2,3,4,6,8,12,16,24,32,48,64,96
dext:   .byte 0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13

; ---- archive walk ----
; read the next local header into HDR; carry set at the end of the entries
; (EOF, short header or signature other than 'PK',3,4 -- e.g. the central directory). Clobbers A,Y,tl.
rdlh:   ldy #0
rl_l:   sty tl
        jsr getbyte
        bcs rl_e
        ldy tl
        sta HDR,y
        iny
        cpy #30
        bcc rl_l
        lda HDR
        cmp #'P'
        bne rl_e
        lda HDR+1
        cmp #'K'
        bne rl_e
        lda HDR+2
        cmp #3
        bne rl_e
        lda HDR+3
        cmp #4
        bne rl_e
        clc
        rts
rl_e:   sec
        rts

; members: per entry - read header, read the name (HDR+26 bytes, only the first 120 kept in NAMEF), skip the
; extra field (HDR+28 bytes), make the 8.3 name, de-duplicate it (lib\uniq.asm) and hand the entry to domember.
; Folder entries (empty NAMEB) are passed over without touching their data. nfl/nfh counts files processed.
members:
mem:    jsr rdlh
        jcs mem_d
        lda HDR+26
        sta kl
        lda HDR+27
        sta kh
        ldy #0
        sty nf
rn_l:   lda kl
        ora kh
        beq rn_d
        jsr getbyt
        ldy nf
        cpy #120
        bcs rn_s
        sta NAMEF,y
        inc nf
rn_s:   lda kl
        bne rn_k
        dec kh
rn_k:   dec kl
        jmp rn_l
rn_d:   lda HDR+28
        sta s0
        lda HDR+29
        sta s1
        lda #0
        sta s2
        sta s3
        jsr skip32
        jsr conv83
        jsr uniq
        lda NAMEB
        jeq mem
        jsr domember
        inc nfl
        bne mem
        inc nfh
        jmp mem
mem_d:  rts

; NAMEF (nf chars) -> 8.3 name in NAMEB; NAMEB[0]=0 for a folder entry
; Pass 1 finds st = index after the last '/' or '\' and ld = index after the last '.' in that part (0 if none).
; Then up to 8 name chars (stem = st..be) and up to 3 extension chars are copied through fixc. A name ending
; in '/' leaves an empty stem, so NAMEB stays empty. Clobbers A,X,Y,st,ld,be,ec.
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
cv2:     lda nf
        sta be
        lda ld
        beq cv3
        sec
        sbc #1
        sta be
cv3:     ldx #0
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

; process or skip the member whose header is in HDR
; want=1 only when mode is X/T, the name matches the filter and the encrypted flag (bit 0) is clear.
; Unwanted entries are skipped by reading HDR+18 (packed size) bytes; if bit 3 is set the size is unknown, so a
; deflate entry is decoded with wr=0 to find its end (other methods cannot be skipped -> abort).
; Wanted entries: in X mode the output file DEST+NAMEB is opened on IOCB 3; then procdata, flush, CRC check
; against HDR+14 (OK / CRC ERROR). An unsupported method is reported and its packed data skipped.
domember:
        lda #0
        sta want
        lda mode
        beq dm_s
        jsr matchq
        bcs dm_s
        lda HDR+6
        and #1
        bne dm_s
        lda #1
        sta want
dm_s:   lda want
        jne dm_full
        ; not wanted: skip the packed bytes (a deflate stream with a data descriptor has to be run through)
        lda HDR+6
        and #8
        beq dm_k
        lda HDR+8
        cmp #8
        bne dm_u
        lda #0
        sta wr
        jsr procdata
        jmp dm_l
dm_k:   ldx #3
dm_c:   lda HDR+18,x
        sta s0,x
        dex
        bpl dm_c
        jsr skip32
dm_l:   lda mode
        bne dm_r
        jsr listline
dm_r:   rts
dm_u:   jsr putsi
        .byte 'CANNOT SKIP ',0
        jsr putname
        jsr putsi
        .byte ' (UNSUPPORTED)',EOL,0
        jmp abort
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
dm_nu:  jsr putsi
        .byte 'UNSUPPORTED METHOD',EOL,0
        lda HDR+6
        and #8
        jne abort
        ldx #3
dm_c2:  lda HDR+18,x
        sta s0,x
        dex
        bpl dm_c2
        jmp skip32
dm_chk: lda wr
        beq dm_v
        lda opos
        beq dm_fc
        ldx #0
        jsr wrout
dm_fc:  ldx #$30
        jsr fclose
dm_v:   lda c0          ; stored CRC is the complement of the running value
        eor #$FF
        cmp HDR+14
        bne dm_bad
        lda c1
        eor #$FF
        cmp HDR+15
        bne dm_bad
        lda c2
        eor #$FF
        cmp HDR+16
        bne dm_bad
        lda c3
        eor #$FF
        cmp HDR+17
        bne dm_bad
        jsr putsi
        .byte 'OK',EOL,0
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

; ---- run the member's data through the decoder; carry set when the method is not supported ----
; Method 0 (stored): copy the unpacked size (HDR+22) bytes through outb; refused with carry set when a data
; descriptor is used (the size is unknown). Method 8: inflate, then if flag bit 3 is set read the data
; descriptor ([ 'PK',7,8 ] CRC32, packed size, unpacked size) into HDR+14/18/22 so the CRC check and listing
; see the real values. Initialises the CRC to $FFFFFFFF, the window pointer to WIN, bn and opos to 0.
procdata:
        lda #$FF
        sta c0
        sta c1
        sta c2
        sta c3
        lda #0
        sta bn
        sta opos
        sta wp
        lda #WIN
        sta wp+1
        lda HDR+8
        beq pd0
        cmp #8
        beq pd8
        sec
        rts
pd0:    lda HDR+6
        and #8
        beq pd0a
        sec
        rts
pd0a:   ldx #3
pd0b:   lda HDR+22,x
        sta s0,x
        dex
        bpl pd0b
pd0c:   lda s0
        ora s1
        ora s2
        ora s3
        beq pd0d
        jsr getbyt
        jsr outb
        lda s0
        bne pd0e
        lda s1
        bne pd0f
        lda s2
        bne pd0g
        dec s3
pd0g:   dec s2
pd0f:   dec s1
pd0e:   dec s0
        jmp pd0c
pd0d:   clc
        rts
pd8:    jsr inflate
        lda HDR+6
        and #8
        beq pd8d
        ldx #0
pd8a:   jsr getbyt
        sta DB,x
        inx
        cpx #4
        bcc pd8a
        lda DB
        cmp #'P'
        bne pd8s
        lda DB+1
        cmp #'K'
        bne pd8s
        lda DB+2
        cmp #7
        bne pd8s
        lda DB+3
        cmp #8
        bne pd8s
        ldx #0
pd8b:   jsr getbyt
        sta DB,x
        inx
        cpx #4
        bcc pd8b
pd8s:   ldx #0
pd8c:   jsr getbyt
        sta DB+4,x
        inx
        cpx #8
        bcc pd8c
        ldx #3
pd8e:   lda DB,x
        sta HDR+14,x
        lda DB+4,x
        sta HDR+18,x
        lda DB+8,x
        sta HDR+22,x
        dex
        bpl pd8e
pd8d:   clc
        rts

; ---- listing ----
; A = ZIP method number -> 4-character name via mnum/mtxt (unknown methods print '????'). Clobbers A,X,Y.
mname:  ldx #0
mn_l:   cmp mnum,x
        beq mn_f
        inx
        cpx #8
        bcc mn_l
        ldx #8
mn_f:   txa
        asl
        asl
        tax
        ldy #4
mn_p:   lda mtxt,x
        jsr putc
        inx
        dey
        bne mn_p
        rts
mnum:   .byte 0,1,2,6,8,9,12,14
mtxt:   .byte 'STORSHRKREDUIMPLDEFLDF64BZ2 LZMA????'

; one listing line: name padded to 12, unpacked size, packed size (8 digits each minus the first), method,
; then the date. DOS date word at HDR+12: day = bits 0-4, month = bits 5-8 (the high bit comes from HDR+13 bit 0).
; Year and time are not printed. Output is MM-DD.
listline:
        ldy #0
ll_n:   lda NAMEB,y
        beq ll_p
        jsr putc
        iny
        cpy #13
        bcc ll_n
ll_p:   sty tl
        lda #12
        sec
        sbc tl
        tay
        jsr putsp
        ldx #3
ll_a:   lda HDR+22,x
        sta dv,x
        dex
        bpl ll_a
        jsr dec32
        jsr putdig
        ldx #3
ll_c:   lda HDR+18,x
        sta dv,x
        dex
        bpl ll_c
        jsr dec32
        jsr putdig
        lda #' '
        jsr putc
        lda HDR+8
        jsr mname
        lda #' '
        jsr putc
        lda HDR+12
        lsr
        lsr
        lsr
        lsr
        lsr
        sta tl
        lda HDR+13
        and #1
        asl
        asl
        asl
        ora tl
        jsr put2d
        lda #'-'
        jsr putc
        lda HDR+12
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
        run start
