; Shared equates and helpers for the Ataricraft test programs (MADS). Text goes straight to GR.0 screen RAM.
;
; PROVIDES: OS/hardware equates, a few zero-page temporaries, and small routines:
;   eput   CIO put-char to E:        locate  X,Y -> sp        putc   ATASCII -> screen code at (sp)
;   puts   zero-terminated string    puthex  A as 2 hex digits putdec 16-bit v16 as decimal
;   cpudet CPU type (0/1/2)          vsync   wait one frame   getkey wait for a key
; Text is written directly into screen RAM (not through CIO), so output is fast and can target either
; the OS screen (sbase = 0, uses SAVMSC) or a custom buffer (sbase <> 0, set up by cscreen.inc).
;
; ZERO PAGE used here: $80/$81 sp (screen write ptr), $82/$83 sa (string ptr), $84 si (string index),
;   $86/$87 v16 (value for putdec), $88-$8B t1-t4 (scratch). cscreen.inc adds $B7-$B9.
;
; EXTENDING: a test program includes this file (normally after its own `org`), then defines its own
;   entry point and code; it must not use $80-$8B for state that has to survive calls to these helpers.
;   Routines here are plain subroutines (JSR/RTS); none are reentrant.
CIOV     = $E456
ICCOM   = $0342
ICBAL   = $0344
ICBAH   = $0345
ICBLL   = $0348
ICBLH   = $0349
ICAX1   = $034A
ICAX2   = $034B
SAVMSC  = $58
RAMTOP  = $6A
ATRACT  = $4D
RTCLOK  = $12
CH      = $02FC
CRSINH  = $02F0
KEYDEF  = $79
NMIEN   = $D40E
WSYNC   = $D40A
CONSOL  = $D01F
TRIG0   = $D010
PALNTS  = $D014
PORTA   = $D300
PORTB   = $D301
POT0    = $D200
ALLPOT  = $D208
POTGO   = $D20B
RANDOM  = $D20A
KBCODE  = $D209
SKSTAT  = $D20F
IRQST   = $D20E

sp      = $80           ; screen write pointer
sa      = $82           ; string pointer
si      = $84           ; string index
v16     = $86           ; 16-bit value for putdec
t1      = $88
t2      = $89
t3      = $8A
t4      = $8B

; eput: A = ATASCII char to the E: device (clear screen = $7D). Assumes IOCB 0 is open on E: (the OS does
; this at boot). Clobbers A, X, Y (and ICCOM/ICBLL/ICBLH).
eput    tax
        lda #11         ; CIO command 11 = put binary record/char; length 0 = just the char in A
        sta ICCOM
        lda #0
        sta ICBLL
        sta ICBLH
        txa
        ldx #0
        jmp CIOV

; locate: X = column, Y = row (40 columns per row) -> sp = row base + column.
; Base is SAVMSC if sbase+1 = 0, else the custom buffer in sbase. Clobbers A, X, Y. The row offset
; is computed by repeated +40.
locate  lda sbase+1
        bne lcb
        lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        jmp lca
lcb     lda sbase
        sta sp
        lda sbase+1
        sta sp+1
lca     cpy #0
        beq loc2
loc1    clc
        lda sp
        adc #40
        sta sp
        bcc loc3
        inc sp+1
loc3    dey
        bne loc1
loc2    txa
        clc
        adc sp
        sta sp
        bcc loc4
        inc sp+1
loc4    rts

; putc: A = ATASCII -> screen code stored at (sp), sp advances by one. Clobbers A, Y.
; Conversion: $00-$1F -> +$40 (control graphics), $20-$5F -> -$20, $60+ unchanged (lower case etc.).
putc    cmp #$20
        bcs pc1
        clc
        adc #$40
        bne pc3
pc1     cmp #$60
        bcs pc3
        sec
        sbc #$20
pc3     ldy #0
        sta (sp),y
        inc sp
        bne pc4
        inc sp+1
pc4     rts

; puts: A/Y = low/high address of a zero-terminated string (max 255 chars), printed at sp.
; Clobbers A, X, Y, sa, si.
puts     sta sa
        sty sa+1
        lda #0
        sta si
ps1     ldy si
        lda (sa),y
        beq ps2
        jsr putc
        inc si
        bne ps1
ps2     rts

; puthex: A = byte, printed as two hex digits (hexd prints just the low nibble of A). Clobbers A, X, Y.
puthex  pha
        lsr
        lsr
        lsr
        lsr
        jsr hexd
        pla
        and #$0F
hexd    tax
        lda hextab,x
        jmp putc
hextab  .byte '0123456789ABCDEF'

; putdec: v16 (0..65535) -> decimal at sp, leading zeros suppressed (the last digit is always printed).
; Method: for each power in declo/dechi (10000..1) subtract repeatedly, counting in t1; t3 = "a digit
; has been printed" flag. X = power index. Clobbers A, X, Y, t1, t3; v16 is destroyed (ends as 0).
putdec  lda #0
        sta t3
        ldx #0
pd1     lda #'0'
        sta t1
pd2     lda v16
        cmp declo,x
        lda v16+1
        sbc dechi,x
        bcc pd3
        lda v16
        sbc declo,x
        sta v16
        lda v16+1
        sbc dechi,x
        sta v16+1
        inc t1
        bne pd2
pd3     lda t1
        cmp #'0'
        bne pd4
        cpx #4
        beq pd4
        lda t3
        beq pd5
pd4     lda #1
        sta t3
        lda t1
        jsr putc
pd5     inx
        cpx #5
        bne pd1
        rts
declo   .byte <10000,<1000,<100,<10,1
dechi   .byte >10000,>1000,>100,>10,0

sbase   .word 0         ; custom text buffer (cscreen.inc); 0 = the OS screen

; cpudet: CPU type -> A: 0 = 6502, 1 = 65C02, 2 = 65C816. Call before any NMI-driven screen is set up
; (it briefly disables NMIs, then re-enables VBI only: $40). Clobbers A.
; Test 1: decimal-mode $99+1. On an NMOS 6502 the Z flag is invalid in decimal mode (stays clear, since
;   the binary result $9A is non-zero); a CMOS part sets Z correctly (result 0). So Z clear => 6502.
; Test 2: $EB is XBA (swap A/B) on a 65C816 but a NOP on a 65C02. With A=$FF, B=0 the swap brings
;   B ($00) into A; the 2nd XBA restores; PHA/PLA then compares against $FF. A = $FF => no swap => 65C02.
cpudet  sei
        lda #0
        sta NMIEN       ; no NMIs while probing
        sed
        lda #$99
        clc
        adc #1
        cld
        beq cd1         ; Z set => CMOS decimal behaviour (65C02 or 65C816)
        lda #$40
        sta NMIEN
        cli
        lda #0
        rts
cd1     lda #$FF
        .byte $EB       ; XBA on a 65C816, NOP on a 65C02
        lda #0
        .byte $EB
        pha
        lda #$40
        sta NMIEN
        cli
        pla
        cmp #$FF
        beq cd2
        lda #1
        rts
cd2     lda #2
        rts

; vsync: wait for the next frame (RTCLOK+2, the low byte of the OS jiffy clock, ticks each VBI).
; Clobbers A.
vsync    lda RTCLOK+2
vs1     cmp RTCLOK+2
        beq vs1
        rts

; getkey: wait for a key; returns the CH (keyboard code, not ATASCII) in A and clears it ($FF = none).
; Flushes any pending key first. Keeps ATRACT at 0 so attract-mode colour cycling never starts.
; Clobbers A.
getkey  lda #$FF
        sta CH
gk1     lda #0
        sta ATRACT      ; reset attract-mode timer each poll
        lda CH
        cmp #$FF
        beq gk1
        pha
        lda #$FF
        sta CH
        pla
        rts
