; Current font name and size, for the status line, the Character > font messages and the font prompt.
; Size = the paragraph's width step in pixels (PWt in scale.inc, 5 px when it has no width mark).
fv1 = $BFE0                    ; font slot of the paragraph at the cursor
fv2 = $BFE1                    ; its width step 0..5
fv3 = $BFE2                    ; loop counter

; append "Name Npx" for the paragraph at the cursor to BUF
fdesc lda #0
 ldx fpn
 beq fd1
 jsr o_fslot
fd1 sta fv1
 lda #25
 sta pcs
 lda #31
 sta pch1
 ldx cl
 jsr pfind
 bne fd2
 lda #26
fd2 sec
 sbc #25
 sta fv2
 lda fv1
 jsr fname
 lda #' '
 jsr putc
 ldx fv2
 lda PWt,x
 jsr putnum
 lda #'p'
 jsr putc
 lda #'x'
 jmp putc

; the name of font slot A (0 = the built-in Craft face)
fname tax
 bne fn1
 lda #<fcraft
 ldx #>fcraft
 jmp putstr
fn1 dex
 txa
 asl
 asl
 asl
 asl
 clc
 adc #<fnm
 ldx #>fnm
 jmp putstr
fcraft dta c'Craft',b(0)

fnote lda #13
 sta cmsg
 rts
