; MEMTEST.COM - sizes main RAM, finds extended (banked) RAM on XL/XE and tests every distinct 16K bank through the
; $4000-$7FFF window with four phases (address pattern, fixed 55/AA, random data, random read/write) plus a
; cross-bank check. Colour block map: grey idle, yellow testing, green good, red bad. B at the prompt = burn-in
; (repeat passes until a key is pressed). Program and screen buffers stay below $4000.
;
; USAGE: run it, read the memory summary, then press B for burn-in (loops until any key) or any other key
;   for one pass. At the end any key exits. A key press during burn-in sets stopf and ends after the
;   current cell. RESULT is PASS when the error count (errs) is 0, otherwise FAIL (red) with the first
;   error shown (bank, address, PORTB value).
;
; HOW IT TESTS: each "cell" of the map is one RAM region seen through the window $4000-$7FFF: cell 0 = main
;   RAM, cell n = extended bank n. For each cell the program selects the bank by writing PORTB ($D301),
;   then runs 4 phases over pages pstart..pend: (1) address pattern: byte = offset xor page xor bank no.
;   xor mask, written then verified, once with mask 0 and once with $FF; (2) fixed $55 then $AA, fill
;   then verify; (3) pseudo-random fill and verify; (4) 8192 random-address write / readback /
;   complement / readback. A 5th step (xbank) writes a signature into each bank and checks all
;   signatures afterwards to catch aliased banks. Any mismatch calls `err`; the cell turns red.
;   Pass/fail of a cell = no mismatch (bad = 0).
;
; DETECTION: detxl looks for ROM at $C000 (XL/XE) and romtest checks that RAM appears there with ROM
;   paged out (PORTB bit 0 = 0). findbanks tries 64 PORTB bank combinations (mkpb) writing distinct
;   values at $4000 and keeps one PORTB value per distinct bank in reps[] (nrep = count).
;
; SCREEN (cscreen.inc, NA = 7 text rows, NMAP = 4 map rows = up to 80 cells, NB = 6 text rows): DLI
;   per row colours the bars, VBI hook resets the DLI row counter. Rows: 0 title, 1 machine type, 2 OS
;   RAM, 3 extended banks, 4 CPU, 5 total, 6 legend; below the map 7 pass/phase, 8 current cell, 9 error
;   count + elapsed time, 10 first error / passes done, 11 RUNNING / RESULT, 12 prompt.
;
; MEMORY: code and screen buffers stay below $4000 (the window under test). Zero page $90-$C3 holds the
;   variables below ($90-$C3 is cleared at start); ptr ($90) low byte is always 0 so (ptr),y walks pages.
;
; EXTENDING: a new test phase is a routine that loops pstart..pend page by page, calls `tick` and
;   `chkpg` per page, calls `err` on mismatch (Y = offset, ptr+1 = page), and is added to testcell
;   with a phase string in pnl/pnh (and showphase's "/5" count).
        org $2000
        jmp start
        icl 'common.inc'
NA      = 7
NMAP    = 4
NB      = 6
        icl 'cscreen.inc'

ptr     = $90           ; low byte kept at 0
idx     = $92           ; bank number used in the address pattern
mask    = $93           ; address pattern mask ($00 or $FF)
errs    = $94           ; total error count (16-bit)
ff      = $96           ; 1 once the first error has been recorded
fpb     = $97           ; first error: PORTB value
fad     = $98           ; first error: address (lo, hi)
pbsave  = $9A           ; PORTB value at start (restored after every test); $FF on a 400/800
nrep    = $9B           ; number of distinct extended banks
xl      = $9C           ; 1 = XL/XE (ROM at $C000)
curpb   = $9D           ; PORTB value for the cell being tested
bankno  = $9E           ; cell/bank number (0 = main)
selft   = $9F           ; nonzero if the self-test ROM window ($5000-$57FF) is mapped in the bank under test
vf      = $A0           ; dopass: 0 = write, 1 = verify
romram  = $A1           ; 1 = RAM under the OS ROM at $C000
kb      = $A2           ; main RAM size in KB
fbk     = $A5           ; first error: bank
rs      = $A6           ; running random value
rs0     = $A7           ; random seed for this cell
pstart  = $A8           ; first page tested
pend    = $A9           ; page after the last tested (exclusive)
burn    = $AA           ; 1 = burn-in mode
passn   = $AB           ; pass counter (16-bit)
stopf   = $AD           ; set when a key stops burn-in
cell    = $AE           ; current map cell
hz      = $AF           ; frames per second (50 PAL, 60 NTSC)
tacc    = $B0           ; frame accumulator for the clock
lastt   = $B1           ; last RTCLOK+2 value seen
ss      = $B2           ; elapsed seconds / minutes / hours
mm      = $B3
hh      = $B4
bad     = $B5           ; set when the current cell has had an error
pv      = $B6           ; pattern byte being written / compared
cputype = $BA           ; 0 = 6502, 1 = 65C02, 2 = 65C816
pv2     = $BB           ; complement byte (stress test)
scnt    = $BC           ; stress iteration counter (16-bit)
lastss  = $BE           ; last seconds value drawn
patx    = $BF
phase   = $C0           ; current phase 0-4
ncell   = $C1           ; number of map cells = nrep + 1
bx      = $C2
aborted = $C3           ; 1 if the run was stopped mid-pass (the partial pass is not counted)

; start: clear zero page $90-$C3, detect the CPU, save PORTB, pick the frame rate from PALNTS (bits 1-3
; zero = PAL = 50 Hz, otherwise 60 Hz), build the screen and print the machine summary (main RAM from
; RAMTOP, XL/XE and ROM-RAM detection, extended banks, CPU, total). Then ask for burn-in and run the
; passes: main RAM first (pages $40 up to RAMTOP-5 or $80), then each bank, then the cross-bank check.
start   lda #1
        sta CRSINH
        ldx #$33
        lda #0
zl      sta $90,x
        dex
        bpl zl
        jsr cpudet
        sta cputype
        lda PORTB
        sta pbsave
        lda PALNTS
        and #$0E        ; GTIA PAL/NTSC bits; zero appears to mean PAL
        beq ispal
        lda #60
        bne sethz
ispal   lda #50
sethz   sta hz
        jsr gs_init
        lda RTCLOK+2
        sta lastt
        ldx #0
        lda #1
        jsr bar
        loc 0,0
        say s_title

        ; OS-visible RAM (RAMTOP is in pages; /4 = KB)
        lda RAMTOP
        lsr
        lsr
        sta kb
        jsr detxl
        loc 0,1
        lda xl
        bne isxl
        say s_800
        lda #$FF
        sta pbsave      ; no banking on a 400/800: use a neutral PORTB value
        jmp noxl
isxl    say s_xl
        jsr romtest
noxl    loc 0,2
        say s_main
        lda kb
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        say s_kbr
        lda RAMTOP
        jsr puthex
        lda xl
        beq nx1
        say s_rom
        lda romram
        beq rom_no
        say s_yes
        lda RAMTOP
        cmp #$C0
        bcc nx1
        lda #64         ; RAMTOP at $C000 and RAM under the OS ROM: count it as a full 64K
        sta kb
        jmp nx1
rom_no  say s_no
nx1     lda RAMTOP      ; look for banks only on an XL/XE with at least 16K of main RAM
        cmp #$40
        bcc nobanks
        lda xl
        beq nobanks
        jsr findbanks
nobanks loc 0,3
        say s_ext
        lda nrep
        beq noext
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        say s_banks
        jsr nrep16
        jsr putdec
        say s_kb
        jmp ext9
noext   say s_none
ext9    loc 0,4
        say s_cpu
        ldx cputype
        lda cpnl,x
        ldy cpnh,x
        jsr puts
        ; total = main + 16 * banks
        jsr nrep16
        clc
        lda v16
        adc kb
        sta v16
        lda v16+1
        adc #0
        sta v16+1
        loc 0,5
        say s_total
        jsr putdec
        say s_kb
        ldx #5
        lda #2
        jsr bar
        loc 0,6
        say s_leg
        ; block map, one cell for main RAM plus one per bank
        lda nrep
        clc
        adc #1
        sta ncell
        ldx #0
mp1     lda #1
        sta cst,x
        jsr mapset
        inx
        cpx ncell
        bne mp1
        loc 0,12
        say s_ask
        jsr getkey
        cmp #$15        ; KBCODE $15 = the B key
        bne single
        lda #1
        sta burn
single  ldx #12
        jsr clrrow
        lda burn
        beq nostop
        loc 0,12
        say s_stop
nostop  loc 22,9
        say s_el
        ldx #11
        lda #3
        jsr bar
        loc 0,11
        say s_run
        lda RTCLOK+2
        sta lastt

; passlp: one full pass. Reset non-red cells to grey, test main RAM (cell 0, pages $40..pend where pend =
; RAMTOP-5 capped at $80; skipped if it would be <= $40), then every bank (cell n, PORTB = reps[n-1],
; pend = $80), then xbank. Loops again if burn-in and not stopped.
passlp  inc passn
        bne pn1
        inc passn+1
pn1     ldx #0
rc1     lda cst,x
        cmp #2
        beq rc2
        lda #1
        sta cst,x
rc2     lda cst,x
        jsr mapset
        inx
        cpx ncell
        bne rc1
        ; main RAM
        lda #0
        sta cell
        sta bankno
        lda pbsave
        sta curpb
        lda #$40
        sta pstart
        lda RAMTOP
        sec
        sbc #5          ; keep clear of the top pages (screen and OS use below RAMTOP)
        cmp #$80
        bcc m1
        lda #$80        ; window ends at $7FFF
m1      sta pend
        cmp #$41
        bcc skipm       ; nothing to test if RAM does not reach past $4000
        jsr testcell
skipm   lda #$80
        sta pend
        ldx #0
bl1     cpx nrep
        beq bldone
        stx bx
        inx
        stx cell
        stx bankno
        dex
        lda reps,x
        sta curpb
        jsr testcell
        lda stopf
        bne abort
        ldx bx
        inx
        jmp bl1
bldone  jsr xbank
        lda burn
        beq endrun
        lda stopf
        bne endrun
        jmp passlp
abort   lda #1
        sta aborted
endrun  jsr showerr
        lda errs
        ora errs+1
        bne rfail
        ldx #11
        lda #2
        jsr bar
        ldx #11
        jsr clrrow
        loc 0,11
        say s_pass
        jmp rdone
rfail   ldx #11
        lda #4
        jsr bar
        ldx #11
        jsr clrrow
        loc 0,11
        say s_fail
rdone   lda errs
        ora errs+1
        bne rd2
        ldx #10
        jsr clrrow
        loc 0,10
        say s_done
        lda passn
        sec
        sbc aborted
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        say s_ps
rd2     ldx #12
        jsr clrrow
        loc 0,12
        say s_any
        jsr getkey
        lda #0
        sta CRSINH
        jmp gs_off

; nrep16: v16 = nrep * 16 (KB of extended RAM). Clobbers A.
nrep16  lda nrep
        sta v16
        lda #0
        sta v16+1
        asl v16
        rol v16+1
        asl v16
        rol v16+1
        asl v16
        rol v16+1
        asl v16
        rol v16+1
        rts

; detxl: xl = 1 if the 16 bytes at $C000 are not all equal, i.e. OS ROM is present (XL/XE); a 400/800
; has no ROM there (constant/floating). Clobbers A, X.
detxl   lda #0
        sta xl
        ldx #15
dx1     lda $C000,x
        cmp $C000
        bne dxyes
        dex
        bpl dx1
        rts
dxyes   lda #1
        sta xl
        rts

; romtest: sets romram = 1 if $C000 holds writable RAM with the OS ROM paged out (PORTB bit 0 = 0).
; Interrupts/NMIs are off meanwhile (the OS would be unmapped). Writes $A5 and $5A and reads them back,
; restores the original byte and PORTB, then re-enables NMIs ($C0). Clobbers A, t1, t2.
romtest sei
        lda #0
        sta NMIEN
        lda $C000
        sta t1
        lda pbsave
        and #$FE
        sta PORTB
        lda $C000
        sta t2
        lda #$A5
        sta $C000
        lda $C000
        cmp #$A5
        bne rt1
        lda #$5A
        sta $C000
        lda $C000
        cmp #$5A
        bne rt1
        lda #1
        sta romram
rt1     lda t2
        sta $C000
        lda pbsave
        sta PORTB
        lda #$C0
        sta NMIEN
        cli
        rts

; mkpb: A = bank number 0..63 -> A = PORTB value for "combo A" (CPU sees extended RAM because bit 4 stays
; 0, OS ROM on via bit 0). Bank number bits 0..5 appear to map to PORTB bits 1, 2, 3, 5, 6, 7 (bit 4 is
; the CPU/ANTIC select), i.e. a wider scheme than the standard 130XE two-bit one. Clobbers t1, t2.
mkpb    sta t1
        and #1
        asl
        sta t2
        lda t1
        and #6
        asl
        ora t2
        sta t2
        lda t1
        and #8
        asl
        asl
        ora t2
        sta t2
        lda t1
        and #$30
        asl
        asl
        ora t2
        ora #1
        rts

; findbanks: fills reps[] with one PORTB value per distinct 16K bank, nrep = count. Interrupts off.
; Step 1: write $55 at $4000 in main RAM, $AA via bank combo 0; if main reads back $AA there is no
; extended RAM (combo 0 aliases main). Step 2 (fb1): write $40+n at $4000 under each of the 64
; combos. Step 3 (fb2): read them back; combos whose value survived are distinct banks (aliases
; get overwritten by a later combo). $4000 and PORTB are restored. Clobbers A, X, Y, t1-t3.
findbanks
        sei
        lda #0
        sta NMIEN
        lda $4000
        sta t3
        lda pbsave
        sta PORTB
        lda #$55
        sta $4000
        lda #0
        jsr mkpb
        sta PORTB
        lda #$AA
        sta $4000
        lda pbsave
        sta PORTB
        lda $4000
        cmp #$AA
        bne fb_ext
        lda t3
        sta $4000
        jmp fb_end
fb_ext  ldx #0
fb1     txa
        jsr mkpb
        sta PORTB
        txa
        clc
        adc #$40
        sta $4000
        inx
        cpx #64
        bne fb1
        ldx #0
fb2     txa
        jsr mkpb
        sta PORTB
        sta t2
        txa
        clc
        adc #$40
        cmp $4000
        bne fb3
        ldy nrep
        lda t2
        sta reps,y
        inc nrep
fb3     inx
        cpx #64
        bne fb2
        lda pbsave
        sta PORTB
        lda t3
        sta $4000
fb_end  lda pbsave
        sta PORTB
        lda #$C0
        sta NMIEN
        cli
        rts

; testcell: test one cell (main RAM or a bank): cell, curpb, bankno, pstart, pend set by the caller.
; Marks the cell yellow, shows the label, seeds rs0 from RANDOM, selects the bank (PORTB = curpb), runs
; the four phases, restores PORTB, then marks the cell red if any error occurred (bad), else green
; (a cell already red stays red across passes). Falls through to showerr. Clobbers everything.
testcell
        ldx cell
        lda #0
        jsr mapset
        ldx #8
        jsr clrrow
        loc 0,8
        lda cell
        bne tc_b
        say s_tm
        jmp tc_go
tc_b    say s_tb
        lda cell
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        say s_of
        lda nrep
        sta v16
        lda #0
        sta v16+1
        jsr putdec
tc_go   lda #0
        sta bad
        lda curpb
        and #$80
        eor #$80        ; selft = $80 if PORTB bit 7 = 0 (self-test ROM mapped at $5000-$57FF)
        sta selft
        lda RANDOM
        ora #1          ; nonzero seed for the random phase
        sta rs0
        lda curpb
        sta PORTB
        lda #0
        sta phase
        jsr showphase
        jsr dopass4
        inc phase
        jsr showphase
        jsr dopat
        inc phase
        jsr showphase
        jsr dorand
        inc phase
        jsr showphase
        jsr dostress
        lda pbsave
        sta PORTB
        ldx cell
        lda bad
        beq tc_ok
        lda #2
        sta cst,x
        bne tc_dr
tc_ok   lda cst,x
        cmp #2
        beq tc_dr
        lda #3
        sta cst,x
tc_dr   lda cst,x
        jsr mapset
        jmp showerr

; showphase: row 7 = "Pass n  Phase k/5 <name>" for the current `phase` (0-4). Clobbers A, X, Y, v16.
showphase
        ldx #7
        jsr clrrow
        loc 0,7
        say s_passn
        lda passn
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        say s_ph
        lda phase
        clc
        adc #'1'
        jsr putc
        lda #'/'
        jsr putc
        lda #'5'
        jsr putc
        lda #' '
        jsr putc
        ldx phase
        lda pnl,x
        ldy pnh,x
        jmp puts

; showerr: row 9 = error count; if an error has been recorded (ff) turn row 10 red and show the first
; error: bank, address (fad) and PORTB value (fpb). Clobbers A, X, Y, v16.
showerr loc 0,9
        say s_err
        lda errs
        sta v16
        lda errs+1
        sta v16+1
        jsr putdec
        say s_sp6
        lda ff
        beq se9
        ldx #10
        lda #4
        jsr bar
        ldx #10
        jsr clrrow
        loc 0,10
        say s_first
        lda fbk
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        say s_at
        lda fad+1
        jsr puthex
        lda fad
        jsr puthex
        say s_pb
        lda fpb
        jsr puthex
se9     rts

; tick: called once per tested page. Seconds clock from RTCLOK (frame deltas accumulate in tacc and
; roll over at hz = frames/second into ss/mm/hh), a key press (CH <> $FF) sets stopf during burn-in,
; and the elapsed time is redrawn at row 9 col 31 when the seconds change. Also resets ATRACT.
; Clobbers A, X, Y.
tick    lda #0
        sta ATRACT
        lda burn
        beq tk0
        lda CH
        cmp #$FF
        beq tk0
        lda #1
        sta stopf
tk0     lda RTCLOK+2
        tax
        sec
        sbc lastt
        stx lastt
        clc
        adc tacc
        sta tacc
tk1     lda tacc
        cmp hz
        bcc tk9
        sec
        sbc hz
        sta tacc
        inc ss
        lda ss
        cmp #60
        bcc tk1
        lda #0
        sta ss
        inc mm
        lda mm
        cmp #60
        bcc tk1
        lda #0
        sta mm
        inc hh
        jmp tk1
tk9     lda ss
        cmp lastss
        beq tk10
        sta lastss
        loc 31,9
        lda hh
        jsr put2
        lda #':'
        jsr putc
        lda mm
        jsr put2
        lda #':'
        jsr putc
        lda ss
        jsr put2
tk10    rts

; put2: print A (0..59) as two decimal digits. Clobbers A, X, Y.
put2    ldx #'0'
p2a     cmp #10
        bcc p2b
        sbc #10
        inx
        bne p2a
p2b     pha
        txa
        jsr putc
        pla
        clc
        adc #'0'
        jmp putc

; chkpg: A = 1 if page ptr+1 must be skipped, else 0. Skipped when the bank under test has the self-test
; ROM mapped (selft) and the page is in $50-$57, which is where that ROM overlays RAM. Clobbers A.
chkpg   lda selft
        beq cp_ok
        lda ptr+1
        and #$F8
        cmp #$50
        bne cp_ok
        lda #1
        rts
cp_ok   lda #0
        rts

; dopass4 (PHASE 1, address pattern): byte = offset xor page xor bank number xor mask. Runs dopass four
; times: write+verify with mask 0, then write+verify with mask $FF (the inverse pattern), so each cell
; is written with unique, address-dependent data that detects stuck bits and address-line aliasing.
dopass4 lda bankno
        sta idx
        lda #0
        sta vf
        sta mask
        jsr dopass
        inc vf
        jsr dopass
        lda #$FF
        sta mask
        lda #0
        sta vf
        jsr dopass
        inc vf
        jmp dopass

; dopass: one sweep over pages pstart..pend-1. vf = 0 writes the pattern, vf = 1 compares and calls
; `err` (Y = offset, ptr+1 = page) on a mismatch. Calls tick and chkpg per page. Clobbers A, X, Y.
dopass  lda pstart
        sta ptr+1
pgl     jsr tick
        jsr chkpg
        bne pgskip
        ldy #0
bl      tya
        eor ptr+1
        eor idx
        eor mask
        ldx vf
        bne chk
        sta (ptr),y
        jmp nx
chk     cmp (ptr),y
        beq nx
        jsr err
nx      iny
        bne bl
pgskip  inc ptr+1
        lda ptr+1
        cmp pend
        bne pgl
        rts

; dopat (PHASE 2): fixed patterns. Fill the whole range with $55 (dofc), verify (dovc), then the same
; with $AA: every bit is tested at both 0 and 1 (checkerboard-style, adjacent bits differ).
; dofc fills pstart..pend-1 with pv; dovc verifies each byte equals pv, else `err`.
dopat   lda #$55
        sta pv
        jsr dofc
        jsr dovc
        lda #$AA
        sta pv
        jsr dofc
        jmp dovc

dofc    lda pstart
        sta ptr+1
dfc1    jsr tick
        jsr chkpg
        bne dfc3
        ldy #0
        lda pv
dfc2    sta (ptr),y
        iny
        bne dfc2
dfc3    inc ptr+1
        lda ptr+1
        cmp pend
        bne dfc1
        rts

dovc    lda pstart
        sta ptr+1
dvc1    jsr tick
        jsr chkpg
        bne dvc3
        ldy #0
dvc2    lda (ptr),y
        cmp pv
        beq dvc2a
        jsr err
dvc2a   iny
        bne dvc2
dvc3    inc ptr+1
        lda ptr+1
        cmp pend
        bne dvc1
        rts

; dorand (PHASE 3): pseudo-random fill and verify (seed from POKEY RANDOM, x = 5x+$3D, mixed with the page
; number). The same sequence is regenerated from rs0 for the verify pass, so any changed byte is an
; error. (asl asl = x4, plus x = 5x.) Clobbers A, Y, rs, ptr.
dorand  lda rs0
        sta rs
        lda pstart
        sta ptr+1
drf1    jsr tick
        jsr chkpg
        bne drf3
        lda rs
        eor ptr+1
        sta rs
        ldy #0
drf2    lda rs
        asl
        asl
        clc
        adc rs
        clc
        adc #$3D
        sta rs
        sta (ptr),y
        iny
        bne drf2
drf3    inc ptr+1
        lda ptr+1
        cmp pend
        bne drf1
        lda rs0
        sta rs
        lda pstart
        sta ptr+1
drv1    jsr tick
        jsr chkpg
        bne drv3
        lda rs
        eor ptr+1
        sta rs
        ldy #0
drv2    lda rs
        asl
        asl
        clc
        adc rs
        clc
        adc #$3D
        sta rs
        cmp (ptr),y
        beq drv2a
        jsr err
drv2a   iny
        bne drv2
drv3    inc ptr+1
        lda ptr+1
        cmp pend
        bne drv1
        rts

; dostress (PHASE 4): random address, random value: write, read back, write the complement, read back.
; 8192 operations ($20 x 256) per cell; address = random page in pstart..pend-1 and random offset (chkpg
; pages skipped). A readback mismatch calls `err`. Exercises random access order / refresh behaviour.
dostress
        lda #0
        sta scnt
        sta scnt+1
st1     lda RANDOM
        and #$3F
        clc
        adc pstart
        cmp pend
        bcs st1
        sta ptr+1
        jsr chkpg
        bne st1
        lda RANDOM
        tay
        lda RANDOM
        sta pv
        sta (ptr),y
        lda (ptr),y
        cmp pv
        beq st2
        jsr err
st2     lda pv
        eor #$FF
        sta pv2
        sta (ptr),y
        lda (ptr),y
        cmp pv2
        beq st3
        jsr err
st3     inc scnt
        bne st1
        jsr tick
        inc scnt+1
        lda scnt+1
        cmp #$20
        bne st1
        rts

; xbank (PHASE 5, cross-bank): every bank gets a signature ($5A + bank index at $4010, $6123 and $7FF0);
; then all signatures must still be intact (catches aliased banks, where writing one bank changes another).
; A mismatch calls `err` for that bank (reported at page $40) and turns its cell red. Skipped when there
; are no banks. PORTB is restored. Clobbers everything.
xbank   lda nrep
        bne xb0
        rts
xb0     lda #4
        sta phase
        jsr showphase
        ldx #8
        jsr clrrow
        loc 0,8
        say s_xb
        ldx #0
xb1     lda reps,x
        sta PORTB
        txa
        clc
        adc #$5A
        sta $4010
        sta $6123
        sta $7FF0
        inx
        cpx nrep
        bne xb1
        ldx #0
xb2     lda reps,x
        sta PORTB
        sta curpb
        txa
        clc
        adc #$5A
        sta pv
        inx
        stx bankno
        dex
        lda $4010
        cmp pv
        bne xbe
        lda $6123
        cmp pv
        bne xbe
        lda $7FF0
        cmp pv
        bne xbe
xb3     inx
        cpx nrep
        bne xb2
        lda pbsave
        sta PORTB
        rts
xbe     lda pbsave
        sta PORTB
        lda #$40
        sta ptr+1
        ldy #0
        jsr err
        inx
        lda #2
        sta cst,x
        jsr mapset
        dex
        jmp xb3

; err: record one error. Y = offset, ptr+1 = page. Increments errs (16-bit), sets bad, and for the very
; first error saves the offset/page, PORTB value (curpb) and bank number for showerr. Preserves X, Y.
err     inc errs
        bne e1
        inc errs+1
e1      lda #1
        sta bad
        lda ff
        bne e2
        lda #1
        sta ff
        sty fad
        lda ptr+1
        sta fad+1
        lda curpb
        sta fpb
        lda bankno
        sta fbk
e2      rts

; string pointer tables (low bytes, then high bytes), cst = per-cell state (0 yellow/1 grey/2 red/3 green,
; as in mapset), reps = PORTB value for each extended bank
cpnl    .byte <s_c0,<s_c1,<s_c2
cpnh    .byte >s_c0,>s_c1,>s_c2
pnl     .byte <s_p0,<s_p1,<s_p2,<s_p3,<s_p4
pnh     .byte >s_p0,>s_p1,>s_p2,>s_p3,>s_p4
cst     .ds 80
reps    .ds 64
s_title .byte 'MEMTEST  RAM size, bank map and burn-in',0
s_main  .byte 'OS-visible RAM: ',0
s_kbr   .byte ' KB  RAMTOP $',0
s_800   .byte 'Machine: 400/800 class (no OS ROM at $C000)',0
s_xl    .byte 'Machine: XL/XE class (OS ROM at $C000)',0
s_rom   .byte '  ROM-RAM: ',0
s_yes   .byte 'yes',0
s_no    .byte 'no',0
s_ext   .byte 'Extended banks: ',0
s_banks .byte ' x 16K = ',0
s_none  .byte 'none',0
s_cpu   .byte 'CPU: ',0
s_c0    .byte '6502 / 6502C (NMOS)',0
s_c1    .byte '65C02 (CMOS)',0
s_c2    .byte '65C816 (16-bit)',0
s_total .byte 'TOTAL RAM: ',0
s_kb    .byte ' KB',0
s_leg   .byte 'grey=idle yellow=test green=ok red=bad',0
s_ask   .byte 'B = burn-in loop, other key = one pass',0
s_stop  .byte 'Burn-in running: press any key to stop',0
s_el    .byte 'Elapsed:',0
s_run   .byte 'RUNNING',0
s_pass  .byte 'RESULT: PASS',0
s_fail  .byte 'RESULT: FAIL',0
s_done  .byte 'Passes completed: ',0
s_ps    .byte ' (0 errors)',0
s_passn .byte 'Pass ',0
s_ph    .byte '  Phase ',0
s_p0    .byte 'Address pattern',0
s_p1    .byte 'Fixed 55/AA',0
s_p2    .byte 'Random data',0
s_p3    .byte 'Random read/write',0
s_p4    .byte 'Cross-bank check',0
s_tm    .byte 'Testing main RAM $4000-$7FFF',0
s_tb    .byte 'Testing bank ',0
s_of    .byte ' of ',0
s_xb    .byte 'Checking all banks for aliasing',0
s_err   .byte 'Errors: ',0
s_sp6   .byte '      ',0
s_first .byte 'First error: bank ',0
s_at    .byte ' $',0
s_pb    .byte ' PB $',0
s_any   .byte 'Press any key to exit.',0
        run start
