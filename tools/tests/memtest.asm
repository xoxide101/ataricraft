; MEMTEST.COM - sizes main RAM, finds extended (banked) RAM on XL/XE and tests every distinct 16K bank through the
; $4000-$7FFF window with four phases (address pattern, fixed 55/AA, random data, random read/write) plus a
; cross-bank check. Colour block map: grey idle, yellow testing, green good, red bad. B at the prompt = burn-in
; (repeat passes until a key is pressed). Program and screen buffers stay below $4000.
        org $2000
        jmp start
        icl 'common.inc'
NA      = 7
NMAP    = 4
NB      = 6
        icl 'cscreen.inc'

ptr     = $90           ; low byte kept at 0
idx     = $92
mask    = $93
errs    = $94
ff      = $96
fpb     = $97
fad     = $98
pbsave  = $9A
nrep    = $9B
xl      = $9C
curpb   = $9D
bankno  = $9E
selft   = $9F
vf      = $A0
romram  = $A1
kb      = $A2
fbk     = $A5
rs      = $A6
rs0     = $A7
pstart  = $A8
pend    = $A9
burn    = $AA
passn   = $AB
stopf   = $AD
cell    = $AE
hz      = $AF
tacc    = $B0
lastt   = $B1
ss      = $B2
mm      = $B3
hh      = $B4
bad     = $B5
pv      = $B6
cputype = $BA
pv2     = $BB
scnt    = $BC
lastss  = $BE
patx    = $BF
phase   = $C0
ncell   = $C1
bx      = $C2
aborted = $C3

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
        and #$0E
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

        ; OS-visible RAM
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
        sta pbsave
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
        lda #64
        sta kb
        jmp nx1
rom_no  say s_no
nx1     lda RAMTOP
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
        cmp #$15
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
        sbc #5
        cmp #$80
        bcc m1
        lda #$80
m1      sta pend
        cmp #$41
        bcc skipm
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

; XL/XE has ROM at $C000: a non-constant 16-byte window means ROM present
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

; with the OS ROM paged out, $C000 should hold writable RAM
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

; PORTB value for combo A (CPU sees extended RAM because bit 4 stays 0)
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

; fills reps[] with one PORTB value per distinct 16K bank
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

; test one cell (main RAM or a bank): cell, curpb, bankno, pstart, pend set by the caller
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
        eor #$80
        sta selft
        lda RANDOM
        ora #1
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

; seconds clock from RTCLOK, a key stops a burn-in, redraws the elapsed time when it changes
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

; page is skipped (A=1) when it falls in the self-test ROM window
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

; pseudo-random fill and verify (seed from POKEY RANDOM, x = 5x+$3D, mixed with the page number)
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

; random address, random value: write, read back, write the complement, read back
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

; every bank gets a signature; then all signatures must still be intact (catches aliased banks)
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
