; Typing style and alignment keys (overlay H). See docs/ACWRITER-PAGE.md for the key table.
; ^B ^I ^U ^T only set the style of the text typed next (pend, shown in the status line); the style codes
; are put in the document when the next character is typed.
pcx = $BFEA
pdf = $BFEB
pdn = $BFEC

; X = index into the key table styt: 0-3 style, 4-7 align, 8 Tab (indent on/off), 9-10 Shift-Tab / Ctrl-Tab (outdent)
stykey cpx #12
 bne sk01
 jmp pmap
sk01 cpx #11
 bne sk0
 jmp selmap
sk0 cpx #4
 bcs sk3
 stx pcx
 jsr showsty
 lda stv
 sta pend
 ldx pcx
 lda pcb,x
 eor pend
 sta pend
 lda cl
 sta pvl
 lda cc
 sta pvc
 lda #1
 sta pvf
 jmp status
sk3 cpx #8
 bcs sk5
 lda sal-4,x
 jmp cmdexec
sk5 bne sk6
 lda hmode
 cmp #PGV
 bne sk5a
 jmp pwtab
sk5a lda #24
 jmp cmdexec
sk6 jsr sk9
 beq sk8
 lda #24
 jmp cmdexec
sk8 rts
sk9 lda #18
 sta pcs
 lda #19
 sta pch1
 ldx cl
 jmp pfind

; first typed character after a style change: close the changed styles in front of the text that follows
; (so it keeps its own style), then open them and put the character in
ptype jsr curstyle
 eor pend
 sta pdf
 lda #0
 sta pvf
 lda pdf
 beq pt1
 jsr curptr
 ldy #0
 lda (src),y
 beq pt1
 cmp #13
 beq pt1
 jsr pcodes
pt0 jsr kleft
 dec pdn
 bne pt0
pt1 jsr pcodes
 lda kk
 jmp insert
pcodes ldx #0
 stx pdn
pc1 lda pdf
 and pcb,x
 beq pc2
 stx pcx
 lda stcode,x
 jsr insert
 inc pdn
 ldx pcx
pc2 inx
 cpx #4
 bcc pc1
 rts
pcb dta b(1),b(2),b(4),b($40)
sal dta b(20),b(21),b(22),b(23)

; Selection keys (called from handle when a selection exists or Shift is down). Returns A = 1: toggle the mark
; (Shift+arrow with no selection starts one, a plain arrow ends a Shift selection), A = 2: delete the selected
; text first (typing over it), A = 0: nothing. Windows clipboard keys are translated to the ^D ^Y ^P commands.
shsel = $BFEF
selmap lda kk
 cmp #$1C
 bcc sm5
 cmp #$20
 bcs sm5
 lda keyshift
 bne sm1
 lda ed_on
 and shsel
 beq sm9
 lda #0
 sta shsel
 lda #1
sm9 rts
sm1 lda ed_on
 bne sm0
 lda #1
 sta shsel
 rts
sm5 lda kk
 ldx #0
 stx shsel
 ldy ed_on
 beq sm0
 ldx #3
sm6 cmp smk,x
 beq sm7
 dex
 bpl sm6
 cmp #32
 bcc sm0
 cmp #125
 bcc sm8
 cmp #$9B
 bne sm0
sm8 lda #2
 rts
sm7 lda smt,x
 sta kk
sm0 lda #0
 rts
smk dta 24,3,22,126
smt dta 4,25,16,4
; Page map: 24 x 8 px box at the right end of the status row. It is the whole document laid out left to right,
; with a tick for each page break and a thick bar for the part on screen (PAGE mode has its own map in page.inc).
pmt dta b(0)
pms dta b(0)
pmw dta b(0)
pma dta b(0)
pmq dta b(0)
pmr dta b(0)
pmk dta b(0)
pmi dta b(0)
pmc dta b(0)
pda dta b(0)
pmx dta b(0)
pmm dta b(0),b(0),b(0),b(0),b(0),b(0)
pbt dta b($80),b($40),b($20),b($10),b(8),b(4),b(2),b(1)
pmap lda hmode
 cmp #PGV
 bne pm0
 rts
pm0 lda nl
 cmp #255
 bcs pm1
 adc #1
pm1 sta pmt
 lda #$80
 sta pmm
 sta pmm+3
 lda #1
 sta pmm+2
 sta pmm+5
 lda #0
 sta pmm+1
 sta pmm+4
 lda top
 jsr pdiv
 sta pms
 lda #ROWS
 jsr pdiv
 cmp #1
 bcs pm2
 lda #1
pm2 cmp #23
 bcc pm3
 lda #22
pm3 sta pmw
 clc
 adc pms
 cmp #23
 bcc pm4
 lda #22
 sec
 sbc pmw
 sta pms
pm4 lda pms
 sta pmi
pm5 inc pmi
 lda pmi
 ldx #0
 jsr pset
 lda pmi
 sec
 sbc pms
 cmp pmw
 bcc pm5
 jsr stcalc
 lda qqt
 sta pmk
 lda #0
 sta pma
pm6 dec pmk
 beq pm8
 lda pma
 clc
 adc qql
 bcs pm8
 sta pma
 jsr pdiv
 clc
 adc #1
 ldx #3
 jsr pset
 jmp pm6
pm8 lda #ROWS
 sta rr
 jsr rowptr
 lda sp
 clc
 adc #37
 sta sp
 bcc pm9
 inc sp+1
pm9 ldx #0
pm10 stx pmc
 cpx #0
 beq pmfl
 cpx #7
 beq pmfl
 ldx #0
 lda pmc
 cmp #1
 beq pmtk
 cmp #6
 bne pmvw
pmtk ldx #3
pmvw ldy #0
pmcp lda pmm,x
 sta (sp),y
 inx
 iny
 cpy #3
 bcc pmcp
 bcs pmn
pmfl ldy #2
 lda #$FF
pmf2 sta (sp),y
 dey
 bpl pmf2
pmn lda sp
 clc
 adc #40
 sta sp
 bcc pmn1
 inc sp+1
pmn1 ldx pmc
 inx
 cpx #8
 bcc pm10
 rts
; A * 22 / pmt (0..22)
pdiv sta pda
 ldy #22
 lda #0
 sta pmq
 sta pmr
pd1 lda pmr
 clc
 adc pda
 bcs pd2
 cmp pmt
 bcc pd3
pd2 sbc pmt
 inc pmq
pd3 sta pmr
 dey
 bne pd1
 lda pmq
 rts
pset pha
 lsr
 lsr
 lsr
 sta pmx
 txa
 clc
 adc pmx
 tax
 pla
 and #7
 tay
 lda pbt,y
 ora pmm,x
 sta pmm,x
 rts
arc dta 6,7,14,15
ard dta 30,31,28,29