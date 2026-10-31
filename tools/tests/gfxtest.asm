; GFXTEST.COM - steps through the OS graphics modes 0-15 (split screen with a text window), then a GR.8 1-bit
; hi-res mono test pattern and a mixed-ANTIC-mode screen (text modes 2/4/5/6/7 and bitmap modes 8-F in one display
; list). After each screen answer Y = ok, N = bad, S = skip, ESC = finish. A colour summary with PASS / FAIL follows.
;
; TESTS (index `mode`, ntest = 19): 0-15 = OS graphics GR.0-GR.15 (opened through S: on IOCB 6, each filled
;   with a stepping byte pattern); 16 = GR.8 mono bars (opened as GR.8); 17 = mixed ANTIC modes (custom
;   display list `mixdl`); 18 = fine-scroll page (HSCROL/VSCROL, any key = answer). This is a visual test:
;   the user judges the picture. Y (KBCODE $2B) = ok (0), N ($23) = bad (1), anything else (S) = skipped
;   (3); ESC ($1C) stops. Result codes are kept in `res`. PASS = at least one test ok and none bad.
;
; SCREENS: the test screens use the OS display lists (S: OPEN) except modes 17/18, which write their own
;   display list into SDLSTL/SDLSTH ($0230/$0231). The summary screen uses cscreen.inc (NA = 6 text rows,
;   NMAP = 1 map row of 19 cells = the 19 tests, NB = 3 text rows) with a DLI per row for colours and a
;   VBI hook that resets the DLI row counter. Map colours: green ok, red bad, grey skipped/untested.
;
; MEMORY: code/data from $2000, cscreen.inc buffers at $3000-$3800+. Test data: mixed screen bands at
;   $4000-$5A00 (one 256-byte-aligned page per band; pages are chosen by the `band` macro), scroll display
;   lists at $5C00 / $5D00, scroll status line at $5E00, scroll bitmap SCRBUF at $6000-$6FFF.
; ZERO PAGE: $8C mode, $8D/$8E cnt (fill count), $8F pat, $90/$91 ptr, $92/$93 fnl/fnh (byte count for fb),
;   $94 pv, $95 stp (pattern step), $96/$97 dp (display list pointer), plus common.inc/cscreen.inc.
;
; EXTENDING: increase ntest, give the new test a number, add a case in the dispatch at `next`, a label in
;   ltab/lbl (and mmap/szlo/szhi if it is an OS mode) and a text slot in the summary map.
        org $2000
NA      = 6
NMAP    = 1
NB      = 3
        jmp start
        icl 'common.inc'
        icl 'cscreen.inc'

IOCB6   = $60           ; IOCB 6 (offset $60) is used for the S: screen device
mode    = $8C           ; current test number 0..ntest-1
cnt     = $8D           ; 16-bit fill count
pat     = $8F           ; running fill pattern byte
ptr     = $90
fnl     = $92           ; byte count for fb (lo/hi)
fnh     = $93
pv      = $94           ; running pattern value in fb
stp     = $95           ; pattern step in fb (0 = constant fill with 0)
ntest   = 19            ; 16 OS modes + mono + mixed + scroll
dp      = $96           ; display list pointer (fine-scroll page)

; band count_lo,count_hi,page: fb-fill `count` bytes starting at page:$00 using the current stp.
        .macro band
        lda #:1
        sta fnl
        lda #:2
        sta fnh
        lda #:3
        jsr fb
        .endm

; start: mark every test "skipped" (res = 3), then loop over the tests: open the mode, draw it, wait for a
; key and record the answer. ESC ends early; after the last test the summary is shown.
start   ldx #ntest-1
        lda #3
st0     sta res,x
        dex
        bpl st0
        lda #0
        sta mode
next    jsr openmode
        lda mode
        cmp #16
        bcc nfill       ; 0-15: OS graphics modes
        beq nhires      ; 16: GR.8 mono pattern
        cmp #18
        beq nscrl       ; 18: scroll
        jsr mixed       ; 17: mixed ANTIC modes
        jmp nask
nscrl   jsr scroll      ; scroll waits for the key itself and returns it in A
        jmp nk
nhires  jsr hires
        jsr label
        jmp nask
nfill   jsr fill
        jsr label
nask    jsr getkey
nk      cmp #$1C        ; ESC
        beq done
        ldx #3          ; default answer: skipped
        cmp #$2B        ; Y key
        bne na1
        ldx #0          ; ok
        jmp na2
na1     cmp #$23        ; N key
        bne na2
        ldx #1          ; bad
na2     txa
        ldx mode
        sta res,x
        inc mode
        lda mode
        cmp #ntest
        bcc next
done    lda #0
        sta mode
        jsr openmode    ; reopen GR.0 so the OS screen is sane before the summary
        jmp summary

; openmode: close IOCB 6, then OPEN S: with graphics mode mmap[mode] (AUX2) and AUX1 = $1C (read/write
; plus option bits; appears to include a text window for modes > 0). Hides the cursor and sets colours:
; COLOR1 ($02C5) = $0F, COLOR2 ($02C6) = $94 (blue), COLOR4 border ($02C8) = $94. Clobbers A, X, Y.
openmode ldx #IOCB6
        lda #12         ; CIO CLOSE
        sta ICCOM,x
        jsr CIOV
        ldx #IOCB6
        lda #3          ; CIO OPEN
        sta ICCOM,x
        lda #<scr
        sta ICBAL,x
        lda #>scr
        sta ICBAL+1,x
        lda #$1C
        sta ICAX1,x
        ldy mode
        lda mmap,y
        sta ICAX2,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        lda #1
        sta CRSINH
        lda #$94
        sta $02C6       ; COLOR2
        lda #$0F
        sta $02C5       ; COLOR1
        lda #$94
        sta $02C8       ; COLOR4 (border)
        rts

; fill: fill the whole screen RAM of OS mode `mode` with an incrementing byte pattern (pat = 0,1,2,...)
; so every colour / luminance / character shows up. Count comes from szlo/szhi. In mode 0 the first 120
; bytes (3 text rows) are skipped so the label printed by `label` stays readable. Clobbers A, Y, sp, cnt, pat.
fill    ldx mode
        lda szlo,x
        sta cnt
        lda szhi,x
        sta cnt+1
        lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        lda mode
        bne f0
        lda sp
        clc
        adc #120
        sta sp
        bcc f00
        inc sp+1
f00     sec
        lda cnt
        sbc #120
        sta cnt
        lda cnt+1
        sbc #0
        sta cnt+1
f0      lda #0
        sta pat
        ldy #0
f1      lda pat
        sta (sp),y
        inc pat
        inc sp
        bne f2
        inc sp+1
f2      lda cnt
        bne f3
        dec cnt+1
f3      dec cnt
        lda cnt
        ora cnt+1
        bne f1
        rts

; hires: GR.8 1-bit hi-res: black and white only (COLOR2/COLOR4 = 0, COLOR1 = $0E). 8 bands of 20 lines:
; 1-pixel columns (two phases), 2-pixel columns, 4-pixel columns, 1-line stripes, checkerboard, half white /
; half black, a byte ramp. Pass/fail is judged by eye: edges must be sharp with no colour fringing.
; Loop: bnd = band, lin = line in band, y = byte column; g8byte returns the byte. Clobbers A, X, Y, sp.
hires   lda #0
        sta $02C6
        sta $02C8
        lda #$0E
        sta $02C5
        lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        lda #0
        sta bnd
g8b     lda #0
        sta lin
g8l     ldy #0
g8x     sty xc
        jsr g8byte
        ldy xc
        sta (sp),y
        iny
        cpy #40
        bne g8x
        clc
        lda sp
        adc #40
        sta sp
        bcc g8n
        inc sp+1
g8n     inc lin
        lda lin
        cmp #20
        bne g8l
        inc bnd
        lda bnd
        cmp #8
        bne g8b
        rts

; g8byte: in = bnd (band), lin (line), Y (byte column 0..39); out = A, the pattern byte for that spot.
; Bands 0-3: b8t = $AA / $55 (1-px columns, both phases), $CC (2-px), $F0 (4-px); band 4: $FF/$00 on
; alternate lines; band 5: $AA/$55 on alternate lines (checkerboard); band 6: left half $FF, right half
; $00; band 7: A = Y (a ramp of all bit patterns across the line).
g8byte  lda bnd
        cmp #4
        bcc gb0
        beq gb4
        cmp #6
        bcc gb5
        beq gb6
        tya
        rts
gb6     cpy #20
        bcc gb6w
        lda #0
        rts
gb6w    lda #$FF
        rts
gb4     lda lin
        and #1
        beq gb4w
        lda #0
        rts
gb4w    lda #$FF
        rts
gb5     lda lin
        and #1
        beq gb5a
        lda #$55
        rts
gb5a    lda #$AA
        rts
gb0     tax
        lda b8t,x
        rts
b8t     .byte $AA,$55,$CC,$F0

; fb: fill FNL/FNH bytes starting at page A (address A*256) with a stepping pattern: byte n = n * STP
; (mod 256); STP = 0 clears. Clobbers A, Y, ptr, pv, fnl, fnh.
fb      sta ptr+1
        lda #0
        sta ptr
        sta pv
fb1     ldy #0
        lda pv
        sta (ptr),y
        clc
        lda pv
        adc stp
        sta pv
        inc ptr
        bne fb2
        inc ptr+1
fb2     lda fnl
        bne fb3
        dec fnh
fb3     dec fnl
        lda fnl
        ora fnh
        bne fb1
        rts

; mixed: one display list (mixdl) with ANTIC text modes 2, 6, 7, 4, 5 and bitmap modes 8, 9, A, B, C, D, E, F.
; First fills each band's screen RAM (pages $40-$5A; text modes with stp = 0 or 7, i.e. a mix of
; blank and stepped characters, bitmap modes with a stepping pattern) by the sizes the modes need
; (e.g. mode F = 320 bytes = 64+256), writes captions into the three text pages, tints the 20-char
; ANTIC 6/7 lines, then installs mixdl via SDLSTL ($0230/$0231) and sets five colours (COLOR0-4 =
; $02C4-$02C8). Visual pass/fail: every band must look right. Clobbers A, X, Y, ptr, sp, pv, fnl/fnh.
mixed   lda #0
        sta stp
        band 40,0,$40
        band 40,0,$42
        band 40,0,$44
        band 40,0,$5A
        lda #7
        sta stp
        band 40,0,$46
        band 40,0,$48
        band 10,0,$4A
        band 20,0,$4C
        band 40,0,$4E
        band 80,0,$50
        band 160,0,$52
        band 160,0,$54
        band 64,1,$56
        band 64,1,$58
        lda #0
        sta sp
        lda #$40
        sta sp+1
        say s_m2
        lda #0
        sta sp
        lda #$42
        sta sp+1
        say s_m6
        lda #0
        sta sp
        lda #$44
        sta sp+1
        say s_m7
        lda #0
        sta sp
        lda #$5A
        sta sp+1
        say s_ask
        lda #$42
        jsr tint
        lda #$44
        jsr tint
        lda #<mixdl
        sta $0230
        lda #>mixdl
        sta $0231
        lda #$28
        sta $02C4
        lda #$CA
        sta $02C5
        lda #$94
        sta $02C6
        lda #$46
        sta $02C7
        lda #$00
        sta $02C8
        rts

; tint: give the 20 characters at page A four colours (bits 6-7 select the colour register, one
; colour per 4 characters via ctab). Clobbers A, X, Y, ptr.
tint    sta ptr+1
        lda #0
        sta ptr
        ldy #19
ti1     tya
        lsr
        lsr
        and #3
        tax
        lda ctab,x
        ora (ptr),y
        sta (ptr),y
        dey
        bpl ti1
        rts
ctab    .byte 0,$40,$80,$C0

; mixdl: display list for `mixed`. $70 = 8 blank lines; $4x = LMS (mode x, address follows); plain
; $0x bytes repeat the previous mode line. Modes are 2/6/7 (title text), 4, 5, 8, 9, A, B, C, D, E, F and a
; final mode 2 line ($5A00, the prompt); $41 = jump back to the top and wait for VBI. Line counts per mode
; make each band fill exactly the bytes written by `mixed` (e.g. mode C: 1 + 7 lines x 20 bytes).
mixdl   .byte $70,$70,$70
        .byte $42       ; ANTIC 2 text, LMS
        .word $4000
        .byte $46
        .word $4200
        .byte $47
        .word $4400
        .byte $44
        .word $4600
        .byte $45
        .word $4800
        .byte $48
        .word $4A00
        .byte $49
        .word $4C00
        .byte $09
        .byte $4A
        .word $4E00
        .byte $0A
        .byte $4B
        .word $5000
        .byte $0B,$0B,$0B
        .byte $4C
        .word $5200
        .byte $0C,$0C,$0C,$0C,$0C,$0C,$0C
        .byte $4D
        .word $5400
        .byte $0D,$0D,$0D
        .byte $4E
        .word $5600
        .byte $0E,$0E,$0E,$0E,$0E,$0E,$0E
        .byte $4F
        .word $5800
        .byte $0F,$0F,$0F,$0F,$0F,$0F,$0F
        .byte $42
        .word $5A00
        .byte $41
        .word mixdl

; label: print the mode's description (ltab) and the Y/N/S/ESC prompt through direct screen writes: in GR.0
; at SAVMSC, in other modes into the text window whose address is TXTMSC ($0294/$0295). Clobbers A, X, Y,
; sp, tw.
label   ldx mode
        lda mode
        beq lb1
        lda $0294
        sta tw
        lda $0295
        sta tw+1
        jmp lb2
lb1     lda SAVMSC
        sta tw
        lda SAVMSC+1
        sta tw+1
lb2     lda tw
        sta sp
        lda tw+1
        sta sp+1
        lda ltab,x      ; low byte of the string; high bytes are 19 entries further on
        pha
        lda ltab+19,x
        tay
        pla
        jsr puts
        clc
        lda tw
        adc #40
        sta sp
        lda tw+1
        adc #0
        sta sp+1
        lda #<s_ask
        ldy #>s_ask
        jmp puts

; summary: results screen (cscreen.inc). One map cell per test (colour from res via smst: green ok, red
; bad, grey otherwise), its hex/letter id (lbl) printed above the cell, and counts of OK / BAD / SKIPPED.
; RESULT: FAIL if any test is bad; PASS if none bad and at least one ok; "nothing was tested" otherwise.
; Waits for a key, restores the OS screen. Clobbers everything.
summary jsr gs_init
        ldx #0
        lda #1
        jsr bar
        loc 0,0
        say s_stitle
        loc 0,1
        say s_leg
        loc 0,3
        say s_k1
        loc 0,4
        say s_k2
        lda #0
        sta c_ok
        sta c_bad
        sta c_sk
        ldx #ntest-1
sm1     lda res,x
        beq sm_ok
        cmp #1
        beq sm_bad
        inc c_sk
        jmp sm_n
sm_ok   inc c_ok
        jmp sm_n
sm_bad  inc c_bad
sm_n    ldy res,x
        lda smst,y
        jsr mapset
        dex
        bpl sm1
        ldx #0
sm2     stx t4
        txa
        asl
        tax
        ldy #5
        jsr locate
        ldx t4
        lda lbl,x
        jsr putc
        ldx t4
        inx
        cpx #ntest
        bne sm2
        loc 0,2
        say s_okn
        lda c_ok
        jsr num
        say s_badn
        lda c_bad
        jsr num
        say s_skn
        lda c_sk
        jsr num
        lda c_bad
        bne sm_f
        lda c_ok
        beq sm_n0
        loc 0,7
        say s_pass
        ldx #7
        lda #2
        jsr bar
        jmp sm_k
sm_f    loc 0,7
        say s_fail
        ldx #7
        lda #4
        jsr bar
        jmp sm_k
sm_n0   loc 0,7
        say s_none
sm_k    loc 0,8
        say s_any
        jsr getkey
        jsr gs_off
        rts

; num: print A (0..255) in decimal followed by two spaces. Clobbers A, X, Y, v16, t1, t3.
num     sta v16
        lda #0
        sta v16+1
        jsr putdec
        lda #' '
        jsr putc
        lda #' '
        jmp putc

; fine-scroll page: 40-column ANTIC 2 window scrolled diagonally with HSCROL / VSCROL (fine) and LMS changes (coarse).
; Two display lists alternate so the hidden one is rebuilt while the other is shown. Any key ends it and is the answer.
; scroll: build SCRBUF (32 rows x 128 bytes; chars = (column & 63) + (row & 15), & 63, with bit 7 set -> inverse
; video on every 8th column / 8th row so scrolling is easy to see), two display lists and a status
; line, then loops once per frame: upd points the visible list's 14 LMS addresses, the other list is
; installed via SDLSTL ($0230/$0231), HSCROL ($D404) and VSCROL ($D405) get the fine offsets, and
; xpos/ypos advance. Any key ends it and is returned in A (the user's answer). Clobbers everything.
SCRBUF  = $6000         ; 32 rows x 128 bytes, pattern repeats every 64 columns and 16 rows
HSCROL  = $D404         ; ANTIC fine horizontal scroll
VSCROL  = $D405         ; ANTIC fine vertical scroll
scroll  lda #0
        sta ptr
        sta sr
        lda #$60
        sta ptr+1
sc_r    ldy #0
sc_c    tya
        and #63
        sta t1
        lda sr
        and #15
        clc
        adc t1
        and #63
        sta t1
        tya
        and #7
        beq sc_i
        lda sr
        and #7
        bne sc_s
sc_i    lda t1
        ora #$80
        sta t1
sc_s    lda t1
        sta (ptr),y
        iny
        bpl sc_c
        lda ptr
        eor #$80
        sta ptr
        bne sc_n
        inc ptr+1
sc_n    inc sr
        lda sr
        cmp #32
        bne sc_r
        lda #0
        sta sp
        lda #$5E
        sta sp+1
        say s_sc
        lda #0
        sta dp
        lda #$5C
        jsr mkdl
        lda #$5D
        jsr mkdl
        lda #$5C
        sta dp+1
        lda #0
        sta xpos
        sta ypos
        lda #$FF
        sta CH
sc_l    jsr upd
        lda dp+1
        sta $0231       ; SDLSTH: show the list that upd just filled
        lda #0
        sta $0230       ; SDLSTL
        sta ATRACT
        lda dp+1
        eor #1          ; flip between $5C and $5D: the other list is rebuilt next pass
        sta dp+1
        jsr vsync
        sec
        lda #0
        sbc xpos
        and #3          ; HSCROL runs backwards as xpos grows, so the picture moves left
        sta HSCROL
        lda ypos
        and #7
        sta VSCROL
        inc xpos
        lda ypos
        clc
        adc #1
        and #$7F
        sta ypos
        lda CH
        cmp #$FF
        beq sc_l
        lda #0
        sta HSCROL
        sta VSCROL
        lda CH
        pha
        lda #$FF
        sta CH
        pla
        rts

; mkdl: build a scroll display list at page A: 3 x $70 blanks, 14 x $72 (mode 2 + LMS + HSCROL + VSCROL;
; the LMS addresses are filled in by upd), a $42 status line at $5E00, and $41 JVB back to the list's own
; address. Clobbers A, X, Y, dp+1.
mkdl    sta dp+1
        ldy #2
        lda #$70
mk1     sta (dp),y
        dey
        bpl mk1
        ldy #3
        ldx #14
mk2     lda #$72
        sta (dp),y
        iny
        iny
        iny
        dex
        bne mk2
        lda #$42
        sta (dp),y
        iny
        lda #0
        sta (dp),y
        iny
        lda #$5E
        sta (dp),y
        iny
        lda #$41
        sta (dp),y
        iny
        lda dp
        sta (dp),y
        iny
        lda dp+1
        sta (dp),y
        rts

; upd: point the 14 scroll lines at row (ypos/8)+i, column (xpos+3)/4. Address = $6000 + row*128 + col
; (row/2 into the high byte, bit 0 of row as the $80 half-page offset). Clobbers A, X, Y, ay, scx, nl.
upd     lda ypos
        lsr
        lsr
        lsr
        sta ay
        lda xpos
        clc
        adc #3
        lsr
        lsr
        sta scx
        ldy #4
        lda #14
        sta nl
up1     lda ay
        lsr
        tax
        lda #0
        ror
        clc
        adc scx
        sta (dp),y
        iny
        txa
        clc
        adc #$60
        sta (dp),y
        iny
        iny
        inc ay
        dec nl
        bne up1
        rts
sr      .byte 0
xpos    .byte 0
ypos    .byte 0
ay      .byte 0
scx     .byte 0
nl      .byte 0
s_sc    .byte 'FINE SCROLL  Y=ok N=bad S=skip ESC=end',0
scr     .byte 'S:',155  ; device name for OPEN (155 = EOL)
mmap    .byte 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,8,0,0      ; test number -> OS graphics mode
; screen RAM bytes per OS mode 0-15 (what `fill` writes)
szlo    .byte <960,<400,<200,<200,<400,<800,<1600,<3200,<6400,<6400,<6400,<6400,<800,<400,<3200,<6400
szhi    .byte >960,>400,>200,>200,>400,>800,>1600,>3200,>6400,>6400,>6400,>6400,>800,>400,>3200,>6400
; description string pointers: 19 low bytes, then 19 high bytes (tests 17/18 share the empty l17)
ltab    .byte <l0,<l1,<l2,<l3,<l4,<l5,<l6,<l7,<l8,<l9,<l10,<l11,<l12,<l13,<l14,<l15,<l16,<l17,<l17
        .byte >l0,>l1,>l2,>l3,>l4,>l5,>l6,>l7,>l8,>l9,>l10,>l11,>l12,>l13,>l14,>l15,>l16,>l17,>l17
l0      .byte 'GR.0  text 40x24, 2 colours (ANTIC 2)',0
l1      .byte 'GR.1  text 20x24, 5 colours',0
l2      .byte 'GR.2  text 20x12, 5 colours',0
l3      .byte 'GR.3  40x24, 4 colours',0
l4      .byte 'GR.4  80x48, 2 colours',0
l5      .byte 'GR.5  80x48, 4 colours',0
l6      .byte 'GR.6  160x96, 2 colours',0
l7      .byte 'GR.7  160x96, 4 colours',0
l8      .byte 'GR.8  320x192, 2 colours',0
l9      .byte 'GR.9  GTIA 80x192, 16 luminances',0
l10     .byte 'GR.10 GTIA 80x192, 9 colours',0
l11     .byte 'GR.11 GTIA 80x192, 16 hues',0
l12     .byte 'GR.12 text 40x24, 5 colours (ANTIC 4)',0
l13     .byte 'GR.13 text 40x12, 5 colours (ANTIC 5)',0
l14     .byte 'GR.14 160x192, 2 colours (XL/XE)',0
l15     .byte 'GR.15 160x192, 4 colours (XL/XE)',0
l16     .byte 'GR.8 1-bit mono: even sharp stripes?',0
l17     .byte 0
s_ask   .byte 'Y=ok  N=bad  S=skip  ESC=finish',0
s_m2    .byte 'MIXED ANTIC MODES 2 6 7 4 5 8-F',0
s_m6    .byte 'ANTIC 6 COLOUR TEXT',0
s_m7    .byte 'ANTIC 7 BIG',0
s_stitle .byte 'GFXTEST  results',0
s_leg   .byte 'green=ok  red=bad  grey=skipped',0
s_k1    .byte '0-9 A-F = GR.0 - GR.15',0
s_k2    .byte 'G=GR.8 mono  H=mixed  I=fine scroll',0
s_okn   .byte 'OK ',0
s_badn  .byte 'BAD ',0
s_skn   .byte 'SKIPPED ',0
s_pass  .byte 'RESULT: PASS - no bad modes',0
s_fail  .byte 'RESULT: FAIL - see the red cells',0
s_none  .byte 'RESULT: nothing was tested',0
s_any   .byte 'Press any key to exit.',0
lbl     .byte '0123456789ABCDEFGHI'     ; one id char per test, shown above its map cell
smst    .byte 3,2,1,1   ; res code (0 ok, 1 bad, 2/3 skipped) -> mapset state (green, red, grey, grey)
res     .ds ntest       ; per-test result codes
c_ok    .byte 0
c_bad   .byte 0
c_sk    .byte 0
tw      .word 0
bnd     .byte 0
lin     .byte 0
xc      .byte 0
        run start
