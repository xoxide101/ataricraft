; Typing style and alignment keys (overlay H). See docs/ACWRITER-PAGE.md for the key table.
; ^B ^I ^U ^T only set the style of the text typed next (pend, shown in the status line); the style codes
; are put in the document when the next character is typed.
pcx = $BFEA
pdf = $BFEB
pdn = $BFEC

; X = index into the key table styt: 0-3 style, 4-7 align, 8 Tab (indent on/off), 9-10 Shift-Tab / Ctrl-Tab (outdent)
stykey cpx #11
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
arc dta 6,7,14,15
ard dta 30,31,28,29