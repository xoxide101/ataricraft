; Plain text / ATASCII import: reads the file named in FNB one byte at a time through CIO and
; writes a Craft stream at DOC (rules follow fromAtascii in tools/craftimport.cjs: line ends
; $9B/$0D/$0A, wrap at 64 columns with soft break 14, hard end 13, inverse -> underline 3,
; $03 at line start -> centre marker 15 / right 16, control bytes dropped).
ILIM = $90
doimport
 lda #<DOC
 sta dend
 lda #>DOC
 sta dend+1
 lda #0
 ldx #$0F
im0 sta icol,x
 dex
 bpl im0
 sta ihad
 sta ilsa+1
 sta ilcnt
 sta ipcr
 lda #1
 sta ilead
 lda #4
 jsr fopen
 cpy #$80
 bcc imlp
 jmp fer1
imlp jsr iget
 bcs imeof
 sta ibyte
 jsr iproc
 bcc imlp
 lda #1
 sta ihad
imeof lda icol
 ora iinv
 ora icen
 beq im2
 jsr ieol
im2 jsr fclose
 lda dend
 ora dend+1
 lda dend
 cmp #<DOC
 bne im3
 lda dend+1
 cmp #>DOC
 bne im3
 lda #13
 jsr iput
im3 lda #0
 tay
 sta (dend),y
 lda dend
 sec
 sbc #<DOC
 sta isz
 lda dend+1
 sbc #>DOC
 sta isz+1
 lda #0
 sta fnl
 lda #11
 ldx ihad
 beq im4
 lda #12
im4 sta cmsg
 lda hmode
 beq im5
 lda #0
 sta svcl
 sta svcc
 sta svtop
 sta svanyv
 rts
im5 lda #0
 sta cl
 sta cc
 sta top
 sta anyv
 jsr scan
 lda #2
 sta fl
 rts

; carry set at end of file, otherwise A = byte; other errors end the import via fer1
iget
 lda #7
 sta ICCOM+$30
 lda #0
 sta ICBAL+$30
 sta ICBAH+$30
 sta ICBLL+$30
 sta ICBLH+$30
 ldx #$30
 jsr CIOV
 cpy #$88
 beq ige
 cpy #$80
 bcs igerr
 clc
 rts
ige sec
 rts
igerr pla
 pla
 jmp fer1

; handle one input byte, carry set = stop (page full)
iproc
 cmp #$9B
 beq ile
 cmp #$0D
 beq ile
 cmp #$0A
 bne iq1
 ldx ipcr
 bne iqcl
 beq ile
ile ldx #0
 cmp #$0D
 bne ile1
 inx
ile1 stx ipcr
 jmp ieol
iqcl lda #0
 sta ipcr
 clc
 rts
iq1 ldx #0
 stx ipcr
 ldx ifc
 beq iq2
 lda #0
 sta ifc
 clc
 rts
iq2 cmp #$1B
 bne iq3
 sta ifc
 clc
 rts
iq3 cmp #$7F
 beq iqx
 cmp #$7E
 beq iqx
 cmp #$FE
 beq iqx
 cmp #$FF
 beq iqx
 cmp #9
 bne iq4
 ldx #4
iqt lda #32
 stx itr
 jsr ichr0
 ldx itr
 dex
 bne iqt
 clc
 rts
iq4 cmp #3
 bne iq5
 ldx ilead
 beq iqx
 inc icen
 clc
 rts
iqx clc
 rts
iq5 cmp #32
 bcc iqx
 tax
 and #$7F
 cmp #127
 bcs iq6
 cmp #32
 bcs iq7
iq6 lda #'?'
iq7 sta ichr
 jsr ilst
 lda ibyte
 asl
 lda #0
 rol
 cmp iinv
 beq iq8
 sta iinv
 lda #3
 jsr iput
 bcs iqx2
iq8 lda ichr
 jmp ichr0
iqx2 rts

; write the centre / right marker once per line, before the first real byte
ilst
 lda ilead
 beq ils9
 lda #0
 sta ilead
 lda icen
 beq ils9
 lda #15
 ldx icen
 cpx #2
 bne ils1
 lda #16
ils1 jsr iput0
ils9 rts

ieol
 jsr ilst
 lda iinv
 beq ie1
 lda #0
 sta iinv
 lda #3
 jsr iput
ie1 lda #13
 jsr iput
 lda #0
 sta icol
 sta icen
 sta ilsa+1
 lda #1
 sta ilead
 inc ilcnt
 lda ilcnt
 cmp #250
 bcs iful
 clc
 rts
iful sec
 rts

; store A at dend; carry set when the page is full
iput
 ldy #0
 pha
 lda dend+1
 cmp #ILIM
 bcs ipf
 pla
 sta (dend),y
 inc16 dend
 clc
 rts
ipf pla
 sec
 rts
iput0 jmp iput

; add a printable byte to the line, wrapping at 64 columns
ichr0
 sta ichr
 ldx icol
 cpx #64
 bcc ic4
 lda ichr
 cmp #32
 bne ic1
 lda #14
 jsr iput
 bcs icr
 jmp ic3
ic1 lda ilsa+1
 beq ic2
 lda ilsa
 sta tp
 lda ilsa+1
 sta tp+1
 lda #14
 ldy #0
 sta (tp),y
 lda icol
 sec
 sbc ilsc
 sbc #1
 sta icol
 lda #0
 sta ilsa+1
 inc ilcnt
 jmp ic4
ic2 lda #14
 jsr iput
 bcs icr
ic3 lda #0
 sta icol
 sta ilsa+1
 inc ilcnt
 lda ichr
 cmp #32
 bne ic4
 clc
 rts
ic4 lda ichr
 cmp #32
 bne ic5
 lda dend
 sta ilsa
 lda dend+1
 sta ilsa+1
 lda icol
 sta ilsc
ic5 lda ichr
 jsr iput
 bcs icr
 inc icol
 lda ilcnt
 cmp #250
icr rts
