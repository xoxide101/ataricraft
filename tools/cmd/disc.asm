; disc.asm - DISC.COM, a read-only reader for the raw drives D9: and D10: (ataricraft's virtual SIO disks).
; File systems: ISO 9660 (2048 byte sectors) and FAT12/16/32 (512 byte sectors, MBR partitions, 8.3 names).
; Sectors come straight from SIO (device $39/$3A, $52 read, $48 high sector word, $53 status; see web/js/rawdisk.js).
; At the DISC> prompt:  D [D9:][path] list | T [D9:]path show | X [D9:]path [dest] copy to a DOS file | I [D9:] info
; Paths use / > or \ between names. A blank line exits.
;
; Notes (appears to match the code below):
;  - UDF (fst=3) is also supported, in addition to the ISO 9660 / FAT mentioned above. Q quits too; L = D.
;  - Everything is read-only: only SIO commands $52 (read), $48 (set high sector word) and $53 (status) are used.
;  - The prompt loop saves the stack pointer in psp; 'abort' restores it, so any error deep inside a call chain
;    just prints a message and returns to the DISC> prompt.
;
; Structure:
;   start/prompt   command loop: parse command letter (mode 0=D/L, 1=T, 2=X, 3=I), path, optional destination
;   getpath/cpt    copy command tokens into PATHB / DEST (D9:/D10: prefix selects unitn)
;   sioset/rdsec   SIO setup and a cached sector read: lba (32 bit) -> SBUF, FBUF or UBUF (see bsel)
;   mount          status ($53) -> sector size decides the file system: 2048 = UDF then ISO 9660, 512 = FAT
;   FAT            gfb/fatnext read the FAT (12/16/32 bit entries) through the FBUF sector cache
;   streams        sopen sets up a byte stream for an extent or cluster chain, snext delivers the next sector
;                  in SBUF (sn = number of valid bytes); sm = 0 contiguous, 1 FAT chain, 2 UDF extents,
;                  3 UDF embedded data
;   directories    dopen/dnext iterate entries -> NAMEB (NUL ended 8.3 / ISO / UDF name), e_dir, e_start, e_size
;   walk           resolve PATHB component by component starting at setroot
;   commands       doinfo, dolist, dotype, doext
;
; Memory map (all above the program, which starts at CODE):
;   $6400 SBUF  data sector (2048)     $6C00 FBUF  FAT sector (512)      $6E00 PATHB   $6E40 DEST
;   $6E90 LABEL volume label           $6F00 VARS  byte variables, then 32 bit values at R = VARS+$40
;   $7800 UBUF  UDF file entry sector  $8000 ADBUF UDF allocation descriptors   $8100 FIDB  $8140 FNB
;   $8240 CMPN  upper cased path component being matched
; 32 bit values are little endian 4 byte fields handled by the MOV4/ADD4/SUB4/... macros defined below.
; Key variables: lba = sector to read, sbtag/fbtag/utag = sector currently cached in SBUF/FBUF/UBUF (valid when
; sbv/fbv/ubv = 1), base = partition start (FAT) or UDF partition start, fatlba/rootlba/datalba = FAT geometry,
; e_start/e_size/e_dir = current directory entry, s_* = stream state, fst = file system type, kind = FAT bits.
        icl 'lib\sys.asm'

SBUF     = $6400         ; data sector (up to 2048 bytes)
FBUF    = $6C00         ; FAT sector (512 bytes)
PATHB   = $6E00         ; 64  path being resolved
DEST    = $6E40         ; 64  extract destination
LABEL   = $6E90         ; 34  volume label
VARS    = $6F00
UBUF    = $7800         ; 2048 UDF file entry sector
ADBUF   = $8000         ; 256  allocation descriptors of the open UDF file
FIDB    = $8100         ; 40   UDF file identifier descriptor header
FNB     = $8140         ; 256  raw UDF name / label bytes
CMPN    = $8240         ; 48   path component, upper case

unitn   = VARS          ; 9 or 10
ssl     = VARS+1        ; sector size
ssh     = VARS+2
fst     = VARS+3        ; 0 none, 1 ISO 9660, 2 FAT
kind    = VARS+4        ; 12, 16 or 32
spc     = VARS+5
spcsh   = VARS+6
bsel    = VARS+7
sbv     = VARS+8        ; 1 when SBUF / FBUF hold the sector in sbtag / fbtag
fbv     = VARS+9
nfat    = VARS+10
e_dir   = VARS+11
sm      = VARS+12       ; stream: 0 contiguous, 1 FAT chain
s_lim   = VARS+13       ; 1 when the stream ends after s_rem bytes
s_si    = VARS+14       ; sector inside the current cluster
dend    = VARS+15
psp     = VARS+16
mode    = VARS+17
pi      = VARS+18
lns     = VARS+19
nfl     = VARS+20
nfh     = VARS+21
tl      = VARS+22
par     = VARS+23
lines   = VARS+24
ctr     = VARS+25
sn      = VARS+26       ; 2 bytes valid in SBUF after snext
dpos    = VARS+28       ; 2 bytes position inside SBUF while reading a directory
rsv     = VARS+30
rootsecs = VARS+32
ent     = VARS+34
tcl     = VARS+36
tch     = VARS+37
kl      = VARS+38
kh      = VARS+39
aic     = VARS+54
ubv     = VARS+40       ; 1 when UBUF holds the sector in utag
adl     = VARS+41       ; bytes of allocation descriptors in ADBUF
adp     = VARS+42       ; next descriptor
ads     = VARS+43       ; descriptor size, 8 (short) or 16 (long)
emd     = VARS+44       ; embedded data already delivered
uc      = VARS+45       ; dstring compression id
ugot    = VARS+46       ; bit 0 partition found, bit 1 volume descriptor found
chr     = VARS+47       ; FID characteristics
fil     = VARS+48       ; FID L_FI
pad     = VARS+49
eoff    = VARS+50       ; 2 bytes offset of the descriptors / embedded data inside UBUF
elen    = VARS+52       ; 2 bytes L_AD

R       = VARS+$40
lba     = R
sbtag   = R+4
fbtag   = R+8
base    = R+12
fatlba  = R+16
datalba = R+20
rootlba = R+24
rootclus = R+28
eoc     = R+32
e_start = R+36
e_size  = R+40
s_lba   = R+44
s_cnt   = R+48
s_cl    = R+52
s_rem   = R+56
fo      = R+60
tmp4    = R+64
tot     = R+68
spf     = R+72
dv      = R+76
tv      = R+80
secs    = R+84
rootlen = R+88
dig     = R+92          ; 8
stb     = R+100         ; 8
utag    = R+108

        .macro MOV4 d,s
        lda :2
        sta :1
        lda :2+1
        sta :1+1
        lda :2+2
        sta :1+2
        lda :2+3
        sta :1+3
        .endm

        .macro CLR4 d
        lda #0
        sta :1
        sta :1+1
        sta :1+2
        sta :1+3
        .endm

        .macro ZER4 d
        lda :1
        ora :1+1
        ora :1+2
        ora :1+3
        .endm

        .macro ADD4 d,s
        clc
        lda :1
        adc :2
        sta :1
        lda :1+1
        adc :2+1
        sta :1+1
        lda :1+2
        adc :2+2
        sta :1+2
        lda :1+3
        adc :2+3
        sta :1+3
        .endm

        .macro SUB4 d,s
        sec
        lda :1
        sbc :2
        sta :1
        lda :1+1
        sbc :2+1
        sta :1+1
        lda :1+2
        sbc :2+2
        sta :1+2
        lda :1+3
        sbc :2+3
        sta :1+3
        .endm

        .macro INC4 d
        clc
        lda :1
        adc #1
        sta :1
        lda :1+1
        adc #0
        sta :1+1
        lda :1+2
        adc #0
        sta :1+2
        lda :1+3
        adc #0
        sta :1+3
        .endm

        .macro DEC4 d
        sec
        lda :1
        sbc #1
        sta :1
        lda :1+1
        sbc #0
        sta :1+1
        lda :1+2
        sbc #0
        sta :1+2
        lda :1+3
        sbc #0
        sta :1+3
        .endm

        .macro SHL4 d
        asl :1
        rol :1+1
        rol :1+2
        rol :1+3
        .endm

        .macro SHR4 d
        lsr :1+3
        ror :1+2
        ror :1+1
        ror :1
        .endm

; carry set when a >= b (unsigned)
        .macro CMP4 a,b
        lda :1
        cmp :2
        lda :1+1
        sbc :2+1
        lda :1+2
        sbc :2+2
        lda :1+3
        sbc :2+3
        .endm

        .macro NE4 a,b,l
        lda :1
        cmp :2
        bne :3
        lda :1+1
        cmp :2+1
        bne :3
        lda :1+2
        cmp :2+2
        bne :3
        lda :1+3
        cmp :2+3
        bne :3
        .endm

; 4 byte (32 bit) helper macros above: d/s/a/b are the first argument = destination/first operand, second = source.
; They expand inline, clobber A (and carry) only, and operate on little endian 4 byte fields.

        org CODE
        icl 'lib\io.asm'
        icl 'lib\hand.asm'

; ---- main command loop ----
; Default drive is D9:. 'prompt' records the stack pointer in psp so 'abort' can unwind any nested call.
; Command letters: D/L -> mode 0, T -> 1, X -> 2, I -> 3 (mode is the X register value built by the INX chain).
start:  lda #9
        sta unitn
        jsr putsi
        .byte 'DISC 0.1  READ-ONLY D9:/D10: (ISO 9660, UDF, FAT)',EOL
        .byte 'D [PATH] | T PATH | X PATH [DEST] | I',EOL
        .byte 'PREFIX D9: OR D10: PICKS THE DRIVE',EOL
        .byte 'Q QUITS',EOL,0
prompt: tsx
        stx psp
        jsr putnl
        jsr putsi
        .byte 'DISC>',0
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
        cmp #'D'
        beq pm
        cmp #'L'
        beq pm
        inx
        cmp #'T'
        beq pm
        inx
        cmp #'X'
        beq pm
        inx
        cmp #'I'
        beq pm
        jsr putsi
        .byte 'USE D, T, X OR I',EOL,0
        jmp prompt
; PATHB and DEST start out empty (EOL only); the optional 1st argument is the path, for X the 2nd is the destination.
; After mounting and walking the path the command dispatches to dolist / dotype / doext (info needs no walk).
pm:     stx mode
        lda #EOL
        sta PATHB
        sta DEST
        jsr nexttok
        beq pm_nop
        jsr getpath
pm_nop: lda mode
        cmp #2
        bne pm_go
        jsr nexttok
        beq pm_go
        lda #<DEST
        sta T1
        lda #>DEST
        sta T1+1
        ldy #0
        jsr cpt
pm_go:  jsr mount
        jcs prompt
        lda mode
        cmp #3
        jeq doinfo
        jsr walk
        bcc pm_f
        jsr putsi
        .byte 'NOT FOUND',EOL,0
        jmp prompt
pm_f:   lda mode
        jeq dolist
        cmp #1
        jeq dotype
        jmp doext

; leave to DOS (closes the IOCB $30 used by X, in case it is still open)
bye:    ldx #$30
        jsr fclose
        jmp (DOSVEC)

; error exit: close the extract file, restore the stack saved at the prompt and go back to DISC>
abort:  ldx #$30
        jsr fclose
        ldx psp
        txs
        jmp prompt

; TOK -> PATHB; a D9: / D10: prefix selects the drive
; The prefix test is done character by character: X = number of prefix characters to skip (3 for D9:, 4 for D10:).
; Out: PATHB = rest of the token, EOL ended; unitn updated when a prefix was given.
getpath:
        ldx #0
        lda TOK
        jsr toupper
        cmp #'D'
        bne gp_c
        lda TOK+1
        cmp #'9'
        bne gp_t
        lda TOK+2
        cmp #':'
        bne gp_c
        lda #9
        sta unitn
        ldx #3
        bne gp_c
gp_t:   cmp #'1'
        bne gp_c
        lda TOK+2
        cmp #'0'
        bne gp_c
        lda TOK+3
        cmp #':'
        bne gp_c
        lda #10
        sta unitn
        ldx #4
gp_c:   ldy #0
gp_l:   lda TOK,x
        beq gp_d
        sta PATHB,y
        inx
        iny
        bne gp_l
gp_d:   lda #EOL
        sta PATHB,y
        rts

; copy TOK (upper cased) to (T1)+Y and end it with EOL; Y = start index, X walks TOK
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

; ---- SIO ----
; Fill the SIO device control block: A = command, X = DSTATS ($40 = data goes to the computer, 0 = no data).
; DDEVIC is always $31 (disk bus id) and DUNIT = unitn (9 or 10); the caller sets the buffer, length and AUX bytes.
; Timeout 15 (about 16 s).
sioset: sta DCOMND
        stx DSTATS
        lda #$31
        sta DDEVIC
        lda unitn
        sta DUNIT
        lda #15
        sta DTIMLO
        rts

; read sector lba into SBUF (A = 0), FBUF (A = 1) or UBUF (any other A, used for UDF file entries)
; Each buffer remembers which sector it holds (sbtag/fbtag/utag + valid flag sbv/fbv/ubv); a request for the cached
; sector returns at once. Out: carry clear. Any SIO error prints DISK READ ERROR and jumps to abort.
; Sectors above 65535 first send command $48 with the high word in AUX1/AUX2, then the normal $52 read follows with
; the low word. Transfer length: SBUF = sector size (ssl/ssh), FBUF = 512, UBUF = 2048.
rdsec:  sta bsel
        bne rs_n0
        lda sbv
        jeq rs_go
        NE4 lba,sbtag,rs_go
        clc
        rts
rs_n0:  cmp #1
        bne rs_u
        lda fbv
        jeq rs_go
        NE4 lba,fbtag,rs_go
        clc
        rts
rs_u:   lda ubv
        jeq rs_go
        NE4 lba,utag,rs_go
        clc
        rts
rs_go:  lda lba+2
        ora lba+3
        beq rs_r
        lda #$48
        ldx #0
        jsr sioset
        lda #0
        sta DBYTLO
        sta DBYTHI
        sta DBUFLO
        sta DBUFHI
        lda lba+2
        sta DAUX1
        lda lba+3
        sta DAUX2
        jsr SIOV
        jmi rs_e
rs_r:   lda #$52
        ldx #$40
        jsr sioset
        lda bsel
        bne rs_b
        lda #<SBUF
        sta DBUFLO
        lda #>SBUF
        sta DBUFHI
        lda ssl
        sta DBYTLO
        lda ssh
        sta DBYTHI
        jmp rs_x
rs_b:   cmp #1
        bne rs_ub
        lda #<FBUF
        sta DBUFLO
        lda #>FBUF
        sta DBUFHI
        lda #0
        sta DBYTLO
        lda #2
        sta DBYTHI
        jmp rs_x
rs_ub:  lda #<UBUF
        sta DBUFLO
        lda #>UBUF
        sta DBUFHI
        lda #0
        sta DBYTLO
        lda #8
        sta DBYTHI
rs_x:   lda lba
        sta DAUX1
        lda lba+1
        sta DAUX2
        jsr SIOV
        jmi rs_e
        lda bsel
        bne rs_t
        MOV4 sbtag,lba
        lda #1
        sta sbv
        clc
        rts
rs_t:   cmp #1
        bne rs_tu
        MOV4 fbtag,lba
        lda #1
        sta fbv
        clc
        rts
rs_tu:  MOV4 utag,lba
        lda #1
        sta ubv
        clc
        rts
rs_e:   lda #0
        sta sbv
        sta fbv
        sta ubv
        jsr putsi
        .byte EOL,'DISK READ ERROR',EOL,0
        jmp abort

; ---- mount: find out what is in the drive ----
; Out: carry clear and fst = 1 (ISO 9660), 2 (FAT) or 3 (UDF) on success; carry set after printing a message.
; Uses the SIO status command $53: 8 bytes in stb -- appears to be total sectors (4 bytes -> secs), sector size
; (stb+4/5 -> ssl/ssh) and flags (bit 0 of stb+6 = image present). A 2048 byte sector size means optical (UDF, else
; ISO 9660); 512 means FAT. Anything else is reported as an unknown file system.
mount:  lda #0
        sta fst
        sta sbv
        sta fbv
        sta ubv
        lda #$53
        ldx #$40
        jsr sioset
        lda #<stb
        sta DBUFLO
        lda #>stb
        sta DBUFHI
        lda #8
        sta DBYTLO
        lda #0
        sta DBYTHI
        sta DAUX1
        sta DAUX2
        jsr SIOV
        bmi mt_nd
        lda stb+6
        and #1
        beq mt_nd
        lda stb+4
        sta ssl
        lda stb+5
        sta ssh
        MOV4 secs,stb
        lda ssh
        cmp #8
        jeq mt_ui
        cmp #2
        jeq mt_fat
mt_unk: jsr putsi
        .byte 'UNKNOWN FILE SYSTEM (ISO 9660, UDF AND FAT ONLY)',EOL,0
        sec
        rts
mt_nd:  jsr putsi
        .byte 'NO IMAGE IN THAT DRIVE (LOAD ONE FROM THE D9/D10 DEVICE BAR)',EOL,0
        sec
        rts

; 2048 byte sectors: try UDF first, fall back to ISO 9660 when mt_udf says no
mt_ui:  jsr mt_udf
        jcs mt_iso
        clc
        rts

; UDF (2048 byte sectors, one plain partition, short / long / embedded descriptors). Carry set when the drive is not UDF.
; Appears to follow the standard layout: the anchor volume descriptor pointer at sector 256 (tag id 2) gives the main
; volume descriptor sequence (location at +20, length at +16..19, capped at 16 sectors). Walking it: tag 5 =
; partition descriptor (start sector at +188 -> base), tag 6 = logical volume descriptor (file set location at +252
; -> rootlba, volume label from +84), tag 8 = terminator. Both 5 and 6 must be seen (bits of ugot). Then the file set
; descriptor (tag 256) at base+rootlba is read; its root directory ICB (+404) replaces rootlba.
mt_udf: lda secs+2
        ora secs+3
        bne mu_ok
        lda secs+1
        cmp #2
        bcs mu_ok
        cmp #1
        jne mu_no
        lda secs
        cmp #5
        jcc mu_no
; (the checks above require at least $0105 sectors, so that sector 256 exists)
; Read the anchor at sector 256 ($0100): lba+1 = 1.
mu_ok:  CLR4 lba
        lda #1
        sta lba+1
        lda #0
        jsr rdsec
        lda SBUF
        cmp #2
        jne mu_no
        lda SBUF+1
        jne mu_no
        MOV4 lba,SBUF+20        ; main VDS location
        lda SBUF+17
        lsr
        lsr
        lsr
        clc
        adc #1                  ; (length >> 11) + 1 sectors, at most 16
        cmp #17
        bcc mu_c
        lda #16
mu_c:   sta ctr
        lda #0
        sta ugot
mu_v:   lda #0
        jsr rdsec
        lda SBUF+1
        bne mu_nx
        lda SBUF
        cmp #8
        jeq mu_dn
        cmp #5
        bne mu_6
        ldx #3
mu_pb:  lda SBUF+188,x
        sta base,x
        dex
        bpl mu_pb
        lda ugot
        ora #1
        sta ugot
        bne mu_nx
mu_6:   cmp #6
        bne mu_nx
        lda SBUF+440
        cmp #1
        jne mu_no
        ldx #3
mu_fb:  lda SBUF+252,x
        sta rootlba,x
        dex
        bpl mu_fb
        ldx #0
mu_lc:  lda SBUF+84,x
        sta FNB,x
        inx
        cpx #33
        bcc mu_lc
        lda SBUF+211
        cmp #33
        bcc mu_ll
        lda #33
mu_ll:  sta tl
        lda #<LABEL
        sta T1
        lda #>LABEL
        sta T1+1
        jsr ustr
        lda ugot
        ora #2
        sta ugot
mu_nx:  INC4 lba
        dec ctr
        jne mu_v
mu_dn:  lda ugot
        cmp #3
        jne mu_no
        ADD4 rootlba,base
        MOV4 lba,rootlba
        lda #0
        jsr rdsec
        lda SBUF
        jne mu_no
        lda SBUF+1
        cmp #1
        jne mu_no
        ldx #3
mu_rr:  lda SBUF+404,x
        sta rootlba,x
        dex
        bpl mu_rr
        lda #3
        sta fst
        clc
        rts
mu_no:  lda #0
        sta sbv
        sec
        rts

; ISO 9660: primary volume descriptor at sector 16 (type 1, "CD001"); root directory record at +156 gives the
; extent (+158) and size (+166); the volume label is the 32 bytes at +40.
mt_iso: CLR4 lba
        lda #16
        sta lba
        lda #0
        jsr rdsec
        lda SBUF
        cmp #1
        jne mt_unk
        ldx #4
mt_ic:  lda SBUF+1,x
        cmp cdid,x
        jne mt_unk
        dex
        bpl mt_ic
        ldx #3
mt_ir:  lda SBUF+158,x
        sta rootlba,x
        lda SBUF+166,x
        sta rootlen,x
        dex
        bpl mt_ir
        lda #<(SBUF+40)
        sta T0
        lda #>(SBUF+40)
        sta T0+1
        ldy #32
        jsr getlab
        lda #1
        sta fst
        clc
        rts
cdid:   .byte 'CD001'

; copy Y bytes at (T0) to LABEL, NUL ended, trailing spaces removed (and NUL padding)
getlab: sty tl
        ldy #0
gl_c:   lda (T0),y
        sta LABEL,y
        iny
        cpy tl
        bcc gl_c
        lda #0
        sta LABEL,y
gl_t:   dey
        bmi gl_d
        lda LABEL,y
        beq gl_t
        cmp #' '
        bne gl_d
        lda #0
        sta LABEL,y
        beq gl_t
gl_d:   rts

; carry clear when SBUF holds a FAT boot sector (512 byte sectors)
; Checks: $55AA signature, jump opcode $EB/$E9, bytes per sector = 512, sectors per cluster a power of two,
; and 1 or 2 FATs.
bpbok:  lda SBUF+510
        cmp #$55
        bne bb_n
        lda SBUF+511
        cmp #$AA
        bne bb_n
        lda SBUF
        cmp #$EB
        beq bb_j
        cmp #$E9
        bne bb_n
bb_j:   lda SBUF+11
        bne bb_n
        lda SBUF+12
        cmp #2
        bne bb_n
        lda SBUF+13
        beq bb_n
        sta tl
        sec
        sbc #1
        and tl
        bne bb_n
        lda SBUF+16
        beq bb_n
        cmp #3
        bcs bb_n
        clc
        rts
bb_n:   sec
        rts

; FAT: sector 0 is tried as a boot sector (superfloppy); otherwise the four MBR partition entries (16 bytes each at
; +446) are scanned for a FAT type (ptypes) and that partition's first sector (entry +8) becomes base.
mt_fat: CLR4 lba
        CLR4 base
        lda #0
        jsr rdsec
        jsr bpbok
        jcc mt_f2
        lda #0
        sta ctr
mt_pl:  CLR4 lba
        lda #0
        jsr rdsec
        lda SBUF+510
        cmp #$55
        jne mt_unk
        lda SBUF+511
        cmp #$AA
        jne mt_unk
        lda ctr
        asl
        asl
        asl
        asl
        clc
        adc #<(SBUF+446)
        sta T0
        lda #>(SBUF+446)
        adc #0
        sta T0+1
        ldy #4
        lda (T0),y
        ldx #5
mt_pt:  cmp ptypes,x
        beq mt_pf
        dex
        bpl mt_pt
        bmi mt_pn
mt_pf:  ldy #8
        ldx #0
mt_pc:  lda (T0),y
        sta lba,x
        iny
        inx
        cpx #4
        bcc mt_pc
        MOV4 base,lba
        lda #0
        jsr rdsec
        jsr bpbok
        bcc mt_f2
mt_pn:  inc ctr
        lda ctr
        cmp #4
        jne mt_pl
        jmp mt_unk
ptypes: .byte 1,4,6,$0B,$0C,$0E

; Parse the BIOS parameter block in SBUF: sectors/cluster (spc, spcsh = log2), reserved sectors (rsv), FAT count,
; root entries (ent), total sectors (16 bit at +19 else 32 bit at +32), sectors per FAT (+22 else +36, FAT32),
; root cluster (+44, FAT32). Then lay out: fatlba = base+rsv, rootlba = fatlba + nfat*spf, datalba = rootlba +
; rootsecs ((ent*32+511)/512 -- computed as (ent+15)>>4). The FAT type is chosen by the cluster count (dv) as the
; Microsoft spec says: < 4085 FAT12, < 65525 FAT16, else FAT32. eoc = first end-of-chain value for that type.
; A volume label of "NO " (as in "NO NAME") is cleared.
mt_f2:  lda SBUF+13
        sta spc
        ldx #0
mt_sh:  lsr
        bcs mt_sd
        inx
        jmp mt_sh
mt_sd:  stx spcsh
        lda SBUF+14
        sta rsv
        lda SBUF+15
        sta rsv+1
        lda SBUF+16
        sta nfat
        lda SBUF+17
        sta ent
        lda SBUF+18
        sta ent+1
        CLR4 tot
        lda SBUF+19
        ora SBUF+20
        beq mt_t32
        lda SBUF+19
        sta tot
        lda SBUF+20
        sta tot+1
        jmp mt_tf
mt_t32: ldx #3
mt_t3:  lda SBUF+32,x
        sta tot,x
        dex
        bpl mt_t3
mt_tf:  CLR4 spf
        lda SBUF+22
        ora SBUF+23
        beq mt_s32
        lda SBUF+22
        sta spf
        lda SBUF+23
        sta spf+1
        jmp mt_sf
mt_s32: ldx #3
mt_s3:  lda SBUF+36,x
        sta spf,x
        dex
        bpl mt_s3
mt_sf:  ldx #3
mt_rc:  lda SBUF+44,x
        sta rootclus,x
        dex
        bpl mt_rc
        lda ent
        clc
        adc #15
        sta rootsecs
        lda ent+1
        adc #0
        sta rootsecs+1
        ldx #4
mt_rs:  lsr rootsecs+1
        ror rootsecs
        dex
        bne mt_rs
        MOV4 fatlba,base
        clc
        lda fatlba
        adc rsv
        sta fatlba
        lda fatlba+1
        adc rsv+1
        sta fatlba+1
        lda fatlba+2
        adc #0
        sta fatlba+2
        lda fatlba+3
        adc #0
        sta fatlba+3
        MOV4 rootlba,fatlba
        ADD4 rootlba,spf
        lda nfat
        cmp #2
        bne mt_dl
        ADD4 rootlba,spf
mt_dl:  MOV4 datalba,rootlba
        clc
        lda datalba
        adc rootsecs
        sta datalba
        lda datalba+1
        adc rootsecs+1
        sta datalba+1
        lda datalba+2
        adc #0
        sta datalba+2
        lda datalba+3
        adc #0
        sta datalba+3
        MOV4 tmp4,datalba
        SUB4 tmp4,base
        MOV4 dv,tot
        SUB4 dv,tmp4
        ldx spcsh
        beq mt_kd
mt_ks:  SHR4 dv
        dex
        bne mt_ks
mt_kd:  CMP4 dv,k4085
        bcs mt_k16
        lda #12
        sta kind
        lda #<$0FF8
        sta eoc
        lda #>$0FF8
        sta eoc+1
        lda #0
        sta eoc+2
        sta eoc+3
        beq mt_lb
mt_k16: CMP4 dv,k65525
        bcs mt_k32
        lda #16
        sta kind
        lda #$F8
        sta eoc
        lda #$FF
        sta eoc+1
        lda #0
        sta eoc+2
        sta eoc+3
        beq mt_lb
mt_k32: lda #32
        sta kind
        lda #$F8
        sta eoc
        lda #$FF
        sta eoc+1
        sta eoc+2
        lda #$0F
        sta eoc+3
mt_lb:  lda kind
        cmp #32
        beq mt_l32
        lda #<(SBUF+43)
        bne mt_lg
mt_l32: lda #<(SBUF+71)
mt_lg:  sta T0
        lda #>(SBUF+43)
        sta T0+1
        ldy #11
        jsr getlab
        lda LABEL
        cmp #'N'
        bne mt_fd
        lda LABEL+1
        cmp #'O'
        bne mt_fd
        lda LABEL+2
        cmp #' '
        bne mt_fd
        lda #0
        sta LABEL
mt_fd:  lda #2
        sta fst
        clc
        rts
k4085:  .dword 4085
k65525: .dword 65525

; ---- FAT ----
; byte of the FAT at byte offset fo (32 bit): reads FAT sector fo>>9 into FBUF (cached) and returns that byte in A.
; Clobbers lba, T0, Y. The 32 bit shift right by 9 is done as a one place shift of the upper 3 bytes.
gfb:    lda #0
        sta lba+3
        lda fo+3
        lsr
        sta lba+2
        lda fo+2
        ror
        sta lba+1
        lda fo+1
        ror
        sta lba
        ADD4 lba,fatlba
        lda #1
        jsr rdsec
        lda fo+1
        and #1
        clc
        adc #>FBUF
        sta T0+1
        lda fo
        sta T0
        ldy #0
        lda (T0),y
        rts

; s_cl = the FAT entry of s_cl (next cluster of the chain; compare with eoc to detect the end)
; FAT12: entry at byte offset n + n/2, two bytes; odd clusters use the top 12 bits (>>4), even the low 12 bits.
; FAT16: offset n*2. FAT32: offset n*4, only the low 28 bits are used.
fatnext:
        lda kind
        cmp #12
        jne fx_16
        lda s_cl
        and #1
        sta par
        MOV4 fo,s_cl
        MOV4 tmp4,s_cl
        SHR4 tmp4
        ADD4 fo,tmp4
        jsr gfb
        sta tmp4
        INC4 fo
        jsr gfb
        sta tmp4+1
        lda par
        beq fx_ev
        lsr tmp4+1
        ror tmp4
        lsr tmp4+1
        ror tmp4
        lsr tmp4+1
        ror tmp4
        lsr tmp4+1
        ror tmp4
        jmp fx_st
fx_ev:  lda tmp4+1
        and #$0F
        sta tmp4+1
fx_st:  lda tmp4
        sta s_cl
        lda tmp4+1
        sta s_cl+1
        lda #0
        sta s_cl+2
        sta s_cl+3
        rts
fx_16:  cmp #16
        bne fx_32
        MOV4 fo,s_cl
        SHL4 fo
        jsr gfb
        sta tmp4
        INC4 fo
        jsr gfb
        sta s_cl+1
        lda tmp4
        sta s_cl
        lda #0
        sta s_cl+2
        sta s_cl+3
        rts
fx_32:  MOV4 fo,s_cl
        SHL4 fo
        SHL4 fo
        ldx #0
fx_l:   stx ctr
        jsr gfb
        ldx ctr
        sta tmp4,x
        INC4 fo
        inx
        cpx #4
        bcc fx_l
        MOV4 s_cl,tmp4
        lda s_cl+3
        and #$0F
        sta s_cl+3
        rts

; ---- streams: sopen sets one up from e_start / e_size / e_dir, snext puts the next sector in SBUF (sn = valid bytes) ----
; sopen: ISO 9660 -> contiguous (sm=0) from sector e_start, s_cnt = sectors = (size+2047)>>11, size-limited.
;        FAT directory -> a cluster chain from e_start (sm=1); the FAT12/16 root (e_start=0) is a contiguous run
;        of rootsecs sectors at rootlba (sm=0), FAT32 root starts at rootclus. FAT file -> chain, size-limited.
;        UDF -> so_udf. s_lim=1 means the stream stops after s_rem bytes (files); directories run to the end.
sopen:  lda fst
        cmp #3
        jeq so_udf
        cmp #1
        jne so_fat
        lda #0
        sta sm
        MOV4 s_lba,e_start
        MOV4 s_rem,e_size
        MOV4 s_cnt,e_size
        clc
        lda s_cnt
        adc #<2047
        sta s_cnt
        lda s_cnt+1
        adc #>2047
        sta s_cnt+1
        lda s_cnt+2
        adc #0
        sta s_cnt+2
        lda s_cnt+3
        adc #0
        sta s_cnt+3
        ldx #11
so_sh:  SHR4 s_cnt
        dex
        bne so_sh
        lda #1
        sta s_lim
        rts
so_fat: lda e_dir
        beq so_fil
        lda #0
        sta s_lim
        ZER4 e_start
        bne so_ch
        lda kind
        cmp #32
        bne so_rt
        MOV4 e_start,rootclus
        jmp so_ch
so_rt:  lda #0
        sta sm
        MOV4 s_lba,rootlba
        CLR4 s_cnt
        lda rootsecs
        sta s_cnt
        lda rootsecs+1
        sta s_cnt+1
        rts
so_fil: lda #1
        sta s_lim
        MOV4 s_rem,e_size
so_ch:  lda #1
        sta sm
        MOV4 s_cl,e_start
        lda #0
        sta s_si
        rts

; Out: carry clear = SBUF holds the next sector, sn = number of valid bytes in it (last sector of a size-limited
; stream is trimmed to s_rem); carry set = end of stream. In chain mode the sector is
; datalba + (cluster-2)*spc + s_si, and fatnext is called after the last sector of each cluster.
snext:  lda s_lim
        beq sn_a
        ZER4 s_rem
        jeq sn_end
sn_a:   lda sm
        cmp #2
        jcs sn_udf
        cmp #1
        beq sn_chn
        ZER4 s_cnt
        jeq sn_end
        MOV4 lba,s_lba
        lda #0
        jsr rdsec
        INC4 s_lba
        DEC4 s_cnt
        jmp sn_z
sn_chn: CMP4 s_cl,eoc
        jcs sn_end
        lda s_cl+3
        ora s_cl+2
        ora s_cl+1
        bne sn_ok2
        lda s_cl
        cmp #2
        jcc sn_end
sn_ok2: MOV4 lba,s_cl
        sec
        lda lba
        sbc #2
        sta lba
        lda lba+1
        sbc #0
        sta lba+1
        lda lba+2
        sbc #0
        sta lba+2
        lda lba+3
        sbc #0
        sta lba+3
        ldx spcsh
        beq sn_s2
sn_s3:  SHL4 lba
        dex
        bne sn_s3
sn_s2:  ADD4 lba,datalba
        clc
        lda lba
        adc s_si
        sta lba
        lda lba+1
        adc #0
        sta lba+1
        lda lba+2
        adc #0
        sta lba+2
        lda lba+3
        adc #0
        sta lba+3
        lda #0
        jsr rdsec
        inc s_si
        lda s_si
        cmp spc
        bne sn_z
        lda #0
        sta s_si
        jsr fatnext
sn_z:   lda ssl
        sta sn
        lda ssh
        sta sn+1
        lda s_lim
        beq sn_dn
        lda s_rem+2
        ora s_rem+3
        bne sn_fu
        lda s_rem+1
        cmp ssh
        bcc sn_pa
        bne sn_fu
        lda s_rem
        cmp ssl
        bcc sn_pa
sn_fu:  sec
        lda s_rem
        sbc ssl
        sta s_rem
        lda s_rem+1
        sbc ssh
        sta s_rem+1
        lda s_rem+2
        sbc #0
        sta s_rem+2
        lda s_rem+3
        sbc #0
        sta s_rem+3
        jmp sn_dn
sn_pa:  lda s_rem
        sta sn
        lda s_rem+1
        sta sn+1
        CLR4 s_rem
sn_dn:  clc
        rts
sn_end: sec
        rts

; ---- UDF ----
; (T1) = destination (NUL ended, at most 40 characters); FNB = dstring (compression id 8 or 16 first), tl = its length
; Id 8 = one byte per character, id 16 = UCS-2 (high byte must be 0 else '?'); control characters become '?'.
ustr:   ldy #0
        lda tl
        beq us_z
        lda FNB
        sta uc
        ldx #1
us_l:   cpx tl
        bcs us_z
        cpy #40
        bcs us_z
        lda uc
        cmp #16
        beq us_w
        lda FNB,x
        inx
        jmp us_p
us_w:   lda FNB,x
        inx
        cpx tl
        bcs us_z
        pha
        lda FNB,x
        inx
        sta tcl
        pla
        beq us_h
        lda #'?'
        bne us_p
us_h:   lda tcl
us_p:   cmp #' '
        bcs us_s
        lda #'?'
us_s:   sta (T1),y
        iny
        jmp us_l
us_z:   lda #0
        sta (T1),y
        rts

; the file entry at partition block e_start -> UBUF; e_size, eoff, elen and aic set
; Accepts tag 261 (file entry, X=0) or 266 (extended file entry, X=40 = extra header bytes). Information length
; (+56) -> e_size; L_EA (+168+X) + 176 + X -> eoff = offset of the allocation descriptors; L_AD (+172+X) -> elen;
; aic = ICB flags (+34) & 7 = allocation type (0 short, 1 long, 3 embedded). Bad entry -> message and abort.
readfe: MOV4 lba,e_start
        ADD4 lba,base
        lda #2
        jsr rdsec
        lda UBUF+1
        cmp #1
        bne rf_bad
        ldx #0
        lda UBUF
        cmp #5
        beq rf_ok
        ldx #40
        cmp #$0A
        bne rf_bad
rf_ok:  ldy #3
rf_s:   lda UBUF+56,y
        sta e_size,y
        dey
        bpl rf_s
        lda UBUF+168,x
        clc
        adc #176
        sta eoff
        lda UBUF+169,x
        adc #0
        sta eoff+1
        txa
        clc
        adc eoff
        sta eoff
        bcc rf_e
        inc eoff+1
rf_e:   lda UBUF+172,x
        sta elen
        lda UBUF+173,x
        sta elen+1
        lda UBUF+34
        and #7
        sta aic
        lda eoff+1
        cmp #8
        bcs rf_bad
        rts
rf_bad: jsr putsi
        .byte EOL,'BAD UDF FILE ENTRY',EOL,0
        jmp abort

; UDF stream setup: sm = 2 (extent list copied to ADBUF, ads = 8 for short_ad / 16 for long_ad, adl = bytes capped
; to 255 and rounded down to whole descriptors) or sm = 3 (embedded data, aic 3, or unknown types treated as such).
so_udf: jsr readfe
        MOV4 s_rem,e_size
        lda #1
        sta s_lim
        lda #0
        sta emd
        sta adp
        sta adl
        CLR4 s_cnt
        lda aic
        cmp #3
        bne su_a
        lda #3
        sta sm
        rts
su_a:   ldx #8
        cmp #0
        beq su_s
        ldx #16
        cmp #1
        beq su_s
        lda #1
        sta emd
        lda #3
        sta sm
        rts
su_s:   stx ads
        lda elen+1
        bne su_cap
        lda elen
        jmp su_m
su_cap: lda #255
su_m:   ldx ads
        cpx #16
        bne su_8
        and #$F0
        jmp su_n
su_8:   and #$F8
su_n:   sta adl
        lda #<UBUF
        clc
        adc eoff
        sta T0
        lda #>UBUF
        adc eoff+1
        sta T0+1
        ldy #0
su_c:   cpy adl
        bcs su_d
        lda (T0),y
        sta ADBUF,y
        iny
        bne su_c
su_d:   lda #2
        sta sm
        rts

; next sector of a UDF stream (s_lim is always set)
; Walks the descriptors in ADBUF: each has a 4 byte length (top 2 bits = extent type; type 3 = continuation, which
; ends the stream here) followed by the block number, which gets base added. s_cnt = sectors left in the extent.
sn_udf: lda sm
        cmp #3
        jeq sn_emb
        ZER4 s_cnt
        jne su_rd
su_nx:  lda adp
        cmp adl
        jcs sn_end
        tay
        lda ADBUF+3,y
        and #$C0
        cmp #$C0
        jeq sn_end
        ldx #0
su_l:   lda ADBUF,y
        sta s_cnt,x
        iny
        inx
        cpx #4
        bcc su_l
        lda s_cnt+3
        and #$3F
        sta s_cnt+3
        ldx #0
su_b:   lda ADBUF,y
        sta s_lba,x
        iny
        inx
        cpx #4
        bcc su_b
        ADD4 s_lba,base
        lda adp
        clc
        adc ads
        sta adp
        clc
        lda s_cnt
        adc #<2047
        sta s_cnt
        lda s_cnt+1
        adc #>2047
        sta s_cnt+1
        lda s_cnt+2
        adc #0
        sta s_cnt+2
        lda s_cnt+3
        adc #0
        sta s_cnt+3
        ldx #11
su_sh:  SHR4 s_cnt
        dex
        bne su_sh
        ZER4 s_cnt
        jeq sn_end
su_rd:  MOV4 lba,s_lba
        lda #0
        jsr rdsec
        INC4 s_lba
        DEC4 s_cnt
        jmp sn_z

; embedded data: copy it from the file entry in UBUF to SBUF, once
sn_emb: lda emd
        jne sn_end
        lda #1
        sta emd
        lda elen
        sta tcl
        lda elen+1
        sta tch
        lda #<UBUF
        clc
        adc eoff
        sta T0
        lda #>UBUF
        adc eoff+1
        sta T0+1
        lda #<SBUF
        sta T1
        lda #>SBUF
        sta T1+1
        ldy #0
se_l:   lda tcl
        ora tch
        beq se_d
        lda (T0),y
        sta (T1),y
        inc T0
        bne se_a
        inc T0+1
se_a:   inc T1
        bne se_b
        inc T1+1
se_b:   lda tcl
        bne se_c
        dec tch
se_c:   dec tcl
        jmp se_l
se_d:   lda #0
        sta sbv
        jmp sn_z

; read one byte of the open directory stream into A; carry set at the end. dpos = read position inside SBUF,
; sn = valid bytes; refills with snext when the sector is used up. Clobbers T0, Y.
gb:     lda dpos+1
        cmp sn+1
        bcc gb_h
        bne gb_m
        lda dpos
        cmp sn
        bcc gb_h
gb_m:   jsr snext
        bcs gb_e
        lda #0
        sta dpos
        sta dpos+1
        jmp gb
gb_h:   lda dpos
        clc
        adc #<SBUF
        sta T0
        lda dpos+1
        adc #>SBUF
        sta T0+1
        ldy #0
        lda (T0),y
        inc dpos
        bne gb_r
        inc dpos+1
gb_r:   clc
        rts
gb_e:   sec
        rts

; next file identifier descriptor -> NAMEB, e_dir, e_start (file entry block), e_size
; Reads byte by byte with gb (FIDs may straddle sectors): 38 byte header into FIDB (tag 257 check, characteristics
; +18, L_FI +19, ICB block +24, L_IU +36), skips the implementation use bytes, reads the name into FNB, then pads
; to a 4 byte boundary. Deleted/parent entries (characteristics $0C) and empty names are skipped. For plain files
; the file entry is read to get the size (readfe).
dn_udf: lda #0
        sta kl
du_h:   jsr gb
        jcs dn_end
        ldx kl
        sta FIDB,x
        inc kl
        lda kl
        cmp #38
        bcc du_h
        lda FIDB
        cmp #1
        jne dn_end
        lda FIDB+1
        cmp #1
        jne dn_end
        lda FIDB+18
        sta chr
        lda FIDB+19
        sta fil
        lda FIDB+36
        sta tcl
        lda FIDB+37
        sta tch
du_i:   lda tcl
        ora tch
        beq du_n
        jsr gb
        jcs dn_end
        lda tcl
        bne du_j
        dec tch
du_j:   dec tcl
        jmp du_i
du_n:   lda #0
        sta kl
du_f:   lda kl
        cmp fil
        bcs du_p
        jsr gb
        jcs dn_end
        ldx kl
        sta FNB,x
        inc kl
        jmp du_f
du_p:   lda FIDB+36
        clc
        adc fil
        clc
        adc #38
        sta pad
        lda #0
        sec
        sbc pad
        and #3
        sta pad
du_s:   lda pad
        beq du_d
        jsr gb
        dec pad
        jmp du_s
du_d:   lda chr
        and #$0C
        jne dn_udf
        lda fil
        jeq dn_udf
        sta tl
        lda #<NAMEB
        sta T1
        lda #>NAMEB
        sta T1+1
        jsr ustr
        ldx #0
du_u:   lda NAMEB,x
        beq du_e
        jsr toupper
        sta NAMEB,x
        inx
        bne du_u
du_e:   lda chr
        lsr
        and #1
        sta e_dir
        ldx #3
du_l:   lda FIDB+24,x
        sta e_start,x
        dex
        bpl du_l
        CLR4 e_size
        lda e_dir
        bne du_r
        jsr readfe
du_r:   clc
        rts

; ---- directories ----
; open the directory described by e_start / e_size / e_dir for dnext
dopen:  jsr sopen
        lda #0
        sta dend
        sta sn
        sta sn+1
        sta dpos
        sta dpos+1
        rts

; next entry -> NAMEB, e_dir, e_start, e_size; carry set at the end
; FAT: 32 byte entries at dpos; first byte 0 = end, $E5 = deleted, '.' = dot entries, attribute $0F (long name)
; and volume label bit ($08) are skipped. The 8.3 name is rebuilt as NAME.EXT; attribute bit 4 = directory;
; cluster = +26 (low) and +20 (high, FAT32 only); size = +28.
dnext:  lda dend
        jne dn_end
        lda fst
        cmp #3
        jeq dn_udf
dn_t:   lda dpos+1
        cmp sn+1
        bcc dn_hv
        bne dn_mo
        lda dpos
        cmp sn
        bcc dn_hv
dn_mo:  jsr snext
        jcs dn_end
        lda #0
        sta dpos
        sta dpos+1
dn_hv:  lda dpos
        clc
        adc #<SBUF
        sta T0
        lda dpos+1
        adc #>SBUF
        sta T0+1
        lda fst
        cmp #1
        jeq dn_iso
        ldy #0
        lda (T0),y
        jeq dn_end
        cmp #$E5
        jeq dn_sk
        cmp #'.'
        jeq dn_sk
        ldy #11
        lda (T0),y
        cmp #$0F
        jeq dn_sk
        and #8
        jne dn_sk
        ldx #0
        ldy #0
fa_a:   lda (T0),y
        cmp #' '
        beq fa_b
        sta NAMEB,x
        inx
        iny
        cpy #8
        bcc fa_a
fa_b:   ldy #8
        lda (T0),y
        cmp #' '
        beq fa_e
        lda #'.'
        sta NAMEB,x
        inx
fa_c:   lda (T0),y
        cmp #' '
        beq fa_e
        sta NAMEB,x
        inx
        iny
        cpy #11
        bcc fa_c
fa_e:   lda #0
        sta NAMEB,x
        ldy #11
        lda (T0),y
        and #$10
        beq fa_f
        lda #1
fa_f:   sta e_dir
        ldx #0
        ldy #28
fa_s:   lda (T0),y
        sta e_size,x
        iny
        inx
        cpx #4
        bcc fa_s
        ldy #26
        lda (T0),y
        sta e_start
        iny
        lda (T0),y
        sta e_start+1
        lda #0
        sta e_start+2
        sta e_start+3
        lda kind
        cmp #32
        bne fa_x
        ldy #20
        lda (T0),y
        sta e_start+2
        iny
        lda (T0),y
        sta e_start+3
fa_x:   lda dpos
        clc
        adc #32
        sta dpos
        bcc fa_r
        inc dpos+1
fa_r:   clc
        rts
dn_sk:  lda dpos
        clc
        adc #32
        sta dpos
        jcc dn_t
        inc dpos+1
        jmp dn_t
dn_end: lda #1
        sta dend
        sec
        rts

; ISO 9660 directory record at (T0): length byte 0 = padding to the next sector (skip), +2 extent, +10 size,
; +25 flags (bit 1 = directory), +32 name length, +33 name. Records named $00 / $01 (. and ..) are skipped;
; the ";version" suffix is cut off, a trailing '.' dropped, and names are capped at 14 characters.
dn_iso: ldy #0
        lda (T0),y
        bne dn_ir
        lda sn
        sta dpos
        lda sn+1
        sta dpos+1
        jmp dn_t
dn_ir:  sta tl
        lda dpos
        clc
        adc tl
        sta dpos
        bcc dn_i1
        inc dpos+1
dn_i1:  ldy #32
        lda (T0),y
        sta lns
        cmp #1
        bne dn_nm
        ldy #33
        lda (T0),y
        cmp #2
        jcc dn_t
dn_nm:  ldx #0
        ldy #33
dn_ic:  cpx lns
        beq dn_id
        lda (T0),y
        cmp #';'
        beq dn_id
        cpx #14
        bcs dn_id
        jsr toupper
        sta NAMEB,x
        inx
        iny
        jmp dn_ic
dn_id:  cpx #0
        beq dn_iz
        lda NAMEB-1,x
        cmp #'.'
        bne dn_iz
        dex
dn_iz:  lda #0
        sta NAMEB,x
        ldy #25
        lda (T0),y
        and #2
        beq dn_if
        lda #1
dn_if:  sta e_dir
        ldx #0
        ldy #2
dn_is:  lda (T0),y
        sta e_start,x
        iny
        inx
        cpx #4
        bcc dn_is
        ldx #0
        ldy #10
dn_iz2: lda (T0),y
        sta e_size,x
        iny
        inx
        cpx #4
        bcc dn_iz2
        clc
        rts

; entry for the root directory -> e_dir / e_start / e_size (FAT root is cluster 0 here; see sopen)
setroot:
        lda #1
        sta e_dir
        lda fst
        cmp #3
        bne sr_i
        MOV4 e_start,rootlba
        CLR4 e_size
        rts
sr_i:   cmp #1
        bne sr_f
        MOV4 e_start,rootlba
        MOV4 e_size,rootlen
        rts
sr_f:   CLR4 e_start
        CLR4 e_size
        rts

; Z set when A is / > or \ (path separators; $5C = backslash)
issep:  cmp #'/'
        beq is_y
        cmp #'>'
        beq is_y
        cmp #$5C
is_y:   rts

; PATHB -> e_dir / e_start / e_size / NAMEB; carry set when not found
; Starts at the root and, for each component (upper cased into CMPN, max 40 chars), opens the current directory and
; compares against NAMEB of every entry. A path that ends after a separator or is empty resolves to the directory.
; pi = parse position in PATHB.
walk:   jsr setroot
        lda #0
        sta pi
        sta NAMEB
wk_l:   ldy pi
wk_s:   lda PATHB,y
        beq wk_ok
        cmp #EOL
        beq wk_ok
        jsr issep
        bne wk_c
        iny
        bne wk_s
wk_c:   ldx #0
wk_cc:  lda PATHB,y
        beq wk_ce
        cmp #EOL
        beq wk_ce
        jsr issep
        beq wk_ce
        jsr toupper
        cpx #40
        bcs wk_sk
        sta CMPN,x
        inx
wk_sk:  iny
        bne wk_cc
wk_ce:  lda #0
        sta CMPN,x
        sty pi
        lda e_dir
        beq wk_nf
        jsr dopen
wk_n:   jsr dnext
        bcs wk_nf
        ldy #0
wk_m:   lda CMPN,y
        cmp NAMEB,y
        bne wk_n
        cmp #0
        beq wk_l
        iny
        bne wk_m
wk_nf:  sec
        rts
wk_ok:  clc
        rts

; ---- commands ----
; I: print "Dn: FS [bits] LABEL" and the sector count / size. The 32 bit count goes through dec32 + putdig.
doinfo: jsr putsi
        .byte 'D',0
        lda unitn
        sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsi
        .byte ': ',0
        lda fst
        cmp #3
        bne di_i
        jsr putsi
        .byte 'UDF',0
        jmp di_l
di_i:   cmp #1
        bne di_f
        jsr putsi
        .byte 'ISO 9660',0
        jmp di_l
di_f:   jsr putsi
        .byte 'FAT',0
        lda kind
        sta N0
        lda #0
        sta N1
        jsr putdec16
di_l:   lda LABEL
        beq di_n
        jsr putsi
        .byte '  LABEL ',0
        ldy #0
di_p:   lda LABEL,y
        beq di_n
        jsr putc
        iny
        bne di_p
di_n:   jsr putnl
        MOV4 dv,secs
        jsr dec32
        jsr putdig
        jsr putsi
        .byte ' SECTORS OF ',0
        lda ssl
        sta N0
        lda ssh
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' BYTES',EOL,0
        jmp prompt

; D / L: list a directory (one line per entry, then the entry count in nfl/nfh) or a single file.
dolist: lda e_dir
        bne dl_d
        jsr listline
        jmp prompt
dl_d:   lda #0
        sta nfl
        sta nfh
        jsr dopen
dl_n:   jsr dnext
        bcs dl_e
        jsr listline
        inc nfl
        bne dl_n
        inc nfh
        jmp dl_n
dl_e:   lda nfl
        sta N0
        lda nfh
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' ENTRIES',EOL,0
        jmp prompt

; print NAMEB padded with spaces to 13 columns (at least one space), then <DIR> or the size in bytes
listline:
        ldy #0
ll_n:   lda NAMEB,y
        beq ll_p
        jsr putc
        iny
        bne ll_n
ll_p:   sty tl
        cpy #13
        bcs ll_o
        lda #13
        sec
        sbc tl
        tay
        jmp ll_q
ll_o:   ldy #1
ll_q:   jsr putsp
        lda e_dir
        beq ll_f
        jsr putsi
        .byte '  <DIR>',0
        jmp putnl
ll_f:   MOV4 dv,e_size
        jsr dec32
        jsr putdig
        jmp putnl

; ---- T: show a text file ----
; Streams the file sector by sector and feeds each byte (T0 = pointer into SBUF, tch:tcl = bytes left) to tyout.
dotype: lda e_dir
        jne notfile
        lda #0
        sta lines
        jsr sopen
ty_s:   jsr snext
        bcs ty_d
        lda sn
        sta tcl
        lda sn+1
        sta tch
        lda #<SBUF
        sta T0
        lda #>SBUF
        sta T0+1
ty_b:   lda tcl
        ora tch
        beq ty_s
        ldy #0
        lda (T0),y
        jsr tyout
        inc T0
        bne ty_i
        inc T0+1
ty_i:   lda tcl
        bne ty_c
        dec tch
ty_c:   dec tcl
        jmp ty_b
ty_d:   jsr putnl
        jmp prompt

; print one byte of text: LF = newline (pauses with a MORE prompt every 20 lines; ESC aborts), CR ignored, TAB = space,
; other control or non-ASCII bytes show as '.'
tyout:  cmp #$0A
        beq ty_nl
        cmp #$0D
        beq ty_r
        cmp #9
        bne ty_p
        lda #' '
ty_p:   cmp #$20
        bcc ty_dt
        cmp #$7F
        bcs ty_dt
        jmp putc
ty_dt:  lda #'.'
        jmp putc
ty_r:   rts
ty_nl:  jsr putnl
        inc lines
        lda lines
        cmp #20
        bne ty_r
        lda #0
        sta lines
        jsr putsi
        .byte '-- MORE (ESC STOPS) --',0
        jsr getkey
        pha
        jsr putnl
        pla
        cmp #$1B
        bne ty_r
        jmp abort

notfile:
        jsr putsi
        .byte 'THAT IS A FOLDER',EOL,0
        jmp prompt

; ---- X: copy a file out to a DOS file ----
; Builds the output file spec in FSPEC2 from DEST: empty -> D1:<name>; ending in : > or \ -> DEST + source name;
; otherwise DEST is used as is. Opens it for write (mode 8) on IOCB $30, then writes every sector with bputp
; (V_BPL/V_BPH = buffer, V_BLL/V_BLH = length).
doext:  lda e_dir
        bne notfile
        ldy #0
dx_d:   lda DEST,y
        cmp #EOL
        beq dx_e
        sta FSPEC2,y
        iny
        bne dx_d
dx_e:   cpy #0
        beq dx_df
        lda FSPEC2-1,y
        cmp #':'
        beq dx_nm
        cmp #'>'
        beq dx_nm
        cmp #$5C
        beq dx_nm
        bne dx_g
dx_df:  lda #'D'
        sta FSPEC2
        lda #'1'
        sta FSPEC2+1
        lda #':'
        sta FSPEC2+2
        ldy #3
dx_nm:  ldx #0
dx_f:   lda NAMEB,x
        beq dx_g
        sta FSPEC2,y
        inx
        iny
        bne dx_f
dx_g:   lda #EOL
        sta FSPEC2,y
        lda #8
        ldx #$30
        jsr fopen2
        bpl dx_w
        jsr putsi
        .byte 'CANNOT CREATE THE FILE',EOL,0
        jmp prompt
dx_w:   jsr sopen
dx_l:   jsr snext
        bcs dx_c
        lda #<SBUF
        sta V_BPL
        lda #>SBUF
        sta V_BPH
        lda sn
        sta V_BLL
        lda sn+1
        sta V_BLH
        ldx #$30
        jsr bputp
        bpl dx_l
        jsr putsi
        .byte EOL,'WRITE ERROR',EOL,0
        jmp abort
dx_c:   ldx #$30
        jsr fclose
        jsr putsi
        .byte 'OK',EOL,0
        jmp prompt

; dv (32 bit) -> 8 digits in dig, leading zeros turned into spaces
; Repeated subtraction of the powers of ten in table pw (4 bytes each, index Y*4); dv is destroyed.
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
; print the 8 characters in dig
putdig: ldy #0
pg_l:   lda dig,y
        jsr putc
        iny
        cpy #8
        bcc pg_l
        rts
; powers of ten, 10^7 down to 10^0, as 32 bit little endian
pw:     .dword 10000000
        .dword 1000000
        .dword 100000
        .dword 10000
        .dword 1000
        .dword 100
        .dword 10
        .dword 1
        run start
