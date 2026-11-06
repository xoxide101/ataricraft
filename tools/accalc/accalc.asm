; ACCalc - Atari-native spreadsheet for the 130XE (docs/ACCALC.md)
 icl 'defs.inc'

or0 = $1514
oc0 = $1515
pch = $1516

 org $2000

start
 lda PORTB
 ora #$83
 sta PORTB
 sta pb0
 lda #<dl
 sta SDLSTL
 lda #>dl
 sta SDLSTL+1
 lda #$22
 sta SDMCTL
 lda #$0F
 sta COLOR2
 lda #$00
 sta COLOR1
 lda #$04
 sta COLOR4
 jsr mklines
 jsr clrscr
 jsr openk
 jsr clrgrid
 lda #0
 sta cr
 sta cc
 sta vr0
 sta vc0
 sta mode
 sta msg
 sta fcnt
 sta fcnt+1
 sta dirty
 sta elen
 sta hp
 lda #$40
 sta hp+1
 ldx #15
 lda #9
st1 sta CW,x
 dex
 bpl st1
 jsr visible
 jsr drawall
 jmp loop

openk
 ldx #$20
 lda #3
 sta ICCOM,x
 lda #<kname
 sta ICBAL,x
 lda #>kname
 sta ICBAH,x
 lda #4
 sta ICAX1,x
 lda #0
 sta ICAX2,x
 jmp CIOV

getkey
 ldx #$20
 lda #7
 sta ICCOM,x
 lda #0
 sta ICBLL,x
 sta ICBLH,x
 jmp CIOV

kname dta c'K:',b($9B)

loop
 lda #0
 sta ATRACT
 lda CH
 cmp #$FF
 beq loop
 jsr getkey
 sta key
 lda mode
 cmp #2
 bne lp1
 jsr promptkey
 jmp loop
lp1 jsr navkey
 jmp loop

; ---- navigation
navkey
 lda cr
 sta or0
 lda cc
 sta oc0
 lda key
 cmp #$1C
 bne nk1
 lda cr
 beq nkx
 dec cr
 jmp moved
nk1 cmp #$1D
 beq nkdn
 cmp #$9B
 beq nkdn
 cmp #$1E
 bne nk2
 lda cc
 beq nkx
 dec cc
 jmp moved
nk2 cmp #$1F
 beq nkrt
 cmp #$7F
 beq nkrt
 cmp #$0F
 bne nk3
 lda #'O'
 jmp askname
nk3 cmp #$13
 bne nk4
 lda #'S'
 jmp askname
nk4
nkx rts
nkdn lda cr
 cmp #NROWS-1
 bcs nkx
 inc cr
 jmp moved
nkrt lda cc
 cmp #NCOLS-1
 bcs nkx
 inc cc
 jmp moved

moved
 jsr visible
 beq mv1
 jmp drawall
mv1 lda or0
 sta qr
 lda oc0
 sta qc
 jsr drawcell
 jsr rowhdr
 lda cr
 sta qr
 lda cc
 sta qc
 jsr drawcell
 jsr rowhdr
 jsr drawhdr
 jmp drawbar

; ---- file name prompt (mode 2)
askname
 sta pch
 lda #2
 sta mode
 lda #0
 sta elen
 lda #10
 sta msg
 jsr drawbar
 jmp drawstat

promptkey
 lda key
 cmp #$9B
 beq pk_go
 cmp #$1B
 beq pk_esc
 cmp #$7E
 beq pk_bs
 cmp #33
 bcc pk9
 cmp #127
 bcs pk9
 ldx elen
 cpx #36
 bcs pk9
 sta EBUF,x
 inc elen
pk9 jmp drawbar
pk_bs lda elen
 beq pk9
 dec elen
 jmp drawbar
pk_esc lda #0
 sta msg
pk_end lda #0
 sta mode
 jsr drawbar
 jmp drawstat
pk_go jsr mkname
 lda pch
 cmp #'O'
 bne pk_sv
 jsr load
 lda #0
 sta mode
 jsr visible
 jmp drawall
pk_sv jsr save
 jmp pk_end

; EBUF text -> FNB (device D1: unless given, .XCS unless an extension is given)
mkname
 ldx #0
 ldy #0
mn1 cpy elen
 bcs mn3
 lda EBUF,y
 cmp #':'
 beq mn2
 iny
 bne mn1
mn2 ldy #0
 beq mn4
mn3 lda #'D'
 sta FNB
 lda #'1'
 sta FNB+1
 lda #':'
 sta FNB+2
 ldx #3
mn4 ldy #0
 sty t1
mn5 cpy elen
 bcs mn7
 lda EBUF,y
 cmp #'a'
 bcc mn6
 cmp #'{'
 bcs mn6
 sec
 sbc #$20
mn6 sta FNB,x
 cmp #'.'
 bne mn6a
 sty t1
 inc t1
mn6a inx
 iny
 bne mn5
mn7 lda t1
 bne mn8
 ldy #0
mn7a lda xcs,y
 sta FNB,x
 inx
 iny
 cpy #4
 bne mn7a
mn8 lda #$9B
 sta FNB,x
 rts
xcs dta c'.XCS'

save
 lda #5
 sta msg
 rts

 icl 'bank.inc'
 icl 'fpu.inc'
 icl 'view.inc'
 icl 'view2.inc'
 icl 'file.inc'
 icl '..\acwriter\zfont.inc'

 org $1600
dl
 dta b($70),b($70),b($70),b($4F),a(SCR)
 :99 dta b($0F)
 dta b($4F),a(SCR+4000)
 :91 dta b($0F)
 dta b($41),a(dl)

 run start
