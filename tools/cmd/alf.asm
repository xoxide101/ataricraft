; alf.asm - ALF.COM, a stand-alone ALF (Atari LZ.COM / DZ.COM) lister/extractor for any Atari DOS.
; Members: 29 byte ARC-like header ($1A $0F, name[13], packed, date, time, 16 bit additive sum, size) + LZW data
; (9..12 bit codes, MSB first, 256 = reset, 257 = end, no early change). Mirrors web/js/alf.js (tested on every sample).
; At the ALF> prompt: L ALFFILE | X ALFFILE [DEST] [MEMBER] | T ALFFILE [MEMBER]   (blank line = exit)
        icl 'lib\sys.asm'

PFXL    = $6400         ; code -> prefix code, low bytes (4096)
PFXH    = $7400         ; high nibbles
SUF     = $8400         ; code -> last byte
STK     = $9400         ; string being unwound (up to 4096 bytes)
INBUF   = $A400
OUTBUF  = $A500
HDR     = $A600         ; the 29 byte header
NAMEF   = HDR+2
VARS    = $A700
DEST    = $A7C0
MEMB    = $A800

ipos    = VARS
ilen    = ipos+1
bb      = ilen+1
bn      = bb+1
opos    = bn+1
mode    = opos+1        ; 0 list 1 extract 2 test
wr      = mode+1        ; 1 while the member is being written to a file
c0      = wr+1          ; running 16 bit sum
c1      = c0+1
ob      = c1+1
gcnt    = ob+1
vl      = gcnt+1
vh      = vl+1
kl      = vh+1
kh      = kl+1
tl      = kh+1
want    = tl+1
psp     = want+1
nfl     = psp+1
nfh     = nfl+1
s0      = nfh+1         ; 32-bit packed bytes left / skip counter
s1      = s0+1
s2      = s1+1
s3      = s2+1
dv      = s3+1
tv      = dv+4
dig     = tv+4
rm0     = dig+8         ; 32-bit output bytes left
rm1     = rm0+1
rm2     = rm1+1
rm3     = rm2+1
wd      = rm3+1         ; current code width
havep   = wd+1          ; 1 once a previous code exists
kw      = havep+1       ; 1 for the "code = next" case
fb      = kw+1          ; first byte of the current string
pvl     = fb+1          ; previous code
pvh     = pvl+1
cul     = pvh+1         ; code being unwound
cuh     = cul+1
hcrl    = cuh+1
hcrh    = hcrl+1

stp     = $B0           ; string stack pointer
pp      = $B2           ; page pointer into the tables, its low byte stays 0
nxt     = $B4           ; next free code
nxh     = nxt+1

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

        org CODE
        icl 'lib\io.asm'
        icl 'lib\hand.asm'

start:  lda #0
        sta pp
        jsr putsi
        .byte 'ALF 0.1  ATARI LZ/DZ ALF LISTER/EXTRACTOR',EOL
        .byte 'L ALF | X ALF [DEST] [MEMBER] | T ALF',EOL
        .byte 'Q QUITS',EOL,0
prompt: tsx
        stx psp
        jsr putnl
        jsr putsi
        .byte 'ALF>',0
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

; next byte of the member's packed data (s0..s3 counts what is left; zeros after the end)
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

; ---- output: A = byte into the sum and (when writing) the file; bytes past the member's size are dropped ----
outb:   sta ob
        jsr remz
        beq ob_r
        lda ob
        clc
        adc c0
        sta c0
        bcc ob_s
        inc c1
ob_s:   lda rm0
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

; ---- LZW ----
; table entry nxt: prefix = pv, suffix = fb
addent: lda nxh
        cmp #$10
        bcs ae_r
        clc
        adc #>SUF
        sta pp+1
        ldy nxt
        lda fb
        sta (pp),y
        lda nxh
        clc
        adc #>PFXL
        sta pp+1
        lda pvl
        sta (pp),y
        lda nxh
        clc
        adc #>PFXH
        sta pp+1
        lda pvh
        sta (pp),y
        INC16 nxt
ae_r:   rts

; push the string of code cul/cuh (all but its first byte, last byte first); cul ends as the first byte
unwind: lda cuh
        beq uw_d
        clc
        adc #>SUF
        sta pp+1
        ldy cul
        lda (pp),y
        ldy #0
        sta (stp),y
        INC16 stp
        lda cuh
        clc
        adc #>PFXL
        sta pp+1
        ldy cul
        lda (pp),y
        tax
        lda cuh
        clc
        adc #>PFXH
        sta pp+1
        lda (pp),y
        sta cuh
        stx cul
        jmp unwind
uw_d:   rts

; write out the pushed bytes (last pushed first)
popall: lda stp
        bne pa_g
        lda stp+1
        cmp #>STK
        beq pa_d
pa_g:   DEC16 stp
        ldy #0
        lda (stp),y
        jsr outb
        jmp popall
pa_d:   rts

; decode until the output size is reached or the end code shows up
lzmain: lda #9
        sta wd
        lda #<258
        sta nxt
        lda #>258
        sta nxh
        lda #0
        sta havep
lm:     jsr remz
        jeq lm_d
        ldx wd
        jsr getbits
        lda vh
        cmp #1
        bne lm_n
        lda vl
        cmp #2
        bcs lm_n
        cmp #1
        jeq lm_d
        lda #9
        sta wd
        lda #<258
        sta nxt
        lda #>258
        sta nxh
        lda #0
        sta havep
        jmp lm
lm_n:   lda havep
        bne lm_g
        lda vh
        jne ferr_data
        lda vl
        sta fb
        jsr outb
        lda #1
        sta havep
        jmp lm_p
lm_g:   lda vh
        cmp nxh
        bcc lm_l
        jne ferr_data
        lda vl
        cmp nxt
        bcc lm_l
        jne ferr_data
        lda #1
        sta kw
        lda pvl
        sta cul
        lda pvh
        sta cuh
        jmp lm_u
lm_l:   lda #0
        sta kw
        lda vl
        sta cul
        lda vh
        sta cuh
lm_u:   lda #<STK
        sta stp
        lda #>STK
        sta stp+1
        jsr unwind
        lda cul
        sta fb
        jsr outb
        jsr popall
        lda kw
        beq lm_a
        lda fb
        jsr outb
lm_a:   jsr addent
        ldx #9
        lda nxh
        cmp #2
        bcc lm_w
        ldx #10
        cmp #4
        bcc lm_w
        ldx #11
        cmp #8
        bcc lm_w
        ldx #12
lm_w:   stx wd
lm_p:   lda vl
        sta pvl
        lda vh
        sta pvh
        jmp lm
lm_d:   rts

; run the member's data through the decoder
procdata:
        lda #0
        sta c0
        sta c1
        sta bn
        sta opos
        ldx #3
pd_a:   lda HDR+15,x
        sta s0,x
        lda HDR+25,x
        sta rm0,x
        dex
        bpl pd_a
        jmp lzmain

; ---- archive walk ----
; read the next header into HDR; carry set at the end of the entries (anything but $1A $0F ends it silently)
rdlh:   jsr getbyte
        bcs rl_e
        sta HDR
        cmp #$1A
        bne rl_e
        jsr getbyte
        bcs rl_e
        sta HDR+1
        cmp #$0F
        bne rl_e
        ldy #2
rl_h:   sty tl
        jsr getbyt
        ldy tl
        sta HDR,y
        iny
        cpy #29
        bne rl_h
        lda HDR+23
        sta hcrl
        lda HDR+24
        sta hcrh
        clc
        rts
rl_e:   sec
        rts

members:
mem:    jsr rdlh
        bcs mem_d
        jsr conv83
        ldx #3
mem_s:  lda HDR+15,x
        sta s0,x
        dex
        bpl mem_s
        lda NAMEB
        beq mem_k
        jsr domember
        inc nfl
        bne mem
        inc nfh
        jmp mem
mem_k:  jsr skip32
        jmp mem
mem_d:  rts

; NAMEF (up to 12 chars, NUL ended) -> NAMEB, upper case, odd characters turned into '_', no trailing '.'
conv83: ldx #0
cv_l:   cpx #12
        bcs cv_e
        lda NAMEF,x
        beq cv_e
        cmp #'.'
        beq cv_s
        jsr fixc
cv_s:   sta NAMEB,x
        inx
        jmp cv_l
cv_e:   cpx #0
        beq cv_z
        lda NAMEB-1,x
        cmp #'.'
        bne cv_z
        dex
cv_z:   lda #0
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
        lda wr
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
        .byte 'CHECKSUM ERROR',EOL,0
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
ll_a:   lda HDR+25,x
        sta dv,x
        dex
        bpl ll_a
        jsr dec32
        jsr putdig
        ldx #3
ll_c:   lda HDR+15,x
        sta dv,x
        dex
        bpl ll_c
        jsr dec32
        jsr putdig
        lda #' '
        jsr putc
        jsr putsi
        .byte 'ALF ',0
        lda HDR+19
        lsr
        lsr
        lsr
        lsr
        lsr
        sta tl
        lda HDR+20
        and #1
        asl
        asl
        asl
        ora tl
        jsr put2d
        lda #'-'
        jsr putc
        lda HDR+19
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
