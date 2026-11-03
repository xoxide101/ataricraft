; NC.COM - TCP client and one-shot server through the FujiNet N: device (N1:). Plain TCP, no TLS.
;   NC host port word        send one word, print the reply
;   NC host port             interactive: type a line, see the reply, empty line quits
;   NC -l port               listen, accept one client, greet it, print what it sends, say BYE, drop it
; Runs from CMD with the rest of the line, or asks at the NC? prompt. Replies are collected until the
; link is quiet for about 1.5 seconds (no PROCEED support, so it polls).
        org $2000
; @head
tmo     = $A1

start   lda #<prompt
        ldy #>prompt
        jsr gettoks
        ldx #0
        jsr tokempty
        bne n1
n_usage lda #<usage
        ldy #>usage
        jmp puts
n1      lda TOK
        cmp #'-'
        beq n_srv
        jmp n_cli
n_srv   lda TOK+1
        and #$DF
        cmp #'L'
        bne n_usage
        ldx #1
        jsr tokempty
        beq n_usage
        jsr bstart
        lda #<s_tcps
        ldy #>s_tcps
        jsr bapp
        ldx #1
        jsr appt
        jsr mkspec
        ldx #12
        ldy #3
        jsr nopen
        cpy #1
        beq n_lis
n_fail  lda #<m_fail
        ldy #>m_fail
        jmp puts
n_lis   lda #<m_wait
        ldy #>m_wait
        jsr puts
        lda $13
        sta tmo
n_acc   lda #'A'
        ldx #0
        ldy #0
        jsr nsimple
        cpy #1
        beq n_got
        lda $13
        sec
        sbc tmo
        cmp #3
        bcc n_acc
        lda #<m_none
        ldy #>m_none
        jsr puts
        jmp nclose
n_got   jsr bstart
        lda #<s_hello
        ldy #>s_hello
        jsr bapp
        jsr bsend
        jsr rdwait
        jsr bstart
        lda #<s_bye
        ldy #>s_bye
        jsr bapp
        jsr bsend
        jsr delay
        lda #'c'
        ldx #0
        ldy #0
        jsr nsimple
        jmp nclose

n_cli   ldx #1
        jsr tokempty
        bne n_c1
        jmp n_usage
n_c1    jsr bstart
        lda #<s_tcp
        ldy #>s_tcp
        jsr bapp
        ldx #0
        jsr appt
        lda #<s_colon
        ldy #>s_colon
        jsr bapp
        ldx #1
        jsr appt
        jsr mkspec
        ldx #12
        ldy #3
        jsr nopen
        cpy #1
        beq n_ok
        jmp n_fail
n_ok    ldx #2
        jsr tokempty
        beq n_int
        jsr bstart
        ldx #2
        jsr appt
        jsr bsend
        jsr rdwait
        jmp nclose
n_int   lda #<p2
        ldy #>p2
        jsr puts
        lda #<LINE
        ldy #>LINE
        jsr getrec
        cpx #2
        bcc n_end
        stx tx
        ldx #0
n_cp    lda LINE,x
        sta BUF,x
        inx
        cpx tx
        bne n_cp
        lda tx
        jsr nwrite
        jsr rdwait
        jmp n_int
n_end   jmp nclose

; print whatever arrives until the link has been quiet for about 1.5 s or the peer hangs up
rdwait  lda $14
        sta tmo
rw1     jsr nstat
        cpy #1
        bne rw9
        lda STAT
        ora STAT+1
        beq rw2
        jsr nread
        jsr pbuf
        lda $14
        sta tmo
        jmp rw1
rw2     lda STAT+2
        beq rw9
        lda $14
        sec
        sbc tmo
        cmp #90
        bcc rw1
rw9     rts

delay   lda $14
        clc
        adc #30
        sta tmo
dl1     lda $14
        sec
        sbc tmo
        bmi dl1
        rts

; @tok
; @lib

prompt  .byte 'NC? ',$9B
p2      .byte '> ',$9B
usage   .byte 'NC host port [word] | NC -l port',$9B
m_fail  .byte 'CANNOT CONNECT',$9B
m_wait  .byte 'LISTENING',$9B
m_none  .byte 'NO CLIENT',$9B
s_tcp   .byte 'N:TCP://',$9B
s_tcps  .byte 'N:TCP://:',$9B
s_colon .byte ':',$9B
s_hello .byte 'HELLO FROM ATARI',$9B
s_bye   .byte 'BYE',$9B
