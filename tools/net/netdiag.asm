; NETDIAG - PING, NSLOOKUP and TRACERT for the FujiNet N: device (N1:, SIO $71).  One source, three programs:
;   mads netdiag.asm -d:MODE=1 -o:ping.com      MODE 1 = PING
;   mads netdiag.asm -d:MODE=2 -o:nslookup.com  MODE 2 = NSLOOKUP
;   mads netdiag.asm -d:MODE=3 -o:tracert.com   MODE 3 = TRACERT
;   (add -d:NODIAG=1 to skip the relay and always use the fallback, for testing)
; Auto-detect: each tool first asks the Ataricraft relay (N:HTTP://diag.ataricraft/<verb>/<host>), which runs a real
; ICMP ping / traceroute / DNS lookup on the PC.  A real FujiNet cannot resolve that name, so the tool falls back to
; what N: can do: PING times a TCP connect to port 80, NSLOOKUP asks DNS-over-HTTPS (dns.google), TRACERT has no
; fallback (no ICMP or TTL control on FujiNet).  Usage: PING host   (or run it and type the host at the prompt).
        .ifndef MODE
MODE    = 1
        .endif
        .ifndef NODIAG
NODIAG  = 0
        .endif
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
RTCLOK  = $12
PALNTS  = $D014
ptr     = $CC
SPEC    = $3000
STAT    = $3100
BUF     = $3200
HOST    = $3400
QBUF    = $3500
QMAX    = $0A00

start   lda #0
        sta got
        sta qoff
        sta qoff+1
        lda $0480
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
        cmp #' '
        beq hc4
        sta HOST,x
        iny
        inx
        cmp #$9B
        bne hc3
        beq hc5
hc4     lda #$9B
        sta HOST,x
hc5     lda #$5A
        sta $0480
        jmp havhost
ask     lda #<prompt
        ldy #>prompt
        jsr prs
        lda #$05
        sta ICCOM
        lda #<HOST
        sta ICBAL
        lda #>HOST
        sta ICBAH
        lda #100
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV
havhost lda HOST
        cmp #$9B
        bne go
        lda #<usage
        ldy #>usage
        jsr prl
        jmp finish

go
        .if NODIAG==0
        lda #0
        sta ul
        lda #<durl
        ldy #>durl
        jsr appstr
        lda #<HOST
        ldy #>HOST
        jsr appstr
        jsr endurl
        lda #0
        sta quiet
        jsr fetch
        lda got
        beq fallbk
        jmp finish
        .endif
fallbk
        .if MODE==1
        jmp tcping
        .endif
        .if MODE==2
        jmp doh
        .endif
        .if MODE==3
        lda #<nomsg
        ldy #>nomsg
        jsr prl
        lda #<nomsg2
        ldy #>nomsg2
        jsr prl
        jmp finish
        .endif

; ---------------------------------------------------------------- common
finish  lda #<dmsg
        ldy #>dmsg
        jsr prl
        lda #$FF
        sta CH
wait    lda CH
        cmp #$FF
        beq wait
        rts

; append the EOL-terminated string at A/Y to SPEC at offset ul (EOL not copied)
appstr  sta ptr
        sty ptr+1
        ldx ul
        ldy #0
as1     lda (ptr),y
        cmp #$9B
        beq as2
        sta SPEC,x
        inx
        iny
        bne as1
as2     stx ul
        rts
endurl  ldx ul
        lda #$9B
        sta SPEC,x
        rts

; print the EOL-terminated string at A/Y without its EOL
prs     sta ptr
        sty ptr+1
        ldy #0
pr1     lda (ptr),y
        cmp #$9B
        beq pr2
        sty ysv
        jsr putc
        ldy ysv
        iny
        bne pr1
pr2     rts
prl     jsr prs
crlf    lda #$9B
putc    pha
        lda #$0B
        sta ICCOM
        lda #0
        sta ICBLL
        sta ICBLH
        ldx #0
        pla
        jmp CIOV

; print nn as a decimal number
pdec    lda #0
        sta lz
        ldy #0
pd1     ldx #'0'
pd2     lda nn
        sec
        sbc ptab,y
        pha
        lda nn+1
        sbc ptab+1,y
        bcc pd3
        sta nn+1
        pla
        sta nn
        inx
        bne pd2
pd3     pla
        txa
        cmp #'0'
        bne pd4
        ldx lz
        bne pd4
        cpy #8
        bne pd5
pd4     inc lz
        sty ysv
        jsr putc
        ldy ysv
pd5     iny
        iny
        cpy #10
        bcc pd1
        rts
ptab    .word 10000,1000,100,10,1

; one SIO call to device $71; returns the status in Y
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

; open the URL in SPEC: al/ah = aux1/aux2; Y = status ($01 = ok)
nopen   lda #'O'
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
        jmp sio
nclose  lda #'C'
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

; GET the URL in SPEC.  quiet=0 prints the body, quiet=1 collects it in QBUF (qoff bytes).  got=1 if any byte came.
fetch   lda #0
        sta got
        lda RTCLOK+1
        sta t0+1
        lda RTCLOK+2
        sta t0
        lda #4
        sta al
        lda #2
        sta ah
        jsr nopen
        cpy #1
        beq fl1
        rts
fl1     lda #'S'
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
        bne hasd
        jmp idle
hasd
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
        lda #0
        sta lh
        sta ah
        jsr sio
        lda #1
        sta got
        lda quiet
        bne collect
        lda STAT
        sta ICBLL
        lda #0
        sta ICBLH
        lda #<BUF
        sta ICBAL
        lda #>BUF
        sta ICBAH
        lda #$0B
        sta ICCOM
        ldx #0
        jsr CIOV
        jmp fl1
collect lda qoff+1
        cmp #>QMAX
        bcc cl0
        jmp fl1
cl0
        lda #<QBUF
        clc
        adc qoff
        sta ptr
        lda #>QBUF
        adc qoff+1
        sta ptr+1
        ldy #0
cl1     lda BUF,y
        sta (ptr),y
        iny
        cpy STAT
        bcc cl1
        tya
        clc
        adc qoff
        sta qoff
        bcc cl2
        inc qoff+1
cl2     jmp fl1
idle    lda STAT+2
        beq fdone
        lda RTCLOK+2
        sec
        sbc t0
        lda RTCLOK+1
        sbc t0+1
        cmp #$0E
        bcs fdone
        jmp fl1
fdone   jsr nclose
        rts

        .if MODE==1
; ---------------------------------------------------------------- PING fallback: timed TCP connect
tcping  lda #<tpmsg
        ldy #>tpmsg
        jsr prl
        lda #4
        sta cnt
tp1     lda #0
        sta ul
        lda #<turl
        ldy #>turl
        jsr appstr
        lda #<HOST
        ldy #>HOST
        jsr appstr
        ldy #0
tpc     lda HOST,y
        cmp #':'
        beq tpslash
        iny
        cmp #$9B
        bne tpc
        lda #<tport
        ldy #>tport
        jsr appstr
        jmp tpend
tpslash lda #<tslash
        ldy #>tslash
        jsr appstr
tpend   jsr endurl
        lda RTCLOK+1
        sta t0+1
        lda RTCLOK+2
        sta t0
        lda #12
        sta al
        lda #0
        sta ah
        jsr nopen
        sty ok
        lda RTCLOK+2
        sec
        sbc t0
        sta nn
        lda RTCLOK+1
        sbc t0+1
        sta nn+1
        lda ok
        cmp #1
        bne tpfail
        jsr nclose
        lda nn
        sta jf
        lda nn+1
        sta jf+1
        lda #0
        sta nn
        sta nn+1
        ldx #17
        lda PALNTS
        and #$0E
        bne tp2
        ldx #20
tp2     lda nn
        clc
        adc jf
        sta nn
        lda nn+1
        adc jf+1
        sta nn+1
        dex
        bne tp2
        lda #<rmsg
        ldy #>rmsg
        jsr prs
        lda #<HOST
        ldy #>HOST
        jsr prs
        lda #<tmsg
        ldy #>tmsg
        jsr prs
        jsr pdec
        lda #<msmsg
        ldy #>msmsg
        jsr prl
        jmp tp3
tpfail  lda #<fmsg
        ldy #>fmsg
        jsr prl
tp3     lda RTCLOK+2
        clc
        adc #60
        sta t0
tp4     lda RTCLOK+2
        cmp t0
        bne tp4
        dec cnt
        beq tp5
        jmp tp1
tp5     jmp finish
turl    .byte 'N:TCP://',$9B
tport   .byte ':80/',$9B
tslash  .byte '/',$9B
tpmsg   .byte 'No relay: timing TCP connects to port 80',$9B
rmsg    .byte 'Reply from ',$9B
tmsg    .byte ': time=',$9B
msmsg   .byte ' ms',$9B
fmsg    .byte 'Request failed',$9B
        .endif

        .if MODE==2
; ---------------------------------------------------------------- NSLOOKUP fallback: DNS-over-HTTPS
doh     lda #0
        sta ul
        lda #<hurl
        ldy #>hurl
        jsr appstr
        lda #<HOST
        ldy #>HOST
        jsr appstr
        lda #<htype
        ldy #>htype
        jsr appstr
        jsr endurl
        lda #1
        sta quiet
        lda #0
        sta qoff
        sta qoff+1
        jsr fetch
        lda #<nmsg
        ldy #>nmsg
        jsr prs
        lda #<HOST
        ldy #>HOST
        jsr prl
        lda #<QBUF
        sta ptr
        lda #>QBUF
        sta ptr+1
        lda #0
        sta m
        sta found
        sta nn
        sta nn+1
dl1     lda nn
        cmp qoff
        bne dl2
        lda nn+1
        cmp qoff+1
        beq dl9
dl2     ldy #0
        lda (ptr),y
        inc ptr
        bne dl3
        inc ptr+1
dl3     inc nn
        bne dl4
        inc nn+1
dl4     ldx m
        cpx #8
        beq dprint
        cmp pat,x
        bne dmiss
        inc m
        bne dl1
dmiss   ldx #0
        cmp pat
        bne dl5
        ldx #1
dl5     stx m
        jmp dl1
dprint  cmp #'"'
        beq dend
        jsr putc
        jmp dl1
dend    jsr crlf
        lda #0
        sta m
        inc found
        jmp dl1
dl9     lda found
        bne dl10
        lda #<nfmsg
        ldy #>nfmsg
        jsr prl
dl10    jmp finish
pat     .byte '"data":"'
hurl    .byte 'N:HTTPS://dns.google/resolve?name=',$9B
htype   .byte '&type=A',$9B
nmsg    .byte 'Name: ',$9B
nfmsg   .byte 'No address found',$9B
        .endif

; ---------------------------------------------------------------- data
cmd     .byte 0
stats   .byte 0
bl      .byte 0
bh      .byte 0
ll      .byte 0
lh      .byte 0
al      .byte 0
ah      .byte 0
got     .byte 0
quiet   .byte 0
ul      .byte 0
ysv     .byte 0
lz      .byte 0
ok      .byte 0
cnt     .byte 0
m       .byte 0
found   .byte 0
t0      .word 0
nn      .word 0
jf      .word 0
qoff    .word 0
        .if MODE==1
durl    .byte 'N:HTTP://diag.ataricraft/ping/',$9B
usage   .byte 'Usage: PING host[:port]',$9B
        .endif
        .if MODE==2
durl    .byte 'N:HTTP://diag.ataricraft/dns/',$9B
usage   .byte 'Usage: NSLOOKUP host',$9B
        .endif
        .if MODE==3
durl    .byte 'N:HTTP://diag.ataricraft/trace/',$9B
usage   .byte 'Usage: TRACERT host',$9B
nomsg  .byte 'TRACERT needs the Ataricraft relay',$9B
nomsg2 .byte '(FujiNet has no ICMP / TTL control)',$9B
        .endif
prompt  .byte 'Host? ',$9B
dmsg    .byte 'Done - press a key',$9B
        run start
