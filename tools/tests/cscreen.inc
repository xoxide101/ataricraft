; cscreen.inc - colour status screen for the test programs (needs common.inc first).
; A custom display list with a DLI before every row recolours each text row (bars) and can show a block map
; (ANTIC mode 7, 20 cells per row, colour set per cell). Define NA (text rows above the map), NMAP (map rows,
; 0 = none) and NB (text rows below) before including. Text row y maps to buffer row y; use `loc x,y`.
;
; SCREEN LAYOUT (display list at DLIST):
;   $70, $F0        16 blank scanlines; the $F0 one has the DLI bit, so DLI #0 colours row 0
;   $C2 + LMS       first text row (ANTIC mode 2 = GR.0 text, 40 columns), points at TXTBUF; DLI set
;   $82 x (NA-1)    remaining text rows above the map (mode 2 + DLI)
;   $C7 + LMS, $87  NMAP map rows (ANTIC mode 7 = 20 wide, 8 scanlines tall) from MAPBUF, if NMAP > 0
;   $C2 + LMS, $82  NB text rows below the map, continuing TXTBUF at row NA, if NB > 0
;   $41 + address   JVB: jump and wait for vertical blank back to DLIST
; Every row has a DLI (NDLI = NROWS+1 including the blank-line one). The DLI looks up per-row colours
; in tc1/tc2/tch by the counter dlr, writes them after WSYNC, and bumps dlr; the VBI zeroes dlr each
; frame so the sequence restarts. Per row: tc1 -> COLPF1 (text luminance / map colour 1), tc2 -> COLPF2
; (text background / map colour 2), tch -> CHBASE (character set page: $E0 ROM font, $38 = RAM FONT).
;
; MEMORY MAP (all RAM above the program at $2000): TXTBUF $3000 (up to 24 rows x 40 = $3C0 bytes, three
;   pages are cleared), MAPBUF $3300 (NMAP x 20 bytes), DLIST $3400, FONT $3800 (ROM chars 0-63 copied
;   from $E000, with char 1 replaced by a solid block used by the map; mode 7 uses a 64-char set).
;
; MAP CELL: byte = (state << 6) | 1. State picks the colour register in mode 7: 0 = COLPF0 (yellow,
;   COLOR0 = $1E), 1 = COLPF1 (grey), 2 = COLPF2 (red), 3 = COLPF3 (green, COLOR0+3 = $CA).
;
; API: gs_init (take over screen, call once), gs_off (restore OS screen and clear it), bar (row colour
;   scheme), mapset (set a map cell), clrrow (blank a text row), setres (PASS/FAIL label on a row),
;   macros `loc x,y` (position text cursor) and `say label` (print a zero-terminated string).
; The program must define NA, NMAP, NB before `icl`, and have `run`/`org` set up itself.
TXTBUF  = $3000
MAPBUF  = $3300
DLIST   = $3400
FONT    = $3800
; OS shadow/hardware registers used below: SDLSTL display list pointer, VDSLST DLI vector, VVBLKD
; deferred VBI vector, CHBAS charset page shadow, COLOR0.. colour shadows ($02C4 = COLPF0 .. $02C8 = COLBK),
; COLPF1/COLPF2/CHBASE ANTIC/GTIA hardware registers written directly by the DLI.
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

; dlr = current DLI row index; d1/d2 = DLI scratch for COLPF1/COLPF2 values.
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

; colour schemes (index into sc1/sc2): 0 plain, 1 title (blue), 2 good (green), 3 working (yellow), 4 bad (red)
; sc1 = text luminance (COLPF1), sc2 = background colour (COLPF2); $xy = hue x, luminance y.
sc1     .byte $0E,$0E,$0E,$02,$0E
sc2     .byte $00,$94,$C4,$1C,$44

; gs_init: take over the screen. Saves the OS display list, DLI vector, VBI vector and colours (for
; gs_off), copies the ROM font, clears the buffers, builds the display list and the per-row colour
; tables, hooks the deferred VBI and DLI, points sbase at TXTBUF, waits a frame and enables DLI+VBI
; ($C0 in NMIEN). Clobbers A, X, Y. Call once, with NMIs enabled normally ($40).
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
gi1     lda $E000,x     ; copy ROM chars 0-63 (2 pages = 64 chars) into the RAM font
        sta FONT,x
        lda $E100,x
        sta FONT+$100,x
        inx
        bne gi1
        ldx #7
gi2     lda blk,x       ; replace char 1 with a solid block (map cell glyph)
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
        ; display list (see header for the layout)
        ldy #0
        lda #$70        ; 8 blank lines
        sta DLIST,y
        iny
        lda #$F0        ; 8 blank lines + DLI
        sta DLIST,y
        iny
        lda #$C2        ; mode 2 + LMS + DLI
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
        lda #$C7        ; mode 7 + LMS + DLI
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
        lda #$41        ; JVB back to DLIST
        sta DLIST,y
        iny
        lda #<DLIST
        sta DLIST,y
        iny
        lda #>DLIST
        sta DLIST,y
        ; per-row colour tables: text rows white on black, ROM font
        ldx #NDLI-1
gi4     lda #$0E
        sta tc1,x
        lda #$00
        sta tc2,x
        lda #$E0        ; CHBASE page of the ROM font
        sta tch,x
        dex
        bpl gi4
        .if NMAP>0      ; map rows: grey (COLPF1), red (COLPF2), RAM font page $38 (= FONT $3800)
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
        lda #$1E        ; COLPF0 yellow = map state 0
        sta COLOR0
        lda #$CA        ; COLPF3 green = map state 3
        sta COLOR0+3
        lda #0          ; COLBK black
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

; vbi: deferred vertical-blank handler; restarts the DLI row counter, then exits via the OS (XITVBV $E462).
vbi     lda #0
        sta dlr
        jmp $E462

; dlrep: append X copies of display-list byte A at DLIST,Y (Y advances; X = 0 appends nothing).
dlrep   cpx #0
        beq dlr9
dlr1    sta DLIST,y
        iny
        dex
        bne dlr1
dlr9    rts

; dli: runs at the last scanline of each row that has the DLI bit; sets the colours for the NEXT row from
; tc1/tc2/tch[dlr]. Registers are saved/restored. WSYNC halts the CPU to the end of the line so the
; colour change happens in the horizontal blank (no visible tearing). dlr wraps at NDLI.
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

; gs_off: undo gs_init: NMIs back to VBI only ($40), restore the OS VBI/DLI vectors, display list pointer,
; colours and charset ($E0), switch text output back to the OS screen (sbase = 0), wait two frames for the
; OS list to take effect, then clear the screen via E:. Clobbers A, X, Y.
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

; bar: X = text row, A = colour scheme (0..4, see sc1/sc2). Sets that row's DLI colours. Rows at or below
; NA are shifted by NMAP to skip the map rows in the colour tables. Clobbers A, X, Y.
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

; mapset: X = cell 0..79, A = state: 0 yellow (testing), 1 grey (idle), 2 red (bad), 3 green (good).
; Stores (state << 6) | 1 into MAPBUF: top 2 bits = colour register, low bits = char 1 (solid block).
; Cell number is a flat index; with 20 cells per row, row = X / 20. Clobbers A.
mapset  asl
        asl
        asl
        asl
        asl
        asl
        ora #1
        sta MAPBUF,x
        rts

; clrrow: X = text row: blank it (40 bytes of screen code 0 via sp). Clobbers A, X, Y.
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

blk     .byte $00,$7E,$7E,$7E,$7E,$7E,$7E,$00   ; solid block glyph (char 1) for map cells
osdl    .word 0         ; saved OS display list pointer
osvd    .word 0         ; saved OS DLI vector
osvb    .word 0         ; saved OS deferred VBI vector
oscol   .ds 5           ; saved OS colour shadows COLOR0..COLOR4
tc1     .ds NDLI        ; per-row COLPF1 value
tc2     .ds NDLI        ; per-row COLPF2 value
tch     .ds NDLI        ; per-row CHBASE value

; setres: A = 0 PASS, 1 FAIL, 2 n/a, 3 skipped ; X = text row. Writes the label at column 33 and colours the row
; (green for PASS, red for FAIL, plain otherwise). Clobbers A, X, Y.
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
