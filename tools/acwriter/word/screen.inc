mktab
 lda #0
 sta tmp
 sta gp+1
 tax
mt1 lda tmp
 lsr
 lsr
 lsr
 sta t0
 lda gp+1
 asl
 asl
 asl
 asl
 asl
 ora t0
 sta COLB,x
 lda tmp
 and #7
 asl
 asl
 asl
 asl
 asl
 sta COLS,x
 lda tmp
 clc
 adc #5
 sta tmp
 bcc mt2
 inc gp+1
mt2 inx
 cpx #64
 bne mt1
 jsr mksh
 lda #<SCR
 sta src
 lda #>SCR
 sta src+1
 ldx #0
mt3 lda src
 sta ROWL,x
 lda src+1
 sta ROWH,x
 lda src
 clc
 adc #<320
 sta src
 lda src+1
 adc #>320
 sta src+1
 inx
 cpx #24
 bne mt3
 rts

; rebuild line pointer table
scan
 lda #<DOC
 ldx #>DOC
scanat
 sta tp
 stx tp+1
 ldx #0
sc1 lda tp
 sta LPL,x
 lda tp+1
 sta LPH,x
 inx
sc2 ldy #0
 lda (tp),y
 beq sc3
 inc16 tp
 cmp #13
 beq sc4
 cmp #14
 bne sc2
sc4 jmp sc1
sc3 stx nl
 lda tp
 sta dend
 lda tp+1
 sta dend+1
 rts

full jsr mkyt
 lda #0
 sta rr
fu1 lda top
 clc
 adc rr
 sta t0
 jsr drawdoc
 inc rr
 lda rr
 cmp vis
 bne fu1
 ldx vis
 lda YT,x
 sta zl
 lda #160
 sec
 sbc zl
 beq fu3
 sta zh
 lda zl
 jsr ypos
fu2 lda #0
 ldy #39
fu2a sta (sp),y
 dey
 bpl fu2a
 lda sp
 clc
 adc #40
 sta sp
 bcc fu2b
 inc sp+1
fu2b dec zh
 bne fu2
fu3 rts


appendcur
 lda lm
 bne apr
 lda #15
 sta pcs
 lda #32
 sta pch1
 ldx cl
 jsr pfind
 beq apc
apr
 jmp redrawcur
apc
 lda cl
 sec
 sbc top
 sta rr
 jsr rowptr
 ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 lda cc
 sec
 sbc #1
 sta dfrom
 jsr drawtext
 lda #0
 sta dfrom
 rts

drawdoc
 jsr rowsetup
 lda t0
 cmp nl
 bcs dd0
 tax
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 jmp drawtext
dd0 rts

rowsetup
 jsr rowptr
 lda #8
 sta zh
 lda anyv
 beq rs0
 lda t0
 cmp nl
 bcs rs0
 tax
 jsr lineh
 sta zh
rs0
rs1 lda #0
 ldy #39
rs2 sta (sp),y
 dey
 bpl rs2
 lda sp
 clc
 adc #40
 sta sp
 bcc rs3
 inc sp+1
rs3 dec zh
 bne rs1
 rts

; A = pixel y within the text area; sets rs and sp to that scanline
ypos sta zw0
 lda #0
 sta zw1
 asl zw0
 rol zw1
 asl zw0
 rol zw1
 asl zw0
 rol zw1
 lda zw0
 sta zm0
 lda zw1
 sta zm1
 asl zm0
 rol zm1
 asl zm0
 rol zm1
 lda zw0
 clc
 adc zm0
 sta zm0
 lda zw1
 adc zm1
 sta zm1
 lda zm0
 clc
 adc #<(SCR+640)
 sta rs
 sta sp
 lda zm1
 adc #>(SCR+640)
 sta rs+1
 sta sp+1
 rts

; X = line; A = its height in scanlines (8 unless a height marker says otherwise)
lineh lda #5
 sta pcs
 lda #11
 sta pch1
 jsr pfind
 beq lh1
 sec
 sbc #4
 asl
 asl
 rts
lh1 lda #8
 rts

; compute the pixel y of each visible line (YT) and how many fit (vis)
mkyt lda #0
 sta zy
 sta zx
mky1 lda top
 clc
 adc zx
 sta zl
 lda #8
 sta zh
 lda anyv
 beq mky2
 lda zl
 cmp nl
 bcs mky2
 tax
 jsr lineh
 sta zh
mky2 lda zx
 beq mky3
 lda zy
 clc
 adc zh
 cmp #161
 bcs mky4
mky3 ldx zx
 lda zy
 sta YT,x
 clc
 adc zh
 sta zy
 inc zx
 lda zx
 cmp #ROWS
 bne mky1
mky4 lda zx
 sta vis
 tax
 lda zy
 sta YT,x
 rts


rowptr
 ldx rr
 cpx #ROWS
 bcs rpo
 lda YT,x
 jmp ypos
rpo inx
 inx
 lda ROWL,x
 sta rs
 sta sp
 lda ROWH,x
 sta rs+1
 sta sp+1
 rts

