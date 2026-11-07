; ACNet demo / conformance program. Runs every stage and leaves results in page 6 for the test harness to read.
; Build: mads guest\acnet\demo.asm -o:out\acnet-demo-reg.xex            (register window)
;        mads guest\acnet\demo.asm -d:ACNET_SIO=1 -o:out\acnet-demo-sio.xex   (SIO device $65)
; The network it expects (scripts/acnet-test.cjs provides it): DNS name host.test -> 10.7.0.1, HTTP on :80, TCP echo :8000,
; UDP echo :7777, nothing on :9 (refused); a peer that connects to our listener on :6000 when STAGE reaches 5.

STAGE  = $0600
DONE   = $0601
R_INIT = $0602
R_NET  = $0604   ; 26 bytes
R_DNS  = $0620   ; res, ip[4]
R_PING = $0628   ; res, rtt lo/hi
R_HTTP = $0630   ; res, len lo/hi (body at HTTPBUF)
R_UDP  = $0638   ; res, len; data at $0640
R_UDPD = $0640
R_LIS  = $0650   ; res, rip[4], rport[2], len, data at $0658
R_XFER = $0670   ; res, sent(2), rx(2), mismatches(2), tx stalls(2)
R_ERR  = $0680   ; refused serr, nxdomain serr, irq count, evm lo/hi
R_MANY = $0690   ; res, ok count
R_CLOSE= $06A0   ; res of recv-after-remote-close, final status
HTTPBUF= $4000
XFERN  = 20000

	org $2000

start
	mva #0 DONE
	mva #1 STAGE
	jsr an_init
	lda #0
	rol
	sta R_INIT
	bcc ok_init
	jmp finish
ok_init
	.ifndef ACNET_SIO
	.ifndef NOIRQ
	jsr an_irq_install
	.endif
	.endif
	mwa #0 an_tmo
	mwa #600 an_tmo

; stage 1: network info
	mwa #R_NET an_ptr
	jsr an_netinfo

; stage 2: DNS + ping
	mva #2 STAGE
	mwa #name_host an_hp
	jsr an_dns
	lda #0
	rol
	sta R_DNS
	ldy #3
cp_ip	lda an_ip,y
	sta R_DNS+1,y
	dey
	bpl cp_ip
	jsr an_ping
	lda #0
	rol
	sta R_PING
	mva an_rtt R_PING+1
	mva an_rtt+1 R_PING+2
	mwa #name_bad an_hp
	jsr an_dns
	lda an_serr
	sta R_ERR+1

; stage 3: HTTP GET against the local test server
	mva #3 STAGE
	mwa #name_host an_hp
	mwa #80 an_port
	jsr an_tcp_open
	jcs http_fail
	stx http_sock
	mwa #http_req an_ptr
	mwa #http_req_end-http_req an_len
	ldx http_sock
	jsr an_send_all
	mwa #HTTPBUF an_ptr
	mwa #0 http_len
http_rd	lda #<HTTPBUF
	clc
	adc http_len
	sta an_ptr
	lda #>HTTPBUF
	adc http_len+1
	sta an_ptr+1
	mwa #200 an_len
	ldx http_sock
	jsr an_recv
	jcs http_eof
	clc
	lda http_len
	adc an_len
	sta http_len
	lda http_len+1
	adc an_len+1
	sta http_len+1
	jmp http_rd
http_eof
	lda #0
	sta R_HTTP
	jmp http_done
http_fail
	lda #1
	sta R_HTTP
http_done
	mva http_len R_HTTP+1
	mva http_len+1 R_HTTP+2
	ldx http_sock
	jsr an_close

; stage 4: UDP echo, two datagrams back to back
	mva #4 STAGE
	mwa #0 an_port
	jsr an_udp_open
	stx udp_sock
	mva #10 an_ip
	mva #7 an_ip+1
	mva #0 an_ip+2
	mva #1 an_ip+3
	mwa #7777 an_port
	ldx udp_sock
	jsr an_udp_to
	mwa #udp_msg an_ptr
	mwa #8 an_len
	ldx udp_sock
	jsr an_write
	ldx udp_sock
	jsr an_flush
	mwa #R_UDPD an_ptr
	mwa #16 an_len
	ldx udp_sock
	jsr an_recv
	lda #0
	rol
	sta R_UDP
	mva an_len R_UDP+1
	ldx udp_sock
	jsr an_close

; stage 5: listener
	mva #5 STAGE
	jsr an_alloc
	stx lis_sock
	mwa #6000 an_port
	ldx lis_sock
	jsr an_listen
	jcs lis_fail
	mwa #1500 an_tmo
	ldx lis_sock
	jsr an_accept
	jcs lis_fail
	stx conn_sock
	ldy #5
cp_rip	lda an_arg,y
	sta R_LIS+1,y
	dey
	bpl cp_rip
	mwa #R_LIS+8 an_ptr
	mwa #16 an_len
	ldx conn_sock
	jsr an_recv
	mva an_len R_LIS+7
	mwa #lis_reply an_ptr
	mwa #6 an_len
	ldx conn_sock
	jsr an_send_all
	lda #0
	sta R_LIS
	jmp lis_done
lis_fail
	lda #1
	sta R_LIS
lis_done
	mwa #600 an_tmo
	ldx conn_sock
	jsr an_close
	ldx lis_sock
	jsr an_close

; stage 6: refused connection
	mva #6 STAGE
	mwa #name_ip an_hp
	mwa #9 an_port
	jsr an_tcp_open
	lda an_serr
	sta R_ERR
	ldx an_sa
	jsr an_close

; stage 7: many concurrent sockets (8 echo connections open at once, each carries its own marker byte)
	mva #7 STAGE
	mva #0 many_i
mo1	mwa #name_ip an_hp
	mwa #8000 an_port
	jsr an_tcp_open
	jcs mo_done
	txa
	ldy many_i
	sta many_s,y
	inc many_i
	lda many_i
	cmp #8
	bcc mo1
mo_done
	mva many_i many_cnt
	mva #0 many_i
ms1	lda many_i
	cmp many_cnt
	jcs ms_done
	clc
	adc #$41
	sta many_b
	mwa #many_b an_ptr
	mwa #1 an_len
	ldy many_i
	ldx many_s,y
	jsr an_send_all
	inc many_i
	jmp ms1
ms_done
	mva #0 many_i
	mva #0 many_ok
mr1	lda many_i
	cmp many_cnt
	jcs mr_done
	mwa #many_r an_ptr
	mwa #1 an_len
	ldy many_i
	ldx many_s,y
	jsr an_recv
	lda many_r
	sec
	sbc many_i
	cmp #$41
	bne mr_next
	inc many_ok
mr_next	inc many_i
	jmp mr1
mr_done
	mva many_ok R_MANY+1
	mva many_cnt R_MANY+2
	lda many_ok
	cmp #8
	beq mc_ok
	lda #1
	bne mc_st
mc_ok	lda #0
mc_st	sta R_MANY
	mva #0 many_i
mc1	lda many_i
	cmp many_cnt
	jcs mc_done
	ldy many_i
	ldx many_s,y
	jsr an_close
	inc many_i
	jmp mc1
mc_done
; stage 8: large transfer through the echo server, full duplex with pattern verification
	mva #8 STAGE
	mwa #name_ip an_hp
	mwa #8000 an_port
	jsr an_tcp_open
	jcs xfer_fail
	stx x_sock
	mwa #0 x_sent
	mwa #0 x_rx
	mwa #0 x_bad
	mwa #0 x_stall
	mva #3 x_txexp
	mva #3 x_rxexp
	mva #0 x_clen
	mva #0 x_coff
xloop
	lda x_sent
	cmp #<XFERN
	bne x_more
	lda x_sent+1
	cmp #>XFERN
	jeq x_chk
x_more
	lda x_coff
	cmp x_clen
	bcc x_have
	jsr x_gen
x_have
	sec
	lda x_clen
	sbc x_coff
	sta an_len
	lda #0
	sta an_len+1
	clc
	lda #<x_chunk
	adc x_coff
	sta an_ptr
	lda #>x_chunk
	adc #0
	sta an_ptr+1
	ldx x_sock
	jsr an_write
	lda an_len
	bne x_acc
	inw x_stall
x_acc	clc
	lda x_coff
	adc an_len
	sta x_coff
	clc
	lda x_sent
	adc an_len
	sta x_sent
	jcc x_chk
	inc x_sent+1
x_chk
	mwa #x_rbuf an_ptr
	mwa #64 an_len
	ldx x_sock
	jsr an_read
	lda an_len
	beq x_nord
	sta x_n
	ldy #0
x_cmp	lda x_rbuf,y
	cmp x_rxexp
	beq x_good
	inw x_bad
x_good	clc
	lda x_rxexp
	adc #7
	sta x_rxexp
	inw x_rx
	iny
	cpy x_n
	bne x_cmp
x_nord
	lda x_rx
	cmp #<XFERN
	bne x_cont
	lda x_rx+1
	cmp #>XFERN
	jeq x_end
x_cont	jsr an_idle
	jmp xloop
x_end
	lda #0
	sta R_XFER
	jmp x_save
xfer_fail
	lda #1
	sta R_XFER
x_save
	mva x_sent R_XFER+1
	mva x_sent+1 R_XFER+2
	mva x_rx R_XFER+3
	mva x_rx+1 R_XFER+4
	mva x_bad R_XFER+5
	mva x_bad+1 R_XFER+6
	mva x_stall R_XFER+7
	mva x_stall+1 R_XFER+8
	.ifndef ACNET_SIO
	mva an_irqs R_ERR+2
	mva an_evm R_ERR+3
	mva an_evm+1 R_ERR+4
	.endif

; stage 9: remote close -> EOF is delivered after the data
	mva #9 STAGE
	ldx x_sock
	jsr an_close
	ldx #0
	stx R_CLOSE

finish
	mva #$aa DONE
	jmp *

x_gen	; next chunk of 48 pattern bytes (or fewer at the end)
	sec
	lda #<XFERN
	sbc x_genpos
	sta an_tmp
	lda #>XFERN
	sbc x_genpos+1
	bne x_g48
	lda an_tmp
	cmp #48
	bcc x_glen
x_g48	lda #48
	sta an_tmp
x_glen	lda an_tmp
	sta x_clen
	lda #0
	sta x_coff
	ldy #0
x_gl	lda x_txexp
	sta x_chunk,y
	clc
	adc #7
	sta x_txexp
	iny
	cpy x_clen
	bne x_gl
	clc
	lda x_genpos
	adc x_clen
	sta x_genpos
	bcc x_gd
	inc x_genpos+1
x_gd	rts

	icl 'acnet.inc'

name_host .byte 'host.test',0
name_bad  .byte 'nope.test',0
name_ip   .byte '10.7.0.1',0
http_req  .byte 'GET /hello HTTP/1.0',$0d,$0a,'Host: host.test',$0d,$0a,$0d,$0a
http_req_end
udp_msg   .byte 'udp-ping'
lis_reply .byte 'srv-ok'
http_sock .byte 0
http_len  .word 0
udp_sock  .byte 0
lis_sock  .byte 0
conn_sock .byte 0
x_sock .byte 0
x_sent .word 0
x_rx .word 0
x_bad .word 0
x_stall .word 0
x_txexp .byte 0
x_rxexp .byte 0
x_clen .byte 0
x_coff .byte 0
x_n .byte 0
x_genpos .word 0
x_chunk .ds 48
x_rbuf .ds 64
many_i .byte 0
many_cnt .byte 0
many_ok .byte 0
many_b .byte 0
many_r .byte 0
many_s .ds 16

	run start
