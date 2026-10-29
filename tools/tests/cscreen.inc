; cscreen.inc - colour status screen for the test programs (needs common.inc first).
; A custom display list with a DLI before every row recolours each text row (bars) and can show a block map
; (ANTIC mode 7, 20 cells per row, colour set per cell). Define NA (text rows above the map), NMAP (map rows,
; 0 = none) and NB (text rows below) before including. Text row y maps to buffer row y; use `loc x,y`.
TXTBUF  = $3000
MAPBUF  = $3300
DLIST   = $3400
FONT    = $3800
SDLSTL  = $0230
VDSLST  = $0200
VVBLKD  = $0224
CHBAS   = $02F4
COLOR0  = $02C4
COLPF1  = $D017
COLPF2  = $D018
CHBASE  = $D409
NROWS   = NA+NMAP+NB
NDLI    = NROWS+1

dlr     = $B7
d1      = $B8
d2      = $B9

        .macro loc
        ldx #:1
        ldy #:2
        jsr locate
        .endm
        .macro say
        lda #<:1
        ldy #>:1
        jsr puts
        .endm

; colour schemes: 0 plain, 1 title (blue), 2 good (green), 3 working (yellow), 4 bad (red)
sc1     .byte $0E,$0E,$0E,$02,$0E
sc2     .byte $00,$94,$C4,$1C,$44

gs_init lda SDLSTL
        sta osdl
        lda SDLSTL+1
        sta osdl+1
        lda VDSLST
        sta osvd
        lda VDSLST+1
        sta osvd+1
        ldx #4
gi0     lda COLOR0,x
        sta oscol,x
        dex
        bpl gi0
        ldx #0
gi1     lda $E000,x
        sta FONT,x
        lda $E100,x
        sta FONT+$100,x
        inx
        bne gi1
        ldx #7
gi2     lda blk,x
        sta FONT+8,x
        dex
        bpl gi2
        lda #0
        tax
gi3     sta TXTBUF,x
        sta TXTBUF+$100,x
        sta TXTBUF+$200,x
        sta MAPBUF,x
        inx
        bne gi3
        ; display list
        ldy #0
        lda #$70
        sta DLIST,y
        iny
        lda #$F0
        sta DLIST,y
        iny
        lda #$C2
        sta DLIST,y
        iny
        lda #<TXTBUF
        sta DLIST,y
        iny
        lda #>TXTBUF
        sta DLIST,y
        iny
        ldx #NA-1
        lda #$82
        jsr dlrep
        .if NMAP>0
        lda #$C7
        sta DLIST,y
        iny
        lda #<MAPBUF
        sta DLIST,y
        iny
        lda #>MAPBUF
        sta DLIST,y
        iny
        ldx #NMAP-1
        lda #$87
        jsr dlrep
        .endif
        .if NB>0
        lda #$C2
        sta DLIST,y
        iny
        lda #<(TXTBUF+NA*40)
        sta DLIST,y
        iny
        lda #>(TXTBUF+NA*40)
        sta DLIST,y
        iny
        ldx #NB-1
        lda #$82
        jsr dlrep
        .endif
        lda #$41
        sta DLIST,y
        iny
        lda #<DLIST
        sta DLIST,y
        iny
        lda #>DLIST
        sta DLIST,y
        ; per-row colour tables
        ldx #NDLI-1
gi4     lda #$0E
        sta tc1,x
        lda #$00
        sta tc2,x
        lda #$E0
        sta tch,x
        dex
        bpl gi4
        .if NMAP>0
        ldx #NA
gi5     lda #$08
        sta tc1,x
        lda #$44
        sta tc2,x
        lda #$38
        sta tch,x
        inx
        cpx #NA+NMAP
        bne gi5
        .endif
        lda #$1E
        sta COLOR0
        lda #$CA
        sta COLOR0+3
        lda #0
        sta COLOR0+4
        lda #0
        sta dlr
        lda VVBLKD
        sta osvb
        lda VVBLKD+1
        sta osvb+1
        lda #<vbi
        sta VVBLKD
        lda #>vbi
        sta VVBLKD+1
        lda #<dli
        sta VDSLST
        lda #>dli
        sta VDSLST+1
        lda #<DLIST
        sta SDLSTL
        lda #>DLIST
        sta SDLSTL+1
        lda #<TXTBUF
        sta sbase
        lda #>TXTBUF
        sta sbase+1
        jsr vsync
        lda #$C0
        sta NMIEN
        rts

vbi     lda #0
        sta dlr
        jmp $E462

dlrep   cpx #0
        beq dlr9
dlr1    sta DLIST,y
        iny
        dex
        bne dlr1
dlr9    rts

dli     pha
        txa
        pha
        tya
        pha
        ldx dlr
        lda tc1,x
        sta d1
        lda tc2,x
        sta d2
        lda tch,x
        tay
        ldx d1
        lda d2
        sta WSYNC
        stx COLPF1
        sta COLPF2
        sty CHBASE
        inc dlr
        lda dlr
        cmp #NDLI
        bcc dli1
        lda #0
        sta dlr
dli1    pla
        tay
        pla
        tax
        pla
        rti

gs_off  lda #$40
        sta NMIEN
        lda osvb
        sta VVBLKD
        lda osvb+1
        sta VVBLKD+1
        lda osvd
        sta VDSLST
        lda osvd+1
        sta VDSLST+1
        lda osdl
        sta SDLSTL
        lda osdl+1
        sta SDLSTL+1
        ldx #4
go1     lda oscol,x
        sta COLOR0,x
        dex
        bpl go1
        lda #$E0
        sta CHBAS
        lda #0
        sta sbase
        sta sbase+1
        jsr vsync
        jsr vsync
        lda #$7D
        jmp eput

; X = text row, A = scheme
bar     pha
        txa
        cmp #NA
        bcc bar1
        clc
        adc #NMAP
bar1    tax
        pla
        tay
        lda sc1,y
        sta tc1,x
        lda sc2,y
        sta tc2,x
        rts

; X = cell 0..79, A = state: 0 yellow (testing), 1 grey (idle), 2 red (bad), 3 green (good)
mapset  asl
        asl
        asl
        asl
        asl
        asl
        ora #1
        sta MAPBUF,x
        rts

; X = text row: blank it
clrrow  txa
        tay
        ldx #0
        jsr locate
        lda #0
        ldy #39
clr1    sta (sp),y
        dey
        bpl clr1
        rts

blk     .byte $00,$7E,$7E,$7E,$7E,$7E,$7E,$00
osdl    .word 0
osvd    .word 0
osvb    .word 0
oscol   .ds 5
tc1     .ds NDLI
tc2     .ds NDLI
tch     .ds NDLI

; A = 0 PASS, 1 FAIL, 2 n/a, 3 skipped ; X = text row. Writes the label at column 33 and colours the row.
setres  sta r_v
        stx r_row
        ldy r_row
        ldx #33
        jsr locate
        ldx r_v
        lda rtl,x
        ldy rth,x
        jsr puts
        ldx r_v
        lda rsch,x
        ldx r_row
        jmp bar
rtl     .byte <rs_pass,<rs_fail,<rs_na,<rs_skip
rth     .byte >rs_pass,>rs_fail,>rs_na,>rs_skip
rsch    .byte 2,4,0,0
rs_pass .byte 'PASS',0
rs_fail .byte 'FAIL',0
rs_na   .byte 'n/a ',0
rs_skip .byte 'skip',0
r_v     .byte 0
r_row   .byte 0
