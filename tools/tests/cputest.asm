; CPUTEST.COM - identifies the CPU (6502 / 65C02 / 65C816), runs instruction self-checks for the detected
; instruction set and measures the effective clock speed. Shows PASS / FAIL per test with colour bars.
;
; USAGE: load and run from DOS (org $2000, run start). Four test rows are shown; the program runs by
;   itself and waits for any key at the end (any key exits and restores the OS screen).
;   TEST 1 base 6502 instructions (always)   TEST 2 65C02 additions (only on 65C02/65C816, else n/a)
;   TEST 3 65C816 native 16-bit (only on a 65C816, else n/a)   TEST 4 speed measurement (informational)
;   Row colour: yellow while a test runs, then PASS (green) / FAIL (red) / n/a. A final RESULT line is
;   green if no test failed (`fails` = 0), red otherwise.
;
; SCREEN: built by cscreen.inc - 14 text rows (NA = 14, no map, NB = 0), custom display list with one
;   DLI per row for the colour bars, VBI hook that resets the DLI row counter (see cscreen.inc).
;
; MEMORY / ZERO PAGE: code and data from $2000; screen buffers at $3000-$3800+ (cscreen.inc). Zero page:
;   $80-$8B common.inc scratch (t1 is the target for the memory-form tests), $8C ptr, $8E tmp (pointers
;   for indirect-addressing tests), $90 stopt (RTCLOK target), $91/$92 cnl/cnh (speed loop counter),
;   $B7-$B9 cscreen.inc.
;
; EXTENDING: add a row text (s_tN) and a `loc`/`say` for it in start, add NA if rows are needed, write
;   a test routine that returns A = 0 on success / 1 on failure, and call it like the others:
;   `ldx #row / lda #3 / jsr bar / jsr pause / jsr t_xxx / ldx #row / jsr res`.
        org $2000
NA      = 14
NMAP    = 0
NB      = 0
SDMCTL  = $022F         ; DMA control shadow (ANTIC); 0 = DMA off, $22 = normal playfield + standard width
        jmp start       ; skip over the includes and data
        icl 'common.inc'
        icl 'cscreen.inc'

cpu     .byte 0         ; detected CPU: 0 = 6502, 1 = 65C02, 2 = 65C816
fails   .byte 0         ; number of failed tests
cnl     = $91           ; speed loop counter (16-bit)
cnh     = $92
stopt   = $90           ; RTCLOK value that ends the measurement
pal     .byte 0         ; 1 = PAL, 0 = NTSC
a0      .byte 0         ; 24-bit accumulator for count * mulv
a1      .byte 0
a2      .byte 0
b0      .byte 0         ; trial remainder during the division
b1      .byte 0
qv      .word 0         ; quotient = MHz * 100
mulv    .byte 0         ; multiplier / divisor: scale loop count to MHz*100
dvl     .byte 0
dvh     .byte 0
tmp     = $8E
ptr     = $8C

; start: main program. Clears the screen, detects the CPU, measures speed (before the custom screen
; exists, since it turns DMA off), builds the screen, prints the headings, runs TESTs 1-3 and shows
; the result. Tests 2/3 are marked n/a (setres code 2) if the CPU lacks the instructions.
start   lda #$7D
        jsr eput
        lda #1
        sta CRSINH      ; hide the cursor
        jsr cpudet
        sta cpu
        jsr speed
        jsr gs_init
        ldx #0
        lda #1
        jsr bar
        loc 0,0
        say s_title
        loc 0,2
        say s_cpu
        ldx cpu
        lda cname,x     ; name string pointer: low bytes at cname+0..2, high bytes at cname+3..5
        ldy cname+3,x
        jsr puts
        ldx cpu
        loc 0,3
        ldx cpu
        lda iname,x
        ldy iname+3,x
        jsr puts
        loc 0,5
        say s_t1
        loc 0,6
        say s_t2
        loc 0,7
        say s_t3
        loc 0,8
        say s_t4
        loc 0,13
        say s_any

        ; test 1: base instruction set
        ldx #5
        lda #3
        jsr bar
        jsr pause
        jsr t_base
        ldx #5
        jsr res
        ; test 2: 65C02 extensions
        lda cpu
        bne c2go
        lda #2
        ldx #6
        jsr setres
        jmp c3
c2go    ldx #6
        lda #3
        jsr bar
        jsr pause
        jsr t_c02
        ldx #6
        jsr res
c3      lda cpu
        cmp #2
        bcs c3go
        lda #2
        ldx #7
        jsr setres
        jmp c4
c3go    ldx #7
        lda #3
        jsr bar
        jsr pause
        jsr t_816
        ldx #7
        jsr res
c4      ldx #8          ; TEST 4: the measurement was already taken by `speed`; just report it
        lda #3
        jsr bar
        jsr pause
        ldx #8
        lda #0
        jsr setres
        loc 0,3
        ldx cpu
        lda iname,x
        ldy iname+3,x
        jsr puts
        loc 0,4
        say s_clk
        jsr puthz
        say s_mhz
        lda fails
        bne bad
        ldx #10
        lda #2
        jsr bar
        loc 0,10
        say s_ok
        jmp fin
bad     ldx #10
        lda #4
        jsr bar
        loc 0,10
        say s_bad
fin     jsr getkey
        jsr gs_off
        lda #0
        sta CRSINH
        rts

; pause: wait 20 frames (about 1/3 s NTSC) so each test row visibly shows "working". Clobbers A, X.
pause   ldx #20
pz      jsr vsync
        dex
        bne pz
        rts

; res: A = 0 pass / 1 fail (from the test), X = row. On failure counts it in `fails` and shows FAIL.
; NOTE: on the pass path `rp` loads A = 0 and appears to fall straight through into t_base (there is
; no jmp to setres here), so the PASS label seems not to be drawn by this routine.
res     cmp #0
        beq rp
        inc fails
        lda #1
        jmp setres
rp      lda #0
; ---- TEST 1: base 6502 instructions: A = 0 on success, 1 on first mismatch (branches to tbf).
; Checks in order: ADC overflow ($7F+1 sets V and N), carry ($FF+1 = 0 with C), SBC borrow ($10-$11 =
; $FF, C clear), ASL/ROL with carry, PHA/PLA round trip, (zp),Y and (zp,X) addressing against tdat,
; AND/ORA/EOR logic on t1. Finishes with the decimal-mode test t_dec (jmp, so t_dec returns for us).
t_base  lda #$7F
        clc
        adc #1
        bvc tbf
        bpl tbf
        lda #$FF
        clc
        adc #1
        bne tbf
        bcc tbf
        sec
        lda #$10
        sbc #$11
        bcs tbf
        cmp #$FF
        bne tbf
        lda #$81
        asl
        cmp #$02
        bne tbf
        rol
        cmp #$05
        bne tbf
        lda #$A5
        pha
        lda #0
        pla
        cmp #$A5
        bne tbf
        lda #<tdat
        sta ptr
        lda #>tdat
        sta ptr+1
        ldy #2
        lda (ptr),y     ; (zp),Y: tdat+2 = $33
        cmp #$33
        bne tbf
        ldx #0
        lda #<tdat
        sta tmp
        lda #>tdat
        sta tmp+1
        ldx #0
        lda (tmp,x)     ; (zp,X) with X = 0: tdat+0 = $11
        cmp #$11
        bne tbf
        lda #$F0
        sta t1
        lda #$0F
        and t1
        bne tbf
        lda #$0F
        ora t1
        eor #$FF
        bne tbf
        jmp t_dec
tbf     lda #1
        rts
; t_dec: decimal (BCD) mode checks with interrupts off (an NMI/IRQ in D mode could upset the OS).
; $19+$28 must give $47; $99+1 must give $00 with carry set; $40-$13 must give $27. A = 0 pass / 1 fail.
; NMIEN is restored to $C0 (DLI + VBI enabled, matching the cscreen.inc screen) on both exits.
t_dec   sei
        lda #0
        sta NMIEN
        sed
        lda #$19
        clc
        adc #$28
        cld
        cmp #$47
        bne tbd
        sed
        lda #$99
        clc
        adc #1
        cld
        bcc tbd
        cmp #0
        bne tbd
        sed
        sec
        lda #$40
        sbc #$13
        cld
        cmp #$27
        bne tbd
        lda #$C0
        sta NMIEN
        cli
        lda #0
        rts
tbd     lda #$C0
        sta NMIEN
        cli
        lda #1
        rts
tdat    .byte $11,$22,$33,$44

; ---- TEST 2: 65C02 additions (opcodes emitted with .byte because MADS is assembling for plain 6502):
; STZ, INC A, DEC A, PHX/PLX, PHY/PLY, BRA, TSB, TRB. A = 0 on success, 1 on any mismatch.
; On a 6502 these opcodes would be undefined/NOPs, so the test only runs when cpu >= 1.
t_c02   lda #$55
        sta t1
        .byte $64,t1            ; STZ zp
        lda t1
        bne tcf
        lda #$7F
        .byte $1A               ; INC A
        cmp #$80
        bne tcf
        .byte $3A               ; DEC A
        cmp #$7F
        bne tcf
        ldx #$42
        .byte $DA               ; PHX
        ldx #0
        .byte $FA               ; PLX
        cpx #$42
        bne tcf
        ldy #$37
        .byte $5A               ; PHY
        ldy #0
        .byte $7A               ; PLY
        cpy #$37
        bne tcf
        lda #1
        .byte $80,$02           ; BRA +2 skips the next LDA
        lda #2
        cmp #1
        bne tcf
        lda #$0F
        sta t1
        lda #$F0
        .byte $04,t1            ; TSB zp: t1 |= A ($0F|$F0 = $FF)
        lda t1
        cmp #$FF
        bne tcf
        lda #$0F
        .byte $14,t1            ; TRB zp: t1 &= ~A ($FF & $F0)
        lda t1
        cmp #$F0
        bne tcf
        lda #0
        rts
tcf     lda #1
        rts

; ---- TEST 3: 65C816: native mode, 16-bit accumulator add and 16-bit store
; $00FF + 1 must give $0100: low byte t1 = 0, high byte t1+1 = 1. A = 0 on success, 1 on failure.
; NMIs are disabled while in native mode (the OS handlers are not 16-bit safe); the CPU is returned
; to emulation mode (XCE) before NMIEN is set back to $C0.
t_816   sei
        lda #0
        sta NMIEN
        clc
        .byte $FB               ; XCE -> native
        .byte $C2,$20           ; REP #$20 (16-bit A)
        .byte $A9,$FF,$00       ; LDA #$00FF
        clc
        .byte $69,$01,$00       ; ADC #$0001
        sta t1                  ; STA zp (16-bit)
        .byte $E2,$20           ; SEP #$20
        sec
        .byte $FB               ; XCE -> emulation
        lda #$C0
        sta NMIEN
        cli
        lda t1
        bne t8f
        lda t1+1
        cmp #1
        bne t8f
        lda #0
        rts
t8f     lda #1
        rts

; ---- TEST 4 helper: clock estimate. Counts passes of a ~19-cycle loop (spl) over exactly two frames
; (RTCLOK ticks) with ANTIC DMA off so no cycles are stolen, then scales: qv = count * mulv / divisor
; (NTSC 27/472, PAL 9/189, chosen from the PAL bits of PALNTS) = MHz * 100. Result is approximate.
; Clobbers A, X, SDMCTL (restored to $22).
speed   lda #0
        sta SDMCTL      ; screen DMA off
        jsr vsync
        lda PALNTS
        and #$0E        ; GTIA PAL/NTSC bits: 1 (low bits 0) appears to mean PAL
        bne nt
        lda #1
        sta pal
        lda #9
        sta mulv
        lda #<189
        sta dvl
        lda #>189
        sta dvh
        jmp sp1
nt      lda #0
        sta pal
        lda #27
        sta mulv
        lda #<472
        sta dvl
        lda #>472
        sta dvh
sp1     lda RTCLOK+2
sp2     cmp RTCLOK+2
        beq sp2
        lda RTCLOK+2
        clc
        adc #2
        sta stopt
        lda #0
        sta cnl
        sta cnh
spl     inc cnl
        bne spl1
        inc cnh
spl1    lda RTCLOK+2
        cmp stopt
        bne spl
        lda #$22
        sta SDMCTL      ; DMA back on
        ; acc = count * mulv (24-bit, by repeated addition)
        lda #0
        sta a0
        sta a1
        sta a2
        ldx mulv
sm1     clc
        lda a0
        adc cnl
        sta a0
        lda a1
        adc cnh
        sta a1
        bcc sm2
        inc a2
sm2     dex
        bne sm1
        ; qv = acc / divisor (repeated subtraction, quotient counted in qv)
        lda #0
        sta qv
        sta qv+1
dv1     sec
        lda a0
        sbc dvl
        sta b0
        lda a1
        sbc dvh
        sta b1
        lda a2
        sbc #0
        bcc dvend
        sta a2
        lda b0
        sta a0
        lda b1
        sta a1
        inc qv
        bne dv1
        inc qv+1
        jmp dv1
dvend   rts

; puthz: print qv (MHz * 100) as "x.xx". Integer part = qv / 100 (counted in X), then the remainder is
; split into tens and units digits. Clobbers A, X, Y, v16, qv.
puthz   lda qv
        sta v16
        lda qv+1
        sta v16+1
        ldx #0
ph1     lda v16+1
        bne ph2
        lda v16
        cmp #100
        bcc ph3
ph2     sec
        lda v16
        sbc #100
        sta v16
        bcs ph4
        dec v16+1
ph4     inx
        jmp ph1
ph3     lda v16
        sta qv
        stx v16
        lda #0
        sta v16+1
        jsr putdec
        lda #'.'
        jsr putc
        ldx #0
        lda qv
ph5     cmp #10
        bcc ph6
        sbc #10
        inx
        bne ph5
ph6     pha
        txa
        clc
        adc #'0'
        jsr putc
        pla
        clc
        adc #'0'
        jmp putc

; string pointer tables: low bytes of each string, then the high bytes (indexed by cpu, and cpu+3)
cname   .byte <c0,<c1,<c2,>c0,>c1,>c2
iname   .byte <i0,<i1,<i2,>i0,>i1,>i2
c0      .byte 'NMOS 6502 / 6502C',0
c1      .byte 'CMOS 65C02',0
c2      .byte 'WDC 65C816 / 65802',0
i0      .byte 'Instruction set: documented 6502 only',0
i1      .byte 'Instruction set: 6502 + CMOS additions',0
i2      .byte 'Instruction set: 65C02 + 16-bit native',0
s_title .byte 'CPUTEST  CPU type, instructions, speed',0
s_cpu   .byte 'Detected CPU: ',0
s_inst  .byte '                                        ',0
s_clk   .byte 'Effective clock: ',0
s_mhz   .byte ' MHz (approx)',0
s_t1    .byte 'TEST 1  6502 base instructions',0
s_t2    .byte 'TEST 2  65C02 instructions',0
s_t3    .byte 'TEST 3  65C816 native 16-bit',0
s_t4    .byte 'TEST 4  Speed measurement',0
s_ok    .byte 'RESULT: PASS - all tests passed',0
s_bad   .byte 'RESULT: FAIL - see the red rows above',0
s_any   .byte 'Press any key to exit.',0
        run start
