; ACNet 6502 driver (mads). One API, two transports:
;   default            memory-mapped register window at $D1A0 (emulator / PBI-ECI-style fast path), optional IRQ
;   -d:ACNET_SIO=1     SIO device $65 (real Atari through a serial/USB SIO bridge, or the emulator's SIO hook)
; Include this file once, in the code segment, then call an_init. See docs/ACNET.md for the register map and semantics.
; Everything is polled but never spins without calling an_idle, so an OS thread scheduler can hook an_idlev and switch away.

AN_C_ALLOC   = 1
AN_C_CONNECT = 2
AN_C_LISTEN  = 3
AN_C_ACCEPT  = 4
AN_C_CLOSE   = 5
AN_C_UDPOPEN = 6
AN_C_FLUSH   = 7
AN_C_UDPPEER = 8
AN_C_DNS     = 9
AN_C_PEERINFO= 10
AN_C_NETINFO = 11
AN_C_PING    = 12
AN_C_RESET   = 13
AN_C_DROP    = 16
AN_C_SHUTDOWN= 17

AN_SS_OPEN = $01
AN_SS_RX   = $02
AN_SS_TX   = $04
AN_SS_EOF  = $08
AN_SS_ERR  = $10
AN_SS_CONN = $20
AN_SS_LISTEN = $40
AN_SS_ACCEPT = $80

AN_EV_RX = $01
AN_EV_EOF = $02
AN_EV_ACCEPT = $04
AN_EV_CONN = $08
AN_EV_ERR = $10
AN_EV_TX = $20
AN_EV_LINK = $40

; zero page (override by defining AN_ZP before including)
.ifndef AN_ZP
AN_ZP = $80
.endif
an_ptr  = AN_ZP+0   ; data pointer for an_read/an_write (advanced by the transfer)
an_len  = AN_ZP+2   ; in: bytes wanted; out: bytes transferred
an_hp   = AN_ZP+4   ; zero-terminated host string
an_port = AN_ZP+6   ; port
an_cur  = AN_ZP+8   ; socket reported by the last command (ALLOC/ACCEPT)
an_res  = AN_ZP+9   ; result code of the last command (0 = ok)
an_tmo  = AN_ZP+10  ; wait timeout in jiffies (0 = forever)
an_t0   = AN_ZP+12
an_tmp  = AN_ZP+14
an_wm   = AN_ZP+15
an_wx   = AN_ZP+16
an_wmode= AN_ZP+17
an_av   = AN_ZP+18
an_ds   = AN_ZP+20
an_bp   = AN_ZP+21
an_bl   = AN_ZP+23
an_sx   = AN_ZP+25
an_sa   = AN_ZP+26
an_old  = AN_ZP+27

.ifndef ACNET_SIO
AN_BASE = $D1A0
.endif

; ---------------------------------------------------------------------------------------------------------------------
; Low level primitives
;   an_cmd    A=command X=socket, an_arg[0..7] = arguments  -> A=an_res (Z set when OK); an_arg/an_cur updated
;   an_status X=socket -> an_sstat an_ev an_rx an_tx an_flags an_serr an_evmask
;   an_evack  X=socket A=event mask to clear
;   an_read   X=socket, an_ptr, an_len -> an_len = bytes read (may be fewer; 0 = none)
;   an_write  X=socket, an_ptr, an_len -> an_len = bytes accepted (may be fewer)
; ---------------------------------------------------------------------------------------------------------------------
.ifndef ACNET_SIO
an_cmd
	stx AN_BASE+5
	pha
	ldy #7
an_c1	lda an_arg,y
	sta AN_BASE+16,y
	dey
	bpl an_c1
	pla
	sta AN_BASE+4
	lda AN_BASE+5
	sta an_cur
	ldy #7
an_c2	lda AN_BASE+16,y
	sta an_arg,y
	dey
	bpl an_c2
	lda AN_BASE+4
	sta an_res
	rts

an_status
	stx AN_BASE+5
	lda AN_BASE+6
	sta an_sstat
	lda AN_BASE+7
	sta an_ev
	lda AN_BASE+8
	sta an_rx
	lda AN_BASE+9
	sta an_rx+1
	lda AN_BASE+10
	sta an_tx
	lda AN_BASE+11
	sta an_tx+1
	lda AN_BASE+3
	sta an_flags
	lda AN_BASE+24
	sta an_serr
	lda AN_BASE+14
	sta an_evmask
	lda AN_BASE+15
	sta an_evmask+1
	rts

an_evack
	stx AN_BASE+5
	sta AN_BASE+7
	rts

an_read
	jsr an_status
	mva an_rx an_av
	mva an_rx+1 an_av+1
	jsr an_min
	lda an_len
	ora an_len+1
	beq an_rdone
	lda an_len
	sta an_sx
	lda an_len+1
	sta an_tmp
	ldy #0
an_rl	lda AN_BASE+12
	sta (an_ptr),y
	inw an_ptr
	lda an_sx
	bne an_rl2
	dec an_tmp
an_rl2	dec an_sx
	lda an_sx
	ora an_tmp
	bne an_rl
an_rdone
	rts

an_write
	jsr an_status
	mva an_tx an_av
	mva an_tx+1 an_av+1
	jsr an_min
	lda an_len
	ora an_len+1
	beq an_wdone
	lda an_len
	sta an_sx
	lda an_len+1
	sta an_tmp
	ldy #0
an_wl	lda (an_ptr),y
	sta AN_BASE+12
	inw an_ptr
	lda an_sx
	bne an_wl2
	dec an_tmp
an_wl2	dec an_sx
	lda an_sx
	ora an_tmp
	bne an_wl
an_wdone
	rts

; presence check: C clear if an ACNet register window answers ($AC,'N')
an_init
	lda AN_BASE
	cmp #$ac
	bne an_absent
	lda AN_BASE+1
	cmp #$4e
	bne an_absent
	clc
	rts
an_absent
	sec
	rts

; IRQ support (register transport): VIMIRQ handlers get no saved registers from the OS, so the ISR saves A itself. The ISR latches the per-socket event bitmap into an_evm and masks the line until
; the foreground re-arms it with an_irq_arm after acknowledging (level-triggered, so nothing is lost).
an_irq_install
	sei
	lda $0217
	cmp #>an_isr
	bne an_ii1
	lda $0216
	cmp #<an_isr
	beq an_ii2
an_ii1	lda $0216
	sta an_oldirq
	lda $0217
	sta an_oldirq+1
	lda #<an_isr
	sta $0216
	lda #>an_isr
	sta $0217
	lda #1
	sta AN_BASE+13
an_ii2	cli
	rts

an_isr
	pha
	lda AN_BASE+3
	and #$40
	beq an_chain
	lda AN_BASE+14
	ora an_evm
	sta an_evm
	lda AN_BASE+15
	ora an_evm+1
	sta an_evm+1
	lda #0
	sta AN_BASE+13
	inc an_irqs
	pla
	rti
an_chain
	pla
	jmp (an_oldirq)

an_irq_arm
	lda #1
	sta AN_BASE+13
	rts

an_oldirq .word 0
an_evm .word 0
an_irqs .byte 0

.else
; ---- SIO transport -------------------------------------------------------------------------------------------------
an_sioc
	sta $0302
	stx $030a
	sty $030b
	lda #$65
	sta $0300
	lda #1
	sta $0301
	lda an_ds
	sta $0303
	lda an_bp
	sta $0304
	lda an_bp+1
	sta $0305
	lda an_bl
	sta $0308
	lda an_bl+1
	sta $0309
	lda #15
	sta $0306
	jsr $e459
	sty an_sioerr
	rts

an_sioerr .byte 0
an_xbuf .ds 16
an_sbuf .ds 32
an_rbuf .ds 256

an_cmd
	sta an_xbuf
	stx an_xbuf+1
	stx an_wx
	ldy #7
an_c1	lda an_arg,y
	sta an_xbuf+2,y
	dey
	bpl an_c1
	lda #$80
	sta an_ds
	mwa #an_xbuf an_bp
	mwa #16 an_bl
	lda #$c0
	ldx #0
	ldy #0
	jsr an_sioc
	ldx an_wx
	jsr an_status
	lda an_sbuf
	sta an_res
	lda an_sbuf+20
	sta an_cur
	ldy #7
an_c2	lda an_sbuf+12,y
	sta an_arg,y
	dey
	bpl an_c2
	lda an_res
	rts

an_status
	stx an_sx
	lda #$40
	sta an_ds
	mwa #an_sbuf an_bp
	mwa #32 an_bl
	ldx an_sx
	lda #$53
	ldy #0
	jsr an_sioc
	ldx an_sx
	lda an_sbuf+2
	sta an_sstat
	lda an_sbuf+3
	sta an_ev
	lda an_sbuf+4
	sta an_rx
	lda an_sbuf+5
	sta an_rx+1
	lda an_sbuf+6
	sta an_tx
	lda an_sbuf+7
	sta an_tx+1
	lda an_sbuf+8
	sta an_flags
	lda an_sbuf+9
	sta an_evmask
	lda an_sbuf+10
	sta an_evmask+1
	lda an_sbuf+11
	sta an_serr
	rts

an_evack
	pha
	lda #0
	sta an_ds
	sta an_bl
	sta an_bl+1
	pla
	tay
	lda #$c3
	jsr an_sioc
	rts

an_read
	stx an_wx
	jsr an_status
	mva an_rx an_av
	mva an_rx+1 an_av+1
	jsr an_cap254
	jsr an_min
	lda an_len
	ora an_len+1
	beq an_rdone
	lda #$40
	sta an_ds
	mwa #an_rbuf an_bp
	mwa #256 an_bl
	ldx an_wx
	ldy an_len
	lda #$c1
	jsr an_sioc
	lda an_rbuf
	sta an_len
	lda an_rbuf+1
	sta an_len+1
	ora an_len
	beq an_rdone
	lda an_len
	sta an_sx
	ldy #0
an_rl	lda an_rbuf+2,y
	sta (an_ptr),y
	iny
	cpy an_sx
	bne an_rl
	clc
	lda an_ptr
	adc an_sx
	sta an_ptr
	bcc an_rdone
	inc an_ptr+1
an_rdone
	rts

an_write
	stx an_wx
	jsr an_status
	mva an_tx an_av
	mva an_tx+1 an_av+1
	jsr an_cap254
	jsr an_min
	lda an_len
	ora an_len+1
	beq an_wdone
	lda an_len
	sta an_sx
	sta an_rbuf
	lda #0
	sta an_rbuf+1
	ldy #0
an_wl	lda (an_ptr),y
	sta an_rbuf+2,y
	iny
	cpy an_sx
	bne an_wl
	lda #$80
	sta an_ds
	mwa #an_rbuf an_bp
	mwa #256 an_bl
	ldx an_wx
	ldy #0
	lda #$c2
	jsr an_sioc
	clc
	lda an_ptr
	adc an_sx
	sta an_ptr
	bcc an_wdone
	inc an_ptr+1
an_wdone
	rts

an_cap254
	lda an_av+1
	bne an_cc
	lda an_av
	cmp #254
	bcc an_cdone
an_cc	lda #254
	sta an_av
	lda #0
	sta an_av+1
an_cdone
	rts

; presence check: C clear if the device answers status (a missing device makes SIO return an error)
an_init
	ldx #0
	jsr an_status
	lda an_sioerr
	cmp #1
	bne an_absent
	clc
	rts
an_absent
	sec
	rts
.endif

; ---- shared helpers --------------------------------------------------------------------------------------------------
an_min	; an_len = min(an_len, an_av)
	lda an_av+1
	cmp an_len+1
	bne an_m1
	lda an_av
	cmp an_len
an_m1	bcs an_m2
	mva an_av an_len
	mva an_av+1 an_len+1
an_m2	rts

; ---------------------------------------------------------------------------------------------------------------------
; Waiting. an_wait waits for (SSTAT & A) != 0 or an error on socket X; an_waitev waits on the event byte instead.
; Returns C set on timeout (an_tmo jiffies, 0 = forever), otherwise C clear with the status loaded (check an_sstat & AN_SS_ERR).
; The idle hook an_idlev is called every poll, which is where an OS with threads yields.
; ---------------------------------------------------------------------------------------------------------------------
an_wait
	ldy #0
	beq an_wgo
an_waitev
	ldy #1
an_wgo
	sta an_wm
	stx an_wx
	sty an_wmode
	lda $14
	sta an_t0
	lda $13
	sta an_t0+1
an_wloop
	ldx an_wx
	jsr an_status
	lda an_wmode
	bne an_wev
	lda an_wm
	ora #AN_SS_ERR
	and an_sstat
	bne an_wok
	beq an_wtime
an_wev
	lda an_wm
	ora #AN_EV_ERR
	and an_ev
	bne an_wok
an_wtime
	lda an_tmo
	ora an_tmo+1
	beq an_widle
	sec
	lda $14
	sbc an_t0
	sta an_tmp
	lda $13
	sbc an_t0+1
	cmp an_tmo+1
	bcc an_widle
	bne an_wto
	lda an_tmp
	cmp an_tmo
	bcc an_widle
an_wto
	sec
	rts
an_widle
	jsr an_idle
	jmp an_wloop
an_wok
	clc
	rts

an_idle	jmp (an_idlev)
an_nop	rts
an_idlev .word an_nop

; ---------------------------------------------------------------------------------------------------------------------
; Socket API (blocking helpers built on the primitives). Errors: C set, an_serr/an_res hold the reason.
; ---------------------------------------------------------------------------------------------------------------------
; stage the zero-terminated string at an_hp into the TX buffer of socket X
an_putstr
	stx an_wx
	ldy #0
an_ps1	lda (an_hp),y
	beq an_ps2
	iny
	bne an_ps1
an_ps2	sty an_len
	lda #0
	sta an_len+1
	mwa an_hp an_ptr
	ldx an_wx
	jmp an_write

; X <- new socket handle, C set on failure
an_alloc
	ldx #0
	lda #AN_C_ALLOC
	jsr an_cmd
	jne an_fail
	ldx an_cur
	clc
	rts
an_fail
	sec
	rts

; X=socket, an_hp=host (name or dotted IP), an_port; starts the connect, does not wait
an_connect
	stx an_wx
	jsr an_putstr
	ldx an_wx
	lda an_port
	sta an_arg
	lda an_port+1
	sta an_arg+1
	lda #AN_C_CONNECT
	jmp an_cmd

; alloc + connect + wait until open: X=socket, C set on error (an_serr) or timeout
an_tcp_open
	jsr an_alloc
	jcs an_fail
	stx an_sa
	jsr an_connect
	jne an_fail
	ldx an_sa
	lda #AN_SS_OPEN
	jsr an_wait
	jcs an_fail
	ldx an_sa
	lda an_sstat
	and #AN_SS_ERR
	jne an_fail
	clc
	rts

; X=socket, an_port: start listening (C set on error)
an_listen
	lda an_port
	sta an_arg
	lda an_port+1
	sta an_arg+1
	lda #AN_C_LISTEN
	jsr an_cmd
	jne an_fail
	clc
	rts

; X=listener: waits for a connection (honours an_tmo), then X=new socket and an_arg[0..5] = remote ip/port
an_accept
	stx an_sa
	lda #AN_SS_ACCEPT
	jsr an_wait
	jcs an_fail
	ldx an_sa
	lda #AN_C_ACCEPT
	jsr an_cmd
	jne an_fail
	ldx an_cur
	clc
	rts

an_close
	lda #AN_C_CLOSE
	jmp an_cmd

; X=socket: send everything an_ptr/an_len describe, blocking while the TX buffer is full. C set on error.
an_send_all
	stx an_sa
an_sa1	lda an_len
	ora an_len+1
	beq an_sdone
	lda an_len
	sta an_old
	lda an_len+1
	sta an_old+1
	ldx an_sa
	jsr an_write
	lda an_len
	ora an_len+1
	bne an_sprog
	lda an_old
	sta an_len
	lda an_old+1
	sta an_len+1
	ldx an_sa
	lda #AN_SS_TX
	jsr an_wait
	lda an_sstat
	and #AN_SS_ERR
	jne an_fail
	jmp an_sa1
an_sprog
	sec
	lda an_old
	sbc an_len
	sta an_len
	lda an_old+1
	sbc an_len+1
	sta an_len+1
	jmp an_sa1
an_sdone
	ldx an_sa
	lda #AN_C_FLUSH
	jsr an_cmd
	clc
	rts

; X=socket: wait for data or EOF/error, then read up to an_len bytes. C set when closed with no data (an_len = 0)
an_recv
	stx an_sa
	lda #AN_SS_RX|AN_SS_EOF
	jsr an_wait
	jcs an_fail
	ldx an_sa
	jsr an_read
	lda an_len
	ora an_len+1
	bne an_rv1
	sec
	rts
an_rv1	clc
	rts

; DNS: an_hp=name -> an_ip[0..3]. C set on failure (an_serr: 4 dns, 7 NXDOMAIN)
an_dns
	ldx #0
	jsr an_putstr
	ldx #0
	lda #AN_C_DNS
	jsr an_cmd
	jne an_fail
	ldx #0
	lda #AN_EV_CONN
	jsr an_waitev
	jcs an_fail
	lda an_ev
	and #AN_EV_ERR
	jne an_dnserr
	mwa #an_ip an_ptr
	mwa #4 an_len
	ldx #0
	jsr an_read
	ldx #0
	lda #$ff
	jsr an_evack
	clc
	rts
an_dnserr
	ldx #0
	lda #$ff
	jsr an_evack
	sec
	rts

; ping an_ip[0..3] -> an_rtt (ms). C set on timeout
an_ping
	ldy #3
an_pg1	lda an_ip,y
	sta an_arg,y
	dey
	bpl an_pg1
	ldx #0
	lda #AN_C_PING
	jsr an_cmd
	jne an_fail
	ldx #0
	lda #AN_EV_CONN
	jsr an_waitev
	jcs an_fail
	lda an_ev
	and #AN_EV_ERR
	jne an_dnserr
	mwa #an_rtt an_ptr
	mwa #2 an_len
	ldx #0
	jsr an_read
	ldx #0
	lda #$ff
	jsr an_evack
	clc
	rts

; UDP: an_udp_open X <- socket (an_port = local port, 0 = ephemeral); an_udp_to sets the peer from an_ip/an_port;
; send a datagram with an_write then an_flush; receive one datagram per an_read/an_recv.
an_udp_open
	jsr an_alloc
	jcs an_fail
	stx an_sa
	lda an_port
	sta an_arg
	lda an_port+1
	sta an_arg+1
	lda #AN_C_UDPOPEN
	jsr an_cmd
	jne an_fail
	ldx an_sa
	lda #AN_SS_OPEN
	jsr an_wait
	ldx an_sa
	clc
	rts

an_udp_to
	ldy #3
an_ut1	lda an_ip,y
	sta an_arg,y
	dey
	bpl an_ut1
	lda an_port
	sta an_arg+4
	lda an_port+1
	sta an_arg+5
	lda #AN_C_UDPPEER
	jmp an_cmd

an_flush
	lda #AN_C_FLUSH
	jmp an_cmd

; copy 26 bytes of NETINFO (mac6 ip4 mask4 gw4 dns1 4 dns2 4) to the address in an_ptr
an_netinfo
	ldx #0
	lda #AN_C_NETINFO
	jsr an_cmd
	jne an_fail
	mwa #26 an_len
	ldx #0
	jsr an_read
	clc
	rts

an_arg   .ds 8
an_sstat .byte 0
an_ev    .byte 0
an_rx    .word 0
an_tx    .word 0
an_flags .byte 0
an_serr  .byte 0
an_evmask .word 0
an_ip    .ds 4
an_rtt   .word 0
