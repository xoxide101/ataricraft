drawtext
 lda #0
 sta pfn
 sta pwi
 sta pwh
 sta col
 sta style
 sta bf
 lda #64
 sta lim
 lda rr
 cmp #$FF
 beq dt0
 cmp #$FE
 beq dtb
 cmp #ROWS
 bcc dt0
dtb inc bf
 lda #53
 sta lim
dt0 lda rr
 cmp #$FE
 beq dtpx
 cmp #ROWS+1
 bne dtal
 lda mn
 cmp #2
 bne dtal
dtpx jmp pxtext
dtal lda bf
 beq dtal2
 jmp dt1
dtal2 ldx t0
 jsr pstyle
 sta style
 ldx t0
 jsr paln
 sta pam
 ldx t0
 jsr lwid
 sta pwd
 lda #22
 sta pcs
 lda #24
 sta pch1
 ldx t0
 jsr pfind
 sta pfn
 lda #24
 sta pcs
 lda #25
 sta pch1
 ldx t0
 jsr pfind
 beq dtns
 jmp spdraw
dtns
 lda #0
 sta jon
 sta jsn
 ldy #0
 ldx #0
dla1 lda (tp),y
 beq dla9
 cmp #13
 beq dla9
 cmp #14
 beq dla9
 cmp #5
 bcc dla2
 cmp #13
 bcc dla2
 cmp #15
 bcc dlav
 cmp #32
 bcc dla2
dlav cmp #32
 bne dlax
 inc jsn
dlax inx
dla2 iny
 bne dla1
dla9 stx pln
 jsr szgx
 lda (tp),y
 sta ptm
 lda pwd
 sec
 sbc pln
 bcs dla4
 lda #0
dla4 sta pln
 lda #0
 ldx pam
 cpx #16
 bne dlc
 lda pln
 ldx pwi
 beq dlr
 asl
dlr jmp dlb
dlc cpx #15
 bne dld
 lda pln
 ldx pwi
 bne dlb
 lsr
 jmp dlb
dld cpx #17
 bne dlb
 lda pwi
 beq dld2
 lda #0
 beq dlb
dld2 lda ptm
 cmp #14
 bne dlb
 lda jsn
 beq dlb
 lda pln
 beq dlb
 ldx #0
dlq cmp jsn
 bcc dlq2
 sbc jsn
 inx
 bne dlq
dlq2 sta jr
 stx jq
 lda #1
 sta jon
 lda #0
dlb clc
 adc lm
 clc
 adc pof
 sta col
 lda pbu
 beq dt1
 lda t0
 cmp pal
 bne dt1
 lda col
 pha
 lda lm
 sta col
 ldx #'*'
 lda pbu
 cmp #19
 beq dlbb
 ldx #'-'
dlbb txa
 jsr drawchar
 pla
 sta col
dt1 jsr cuhit
 lda (tp),y
 beq dtend
 cmp #13
 beq dtend
 cmp #14
 beq dtend
 cmp #5
 bcc dtsty
 cmp #13
 bcc dtmk
 cmp #15
 bcc dtchar
 cmp #32
 bcs dtchar
 jmp dtnext
dtsty tax
 lda stab-1,x
 eor style
 sta style
 jmp dtnext
dtchar lda pwi
 beq dtch0
 jmp szchar
dtch0 lda col
 cmp dfrom
 bcc dtskip
 ldy #0
 lda (tp),y
 ldx bf
 bne dtc6
 jsr drawchar
 jmp dtskip
dtc6 jsr drawchar6
dtskip
 inc col
 lda jon
 beq dtj2
 ldy #0
 lda (tp),y
 cmp #32
 bne dtj2
 lda col
 clc
 adc jq
 sta col
 lda jr
 beq dtj2
 dec jr
 inc col
dtj2 lda col
 cmp lim
 bcs dtend
dtnxj jmp dtnext
dtnext
 inc16 tp
 jmp dt1
dtend rts
dtmk cmp #11
 bcc dtnxj
 tax
 lda stb2-11,x
 eor style
 sta style
 jmp dtnext

; A = ascii; draws at col on the row in rs
drawchar
 cmp #128
 bcc dc0
 cmp #160
 beq dcsp
 cmp #173
 bne dc0
 lda #'-'
 bne dc0
dcsp lda #32
dc0 sec
 sbc #32
 bcs dc1
 lda #0
dc1 sta gp
 lda #0
 sta gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 asl gp
 rol gp+1
 lda gp+1
 clc
 adc #>FNT
 sta gp+1
 ldx col
 lda COLB,x
 clc
 adc rs
 sta sp
 lda rs+1
 adc #0
 sta sp+1
 lda COLS,x
 sta shf
 ora #31
 tax
 lda SHH,x
 eor #$FF
 sta mh
 lda SHL,x
 eor #$FF
 sta ml
 lda #0
 sta ry
dc2 ldy ry
 lda style
 and #48
 beq dcn
 and #16
 beq dcsb
 lda spt,y
 jmp dcm
dcsb lda sbt,y
dcm cmp #$FF
 bne dcm2
 lda #0
 beq dcs
dcm2 tay
dcn lda (gp),y
dcs sta v
 lda style
 jsr bld
 and #1
 beq dc6
 lda v
 lsr
 ora v
 sta v
dc6 ldx gp+1
 cpx #>SYM
 beq dc6g
 asl v
dc6g
 lda style
 and #2
 beq dc7
 ldy ry
 cpy #4
 bcs dc7
 lsr v
dc7 lda style
 and #4
 beq dc8
 ldy ry
 cpy #7
 bne dc8
 lda #$1F
 sta v
dc8 lda style
 and #8
 beq dc9
 lda v
 eor #$1F
 sta v
dc9 jsr lite
 lda v
 ora shf
 tax
 lda SHH,x
 sta hi
 lda SHL,x
 sta lo
 ldy #0
 lda (sp),y
 and mh
 ora hi
 sta (sp),y
 iny
 lda (sp),y
 and ml
 ora lo
 sta (sp),y
 lda sp
 clc
 adc #40
 sta sp
 bcc dca
 inc sp+1
dca inc ry
 lda ry
 cmp #8
 beq dcx
 jmp dc2
dcx rts

stab dta b(1),b(2),b(4),b(8)
stb2 dta b(16),b(32)
spt dta b(0),b(2),b(3),b(5),b(6),b($FF),b($FF),b($FF)
sbt dta b($FF),b($FF),b($FF),b(0),b(2),b(3),b(5),b(6)


