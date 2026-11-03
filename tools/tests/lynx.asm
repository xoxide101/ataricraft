; LYNX.COM - tiny text browser for the FujiNet N: device (N1:, $71).
; Type a URL; the page is fetched, tags are removed, text is word-wrapped to 37 columns and paged.
; Links appear as word[n]; at the prompt type a digit 1-9 to follow link n, a URL starting with "http", or Q to quit.
; Handles <p> <br> <li> <div> <tr> <h1-6> <ul> <ol> as line breaks, skips <script>/<style>, decodes &amp; &lt; &gt; &quot;.
; Needs FujiNet on and the relay (see docs/FUJINET.md). No PROCEED: polls status.
        org $2000
CIOV    = $E456
SIOV    = $E459
ICCOM   = $0342
ICBAL   = $0344
ICBAH   = $0345
ICBLL   = $0348
ICBLH   = $0349
CH      = $02FC
DDEVIC  = $0300
SPEC    = $3000
STAT    = $3100
BUF     = $3200
WORD    = $3300
TAGB    = $3400
LINKS   = $3500
BASE    = $3800
col     = $80
lines   = $81
wlen    = $82
intag   = $83
tagpos  = $84
skip    = $85
inent   = $86
entpos  = $87
entc    = $88
nlinks  = $89
inlink  = $8A
quit    = $8B
idx     = $8C
ch      = $8D
closing = $8E
ofs     = $8F
p       = $90
q       = $92
t0      = $94
t1      = $95
t2      = $96
pc      = $97
sx      = $98
sy      = $99
ln      = $9A
ci      = $9B
qc      = $9C
s3      = $9D
last    = $9E
plen    = $9F
ti      = $A0
skipc   = $A1

start   lda $0480
        cmp #$A5
        bne ask
        ldy #0
hc1     lda $0481,y
        cmp #' '
        bne hc2
        iny
        bne hc1
hc2     ldx #0
hc3     lda $0481,y
        sta SPEC+2,x
        iny
        inx
        cmp #$9B
        bne hc3
        lda #$5A
        sta $0480
        lda #'N'
        sta SPEC
        lda #':'
        sta SPEC+1
        jmp fetchit
ask     lda #<prompt
        ldy #>prompt
        jsr puts
        jsr getline
fetchit jsr fetch
again   lda #<p2
        ldy #>p2
        jsr puts
        jsr getline
        lda SPEC+2
        cmp #'q'
        beq exit
        cmp #'Q'
        beq exit
        cmp #'1'
        bcc isurl
        cmp #':'
        bcs isurl
        and #$0F
        sta idx
        jsr resolve
        bcs again
        jmp fetchit
isurl   cmp #'h'
        beq fetchit
        cmp #'H'
        beq fetchit
        jmp again
exit    rts

; read a line from the keyboard into SPEC+2 and add the N: prefix
getline lda #$05
        sta ICCOM
        lda #<(SPEC+2)
        sta ICBAL
        lda #>(SPEC+2)
        sta ICBAH
        lda #200
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV
        lda #'N'
        sta SPEC
        lda #':'
        sta SPEC+1
        rts

; fetch and display SPEC
fetch   ldy #0
cpb     lda SPEC,y
        sta BASE,y
        iny
        bne cpb
        lda #0
        sta col
        sta lines
        sta wlen
        sta intag
        sta skip
        sta inent
        sta nlinks
        sta inlink
        sta quit
        lda #$9B
        jsr putc
        lda #'O'
        sta cmd
        lda #$80
        sta stats
        lda #<SPEC
        sta bl
        lda #>SPEC
        sta bh
        lda #0
        sta ll
        lda #1
        sta lh
        lda #4
        sta al
        lda #2
        sta ah
        jsr sio
        cpy #1
        beq floop
        lda #<emsg
        ldy #>emsg
        jmp puts
floop   lda #'S'
        sta cmd
        lda #$40
        sta stats
        lda #<STAT
        sta bl
        lda #>STAT
        sta bh
        lda #4
        sta ll
        lda #0
        sta lh
        sta al
        sta ah
        jsr sio
        lda STAT
        ora STAT+1
        beq idle
        lda STAT+1
        beq lenok
        lda #255
        sta STAT
lenok   lda #'R'
        sta cmd
        lda #<BUF
        sta bl
        lda #>BUF
        sta bh
        lda STAT
        sta ll
        sta al
        sta ln
        lda #0
        sta lh
        sta ah
        sta ci
        jsr sio
pl      ldy ci
        lda BUF,y
        jsr process
        lda quit
        bne done
        inc ci
        lda ci
        cmp ln
        bne pl
        jmp floop
idle    lda STAT+2
        beq done
        jmp floop
done    jsr flush
        lda col
        beq noend
        jsr newline
noend   lda #'C'
        sta cmd
        lda #0
        sta stats
        sta ll
        sta lh
        sta al
        sta ah
        lda #<BUF
        sta bl
        lda #>BUF
        sta bh
        jmp sio

; process one input byte in A
process sta ch
        lda intag
        beq nottag
        lda ch
        cmp #'>'
        beq tagend
        ldy tagpos
        cpy #190
        bcs tagret
        lda ch
        sta TAGB,y
        inc tagpos
tagret  rts
tagend  ldy tagpos
        lda #0
        sta TAGB,y
        sta intag
        jmp dotag
nottag  lda ch
        cmp #'<'
        bne nt2
        lda #1
        sta intag
        lda #0
        sta tagpos
        rts
nt2     lda skip
        beq nt3
        rts
nt3     lda inent
        beq nt4
        jmp entchar
nt4     lda ch
        cmp #'&'
        bne textc
        lda #1
        sta inent
        lda #0
        sta entpos
        sta entc
        rts

; ordinary character in ch: collect into a word, whitespace flushes it
textc   lda ch
        cmp #$9B
        beq flush
        cmp #$21
        bcc flush
        cmp #$7F
        bcs tcret
        ldy wlen
        cpy #37
        bcc ap
        jsr flush
        ldy wlen
ap      lda ch
        sta WORD,y
        inc wlen
tcret   rts

flush   lda wlen
        beq fret
        lda col
        beq fnosp
        clc
        adc wlen
        adc #1
        cmp #38
        bcs fwrap
        lda #' '
        jsr putc
        inc col
        jmp fnosp
fwrap   jsr newline
fnosp   ldy #0
fp      lda WORD,y
        jsr putc
        iny
        cpy wlen
        bne fp
        lda col
        clc
        adc wlen
        sta col
        lda #0
        sta wlen
fret    rts

newline lda #$9B
        jsr putc
        lda #0
        sta col
        inc lines
        lda lines
        cmp #21
        bcc nlret
        lda #0
        sta lines
        lda #<mmsg
        ldy #>mmsg
        jsr puts
        lda #$FF
        sta CH
mwait   lda CH
        cmp #$FF
        beq mwait
        ldx #$FF
        stx CH
        cmp #$2F
        bne nlret
        lda #1
        sta quit
nlret   rts

; &entity; handling
entchar lda ch
        cmp #';'
        beq entend
        cmp #$21
        bcc entbad
        ldy entpos
        bne entmore
        sta entc
entmore inc entpos
        lda entpos
        cmp #9
        bcs entbad
        rts
entbad  lda #0
        sta inent
        lda #'&'
        sta ch
        jsr textc
        lda #' '
        sta ch
        jmp textc
entend  lda #0
        sta inent
        lda entc
        ldx #'&'
        cmp #'a'
        beq entput
        ldx #'<'
        cmp #'l'
        beq entput
        ldx #'>'
        cmp #'g'
        beq entput
        ldx #'"'
        cmp #'q'
        beq entput
        ldx #$27
        cmp #'#'
        beq entput
        ldx #' '
entput  stx ch
        jmp textc

; a complete tag is in TAGB (without < >)
dotag   lda #0
        sta closing
        sta ofs
        lda TAGB
        cmp #'/'
        bne dt1
        inc closing
        inc ofs
dt1     ldx ofs
        lda TAGB,x
        jsr lower
        sta t0
        lda TAGB+1,x
        jsr lower
        sta t1
        lda TAGB+2,x
        jsr lower
        sta t2
        lda skip
        beq dt3
        lda closing
        beq dtret
        lda t0
        cmp skipc
        bne dtret
        lda #0
        sta skip
dtret   rts
dt3     lda closing
        bne dtclose
        lda t0
        cmp #'s'
        bne dto1
        lda t1
        cmp #'c'
        beq sskip
        cmp #'t'
        bne dto1
        lda t2
        cmp #'y'
        bne dto1
sskip   lda #1
        sta skip
        lda #'s'
        sta skipc
        rts
dto1    lda t0
        cmp #'t'
        bne dto1a
        lda t1
        cmp #'i'
        bne dto1a
        lda #'t'
        sta skipc
        lda #1
        sta skip
        rts
dto1a   lda t0
        cmp #'a'
        bne dto2
        lda t1
        cmp #$21
        bcs dto2
        jmp doA
dto2    jmp isbreak
dtclose lda t0
        cmp #'a'
        bne dtc2
        lda t1
        cmp #$21
        bcs dtc2
        lda inlink
        beq dtret
        lda #0
        sta inlink
        lda #'['
        sta ch
        jsr textc
        lda nlinks
        clc
        adc #'0'
        sta ch
        jsr textc
        lda #']'
        sta ch
        jmp textc
dtc2    jmp isbreak

; line break for block-level tags
isbreak lda t0
        cmp #'p'
        bne b1
        lda t1
        cmp #'a'
        bcc brk
        rts
b1      cmp #'b'
        bne b2
        lda t1
        cmp #'r'
        beq brk
        rts
b2      cmp #'l'
        bne b3
        lda t1
        cmp #'i'
        beq brk
        rts
b3      cmp #'d'
        bne b4
        lda t1
        cmp #'i'
        beq brk
        rts
b4      cmp #'t'
        bne b5
        lda t1
        cmp #'r'
        beq brk
        rts
b5      cmp #'h'
        bne b6
        lda t1
        cmp #'1'
        bcc b9
        cmp #'7'
        bcc brk
b9      rts
b6      cmp #'u'
        beq b7
        cmp #'o'
        bne b9
b7      lda t1
        cmp #'l'
        bne b9
brk     jsr flush
        lda col
        beq b9
        jmp newline

lower   cmp #'A'
        bcc lw
        cmp #'['
        bcs lw
        ora #$20
lw      rts

; <a href="..."> : store the href in the next link slot
doA     lda nlinks
        cmp #9
        bcs noa
        ldy #0
hf      lda TAGB,y
        beq noa
        jsr lower
        cmp #'h'
        bne hn
        lda TAGB+1,y
        jsr lower
        cmp #'r'
        bne hn
        lda TAGB+2,y
        jsr lower
        cmp #'e'
        bne hn
        lda TAGB+3,y
        jsr lower
        cmp #'f'
        bne hn
        lda TAGB+4,y
        cmp #'='
        beq hfound
hn      iny
        cpy #180
        bcc hf
noa     rts
hfound  tya
        clc
        adc #5
        tay
        lda TAGB,y
        sta qc
        cmp #'"'
        beq qd
        cmp #$27
        bne nq
qd      iny
        jmp cp0
nq      lda #' '
        sta qc
cp0     lda nlinks
        jsr slot
        sty ti
        ldx #0
cpl     ldy ti
        lda TAGB,y
        beq cpe
        cmp qc
        beq cpe
        sta tmpc
        txa
        tay
        lda tmpc
        sta (p),y
        inx
        inc ti
        cpx #62
        bcc cpl
cpe     txa
        tay
        lda #0
        sta (p),y
        inc nlinks
        lda #1
        sta inlink
        rts

; p = LINKS + 64 * A
slot    sta tmpc
        lsr
        lsr
        clc
        adc #>LINKS
        sta p+1
        lda tmpc
        and #3
        asl
        asl
        asl
        asl
        asl
        asl
        sta p
        rts

; follow link idx (1-9): builds the new N: spec in SPEC; carry set if invalid
resolve lda idx
        beq rb0
        cmp nlinks
        beq rok
        bcc rok
rb0     sec
        rts
rok     sec
        sbc #1
        jsr slot
        ldy #0
        lda (p),y
        beq rb0
        cmp #'#'
        beq rb0
        ldy #0
        ldx #0
        lda (p),y
        jsr lower
        cmp #'h'
        bne rrel
        ldy #4
        lda (p),y
        cmp #':'
        bne ra5
        jmp rabs
ra5     ldy #5
        lda (p),y
        cmp #':'
        bne rrel
        jmp rabs
rrel    lda #$FF
        sta s3
        sta last
        ldy #0
        ldx #0
scan    lda BASE,y
        cmp #$9B
        beq scand
        cmp #'/'
        bne scnx
        sty last
        inx
        cpx #3
        bne scnx
        sty s3
scnx    iny
        bne scan
scand   sty plen
        ldy #0
        lda (p),y
        cmp #'/'
        bne rrel2
        lda s3
        cmp #$FF
        beq rcopy
        sta plen
        jmp rcopy
rrel2   lda s3
        cmp #$FF
        beq rslash
        lda last
        clc
        adc #1
        sta plen
        jmp rcopy
rslash  ldy plen
        lda #'/'
        sta BASE,y
        inc plen
rcopy   ldy #0
rc1     cpy plen
        beq rc2
        lda BASE,y
        sta SPEC,y
        iny
        bne rc1
rc2     sty ci
        ldx #0
rc3     txa
        tay
        lda (p),y
        beq rend
        ldy ci
        sta SPEC,y
        inc ci
        inx
        lda ci
        cmp #250
        bcc rc3
rend    ldy ci
        lda #$9B
        sta SPEC,y
        clc
        rts
rabs    lda #'N'
        sta SPEC
        lda #':'
        sta SPEC+1
        ldy #0
ra1     lda (p),y
        beq ra2
        sta SPEC+2,y
        iny
        cpy #200
        bcc ra1
ra2     lda #$9B
        sta SPEC+2,y
        clc
        rts
rb1     sec
        rts

; print one byte on the screen (E:), registers preserved
putc    sta pc
        stx sx
        sty sy
        lda #$0B
        sta ICCOM
        lda #0
        sta ICBLL
        sta ICBLH
        lda pc
        ldx #0
        jsr CIOV
        ldx sx
        ldy sy
        rts

; print the EOL-terminated string at A/Y
puts    sta ICBAL
        sty ICBAH
        lda #$09
        sta ICCOM
        lda #255
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jmp CIOV

; one SIO call to device $71 using the variables below; Y = status
sio     lda #$71
        sta DDEVIC
        lda #1
        sta DDEVIC+1
        lda cmd
        sta DDEVIC+2
        lda stats
        sta DDEVIC+3
        lda bl
        sta DDEVIC+4
        lda bh
        sta DDEVIC+5
        lda #$0F
        sta DDEVIC+6
        lda ll
        sta DDEVIC+8
        lda lh
        sta DDEVIC+9
        lda al
        sta DDEVIC+10
        lda ah
        sta DDEVIC+11
        jsr SIOV
        rts

cmd     .byte 0
stats   .byte 0
bl      .byte 0
bh      .byte 0
ll      .byte 0
lh      .byte 0
al      .byte 0
ah      .byte 0
tmpc    .byte 0
prompt  .byte 'LYNX - URL? ',$9B
p2      .byte 'Link 1-9, URL, or Q? ',$9B
emsg    .byte 'Open failed',$9B
mmsg    .byte '--more-- (Q quits)',$9B
