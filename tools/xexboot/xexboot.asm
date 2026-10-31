; Boot-sector XEX loader: 3 boot sectors at $0700, binary stream starts at disk sector 4 (128-byte sectors).
; xexToAtr() patches the 24-bit stream length at $0709. Needs no DOS.
;
; Usage: web/js/diskconv.js builds an ATR whose sectors 1-3 are this code (384 bytes, padded
;   by the .ds at the end) and whose sectors 4.. hold the raw XEX file. The OS boot routine
;   loads the 3 sectors to $0700 and jumps to the init address in the boot header ($0706).
;
; Boot header (OS format): flags byte 0, sector count 3, load address $0700, init $0706.
;   Code at $0706 is "jmp start"; the 3 bytes after it (len, $0709-$070B) are the 24-bit
;   little-endian byte length of the XEX stream, patched in by diskconv.js. The loader stops
;   when its byte counter reaches that length (so trailing sector padding is ignored).
;
; XEX parsing: read a 2-byte start; if it is $FFFF (header/marker) skip it and loop;
;   else read the 2-byte end address and copy start..end inclusive into memory.
;   (Only start=$FFFF is skipped, so repeated $FFFF markers between segments work.)
;   INIT: a segment loading exactly at $02E2 (end low byte $E3) is treated as an INIT
;   vector; after it is loaded, we call through ($02E2) and continue with the next segment.
;   RUN: after the stream ends, jump via ($02E0) if non-zero, else via ($000A) (DOSVEC),
;   which appears to return to the resident OS/self-test-style handler when no run vector.
;
; Memory map / variables:
;   $0700-$087F  this loader (3 sectors)      $0880-$08FF  128-byte sector buffer (buf)
;   $0A00-$0A09  state block (cnt..ehi)       $E0-$E1      ptr: destination pointer (zero page)
;   cnt (3 bytes) bytes consumed so far; bpos index in buf (128 = empty); secl/sech next
;   disk sector; lo/hi segment start; elo/ehi segment end.
; The loader uses $0A00+ and $0880 so a segment that overwrites them would break loading.
        opt h-
        org $0700
        .byte 0,3
        .word $0700,$0706
        jmp start
len     .byte 0,0,0

buf     = $0880
cnt     = $0A00
bpos    = cnt+3
secl    = cnt+4
sech    = cnt+5
lo      = cnt+6
hi      = cnt+7
elo     = cnt+8
ehi     = cnt+9
ptr     = $E0

; Init: clear byte counter, start at disk sector 4, mark buffer empty (bpos=128).
start   cld
        lda #0
        sta cnt
        sta cnt+1
        sta cnt+2
        sta sech
        lda #4
        sta secl
        lda #128
        sta bpos

; Main loop: stop when cnt >= len (24-bit compare via cmp/sbc chain), else read a segment header.
main    lda cnt
        cmp len
        lda cnt+1
        sbc len+1
        lda cnt+2
        sbc len+2
        bcs done
        jsr getb
        sta lo
        jsr getb
        sta hi
        and lo
        cmp #$ff                ; lo AND hi = $FF only when both are $FF: skip marker
        beq main
        jsr getb
        sta elo
        jsr getb
        sta ehi
        lda lo
        sta ptr
        lda hi
        sta ptr+1
; Copy loop: store bytes at (ptr) until ptr == end address (inclusive).
cp      jsr getb
        ldy #0
        sta (ptr),y
        lda ptr
        cmp elo
        bne nx
        lda ptr+1
        cmp ehi
        beq segend
nx      inc ptr
        bne cp
        inc ptr+1
        jmp cp
; Segment finished: if it was the INIT vector segment ($02E2..$02E3) call it.
segend  lda lo
        cmp #$e2
        bne main
        lda hi
        cmp #2
        bne main
        lda elo
        cmp #$e3
        bne main
        jsr doinit
        jmp main

; doinit: jsr here, so the INIT routine's RTS returns to the caller (then "jmp main").
doinit  jmp ($02e2)

; End of stream: run via RUNAD ($02E0) if set, otherwise via DOSVEC ($000A).
done    lda $02e0
        ora $02e1
        beq nrun
        jmp ($02e0)
nrun    jmp ($000a)

; getb: return next stream byte in A (reads a new sector when buffer is exhausted).
;   Clobbers X (and Y/flags via rdsec). Increments the 24-bit byte counter cnt.
getb    ldx bpos
        cpx #128
        bcc gb1
        jsr rdsec
        ldx #0
gb1     lda buf,x
        inx
        stx bpos
        inc cnt
        bne gb2
        inc cnt+1
        bne gb2
        inc cnt+2
gb2     rts

; rdsec: read sector secl/sech into buf with a direct DCB ($0300) call to SIOV ($E459).
;   DCB: device $31 (D1:), unit 1, command $52 (read), status $40 (data in), timeout 7,
;   128 bytes. On error, bump COLBK ($D01A) as a visual flag and retry forever.
rdsec   lda #$31
        sta $0300
        lda #1
        sta $0301
        lda #$52
        sta $0302
        lda #$40
        sta $0303
        lda #<buf
        sta $0304
        lda #>buf
        sta $0305
        lda #7
        sta $0306
        lda #128
        sta $0308
        lda #0
        sta $0309
        lda secl
        sta $030a
        lda sech
        sta $030b
        jsr $e459
        bmi rerr
        inc secl
        bne rok
        inc sech
rok     rts
rerr    inc $d01a
        jmp rdsec

        .ds 384-(*-$0700)       ; pad to 3 full 128-byte sectors
