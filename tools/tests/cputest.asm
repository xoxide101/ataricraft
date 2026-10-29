; CPUTEST.COM - identifies the CPU (6502 / 65C02 / 65C816), runs instruction self-checks for the detected
; instruction set and measures the effective clock speed. Shows PASS / FAIL per test with colour bars.
        org $2000
NA      = 14
NMAP    = 0
NB      = 0
SDMCTL  = $022F
        jmp start
        icl 'common.inc'
        icl 'cscreen.inc'

cpu     .byte 0
fails   .byte 0
cnl     = $91
cnh     = $92
stopt   = $90
pal     .byte 0
a0      .byte 0
a1      .byte 0
a2      .byte 0
b0      .byte 0
b1      .byte 0
qv      .word 0
mulv    .byte 0
dvl     .byte 0
dvh     .byte 0
tmp     = $8E
ptr     = $8C

start   lda #$7D
        jsr eput
        lda #1
        sta CRSINH
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
        lda cname,x
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
c4      ldx #8
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

pause   ldx #20
pz      jsr vsync
        dex
        bne pz
        rts

; A = 0 pass / 1 fail (from the test), X = row
res     cmp #0
        beq rp
        inc fails
        lda #1
        jmp setres
rp      lda #0
; ---- base 6502 instructions: A = 0 on success
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
        lda (ptr),y
        cmp #$33
        bne tbf
        ldx #0
        lda #<tdat
        sta tmp
        lda #>tdat
        sta tmp+1
        ldx #0
        lda (tmp,x)
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
; decimal mode with interrupts off
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

; ---- 65C02 additions (hand-assembled): STZ, INC A, DEC A, PHX/PLX, BRA, TSB, TRB
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
        .byte $04,t1            ; TSB zp
        lda t1
        cmp #$FF
        bne tcf
        lda #$0F
        .byte $14,t1            ; TRB zp
        lda t1
        cmp #$F0
        bne tcf
        lda #0
        rts
tcf     lda #1
        rts

; ---- 65C816: native mode, 16-bit accumulator add and 16-bit store
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

; ---- clock estimate: count a 18-cycle loop over two frames with DMA off
speed   lda #0
        sta SDMCTL
        jsr vsync
        lda PALNTS
        and #$0E
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
        sta SDMCTL
        ; acc = count * mulv
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
        ; qv = acc / divisor
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

; qv = MHz * 100 -> "x.xx"
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
