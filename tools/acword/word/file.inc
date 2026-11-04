; File Save / Open through CIO. Format: docs/CRAFT-FORMAT.md (16-byte header + text stream).
; Names default to D1: and ".CWD"; a name with a device prefix (H:NAME) is used as typed.
HDR  = $1400
fnl  = $1410
fop  = $1411
fer  = $1412
fpr  = $1413
fdt  = $1414
fln  = $1415
fcs   = $1417
FNB  = $1420

fask
 lda #1
 sta cmdon
 sta fpr
 sta bd
 lda #0
 sta clen
 sta cmsg
 sta mn
 rts

hsave
 lda fnl
 beq hsas
 jmp dosave
hsas
 lda #1
 sta fop
 jmp fask

hopen
 lda #2
 sta fop
 jmp fask

; the typed name is in CMDB[0..clen)
dofile
 lda #0
 sta fdt
 ldy #0
fz_df1 lda CMDB,y
 cmp #':'
 beq fz_df2
 iny
 cpy clen
 bcc fz_df1
 lda #'D'
 sta FNB
 lda #'1'
 sta FNB+1
 lda #':'
 sta FNB+2
 ldx #3
 bne fz_df3
fz_df2 ldx #0
fz_df3 ldy #0
fz_df4 lda CMDB,y
 cmp #'a'
 bcc fz_df5
 cmp #'{'
 bcs fz_df5
 sec
 sbc #$20
fz_df5 sta FNB,x
 cmp #'.'
 bne fz_df6
 sty fdt
 inc fdt
fz_df6 inx
 iny
 cpy clen
 beq fz_df7
 cpy #36
 bcc fz_df4
fz_df7 lda fdt
 bne fz_df8
 ldy #0
fz_df9 lda fext,y
 sta FNB,x
 inx
 iny
 cpy #4
 bne fz_df9
fz_df8 lda #$9B
 sta FNB,x
 stx fnl
 lda fop
 cmp #2
 beq doload

dosave
 jsr mkhdr
 lda #8
 jsr fopen
 cpy #$80
 bcs fer1
 lda #16
 sta fln
 lda #0
 sta fln+1
 lda #11
 ldx #<HDR
 ldy #>HDR
 jsr fblk
 cpy #$80
 bcs fer1
 lda dend
 sec
 sbc #<DOC
 sta fln
 lda dend+1
 sbc #>DOC
 sta fln+1
 ora fln
 beq fz_sv9
 lda #11
 ldx #<DOC
 ldy #>DOC
 jsr fblk
 cpy #$80
 bcs fer1
fz_sv9 jsr fclose
 lda #6
 sta cmsg
 rts

fer1 sty fer
 jsr fclose
 lda #8
 sta cmsg
 rts

fbad jsr fclose
 lda #9
 sta cmsg
 rts

fbig jsr fclose
 lda #10
 sta cmsg
 rts

doload
 lda #4
 jsr fopen
 cpy #$80
 bcs fer1
 lda #16
 sta fln
 lda #0
 sta fln+1
 lda #7
 ldx #<HDR
 ldy #>HDR
 jsr fblk
 cpy #$80
 bcs fer1
 ldx #3
fz_dl1 lda HDR,x
 cmp hmag,x
 bne fbj
 dex
 bpl fz_dl1
 lda HDR+5
 cmp #'W'
 bne fbj
 lda HDR+9
 cmp #$40
 bcs fbig
 sta fln+1
 lda HDR+8
 sta fln
 ora fln+1
 beq fz_dl2
 lda #7
 ldx #<DOC
 ldy #>DOC
 jsr fblk
 cpy #$80
 bcs fer1
fz_dl2 lda #<DOC
 clc
 adc fln
 sta dend
 lda #>DOC
 adc fln+1
 sta dend+1
 ldy #0
 tya
 sta (dend),y
 jsr fcsum
 lda fcs
 cmp HDR+14
 bne fbj
 lda fcs+1
 cmp HDR+15
 bne fbj
 jsr fclose
 lda #0
 sta cl
 sta cc
 sta top
 sta anyv
 jsr scan
 lda #2
 sta fl
 lda #7
 sta cmsg
 rts

fbj jmp fbad

mkhdr
 ldx #15
 lda #0
fz_mh1 sta HDR,x
 dex
 bpl fz_mh1
 ldx #3
fz_mh2 lda hmag,x
 sta HDR,x
 dex
 bpl fz_mh2
 lda #1
 sta HDR+4
 lda #'W'
 sta HDR+5
 lda dend
 sec
 sbc #<DOC
 sta HDR+8
 lda dend+1
 sbc #>DOC
 sta HDR+9
 lda nl
 sta HDR+10
 lda #64
 sta HDR+12
 lda #ROWS
 sta HDR+13
 jsr fcsum
 lda fcs
 sta HDR+14
 lda fcs+1
 sta HDR+15
 rts

; 16-bit sum of the bytes DOC..dend-1
fcsum
 lda #0
 sta fcs
 sta fcs+1
 lda #<DOC
 sta tp
 lda #>DOC
 sta tp+1
fz_cs1 lda tp
 cmp dend
 bne fz_cs2
 lda tp+1
 cmp dend+1
 beq fz_cs9
fz_cs2 ldy #0
 lda (tp),y
 clc
 adc fcs
 sta fcs
 bcc fz_cs3
 inc fcs+1
fz_cs3 inc16 tp
 jmp fz_cs1
fz_cs9 rts

fopen
 pha
 ldx #$30
 lda #3
 sta ICCOM,x
 lda #<FNB
 sta ICBAL,x
 lda #>FNB
 sta ICBAH,x
 pla
 sta ICAX1,x
 lda #0
 sta ICAX2,x
 jmp CIOV

; A = CIO command, X/Y = buffer address, fln = length
fblk
 sta ICCOM+$30
 stx ICBAL+$30
 sty ICBAH+$30
 lda fln
 sta ICBLL+$30
 lda fln+1
 sta ICBLH+$30
 ldx #$30
 jmp CIOV

fclose
 ldx #$30
 lda #12
 sta ICCOM,x
 jmp CIOV

hmag dta c'CRFT'
fext dta c'.CWD'
