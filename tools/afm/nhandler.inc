; N: CIO handler for FujiNet-style network devices (N1:-N4:).  Included by AFM (and nhandler.asm for a
; standalone N: handler).  Talks SIO to device $71+unit-1 (DUNIT 1) like the real FujiNet handler:
;   open  $4F (256-byte spec, AUX1/AUX2 = CIO aux)     close $43      status $53 (4 bytes -> DVSTAT)
;   read  $52 (len)        write $57 (len)             special: $FF asks the direction, then the XIO number
;                                                      itself is the SIO command (32 rename, 33 delete, 42 mkdir ...)
; One 256-byte buffer per unit is used for reading (filled from the status byte count) or writing
; (flushed on EOL, when full, and on close).  Reading and writing on the same channel (mode 12) is not mixed.
; nh_install adds 'N' to HATABS if no N: handler exists (carry set = one already exists);
; nh_remove takes it out again.  Needs HORG (load address) defined before the include.

NH_SIOV  = $E459
NH_DDEVIC = $0300
NH_DUNIT = $0301
NH_DCOMND = $0302
NH_DSTATS = $0303
NH_DBUFLO = $0304
NH_DBUFHI = $0305
NH_DTIMLO = $0306
NH_DBYTLO = $0308
NH_DBYTHI = $0309
NH_DAUX1 = $030A
NH_DAUX2 = $030B
NH_DVSTAT = $02EA
NH_HATABS = $031A
NH_ICDNOZ = $21
NH_ICCOMZ = $22
NH_ICBALZ = $24
NH_ICAX1Z = $2A
NH_ICAX2Z = $2B
NH_BRKKEY = $11

nh_table:
        .word nh_open-1, nh_close-1, nh_get-1, nh_put-1, nh_stat-1, nh_spec-1
        jmp nh_init
nh_init: rts

nh_slot: .byte $FF      ; HATABS offset we installed at ($FF = not installed by us)
nh_cu:  .byte 0         ; current unit index 0-3
nh_n:   .byte 0
nh_b:   .byte 0
nh_ds:  .byte 0
nh_cmd: .byte 0
nh_cerr: .byte 1
nh_mode: .byte 0,0,0,0
nh_pos: .byte 0,0,0,0
nh_len: .byte 0,0,0,0

; ---- nh_install: C=0 installed, C=1 an N: handler is already present
nh_install:
        ldx #0
nhi_l:  lda NH_HATABS,x
        beq nhi_free
        cmp #'N'
        beq nhi_have
        inx
        inx
        inx
        cpx #$21
        bcc nhi_l
nhi_have: sec
        rts
nhi_free: cpx #$21
        bcs nhi_have
        lda #'N'
        sta NH_HATABS,x
        lda #<nh_table
        sta NH_HATABS+1,x
        lda #>nh_table
        sta NH_HATABS+2,x
        stx nh_slot
        clc
        rts

nh_remove:
        ldx nh_slot
        cpx #$FF
        beq nhr_x
        lda NH_HATABS,x
        cmp #'N'
        bne nhr_x
        lda #0
        sta NH_HATABS,x
        sta NH_HATABS+1,x
        sta NH_HATABS+2,x
        lda #$FF
        sta nh_slot
nhr_x:  rts

; ---- helpers
nh_getu: lda NH_ICDNOZ
        bne nhg_a
        lda #1
nhg_a:  sec
        sbc #1
        and #3
        sta nh_cu
        rts

; SIO call for the current unit; DCOMND/DSTATS/DBUF/DBYT/DAUX already set.  Y = status ($01 = ok)
nh_call: lda nh_cu
        clc
        adc #$71
        sta NH_DDEVIC
        lda #1
        sta NH_DUNIT
        lda #$1F
        sta NH_DTIMLO
        jsr NH_SIOV
        ldy NH_DSTATS
        cpy #1
        rts

; SIO setup helpers (A = command; the rest are in the callers)
nh_status: lda #$53
        sta NH_DCOMND
        lda #$40
        sta NH_DSTATS
        lda #<NH_DVSTAT
        sta NH_DBUFLO
        lda #>NH_DVSTAT
        sta NH_DBUFHI
        lda #4
        sta NH_DBYTLO
        lda #0
        sta NH_DBYTHI
        sta NH_DAUX1
        sta NH_DAUX2
        jmp nh_call

; after a failed SIO call: ask the device for its error code and return it in Y
nh_err: jsr nh_status
        bne nhe_g
        ldy NH_DVSTAT+3
        cpy #$80
        bcs nhe_x
nhe_g:  ldy #144
nhe_x:  rts

; copy the caller's EOL-terminated spec (ICBALZ) to nh_specb
nh_cpspec: ldy #0
nhc_l:  lda (NH_ICBALZ),y
        sta nh_specb,y
        cmp #$9B
        beq nhc_x
        iny
        bne nhc_l
        dey
        lda #$9B
        sta nh_specb,y
nhc_x:  rts

; set DBUF to this unit's data buffer
nh_setbuf: lda #0
        sta NH_DBUFLO
        lda #>nh_bufs
        clc
        adc nh_cu
        sta NH_DBUFHI
        rts

; ---- OPEN
nh_open: jsr nh_getu
        jsr nh_cpspec
        lda #$4F
        sta NH_DCOMND
        lda #$80
        sta NH_DSTATS
        lda #<nh_specb
        sta NH_DBUFLO
        lda #>nh_specb
        sta NH_DBUFHI
        lda #0
        sta NH_DBYTLO
        lda #1
        sta NH_DBYTHI
        lda NH_ICAX1Z
        sta NH_DAUX1
        lda NH_ICAX2Z
        sta NH_DAUX2
        jsr nh_call
        beq nho_ok
        jmp nh_err
nho_ok: ldx nh_cu
        lda NH_ICAX1Z
        sta nh_mode,x
        lda #0
        sta nh_pos,x
        sta nh_len,x
        ldy #1
        rts

; ---- GET BYTE
nh_get: jsr nh_getu
        ldx nh_cu
        lda nh_pos,x
        cmp nh_len,x
        bcc nhg_have
        jsr nh_fill
        cpy #1
        bne nhg_ret
        ldx nh_cu
nhg_have: lda #>nh_bufs
        clc
        adc nh_cu
        sta nhg_ld+2
        ldy nh_pos,x
nhg_ld: lda nh_bufs,y
        inc nh_pos,x
        ldy #1
nhg_ret: rts

; refill the unit's buffer from the device: Y=1 ok, else an error code (136 = end of file)
nh_fill: jsr nh_status
        beq nhf_s
        jmp nh_err
nhf_s:  lda NH_DVSTAT+1
        bne nhf_big
        lda NH_DVSTAT
        beq nhf_none
        bne nhf_go
nhf_big: lda #255
nhf_go: sta nh_n
        lda #$52
        sta NH_DCOMND
        lda #$40
        sta NH_DSTATS
        jsr nh_setbuf
        lda nh_n
        sta NH_DBYTLO
        sta NH_DAUX1
        lda #0
        sta NH_DBYTHI
        sta NH_DAUX2
        jsr nh_call
        beq nhf_r
        jmp nh_err
nhf_r:  ldx nh_cu
        lda #0
        sta nh_pos,x
        lda nh_n
        sta nh_len,x
        ldy #1
        rts
nhf_none: lda NH_DVSTAT+3
        cmp #1
        bne nhf_ec
        lda NH_DVSTAT+2
        bne nhf_wait
        ldy #136
        rts
nhf_ec: tay
        cpy #$80
        bcs nhf_ex
        ldy #144
nhf_ex: rts
nhf_wait: lda NH_BRKKEY
        bne nhf_again
        ldy #$80
        rts
nhf_again: jmp nh_fill

; ---- PUT BYTE
nh_put: sta nh_b
        jsr nh_getu
        ldx nh_cu
        lda #>nh_bufs
        clc
        adc nh_cu
        sta nhp_st+2
        ldy nh_len,x
        lda nh_b
nhp_st: sta nh_bufs,y
        inc nh_len,x
        lda nh_b
        cmp #$9B
        beq nhp_fl
        lda nh_len,x
        cmp #255
        bne nhp_ok
nhp_fl: jmp nh_flush
nhp_ok: ldy #1
        rts

nh_flush: ldx nh_cu
        lda nh_len,x
        beq nhfl_ok
        sta nh_n
        lda #$57
        sta NH_DCOMND
        lda #$80
        sta NH_DSTATS
        jsr nh_setbuf
        lda nh_n
        sta NH_DBYTLO
        sta NH_DAUX1
        lda #0
        sta NH_DBYTHI
        sta NH_DAUX2
        jsr nh_call
        ldx nh_cu
        lda #0
        sta nh_len,x
        cpy #1
        beq nhfl_ok
        jmp nh_err
nhfl_ok: ldy #1
        rts

; ---- CLOSE
nh_close: jsr nh_getu
        lda #1
        sta nh_cerr
        ldx nh_cu
        lda nh_mode,x
        and #8
        beq nhcl_c
        jsr nh_flush
        sty nh_cerr
nhcl_c: lda #$43
        sta NH_DCOMND
        lda #0
        sta NH_DSTATS
        sta NH_DBYTLO
        sta NH_DBYTHI
        sta NH_DAUX1
        sta NH_DAUX2
        jsr nh_call
        beq nhcl_d
        jsr nh_err
        sty nh_cerr
nhcl_d: ldx nh_cu
        lda #0
        sta nh_len,x
        sta nh_pos,x
        sta nh_mode,x
        ldy nh_cerr
        rts

; ---- STATUS
nh_stat: jsr nh_getu
        jsr nh_status
        beq nhs_ok
        rts
nhs_ok: ldy #1
        rts

; ---- SPECIAL (XIO)
nh_spec: jsr nh_getu
        lda NH_ICCOMZ
        sta nh_cmd
        lda #$FF
        sta NH_DCOMND
        lda #$40
        sta NH_DSTATS
        lda #<nh_b
        sta NH_DBUFLO
        lda #>nh_b
        sta NH_DBUFHI
        lda #1
        sta NH_DBYTLO
        lda #0
        sta NH_DBYTHI
        sta NH_DAUX2
        lda nh_cmd
        sta NH_DAUX1
        jsr nh_call
        beq nhx_q
        jmp nh_err
nhx_q:  lda nh_b
        sta nh_ds
        cmp #$80
        bne nhx_nw
        jsr nh_cpspec
nhx_nw: lda nh_cmd
        sta NH_DCOMND
        lda nh_ds
        sta NH_DSTATS
        lda #<nh_specb
        sta NH_DBUFLO
        lda #>nh_specb
        sta NH_DBUFHI
        lda #0
        sta NH_DBYTLO
        lda nh_ds
        beq nhx_nd
        lda #1
nhx_nd: sta NH_DBYTHI
        lda NH_ICAX1Z
        sta NH_DAUX1
        lda NH_ICAX2Z
        sta NH_DAUX2
        jsr nh_call
        beq nhx_ok
        jmp nh_err
nhx_ok: lda nh_ds
        cmp #$40
        bne nhx_dn
        ldy #0
nhx_cp: lda nh_specb,y
        sta (NH_ICBALZ),y
        cmp #$9B
        beq nhx_dn
        iny
        cpy #255
        bne nhx_cp
nhx_dn: ldy #1
        rts

; work area (not part of the file): the spec buffer, then four page-aligned 256-byte data buffers
nh_specb = *
nh_bufs = (nh_specb+256+255)&$FF00
nh_end  = nh_bufs+1024
