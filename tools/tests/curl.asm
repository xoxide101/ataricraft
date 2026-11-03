; CURL.COM - HTTP request through the FujiNet N: device (N1:). Plain GET, headers, or POST.
;   CURL url                 print the body
;   CURL -i url              print STATUS n (FujiNet error code, 1 = 2xx), the response headers, then the body
;   CURL -d data url         POST data (one word) and print the response
; Runs from CMD with the rest of the line, or asks at the CURL? prompt.
        org $2000
; @head
hflag   = $A0
post    = $A1
ui      = $A2

start   lda #<prompt
        ldy #>prompt
        jsr gettoks
        lda #0
        sta hflag
        sta post
        sta ui
        lda TOK
        cmp #'-'
        bne c_go
        lda TOK+1
        and #$DF
        cmp #'I'
        bne c_d
        inc hflag
        lda #1
        sta ui
        jmp c_go
c_d     cmp #'D'
        beq c_d1
        jmp c_usage
c_d1    inc post
        lda #2
        sta ui
c_go    ldx ui
        jsr tokempty
        bne c_have
c_usage lda #<usage
        ldy #>usage
        jmp puts
c_have  jsr bstart
        lda #<s_n
        ldy #>s_n
        jsr bapp
        ldx ui
        jsr appt
        jsr mkspec
        ldx #4
        lda hflag
        beq c_m1
        ldx #12
c_m1    lda post
        beq c_m2
        ldx #13
c_m2    ldy #2
        jsr nopen
        cpy #1
        beq c_ok
        lda #<m_open
        ldy #>m_open
        jmp puts
c_ok    lda post
        beq c_show
        lda #'M'
        ldx #4
        ldy #0
        jsr nsimple
        jsr bstart
        ldx #1
        jsr appt
        lda bpos
        jsr nwrite
        lda hflag
        bne c_show
        lda #'M'
        ldx #0
        ldy #0
        jsr nsimple
c_show  lda hflag
        beq c_body
        lda #'M'
        ldx #2
        ldy #0
        jsr nsimple
        jsr nstat
        lda #<m_stat
        sta ICBAL
        lda #>m_stat
        sta ICBAH
        lda #$0B
        sta ICCOM
        lda #7
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV
        lda STAT+3
        jsr pdec
        lda #$9B
        jsr putc
        jsr rdall
        lda #$9B
        jsr putc
        lda #'M'
        ldx #0
        ldy #0
        jsr nsimple
c_body  jsr rdall
        jmp nclose

; @tok
; @lib

prompt  .byte 'CURL? ',$9B
usage   .byte 'CURL [-i] [-d data] url',$9B
m_open  .byte 'OPEN FAILED',$9B
m_stat  .byte 'STATUS ',$9B
s_n     .byte 'N:',$9B
