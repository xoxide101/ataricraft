; Text-mode cursor: an XOR block over the character cell at the cursor, blinking from RTCLOK.
; It is erased when a key arrives (before anything is redrawn) and measured and drawn again from the idle
; loop, so typing never redraws the line just to blink it. The position comes from a measure-only drawtext
; pass: drawtext skips every glyph (dfrom = $FF, cumeas = $FF) and cuhit records where the cursor byte lands.
cuon   = $05E0                 ; 0 / $20: the block is currently XORed onto the screen
cuval  = $05E1                 ; 1 = cux/cuh/cura describe the current cursor
cuok   = $05E2                 ; 1 = the cursor is on a visible line
cumeas = $05E3                 ; $FF while measuring
cubase = $05E4                 ; RTCLOK+2 at the last key (blink restarts "on")
cuptr  = $05E5                 ; 2 bytes: raw document address of the cursor
cux    = $05E7                 ; 2 bytes: pixel x
cuw    = $05E9
cuh    = $05EA
cura   = $05EB                 ; 2 bytes: address of the line's first scanline
cum0   = $05ED
cum1   = $05EE
cum2   = $05EF
cuby   = $05F0
rbsp   = $05F1                 ; 2 bytes: screen address of the line being redrawn through RB
rdfc   = $05F3                 ; 1 = next status/ruler draw clears its row first (explicit redraw)
qql    = $05F4
qqp    = $05F5
qqt    = $05F6
qqn    = $05F7
RB     = $BE60               ; one 8-scanline text line (320 bytes) drawn off screen, then copied in one go

 org $0526
; XOR the cursor block (cux, cuw wide, cuh scanlines) onto the line at cura
cutog lda cuw
 bne cut00
 lda #1
 sta cuw
cut00 ldx cuw
 lda #0
 sta cum0
 sta cum1
 sta cum2
cut0 sec
 ror cum0
 ror cum1
 ror cum2
 dex
 bne cut0
 lda cux
 and #7
 tax
 beq cut2
cut1 lsr cum0
 ror cum1
 ror cum2
 dex
 bne cut1
cut2 lda cux+1
 lsr
 lda cux
 ror
 lsr
 lsr
 sta cuby
 lda cura
 sta sp
 lda cura+1
 sta sp+1
 ldx cuh
cut3 ldy cuby
 lda cum0
 eor (sp),y
 sta (sp),y
 iny
 cpy #40
 bcs cut5
 lda cum1
 eor (sp),y
 sta (sp),y
 iny
 cpy #40
 bcs cut5
 lda cum2
 eor (sp),y
 sta (sp),y
cut5 lda sp
 clc
 adc #40
 sta sp
 bcc cut6
 inc sp+1
cut6 dex
 bne cut3
 rts

 org $92CA
; find where the cursor is drawn without drawing anything
cumeasure lda #1
 sta cuval
 lda #0
 sta cuok
 lda cl
 sec
 sbc top
 bcc cm9
 cmp vis
 bcs cm9
 sta rr
 ldx cl
 stx t0
 lda LPL,x
 sta tp
 clc
 adc cc
 sta cuptr
 lda LPH,x
 sta tp+1
 adc #0
 sta cuptr+1
 jsr rowptr
 lda rs
 sta cura
 lda rs+1
 sta cura+1
 ldx cl
 jsr lineh
 sta cuh
 lda #<315
 sta cux
 lda #>315
 sta cux+1
 lda #5
 sta cuw
 lda #$FF
 sta cumeas
 sta dfrom
 jsr drawtext
 lda #0
 sta cumeas
 sta dfrom
 lda #1
 sta cuok
cm9 rts

; called at the head of drawtext's byte loop
cuhit lda cumeas
 bpl cuh9
 lda tp
 cmp cuptr
 bne cuh9
 lda tp+1
 cmp cuptr+1
 bne cuh9
 lda pwi
 bne cuh2
 lda col
 cmp #64
 bcc cuh1
 lda #63
cuh1 sta cuw
 asl
 asl
 clc
 adc cuw
 sta cux
 lda #0
 adc #0
 sta cux+1
 lda #5
 sta cuw
 jmp cuh3
cuh2 lda gxl
 sta cux
 lda gxh
 sta cux+1
 lda pit
 sta cuw
cuh3 lda cux+1
 beq cuh9
 lda cux
 cmp #$3B
 bcc cuh9
 lda #<315
 sta cux
 lda #5
 sta cuw
cuh9 ldy #0
 rts

; idle loop: draw or blink the cursor when the editor is showing the document
cuidle lda hmode
 ora mn
 ora cmdon
 ora sv_on
 ora pkon
 ora ed_rp
 bne cui9
 lda cuval
 bne cui5
 jsr cumeasure
cui5 lda cuok
 beq cui9
 lda RTCLOK+2
 sec
 sbc cubase
 and #$20
 eor #$20
 cmp cuon
 beq cui9
 sta cuon
 jmp cutog
cui9 rts

; a key arrived: take the block off before the screen changes and restart the blink
cuoff lda cuon
 beq cuo1
 jsr cutog
 lda #0
 sta cuon
cuo1 sta cuval
 lda RTCLOK+2
 sta cubase
 rts

cuinit lda #0
 sta cuon
 sta cuval
 sta cuok
 sta cumeas
 rts

 org $05AA
; explicit redraw (Ctrl-T): full text redraw, and the ruler/status rows are cleared before redrawing
hforce lda #2
 sta fl
 lda #1
 sta bd
 sta rdfc
 rts
; pad the status text in BUF with spaces up to column A
stpad sta qqp
stp1 lda bi
 cmp qqp
 bcs stp2
 lda #' '
 jsr putc
 jmp stp1
stp2 rts
plpp dta b(54),b(58),b(72)
spg dta c'Pg ',b(0)
sln dta c' L',b(0)
 org $06C0
; Redraw the cursor line through the row buffer (qrw below) so it is never seen cleared; a line that is
; not 8 scanlines high takes the plain clear-and-draw path.
redrawcur lda cl
 sec
 sbc top
 sta rr
 lda cl
 sta t0
 cmp nl
 bcs rdo
 lda anyv
 beq rd1
 ldx cl
 jsr lineh
 cmp #8
 bne rdo
rd1 ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 lda #2
 jmp qrw
rdo jmp drawdoc

 org $0489
; page and line on the page from the current paper's lines per page
stcalc ldx pwpap
 lda plpp,x
 sta qql
 lda cl
 ldx #1
stf3 cmp qql
 bcc stf4
 sbc qql
 inx
 bne stf3
stf4 sta qqn
 stx qqp
 lda nl
 sbc #0
 ldx #1
stf5 cmp qql
 bcc stf6
 sbc qql
 inx
 bne stf5
stf6 stx qqt
 rts

; finish the status text in BUF: keep the left part within 39 columns, then "Pg n/m Lnn" then CAPS at column 49
stfin jsr capsset
stf1 lda qqt
 jsr stpad
 jsr stcalc
 lda #<spg
 ldx #>spg
 jsr putstr
 lda qqp
 jsr putnum
 lda #'/'
 jsr putc
 lda qqt
 jsr putnum
 lda #<sln
 ldx #>sln
 jsr putstr
 lda qqn
 clc
 adc #1
 jsr putnum
 jmp capsput
; in-place row draw without a visible blank: render the row (ruler or status, rule line included) into RB, then copy it over
 .if * > $0500
 .error "status finish code overruns page 5 variables"
 .endif
 org $1F55
qrowr lda #0
 beq qrw
qrows lda #1
qrw sta qqt
 jsr rowptr
 lda rs
 sta rbsp
 lda rs+1
 sta rbsp+1
 lda #0
 tax
qr1 sta RB,x
 inx
 bne qr1
 ldx #63
qr2 sta RB+256,x
 dex
 bpl qr2
 lda #<RB
 sta rs
 sta sp
 lda #>RB
 sta rs+1
 sta sp+1
 jsr drawtext
 lda #$FF
 ldx qqt
 cpx #2
 beq qr6
 cpx #1
 beq qr3
 ldx #24
qr4 sta RB+256,x
 inx
 cpx #64
 bne qr4
 beq qr6
qr3 ldx #39
qr5 sta RB,x
 dex
 bpl qr5
qr6 lda rbsp
 sta dst
 lda rbsp+1
 sta dst+1
 ldy #0
qr7 lda RB,y
 sta (dst),y
 iny
 bne qr7
 inc dst+1
qr8 lda RB+256,y
 sta (dst),y
 iny
 cpy #64
 bne qr8
 rts
; ruler / status row: the plain clear-and-draw path when inverse video or an explicit redraw asks for it, else in place
rdgo lda iv
 ora rdfc
 beq rdq
 jsr rowsetup
 jsr drawtext
 jmp hlr
rdq jmp qrowr
stgo lda iv
 ora rdfc
 beq stqq
 jsr rowsetup
 jsr drawtext
 lda #0
 sta rdfc
 jmp hls
stqq jmp qrows
