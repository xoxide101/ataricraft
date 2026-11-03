; MAIL.COM - POP3 and SMTP over the FujiNet N: device (N1:, TCP). Plain text only (no TLS).
; From CMD (or at the MAIL? prompt):
;   MAIL L host:port user pass          list messages
;   MAIL R host:port user pass n        show message n
;   MAIL D host:port user pass n        delete message n
;   MAIL S host:port from to text...    send a one-line message
; Replies are printed as the server sends them. Multi-line SMTP replies (250-) are cut at the first line.
        org $2000
; @head
tp      = $80
ip      = $81
op      = $82
mm      = $83
multi   = $84
first   = $85
t1      = $86
t2      = $87
t3      = $88
tmo     = $89
rcode   = $8A
tx      = $8B
bpos    = $8C
tpl     = $8D
tph     = $8E
spl     = $8F
sph     = $90
pmode   = $92
TOK     = $3600

start   lda $0480
        cmp #$A5
        bne ask
        ldy #0
hc1     lda $0481,y
        sta LINE,y
        iny
        cmp #$9B
        bne hc1
        lda #$5A
        sta $0480
        jmp parse
ask     lda #<prompt
        ldy #>prompt
        jsr puts
        lda #<LINE
        ldy #>LINE
        jsr getrec
parse   ldx #4
pi1     lda tlo,x
        sta tpl
        lda thi,x
        sta tph
        lda #$9B
        ldy #0
        sta (tpl),y
        dex
        bpl pi1
        lda #0
        sta tp
        sta ip
nexttok ldy ip
skipsp  lda LINE,y
        cmp #' '
        bne got
        iny
        bne skipsp
got     sty ip
        cmp #$9B
        beq tdone
        ldx tp
        cpx #5
        bcs tdone
        lda tlo,x
        sta tpl
        lda thi,x
        sta tph
        lda #0
        sta op
cpt     ldy ip
        lda LINE,y
        cmp #$9B
        beq endt
        cmp #' '
        bne store
        lda tp
        cmp #4
        bcc endt
        lda #' '
store   ldy op
        sta (tpl),y
        inc op
        inc ip
        jmp cpt
endt    ldy op
        lda #$9B
        sta (tpl),y
        inc tp
        jmp nexttok
tdone   lda TOK
        and #$DF
        sta pmode
        cmp #'L'
        beq ispop
        cmp #'R'
        beq ispop
        cmp #'D'
        beq ispop
        cmp #'S'
        beq issmtp
        lda #<usage
        ldy #>usage
        jmp puts
ispop   jmp pop3
issmtp  jmp smtp

pop3    jsr connect
        bcc pc1
        jmp cfail
pc1     lda #0
        sta mm
        jsr readresp
        lda #<s_user
        ldy #>s_user
        ldx #2
        jsr cmdt
        lda rcode
        cmp #'+'
        bne plfail
        lda #<s_pass
        ldy #>s_pass
        ldx #3
        jsr cmdt
        lda rcode
        cmp #'+'
        bne plfail
        lda pmode
        cmp #'L'
        bne pr
        lda #1
        sta mm
        lda #<s_list
        ldy #>s_list
        ldx #$FF
        jsr cmdt
        jmp pquit
pr      cmp #'R'
        bne pd
        lda #1
        sta mm
        lda #<s_retr
        ldy #>s_retr
        ldx #4
        jsr cmdt
        jmp pquit
pd      lda #0
        sta mm
        lda #<s_dele
        ldy #>s_dele
        ldx #4
        jsr cmdt
pquit   lda #0
        sta mm
        lda #<s_quit
        ldy #>s_quit
        ldx #$FF
        jsr cmdt
        jmp nclose
plfail  lda #<m_login
        ldy #>m_login
        jsr puts
        jmp pquit
cfail   lda #<m_conn
        ldy #>m_conn
        jmp puts

smtp    jsr connect
        bcc sc1
        jmp cfail
sc1     lda #0
        sta mm
        jsr readresp
        lda #<s_helo
        ldy #>s_helo
        ldx #$FF
        jsr cmdt
        jsr bstart
        lda #<s_mf
        ldy #>s_mf
        jsr bapp
        ldx #2
        jsr appt
        lda #<s_gt
        ldy #>s_gt
        jsr bapp
        jsr bsend
        lda #0
        sta mm
        jsr readresp
        jsr bstart
        lda #<s_rt
        ldy #>s_rt
        jsr bapp
        ldx #3
        jsr appt
        lda #<s_gt
        ldy #>s_gt
        jsr bapp
        jsr bsend
        lda #0
        sta mm
        jsr readresp
        lda #<s_data
        ldy #>s_data
        ldx #$FF
        jsr cmdt
        lda rcode
        cmp #'3'
        beq sd1
        jmp pquit
sd1     lda #$FF
        sta mm
        lda #<s_from
        ldy #>s_from
        ldx #2
        jsr cmdt
        lda #<s_to
        ldy #>s_to
        ldx #3
        jsr cmdt
        lda #<s_subj
        ldy #>s_subj
        ldx #$FF
        jsr cmdt
        lda #<s_empty
        ldy #>s_empty
        ldx #$FF
        jsr cmdt
        lda #<s_empty
        ldy #>s_empty
        ldx #4
        jsr cmdt
        lda #0
        sta mm
        lda #<s_dot
        ldy #>s_dot
        ldx #$FF
        jsr cmdt
        jmp pquit

; open N1: as tcp://TOK1 (aux1 12 read/write, aux2 3 = CRLF/LF to EOL); carry set on failure
connect jsr bstart
        lda #<s_tcp
        ldy #>s_tcp
        jsr bapp
        ldx #1
        jsr appt
        ldx bpos
        lda #$9B
        sta BUF,x
        inx
        stx tx
        ldx #0
cs1     lda BUF,x
        sta SPEC,x
        inx
        cpx tx
        bne cs1
        ldx #12
        ldy #3
        jsr nopen
        cpy #1
        bne cbad
        clc
        rts
cbad    sec
        rts

bstart  lda #0
        sta bpos
        rts

bapp    sta spl
        sty sph
        ldy #0
ba1     lda (spl),y
        cmp #$9B
        beq ba2
        ldx bpos
        sta BUF,x
        inc bpos
        iny
        bne ba1
ba2     rts

appt    lda tlo,x
        ldy thi,x
        jmp bapp

bsend   ldx bpos
        lda #$9B
        sta BUF,x
        inx
        txa
        jmp nwrite

; send verb A/Y plus token X ($FF = none); then read a reply unless mm is $FF
cmdt    stx tx
        ldx #0
        stx bpos
        jsr bapp
        ldx tx
        cpx #$FF
        beq cd1
        jsr appt
cd1     jsr bsend
        lda mm
        bpl cd3
        rts
cd3     jmp readresp

; print a server reply; mm = 1 reads a multi-line (.-terminated) body when the reply starts with +
readresp lda mm
        sta multi
        lda #0
        sta first
        sta rcode
        sta t1
        sta t2
        sta t3
        lda $13
        sta tmo
rr1     jsr nstat
        cpy #1
        bne rrdone
        lda STAT
        ora STAT+1
        bne rrdata
        lda STAT+2
        beq rrdone
        lda $13
        sec
        sbc tmo
        cmp #2
        bcs rrdone
        jmp rr1
rrdata  jsr nread
        jsr pbuf
        ldx #0
rt1     lda BUF,x
        ldy first
        bne rt2
        inc first
        sta rcode
        cmp #'+'
        beq rt2
        ldy #0
        sty multi
rt2     ldy t2
        sty t1
        ldy t3
        sty t2
        sta t3
        inx
        cpx ln
        bne rt1
        lda $13
        sta tmo
        lda multi
        bne rm
        lda t3
        cmp #$9B
        bne rr1b
        rts
rm      lda t3
        cmp #$9B
        bne rr1b
        lda t2
        cmp #'.'
        bne rr1b
        lda t1
        cmp #$9B
        bne rr1b
        rts
rr1b    jmp rr1
rrdone  rts

; @lib

tlo     .byte 0,64,128,192,0
thi     .byte $36,$36,$36,$36,$37
prompt  .byte 'MAIL? ',$9B
usage   .byte 'MAIL L|R|D host:port user pass [n]',$9B
        .byte 0
m_login .byte 'LOGIN FAILED',$9B
m_conn  .byte 'CANNOT CONNECT',$9B
s_tcp   .byte 'N:TCP://',$9B
s_user  .byte 'USER ',$9B
s_pass  .byte 'PASS ',$9B
s_list  .byte 'LIST',$9B
s_retr  .byte 'RETR ',$9B
s_dele  .byte 'DELE ',$9B
s_quit  .byte 'QUIT',$9B
s_helo  .byte 'HELO atari',$9B
s_mf    .byte 'MAIL FROM:<',$9B
s_rt    .byte 'RCPT TO:<',$9B
s_gt    .byte '>',$9B
s_data  .byte 'DATA',$9B
s_from  .byte 'From: ',$9B
s_to    .byte 'To: ',$9B
s_subj  .byte 'Subject: Mail from Atari',$9B
s_empty .byte $9B
s_dot   .byte '.',$9B
