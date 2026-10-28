; hand.asm - command-line hand-off from CMD.COM to the standalone tools (ARC, ZIP, DCM).
;
; CMD.COM stores the text after the program name at HAND ($0480, unused page 4 RAM):
;   HAND   = $A5 when a line is waiting, $5A once the tool has taken it, 0 otherwise
;   HAND+1 = the line, EOL terminated
; A tool calls getlineh instead of getline. The first call returns the hand-off line
; (so "ZIP L A.ZIP" runs that command directly), the second returns a blank line, which
; every tool treats as "exit". Without a hand-off line getlineh is just getline.
; Include after lib\io.asm. Limitation: a program that never calls getlineh leaves the
; line pending until CMD runs the next program.
HAND    = $0480

getlineh:
        lda HAND
        cmp #$A5
        bne gh_n
        ldy #0
gh_c:   lda HAND+1,y
        sta LINE,y
        iny
        cmp #EOL
        bne gh_c
        lda #$5A
        sta HAND
        clc
        rts
gh_n:   cmp #$5A
        bne gh_g
        lda #0
        sta HAND
        lda #EOL
        sta LINE
        clc
        rts
gh_g:   jmp getline
