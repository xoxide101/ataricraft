; Typefaces (part of image Z). Character > Font loads an Atari 8x8 charset file (.FNT, 1024 bytes in OS screen-code order,
; as written by the font editor) into bank 3 and sets it for the paragraph at the cursor. A change table (fpi/fps) maps
; paragraph numbers to font slots, so a font is a per-paragraph property and can never change inside a line. The table is
; saved in the CPG1 trailer: tag 2 = font of paragraph 0, tag 3 = [paragraph u16][name] for later changes (docs/PAGE.md).
; Slot 0 is the OS ROM set; the zoom view (zoom.inc) draws each line with its paragraph's slot.

; Character > Font: ask for a file name (fop 9, handled by dofile -> fnload)
hface lda #9
 sta fop
 jmp fask

; slot of the paragraph at the cursor (for the status line)
fcurslot ldx cl
 jsr fpara
 jmp ffind

; X = line -> A = paragraph number (hard line ends before that line)
fpara stx fz3
 lda #0
 sta fz1
 sta fz2
fpa1 lda fz2
 cmp fz3
 bcs fpa9
 tax
 inx
 lda LPL,x
 sec
 sbc #1
 sta tp
 lda LPH,x
 sbc #0
 sta tp+1
 ldy #0
 lda (tp),y
 cmp #13
 bne fpa2
 inc fz1
fpa2 inc fz2
 bne fpa1
fpa9 lda fz1
 rts

; A = paragraph -> A = font slot (last change at or before it)
ffind sta fz4
 lda #0
 sta fz5
 tax
ffi1 cpx fpn
 bcs ffi9
 lda fpi,x
 cmp fz4
 beq ffi2
 bcs ffi9
ffi2 lda fps,x
 sta fz5
 inx
 bne ffi1
ffi9 lda fz5
 rts

; paragraph fz4 gets slot A
fset sta fz5
 ldx #0
fs1 cpx fpn
 bcs fs3
 lda fpi,x
 cmp fz4
 beq fs2
 bcs fs3
 inx
 bne fs1
fs2 lda fz5
 sta fps,x
 rts
fs3 lda fpn
 cmp #8
 bcs fsfull
 stx fz3
 ldy fpn
fs5 cpy fz3
 beq fs6
 lda fpi-1,y
 sta fpi,y
 lda fps-1,y
 sta fps,y
 dey
 bne fs5
fs6 ldx fz3
 lda fz4
 sta fpi,x
 lda fz5
 sta fps,x
 inc fpn
 rts
fsfull lda #44
 sta cmsg
 rts

; remove change X (X is kept)
fdel txa
 tay
fd1 iny
 cpy fpn
 bcs fd2
 lda fpi,y
 sta fpi-1,y
 lda fps,y
 sta fps-1,y
 jmp fd1
fd2 dec fpn
 rts

; slot A for the paragraph at the cursor
fsetcur pha
 ldx cl
 jsr fpara
 sta fz4
 pla
 jmp fset

; Return was pressed: later paragraphs move down by one
fsplit ldx cl
 jsr fpara
 sta fz4
 lda #1
 sta fz7
; fgrow: fz7 paragraphs were added after paragraph fz4; later entries move down
fgrow ldx #0
fsp1 cpx fpn
 bcs fsp9
 lda fpi,x
 cmp fz4
 beq fsp2
 bcc fsp2
 clc
 adc fz7
 sta fpi,x
fsp2 inx
 jmp fsp1
fsp9 rts

; fdrp: fz7 paragraphs after paragraph fz4 were merged into it; their entries go, later ones move up
fdrp ldx #0
 ldy #0
fdr1 cpx fpn
 bcs fdr8
 lda fpi,x
 cmp fz4
 beq fdr3
 bcc fdr3
 sec
 sbc fz4
 cmp fz7
 beq fdr4
 bcc fdr4
 lda fpi,x
 sec
 sbc fz7
 jmp fdr5
fdr3 lda fpi,x
fdr5 sta fpi,y
 lda fps,x
 sta fps,y
 iny
fdr4 inx
 jmp fdr1
fdr8 sty fpn
 rts

; after Cut (A = 0) or Paste (A = 1): the clipboard's hard line ends change the paragraph count
fclip sta fz6
 lda #<CLIP
 sta tp
 lda #>CLIP
 sta tp+1
 lda #0
 sta fz7
 lda ed_cl
 sta fz1
 lda ed_cl+1
 sta fz2
 ldy #0
fcl1 lda fz1
 ora fz2
 beq fcl3
 lda (tp),y
 cmp #13
 bne fcl2
 inc fz7
fcl2 inc tp
 bne fcl2a
 inc tp+1
fcl2a lda fz1
 bne fcl2b
 dec fz2
fcl2b dec fz1
 jmp fcl1
fcl3 lda fz7
 beq fcl9
 ldx cl
 jsr fpara
 ldx fz6
 beq fcl4
 sec
 sbc fz7
 bcs fcl4
 lda #0
fcl4 sta fz4
 lda fz6
 bne fcl5
 jmp fdrp
fcl5 jmp fgrow
fcl9 rts

; backspace at the start of a line: when the line above ended with a hard end, two paragraphs join
fjoin ldx cl
 lda LPL,x
 sec
 sbc #1
 sta tp
 lda LPH,x
 sbc #0
 sta tp+1
 ldy #0
 lda (tp),y
 cmp #13
 bne fjx
 ldx cl
 jsr fpara
 sec
 sbc #1
 sta fz4
 lda #1
 sta fz7
 jmp fdrp
fjx rts

; ---------------------------------------------------------------- names
; name from FNB (after the device prefix) into SCB: upper case, up to 12 characters, ends at '.' or end of name
fcanfn ldx #0
fcf1 lda FNB,x
 cmp #':'
 beq fcf2
 cmp #$9B
 beq fcf3
 inx
 bne fcf1
fcf3 ldx #$FF
fcf2 inx
 ldy #0
fcf4 lda FNB,x
 cmp #$9B
 beq fcf9
 cmp #'.'
 beq fcf9
 cmp #33
 bcc fcf9
 sta SCB,y
 inx
 iny
 cpy #12
 bcc fcf4
fcf9 lda #0
 sta SCB,y
 rts

; SCB name -> A = slot (0 = ROM, 1..fns), $FF = not loaded
fslot lda SCB
 beq fsl0
 cmp #'R'
 bne fsl1
 lda SCB+1
 cmp #'O'
 bne fsl1
 lda SCB+2
 cmp #'M'
 bne fsl1
 lda SCB+3
 beq fsl0
fsl1 lda #0
 sta fz1
fsl2 lda fz1
 cmp fns
 bcs fslno
 asl
 asl
 asl
 asl
 tay
 ldx #0
fsl3 lda fnm,y
 cmp SCB,x
 bne fsl5
 cmp #0
 beq fslhit
 iny
 inx
 cpx #12
 bcc fsl3
fslhit lda fz1
 clc
 adc #1
 rts
fsl5 inc fz1
 bne fsl2
fslno lda #$FF
 rts
fsl0 lda #0
 rts

; SCB -> a new name slot with flag A; returns A = slot
fadd pha
 lda fns
 asl
 asl
 asl
 asl
 tay
 ldx #0
fad1 lda SCB,x
 sta fnm,y
 beq fad2
 iny
 inx
 cpx #12
 bcc fad1
 lda #0
 sta fnm,y
fad2 lda fns
 asl
 asl
 asl
 asl
 tay
 pla
 sta fnm+15,y
 inc fns
 lda fns
 rts

; ---------------------------------------------------------------- loading
; read the 1 KB charset named in FNB into bank 3 for slot fz6 (carry set = failed)
fload lda #4
 jsr fopen
 cpy #$80
 bcs flbad
 lda fz6
 asl
 asl
 clc
 adc #$3C
 sta fz2
 lda #0
 sta fz3
fl2 lda #0
 sta fln
 lda #1
 sta fln+1
 lda #7
 ldx #<LDB
 ldy #>LDB
 jsr fblk
 cpy #$80
 bcs flbad
 lda fz2
 jsr fb_put
 inc fz2
 inc fz3
 lda fz3
 cmp #4
 bne fl2
 jsr fclose
 clc
 rts
flbad jsr fclose
 sec
 rts

; fload, and when the name was on D1: try H: once
floadfb jsr fload
 bcc ffb9
 lda FNB
 cmp #'D'
 bne ffbf
 lda FNB+1
 cmp #'1'
 bne ffbf
 lda FNB+2
 cmp #':'
 bne ffbf
 ldx #2
ffb1 lda FNB+1,x
 sta FNB,x
 inx
 cmp #$9B
 bne ffb1
 lda #'H'
 sta FNB
 lda #':'
 sta FNB+1
 jmp fload
ffbf sec
ffb9 rts

fntext dta c'.FNT',b($9B)

; FNB = D1:<SCB name>.FNT
fbuild ldx #0
fb1 lda fbdev,x
 sta FNB,x
 inx
 cpx #3
 bne fb1
 ldy #0
fb2 lda SCB,y
 beq fb3
 sta FNB,x
 inx
 iny
 bne fb2
fb3 ldy #0
fb4 lda fntext,y
 sta FNB,x
 inx
 iny
 cpy #5
 bne fb4
 rts
fbdev dta c'D1:'

; the typed name has been turned into FNB by dofile (fop 9)
fnload jsr fcanfn
 jsr fslot
 cmp #$FF
 bne fnset
 lda fns
 cmp #4
 bcc fn1
 lda #43
 sta cmsg
 rts
fn1 clc
 adc #1
 sta fz6
 jsr floadfb
 bcc fn2
 lda #42
 sta cmsg
 rts
fn2 lda #0
 jsr fadd
fnset jsr fsetcur
 lda #41
 sta cmsg
 lda #2
 sta fl
 rts

; a name from the file trailer: remember it (loaded later, once the document file is closed); A = slot or 0
fremember
 jsr fslot
 cmp #$FF
 bne frm9
 lda fns
 cmp #4
 bcs frm0
 lda #1
 jmp fadd
frm0 lda #0
frm9 rts

; CPG1 record in CMDB: tag pwb, length pwc
ftag lda pwb
 cmp #2
 bne ft3
 lda #0
 sta fz4
 lda #<CMDB
 sta src
 lda #>CMDB
 sta src+1
 lda pwc
 jmp ft5
ft3 lda CMDB+1
 bne ftx
 lda CMDB
 sta fz4
 lda #<(CMDB+2)
 sta src
 lda #>(CMDB+2)
 sta src+1
 lda pwc
 sec
 sbc #2
ft5 beq ftx
 cmp #13
 bcc ft6
 lda #12
ft6 sta fz7
 ldy #0
ft7 lda (src),y
 cmp #'a'
 bcc ft8
 cmp #'{'
 bcs ft8
 sec
 sbc #$20
ft8 sta SCB,y
 iny
 cpy fz7
 bne ft7
 lda #0
 sta SCB,y
 jsr fremember
 jmp fset
ftx rts

; after the document file is closed: load the typefaces its trailer named
fpend lda #0
 sta fz8
fpe1 lda fz8
 cmp fns
 bcs fpe9
 asl
 asl
 asl
 asl
 tay
 lda fnm+15,y
 cmp #1
 bne fpe5
 ldx #0
fpe2 lda fnm,y
 sta SCB,x
 beq fpe3
 iny
 inx
 cpx #12
 bcc fpe2
fpe3 jsr fbuild
 lda fz8
 clc
 adc #1
 sta fz6
 jsr floadfb
 php
 lda fz8
 asl
 asl
 asl
 asl
 tay
 plp
 bcs fpe4
 lda #0
 sta fnm+15,y
 jmp fpe5
fpe4 lda #2
 sta fnm+15,y
 lda #42
 sta cmsg
 lda fz8
 clc
 adc #1
 jsr fnone
fpe5 inc fz8
 jmp fpe1
fpe9 lda #2
 sta fl
 rts

; paragraphs using slot A go back to the ROM face
fnone sta fz5
 ldx #0
fnn1 cpx fpn
 bcs fnn9
 lda fps,x
 cmp fz5
 bne fnn2
 lda #0
 sta fps,x
fnn2 inx
 bne fnn1
fnn9 rts

; after pwsave: tag 2 / tag 3 records for the change table (Y = CIO status)
fsave lda fpn
 bne fsv0a
 jmp fsv9
fsv0a lda #0
 sta fz1
fsv1 ldx fz1
 cpx fpn
 bcc fsv1a
 jmp fsv9
fsv1a lda fps,x
 bne fsv2
 ldy #0
fsv0 lda fromn,y
 sta SCB,y
 iny
 cpy #4
 bne fsv0
 beq fsv4
fsv2 sec
 sbc #1
 asl
 asl
 asl
 asl
 tax
 ldy #0
fsv3 lda fnm,x
 sta SCB,y
 beq fsv4
 inx
 iny
 cpy #12
 bcc fsv3
 lda #0
 sta SCB,y
fsv4 ldy #0
fsv4a lda SCB,y
 beq fsv5
 iny
 bne fsv4a
fsv5 sty fz2
 ldx fz1
 lda fpi,x
 bne fsv6
 lda #2
 sta CMDB
 lda fz2
 sta CMDB+1
 ldx #2
 bne fsv7
fsv6 pha
 lda #3
 sta CMDB
 lda fz2
 clc
 adc #2
 sta CMDB+1
 pla
 sta CMDB+2
 lda #0
 sta CMDB+3
 ldx #4
fsv7 ldy #0
fsv8 cpy fz2
 bcs fsv8e
 lda SCB,y
 sta CMDB,x
 inx
 iny
 bne fsv8
fsv8e stx fln
 lda #0
 sta fln+1
 lda #11
 ldx #<CMDB
 ldy #>CMDB
 jsr fblk
 cpy #$80
 bcs fsvr
 inc fz1
 jmp fsv1
fsv9 ldy #1
fsvr rts
fromn dta c'ROM',b(0)

; "[Craft] NAME NAME": the faces, current one in brackets (stops before the line is full)
ffaces lda #0
ffa1 sta fv3
 cmp fv1
 bne ffa2
 lda #'['
 jsr putc
ffa2 lda fv3
 jsr fname
 lda fv3
 cmp fv1
 bne ffa3
 lda #']'
 jsr putc
ffa3 lda #' '
 jsr putc
 lda bi
 cmp #22
 bcs ffa4
 lda fv3
 cmp fns
 bcs ffa4
 adc #1
 jmp ffa1
ffa4 rts

; cmsg 13: after a size or weight change
fmsg lda #<fm1
 ldx #>fm1
 jsr putstr
 jsr fdesc
 lda #<fm2
 ldx #>fm2
 jmp putstr
fm1 dta c'Font: ',b(0)
fm2 dta c' (current)',b(0)

; the font prompt continues "Font: " with the current font and the loaded faces
fpmt jsr fdesc
 lda #<fm3
 ldx #>fm3
 jsr putstr
 jsr ffaces
 lda #<fm4
 ldx #>fm4
 jmp putstr
fm3 dta c' ',b(0)
fm4 dta c'File: ',b(0)


