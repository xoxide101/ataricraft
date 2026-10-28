; disc.asm - DISC.COM, a read-only reader for the raw drives D9: and D10: (ataricraft's virtual SIO disks).
; File systems: ISO 9660 (2048 byte sectors) and FAT12/16/32 (512 byte sectors, MBR partitions, 8.3 names).
; Sectors come straight from SIO (device $39/$3A, $52 read, $48 high sector word, $53 status; see web/js/rawdisk.js).
; At the DISC> prompt:  D [D9:][path] list | T [D9:]path show | X [D9:]path [dest] copy to a DOS file | I [D9:] info
; Paths use / > or \ between names. A blank line exits.
        icl 'lib\sys.asm'

SBUF    = $6400         ; data sector (up to 2048 bytes)
FBUF    = $6C00         ; FAT sector (512 bytes)
PATHB   = $6E00         ; 64  path being resolved
DEST    = $6E40         ; 64  extract destination
CMPN    = $6E80         ; 16  path component, upper case
LABEL   = $6E90         ; 34  volume label
VARS    = $6F00

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

        org CODE
        icl 'lib\io.asm'
        icl 'lib\hand.asm'

start:  lda #9
        sta unitn
        jsr putsi
        .byte 'DISC 0.1  READ-ONLY D9:/D10: (ISO 9660, FAT)',EOL
        .byte 'D [PATH] | T PATH | X PATH [DEST] | I',EOL
        .byte 'PREFIX D9: OR D10: PICKS THE DRIVE',EOL
        .byte 'BLANK LINE EXITS',EOL,0
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

bye:    ldx #$30
        jsr fclose
        jmp (DOSVEC)

abort:  ldx #$30
        jsr fclose
        ldx psp
        txs
        jmp prompt

; TOK -> PATHB; a D9: / D10: prefix selects the drive
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

; ---- SIO ----
; A = command, X = DSTATS
sioset: sta DCOMND
        stx DSTATS
        lda #$31
        sta DDEVIC
        lda unitn
        sta DUNIT
        lda #15
        sta DTIMLO
        rts

; read sector lba into SBUF (A = 0) or FBUF (A = 1)
rdsec:  sta bsel
        bne rs_f
        lda sbv
        beq rs_go
        NE4 lba,sbtag,rs_go
        clc
        rts
rs_f:   lda fbv
        beq rs_go
        NE4 lba,fbtag,rs_go
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
rs_b:   lda #<FBUF
        sta DBUFLO
        lda #>FBUF
        sta DBUFHI
        lda #0
        sta DBYTLO
        lda #2
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
rs_t:   MOV4 fbtag,lba
        lda #1
        sta fbv
        clc
        rts
rs_e:   lda #0
        sta sbv
        sta fbv
        jsr putsi
        .byte EOL,'DISK READ ERROR',EOL,0
        jmp abort

; ---- mount: find out what is in the drive ----
mount:  lda #0
        sta fst
        sta sbv
        sta fbv
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
        beq mt_iso
        cmp #2
        jeq mt_fat
mt_unk: jsr putsi
        .byte 'UNKNOWN FILE SYSTEM (ISO 9660 AND FAT ONLY)',EOL,0
        sec
        rts
mt_nd:  jsr putsi
        .byte 'NO IMAGE IN THAT DRIVE (LOAD ONE FROM THE D9/D10 DEVICE BAR)',EOL,0
        sec
        rts

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

; copy Y bytes at (T0) to LABEL, NUL ended, trailing spaces removed
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
; byte of the FAT at byte offset fo
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

; s_cl = the FAT entry of s_cl
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
sopen:  lda fst
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

snext:  lda s_lim
        beq sn_a
        ZER4 s_rem
        jeq sn_end
sn_a:   lda sm
        bne sn_chn
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

; ---- directories ----
dopen:  jsr sopen
        lda #0
        sta dend
        sta sn
        sta sn+1
        sta dpos
        sta dpos+1
        rts

; next entry -> NAMEB, e_dir, e_start, e_size; carry set at the end
dnext:  lda dend
        jne dn_end
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

setroot:
        lda #1
        sta e_dir
        lda fst
        cmp #1
        bne sr_f
        MOV4 e_start,rootlba
        MOV4 e_size,rootlen
        rts
sr_f:   CLR4 e_start
        CLR4 e_size
        rts

; Z set when A is / > or \
issep:  cmp #'/'
        beq is_y
        cmp #'>'
        beq is_y
        cmp #$5C
is_y:   rts

; PATHB -> e_dir / e_start / e_size / NAMEB; carry set when not found
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
        cpx #12
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
        cmp #1
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
putdig: ldy #0
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
