; nano.asm - NANO.COM, a full screen text editor with nano style keys for any Atari DOS.
; NANO FILE.TXT from CMD, or run it from the DOS menu and type the name at the prompt.
; The text lives in $6000-$BBFF (about 23K).  A new file name starts an empty buffer.
; Keys:  Ctrl+arrows (or ^B ^F ^P ^N) move   ^A start of line   ^E end of line   ^V / ^Y page down / up
;        ^D or Ctrl+Delete delete character   BACKSPACE delete left   ^K cut line   ^U paste
;        ^W search   ^O write file   ^X exit   ^C show position   ^G help
;        ^R insert a file   ^T go to line number   ^L search and replace   TAB inserts two spaces
;
; Overview (appears to match the code below):
;  - The whole text is one flat byte array at BUF ($6000..), len bytes long (offset 0..len-1). Lines are ended
;    by EOL ($9B), and the last byte of the text is always an EOL ("final EOL"), so an empty buffer is len = 1.
;    There is no gap buffer: inschr/insgap and delgap move the tail of the text with copydn / copyup.
;    cur = cursor offset into the buffer, top = offset of the first line shown on screen. Offsets are 16 bit
;    and are turned into addresses by adding >BUF to the high byte.
;  - Screen: GR.0 style 40x24 text. Nothing goes through CIO: draw/pch/rowclr store screen codes directly
;    into screen memory (address from SAVMSC, 40 bytes per row). Row 0 = title bar (inverse), rows 1..TROWS
;    (20) = text (rows longer than 40 characters are cut, not wrapped), row 21 = message / prompt line,
;    rows 22..23 = key hints. The cursor is drawn by inverting the character under it (CRSINH hides the OS cursor).
;  - Keys come from K: opened on IOCB 7 ($70); ktab (key codes) / ktl,kth (handler address low/high bytes)
;    form a dispatch table, handlers end with 'jmp loop'. Printable keys 32..124 are inserted.
;    The first 6 table entries (up, down, page keys) keep the wanted column (vfl) for vertical moves.
;  - Files use IOCB 1 ($10): loadf (open read, one block read of up to MAXL bytes), savefile (open write, put block).
;    A name without a device prefix gets 'D:' put in front by fixname.
;  - Startup: a file name comes from the CMD hand-over block at HAND ($0480, first byte $A5, then the text),
;    otherwise it is typed at the 'NANO FILE?' prompt. The HAND byte is cleared after use.
;
; Memory map: $5400-$5BFF CLIP (cut buffer, CLIPMAX = $0800 bytes), text buffer BUF = $6000, MAXL = $5BFF bytes
;   maximum (so the text ends below $BC00). Zero page $80..$B1 holds the working variables below:
;   cur/len/top (offsets), p/q/src/dst/sp (pointers), t/tp/cnt (16 bit temporaries), cl = bytes in the cut buffer,
;   want = wanted column, mod = modified flag, inv = inverse video mask ORed into screen codes ($80 or 0),
;   scol = print column, crow/ccol = screen position of the cursor, fb/pl/fmax/fl = prompt state
;   (text pointer, label pointer, max length, current length), key/pk = last / previous key.
;   Variable data (file name, input buffers) is at the end of the file.
        icl 'lib\sys.asm'

BUF     = $6000
MAXL    = $5BFF
CLIP    = $5400
CLIPMAX = $0800
TROWS   = 20
SHFLOK  = $02BE
SAVMSC  = $58

cur     = $80
len     = $82
top     = $84
p       = $86
q       = $88
sp      = $8A
src     = $8C
dst     = $8E
cnt     = $90
t       = $92
tp      = $94
want    = $96
cl      = $98
cvt     = $9A
cvu     = $9B
tmp     = $9C
rowc    = $9D
crow    = $9E
ccol    = $9F
scol    = $A0
inv     = $A1
vfl     = $A2
mod     = $A3
key     = $A4
pk      = $A5
fl      = $A6
fmax    = $A7
pi      = $A8
fb      = $A9
pl      = $AB
hr      = $AD
oldshf  = $AE
erc     = $AF
pcnt    = $B0
tflag   = $B1

; ZP / equates: MAXL = largest text size (BUF+MAXL = $BBFF), TROWS = number of text rows on screen,
; SHFLOK = OS shift/caps lock flag ($02BE), SAVMSC = screen memory pointer ($58)
        org CODE
start   lda #1
        sta CRSINH              ; hide the OS cursor, the editor draws its own
        lda SHFLOK
        sta oldshf
        lda #EOL
        sta fn
        sta inb
        sta pb
; fn / inb / pb start out as empty (EOL only) strings. If the CMD hand-over block (HAND, $A5 signature) is present,
; skip blanks and copy the first word of the text (max 58 characters) into fn.
        lda HAND
        cmp #$A5
        bne ask
        ldy #0
h1      lda HAND+1,y
        cmp #' '
        bne h2
        iny
        bne h1
h2      ldx #0
h3      lda HAND+1,y
        cmp #EOL
        beq h4
        cmp #' '
        beq h4
        sta fn,x
        inx
        iny
        cpx #58
        bcc h3
h4      lda #EOL
        sta fn,x
        lda #0
        sta HAND
        jmp named

; no hand-over: read the file name with CIO command 5 (get record) on IOCB 0 (screen editor)
ask     jsr putsi
        .byte 'NANO FILE? ',0
        lda #<fn
        sta ICBAL
        lda #>fn
        sta ICBAH
        lda #5
        sta ICCOM
        lda #58
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV

; reset editor state, then load the named file (or start with an empty buffer when no name was given)
named   lda #0
        sta mod
        sta cur
        sta cur+1
        sta top
        sta top+1
        sta cl
        sta cl+1
        sta vfl
        sta key
        sta tflag
        lda fn
        cmp #EOL
        beq nb
        cmp #' '
        beq nb
        jsr fixname
        jsr loadf
        jmp go
nb      jsr newbuf

; (re)open K: on IOCB 7 for keyboard reads: close (12), then open (3) with ICAX1 = 4 (read); clear the screen
; (125); SHFLOK = 0 gives lower case typing. tflag from loadf: 1 = file truncated to fit, 2 = new file.
go      ldx #$70
        lda #12
        sta ICCOM,x
        jsr CIOV
        ldx #$70
        lda #3
        sta ICCOM,x
        lda #<kspec
        sta ICBAL,x
        lda #>kspec
        sta ICBAH,x
        lda #4
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        lda #125
        jsr putc
        lda #0
        sta SHFLOK
        lda tflag
        beq loop
        cmp #1
        bne go1
        jsr msg0
        jsr pstr
        .byte 'File too long - cut off',0
        jsr msg1
        jmp loop
go1     jsr msg0
        jsr pstr
        .byte 'New File',0
        jsr msg1

; ---- main loop ----
; Each pass: scroll to keep the cursor visible (fixtop), redraw (draw), wait for a key (getk), clear the message
; row, then look the key up in ktab. Found: jump through ktl/kth (indirect jump via T0); not found: insert it
; when it is a printable character (32..124). pk = key of the previous pass (^K uses it to chain cuts).
loop    lda key
        sta pk
        jsr fixtop
        jsr draw
        jsr getk
        sta key
        pha
        jsr clr21
        pla
        ldx #0
dk1     cmp ktab,x
        beq dk2
        inx
        cpx #NK
        bcc dk1
        ldx #0
        stx vfl
        cmp #32
        bcc dk9
        cmp #125
        bcs dk9
        jsr inschr
dk9     jmp loop
dk2     cpx #6
        bcc dk3
        ldy #0
        sty vfl
dk3     lda ktl,x
        sta T0
        lda kth,x
        sta T0+1
        jmp (T0)

; key dispatch table, in order: up(Ctrl+up, ^P), down(Ctrl+down, ^N), page up (^Y), page down (^V), left (Ctrl+left,
; ^B), right (Ctrl+right, ^F), ^A, ^E, ^D, Ctrl+Delete ($FE), BACKSPACE ($7E), RETURN ($9B), TAB ($7F), ^K, ^U,
; ^W, ^O, ^X, ^G, ^C, ^R, ^T, ^L. The three lists ktab / ktl / kth must stay in the same order.
ktab    .byte 28,16,29,14,25,22
        .byte 30,2,31,6,1,5,4,254,126,155,127,11,21,23,15,24,7,3,18,20,12
NK      = *-ktab
ktl     .byte <kup,<kup,<kdn,<kdn,<kpu,<kpd
        .byte <klf,<klf,<krt,<krt,<khome,<kend,<kdel,<kdel,<kbs,<knl,<ktb,<kcut,<kpaste,<ksrch,<kwrite,        <kexit,<khelp,<kpos,<kread,<kgoto,<krepl
kth     .byte >kup,>kup,>kdn,>kdn,>kpu,>kpd
        .byte >klf,>klf,>krt,>krt,>khome,>kend,>kdel,>kdel,>kbs,>knl,>ktb,>kcut,>kpaste,>ksrch,>kwrite,        >kexit,>khelp,>kpos,>kread,>kgoto,>krepl
; ---- key handlers ----
; Every handler ends with 'jmp loop'. Cursor moves use cup / cdn (see below); page keys move TROWS-1 lines.
kup     jsr cup
        jmp loop
kdn     jsr cdn
        jmp loop
kpu     lda #TROWS-1
        sta pcnt
kpu1    jsr cup
        dec pcnt
        bne kpu1
        jmp loop
kpd     lda #TROWS-1
        sta pcnt
kpd1    jsr cdn
        dec pcnt
        bne kpd1
        jmp loop

; left / right: move cur by one, never before 0 and never onto the final EOL (canfwd)
klf     lda cur
        ora cur+1
        beq klx
        lda cur
        bne kl1
        dec cur+1
kl1     dec cur
klx     jmp loop

krt     jsr canfwd
        bcs krx
        lda t
        sta cur
        lda t+1
        sta cur+1
krx     jmp loop

; HOME / END: t = cur, then lstart / lend give the start of line / the EOL offset of the line
khome   lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda t
        sta cur
        lda t+1
        sta cur+1
        jmp loop
kend    lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lend
        lda t
        sta cur
        lda t+1
        sta cur+1
        jmp loop

; ^D / Ctrl+Delete: delete the byte under the cursor (not the final EOL); BACKSPACE: step left, delete that byte
kdel    jsr canfwd
        bcs kdx
        lda #1
        sta cnt
        lda #0
        sta cnt+1
        jsr delgap
        lda #1
        sta mod
kdx     jmp loop

kbs     lda cur
        ora cur+1
        beq kbx
        lda cur
        bne kb1
        dec cur+1
kb1     dec cur
        lda #1
        sta cnt
        lda #0
        sta cnt+1
        jsr delgap
        lda #1
        sta mod
kbx     jmp loop

; RETURN inserts an EOL; TAB inserts two spaces
knl     lda #EOL
        jsr inschr
        jmp loop
ktb     lda #' '
        jsr inschr
        lda #' '
        jsr inschr
        jmp loop

; ^K cut the current line into the clipboard (repeat to add more lines)
; dst = line start, t = its EOL, cnt = line length, tp = length including the EOL (bytes copied to CLIP).
; Nothing is cut on the final empty line. If the previous key was not ^K (pk <> 11) the clipboard (cl = size) is
; emptied first. Fails with 'Cut buffer full' when CLIPMAX would be exceeded.
kcut    lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda t
        sta dst
        lda t+1
        sta dst+1
        jsr lend
        sec
        lda t
        sbc dst
        sta cnt
        lda t+1
        sbc dst+1
        sta cnt+1
        lda t
        clc
        adc #1
        sta src
        lda t+1
        adc #0
        sta src+1
        lda cnt
        clc
        adc #1
        sta tp
        lda cnt+1
        adc #0
        sta tp+1
        lda src
        cmp len
        lda src+1
        sbc len+1
        bcc kc1
        lda cnt
        ora cnt+1
        bne kc1
        jmp loop
kc1     lda pk
        cmp #11
        beq kc2
        lda #0
        sta cl
        sta cl+1
kc2     lda cl
        clc
        adc tp
        sta t
        lda cl+1
        adc tp+1
        sta t+1
        lda t
        cmp #<(CLIPMAX+1)
        lda t+1
        sbc #>(CLIPMAX+1)
        bcc kc2a
        jsr msg0
        jsr pstr
        .byte 'Cut buffer full',0
        jsr msg1
        jmp loop
kc2a    lda cl
        clc
        adc #<CLIP
        sta p
        lda cl+1
        adc #>CLIP
        sta p+1
        lda dst
        sta q
        lda dst+1
        clc
        adc #>BUF
        sta q+1
        lda tp
        sta t
        lda tp+1
        sta t+1
        jsr copyup
        lda cl
        clc
        adc tp
        sta cl
        lda cl+1
        adc tp+1
        sta cl+1
        lda dst
        sta cur
        lda dst+1
        sta cur+1
        lda src
        cmp len
        lda src+1
        sbc len+1
        bcs kc3
        inc cnt
        bne kc3
        inc cnt+1
kc3     lda cnt
        ora cnt+1
        beq kc4
        jsr delgap
        lda #1
        sta mod
kc4     jmp loop

; ^U paste: insert the cut buffer (cl bytes) at the cursor via insgap + copyup, cursor ends after the text
kpaste  lda cl
        ora cl+1
        bne kp1
        jsr msg0
        jsr pstr
        .byte 'Cut buffer is empty',0
        jsr msg1
        jmp loop
kp1     lda cl
        sta cnt
        lda cl+1
        sta cnt+1
        jsr insgap
        bcc kp2
        jsr msg0
        jsr pstr
        .byte 'Buffer full',0
        jsr msg1
        jmp loop
kp2     jsr setp
        lda #<CLIP
        sta q
        lda #>CLIP
        sta q+1
        lda cl
        sta t
        lda cl+1
        sta t+1
        jsr copyup
        lda cur
        clc
        adc cl
        sta cur
        lda cur+1
        adc cl+1
        sta cur+1
        lda #1
        sta mod
        jmp loop

; ^W search (case blind, wraps around, same text is offered again)
; The prompt keeps the old text in inb. p = candidate offset (starts after the cursor), cnt = positions left to try
; (len, so the whole buffer is covered once, wrapping at len). Compare is done through 'fold' (upper case).
; kfound leaves slen = length of the match and cur at its start. rmode/rall are shared with replace (^L).
ksx     jmp loop
ksrch   lda #0
        sta rmode
        sta rall
ks0     lda #<inb
        sta fb
        lda #>inb
        sta fb+1
        lda #<lbs
        sta pl
        lda #>lbs
        sta pl+1
        lda #28
        sta fmax
        jsr prompt
        php
        jsr clr21
        plp
        bcc ksx
        lda inb
        cmp #EOL
        beq ksx
        lda rmode
        beq ks0a
        lda #<rb
        sta fb
        lda #>rb
        sta fb+1
        lda #<lbr
        sta pl
        lda #>lbr
        sta pl+1
        jsr prompt
        php
        jsr clr21
        plp
        bcc ksx
ks0a    lda cur
        sta p
        lda cur+1
        sta p+1
        lda len
        sta cnt
        lda len+1
        sta cnt+1
ks1     inc p
        bne ks2
        inc p+1
ks2     lda p
        cmp len
        lda p+1
        sbc len+1
        bcc ks3
        lda rmode
        beq ks2w
        jmp rend
ks2w    lda #0
        sta p
        sta p+1
ks3      lda p
        sta q
        lda p+1
        clc
        adc #>BUF
        sta q+1
        ldx #0
        ldy #0
ks4     lda inb,x
        cmp #EOL
        beq kfound
        jsr fold
        sta tmp
        lda (q),y
        jsr fold
        cmp tmp
        bne ks5
        inx
        iny
        bne ks4
ks5     lda cnt
        bne ks6
        dec cnt+1
ks6     dec cnt
        lda cnt
        ora cnt+1
        bne ks1
        jsr msg0
        jsr pstr
        .byte 'Not found',0
        jsr msg1
ks9     jmp loop
kfound  stx slen
        lda p
        sta cur
        lda p+1
        sta cur+1
        lda rmode
        beq kfx
        jmp krep
kfx     jmp loop

; ^L replace: search text, replacement, then Y / N / A for each match (no wrap)
; Reuses the search code with rmode = 1: kfound jumps to krep; rb = replacement text; rall = replace all (A).
; krdo deletes slen bytes and inserts rb, then the search resumes right after the cursor.
krepl   lda #1
        sta rmode
        lda #EOL
        sta rb
        lda #0
        sta rall
        jmp ks0

krep    jsr fixtop
        jsr draw
        lda rall
        bne krdo
        jsr msg0
        jsr pstr
        .byte 'Replace? Y/N/A, ESC stops',0
        jsr msg1
        jsr getk
        jsr fold
        cmp #'Y'
        beq krdo
        cmp #'A'
        bne kr1
        sta rall
        jmp krdo
kr1     cmp #'N'
        beq krskip
        jsr clr21
        jmp loop
krdo    lda slen
        sta cnt
        lda #0
        sta cnt+1
        jsr delgap
        ldx #0
krl     stx rx
        lda rb,x
        cmp #EOL
        beq krd2
        jsr inschr
        ldx rx
        inx
        bne krl
krd2    lda #1
        sta mod
        lda cur
        sta p
        lda cur+1
        sta p+1
        lda len
        sta cnt
        lda len+1
        sta cnt+1
        jmp ks2
krskip  lda len
        sta cnt
        lda len+1
        sta cnt+1
        jmp ks1
rend    jsr clr21
        jsr msg0
        jsr pstr
        .byte 'No more matches',0
        jsr msg1
        jmp loop

; ^T go to line number
; The digits are converted to t (t = t*8 + t*2 + digit, using src = t*2 and q = t*8). Then dst scans the
; text counting EOLs until t-1 lines have been skipped. A number past the end puts the cursor on the last line.
kgx     jmp loop
kgoto   lda #EOL
        sta gb
        lda #<gb
        sta fb
        lda #>gb
        sta fb+1
        lda #<lbg
        sta pl
        lda #>lbg
        sta pl+1
        lda #5
        sta fmax
        jsr prompt
        php
        jsr clr21
        plp
        bcc kgx
        lda #0
        sta t
        sta t+1
        sta dst
        sta dst+1
        tax
kg1     lda gb,x
        cmp #EOL
        beq kg4
        sec
        sbc #'0'
        cmp #10
        bcs kgx
        sta tmp
        lda t
        asl
        sta src
        lda t+1
        rol
        sta src+1
        lda src
        asl
        sta q
        lda src+1
        rol
        sta q+1
        asl q
        rol q+1
        clc
        lda q
        adc src
        sta t
        lda q+1
        adc src+1
        sta t+1
        clc
        lda t
        adc tmp
        sta t
        bcc kg2
        inc t+1
kg2     inx
        bne kg1
kg4     lda t+1
        bne kg5
        lda t
        cmp #2
        bcc kg8
kg5     lda dst
        cmp len
        lda dst+1
        sbc len+1
        bcs kg8
        lda dst
        sta q
        lda dst+1
        clc
        adc #>BUF
        sta q+1
        ldy #0
        lda (q),y
        inc dst
        bne kg6
        inc dst+1
kg6     cmp #EOL
        bne kg4
        lda t
        bne kg7
        dec t+1
kg7     dec t
        jmp kg4
kg8     lda dst
        cmp len
        lda dst+1
        sbc len+1
        bcc kg3
        lda len
        sec
        sbc #1
        sta dst
        lda len+1
        sbc #0
        sta dst+1
kg3     lda dst
        sta cur
        lda dst+1
        sta cur+1
kg9     jmp loop

; ^R insert a file (up to 2K, uses the cut buffer)
; The file is read into CLIP by rdclip (the name is swapped into fn temporarily, then restored from fn2),
; then pasted with the normal paste code (kp1).
kread   lda #EOL
        sta pb
        lda #<pb
        sta fb
        lda #>pb
        sta fb+1
        lda #<lbr2
        sta pl
        lda #>lbr2
        sta pl+1
        lda #28
        sta fmax
        jsr prompt
        php
        jsr clr21
        plp
        bcc kra9
        lda pb
        cmp #EOL
        beq kra9
        ldx #0
kra1    lda fn,x
        sta fn2,x
        lda pb,x
        sta fn,x
        inx
        cpx #60
        bcc kra1
        jsr fixname
        jsr rdclip
        php
        ldx #0
kra2    lda fn2,x
        sta fn,x
        inx
        cpx #60
        bcc kra2
        plp
        bcs kra8
        lda cl
        ora cl+1
        beq kra7
        jmp kp1
kra7    jsr msg0
        jsr pstr
        .byte 'File is empty',0
        jsr msg1
kra9    jmp loop
kra8    jsr msg0
        jsr pstr
        .byte 'Cannot read that file',0
        jsr msg1
        jmp loop

; read file fn into CLIP: IOCB 1, CIO open (3, ICAX1 = 4 read), get block (7) of up to CLIPMAX bytes; cl = bytes
; read (ICBLL/H after the call). Error 136 (EOF) is fine. Out: carry set = could not open or other error.
rdclip  ldx #$10
        lda #3
        sta ICCOM,x
        lda #<fn
        sta ICBAL,x
        lda #>fn
        sta ICBAH,x
        lda #4
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        sta cl
        sta cl+1
        jsr CIOV
        bpl rdc1
        sec
        rts
rdc1    ldx #$10
        lda #7
        sta ICCOM,x
        lda #<CLIP
        sta ICBAL,x
        lda #>CLIP
        sta ICBAH,x
        lda #<CLIPMAX
        sta ICBLL,x
        lda #>CLIPMAX
        sta ICBLH,x
        jsr CIOV
        sty erc
        ldx #$10
        lda ICBLL,x
        sta cl
        lda ICBLH,x
        sta cl+1
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda erc
        bpl rdc2
        cmp #136
        beq rdc2
        lda #0
        sta cl
        sta cl+1
        sec
        rts
rdc2    clc
        rts

; ^O write file
kwrite  jsr wrfile
        jmp loop

; ^X exit: when modified ask 'Save changes?' (Y writes then exits unless the write failed, N discards, other key cancels)
kexit   lda mod
        beq quit
        jsr msg0
        jsr pstr
        .byte 'Save changes? Y/N, ESC cancels',0
        jsr msg1
        jsr getk
        jsr fold
        cmp #'N'
        beq quit
        cmp #'Y'
        bne kx9
        jsr wrfile
        bcs kx9
        jmp quit
kx9     jmp loop
quit    jmp bye

; ^C show line and column
; Line = (EOLs before cur)+1 (tp); total lines = EOLs in the whole text (dst); column = cur - line start + 1 (src).
kpos    lda cur
        sta t
        lda cur+1
        sta t+1
        jsr cnteol
        lda cnt
        clc
        adc #1
        sta tp
        lda cnt+1
        adc #0
        sta tp+1
        lda len
        sta t
        lda len+1
        sta t+1
        jsr cnteol
        lda cnt
        sta dst
        lda cnt+1
        sta dst+1
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda cur
        sec
        sbc t
        sta src
        lda cur+1
        sbc t+1
        sta src+1
        inc src
        bne kpz
        inc src+1
kpz     jsr msg0
        jsr pstr
        .byte 'Line ',0
        lda tp
        sta t
        lda tp+1
        sta t+1
        jsr dnum
        lda #'/'
        jsr pch
        lda dst
        sta t
        lda dst+1
        sta t+1
        jsr dnum
        jsr pstr
        .byte '  Col ',0
        lda src
        sta t
        lda src+1
        sta t+1
        jsr dnum
        jsr msg1
        jmp loop

; ^G help screen
; Clears rows 1..23, prints a header in inverse video, then each help line with hnl (next row, column 1);
; any key returns. hr = current help row.
khelp   lda #1
        sta hr
kh1     lda #0
        sta inv
        lda hr
        jsr rowclr
        inc hr
        lda hr
        cmp #24
        bcc kh1
        lda #$80
        sta inv
        lda #0
        jsr rowclr
        lda #1
        sta scol
        jsr pstr
        .byte 'NANO HELP    any key goes back',0
        lda #0
        sta inv
        lda #1
        sta hr
        jsr hnl
        jsr pstr
        .byte '^O  Write the file out',0
        jsr hnl
        jsr pstr
        .byte '^X  Exit, asks to save changes',0
        jsr hnl
        jsr pstr
        .byte '^W  Search (same text again: Enter)',0
        jsr hnl
        jsr pstr
        .byte '^K  Cut line, repeat to add lines',0
        jsr hnl
        jsr pstr
        .byte '^U  Paste the cut text',0
        jsr hnl
        jsr pstr
        .byte '^C  Show line and column',0
        jsr hnl
        jsr pstr
        .byte '^R  Insert a file (up to 2K)',0
        jsr hnl
        jsr pstr
        .byte '^T  Go to line number',0
        jsr hnl
        jsr pstr
        .byte '^L  Replace, then Y/N/A each match',0
        jsr hnl
        jsr pstr
        .byte '^A  Start of line   ^E  End of line',0
        jsr hnl
        jsr pstr
        .byte '^V  Page down       ^Y  Page up',0
        jsr hnl
        jsr pstr
        .byte '^D  Delete character under cursor',0
        jsr hnl
        jsr pstr
        .byte 'BACKSPACE  Delete left',0
        jsr hnl
        jsr pstr
        .byte 'TAB  Two spaces',0
        jsr hnl
        jsr pstr
        .byte 'Move: Ctrl + arrow keys, or',0
        jsr hnl
        jsr pstr
        .byte '      ^B left ^F right ^P up ^N down',0
        jsr hnl
        jsr hnl
        jsr pstr
        .byte 'The text area holds about 23K.',0
        jsr hnl
        jsr pstr
        .byte 'In a prompt: ESC cancels.',0
        jsr getk
        jmp loop

; next help row: hr++, clear it, scol = 1
hnl     inc hr
        lda #0
        sta inv
        lda hr
        jsr rowclr
        lda #1
        sta scol
        rts

; ---- editing primitives ----
; Conventions: t, tp, cnt, src, dst, p, q are scratch (clobbered freely by these routines).
; carry clear when the cursor is not on the final EOL; t = cur+1
canfwd  lda cur
        clc
        adc #1
        sta t
        lda cur+1
        adc #0
        sta t+1
        lda t
        cmp len
        lda t+1
        sbc len+1
        rts

; p = address of the cursor in the buffer (BUF + cur)
setp    lda cur
        sta p
        lda cur+1
        clc
        adc #>BUF
        sta p+1
        rts

; insert one character from A at the cursor (cursor moves after it, mod set; 'Buffer full' message if no room)
inschr  sta tmp
        lda #1
        sta cnt
        lda #0
        sta cnt+1
        jsr insgap
        bcc ic1
        jsr msg0
        jsr pstr
        .byte 'Buffer full',0
        jsr msg1
        rts
ic1     jsr setp
        lda tmp
        ldy #0
        sta (p),y
        inc cur
        bne ic2
        inc cur+1
ic2     lda #1
        sta mod
        rts

; open a gap of cnt bytes at the cursor (carry set = no room)
; The text after cur is moved up by cnt with copydn (backwards, since the areas overlap) and len grows by cnt;
; the gap contents are left undefined for the caller to fill. The new length must stay <= MAXL.
insgap  clc
        lda len
        adc cnt
        sta t
        lda len+1
        adc cnt+1
        sta t+1
        bcs ig9
        lda t
        cmp #<(MAXL+1)
        lda t+1
        sbc #>(MAXL+1)
        bcs ig9
        lda t
        sta src
        lda t+1
        sta src+1
        lda len
        sta q
        lda len+1
        clc
        adc #>BUF
        sta q+1
        lda src
        sta p
        lda src+1
        clc
        adc #>BUF
        sta p+1
        sec
        lda len
        sbc cur
        sta t
        lda len+1
        sbc cur+1
        sta t+1
        jsr copydn
        lda src
        sta len
        lda src+1
        sta len+1
        clc
        rts
ig9     sec
        rts

; delete cnt bytes at the cursor: the text after them (len-cur-cnt bytes) is moved down with copyup, len -= cnt
delgap  clc
        lda cur
        adc cnt
        sta q
        lda cur+1
        adc cnt+1
        clc
        adc #>BUF
        sta q+1
        jsr setp
        sec
        lda len
        sbc cur
        sta t
        lda len+1
        sbc cur+1
        sta t+1
        sec
        lda t
        sbc cnt
        sta t
        lda t+1
        sbc cnt+1
        sta t+1
        jsr copyup
        sec
        lda len
        sbc cnt
        sta len
        lda len+1
        sbc cnt+1
        sta len+1
        rts

; copy t bytes from q up to p, lowest address first (p below q, or no overlap)
; Whole pages first (Y = 0..255, t+1 times), then the remaining t low bytes. Clobbers q, p, t, A, Y.
copyup  lda t+1
        beq cu2
cu1     ldy #0
cu1a    lda (q),y
        sta (p),y
        iny
        bne cu1a
        inc q+1
        inc p+1
        dec t+1
        bne cu1
cu2     lda t
        beq cu4
        ldy #0
cu3     lda (q),y
        sta (p),y
        iny
        cpy t
        bne cu3
cu4     rts

; copy t bytes backwards, q and p point just past the end of source and destination
; First the partial page (t low byte) is copied downwards, then t+1 full pages of 256 bytes, high pages first.
copydn  lda t
        beq cd2
        sec
        lda q
        sbc t
        sta q
        bcs cd0a
        dec q+1
cd0a    sec
        lda p
        sbc t
        sta p
        bcs cd0b
        dec p+1
cd0b    ldy t
cd1     dey
        lda (q),y
        sta (p),y
        cpy #0
        bne cd1
cd2     lda t+1
        beq cd5
cd3     dec q+1
        dec p+1
        ldy #255
cd4     lda (q),y
        sta (p),y
        dey
        cpy #255
        bne cd4
        dec t+1
        bne cd3
cd5     rts

; t = offset of the start of the line holding offset t (walks back to just after the previous EOL, or to BUF)
lstart  lda t
        sta q
        lda t+1
        clc
        adc #>BUF
        sta q+1
ls1     lda q
        bne ls2
        lda q+1
        cmp #>BUF
        beq ls9
ls2     lda q
        bne ls3
        dec q+1
ls3     dec q
        ldy #0
        lda (q),y
        cmp #EOL
        bne ls1
        inc q
        bne ls9
        inc q+1
ls9     lda q
        sta t
        lda q+1
        sec
        sbc #>BUF
        sta t+1
        rts

; t = offset of the EOL that ends the line holding offset t
lend    lda t
        sta q
        lda t+1
        clc
        adc #>BUF
        sta q+1
le1     ldy #0
        lda (q),y
        cmp #EOL
        beq le9
        inc q
        bne le1
        inc q+1
        bne le1
le9     lda q
        sta t
        lda q+1
        sec
        sbc #>BUF
        sta t+1
        rts

; cnt = number of EOLs before offset t (t is counted down to 0 and destroyed)
cnteol  lda #0
        sta cnt
        sta cnt+1
        lda #<BUF
        sta q
        lda #>BUF
        sta q+1
ce1     lda t
        ora t+1
        beq ce9
        ldy #0
        lda (q),y
        cmp #EOL
        bne ce2
        inc cnt
        bne ce2
        inc cnt+1
ce2     inc q
        bne ce3
        inc q+1
ce3     lda t
        bne ce4
        dec t+1
ce4     dec t
        jmp ce1
ce9     rts

; remember the wanted column for up / down (only when the previous key was not a vertical move: vfl = 0)
setwant lda vfl
        bne sw9
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        sec
        lda cur
        sbc t
        sta want
        lda cur+1
        sbc t+1
        sta want+1
        lda #1
        sta vfl
sw9     rts

; t = line start, src = offset of its EOL: cur = t + min(want, length)
placecol sec
        lda src
        sbc t
        sta cnt
        lda src+1
        sbc t+1
        sta cnt+1
        lda want
        cmp cnt
        lda want+1
        sbc cnt+1
        bcs pc1
        lda want
        sta cnt
        lda want+1
        sta cnt+1
pc1     clc
        lda t
        adc cnt
        sta cur
        lda t+1
        adc cnt+1
        sta cur+1
        rts

; cursor up: go to the EOL before the current line, find that line's start and place the cursor in the wanted
; column; does nothing on the first line. cdn (below) does the mirror image using the next line's EOL.
cup     jsr setwant
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda t
        ora t+1
        beq cu9
        lda t
        bne cup1
        dec t+1
cup1    dec t
        lda t
        sta src
        lda t+1
        sta src+1
        jsr lstart
        jsr placecol
cu9     rts

cdn     jsr setwant
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lend
        lda t
        clc
        adc #1
        sta p
        lda t+1
        adc #0
        sta p+1
        lda p
        cmp len
        lda p+1
        sbc len+1
        bcs cdn9
        lda p
        sta t
        lda p+1
        sta t+1
        jsr lend
        lda t
        sta src
        lda t+1
        sta src+1
        lda p
        sta t
        lda p+1
        sta t+1
        jsr placecol
cdn9    rts

; ---- view window ----
; setfp: src = address of the end of the text (BUF + len); setcq: dst = address of the cursor (BUF + cur)
setfp   lda len
        sta src
        lda len+1
        clc
        adc #>BUF
        sta src+1
        rts
setcq   lda cur
        sta dst
        lda cur+1
        clc
        adc #>BUF
        sta dst+1
        rts

; p moves to the start of the next screen row (rows are 40 characters, EOL ends a row)
vnext   ldx #0
vn1     lda p
        cmp src
        lda p+1
        sbc src+1
        bcs vn9
        ldy #0
        lda (p),y
        inc p
        bne vn2
        inc p+1
vn2     cmp #EOL
        beq vn9
        inx
        cpx #40
        bcc vn1
vn9     rts

; scroll top so the cursor is on screen
; Cursor above top: top = start of the cursor's line, then walk screen rows (vnext) from there until the cursor
; is passed, keeping the last row start. Cursor below: count rows from top to the cursor; if that is >= TROWS,
; advance top by (rows - (TROWS-1)) screen rows so the cursor lands on the last row. Needs setfp/setcq first.
fixtop  jsr setfp
        jsr setcq
        lda cur
        cmp top
        lda cur+1
        sbc top+1
        bcs ft2
        lda cur
        sta t
        lda cur+1
        sta t+1
        jsr lstart
        lda t
        sta p
        lda t+1
        clc
        adc #>BUF
        sta p+1
ft1     lda p
        sta tp
        lda p+1
        sta tp+1
        jsr vnext
        lda dst
        cmp p
        lda dst+1
        sbc p+1
        bcs ft1
        lda tp
        sta top
        lda tp+1
        sec
        sbc #>BUF
        sta top+1
        rts
ft2     lda top
        sta p
        lda top+1
        clc
        adc #>BUF
        sta p+1
        lda #0
        sta cnt
        sta cnt+1
ft3     jsr vnext
        lda dst
        cmp p
        lda dst+1
        sbc p+1
        bcc ft4
        inc cnt
        bne ft3
        inc cnt+1
        jmp ft3
ft4     lda cnt+1
        bne ft5
        lda cnt
        cmp #TROWS
        bcc ft9
ft5     sec
        lda cnt
        sbc #TROWS-1
        sta cnt
        lda cnt+1
        sbc #0
        sta cnt+1
        lda top
        sta p
        lda top+1
        clc
        adc #>BUF
        sta p+1
ft6     jsr vnext
        lda cnt
        bne ft7
        dec cnt+1
ft7     dec cnt
        lda cnt
        ora cnt+1
        bne ft6
        lda p
        sta top
        lda p+1
        sec
        sbc #>BUF
        sta top+1
ft9     rts

; ---- screen ----
; Redraws everything. Row rowc (1..TROWS): clear it, then copy characters from p (starting at top) converted by
; 'conv' until EOL, 40 columns or the end of the text; when p reaches the cursor address (dst) its row/column are
; saved in crow/ccol. Then the inverse title bar (row 0: name, 'Modified' at column 32) and the two hint rows.
; Finally the cursor cell is inverted (EOR $80). ATRACT is zeroed to stop the attract-mode colour cycling.
draw    lda #0
        sta ATRACT
        jsr setfp
        jsr setcq
        lda #$FF
        sta crow
        lda top
        sta p
        lda top+1
        clc
        adc #>BUF
        sta p+1
        lda #1
        sta rowc
dw1     lda #0
        sta inv
        lda rowc
        jsr rowclr
        lda p
        cmp src
        lda p+1
        sbc src+1
        bcs dw9
        ldx #0
dw2     cpx #40
        bcs dw9
        lda p
        cmp dst
        bne dw3
        lda p+1
        cmp dst+1
        bne dw3
        stx ccol
        lda rowc
        sta crow
dw3     ldy #0
        lda (p),y
        inc p
        bne dw4
        inc p+1
dw4     cmp #EOL
        beq dw9
        jsr conv
        pha
        txa
        tay
        pla
        sta (sp),y
        inx
        jmp dw2
dw9     inc rowc
        lda rowc
        cmp #TROWS+1
        bcc dw1
; title row
        lda #$80
        sta inv
        lda #0
        jsr rowclr
        lda #1
        sta scol
        jsr pstr
        .byte 'NANO  ',0
        lda fn
        cmp #EOL
        beq dt1
        lda #<fn
        sta T1
        lda #>fn
        sta T1+1
        jsr pmem
        jmp dt2
dt1     jsr pstr
        .byte 'New Buffer',0
dt2     lda mod
        beq dt3
        lda #32
        sta scol
        jsr pstr
        .byte 'Modified',0
dt3     lda #22
        jsr rowclr
        jsr pstr
        .byte '^G Help  ^O Write  ^W Search  ^K Cut',0
        lda #23
        jsr rowclr
        jsr pstr
        .byte '^X Exit  ^U Paste  ^C Pos  ^V/^Y Page',0
        lda crow
        cmp #$FF
        beq dtx
        jsr setrow
        ldy ccol
        lda (sp),y
        eor #$80
        sta (sp),y
dtx     rts

; A = row: sp = screen address of that row (SAVMSC + 40 * row)
setrow  tax
        lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        cpx #0
        beq sr9
sr1     lda sp
        clc
        adc #40
        sta sp
        bcc sr2
        inc sp+1
sr2     dex
        bne sr1
sr9     rts

; fill row A with the inv byte, column pointer to 0
rowclr  jsr setrow
        ldy #39
        lda inv
rc1     sta (sp),y
        dey
        bpl rc1
        lda #0
        sta scol
        rts

; screen code for the ATASCII byte in A (result in A)
; ATASCII $00-$1F -> screen code +$40, $20-$5F -> -$20, $60-$7F unchanged; bit 7 (inverse) is kept.
; (the 'adc #64' at cv1 relies on carry being clear after the failed 'cmp #32')
conv    sta cvt
        and #$7F
        cmp #32
        bcc cv1
        cmp #96
        bcs cv2
        sec
        sbc #32
        bcs cv2
cv1     adc #64
cv2     sta cvu
        lda cvt
        and #$80
        ora cvu
        rts

; write ATASCII A at the screen column scol, then advance
pch     jsr conv
        ora inv
        ldy scol
        sta (sp),y
        inc scol
        rts

; print the 0 terminated text that follows the jsr (inline string): the return address on the stack points at
; the last byte of the jsr, so it is popped into T0, walked and finally pushed back after the terminating 0.
; The text goes to the screen row set by rowclr/setrow, at column scol, via pch.
pstr    pla
        sta T0
        pla
        sta T0+1
ps1     inc T0
        bne ps2
        inc T0+1
ps2     ldy #0
        lda (T0),y
        beq ps3
        jsr pch
        jmp ps1
ps3     lda T0+1
        pha
        lda T0
        pha
        rts

; print the EOL terminated text at T1
pmem    lda #0
        sta pi
pm1     ldy pi
        lda (T1),y
        cmp #EOL
        beq pm9
        jsr pch
        inc pi
        bne pm1
pm9     rts

; print t as a decimal number without leading zeros
; Repeated subtraction of 10000,1000,100,10,1 (tables dl/dh); the last digit is always printed. t is destroyed.
dnum    ldx #0
        lda #0
        sta cnt
dn1     lda #0
        sta cnt+1
dn2     lda t
        sec
        sbc dl,x
        pha
        lda t+1
        sbc dh,x
        bcc dn3
        sta t+1
        pla
        sta t
        inc cnt+1
        jmp dn2
dn3     pla
        lda cnt+1
        ora cnt
        bne dn4
        cpx #4
        bne dn5
dn4     lda #1
        sta cnt
        lda cnt+1
        ora #'0'
        jsr pch
dn5     inx
        cpx #5
        bcc dn1
        rts
dl      .byte <10000,<1000,<100,<10,<1
dh      .byte >10000,>1000,>100,>10,>1

; message line (row 21): "[ text ]"; use msg0, then pstr/dnum to print the text, then msg1
msg0    lda #0
        sta inv
        lda #21
        jsr rowclr
        lda #'['
        jsr pch
        lda #' '
        jmp pch
msg1    lda #' '
        jsr pch
        lda #']'
        jmp pch
; clear the message row
clr21   lda #0
        sta inv
        lda #21
        jmp rowclr

; upper case A (lower case letters only; AND $DF clears bit 5)
fold    cmp #'a'
        bcc fo9
        cmp #'z'+1
        bcs fo9
        and #$DF
fo9     rts

; line input on row 21: pl = label, fb = text (EOL terminated, edited in place), fmax = longest
; carry set = Enter, carry clear = ESC
; carry set = Enter, carry clear = ESC (^C also cancels). Accepts printable keys 32..124 and BACKSPACE (126).
; The current text is shown after the label with an inverse blank as cursor.
prompt  ldy #0
pr0     lda (fb),y
        cmp #EOL
        beq pr1
        iny
        bne pr0
pr1     sty fl
prl     lda #0
        sta inv
        lda #21
        jsr rowclr
        lda pl
        sta T1
        lda pl+1
        sta T1+1
        jsr pmem
        lda fb
        sta T1
        lda fb+1
        sta T1+1
        jsr pmem
        lda #$80
        ldy scol
        sta (sp),y
        jsr getk
        cmp #EOL
        beq pracc
        cmp #27
        beq prcan
        cmp #3
        beq prcan
        cmp #126
        bne pr2
        ldy fl
        beq prl
        dey
        sty fl
        lda #EOL
        sta (fb),y
        jmp prl
pr2     cmp #32
        bcc prl
        cmp #125
        bcs prl
        ldy fl
        cpy fmax
        bcs prl
        sta (fb),y
        iny
        lda #EOL
        sta (fb),y
        sty fl
        jmp prl
pracc   sec
        rts
prcan   clc
        rts

; ---- files ----
; make fn a full file spec: when it has no ':' the shift loop moves the name up two bytes and puts 'D:' in
; front (the string is stored EOL terminated; the name ends at the first blank or EOL)
fixname ldx #0
fx1     lda fn,x
        cmp #':'
        beq fx9
        cmp #EOL
        beq fx2
        cmp #' '
        beq fx2
        inx
        bne fx1
fx2     lda #EOL
        sta fn+2,x
fx3     lda fn-1,x
        sta fn+1,x
        dex
        bpl fx3
        lda #'D'
        sta fn
        lda #':'
        sta fn+1
fx9     rts

; empty buffer: just the final EOL
newbuf  lda #1
        sta len
        lda #0
        sta len+1
        lda #EOL
        sta BUF
        rts

; load fn into BUF through IOCB 1: open for read (ICAX1 = 4); error 170 (file not found) starts a new buffer with
; tflag = 2, other errors go to 'fail'. One get-block (7) of up to MAXL bytes; error 136 (EOF) is the normal end,
; a full buffer sets tflag = 1 ('File too long'). len = bytes read; ensures the text ends with an EOL.
loadf   ldx #$10
        lda #3
        sta ICCOM,x
        lda #<fn
        sta ICBAL,x
        lda #>fn
        sta ICBAH,x
        lda #4
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        bpl lf1
        cpy #170
        beq lfnew
        jmp fail
lfnew   jsr newbuf
        lda #2
        sta tflag
        rts
lf1     ldx #$10
        lda #7
        sta ICCOM,x
        lda #<BUF
        sta ICBAL,x
        lda #>BUF
        sta ICBAH,x
        lda #<MAXL
        sta ICBLL,x
        lda #>MAXL
        sta ICBLH,x
        jsr CIOV
        cpy #136
        beq lf2
        tya
        bpl lf1t
        jmp fail
lf1t    lda #1
        sta tflag
lf2     ldx #$10
        lda ICBLL,x
        sta len
        lda ICBLH,x
        sta len+1
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda len
        ora len+1
        bne lf3
        jmp newbuf
lf3     lda len
        sta q
        lda len+1
        clc
        adc #>BUF
        sta q+1
        lda q
        bne lf4
        dec q+1
lf4     dec q
        ldy #0
        lda (q),y
        cmp #EOL
        beq lf9
        inc q
        bne lf5
        inc q+1
lf5     lda #EOL
        sta (q),y
        inc len
        bne lf9
        inc len+1
lf9     rts

; ^O: ask for the name and write the buffer. Carry clear = written.
; The prompt starts with the current name (pb); a changed name becomes the new fn. Empty or ESC = 'Cancelled'.
wrfile  ldx #0
wf1     lda fn,x
        sta pb,x
        cmp #EOL
        beq wf2
        inx
        cpx #60
        bcc wf1
wf2     lda #<pb
        sta fb
        lda #>pb
        sta fb+1
        lda #<lbw
        sta pl
        lda #>lbw
        sta pl+1
        lda #28
        sta fmax
        jsr prompt
        php
        jsr clr21
        plp
        bcc wf8
        lda pb
        cmp #EOL
        beq wf8
        ldx #0
wf3     lda pb,x
        sta fn,x
        cmp #EOL
        beq wf4
        inx
        cpx #60
        bcc wf3
wf4     jmp savefile
wf8     jsr msg0
        jsr pstr
        .byte 'Cancelled',0
        jsr msg1
        sec
        rts

; close IOCB 1, open fn for write (ICAX1 = 8), put block (11) of len bytes from BUF, close. erc keeps the error
; code of the write so the close cannot hide it. Success clears mod and shows 'Wrote n bytes' (carry clear);
; an error shows its code (carry set).
savefile jsr fixname
        ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
        ldx #$10
        lda #3
        sta ICCOM,x
        lda #<fn
        sta ICBAL,x
        lda #>fn
        sta ICBAH,x
        lda #8
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        bmi sv1
        ldx #$10
        lda #11
        sta ICCOM,x
        lda #<BUF
        sta ICBAL,x
        lda #>BUF
        sta ICBAH,x
        lda len
        sta ICBLL,x
        lda len+1
        sta ICBLH,x
        jsr CIOV
        sty erc
        ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda erc
        bmi sv2
        lda #0
        sta mod
        jsr msg0
        jsr pstr
        .byte 'Wrote ',0
        lda len
        sta t
        lda len+1
        sta t+1
        jsr dnum
        jsr pstr
        .byte ' bytes',0
        jsr msg1
        clc
        rts
sv1     sty erc
        ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
sv2     jsr msg0
        jsr pstr
        .byte 'Error ',0
        lda erc
        sta t
        lda #0
        sta t+1
        jsr dnum
        jsr pstr
        .byte ' writing the file',0
        jsr msg1
        sec
        rts

; ---- console / keyboard ----
; putc: print A on the screen editor (IOCB 0) with CIO put-char (ICCOM 11, length 0). Used outside the editor
; (prompt before start, error text on exit); the editor itself writes to screen memory.
putc    ldx #0
        stx ICBLL
        stx ICBLH
        ldx #11
        stx ICCOM
        ldx #0
        jmp CIOV

; print the 0 terminated text that follows the jsr through putc (same inline-string trick as pstr)
putsi   pla
        sta T0
        pla
        sta T0+1
        ldy #0
pi1     inc T0
        bne pi2
        inc T0+1
pi2     lda (T0),y
        beq pi3
        jsr putc
        ldy #0
        jmp pi1
pi3     lda T0+1
        pha
        lda T0
        pha
        rts

; wait for a key from K: (IOCB 7, get-char). Out: A = ATASCII code (0 on CIO error). Resets ATRACT.
getk    ldx #$70
        lda #7
        sta ICCOM,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        sta ATRACT
        jsr CIOV
        cpy #128
        bcc gk1
        lda #0
gk1     rts

; file could not be opened / read at startup: message, then fall into bye
fail    jsr putsi
        .byte 'CAN',39,'T OPEN OR READ THE FILE',EOL,0
; leave: close IOCB 7 and 1, restore SHFLOK and the cursor, clear the screen, return to DOS
bye     ldx #$70
        lda #12
        sta ICCOM,x
        jsr CIOV
        ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda oldshf
        sta SHFLOK
        lda #0
        sta CRSINH
        lda #125
        jsr putc
        jmp (DOSVEC)

; ---- data ----
; HAND = CMD hand-over block; kspec = device name for K:; lb* = prompt labels (EOL terminated); rmode / rall / slen
; = replace mode, replace-all flag, match length; gb = line number input, rb = replacement text, fn2 = saved
; file name for ^R, inb = search text, pb = ^O / ^R name input, fn = current file name.
HAND    = $0480
kspec   .byte 'K:',EOL
lbs     .byte 'Search: ',EOL
lbw     .byte 'Write to: ',EOL
lbr     .byte 'Replace with: ',EOL
lbr2    .byte 'Insert file: ',EOL
lbg     .byte 'Line number: ',EOL
rmode   .byte 0
rall    .byte 0
slen    .byte 0
rx      .byte 0
gb      .ds 8
rb      .ds 32
fn2     .ds 64
inb     .ds 32
pb      .ds 64
fn      .ds 64
        run start
