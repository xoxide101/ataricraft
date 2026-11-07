rulch
 sta rc
 cmp cc
 bne rk1
 lda #'^'
 rts
rk1 cmp lm
 bne rk2
 lda #'['
 rts
rk2 cmp rm
 bne rk3
 lda #']'
 rts
rk3 ldx #0
rk4 lda tabstops,x
 cmp #$FF
 beq rk6
 cmp rc
 beq rk5
 inx
 bne rk4
rk5 lda #'v'
 rts
rk6 lda rz
 bne rkdot
 lda rc
 beq rkdot
 jsr mod10
 cmp #0
 bne rkdot
 txa
 clc
 adc #'0'
 rts
rkdot lda #'.'
 rts

ruler
 lda #0
 sta rn
 lda rz
 bne rzm
rn1 lda rn
 jsr rulch
 ldx rn
 sta BUF,x
 inc rn
 lda rn
 cmp #64
 bne rn1
 beq rdraw
rzm lda cc
 and #$E0
 cmp #64
 bcc rzs
 lda #32
rzs sta zs
rz1 lda zs
 clc
 adc rn
 jsr mod10
 clc
 adc #'0'
 pha
 lda rn
 asl
 tax
 pla
 sta BUF,x
 lda zs
 clc
 adc rn
 jsr rulch
 pha
 lda rn
 asl
 tax
 inx
 pla
 sta BUF,x
 inc rn
 lda rn
 cmp #32
 bne rz1
rdraw lda #0
 sta BUF+64
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #$FF
 sta rr
 jmp rdgo

hlr
 lda iv
 beq hlr0
 jmp invrow
hlr0 jsr rowptr
 inc sp+1
 ldy #24
hl1 lda #$FF
 sta (sp),y
 iny
 cpy #64
 bne hl1
 rts

hls
 lda iv
 beq hls0
 jmp invrow
hls0 jsr rowptr
 ldy #0
hl2 lda #$FF
 sta (sp),y
 iny
 cpy #40
 bne hl2
 rts

invrow
 jsr rowptr
 ldy #0
iv1 lda (sp),y
 eor #$FF
 sta (sp),y
 iny
 bne iv1
 inc sp+1
iv2 lda (sp),y
 eor #$FF
 sta (sp),y
 iny
 cpy #64
 bne iv2
 rts

status0
 jsr ruler
 lda #0
 sta bi
 lda #<s1
 ldx #>s1
 jsr putstr
 lda cl
 clc
 adc #1
 jsr putnum
 lda #<s2
 ldx #>s2
 jsr putstr
 lda cc
 jsr putnum
 lda #' '
 jsr putc
 lda dend
 sec
 sbc #<DOC
 sta src
 lda dend+1
 sbc #>DOC
 sta src+1
 jsr putn16
 lda #<s3
 ldx #>s3
 jsr putstr
 lda #>LPL
 sec
 sbc dend+1
 lsr
 lsr
 jsr putnum
 lda #<s4
 ldx #>s4
 jsr putstr
 lda lm
 bne sm1
 lda rm
 cmp #63
 beq sm2
sm1 lda #<fm
 ldx #>fm
 jsr putstr
 lda lm
 jsr putnum
 lda #'-'
 jsr putc
 lda rm
 jsr putnum
sm2 jsr curstyle
 lsr
 bcc sg1
 pha
 lda #<fbl
 ldx #>fbl
 jsr putstr
 pla
sg1 lsr
 bcc sg2
 pha
 lda #<fit
 ldx #>fit
 jsr putstr
 pla
sg2 lsr
 bcc sg3
 lda #<fun
 ldx #>fun
 jsr putstr
sg3 lda rz
 beq sf1
 lda #<fz
 ldx #>fz
 jsr putstr
sf1 lda iv
 beq sf2
 lda #<fi
 ldx #>fi
 jsr putstr
sf2 ldx th
 beq sf3
 lda tfl,x
 pha
 lda tfh,x
 tax
 pla
 jsr putstr
sf3 lda #' '
 jsr putc
 jsr fdesc
 jsr stfin
 lda #<BUF
 sta tp
 lda #>BUF
 sta tp+1
 lda #ROWS
 sta rr
 jmp stgo

s1 dta c'Ln ',b(0)
s2 dta c' Col ',b(0)
s3 dta c' ch ',b(0)
s4 dta c'K free',b(0)
fm dta c' M ',b(0)
fbl dta c' ',b(4),c'BLD',b(4),b(0)
fit dta c' ',b(4),c'ITA',b(4),b(0)
fun dta c' ',b(4),c'UND',b(4),b(0)
fz dta c' ',b(4),c'ZUM',b(4),b(0)
fi dta c' ',b(4),c'INV',b(4),b(0)
fb dta c' ',b(4),c'BLU',b(4),b(0)
fam dta c' ',b(4),c'AMB',b(4),b(0)
fgr dta c' ',b(4),c'GRN',b(4),b(0)
tfl dta l(fb),l(fb),l(fam),l(fgr)
tfh dta h(fb),h(fb),h(fam),h(fgr)
kname dta c'K:',b($9B)
helpmsg dta c'Esc menu  ^X command  ^B ^I ^U style  F1 help',b(0)

; Caps lock indicator at column 49 of the status line: inverse CAPS when on (SHFLOK bit 6), plain caps when off
capsv = $BFE3
capscol = $BFE4
capsput lda capscol
 jsr stpad
 lda SHFLOK
 and #$40
 sta capsv
 beq cpo
 lda #<fcap
 ldx #>fcap
 jmp putstr
cpo lda #<fnoc
 ldx #>fnoc
 jmp putstr
fcap dta b(4),c'CAPS',b(4),b(0)
fnoc dta c'caps  ',b(0)

; idle loop: redraw the status line when the caps lock changed
capsck lda SHFLOK
 and #$40
 cmp capsv
 beq cck9
 jmp status
cck9 rts

; The K: handler swallows the Caps key and then waits for the next real key, which would leave the status line stale,
; so the Caps key is handled here (plain = toggle, Shift = caps lock, Control = control lock) before it reaches K:.
lckc jsr capskey
 bcc lckn
 jsr capsck
 jmp loop
lckn jmp lgot
capskey lda CH
 and #$3F
 cmp #$3C
 bne cknot
 lda CH
 asl
 bcs ckct
 bmi cksh
 ldx #0
 lda SHFLOK
 bne ckst
cksh ldx #$40
 bne ckst
ckct ldx #$80
ckst stx SHFLOK
 lda #$FF
 sta CH
 sec
 rts
cknot clc
 rts

capsset ldx #49
 lda hmode
 cmp #PGV
 bne stf0
 ldx #41
stf0 stx capscol
 txa
 sec
 sbc #10
 sta qqt
 lda bi
 cmp qqt
 bcc stf1x
 lda qqt
 sta bi
stf1x rts
