; ACX 8 MB bank test: 8 segments x 64 banks = 512 banks of 16 KB behind $4000-$7FFF.
; Bank = PORTB number (bits 1-3, 5-7) + 64 * segment ($D1F0 bits 0-2). Build: out\mads\mads.exe scripts\acx-test.asm -o:scripts\acx-test.xex
; Results in $600..: $600/$601 banks that kept their own data (want 512), $602 done, $603 ID byte seen ($AC),
; $604 ext readback errors, $605 base RAM at $4000 intact after returning to PORTB $FF, $606 ext write-0 check, $610+seg failures per segment.
seg = $80
n   = $81
lo  = $82
hi  = $83
t   = $84

	org $2000
start
	sei
	lda #0
	sta $D40E
	sta $D400
	ldx #15
clr	sta $600,x
	dex
	bpl clr
	lda #$5A
	sta $4000
	lda $D1F1
	cmp #$AC
	bne noid
	inc $603
noid
	lda #0
	sta seg
wseg
	lda seg
	sta $D1F0
	lda $D1F0
	cmp seg
	beq wok
	inc $604
wok
	lda #0
	sta n
wn
	jsr setbank
	jsr calc
	lda lo
	sta $4000
	lda hi
	eor #$A5
	sta $4001
	lda lo
	eor #$FF
	sta $7FFF
	inc n
	lda n
	cmp #64
	bne wn
	inc seg
	lda seg
	cmp #8
	bne wseg

	lda #0
	sta seg
rseg
	lda seg
	sta $D1F0
	lda #0
	sta n
rn
	jsr setbank
	jsr calc
	lda $4000
	cmp lo
	bne fail
	lda $4001
	eor #$A5
	cmp hi
	bne fail
	lda $7FFF
	eor #$FF
	cmp lo
	bne fail
	inc $600
	bne bad
	inc $601
	jmp bad
fail
	ldx seg
	inc $610,x
bad
	inc n
	lda n
	cmp #64
	bne rn
	inc seg
	lda seg
	cmp #8
	bne rseg

	lda #$FF
	sta $D301
	lda $4000
	cmp #$5A
	bne nb
	inc $605
nb
	lda #5
	sta $D1F0
	lda #$FF
	sta $D301
	lda #0
	sta $D1F0
	lda $D1F0
	bne done
	inc $606
done
	lda #1
	sta $602
	jmp *

setbank
	lda n
	and #7
	asl
	sta t
	lda n
	:3 lsr @
	:5 asl @
	ora t
	ora #$01
	sta $D301
	rts

calc
	lda seg
	and #3
	:6 asl @
	ora n
	sta lo
	lda seg
	lsr
	lsr
	sta hi
	rts

	run start
