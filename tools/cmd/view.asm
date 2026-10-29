; view.asm - VIEW.COM, a plain text viewer with scroll up / down for any Atari DOS.
; VIEW FILE.TXT from CMD, or run it from the DOS menu and type the name at the prompt.
; The file is read into $6000-$BBFF (about 27K, longer files are cut) and split into 40 column lines.
; Keys: Ctrl+Up / W / -  line up     Ctrl+Down / S / =  line down     SPACE  page down     B  page up
;       T  top     E  end     ESC or Q  quit.  Bottom row shows line number / number of lines.
        icl 'lib\sys.asm'

IDX     = $5000         ; line start table, 2 bytes per line, 2048 lines
BUF     = $6000
BUFEND  = $BC00
SAVMSC  = $58
ROWS    = 23

p       = $80
q       = $82
top     = $84
nl      = $86
fin     = $88
sp      = $8A
mx      = $8C
t       = $8E
cnt     = $90
src     = $92
cvt     = $94
cvu     = $95

        org CODE
start   lda #1
        sta CRSINH
        lda HAND
        cmp #$A5
        bne ask
        ldy #0
h1      lda HAND+1,y
        cmp #' '
        bne h2
        iny
        bne h1
h2      ldx #0
h3      lda HAND+1,y
        cmp #EOL
        beq h4
        cmp #' '
        beq h4
        sta fn,x
        inx
        iny
        cpx #58
        bcc h3
h4      lda #EOL
        sta fn,x
        lda #0
        sta HAND
        jmp named

ask     jsr putsi
        .byte 'VIEW FILE? ',0
        lda #<fn
        sta ICBAL
        lda #>fn
        sta ICBAH
        lda #5
        sta ICCOM
        lda #58
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV

named   lda fn
        cmp #EOL
        bne vv1
        jmp bye
vv1      cmp #' '
        bne vv2
        jmp bye
vv2      ldx #0
vv3      lda fn,x
        cmp #':'
        beq opened0
        cmp #EOL
        beq nodev
        cmp #' '
        beq nodev
        inx
        bne vv3
nodev   ldx #0
nd1     lda fn,x
        cmp #EOL
        beq nd2
        cmp #' '
        beq nd2
        inx
        bne nd1
nd2     lda #EOL
        sta fn+2,x
nd3     lda fn-1,x
        sta fn+1,x
        dex
        bpl nd3
        lda #'D'
        sta fn
        lda #':'
        sta fn+1
opened0 ldx #$10
        lda #3
        sta ICCOM,x
        lda #<fn
        sta ICBAL,x
        lda #>fn
        sta ICBAH,x
        lda #4
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV
        bpl rd
        jmp fail
rd      ldx #$10
        lda #7
        sta ICCOM,x
        lda #<BUF
        sta ICBAL,x
        lda #>BUF
        sta ICBAH,x
        lda #<(BUFEND-BUF)
        sta ICBLL,x
        lda #>(BUFEND-BUF)
        sta ICBLH,x
        jsr CIOV
        cpy #136
        beq rd1
        tya
        bpl rd1
        jmp fail
rd1     ldx #$10
        lda ICBLL,x
        clc
        adc #<BUF
        sta fin
        lda ICBLH,x
        adc #>BUF
        sta fin+1
        lda #12
        sta ICCOM,x
        jsr CIOV

; open the keyboard on IOCB 7
        ldx #$70
        lda #12
        sta ICCOM,x
        jsr CIOV
        ldx #$70
        lda #3
        sta ICCOM,x
        lda #<kspec
        sta ICBAL,x
        lda #>kspec
        sta ICBAH,x
        lda #4
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        sta ICBLL,x
        sta ICBLH,x
        jsr CIOV

; build the line table
        lda #<BUF
        sta p
        lda #>BUF
        sta p+1
        lda #<IDX
        sta q
        lda #>IDX
        sta q+1
        lda #0
        sta nl
        sta nl+1
nextl   lda p+1
        cmp fin+1
        bcc ml
        bne bdone
        lda p
        cmp fin
        bcs bdone
ml      lda q+1
        cmp #>(IDX+4096)
        bcs bdone
        ldy #0
        lda p
        sta (q),y
        iny
        lda p+1
        sta (q),y
        lda q
        clc
        adc #2
        sta q
        bcc nl1
        inc q+1
nl1     inc nl
        bne nl2
        inc nl+1
nl2     ldx #0
scan    lda p+1
        cmp fin+1
        bcc sc1
        bne nextl
        lda p
        cmp fin
        bcs nextl
sc1     ldy #0
        lda (p),y
        inc p
        bne sc2
        inc p+1
sc2     cmp #EOL
        beq nextl
        inx
        cpx #40
        bcc scan
; a full 40 column line: swallow an EOL that follows right away
        lda p+1
        cmp fin+1
        bcc sw1
        bne nextl
        lda p
        cmp fin
        bcs nextl
sw1     ldy #0
        lda (p),y
        cmp #EOL
        bne nextl
        inc p
        bne nextl
        inc p+1
        jmp nextl
bdone   lda #0
        sta top
        sta top+1
; mx = max(nl - ROWS, 0)
        lda nl
        sec
        sbc #ROWS
        sta mx
        lda nl+1
        sbc #0
        sta mx+1
        bcs loop
        lda #0
        sta mx
        sta mx+1

loop    jsr draw
        jsr getkey
        cmp #27
        beq quit
        cmp #'Q'
        beq quit
        cmp #28
        beq up
        cmp #'W'
        beq up
        cmp #'-'
        beq up
        cmp #29
        beq down
        cmp #'S'
        beq down
        cmp #'='
        beq down
        cmp #' '
        beq pgdn
        cmp #'B'
        beq pgup
        cmp #'T'
        beq gotop
        cmp #'E'
        beq goend
        jmp loop
quit    lda #125
        jsr putc
        jmp bye
up      lda top
        ora top+1
        beq loop
        lda top
        bne up1
        dec top+1
up1     dec top
        jmp loop
down    jsr atend
        bcs loop
        inc top
        bne dn1
        inc top+1
dn1     jmp loop
pgdn    lda top
        clc
        adc #ROWS-1
        sta top
        bcc pd1
        inc top+1
pd1     jsr clamp
        jmp loop
pgup    lda top
        sec
        sbc #ROWS-1
        sta top
        lda top+1
        sbc #0
        sta top+1
        bcs pu1
        lda #0
        sta top
        sta top+1
pu1     jmp loop
gotop   lda #0
        sta top
        sta top+1
        jmp loop
goend   lda mx
        sta top
        lda mx+1
        sta top+1
        jmp loop

; carry set when top >= mx
atend   lda top
        cmp mx
        lda top+1
        sbc mx+1
        rts
clamp   jsr atend
        bcc cl1
        lda mx
        sta top
        lda mx+1
        sta top+1
cl1     rts

; ---- screen ----
draw    lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        lda #0
        sta ATRACT
; clear 24 rows
        ldx #4
        ldy #0
        lda #0
dc1     sta (sp),y
        iny
        bne dc1
        inc sp+1
        dex
        bne dc1
        lda SAVMSC
        sta sp
        lda SAVMSC+1
        sta sp+1
        lda #0
        sta cnt
dr1     lda cnt
        clc
        adc top
        sta t
        lda #0
        adc top+1
        sta t+1
        lda t
        cmp nl
        lda t+1
        sbc nl+1
        bcs drend
; src = IDX[t]
        lda t
        asl
        sta q
        lda t+1
        rol
        adc #>IDX
        sta q+1
        lda q
        clc
        adc #<IDX
        sta q
        bcc dr2
        inc q+1
dr2     ldy #0
        lda (q),y
        sta src
        iny
        lda (q),y
        sta src+1
        ldx #0
dr3     cpx #40
        bcs dr5
        lda src+1
        cmp fin+1
        bcc dr4
        bne dr5
        lda src
        cmp fin
        bcs dr5
dr4     ldy #0
        lda (src),y
        cmp #EOL
        beq dr5
        jsr conv
        pha
        txa
        tay
        pla
        sta (sp),y
        inc src
        bne dr3x
        inc src+1
dr3x    inx
        jmp dr3
dr5     lda sp
        clc
        adc #40
        sta sp
        bcc dr6
        inc sp+1
dr6     inc cnt
        lda cnt
        cmp #ROWS
        bcc dr1
drend   jsr status
        rts

; screen code for the ATASCII byte in A (result in A)
conv    sta cvt
        and #$7F
        cmp #32
        bcc cv1
        cmp #96
        bcs cv2
        sec
        sbc #32
        bcs cv2
cv1     adc #64
cv2     sta cvu
        lda cvt
        and #$80
        ora cvu
        rts

; bottom row: "nnnn/nnnn  W/S line  SPACE/B page  ESC", inverse video
status  lda SAVMSC
        clc
        adc #<(23*40)
        sta sp
        lda SAVMSC+1
        adc #>(23*40)
        sta sp+1
        ldy #39
        lda #$80
st0     sta (sp),y
        dey
        bpl st0
        lda top
        clc
        adc #1
        sta t
        lda top+1
        adc #0
        sta t+1
        lda nl
        ora nl+1
        bne st1
        lda #0
        sta t
        sta t+1
st1     ldy #0
        jsr num
        lda #'/'
        jsr stc
        lda nl
        sta t
        lda nl+1
        sta t+1
        jsr num
        ldx #0
st2     lda stxt,x
        beq st3
        jsr stc
        inx
        bne st2
st3     rts

stc     jsr conv
        ora #$80
        sta (sp),y
        iny
        rts

; 4 digits of t at column Y, leading zeros as spaces
num     ldx #0
        lda #0
        sta cnt
nm1     lda #0
        sta cnt+1
nm2     lda t
        sec
        sbc dl,x
        pha
        lda t+1
        sbc dh,x
        bcc nm3
        sta t+1
        pla
        sta t
        inc cnt+1
        jmp nm2
nm3     pla
        lda cnt+1
        ora cnt
        bne nm4
        cpx #3
        bne nm5
nm4     lda #1
        sta cnt
        lda cnt+1
        ora #'0'
        jmp nm6
nm5     lda #' '
nm6     jsr stc
        inx
        cpx #4
        bcc nm1
        rts
dl      .byte <1000,<100,<10,<1
dh      .byte >1000,>100,>10,>1

; ---- console / keyboard ----
putc    ldx #0
        stx ICBLL
        stx ICBLH
        ldx #11
        stx ICCOM
        ldx #0
        jmp CIOV

putsi   pla
        sta T0
        pla
        sta T0+1
        ldy #0
ps1     inc T0
        bne ps2
        inc T0+1
ps2     lda (T0),y
        beq ps3
        jsr putc
        ldy #0
        jmp ps1
ps3     lda T0+1
        pha
        lda T0
        pha
        rts

getkey  ldx #$70
        lda #7
        sta ICCOM,x
        lda #0
        sta ICBLL,x
        sta ICBLH,x
        sta ATRACT
        jsr CIOV
        cmp #'a'
        bcc gk1
        cmp #'z'+1
        bcs gk1
        and #$DF
gk1     rts

fail    jsr putsi
        .byte 'CAN',39,'T OPEN OR READ THE FILE',EOL,0
bye     ldx #$10
        lda #12
        sta ICCOM,x
        jsr CIOV
        jmp (DOSVEC)

HAND    = $0480
kspec   .byte 'K:',EOL
stxt    .byte '  W/S line  SPACE/B page  ESC',0
fn      .ds 64
        run start
