; arc.asm - ARC.COM, a stand-alone SEA ARC lister/extractor for any Atari DOS.
; Methods 1/2 stored, 3 packed, 4 squeezed, 8 crunched (dynamic LZW), CRC16 checked. Reference: web/js/arc.js
; At the ARC> prompt: L ARCFILE | X ARCFILE [DEST] [MEMBER] | T ARCFILE [MEMBER]   (blank line = exit)
        icl 'lib\sys.asm'

PREL    = $8000         ; LZW prefix low bytes (4096)
PREH    = $9000         ; LZW prefix high bytes
SUF     = $A000         ; LZW end characters
STK     = $B000         ; string expansion stack
STKEND  = $BB           ; high byte limit
TREE    = $6400         ; squeeze tree (up to 257 nodes * 4)
TBL_L   = $6900
TBL_H   = $6A00
HDR     = $6B00         ; archive entry header
INBUF   = $7000
OUTBUF  = $7F00
DEST    = $6CC0
MEMB    = $6D00
VARS    = $6C00

ipos    = VARS+0
ilen    = VARS+1
bbox    = VARS+2
bsl     = VARS+3
opos    = VARS+4
mode    = VARS+5        ; 0 list 1 extract 2 test
method  = VARS+6
crcl    = VARS+7
crch    = VARS+8
ob      = VARS+9
orm0    = VARS+10
orm1    = VARS+11
orm2    = VARS+12
r0      = VARS+13       ; compressed bytes left in the member
r1      = VARS+14
r2      = VARS+15
r3      = VARS+16
csz     = VARS+17
fst     = VARS+18
ofs     = VARS+19
maxh    = VARS+20
nfiles  = VARS+21
derr    = VARS+22
kk      = VARS+23
rlerep  = VARS+24
rlelast = VARS+25
rcnt    = VARS+26
rcn     = VARS+27
rcs     = VARS+28
rsn     = VARS+29
fn      = VARS+30
sn0     = VARS+31
sn1     = VARS+32
rrl     = VARS+33
rrh     = VARS+34
ndl     = VARS+35
ndh     = VARS+36
vl      = VARS+37
vh      = VARS+38
bitv    = VARS+39
cntl    = VARS+40
cnth    = VARS+41
tl      = VARS+42
th      = VARS+43
dv      = VARS+44       ; 4 bytes
tv      = VARS+48       ; 4 bytes
dig     = VARS+52       ; 8 digits
nfl     = VARS+60
nfh     = VARS+61

SP      = $E0
CDL     = $E2
CDH     = $E3
OLDL    = $E4
OLDH    = $E5
LSTL    = $E6
LSTH    = $E7
EL      = $E8
EH      = $E9

        org CODE
        icl 'lib\io.asm'
        icl 'lib\hand.asm'

start:  jsr crctab
        jsr putsi
        .byte 'ARC 0.1  SEA ARC LISTER/EXTRACTOR',EOL
        .byte 'L ARC | X ARC [DEST] [MEMBER] | T ARC',EOL
        .byte 'BLANK LINE EXITS',EOL,0
prompt: jsr putnl
        jsr putsi
        .byte 'ARC>',0
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

; ---- CRC16 table (poly $A001) ----
crctab: ldx #0
ct_l:   stx tl
        lda #0
        sta th
        ldy #8
ct_b:   lsr th
        ror tl
        bcc ct_n
        lda th
        eor #$A0
        sta th
        lda tl
        eor #$01
        sta tl
ct_n:   dey
        bne ct_b
        lda tl
        sta TBL_L,x
        lda th
        sta TBL_H,x
        inx
        bne ct_l
        rts

; ---- member loop ----
; read 2 bytes then the rest of the header; carry set at the end of the archive
rdhdr:  lda #<HDR
        sta V_BPL
        lda #>HDR
        sta V_BPH
        lda #2
        ldx #0
        jsr rdraw
        bcs rh_e
        lda HDR
        cmp #$1A
        bne rh_e
        lda HDR+1
        beq rh_e
        ldx #27
        cmp #1
        bne rh_g
        ldx #21
rh_g:   lda #<(HDR+2)
        sta V_BPL
        lda #>(HDR+2)
        sta V_BPH
        txa
        ldx #0
        jsr rdraw
        bcs rh_e
        clc
        rts
rh_e:   sec
        rts

members:
mem:    jsr rdhdr
        bcs mem_d
        lda HDR+1
        sta method
        ldx #3
mm_r:   lda HDR+15,x
        sta r0,x
        dex
        bpl mm_r
        ldx #3
mm_s:   lda HDR+25,x
        sta dv,x
        dex
        bpl mm_s
        lda method
        cmp #1
        bne mm_n
        ldx #3
mm_c:   lda r0,x
        sta dv,x
        dex
        bpl mm_c
mm_n:   ldy #0
mm_nm:  cpy #13
        bcs mm_z
        lda HDR+2,y
        beq mm_z
        jsr toupper
        sta NAMEB,y
        iny
        bne mm_nm
mm_z:   lda #0
        sta NAMEB,y
        lda mode
        bne mm_x
        jsr listline
        jsr skip
        inc nfl
        bne mem
        inc nfh
        jmp mem
mm_x:   jsr matchq
        bcs mm_sk
        jsr extract
        inc nfl
        bne mem
        inc nfh
        jmp mem
mm_sk:  jsr skip
        jmp mem
mem_d:  rts

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

; ---- listing ----
listline:
        ldy #0
ll_n:   lda NAMEB,y
        beq ll_p
        jsr putc
        iny
        cpy #13
        bcc ll_n
ll_p:   sty cntl
        lda #14
        sec
        sbc cntl
        tay
        jsr putsp
        jsr dec32               ; uncompressed size is in dv
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
        ldx method
        lda mnames-1,x
        sta tl
        lda method
        asl
        asl
        tax
        ldy #4
ll_m:   lda mnam2-4,x
        jsr putc
        inx
        dey
        bne ll_m
        lda #' '
        jsr putc
        lda HDR+20
        lsr
        sta tl
        clc
        lda #$BC
        adc tl
        sta N0
        lda #$07
        adc #0
        sta N1
        jsr putdec16
        lda #'-'
        jsr putc
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
mnames: .byte 0,0,0,0,0,0,0,0,0
mnam2:  .byte 'STORSTORPACKSQZDCRN5CRN6CRN7CRNCSQSH'

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
d3_p:   sty cntl
        lda #0
        sta cnth
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
        inc cnth
        jmp d3_t
d3_d:   lda cnth
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

; ---- raw reads from the archive (IOCB 2) ----
; A/X = length, V_BPL/V_BPH = destination. Carry set when fewer bytes arrived.
rdraw:  sta V_BLL
        stx V_BLH
        sta rrl
        stx rrh
        ldx #$20
        jsr bgetp
        lda ICBLL+$20
        cmp rrl
        bne rr_s
        lda ICBLH+$20
        cmp rrh
        bne rr_s
        clc
        rts
rr_s:   sec
        rts

; refill INBUF from the member; carry set when the member is used up
fill:   lda r3
        ora r2
        ora r1
        bne fl_f
        lda r0
        beq fl_e
        bne fl_g
fl_f:   lda #255
fl_g:   sta fn
        lda #<INBUF
        sta V_BPL
        lda #>INBUF
        sta V_BPH
        lda fn
        ldx #0
        jsr rdraw
        bcc fl_ok
        lda ICBLL+$20
        sta ilen
        lda #0
        sta ipos
        sta r0
        sta r1
        sta r2
        sta r3
        lda ilen
        beq fl_e
        clc
        rts
fl_ok:  lda fn
        sta ilen
        lda #0
        sta ipos
        lda r0
        sec
        sbc fn
        sta r0
        lda r1
        sbc #0
        sta r1
        lda r2
        sbc #0
        sta r2
        lda r3
        sbc #0
        sta r3
        clc
        rts
fl_e:   sec
        rts

; next member byte in A, carry set at the end
getbyte:
        lda ipos
        cmp ilen
        bcc gb_ok
        jsr fill
        bcs gb_r
gb_ok:  ldx ipos
        lda INBUF,x
        inc ipos
        clc
gb_r:   rts

; next bit (LSB first) in A, carry set at the end
getbit: lda bsl
        bne gt_g
        jsr getbyte
        bcs gt_r
        sta bbox
        lda #8
        sta bsl
gt_g:   dec bsl
        lsr bbox
        lda #0
        rol
        clc
gt_r:   rts

; discard whatever is left of the member
skip:   lda r0
        ora r1
        ora r2
        ora r3
        beq sk_d
        lda r3
        ora r2
        bne sk_b
        lda r1
        cmp #$0E
        bcs sk_b
        lda r0
        sta sn0
        lda r1
        sta sn1
        jmp sk_g
sk_b:   lda #0
        sta sn0
        lda #$0E
        sta sn1
sk_g:   lda #<INBUF
        sta V_BPL
        lda #>INBUF
        sta V_BPH
        lda sn0
        ldx sn1
        jsr rdraw
        bcs sk_s
        lda r0
        sec
        sbc sn0
        sta r0
        lda r1
        sbc sn1
        sta r1
        lda r2
        sbc #0
        sta r2
        lda r3
        sbc #0
        sta r3
        jmp skip
sk_s:   lda #0
        sta r0
        sta r1
        sta r2
        sta r3
sk_d:   rts

; ---- output ----
; A = byte: caps at the stored size, updates the CRC, buffers for the file
outb:   sta ob
        lda orm0
        ora orm1
        ora orm2
        beq ob_r
        lda orm0
        bne ob_a
        lda orm1
        bne ob_b
        dec orm2
ob_b:   dec orm1
ob_a:   dec orm0
        lda ob
        eor crcl
        tax
        lda crch
        eor TBL_L,x
        sta crcl
        lda TBL_H,x
        sta crch
        lda mode
        cmp #1
        bne ob_r
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
        jmp bye

; run length expansion ($90 marker) in front of outb
rle_in: ldx rlerep
        bne ri_r
        cmp #$90
        bne ri_n
        lda #1
        sta rlerep
        rts
ri_n:   sta rlelast
        jmp outb
ri_r:   ldx #0
        stx rlerep
        cmp #0
        bne ri_c
        lda #$90
        jmp outb
ri_c:   sta rcnt
        dec rcnt
        beq ri_d
ri_l:   lda rlelast
        jsr outb
        dec rcnt
        bne ri_l
ri_d:   rts

; ---- extract / test one member ----
extract:
        lda #'X'
        ldx mode
        cpx #1
        beq ex_x
        lda #'T'
ex_x:   jsr putc
        lda #' '
        jsr putc
        ldy #0
ex_n:   lda NAMEB,y
        beq ex_p
        jsr putc
        iny
        bne ex_n
ex_p:   lda #' '
        jsr putc
        lda method
        cmp #1
        beq ex_ok
        cmp #2
        beq ex_ok
        cmp #3
        beq ex_ok
        cmp #4
        beq ex_ok
        cmp #8
        beq ex_ok
        jsr putsi
        .byte 'UNSUPPORTED METHOD',EOL,0
        jmp skip
ex_ok:  lda #0
        sta crcl
        sta crch
        sta opos
        sta ipos
        sta ilen
        sta bsl
        sta rlerep
        sta rlelast
        sta derr
        lda dv
        sta orm0
        lda dv+1
        sta orm1
        lda dv+2
        sta orm2
        lda mode
        cmp #1
        bne ex_run
        ldy #0
ex_d:   lda DEST,y
        cmp #EOL
        beq ex_e
        sta FSPEC2,y
        iny
        bne ex_d
ex_e:   ldx #0
ex_f:   lda NAMEB,x
        beq ex_g
        sta FSPEC2,y
        inx
        iny
        bne ex_f
ex_g:   lda #EOL
        sta FSPEC2,y
        lda #8
        ldx #$30
        jsr fopen2
        bpl ex_run
        jsr putsi
        .byte 'CANNOT CREATE',EOL,0
        jmp skip
ex_run: lda method
        cmp #3
        beq ex_3
        cmp #4
        beq ex_4
        cmp #8
        beq ex_8
ex_1:   jsr getbyte
        bcs ex_fin
        jsr outb
        jmp ex_1
ex_3:   jsr getbyte
        bcs ex_fin
        jsr rle_in
        jmp ex_3
ex_4:   jsr unsqz
        jmp ex_fin
ex_8:   jsr lzw
ex_fin: lda mode
        cmp #1
        bne ex_v
        lda opos
        beq ex_cl
        ldx #0
        jsr wrout
ex_cl:  ldx #$30
        jsr fclose
ex_v:   jsr skip
        lda derr
        bne ex_bd
        lda orm0
        ora orm1
        ora orm2
        bne ex_sz
        lda crcl
        cmp HDR+23
        bne ex_cr
        lda crch
        cmp HDR+24
        bne ex_cr
        jsr putsi
        .byte 'OK',EOL,0
        rts
ex_cr:  jsr putsi
        .byte 'CRC ERROR',EOL,0
        rts
ex_sz:  jsr putsi
        .byte 'SHORT DATA',EOL,0
        rts
ex_bd:  jsr putsi
        .byte 'BAD DATA',EOL,0
        rts

; ---- method 4: squeezed (Huffman) ----
unsqz:  jsr getbyte
        jcs sq_x
        sta ndl
        jsr getbyte
        jcs sq_x
        sta ndh
        lda ndh
        cmp #2
        jcs sq_bad
        cmp #1
        bne sq_n
        lda ndl
        cmp #2
        jcs sq_bad
sq_n:   lda ndl
        ora ndh
        jeq sq_x
        lda ndl
        sta cntl
        lda ndh
        sta cnth
        asl cntl
        rol cnth
        asl cntl
        rol cnth
        lda #<TREE
        sta T0
        lda #>TREE
        sta T0+1
sq_r:   jsr getbyte
        jcs sq_x
        ldy #0
        sta (T0),y
        inc T0
        bne sq_i
        inc T0+1
sq_i:   lda cntl
        bne sq_dl
        dec cnth
sq_dl:  dec cntl
        lda cntl
        ora cnth
        bne sq_r
        lda #0
        sta ndl
        sta ndh
sq_l:   jsr getbit
        jcs sq_x
        sta bitv
        lda ndl
        sta T0
        lda ndh
        sta T0+1
        asl T0
        rol T0+1
        asl T0
        rol T0+1
        lda bitv
        beq sq_a
        clc
        lda T0
        adc #2
        sta T0
        bcc sq_a
        inc T0+1
sq_a:   clc
        lda T0+1
        adc #>TREE
        sta T0+1
        ldy #0
        lda (T0),y
        sta vl
        iny
        lda (T0),y
        sta vh
        bmi sq_leaf
        lda vl
        sta ndl
        lda vh
        sta ndh
        jmp sq_l
sq_leaf:
        lda vh
        eor #$FF
        jne sq_x
        lda vl
        eor #$FF
        jsr rle_in
        lda #0
        sta ndl
        sta ndh
        jmp sq_l
sq_bad: lda #1
        sta derr
sq_x:   rts

; ---- method 8: dynamic LZW, nomarch style (the stream is grouped in 8 codes; 256 only drops the width) ----
; read a code of A bits into CDL/CDH. Carry set at the end of the data or on a code that is out of range.
readcode:
        sta rcn
        lda #16
        sec
        sbc rcn
        sta rcs
        lda #0
        sta CDL
        sta CDH
rc_l:   jsr getbit
        bcs rc_e
        lsr
        ror CDH
        ror CDL
        dec rcn
        bne rc_l
        ldx rcs
rc_s:   lsr CDH
        ror CDL
        dex
        bne rc_s
        lda CDH
        cmp maxh
        bcs rc_e
        lda ofs
        clc
        adc #1
        and #7
        sta ofs
        clc
        rts
rc_e:   sec
        rts

resync: sta rsn
rs_l:   lda ofs
        beq rs_d
        lda rsn
        jsr readcode
        bcc rs_l
rs_d:   rts

; Z set when the table is full (last = maxstr-1)
atmax:  lda LSTL
        cmp #$FF
        bne am_r
        lda LSTH
        sec
        sbc maxh
        cmp #$FF
am_r:   rts

; put the string for code EL/EH on the output; kk = its first character
emit:   lda #<STK
        sta SP
        lda #>STK
        sta SP+1
em_1:   lda EH
        beq em_root
        clc
        adc #>SUF
        sta T0+1
        lda EL
        sta T0
        ldy #0
        lda (T0),y
        sta (SP),y
        inc SP
        bne em_o
        inc SP+1
em_o:   lda SP+1
        cmp #STKEND
        bcs em_bad
        lda EH
        clc
        adc #>PREH
        sta T0+1
        lda (T0),y
        pha
        lda EH
        clc
        adc #>PREL
        sta T0+1
        lda (T0),y
        sta EL
        pla
        sta EH
        jmp em_1
em_root:
        lda EL
        sta kk
        jsr rle_in
em_pop: lda SP
        cmp #<STK
        bne em_d
        lda SP+1
        cmp #>STK
        beq em_r
em_d:   lda SP
        bne em_e
        dec SP+1
em_e:   dec SP
        ldy #0
        lda (SP),y
        jsr rle_in
        jmp em_pop
em_r:   rts
em_bad: lda #1
        sta derr
        lda #<STK
        sta SP
        lda #>STK
        sta SP+1
        rts

lzw:    jsr getbyte
        jcs lz_x
        sec
        sbc #8
        cmp #2
        jcc lz_bad
        cmp #5
        jcs lz_bad
        tax
        lda #1
lz_m:   asl
        dex
        bne lz_m
        sta maxh
        lda #$FF
        sta LSTL
        lda #0
        sta LSTH
        sta ofs
        sta OLDL
        sta OLDH
        lda #9
        sta csz
        lda #1
        sta fst
lz_l:   lda csz
        jsr readcode
        jcs lz_x
        lda fst
        beq lz_n1
        lda CDL
        sta kk
        lda #0
        sta fst
lz_n1:  lda CDH
        cmp #1
        bne lz_nc
        lda CDL
        bne lz_nc
        lda #$FF
        sta LSTL
        lda #0
        sta LSTH
        lda csz
        jsr resync
        lda #9
        sta csz
        jsr readcode
        jcs lz_x
lz_nc:  lda LSTL
        cmp CDL
        lda LSTH
        sbc CDH
        bcc lz_old
        lda CDL
        sta EL
        lda CDH
        sta EH
        jsr emit
        jmp lz_ad
lz_old: lda OLDL
        sta EL
        lda OLDH
        sta EH
        jsr emit
        lda kk
        jsr rle_in
lz_ad:  lda derr
        bne lz_x
        jsr atmax
        beq lz_cp
        inc LSTL
        bne lz_a1
        inc LSTH
lz_a1:  lda LSTH
        cmp maxh
        bne lz_st
        lda #$FF
        sta LSTL
        dec LSTH
        jmp lz_cp
lz_st:  lda LSTL
        sta T0
        lda LSTH
        clc
        adc #>SUF
        sta T0+1
        ldy #0
        lda kk
        sta (T0),y
        lda LSTH
        clc
        adc #>PREL
        sta T0+1
        lda OLDL
        sta (T0),y
        lda LSTH
        clc
        adc #>PREH
        sta T0+1
        lda OLDH
        sta (T0),y
        jsr atmax
        beq lz_cp
        ldx csz
        lda LSTL
        cmp #$FF
        bne lz_cp
        lda LSTH
        cmp cszt-9,x
        bne lz_cp
        lda CDL
        sta OLDL
        lda CDH
        sta OLDH
        inc csz
        lda csz
        sec
        sbc #1
        jsr resync
        jmp lz_l
lz_cp:  lda CDL
        sta OLDL
        lda CDH
        sta OLDH
        jmp lz_l
lz_bad: lda #1
        sta derr
lz_x:   rts
cszt:   .byte 1,3,7,15

        run start
