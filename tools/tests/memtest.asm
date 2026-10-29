; MEMTEST.COM - sizes main RAM, detects extended (banked) RAM on XL/XE, and pattern-tests every distinct 16K bank
; through the $4000-$7FFF window. Program stays below $4000.
        org $2000
        jmp start
        icl 'common.inc'

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
sigerr  = $A4
fbk     = $A5

start   lda #$7D
        jsr eput
        lda #1
        sta CRSINH
        lda #0
        sta ptr
        sta errs
        sta errs+1
        sta ff
        sta nrep
        sta xl
        sta romram
        lda PORTB
        sta pbsave
        ldx #0
        ldy #0
        jsr locate
        lda #<s_title
        ldy #>s_title
        jsr puts

        ; OS-visible RAM
        lda RAMTOP
        lsr
        lsr
        sta kb
        lda #0
        sta kb+1
        ldx #0
        ldy #2
        jsr locate
        lda #<s_main
        ldy #>s_main
        jsr puts
        lda kb
        sta v16
        lda kb+1
        sta v16+1
        jsr putdec
        lda #<s_kbr
        ldy #>s_kbr
        jsr puts
        lda RAMTOP
        jsr puthex

        ; XL/XE detection: the 400/800 has nothing readable in $C000-$C00F
        jsr detxl
        ldx #0
        ldy #3
        jsr locate
        lda xl
        bne isxl
        lda #<s_800
        ldy #>s_800
        jsr puts
        lda #$FF
        sta pbsave
        jmp noxl
isxl    lda #<s_xl
        ldy #>s_xl
        jsr puts

        ; RAM under the OS ROM
        jsr romtest
        ldx #0
        ldy #4
        jsr locate
        lda #<s_rom
        ldy #>s_rom
        jsr puts
        lda romram
        beq rom_no
        lda #<s_yes
        ldy #>s_yes
        jsr puts
        lda RAMTOP
        cmp #$C0
        bcc noxl
        lda #64
        sta kb
        jmp noxl
rom_no  lda #<s_no
        ldy #>s_no
        jsr puts

noxl    lda RAMTOP
        cmp #$40
        bcs big
        jmp finish
big     lda xl
        beq nobanks
        jsr findbanks
nobanks ldx #0
        ldy #5
        jsr locate
        lda #<s_ext
        ldy #>s_ext
        jsr puts
        lda nrep
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        lda #<s_banks
        ldy #>s_banks
        jsr puts

        ; test main RAM then each distinct bank
        lda #0
        sta bankno
        lda pbsave
        sta curpb
        ldx #0
        ldy #7
        jsr locate
        lda #<s_tm
        ldy #>s_tm
        jsr puts
        jsr testbank
        ldx #0
tloop   cpx nrep
        beq tdone
        stx t4
        inx
        stx bankno
        dex
        lda reps,x
        sta curpb
        ldx #0
        ldy #8
        jsr locate
        lda #<s_tb
        ldy #>s_tb
        jsr puts
        lda bankno
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        lda #<s_of
        ldy #>s_of
        jsr puts
        lda nrep
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        lda #<s_sp
        ldy #>s_sp
        jsr puts
        jsr testbank
        ldx t4
        inx
        bne tloop
tdone   ldx #0
        ldy #8
        jsr locate
        lda #<s_blank
        ldy #>s_blank
        jsr puts

finish  ldx #0
        ldy #10
        jsr locate
        lda #<s_err
        ldy #>s_err
        jsr puts
        lda errs
        sta v16
        lda errs+1
        sta v16+1
        jsr putdec
        lda errs
        ora errs+1
        beq nofirst
        ldx #0
        ldy #11
        jsr locate
        lda #<s_first
        ldy #>s_first
        jsr puts
        lda fbk
        sta v16
        lda #0
        sta v16+1
        jsr putdec
        lda #<s_at
        ldy #>s_at
        jsr puts
        lda fad+1
        jsr puthex
        lda fad
        jsr puthex
        lda #<s_pb
        ldy #>s_pb
        jsr puts
        lda fpb
        jsr puthex
nofirst ldx #0
        ldy #13
        jsr locate
        lda #<s_total
        ldy #>s_total
        jsr puts
        ; total = main + 16 * banks
        lda nrep
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
        clc
        lda v16
        adc kb
        sta v16
        lda v16+1
        adc kb+1
        sta v16+1
        jsr putdec
        lda #<s_kb
        ldy #>s_kb
        jsr puts
        ldx #0
        ldy #14
        jsr locate
        lda errs
        ora errs+1
        beq pass
        lda #<s_fail
        ldy #>s_fail
        jmp pr
pass    lda #<s_pass
        ldy #>s_pass
pr      jsr puts
        ldx #0
        ldy #16
        jsr locate
        lda #<s_any
        ldy #>s_any
        jsr puts
        jsr getkey
        lda #0
        sta CRSINH
        lda #$7D
        jmp eput

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
        lda #$40
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
        lda #$40
        sta NMIEN
        cli
        rts

; fill and verify $4000-$7FFF with a pattern and its complement
testbank
        sei
        lda #0
        sta NMIEN
        lda curpb
        sta PORTB
        and #$80
        eor #$80
        sta selft
        lda bankno
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
        jsr dopass
        lda pbsave
        sta PORTB
        lda #$40
        sta NMIEN
        cli
        rts

dopass  lda #$40
        sta ptr+1
pgl     lda selft
        beq pgok
        lda ptr+1
        and #$F8
        cmp #$50
        beq pgskip
pgok    ldy #0
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
        cmp #$80
        bne pgl
        rts

err     inc errs
        bne e1
        inc errs+1
e1      lda ff
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

reps    .ds 64
s_title .byte 'MEMTEST  RAM size and bank test',0
s_main  .byte 'OS-visible RAM: ',0
s_kbr   .byte ' KB  RAMTOP $',0
s_800   .byte 'Machine: 400/800 class (no OS ROM at $C000)',0
s_xl    .byte 'Machine: XL/XE class (OS ROM at $C000)',0
s_rom   .byte 'RAM under OS ROM: ',0
s_yes   .byte 'yes (64K)',0
s_no    .byte 'no',0
s_ext   .byte 'Extended banks: ',0
s_banks .byte ' x 16K distinct',0
s_tm    .byte 'Testing main RAM $4000-$7FFF...',0
s_tb    .byte 'Testing bank ',0
s_of    .byte ' of ',0
s_sp    .byte '        ',0
s_blank .byte '                                        ',0
s_err   .byte 'Errors: ',0
s_first .byte 'First error: bank ',0
s_at    .byte ' addr $',0
s_pb    .byte ' PORTB $',0
s_total .byte 'TOTAL RAM: ',0
s_kb    .byte ' KB',0
s_pass  .byte 'RESULT: PASS',0
s_fail  .byte 'RESULT: FAIL',0
s_any   .byte 'Press any key.',0
        run start
