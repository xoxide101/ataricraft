; EBookCraft page viewer for the Atari 8-bit. Two builds from this one source (see tools\ebookcraft\build-viewer.cjs):
;   XEX=0  boot sector image: org $0700, no DOS needed; pages are read straight from disk sectors (60 sectors of 128 bytes per page)
;   XEX=1  DOS .XEX: org $2000; up to three pages are appended by the packer at $6000, $7E00, $9C00
; Page = 7680 bytes of screen memory, 40 bytes x 192 lines, in ANTIC mode F (GR.8, 1-bit) / E (GR.15, 4 gray) / F + GTIA mode 9 (GR.9, 16 gray).
; The packer patches the fields right after the first JMP: npages, mode, sec0 and the five colour bytes (file offsets 9..18 in both builds).
; Keys: SPACE, N, Ctrl+Right, Ctrl+Down or START = next page; B, P, Ctrl+Left, Ctrl+Up or OPTION = previous.

SDMCTL = $022F
SDLSTL = $0230
GPRIOR = $026F
COLOR0 = $02C4
COLOR4 = $02C8
CH     = $02FC
CONSOL = $D01F
DDEVIC = $0300
DUNIT  = $0301
DCOMND = $0302
DSTATS = $0303
DBUFLO = $0304
DBUFHI = $0305
DTIMLO = $0306
DBYTLO = $0308
DBYTHI = $0309
DAUX1  = $030A
DAUX2  = $030B
SIOV   = $E459

cur = $80
sl  = $82
bp  = $84
cnt = $86
t0  = $87
t1  = $88
c2  = $89
sp  = $8B
dp  = $8D
mb  = $8F

scr = $4010
dl  = $0600

	.if XEX=0
	opt h-
	org $0700
	.byte 0, [[viewer_end-$0700+127]/128]
	.word $0700, rts_
	.else
	org $2000
	.endif

start	jmp go
npages	.word 1
mode	.byte 0
sec0	.word 9
pal	.byte $0F,$00,$00,$0F,$00

go	lda #0
	sta SDMCTL
	jsr build
	lda #<dl
	sta SDLSTL
	lda #>dl
	sta SDLSTL+1
	lda pal
	sta COLOR4
	lda pal+1
	sta COLOR0
	lda pal+2
	sta COLOR0+1
	lda pal+3
	sta COLOR0+2
	lda pal+4
	sta COLOR0+3
	lda #0
	sta GPRIOR
	lda mode
	cmp #2
	bne go1
	lda #$40
	sta GPRIOR
go1	lda #0
	sta cur
	sta cur+1
	lda #$FF
	sta CH
	jsr show
	lda #$22
	sta SDMCTL

loop	lda CONSOL
	and #7
	cmp #6
	beq cnext
	cmp #3
	beq cprev
	lda CH
	cmp #$FF
	beq loop
	ldx #$FF
	stx CH
	cmp #$21
	beq next
	cmp #$23
	beq next
	cmp #$87
	beq next
	cmp #$8F
	beq next
	cmp #$15
	beq prev
	cmp #$0A
	beq prev
	cmp #$86
	beq prev
	cmp #$8E
	beq prev
	jmp loop
cnext	jsr donext
	jsr wrel
	jmp loop
cprev	jsr doprev
	jsr wrel
	jmp loop
next	jsr donext
	jmp loop
prev	jsr doprev
	jmp loop

wrel	lda CONSOL
	and #7
	cmp #7
	bne wrel
	rts

donext	lda cur
	clc
	adc #1
	sta t0
	lda cur+1
	adc #0
	sta t1
	cmp npages+1
	bcc dn1
	bne dn2
	lda t0
	cmp npages
	bcs dn2
dn1	lda t0
	sta cur
	lda t1
	sta cur+1
	jsr show
dn2	rts

doprev	lda cur
	ora cur+1
	beq dp2
	lda cur
	bne dp1
	dec cur+1
dp1	dec cur
	jsr show
dp2	rts

build	lda #$70
	sta dl
	sta dl+1
	sta dl+2
	ldy #3
	lda mode
	cmp #1
	bne b1
	lda #$0E
	bne b2
b1	lda #$0F
b2	sta mb
	ora #$40
	sta dl,y
	iny
	lda #<scr
	sta dl,y
	iny
	lda #>scr
	sta dl,y
	iny
	ldx #101
	lda mb
b3	sta dl,y
	iny
	dex
	bne b3
	ora #$40
	sta dl,y
	iny
	lda #0
	sta dl,y
	iny
	lda #$50
	sta dl,y
	iny
	ldx #89
	lda mb
b4	sta dl,y
	iny
	dex
	bne b4
	lda #$41
	sta dl,y
	iny
	lda #<dl
	sta dl,y
	iny
	lda #>dl
	sta dl,y
	rts

	.if XEX=0
show	lda sec0
	sta sl
	lda sec0+1
	sta sl+1
	lda cur
	sta c2
	lda cur+1
	sta c2+1
sh1	lda c2
	ora c2+1
	beq sh2
	clc
	lda sl
	adc #60
	sta sl
	bcc sh0
	inc sl+1
sh0	lda c2
	bne sh01
	dec c2+1
sh01	dec c2
	jmp sh1
sh2	lda #<scr
	sta bp
	lda #>scr
	sta bp+1
	lda #60
	sta cnt
sh3	jsr rdsec
	clc
	lda bp
	adc #128
	sta bp
	bcc sh5
	inc bp+1
sh5	inc sl
	bne sh4
	inc sl+1
sh4	dec cnt
	bne sh3
	rts

rdsec	lda #$31
	sta DDEVIC
	lda #1
	sta DUNIT
	lda #$52
	sta DCOMND
	lda #$40
	sta DSTATS
	lda bp
	sta DBUFLO
	lda bp+1
	sta DBUFHI
	lda #$0F
	sta DTIMLO
	lda #128
	sta DBYTLO
	lda #0
	sta DBYTHI
	lda sl
	sta DAUX1
	lda sl+1
	sta DAUX2
	jmp SIOV
rts_	rts
	.else
show	lda #$60
	ldx cur
	beq s1
s0	clc
	adc #30
	dex
	bne s0
s1	sta sp+1
	lda #0
	sta sp
	lda #<scr
	sta dp
	lda #>scr
	sta dp+1
	ldx #30
s2	ldy #0
s3	lda (sp),y
	sta (dp),y
	iny
	bne s3
	inc sp+1
	inc dp+1
	dex
	bne s2
	rts
	.endif
viewer_end

	.if XEX=1
	org $02E0
	.word go
	.endif
