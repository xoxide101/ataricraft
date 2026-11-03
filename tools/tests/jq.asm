; JQ.COM - fetch a JSON document through the FujiNet N: device and print one value from it.
;   JQ /path/to/value url        e.g. JQ /specs/cpu http://host/info.json
; Objects and arrays print as compact JSON, strings print raw, a missing path prints NOT FOUND.
; Runs from CMD with the rest of the line, or asks at the JQ? prompt.
        org $2000
; @head

start   lda #<prompt
        ldy #>prompt
        jsr gettoks
        ldx #1
        jsr tokempty
        bne j_have
        lda #<usage
        ldy #>usage
        jmp puts
j_have  jsr bstart
        lda #<s_n
        ldy #>s_n
        jsr bapp
        ldx #1
        jsr appt
        jsr mkspec
        ldx #4
        ldy #0
        jsr nopen
        cpy #1
        beq j_op
        lda #<m_open
        ldy #>m_open
        jmp puts
j_op    lda #$FC
        ldx #1
        ldy #0
        jsr nsimple
        lda #'P'
        ldx #0
        ldy #0
        jsr nsimple
        cpy #1
        beq j_q
        lda #<m_json
        ldy #>m_json
        jsr puts
        jmp nclose
j_q     jsr bstart
        ldx #0
        jsr appt
        ldx bpos
        lda #$9B
        sta BUF,x
        lda #'Q'
        sta cmd
        lda #0
        sta al
        sta ah
        lda #<BUF
        ldy #>BUF
        jsr nsend
        cpy #1
        beq j_r
        lda #<m_nf
        ldy #>m_nf
        jsr puts
        jmp nclose
j_r     jsr rdall
        jmp nclose

; @tok
; @lib

prompt  .byte 'JQ? ',$9B
usage   .byte 'JQ /path url',$9B
m_open  .byte 'OPEN FAILED',$9B
m_json  .byte 'BAD JSON',$9B
m_nf    .byte 'NOT FOUND',$9B
s_n     .byte 'N:',$9B
