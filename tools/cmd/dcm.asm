; dcm.asm - DCM.COM, a stand-alone DiskComm (.DCM) to ATR converter for any Atari DOS.
; Streams the archive front to back (no seeking, one 256 byte sector buffer), so it works on a stock 48K machine.
; The coding follows the DiskComm format as implemented by atari800 (compfile.c) and web/js/diskconv.js:
;   header $F9 (or $FA for the later parts) + flags (low 5 bits = pass number, bits 5-6 = density, bit 7 = last part)
;   then groups "sector number (word), type byte" where type bit 7 = more sectors follow in this group and the
;   low 7 bits give the coding: $41 changed bytes (descending), $42 five bytes + a repeated byte, $43 run list,
;   $44 tail, $46 unchanged, $47 whole sector; $45 ends a pass. Every sector is a change against the previous one.
; Density: 0 = 720 x 128, 1 = 720 x 256, 2 = 1040 x 128. The output is a normal ATR (sectors 1-3 always 128 bytes).
; Multi-part archives must be joined in order first (COPY /A or the host side). Sectors that DCM never mentions are zero.
; At the DCM> prompt: X file.DCM [dest.ATR]   (blank line = exit). Without a destination the extension becomes .ATR.
        icl 'lib\sys.asm'

INBUF   = $5000
OUTBUF  = $5100
DBUF    = $5200         ; the current sector (256 bytes)
VARS    = $5300
DEST    = $5340         ; destination spec (EOL ended)

ipos    = VARS+0
ilen    = VARS+1
opos    = VARS+2
ssz     = VARS+3        ; 0 = 128 byte sectors, 1 = 256
tsl     = VARS+4        ; total sectors
tsh     = VARS+5
secl    = VARS+6        ; sectors written so far
sech    = VARS+7
pf      = VARS+8        ; flags of the part being read
typ     = VARS+9        ; $F9 / $FA header byte
fl0     = VARS+10       ; flags of the first part
st      = VARS+11
cil     = VARS+12
cih     = VARS+13
cjl     = VARS+14
cjh     = VARS+15
nol     = VARS+16
noh     = VARS+17
psp     = VARS+18
vb      = VARS+19
ob      = VARS+20
tl      = VARS+21
th      = VARS+22
ec      = VARS+23       ; sector length while emitting (0 = 256)
ei      = VARS+24
AH      = VARS+32       ; ATR header (16 bytes)

        org CODE
        icl 'lib\io.asm'
        icl 'lib\hand.asm'

start:  jsr putsi
        .byte 'DCM 0.1  DISKCOMM TO ATR',EOL
        .byte 'X FILE.DCM [DEST.ATR]',EOL
        .byte 'BLANK LINE EXITS',EOL,0
prompt: tsx
        stx psp
        jsr putnl
        jsr putsi
        .byte 'DCM>',0
        jsr getlineh
        lda #<LINE
        sta ARG
        lda #>LINE
        sta ARG+1
        jsr nexttok
        jeq bye
        lda TOK
        jsr toupper
        cmp #'X'
        beq pm
        jsr putsi
        .byte 'USE X FOLLOWED BY THE DCM FILE',EOL,0
        jmp prompt
pm:     jsr nexttok
        beq pm_u
        jsr cpspec
        jsr nexttok
        beq pm_d
        jsr cpdest
        jmp pm_o
pm_u:   jsr putsi
        .byte 'NAME THE DCM FILE',EOL,0
        jmp prompt
pm_d:   jsr derive
pm_o:   lda #4
        ldx #$20
        jsr fopen1
        bpl pm_ok
        jsr putsi
        .byte 'CANNOT OPEN THE DCM FILE',EOL,0
        jmp prompt
pm_ok:  ldy #0
pm_c:   lda DEST,y
        sta FSPEC2,y
        iny
        cmp #EOL
        bne pm_c
        lda #8
        ldx #$30
        jsr fopen2
        bpl pm_w
        ldx #$20
        jsr fclose
        jsr putsi
        .byte 'CANNOT CREATE THE ATR FILE',EOL,0
        jmp prompt
pm_w:   jsr convert
        jsr flush
        ldx #$20
        jsr fclose
        ldx #$30
        jsr fclose
        lda secl
        sta N0
        lda sech
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' SECTORS WRITTEN',EOL,0
        jmp prompt

bye:    ldx #$20
        jsr fclose
        ldx #$30
        jsr fclose
        jmp (DOSVEC)

abort:  ldx #$30
        jsr fclose
        ldx #$20
        jsr fclose
        ldx psp
        txs
        jmp prompt
ferr_eof:
        jsr putsi
        .byte EOL,'UNEXPECTED END OF DCM DATA',EOL,0
        jmp abort
ferr_data:
        jsr putsi
        .byte EOL,'BAD DCM DATA',EOL,0
        jmp abort
ferr_sig:
        jsr putsi
        .byte EOL,'NOT A DCM FILE (MULTI-PART FILES START AT PASS 1)',EOL,0
        jmp abort
ferr_part:
        jsr putsi
        .byte EOL,'MULTI-PART ARCHIVE IS INCOMPLETE',EOL,0
        jmp abort

; TOK (upper cased) -> FSPEC, with D: in front when no device is named
cpspec: ldx #0
cs_l:   lda TOK,x
        beq cs_n
        cmp #':'
        beq cs_y
        inx
        bne cs_l
cs_n:   lda #'D'
        sta FSPEC
        lda #':'
        sta FSPEC+1
        ldy #2
        bne cs_c
cs_y:   ldy #0
cs_c:   ldx #0
cs_m:   lda TOK,x
        beq cs_e
        jsr toupper
        sta FSPEC,y
        inx
        iny
        bne cs_m
cs_e:   lda #EOL
        sta FSPEC,y
        rts

; TOK -> DEST in the same way
cpdest: ldx #0
cd_l:   lda TOK,x
        beq cd_n
        cmp #':'
        beq cd_y
        inx
        bne cd_l
cd_n:   lda #'D'
        sta DEST
        lda #':'
        sta DEST+1
        ldy #2
        bne cd_c
cd_y:   ldy #0
cd_c:   ldx #0
cd_m:   lda TOK,x
        beq cd_e
        jsr toupper
        sta DEST,y
        inx
        iny
        bne cd_m
cd_e:   lda #EOL
        sta DEST,y
        rts

; DEST = FSPEC with the extension replaced by .ATR (th = position after the last dot of the file name)
derive: ldy #0
        sty th
dv_l:   lda FSPEC,y
        sta DEST,y
        cmp #EOL
        beq dv_e
        cmp #'.'
        bne dv_o
        iny
        sty th
        dey
        jmp dv_n
dv_o:   cmp #':'
        beq dv_r
        cmp #'>'
        beq dv_r
        cmp #'\'
        bne dv_n
dv_r:   lda #0
        sta th
dv_n:   iny
        bne dv_l
dv_e:   lda th
        beq dv_a
        ldy th
        dey
dv_a:   ldx #0
dv_w:   lda atrx,x
        sta DEST,y
        iny
        inx
        cmp #EOL
        bne dv_w
        rts
atrx:   .byte '.ATR',EOL

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

getbyt: jsr getbyte
        jcs ferr_eof
        rts

; ---- output (IOCB 3), 256 byte buffer ----
outb:   ldx opos
        sta OUTBUF,x
        inx
        stx opos
        bne ob_r
        lda #0
        ldx #1
        jsr wrout
ob_r:   rts

flush:  lda opos
        beq fh_r
        ldx #0
        jsr wrout
fh_r:   rts

; write A/X bytes of OUTBUF
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
        .byte EOL,'WRITE ERROR (DISK FULL?)',EOL,0
        jmp abort

; ---- sector emit ----
; A = 128 for a 128 byte sector, 0 for 256. Sectors 1-3 of an ATR are always 128 bytes.
seclen: lda ssz
        beq sl_s
        lda sech
        bne sl_l
        lda secl
        cmp #3
        bcs sl_l
sl_s:   lda #128
        rts
sl_l:   lda #0
        rts

emitb:  jsr seclen
        sta ec
        lda #0
        sta ei
eb_l:   ldx ei
        lda DBUF,x
        jsr outb
        inc ei
        lda ei
        cmp ec
        bne eb_l
        jmp eb_n

emitz:  jsr seclen
        sta ec
        lda #0
        sta ei
ez_l:   lda #0
        jsr outb
        inc ei
        lda ei
        cmp ec
        bne ez_l
eb_n:   inc secl
        bne eb_r
        inc sech
eb_r:   rts

; carry set when tl/th >= the sector size
ssge:   lda th
        bne sg_y
        lda ssz
        bne sg_n
        lda tl
        cmp #128
        rts
sg_y:   sec
        rts
sg_n:   clc
        rts

; cj = the sector size
setss:  lda ssz
        bne ss_b
        lda #128
        sta cjl
        lda #0
        sta cjh
        rts
ss_b:   lda #0
        sta cjl
        lda #1
        sta cjh
        rts

; copy stream bytes into DBUF[ci..cj), leaves ci = cj
rdcopy: lda cil
        cmp cjl
        bne rc_g
        lda cih
        cmp cjh
        beq rc_d
rc_g:   jsr getbyt
        ldx cil
        sta DBUF,x
        inc cil
        bne rc_l
        inc cih
rc_l:   jmp rdcopy
rc_d:   rts

; fill DBUF[cj..ci) with vb, leaves cj = ci
rdfill: lda cjl
        cmp cil
        bne rf_g
        lda cjh
        cmp cih
        beq rf_d
rf_g:   lda vb
        ldx cjl
        sta DBUF,x
        inc cjl
        bne rf_l
        inc cjh
rf_l:   jmp rdfill
rf_d:   rts

; ---- the converter ----
convert:
        lda #0
        sta opos
        sta secl
        sta sech
        sta ipos
        sta ilen
        tax
cv_z:   sta DBUF,x
        inx
        bne cv_z
        jsr getbyt
        sta typ
        cmp #$F9
        beq cv_t
        cmp #$FA
        jne ferr_sig
cv_t:   jsr getbyt
        sta fl0
        sta pf
        and #$1F
        cmp #1
        jne ferr_sig
        lda fl0
        lsr
        lsr
        lsr
        lsr
        lsr
        and #3
        cmp #3
        jcs ferr_data
        tax
        lda dsz,x
        sta ssz
        lda dtl,x
        sta tsl
        lda dth,x
        sta tsh
        ldy #15
        lda #0
cv_h:   sta AH,y
        dey
        bpl cv_h
        lda #$96
        sta AH
        lda #$02
        sta AH+1
        lda dpl,x
        sta AH+2
        lda dph,x
        sta AH+3
        lda ssz
        beq cv_s1
        lda #0
        sta AH+4
        lda #1
        sta AH+5
        bne cv_ho
cv_s1:  lda #128
        sta AH+4
cv_ho:  ldy #0
cv_hw:  sty ei
        lda AH,y
        jsr outb
        ldy ei
        iny
        cpy #16
        bcc cv_hw
cv_p:   jsr pass
        lda pf
        bmi cv_f
        jsr getbyt
        cmp #$F9
        beq cv_n
        cmp #$FA
        jne ferr_part
cv_n:   jsr getbyt
        sta pf
        eor fl0
        and #$60
        jne ferr_data
        jmp cv_p
cv_f:   lda secl
        cmp tsl
        bne cv_pz
        lda sech
        cmp tsh
        beq cv_d
cv_pz:  jsr emitz
        jmp cv_f
cv_d:   rts

dsz:    .byte 0,1,0
dtl:    .byte <720,<720,<1040
dth:    .byte >720,>720,>1040
dpl:    .byte $80,$E8,$80       ; ATR size in paragraphs: 720*8, 720*16-24, 1040*8
dph:    .byte $16,$2C,$20

; one pass: groups of (sector number, coding byte [, more])
pass:   jsr getbyt
        sta nol
        jsr getbyt
        sta noh
        jsr getbyt
        sta st
        cmp #$45
        jeq ps_r
ps_c:   lda secl
        clc
        adc #1
        sta tl
        lda sech
        adc #0
        sta th
        lda noh
        cmp th
        jcc ferr_data
        bne ps_p
        lda nol
        cmp tl
        jcc ferr_data
        beq ps_i
ps_p:   jsr emitz
        jmp ps_c
ps_i:   lda st
        and #$7F
        cmp #$41
        bne ps_2
        jsr h41
        jmp ps_e
ps_2:   cmp #$42
        bne ps_3
        jsr h42
        jmp ps_e
ps_3:   cmp #$43
        bne ps_4
        jsr h43
        jmp ps_e
ps_4:   cmp #$44
        bne ps_5
        jsr h44
        jmp ps_e
ps_5:   cmp #$46
        beq ps_e
        cmp #$47
        jne ferr_data
        lda #0
        sta cil
        sta cih
        jsr setss
        jsr rdcopy
ps_e:   jsr emitb
        lda st
        jpl pass
        jsr getbyt
        sta st
        cmp #$45
        bne ps_i
ps_r:   rts

; $41: n, then n+1 bytes stored at buf[n], buf[n-1] ... buf[0]
h41:    jsr getbyt
        sta cil
h41l:   jsr getbyt
        ldx cil
        sta DBUF,x
        lda cil
        beq h41d
        dec cil
        jmp h41l
h41d:   rts

; $42: five bytes for buf[123..127], the rest of the sector is that first byte repeated
h42:    ldx #123
h42l:   stx tl
        jsr getbyt
        ldx tl
        sta DBUF,x
        inx
        cpx #128
        bcc h42l
        lda DBUF+123
        ldx #122
h42f:   sta DBUF,x
        dex
        bpl h42f
        rts

; $43: alternating raw runs and repeated-byte runs, each given by its end offset (0 = 256)
h43:    lda #0
        sta cil
        sta cih
h43l:   jsr getbyt
        sta cjl
        lda #0
        sta cjh
        lda cjl
        cmp cil
        bcs h43a
        lda cjl
        jne ferr_data
        lda #1
        sta cjh
h43a:   jsr rdcopy
        lda cjl
        sta tl
        lda cjh
        sta th
        jsr ssge
        bcs h43d
        jsr getbyt
        sta cil
        lda #0
        sta cih
        lda cil
        cmp cjl
        bcs h43b
        lda cil
        jne ferr_data
        lda #1
        sta cih
h43b:   jsr getbyt
        sta vb
        jsr rdfill
        lda cil
        sta tl
        lda cih
        sta th
        jsr ssge
        jcc h43l
h43d:   rts

; $44: n, then the sector bytes from offset n to the end
h44:    jsr getbyt
        sta cil
        sta tl
        lda #0
        sta cih
        sta th
        jsr ssge
        jcs ferr_data
        jsr setss
        jmp rdcopy

        run start

