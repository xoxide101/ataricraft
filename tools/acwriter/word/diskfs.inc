; D: device handler for the self-booting ACWriter disk. A small Atari DOS 2 compatible file system (single
; density, 128 byte sectors): VTOC at sector 360, directory at 361..368, data sectors with the usual 3 byte
; link (125 data bytes, file number + next sector, byte count). One file open at a time, read (4) or write (8);
; writing an existing name replaces it. The disk is laid out by scripts/build-acwriter-atr.cjs.
; It is installed by ddinit only when no D: handler exists (so under a real DOS, DOS keeps D:).
DDB  = $0400                   ; data sector buffer (cassette buffer)
DDEVIC = $0300
DUNIT  = $0301
DCOMND = $0302
DSTATS = $0303
DBUFLO = $0304
DBUFHI = $0305
DTIMLO = $0306
DBYTLO = $0308
DBYTHI = $0309
DAUX1  = $030A
DAUX2  = $030B
SIOV   = $E459
HATABS = $031A
DDR  = $9F00                   ; directory sector buffer (shares LDB, only used inside one call)
DDV  = $9F80                   ; VTOC sector buffer, kept while a file is open for writing
ddz  = $BFA0                   ; state
ddmo = ddz                     ; open mode, 0 = closed
ddsc = ddz+1                   ; sector in the data buffer (2)
ddpo = ddz+3                   ; read / write position
ddct = ddz+4                   ; bytes in the sector being read
ddnx = ddz+5                   ; next sector (2)
ddtd = ddz+7                   ; directory sector (low byte) and offset of the file's entry
ddto = ddz+8
ddff = ddz+9                   ; 1 = name found
ddfs = ddz+10                  ; 1 = a free entry was seen
ddn4 = ddz+11                  ; file number << 2
ddst = ddz+12                  ; first sector of the file (2)
ddcn = ddz+14                  ; sectors written (2)
ddnw = ddz+16                  ; sector just allocated (2)
ddbc = ddz+18                  ; bytes written (3)
ddt1 = ddz+21
ddt2 = ddz+22
ddnm = ddz+24                  ; packed name, 8 + 3 letters

ddtab dta a(ddopn-1,ddcls-1,ddget-1,ddput-1,ddsta-1,ddsta-1)

ddsta ldy #$92
 rts

; SIO: A = command ($52 read, $57 write), X/Y = buffer, sector in ddsc
ddsio sta DCOMND
 stx DBUFLO
 sty DBUFHI
 ldx #$80
 cmp #$52
 bne dds1
 ldx #$40
dds1 stx DSTATS
 lda #$31
 sta DDEVIC
 lda #1
 sta DUNIT
 lda #$0F
 sta DTIMLO
 lda #128
 sta DBYTLO
 lda #0
 sta DBYTHI
 lda ddsc
 sta DAUX1
 lda ddsc+1
 sta DAUX2
 jsr SIOV
 tya
 rts

ddrdd lda #$52
 ldx #<DDB
 ldy #>DDB
 bne ddsio
ddwrd lda #$57
 ldx #<DDB
 ldy #>DDB
 bne ddsio
ddrdr lda #$52
 ldx #<DDR
 ldy #>DDR
 bne ddsio
ddwrr lda #$57
 ldx #<DDR
 ldy #>DDR
 bne ddsio
ddrdv lda #<360
 sta ddsc
 lda #>360
 sta ddsc+1
 lda #$52
 ldx #<DDV
 ldy #>DDV
 bne ddsio

; read the link bytes of the sector in the buffer
ddprs lda DDB+127
 sta ddct
 lda DDB+126
 sta ddnx
 lda DDB+125
 and #3
 sta ddnx+1
 rts

; the name after "D1:" in the IOCB's file name, as 8 + 3 letters
ddpack ldx #10
 lda #' '
ddp0 sta ddnm,x
 dex
 bpl ddp0
 ldy #0
ddp1 lda (stp),y
 iny
 cmp #':'
 bne ddp1
 ldx #0
ddp2 lda (stp),y
 cmp #$9B
 beq ddp9
 iny
 cmp #'.'
 bne ddp3
 ldx #8
 bne ddp2
ddp3 sta ddnm,x
 inx
 cpx #11
 bcc ddp2
ddp9 rts

; search the directory: ddff = 1 when the name exists, ddtd/ddto = its entry, else the first free entry (ddfs)
ddfind lda #<361
 sta ddsc
 lda #>361
 sta ddsc+1
 lda #0
 sta ddff
 sta ddfs
ddf1 jsr ddrdr
 cpy #$80
 bcc ddf1a
 rts
ddf1a lda #<DDR
 sta stp
 lda #>DDR
 sta stp+1
ddf2 ldy #0
 lda (stp),y
 beq ddf8
 bmi ddf5
 ldx #10
ddf3 txa
 clc
 adc #5
 tay
 lda (stp),y
 cmp ddnm,x
 bne ddf6
 dex
 bpl ddf3
 lda #1
 sta ddff
 sta ddfs
 bne ddf7
ddf5 lda ddfs
 bne ddf6
ddf7 lda ddsc
 sta ddtd
 lda stp
 sta ddto
 lda ddff
 beq ddf4
 ldy #1
 rts
ddf4 lda #1
 sta ddfs
ddf6 lda stp
 clc
 adc #16
 sta stp
 cmp #$80
 bcc ddf2
 inc ddsc
 lda ddsc
 cmp #$71
 bne ddf1
 ldy #1
 rts
ddf8 lda ddfs
 bne ddf9
 jmp ddf7
ddf9 ldy #1
 rts

ddmk dta b($80),b($40),b($20),b($10),b($08),b($04),b($02),b($01)

; mark sector ddsc free in the VTOC
ddfre lda ddsc+1
 sta ddt2
 lda ddsc
 sta ddt1
 ldx #3
ddr1 lsr ddt2
 ror ddt1
 dex
 bne ddr1
 lda ddsc
 and #7
 tay
 ldx ddt1
 lda DDV+10,x
 ora ddmk,y
 sta DDV+10,x
 inc DDV+3
 bne ddr2
 inc DDV+4
ddr2 rts

; take the first free sector from the VTOC into ddnw
ddall ldx #0
dda1 lda DDV+10,x
 bne dda2
 inx
 cpx #90
 bcc dda1
 ldy #162
 rts
dda2 ldy #0
dda3 lda DDV+10,x
 and ddmk,y
 bne dda4
 iny
 bne dda3
dda4 lda DDV+10,x
 eor ddmk,y
 sta DDV+10,x
 stx ddnw
 lda #0
 sta ddnw+1
 ldx #3
dda5 asl ddnw
 rol ddnw+1
 dex
 bne dda5
 tya
 clc
 adc ddnw
 sta ddnw
 bcc dda6
 inc ddnw+1
dda6 lda DDV+3
 bne dda7
 dec DDV+4
dda7 dec DDV+3
 ldy #1
 rts

ddopn lda ICAX1,x
 sta ddmo
 lda ICBAL,x
 sta stp
 lda ICBAL+1,x
 sta stp+1
 jsr ddpack
 jsr ddfind
 cpy #$80
 bcs ddof
 lda ddmo
 and #8
 bne ddow
 lda ddff
 beq ddonf
 ldy #3
 lda (stp),y
 sta ddsc
 iny
 lda (stp),y
 sta ddsc+1
 jsr ddrdd
 cpy #$80
 bcs ddof
 jsr ddprs
 lda #0
 sta ddpo
 ldy #1
 rts
ddonf ldy #170
ddof lda #0
 sta ddmo
 tya
 rts
ddow lda ddfs
 bne ddow1
 ldy #169
 bne ddof
ddow1 jsr ddrdv
 cpy #$80
 bcs ddof
 lda ddff
 beq ddow3
 ldy #3
 lda (stp),y
 sta ddsc
 iny
 lda (stp),y
 sta ddsc+1
ddow2 lda ddsc
 ora ddsc+1
 beq ddow3
 jsr ddfre
 jsr ddrdd
 cpy #$80
 bcs ddof
 jsr ddprs
 lda ddnx
 sta ddsc
 lda ddnx+1
 sta ddsc+1
 jmp ddow2
ddow3 jsr ddall
 cpy #$80
 bcs ddof
 lda ddnw
 sta ddst
 sta ddsc
 lda ddnw+1
 sta ddst+1
 sta ddsc+1
 lda ddtd
 sec
 sbc #$69
 asl
 asl
 asl
 asl
 asl
 sta ddt1
 lda ddto
 lsr
 lsr
 clc
 adc ddt1
 sta ddn4
 lda #1
 sta ddcn
 lda #0
 sta ddcn+1
 sta ddpo
 sta ddbc
 sta ddbc+1
 sta ddbc+2
 ldy #1
 rts

ddget ldy ddpo
 cpy ddct
 bcc ddg2
 lda ddnx
 ora ddnx+1
 beq ddgeof
 lda ddnx
 sta ddsc
 lda ddnx+1
 sta ddsc+1
 jsr ddrdd
 cpy #$80
 bcs ddxe
 jsr ddprs
 lda #0
 sta ddpo
 beq ddget
ddg2 lda DDB,y
 inc ddpo
 ldy #1
 rts
ddgeof ldy #136
 rts
ddxe tya
 rts

ddput sta ddt2
 ldy ddpo
 cpy #125
 bcc ddp5
 jsr ddall
 cpy #$80
 bcs ddxe
 lda ddnw+1
 ora ddn4
 sta DDB+125
 lda ddnw
 sta DDB+126
 lda #125
 sta DDB+127
 jsr ddwrd
 cpy #$80
 bcs ddxe
 lda ddnw
 sta ddsc
 lda ddnw+1
 sta ddsc+1
 inc ddcn
 bne ddp4
 inc ddcn+1
ddp4 ldy #0
 sty ddpo
ddp5 lda ddt2
 sta DDB,y
 inc ddpo
 inc ddbc
 bne ddp6
 inc ddbc+1
 bne ddp6
 inc ddbc+2
ddp6 ldy #1
 rts

; close: write the last sector, the directory entry and the VTOC
ddcls lda ddmo
 and #8
 bne ddcw
 ldy #1
 rts
ddcw lda #0
 sta ddmo
 lda ddn4
 sta DDB+125
 lda #0
 sta DDB+126
 lda ddpo
 sta DDB+127
 jsr ddwrd
 cpy #$80
 bcs ddxc
 lda ddtd
 sta ddsc
 lda #1
 sta ddsc+1
 jsr ddrdr
 cpy #$80
 bcs ddxc
 lda ddto
 sta stp
 lda #>DDR
 sta stp+1
 ldy #0
 lda #$42
 sta (stp),y
 iny
 lda ddcn
 sta (stp),y
 iny
 lda ddcn+1
 sta (stp),y
 iny
 lda ddst
 sta (stp),y
 iny
 lda ddst+1
 sta (stp),y
 ldx #0
ddc1 iny
 lda ddnm,x
 sta (stp),y
 inx
 cpx #11
 bne ddc1
 jsr ddwrr
 cpy #$80
 bcs ddxc
 lda #<360
 sta ddsc
 lda #>360
 sta ddsc+1
 lda #$57
 ldx #<DDV
 ldy #>DDV
 jsr ddsio
 cpy #$80
 bcs ddxc
ddc9 ldy #1
 rts
ddxc tya
 rts

; startup: install D: unless a D: handler (a real DOS) is already there
ddsu = *
 org SUA3
ddinit ldx #0
 stx ddmo
 ldy #$FF
ddi1 lda HATABS,x
 cmp #'D'
 beq ddi9
 cmp #0
 bne ddi2
 tya
 bpl ddi2
 txa
 tay
ddi2 inx
 inx
 inx
 cpx #$24
 bcc ddi1
 tya
 bmi ddi9
 tax
 lda #'D'
 sta HATABS,x
 lda #<ddtab
 sta HATABS+1,x
 lda #>ddtab
 sta HATABS+2,x
ddi9 rts
 org ddsu
