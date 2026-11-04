; tuidemo.asm - demo for tui.inc: menu bar (click or Esc), pop-up menu, message box, framed window.
; Build: mads tuidemo.asm -o:tuidemo.com
        org $2000

start   jsr draw
loop    jsr tui_event
        cmp #2
        beq click
        lda TKEY
        cmp #$1B
        beq fmenu
        cmp #'q'
        beq quit
        cmp #'Q'
        beq quit
        bne loop
click   jsr tui_barhit
        cmp #$FF
        beq loop
        cmp #1
        beq help
        bne fmenu
fmenu   lda #0
        sta mnu
        lda barx
        sta TX
        lda #1
        sta TY
        lda #<filemenu
        sta SP
        lda #>filemenu
        sta SP+1
        jsr tui_menu
        pha
        jsr draw
        pla
        cmp #$FF
        beq loop
        sta $0600
        cmp #3
        beq quit
        cmp #2
        beq about
        lda #<nyi
        sta SP
        lda #>nyi
        sta SP+1
        jsr tui_msg
        jsr draw
        jmp loop
about   lda #<abt
        sta SP
        lda #>abt
        sta SP+1
        jsr tui_msg
        jsr draw
        jmp loop
help    lda #<hlp
        sta SP
        lda #>hlp
        sta SP+1
        jsr tui_msg
        jsr draw
        jmp loop
quit    jmp ($000A)

draw    lda #0
        sta TX
        sta TCH
        lda #1
        sta TY
        lda #40
        sta TW
        lda #23
        sta TH
        jsr tui_fill
        lda #6
        sta TX
        lda #4
        sta TY
        lda #28
        sta TW
        lda #10
        sta TH
        jsr tui_box
        lda #8
        sta TX
        lda #6
        sta TY
        lda #0
        sta TINV
        lda #<w1
        sta SP
        lda #>w1
        sta SP+1
        jsr tui_str
        inc TY
        inc TY
        lda #<w2
        sta SP
        lda #>w2
        sta SP+1
        jsr tui_str
        inc TY
        lda #<w3
        sta SP
        lda #>w3
        sta SP+1
        jsr tui_str
        lda #<bar
        sta SP
        lda #>bar
        sta SP+1
        jmp tui_bar

mnu     .byte 0
bar     .byte 'File',0,'Help',0,0
filemenu .byte 'New',0,'Open...',0,'About',0,'Exit',0,0
w1      .byte 'ATARI TEXT UI LIBRARY',0
w2      .byte 'Click the bar, or press Esc.',0
w3      .byte 'Q quits.',0
nyi     .byte 'Not implemented in the demo',0
abt     .byte 'tui.inc  -  Ataricraft',0
hlp     .byte 'Mouse: ST on port 2',0

        icl 'tui.inc'

        org $02E0
        .word start
