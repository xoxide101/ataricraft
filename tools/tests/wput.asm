; WPUT.COM - upload a disk file to a URL through the FujiNet N: device (N1:), like wput(1).
;   WPUT D1:FILE.TXT ftp://user:pass@host/dir/FILE.TXT     (FTP STOR: needs the relay started with --allow-write)
;   WPUT FILE.TXT http://host/path                         (HTTP PUT)
;   WPUT FILE.TXT sd://folder/FILE.TXT                     (SD folder served by the relay, --allow-write)
; Runs from CMD with the rest of the line, or asks at the WPUT? prompt. The file name defaults to D1: when it has no device.
; The data is sent as raw bytes (no EOL translation). The transfer happens when N1: is closed, so a failed upload is
; reported as UPLOAD FAILED after the file has been read.
        org $2000
; @head
cnt     = $A0
wst     = $A1

start   lda #<prompt
        ldy #>prompt
        jsr gettoks
        ldx #0
        jsr tokempty
        beq w_usage
        ldx #1
        jsr tokempty
        bne w_have
w_usage lda #<usage
        ldy #>usage
        jmp puts
w_have  jsr bstart
        ldy #0
w_c     lda TOK,y
        cmp #$9B
        beq w_nodev
        cmp #':'
        beq w_dev
        iny
        bne w_c
w_nodev lda #<s_d
        ldy #>s_d
        jsr bapp
w_dev   ldx #0
        jsr appt
        jsr mkspec
        lda #$03
        sta $0362
        lda #<SPEC
        sta $0364
        lda #>SPEC
        sta $0365
        lda #4
        sta $036A
        lda #0
        sta $036B
        ldx #$20
        jsr CIOV
        bpl w_file
        lda #<m_file
        ldy #>m_file
        jmp puts
w_file  jsr bstart
        lda #<s_n
        ldy #>s_n
        jsr bapp
        ldx #1
        jsr appt
        jsr mkspec
        ldx #8
        ldy #0
        jsr nopen
        cpy #1
        beq w_loop
        lda #<m_open
        ldy #>m_open
        jsr puts
        jmp w_end
w_loop  lda #<BUF
        sta $0364
        lda #>BUF
        sta $0365
        lda #7
        sta $0362
        lda #200
        sta $0368
        lda #0
        sta $0369
        ldx #$20
        jsr CIOV
        sty wst
        lda $0368
        sta cnt
        beq w_chk
        jsr nwrite
        cpy #1
        bne w_wfail
w_chk   lda wst
        cmp #1
        beq w_loop
        cmp #$88
        beq w_fin
        lda #<m_read
        ldy #>m_read
        jsr puts
        jmp w_end
w_wfail lda #<m_wfail
        ldy #>m_wfail
        jsr puts
        jmp w_end
w_fin   jsr nclose
        cpy #1
        beq w_ok
        lda #<m_fail
        ldy #>m_fail
        jsr puts
        jmp w_cls
w_ok    lda #<m_done
        ldy #>m_done
        jsr puts
        jmp w_cls
w_end   jsr nclose
w_cls   lda #$0C
        sta $0362
        ldx #$20
        jmp CIOV

; @tok
; @lib

prompt  .byte 'WPUT? ',$9B
usage   .byte 'WPUT file url',$9B
m_file  .byte 'CANNOT OPEN FILE',$9B
m_open  .byte 'OPEN FAILED',$9B
m_read  .byte 'READ ERROR',$9B
m_wfail .byte 'WRITE FAILED',$9B
m_fail  .byte 'UPLOAD FAILED',$9B
m_done  .byte 'UPLOAD OK',$9B
s_n     .byte 'N:',$9B
s_d     .byte 'D1:',$9B
