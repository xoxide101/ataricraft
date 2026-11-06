; drawing of fields, cells, rows, headers, bar and status line

; TMPS text into a field of cwd chars at gx,gy (last char is a gap); alignment from RECB
drawfield
 lda cwd
 sec
 sbc #1
 sta t3
 lda TMPS
 cmp t3
 bcc df1
 lda t3
df1 sta t2
 lda t3
 sec
 sbc t2
 sta t1                       ; free space
 lda RECB+3
 lsr
 lsr
 lsr
 and #3
 bne df2
 lda RECB+1
 cmp #1
 bne dfl
 lda #3
 bne df2
dfl lda #1
df2 cmp #2
 beq dfc
 cmp #3
 beq dfr
 lda #0
 beq dfs
dfc lda t1
 lsr
 jmp dfs
dfr lda t1
dfs sta t4                    ; left pad
 sta dn
 beq df4
df3 lda #32
 jsr pcx
 dec dn
 bne df3
df4 lda #0
 sta di
df5 lda di
 cmp t2
 bcs df6
 tax
 lda TMPS+1,x
 jsr pcx
 inc di
 jmp df5
df6 lda cwd
 sec
 sbc t4
 sec
 sbc t2
 sta dn
 beq df8
df7 lda #32
 jsr pcx
 dec dn
 bne df7
df8 rts

drawcell
 lda qc
 sec
 sbc vc0
 bcc dcx
 cmp nvc
 bcs dcx
 tax
 lda VCX,x
 sta gx
 lda VCW,x
 sta cwd
 lda qr
 sec
 sbc vr0
 bcc dcx
 cmp #VROWS
 bcs dcx
 clc
 adc #2
 sta gy
 jsr rdrec
 lda #0
 sta invm
 lda qr
 cmp cr
 bne dc1
 lda qc
 cmp cc
 bne dc1
 lda #$FF
 sta invm
dc1 ldx cwd
 dex
 stx fitw
 jsr ctext
 jmp drawfield
dcx rts

drawrow
 lda #0
 sta lpk
dr1 lda lpk
 cmp nvc
 bcs dr2
 clc
 adc vc0
 sta qc
 jsr drawcell
 inc lpk
 jmp dr1
dr2 ldx nvc
 dex
 lda VCX,x
 clc
 adc VCW,x
 sta gx
 lda qr
 sec
 sbc vr0
 clc
 adc #2
 sta gy
 lda #0
 sta invm
 jmp fillto

; row number header for row qr
rowhdr
 lda qr
 sec
 sbc vr0
 clc
 adc #2
 sta gy
 lda #0
 sta gx
 lda #$FF
 sta invm
 lda qr
 cmp cr
 bne rh1
 lda #0
 sta invm
rh1 lda qr
 clc
 adc #1
 sta t4
 cmp #100
 bcs rh3
 lda #32
 jsr pcx
 lda t4
 cmp #10
 bcs rh3
 lda #32
 jsr pcx
rh3 lda t4
 jmp prnum

; 1..199 as decimal through pcx (t2 = leading digit seen)
prnum
 ldx #0
 stx t2
 cmp #100
 bcc pn1
 sbc #100
 pha
 lda #'1'
 jsr pcx
 pla
 inc t2
pn1 ldx #'0'
pn2 cmp #10
 bcc pn3
 sbc #10
 inx
 bne pn2
pn3 pha
 cpx #'0'
 bne pn4
 lda t2
 beq pn5
pn4 txa
 jsr pcx
pn5 pla
 clc
 adc #'0'
 jmp pcx

drawhdr
 lda #1
 sta gy
 lda #0
 sta gx
 lda #$FF
 sta invm
 lda #32
 jsr pcx
 lda #32
 jsr pcx
 lda #32
 jsr pcx
 lda #0
 sta lpk
dh1 lda lpk
 cmp nvc
 bcs dh9
 ldx lpk
 lda VCX,x
 sta gx
 lda VCW,x
 sta cwd
 lda #$FF
 sta invm
 lda vc0
 clc
 adc lpk
 cmp cc
 bne dh2
 lda #0
 sta invm
 lda vc0
 clc
 adc lpk
dh2 clc
 adc #'A'
 sta t4
 lda cwd
 lsr
 sta t3
 lda #0
 sta di
dh3 lda di
 cmp cwd
 bcs dh5
 cmp t3
 bne dh4
 lda t4
 jmp dh4b
dh4 lda #32
dh4b jsr pcx
 inc di
 jmp dh3
dh5 inc lpk
 jmp dh1
dh9 lda #0
 sta invm
 jmp fillto

; entry bar: reference and content (navigation), or the text being typed (entry)
drawbar
 lda #0
 sta gx
 sta gy
 sta invm
 lda cc
 clc
 adc #'A'
 jsr pcx
 lda cr
 clc
 adc #1
 jsr prnum
 lda #':'
 jsr pcx
 lda mode
 cmp #1
 beq db_ent
 cmp #2
 beq db_file
 lda cr
 sta qr
 lda cc
 sta qc
 jsr rdrec
 lda RECB
 cmp #3
 bne db1
 lda #'='
 jsr pcx
 lda RECB+10
 sta rp
 lda RECB+11
 sta rp+1
 jsr hget
 jmp db2
db1 lda #30
 sta fitw
 lda #0
 sta RECB+2
 jsr ctext
db2 jmp db_txt
db_ent
 lda #0
 sta di
db3 lda di
 cmp elen
 bcs db4
 tax
 lda EBUF,x
 jsr pcx
 inc di
 jmp db3
db4 lda #'_'
 jsr pcx
 jmp fillto
db_file
 lda pch
 jsr pcx
 lda #0
 sta di
 jmp db3
db_txt
 lda #0
 sta di
db5 lda di
 cmp TMPS
 bcs db6
 tax
 lda TMPS+1,x
 jsr pcx
 inc di
 lda gx
 cmp #40
 bcc db5
db6 jmp fillto

drawstat
 lda #23
 sta gy
 lda #0
 sta gx
 sta invm
 lda #<MSGS
 sta ptr
 lda #>MSGS
 sta ptr+1
 ldx msg
 beq ds2
ds1 ldy #0
ds1a lda (ptr),y
 iny
 cmp #0
 bne ds1a
 tya
 clc
 adc ptr
 sta ptr
 bcc ds1b
 inc ptr+1
ds1b dex
 bne ds1
ds2 ldy #0
ds3 lda (ptr),y
 beq ds4
 sty t1
 jsr pcx
 ldy t1
 iny
 lda gx
 cmp #40
 bcc ds3
ds4 jmp fillto

MSGS
 dta c'ACCalc  ^O open  ^S save  ^R calc',b(0)
 dta c'Loaded',b(0)
 dta c'I/O error',b(0)
 dta c'Not a CRFT sheet',b(0)
 dta c'Not BCD mode',b(0)
 dta c'Saved',b(0)
 dta c'Recalculated',b(0)
 dta c'Checksum mismatch',b(0)
 dta c'Short file',b(0)
 dta c'Heap full',b(0)
 dta c'File name:',b(0)
 dta c'Formula error',b(0)

drawall
 jsr layout
 jsr drawhdr
 lda #0
 sta fx
da1 lda vr0
 clc
 adc fx
 sta qr
 cmp #NROWS
 bcs da2
 jsr rowhdr
 jsr drawrow
 inc fx
 lda fx
 cmp #VROWS
 bcc da1
da2 jsr drawbar
 jmp drawstat
