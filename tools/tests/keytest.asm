; KEYTEST.COM - live keyboard, console keys, joysticks, triggers and paddles. ESC exits.
        org $2000
        icl 'common.inc'

start   lda #$7D
        jsr eput
        lda #1
        sta CRSINH
        lda #$FF
        sta CH
        ldx #0
        ldy #0
        jsr locate
        lda #<s_title
        ldy #>s_title
        jsr puts
        ldx #0
        ldy #20
        jsr locate
        lda #<s_help
        ldy #>s_help
        jsr puts
        ldx #7
        lda #$20
hclr    sta hist,x
        dex
        bpl hclr

loop    lda #0
        sta ATRACT
        jsr vsync
        sta POTGO

        ; hardware keyboard state
        ldx #0
        ldy #2
        jsr locate
        lda #<s_kb
        ldy #>s_kb
        jsr puts
        lda KBCODE
        jsr puthex
        lda #<s_sk
        ldy #>s_sk
        jsr puts
        lda SKSTAT
        jsr puthex

        ldx #0
        ldy #3
        jsr locate
        lda #<s_down
        ldy #>s_down
        jsr puts
        lda SKSTAT
        and #4
        jsr pyn
        lda #<s_shift
        ldy #>s_shift
        jsr puts
        lda SKSTAT
        and #8
        jsr pyn
        lda #<s_ctrl
        ldy #>s_ctrl
        jsr puts
        lda SKSTAT
        and #4
        bne noctl
        lda KBCODE
        and #$80
        eor #$80
noctl   jsr pyn

        ; OS key buffer
        lda CH
        cmp #$FF
        beq nokey
        cmp #$1C
        bne notesc
        jmp quit
notesc  sta lastch
        ldx #6
hs      lda hist,x
        sta hist+1,x
        dex
        bpl hs
        lda lastch
        sta hist
        lda #$FF
        sta CH
nokey   ldx #0
        ldy #4
        jsr locate
        lda #<s_last
        ldy #>s_last
        jsr puts
        lda lastch
        jsr puthex
        lda #<s_chr
        ldy #>s_chr
        jsr puts
        lda lastch
        cmp #$FF
        beq nochr
        tay
        lda (KEYDEF),y
        cmp #$20
        bcc dot
        cmp #$7F
        bcc chok
dot     lda #'.'
chok    jsr putc
nochr   ldx #0
        ldy #5
        jsr locate
        lda #<s_hist
        ldy #>s_hist
        jsr puts
        ldx #0
hp      lda hist,x
        stx t4
        jsr puthex
        lda #' '
        jsr putc
        ldx t4
        inx
        cpx #7
        bne hp

        ; console keys
        ldx #0
        ldy #7
        jsr locate
        lda #<s_cons
        ldy #>s_cons
        jsr puts
        lda CONSOL
        and #1
        jsr pdn
        lda #<s_sel
        ldy #>s_sel
        jsr puts
        lda CONSOL
        and #2
        jsr pdn
        lda #<s_opt
        ldy #>s_opt
        jsr puts
        lda CONSOL
        and #4
        jsr pdn
        ldx #0
        ldy #8
        jsr locate
        lda #<s_brk
        ldy #>s_brk
        jsr puts
        lda IRQST
        and #$80
        jsr pdn

        ; joysticks: PORTA low nibble = port 1, high nibble = port 2
        ldx #0
        ldy #10
        jsr locate
        lda #<s_j1
        ldy #>s_j1
        jsr puts
        lda PORTA
        sta t1
        lda TRIG0
        sta t2
        jsr joy
        ldx #0
        ldy #11
        jsr locate
        lda #<s_j2
        ldy #>s_j2
        jsr puts
        lda PORTA
        lsr
        lsr
        lsr
        lsr
        sta t1
        lda TRIG0+1
        sta t2
        jsr joy
        ldx #0
        ldy #12
        jsr locate
        lda #<s_j3
        ldy #>s_j3
        jsr puts
        lda PORTB
        sta t1
        lda TRIG0+2
        sta t2
        jsr joy

        ; paddles
        ldx #0
        ldy #14
        jsr locate
        lda #<s_pad
        ldy #>s_pad
        jsr puts
        ldx #0
pl1     lda POT0,x
        stx t4
        jsr puthex
        lda #' '
        jsr putc
        ldx t4
        inx
        cpx #4
        bne pl1
        ldx #0
        ldy #15
        jsr locate
        lda #<s_pad2
        ldy #>s_pad2
        jsr puts
        ldx #4
pl2     lda POT0,x
        stx t4
        jsr puthex
        lda #' '
        jsr putc
        ldx t4
        inx
        cpx #8
        bne pl2
        jmp loop

quit    lda #0
        sta CRSINH
        lda #$FF
        sta CH
        lda #$7D
        jmp eput

; t1 low nibble = U D L R (0 = pressed), t2 = trigger (0 = pressed)
joy     lda #'U'
        ldx #1
        jsr jb
        lda #'D'
        ldx #2
        jsr jb
        lda #'L'
        ldx #4
        jsr jb
        lda #'R'
        ldx #8
        jsr jb
        lda #' '
        jsr putc
        lda #'F'
        ldx t2
        beq jf
        lda #'-'
jf      jmp putc
jb      stx t3
        pha
        lda t1
        and t3
        beq jp
        pla
        lda #'-'
        jmp putc
jp      pla
        jmp putc

; A = 0 -> "YES" else "no " (bit set means active)
pyn     beq pn1
        lda #<s_no
        ldy #>s_no
        jmp puts
pn1     lda #<s_yes
        ldy #>s_yes
        jmp puts
; A = 0 -> "DOWN" (active low) else "up  "
pdn     beq pd_1
        lda #<s_up
        ldy #>s_up
        jmp puts
pd_1    lda #<s_dn
        ldy #>s_dn
        jmp puts

lastch  .byte $FF
hist    .byte 0,0,0,0,0,0,0,0
s_title .byte 'KEYTEST  keyboard / console / joysticks / paddles',0
s_kb    .byte 'KBCODE $',0
s_sk    .byte '  SKSTAT $',0
s_down  .byte 'KEY DOWN: ',0
s_shift .byte ' SHIFT: ',0
s_ctrl  .byte ' CTRL: ',0
s_last  .byte 'LAST CH $',0
s_chr   .byte '  CHAR: ',0
s_hist  .byte 'HISTORY: ',0
s_cons  .byte 'START: ',0
s_sel   .byte ' SELECT: ',0
s_opt   .byte ' OPTION: ',0
s_brk   .byte 'BREAK: ',0
s_j1    .byte 'JOY1 UDLR FIRE: ',0
s_j2    .byte 'JOY2 UDLR FIRE: ',0
s_j3    .byte 'JOY3 UDLR FIRE (400/800 only): ',0
s_pad   .byte 'PADDLE 0-3: ',0
s_pad2  .byte 'PADDLE 4-7: ',0
s_yes   .byte 'YES',0
s_no    .byte 'no ',0
s_dn    .byte 'DOWN',0
s_up    .byte 'up  ',0
s_help  .byte 'Press keys, move sticks. ESC exits.',0
        run start
