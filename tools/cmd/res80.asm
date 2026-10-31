; res80.asm - the resident part of 80COL.COM: an 80 x 24 text screen driver for E:.
; Assembled three times (-d:BASE=$9000 for RAMTOP $C0, $7000 for RAMTOP $A0, $5000 for $80), so the
; same 80COL.COM works with 48K, 40K (BASIC cartridge) and 32K.  The screen is ANTIC mode F
; (1 bit, 320 x 192), each character is 4 x 8 pixels (3 x 5 glyph) packed two per byte.
;
; The output is an Atari binary (segments: font, variables, code) that 80col.asm embeds and
; copies to BASE; it is position dependent, which is why one image is built per BASE.
;
; memory (offsets from BASE):
;   +$0000  screen rows 0-11 (320 bytes each, so none crosses a 4K boundary)
;   +$0F00  display list
;   +$1000  screen rows 12-23
;   +$1F00  font     +$1FC0  variables
;   +$2000  tables, code, then the text shadow (24 x 80) and the line buffer
;
; Design notes:
;  * Screen memory is organised as 24 "slots" of 320 bytes (8 scanlines x 40 bytes). The table
;    ord[] maps logical row -> slot, and the display list's LMS address for each row is
;    rewritten (mkdl) from ord[]. Scrolling and line insert/delete therefore only rotate ord[]
;    and clear one slot instead of moving bitmap data. ANTIC's address counter cannot cross a
;    4K boundary inside a mode line, hence the split with the display list in the middle.
;  * A text "shadow" (SHAD, 24 x 80 character codes) mirrors the screen; it is used for
;    insert/delete and for gathering the logical line under the cursor for input.
;  * Glyphs are drawn by drawat from a 95-entry font of 16-bit words (see drawat).
;  * wrapf[row] = 1 when that row continues on the next (line wrapped), as for the OS editor.
;  * Control codes handled by putch: EOL, $1B ESC (next char is drawn literally), 28-31 cursor
;    up/down/left/right, 125 clear, 126 backspace, 127 tab, 156/157 delete/insert line,
;    254/255 delete/insert char; 253 (bell) and 128-159 otherwise are ignored.
;  * Zero page: ptr,ptr2,ta,tb,tc ($CB-$D1) are scratch; the CIO entries save/restore them
;    (saveall/leave) since the foreground program (e.g. BASIC) may use them.
; Driver is entered through the handler table htab (signature '80C' just before it).
        icl 'lib\sys.asm'
        icl 'lib\r80.inc'

DLB     = BASE+$0F00
FONT    = BASE+$1F00
VARS    = BASE+$1FC0
CODEB   = BASE+$2000

ptr     = $CB
ptr2    = $CD
ta      = $CF
tb      = $D0
tc      = $D1

SDLSTL  = $0230
BRKKEY  = $11
MEMTOP  = $02E5
VVBLKD  = $0224
SETVBV  = $E45C
IOCB0PT = $0346

        org FONT
        icl 'lib\font80.inc'

; Variables ($1FC0). First 9 bytes are the saved OS state used by /OFF and DOSINI:
;   v_orge old E: handler table, v_ort old RAMTOP, v_odos old DOSINI, v_ovbi old VVBLKD,
;   v_omt old MEMTOP. The rest: cursor (v_curx/v_cury), escf (ESC pending), chr (char in
;   flight), savx/rety (X and Y status returned to CIO), lpos/llen (input line position /
;   length), dch/dcol/drow (cell being drawn), gl/gh (glyph word), imask (inverse mask),
;   kvec (K: get vector), savzp (saved zero page), gr (8 rows of the glyph being built).
        org VARS
v_orge  dta a(0)
v_ort   dta 0
v_odos  dta a(0)
v_ovbi  dta a(0)
v_omt   dta a(0)
v_curx  dta 0
v_cury  dta 0
escf    dta 0
chr     dta 0
savx    dta 0
rety    dta 1
lpos    dta 0
llen    dta 0
dch     dta 0
dcol    dta 0
drow    dta 0
gl      dta 0
gh      dta 0
imask   dta 0
tmpv    dta 0
glen    dta 0
gr1     dta 0
kvec    dta a(0)
savzp   dta 0,0,0,0,0,0,0
gr      dta 0,0,0,0,0,0,0,0
        org VARS+$38
        dta a(htab),a(rdosini),a(rvbi),a(rinit)

        org CODEB
        dta c'80C'              ; signature checked by 80col.asm (isact) at table-3
; CIO handler table: open, close, get, put, status, special (each address-1, as CIO uses RTS-style
;   dispatch). Followed by a jmp used as the handler init entry.
htab    dta a(h_ok-1),a(h_ok-1),a(h_get-1),a(h_put-1),a(h_ok-1),a(h_spec-1)
        jmp h_ok

; Lookup tables (assembler-generated). ord = identity logical row -> slot map initially.
;   slolo/slohi = screen address of each slot (slots 12-23 live in the second 4K block);
;   shlo/shhi = shadow row addresses; cnt80l/h = bytes below row n (80*(23-n)) for scrolling.
ord     :24 dta #
wrapf   :24 dta 0
slolo   :12 dta l(BASE+320*#)
        :12 dta l(BASE+$1000+320*#)
slohi   :12 dta h(BASE+320*#)
        :12 dta h(BASE+$1000+320*#)
shlo    :24 dta l(SHAD+80*#)
shhi    :24 dta h(SHAD+80*#)
cnt80l  :24 dta l(80*(23-#))
cnt80h  :24 dta h(80*(23-#))

; h_ok: open/close/status: return Y=1 (success). h_spec: special: Y=$92 (not implemented).
h_ok    ldy #1
        rts
h_spec  ldy #$92
        rts

; ---- CIO entry points -------------------------------------------------
; h_put: CIO put-byte, A = character. Preserves X and the scratch zero page; returns Y=1.
h_put   sta chr
        stx savx
        jsr saveall
        lda #1
        sta rety
        lda chr
        jsr putch
        jmp leave

; h_get: CIO get-byte. Returns the next character of the current input line. When the line
;   buffer is empty: show the cursor, wait for keys (via the real K: handler, kget), echo
;   them with putch, and on EOL gather the whole logical line from the screen (so lines can be
;   edited with the cursor keys first). BREAK ($11 = 0) returns EOL with Y=$80 (break).
;   Returns A = char, X restored, Y = status (rety).
h_get   stx savx
        jsr saveall
        lda #1
        sta rety
        lda lpos
        cmp llen
        bcc hg_ret
hg_loop jsr curon
hg_w    lda BRKKEY
        beq hg_brk
        lda CH                  ; $FF = no key pressed yet
        cmp #$FF
        beq hg_w
        jsr curoff
        jsr kget
        cmp #EOL
        beq hg_cr
        jsr putch
        jmp hg_loop
hg_cr   jsr gather
hg_ret  ldx lpos
        lda lbuf,x
        sta chr
        inc lpos
        jmp leave
hg_brk  jsr curoff
        lda #$FF
        sta BRKKEY
        lda #$80
        sta rety
        lda #EOL
        sta chr
        jmp leave

; saveall/leave: save / restore zero page $CB-$D1 (7 bytes); leave also reloads X, Y, A for CIO.
saveall ldx #6
sv1     lda ptr,x
        sta savzp,x
        dex
        bpl sv1
        rts

leave   ldx #6
lv1     lda savzp,x
        sta ptr,x
        dex
        bpl lv1
        ldx savx
        ldy rety
        lda chr
        rts

; kget: A = next key from the real keyboard handler. Finds 'K' in HATABS, takes its table's
;   get-byte vector (+4/+5, stored as address-1), adds 1 and jumps to it through kvec; the
;   handler's RTS returns straight to our caller. No K: entry -> EOL.
kget    ldx #0
kg1     lda HATABS,x
        beq kg_none
        cmp #'K'
        beq kg2
        inx
        inx
        inx
        bne kg1
kg_none lda #EOL
        rts
kg2     lda HATABS+1,x
        sta ptr
        lda HATABS+2,x
        sta ptr+1
        ldy #4
        lda (ptr),y
        clc
        adc #1
        sta kvec
        iny
        lda (ptr),y
        adc #0
        sta kvec+1
        jmp (kvec)

; ---- put one character --------------------------------------------------
; putch: A = ATASCII character; interprets control codes (see header) or draws it, wrapping
;   at column 80 (sets wrapf) and scrolling at the bottom. "bne *+5" skips the next 3-byte
;   jmp when the code does not match. Clobbers A,X,Y and scratch zero page.
putch   sta chr
        lda escf
        beq pc_1
        lda #0
        sta escf
        jmp pc_draw
pc_1    lda chr
        cmp #EOL
        bne pc_2
        lda #0
        sta v_curx
        jmp linefeed
pc_2    cmp #125
        bne *+5
        jmp clrscr
        cmp #126
        bne *+5
        jmp bksp
        cmp #127
        bne *+5
        jmp tabk
        cmp #27
        beq setesc
        cmp #28
        bcc pc_ret
        cmp #32
        bcc cursmv
        cmp #156
        bne *+5
        jmp dellin
        cmp #157
        bne *+5
        jmp inslin
        cmp #254
        bne *+5
        jmp delchr
        cmp #255
        bne *+5
        jmp inschr
        cmp #253
        beq pc_ret              ; bell: ignored
        cmp #128
        bcc pc_draw
        cmp #160
        bcc pc_ret              ; $80-$9F (other control graphics): ignored
pc_draw lda v_curx
        sta dcol
        lda v_cury
        sta drow
        lda chr
        jsr putcell
        inc v_curx
        lda v_curx
        cmp #80
        bcc pc_ret
        lda #0
        sta v_curx
        ldx v_cury
        lda #1
        sta wrapf,x
        jmp linefeed
pc_ret  rts

setesc  lda #1
        sta escf
        rts

; cursmv: codes 28-31 move the cursor up/down/left/right, wrapping around the screen edges.
cursmv  cmp #30
        bcs cm_h
        cmp #29
        beq cm_dn
        dec v_cury
        bpl cm_r
        lda #23
        sta v_cury
cm_r    rts
cm_dn   inc v_cury
        lda v_cury
        cmp #24
        bcc cm_r
        lda #0
        sta v_cury
        rts
cm_h    cmp #31
        beq cm_rt
        dec v_curx
        bpl cm_r
        lda #79
        sta v_curx
        rts
cm_rt   inc v_curx
        lda v_curx
        cmp #80
        bcc cm_r
        lda #0
        sta v_curx
        rts

; bksp: back up one column (not past column 0) and blank the cell.
bksp    lda v_curx
        beq pc_ret
        dec v_curx
        lda v_curx
        sta dcol
        lda v_cury
        sta drow
        lda #$20
        jmp putcell

; tabk: move to the next 8-column tab stop; past column 79 wraps to next line.
tabk    lda v_curx
        and #$F8
        clc
        adc #8
        cmp #80
        bcc tb1
        lda #0
        sta v_curx
        jmp linefeed
tb1     sta v_curx
        rts

; linefeed: cursor down; on the last row scroll up by deleting row 0 (dellines).
linefeed lda v_cury
        cmp #23
        bcs lf_s
        inc v_cury
        rts
lf_s    lda #0
        jmp dellines

; ---- editing ----------------------------------------------------------
; delchr / inschr: delete / insert a character at the cursor by shifting the rest of the
;   row in the shadow, then redrawing from the cursor to the row end.
delchr  lda v_cury
        jsr shrow
        ldy v_curx
dc1     cpy #79
        beq dc2
        iny
        lda (ptr2),y
        dey
        sta (ptr2),y
        iny
        bne dc1
dc2     lda #$20
        sta (ptr2),y
        jmp redrw

inschr  lda v_cury
        jsr shrow
        ldy #79
ic1     cpy v_curx
        beq ic2
        dey
        lda (ptr2),y
        iny
        sta (ptr2),y
        dey
        jmp ic1
ic2     lda #$20
        sta (ptr2),y
        jmp redrw

; redraw the current row from the cursor to the end from the shadow
redrw   lda v_curx
        sta dcol
        lda v_cury
        sta drow
        jsr shrow
rd1     ldy dcol
        lda (ptr2),y
        sta dch
        jsr drawat
        inc dcol
        lda dcol
        cmp #80
        bne rd1
        rts

; dellin: delete the cursor's row, cursor to column 0.
dellin  lda v_cury
        jsr dellines
        lda #0
        sta v_curx
        rts

; delete row A, rows below move up, a blank row appears at the bottom.
;   Bitmap: no pixels move. The slot of the deleted row is cleared and moved to the end of
;   ord[]/wrapf[] (rotation), then the shadow rows below are copied up (cnt80 bytes, split
;   into whole pages dl3 + remainder dl5), and mkdl rebuilds the LMS addresses.
dellines sta tb
        tax
        lda ord,x
        sta tc
dl1     cpx #23
        beq dl2
        lda ord+1,x
        sta ord,x
        lda wrapf+1,x
        sta wrapf,x
        inx
        bne dl1
dl2     lda tc
        sta ord+23
        lda #0
        sta wrapf+23
        lda tc
        jsr clrslot
        ldx tb
        lda shlo,x
        sta ptr
        lda shhi,x
        sta ptr+1
        lda ptr
        clc
        adc #80
        sta ptr2
        lda ptr+1
        adc #0
        sta ptr2+1
        lda cnt80h,x
        sta tc
        beq dl4
dl3     ldy #0
dl3a    lda (ptr2),y
        sta (ptr),y
        iny
        bne dl3a
        inc ptr+1
        inc ptr2+1
        dec tc
        bne dl3
dl4     lda cnt80l,x
        beq dl6
        sta tc
        ldy #0
dl5     lda (ptr2),y
        sta (ptr),y
        iny
        cpy tc
        bne dl5
dl6     lda #23
        jsr shrow
        jsr blankrow
        jmp mkdl

; blank the shadow row at ptr2
blankrow ldy #79
        lda #$20
br1     sta (ptr2),y
        dey
        bpl br1
        rts

; inslin: insert a blank row at the cursor; rows below move down, the bottom row is lost.
;   Same slot-rotation trick as dellines; the shadow is copied backwards (from the end) with
;   a 16-bit count in gl/gh = 80*(23-row) so the overlapping move is safe.
inslin  lda ord+23
        sta tc
        ldx #23
il1     cpx v_cury
        beq il2
        lda ord-1,x
        sta ord,x
        lda wrapf-1,x
        sta wrapf,x
        dex
        jmp il1
il2     lda tc
        sta ord,x
        lda #0
        sta wrapf,x
        stx tb
        lda tc
        jsr clrslot
        ldx tb
        lda #<(SHAD+1920)
        sta ptr
        lda #>(SHAD+1920)
        sta ptr+1
        lda #<(SHAD+1840)
        sta ptr2
        lda #>(SHAD+1840)
        sta ptr2+1
        lda cnt80l,x
        sta gl
        lda cnt80h,x
        sta gh
il3     lda gl
        ora gh
        beq il5
        lda ptr
        bne il3a
        dec ptr+1
il3a    dec ptr
        lda ptr2
        bne il3b
        dec ptr2+1
il3b    dec ptr2
        ldy #0
        lda (ptr2),y
        sta (ptr),y
        lda gl
        bne il3c
        dec gh
il3c    dec gl
        jmp il3
il5     lda v_cury
        jsr shrow
        jsr blankrow
        lda #0
        sta v_curx
        jmp mkdl

; ---- screen / shadow bookkeeping --------------------------------------------
; rowptr: ptr = screen address of the slot of logical row A (via ord[]). Clobbers X.
rowptr  tax
        lda ord,x
        tax
        lda slolo,x
        sta ptr
        lda slohi,x
        sta ptr+1
        rts

; ptr2 = shadow row A
shrow   tax
        lda shlo,x
        sta ptr2
        lda shhi,x
        sta ptr2+1
        rts

; clrslot: zero slot A (320 bytes = one full page + 64 bytes). Note A is a slot number.
clrslot tax
        lda slolo,x
        sta ptr
        lda slohi,x
        sta ptr+1
        lda #0
        tay
cs1     sta (ptr),y
        iny
        bne cs1
        inc ptr+1
cs2     sta (ptr),y
        iny
        cpy #64
        bne cs2
        rts

; rewrite the LMS address of every row in the display list. Each row is 10 bytes
;   ($4F lo hi + 7 x $0F); the first LMS operand is at DLB+4, so tc steps 4,14,24,...
mkdl    lda #0
        sta ta
        lda #4
        sta tc
mk1     ldx ta
        lda ord,x
        tax
        ldy tc
        lda slolo,x
        sta DLB,y
        lda slohi,x
        sta DLB+1,y
        lda tc
        clc
        adc #10
        sta tc
        inc ta
        lda ta
        cmp #24
        bne mk1
        rts

; clrscr: clear all slots, fill the shadow with spaces ($20: 7 pages + 128 bytes = 1920),
;   clear wrap flags, home the cursor and reset the input line state.
clrscr  lda #0
        sta tmpv
cl1     lda tmpv
        jsr clrslot
        inc tmpv
        lda tmpv
        cmp #24
        bne cl1
        lda #<SHAD
        sta ptr
        lda #>SHAD
        sta ptr+1
        lda #$20
        ldx #7
cl2     ldy #0
cl3     sta (ptr),y
        iny
        bne cl3
        inc ptr+1
        dex
        bne cl2
cl4     sta (ptr),y
        iny
        cpy #128
        bne cl4
        ldx #23
        lda #0
cl5     sta wrapf,x
        dex
        bpl cl5
        sta v_curx
        sta v_cury
        sta escf
        sta lpos
        sta llen
        rts

; called once by the installer: build the display list and clear everything.
;   DL: 3 x $70 (24 blank lines), then 24 x { $4F+address (mode F with LMS), 7 x $0F },
;   then $41 (JVB) back to the start. The LMS addresses are filled in by mkdl.
rinit   lda #$70
        sta DLB
        sta DLB+1
        sta DLB+2
        ldy #3
        lda #24
        sta ta
ri1     lda #$4F
        sta DLB,y
        iny
        iny
        iny
        ldx #7
        lda #$0F
ri2     sta DLB,y
        iny
        dex
        bne ri2
        dec ta
        bne ri1
        lda #$41
        sta DLB,y
        lda #<DLB
        sta DLB+1,y
        lda #>DLB
        sta DLB+2,y
        jsr mkdl
        jmp clrscr

; ---- drawing -------------------------------------------------------------
; cellptr: ptr = screen byte of cell (dcol,drow) = row slot + dcol/2; ta = 1 if the odd
;   (right) nibble. Two 4-pixel cells share one byte: even column = high nibble.
cellptr lda drow
        jsr rowptr
        lda dcol
        and #1
        sta ta
        lda dcol
        lsr
        clc
        adc ptr
        sta ptr
        bcc cp1
        inc ptr+1
cp1     rts

; add40: ptr += 40 (next scanline).
add40   lda ptr
        clc
        adc #40
        sta ptr
        bcc a40
        inc ptr+1
a40     rts

; draw char A at (dcol,drow) and remember it in the shadow
putcell sta dch
        jsr drawat
        lda drow
        jsr shrow
        ldy dcol
        lda dch
        sta (ptr2),y
        rts

; draw dch at (dcol,drow); bit 7 = inverse.
;   Font: 95 words for chars 32-126 (index (c&$7F)-32, 2 bytes each). Bit 15 = descender flag
;   (glyph rows go to scanlines 3-7 instead of 1-5); the remaining 15 bits are 5 rows x 3
;   pixels, top row first. Each 3-bit row is shifted left once to leave a blank column on
;   the right, giving a 4-pixel nibble in gr[0..7] (blank for unused scanlines). The nibble
;   is then XORed with imask ($0F for inverse) and merged into the high or low nibble of
;   the screen byte on each of the 8 scanlines, keeping the neighbouring cell intact.
;   Characters outside 32-126 (after masking) draw as blank.
drawat  lda #0
        bit dch
        bpl da_n
        lda #$0F
da_n    sta imask
        ldx #7
        lda #0
da_c    sta gr,x
        dex
        bpl da_c
        lda dch
        and #$7F
        sec
        sbc #32
        bcc da_p
        cmp #95
        bcs da_p
        asl
        tax
        lda FONT,x
        sta gl
        lda FONT+1,x
        sta gh
        lda #1
        bit gh
        bpl da_s0
        lda #3
da_s0   sta tb
        asl gl
        rol gh
        ldy #5
da_r    lda #0
        sta ta
        ldx #3
da_b    asl gl
        rol gh
        rol ta
        dex
        bne da_b
        lda ta
        asl
        ldx tb
        sta gr,x
        inc tb
        dey
        bne da_r
da_p    jsr cellptr
        ldx #0
da_l    lda gr,x
        eor imask
        ldy ta
        bne da_o
        asl
        asl
        asl
        asl
        sta tc
        ldy #0
        lda (ptr),y
        and #$0F
        ora tc
        jmp da_s
da_o    sta tc
        ldy #0
        lda (ptr),y
        and #$F0
        ora tc
da_s    sta (ptr),y
        jsr add40
        inx
        cpx #8
        bne da_l
        rts

; xorcell: invert the 4 x 8 cursor cell (XOR, so calling it twice restores the screen).
xorcell lda v_curx
        sta dcol
        lda v_cury
        sta drow
        jsr cellptr
        lda #$F0
        ldy ta
        beq xc_m
        lda #$0F
xc_m    sta tc
        ldx #8
xc_l    ldy #0
        lda (ptr),y
        eor tc
        sta (ptr),y
        jsr add40
        dex
        bne xc_l
        rts

; curon/curoff: same routine (XOR toggle); skipped when the cursor is inhibited (CRSINH).
curon   lda CRSINH
        bne co_r
        jmp xorcell
co_r    rts
curoff  = curon

; ---- the logical line under the cursor goes to lbuf ----------------------------
; gather: a logical line is the cursor's row plus rows joined by wrapf (at most 3 rows).
;   Find the first row (tb) and last row (gr1), copy their shadow text to lbuf, trim trailing
;   spaces, append EOL, set llen/lpos, move the cursor to the last row and linefeed.
gather  ldx v_cury
ga1     cpx #0
        beq ga2
        lda wrapf-1,x
        beq ga2
        dex
        bne ga1
ga2     stx tb
        ldx v_cury
ga3     cpx #23
        beq ga4
        lda wrapf,x
        beq ga4
        txa
        sec
        sbc tb
        cmp #2
        bcs ga4
        inx
        bne ga3
ga4     stx gr1
        lda #<lbuf
        sta ptr
        lda #>lbuf
        sta ptr+1
        lda tb
        sta tmpv
        lda #0
        sta glen
ga5     lda tmpv
        jsr shrow
        ldy #0
ga6     lda (ptr2),y
        sta (ptr),y
        iny
        cpy #80
        bne ga6
        lda ptr
        clc
        adc #80
        sta ptr
        bcc ga7
        inc ptr+1
ga7     lda glen
        clc
        adc #80
        sta glen
        lda tmpv
        cmp gr1
        beq ga8
        inc tmpv
        bne ga5
ga8     ldx glen
ga9     beq ga10
        lda lbuf-1,x
        cmp #$20
        bne ga10
        dex
        bne ga9
ga10    lda #EOL
        sta lbuf,x
        inx
        stx llen
        lda #0
        sta lpos
        sta v_curx
        lda gr1
        sta v_cury
        jmp linefeed

; ---- hooks -----------------------------------------------------------------
; deferred VBI: when the OS puts up its own GRAPHICS 0 list, swap ours back in.
;   If SDLSTL already equals DLB nothing to do. Otherwise the vbm/vbn operands are patched
;   (self-modifying) with the current display list address and the list is recognised as
;   the OS's by byte 3 = $42 (LMS mode 2) and byte 6 = $02; then SDLSTL is set to ours.
;   Always chains to the previous VBI via v_ovbi.
rvbi    lda SDLSTL+1
        cmp #>DLB
        bne vb1
        lda SDLSTL
        cmp #<DLB
        beq vb9
vb1     lda SDLSTL
        sta vbm+1
        sta vbn+1
        lda SDLSTL+1
        sta vbm+2
        sta vbn+2
        ldy #3
vbm     lda $FFFF,y
        cmp #$42
        bne vb9
        ldy #6
vbn     lda $FFFF,y
        cmp #$02
        bne vb9
        lda #<DLB
        sta SDLSTL
        lda #>DLB
        sta SDLSTL+1
vb9     jmp (v_ovbi)

; DOSINI: a warm start gives the memory back and resets the vectors, so take it again.
;   Chains to the old DOSINI first, then restores RAMTOP = BASE page, MEMTOP = BASE-1, the
;   IOCB 0 put vector (htab+6, the put entry) and the deferred VBI.
rdosini jsr rdo_old
        lda #>BASE
        sta RAMTOP
        lda #$FF
        sta MEMTOP
        lda #>BASE-1
        sta MEMTOP+1
        lda htab+6
        sta IOCB0PT
        lda htab+7
        sta IOCB0PT+1
        ldx #>rvbi
        ldy #<rvbi
        lda #7
        jsr SETVBV
        rts
rdo_old jmp (v_odos)

; The shadow text and line buffer follow the code; ert checks everything fits in RESZ bytes.
SHAD    = *
lbuf    = SHAD+1920
        ert lbuf+241>BASE+RESZ
