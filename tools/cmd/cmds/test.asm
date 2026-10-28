; test.asm - hardware diagnostics: MEMTEST, KEYTEST, INPUT, COLOR, MONITOR.

SKSTAT  = $D20F
KBCODE  = $D209
CONSOL  = $D01F
COLBK   = $D01A
WSYNC   = $D40A
NMIEN   = $D40E
TRIG2   = $D012
ROWCRS  = $54
COLCRS  = $55
SAVMSC  = $58
BRKKEY  = $11
VDSLST  = $0200
SDLSTL  = $0230
COLOR0  = $02C4
STICK0  = $0278
STRIG0  = $0284
PADDL0  = $0270
PTRIG0  = $027C
RTI_OP  = $40

copyrt:
        ldx #0
crt1:   lda rtimg,x
        sta $0500,x
        lda rtimg+256,x
        sta $0600,x
        inx
        bne crt1
        rts
rtimg:  ins 'bin\rt.bin',6

; ================= MEMTEST =================
; V_A0 original PORTB, V_A0+1 bank PORTB, V_A0+2/3 error bytes, V_A0+4 bad count,
; V_A1 bank loop index, V_A2 unique bank count, SCR unique bank numbers
cmd_memtest:
        jsr copyrt
        jsr putsi
        .byte 'MEMORY TEST - CONTENTS ARE KEPT',EOL,0
        lda PORTB
        sta V_A0
        lda #0
        sta V_A0+4
        sta V_A2
        jsr putsi
        .byte 'MAIN RAM ',0
        lda RAMTOP
        sec
        sbc #5
        sta N4
        cmp #$81
        bcc mt_nomain
        lda V_A0
        sta T0
        lda #$80
        sta N1
        jsr $0503
        bcs mt_mbad
        lda N4
        sec
        sbc #$80
        lsr
        lsr
        sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsi
        .byte 'K ABOVE $8000 OK',EOL,0
        jmp mt_ext
mt_mbad:
        jsr mt_perr
        jmp mt_ext
mt_nomain:
        jsr putsi
        .byte 'SKIPPED',EOL,0
mt_ext: jsr putsi
        .byte 'EXTENDED RAM ',0
        jsr $0500
        lda N4
        beq mt_has
        jsr putsi
        .byte 'NONE FOUND',EOL,0
        clc
        rts
mt_has: ldx #0
        ldy #0
mt_u:   txa
        eor #$5A
        cmp $0400,x
        bne mt_un
        txa
        sta SCR,y
        iny
mt_un:  inx
        cpx #64
        bne mt_u
        sty V_A2
        sty N0
        lda #0
        sta N1
        ldx #4
mt_k:  asl N0
        rol N1
        dex
        bne mt_k
        jsr putdec16
        jsr putsi
        .byte 'K IN ',0
        lda V_A2
        sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' BANKS',EOL,0
        lda #0
        sta V_A1
mt_b:   ldx V_A1
        lda V_A0
        sta T1
        lda SCR,x
        jsr $0509
        sta V_A0+1
        sta T0
        lda #$40
        sta N1
        lda #$80
        sta N4
        jsr $0503
        bcs mt_bpg
        lda V_A0+1
        sta T0
        jsr $0506
        bcs mt_badr
        lda #'.'
        jsr putc
        jmp mt_nx
mt_bpg: jsr mt_bhd
        jsr mt_perr
        jmp mt_nx
mt_badr:
        lda N2
        sta V_A0+2
        lda N3
        sta V_A0+3
        jsr mt_bhd
        jsr putsi
        .byte 'ADDRESS LINE AT $',0
        lda T1+1
        ldx #0
        jsr mt_h
        lda T0+1
        jsr puthex8
        jsr mt_ew
        inc V_A0+4
mt_nx:  inc V_A1
        lda V_A1
        cmp V_A2
        bne mt_b
        jsr putnl
        lda V_A0+4
        bne mt_fin
        jsr putsi
        .byte 'ALL BANKS PASSED',EOL,0
        clc
        rts
mt_fin: sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' BAD',EOL,0
        clc
        rts

mt_h:   jmp puthex8

mt_bhd: jsr putnl
        jsr putsi
        .byte 'BANK ',0
        ldx V_A1
        lda SCR,x
        sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsp1
        rts
putsp1: lda #' '
        jmp putc

; data error in N1:N0, wrote N2, read N3
mt_perr:
        lda N2
        sta V_A0+2
        lda N3
        sta V_A0+3
        jsr putsi
        .byte 'BAD AT $',0
        lda N1
        jsr puthex8
        lda N0
        jsr puthex8
        inc V_A0+4
mt_ew:  jsr putsi
        .byte ' (WROTE $',0
        lda V_A0+2
        jsr puthex8
        jsr putsi
        .byte ' READ $',0
        lda V_A0+3
        jsr puthex8
        jsr putsi
        .byte ')',EOL,0
        rts

; ================= KEYTEST =================
; V_A0 keys seen, V_A1 raw key, V_A1+1 last raw, SCR 8 byte mask
cmd_keytest:
        jsr putsi
        .byte 'KEYBOARD TEST - PRESS EVERY KEY',EOL
        .byte 'HOLD START+SELECT+OPTION TO QUIT',EOL,0
        lda #0
        sta V_A0
        ldx #7
kt_c:   sta SCR,x
        dex
        bpl kt_c
        lda #$FF
        sta V_A1+1
kt_l:   lda #1
        sta BRKKEY
        lda #0
        sta ATRACT
        lda #$FF
        sta CH
        lda CONSOL
        and #7
        jeq kt_end
        lda SKSTAT
        and #4
        beq kt_dn
        lda #$FF
        sta V_A1+1
        jmp kt_l
kt_dn:  lda KBCODE
        cmp V_A1+1
        beq kt_l
        sta V_A1
        sta V_A1+1
        and #$3F
        asl
        asl
        tax
        lda kt_names,x
        cmp #'?'
        beq kt_pr
        lda V_A1
        and #$3F
        pha
        lsr
        lsr
        lsr
        tax
        pla
        and #7
        tay
        lda kt_bit,y
        and SCR,x
        bne kt_pr
        lda kt_bit,y
        ora SCR,x
        sta SCR,x
        inc V_A0
kt_pr:  jsr putsi
        .byte 'KEY $',0
        lda V_A1
        and #$3F
        jsr puthex8
        jsr putsp1
        lda V_A1
        and #$3F
        asl
        asl
        tax
        ldy #4
kt_n:   lda kt_names,x
        jsr putc
        inx
        dey
        bne kt_n
        lda V_A1
        and #$40
        beq kt_ns
        jsr putsi
        .byte ' SHIFT',0
kt_ns:  lda V_A1
        bpl kt_nc
        jsr putsi
        .byte ' CTRL',0
kt_nc:  jsr putsp1
        lda V_A0
        sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsi
        .byte '/58',EOL,0
        jmp kt_l
kt_end: lda #$FF
        sta CH
        jsr putnl
        lda V_A0
        sta N0
        lda #0
        sta N1
        jsr putdec16
        jsr putsi
        .byte ' OF 58 KEYS SEEN',EOL,0
        lda V_A0
        cmp #58
        bcs kt_done
        jsr putsi
        .byte 'NOT PRESSED:',0
        ldx #0
kt_m:   stx V_A1
        txa
        asl
        asl
        tay
        lda kt_names,y
        cmp #'?'
        beq kt_mn
        txa
        lsr
        lsr
        lsr
        tay
        txa
        and #7
        tax
        lda kt_bit,x
        and SCR,y
        bne kt_mn
        jsr putsp1
        lda V_A1
        asl
        asl
        tax
        lda kt_names,x
        jsr putc
        lda kt_names+1,x
        cmp #' '
        beq kt_mn
        jsr putc
        lda kt_names+2,x
        cmp #' '
        beq kt_mn
        jsr putc
        lda kt_names+3,x
        cmp #' '
        beq kt_mn
        jsr putc
kt_mn:  ldx V_A1
        inx
        cpx #64
        bne kt_m
        jsr putnl
kt_done:
        clc
        rts
kt_bit: .byte 1,2,4,8,16,32,64,128
kt_names:
        .byte 'L   ','J   ',$3B,' ',' ',' ','F1  ','F2  ','K   ','+   ','*   '
        .byte 'O   ','????','P   ','U   ','RET ','I   ','-   ','=   '
        .byte 'V   ','HELP','C   ','F3  ','F4  ','B   ','X   ','Z   '
        .byte '4   ','????','3   ','6   ','ESC ','5   ','2   ','1   '
        .byte ',   ','SPC ','.   ','N   ','????','M   ','/   ','INV '
        .byte 'R   ','????','E   ','Y   ','TAB ','T   ','W   ','Q   '
        .byte '9   ','????','0   ','7   ','BS  ','8   ','<   ','>   '
        .byte 'F   ','H   ','D   ','????','CAPS','G   ','S   ','A   '

; ================= INPUT =================
; V_A0 = 1 when the argument asks for ports 3 and 4 (400/800 only)
cmd_input:
        lda #0
        sta V_A0
        jsr nexttok
        beq in_go
        lda TOK
        cmp #'4'
        bne in_go
        inc V_A0
in_go:  lda #$7D
        jsr putc
        jsr putsi
        .byte 'INPUT TEST - ANY KEY QUITS',EOL,EOL,0
        lda #1
        sta CRSINH
        lda #$FF
        sta CH
in_f:   lda RTCLOK+2
in_w:   cmp RTCLOK+2
        beq in_w
        lda #0
        sta ATRACT
        lda CH
        cmp #$FF
        jne in_q
        lda #3
        sta ROWCRS
        lda #0
        sta COLCRS
        sta COLCRS+1
        ldx #0
in_j:   stx V_A1
        jsr putsi
        .byte 'JOY ',0
        lda V_A1
        clc
        adc #'1'
        jsr putc
        jsr putsp1
        ldx V_A1
        lda STICK0,x
        ldy STRIG0,x
        jsr in_st
        jsr putnl
        ldx V_A1
        inx
        cpx #2
        bne in_j
        lda V_A0
        beq in_p
        jsr putsi
        .byte 'JOY 3 ',0
        lda PORTB
        ldy TRIG2
        jsr in_st
        jsr putnl
        jsr putsi
        .byte 'JOY 4 ',0
        lda PORTB
        lsr
        lsr
        lsr
        lsr
        ldy TRIG2+1
        jsr in_st
        jsr putnl
in_p:   jsr putnl
        ldx #0
in_pd:  stx V_A1
        jsr putsi
        .byte 'PADDLE ',0
        lda V_A1
        clc
        adc #'0'
        jsr putc
        jsr putsp1
        ldx V_A1
        lda PADDL0,x
        jsr puthex8
        jsr putsp1
        ldx V_A1
        lda PTRIG0,x
        jsr in_fire
        jsr putsi
        .byte '  ',0
        lda V_A1
        and #1
        beq in_pn
        jsr putnl
in_pn:  ldx V_A1
        inx
        cpx #8
        bne in_pd
        jsr putnl
        lda CONSOL
        sta V_A1
        jsr putsi
        .byte 'CONSOLE ',0
        lda V_A1
        ldx #0
        and #1
        jsr in_c
        lda V_A1
        ldx #6
        and #2
        jsr in_c
        lda V_A1
        ldx #12
        and #4
        jsr in_c
        jsr putnl
        jmp in_f
in_q:   jsr getkey
        lda #0
        sta CRSINH
        lda #$7D
        jsr putc
        clc
        rts

; A = direction bits (0 = pressed), Y = trigger (0 = pressed)
in_st:  sty V_A1+1
        sta V_A2
        ldy #0
in_d:   lda V_A2
        and in_b,y
        bne in_dn
        lda in_l,y
        jmp in_dp
in_dn:  lda #'-'
in_dp:  jsr putc
        jsr putsp1
        iny
        cpy #4
        bne in_d
        lda V_A1+1
in_fire:
        bne in_fn
        lda #'F'
        jmp putc
in_fn:  lda #'-'
        jmp putc
in_b:   .byte 1,2,4,8
in_l:   .byte 'UDLR'

; A = 0 when the console key is down, X = offset into the name list
in_c:   bne in_cn
        lda in_nm,x
        jsr putc
        lda in_nm+1,x
        jsr putc
        lda in_nm+2,x
        jsr putc
        lda in_nm+3,x
        jsr putc
        lda in_nm+4,x
        jsr putc
        lda in_nm+5,x
        jmp putc
in_cn:  ldy #6
in_cl:  lda #'-'
        jsr putc
        dey
        bne in_cl
        rts
in_nm:  .byte 'START ','SELECT','OPTION'

; ================= graphics screens =================
; V_A0 current pattern, V_A0+1 last pattern + 1
cmd_color:
        lda #2
        ldx #4
        jmp gx_seq
cmd_monitor:
        lda #0
        ldx #4
gx_seq: sta V_A0
        stx V_A0+1
        lda RAMTOP
        cmp #$BC
        bcs gx_ok
        lda #147
        sta V_ERR
        sec
        rts
gx_ok:  jsr putsi
        .byte 'ANY KEY = NEXT, ESC = QUIT',EOL,0
        lda #$FF
        sta CH
        jsr getkey
gx_nx:  lda V_A0
        jsr gx_show
        lda #$FF
        sta CH
gx_wt:  lda #0
        sta ATRACT
        lda CH
        cmp #$FF
        beq gx_wt
        jsr getkey
        cmp #$1B
        beq gx_fin
        inc V_A0
        lda V_A0
        cmp V_A0+1
        bne gx_nx
gx_fin: lda #$40
        sta NMIEN
        lda #<gx_rti
        sta VDSLST
        lda #>gx_rti
        sta VDSLST+1
        lda #0
        jsr gx_open
        ldx #$60
        lda #12
        sta ICCOM,x
        jsr CIOV
        lda #0
        sta CRSINH
        lda #$7D
        jsr putc
        clc
        rts
gx_rti: rti

; open S: on IOCB 6 in graphics mode A with no text window
gx_open:
        pha
        lda #$40
        sta NMIEN
        ldx #$60
        lda #12
        sta ICCOM,x
        jsr CIOV
        pla
        clc
        adc #16
        sta ICAX2+$60
        lda #3
        sta ICCOM+$60
        lda #<gx_s
        sta ICBAL+$60
        lda #>gx_s
        sta ICBAH+$60
        lda #$0C
        sta ICAX1+$60
        lda #0
        sta ICBLL+$60
        sta ICBLH+$60
        ldx #$60
        jmp CIOV
gx_s:   .byte 'S:',EOL

gx_col: ; A = c0 value, X = c1/c2 value, Y = background
        sta COLOR0
        stx COLOR0+1
        stx COLOR0+2
        sty COLOR0+4
        rts

gx_show:
        cmp #1
        jeq gx_focus
        cmp #2
        jeq gx_ramp
        cmp #3
        jeq gx_pal
; ---- 0: geometry grid and circle
        lda #15
        jsr gx_open
        lda #$0E
        ldx #$34
        ldy #$00
        jsr gx_col
        ldy #39
        lda #0
gx_g0:  sta SCR,y
        lda #$55
        sta IOBUF,y
        lda #0
        dey
        bpl gx_g0
        lda #0
gx_g1:  sta V_A2
        jsr gx_p1
        lda V_A2
        clc
        adc #10
        cmp #160
        bcc gx_g1
        lda #159
        jsr gx_p1
        lda SAVMSC
        sta T0
        lda SAVMSC+1
        sta T0+1
        lda #0
        sta V_A1
gx_g2:  lda #<SCR
        sta T1
        lda #>SCR
        sta T1+1
        lda V_A1
        and #15
        beq gx_gh
        lda V_A1
        cmp #191
        bne gx_gc
gx_gh:  lda #<IOBUF
        sta T1
        lda #>IOBUF
        sta T1+1
gx_gc:  ldy #39
gx_gl:  lda (T1),y
        sta (T0),y
        dey
        bpl gx_gl
        jsr gx_nxt
        inc V_A1
        lda V_A1
        cmp #192
        bne gx_g2
        lda SAVMSC
        sta T0
        lda SAVMSC+1
        sta T0+1
        lda #0
        sta V_A1
gx_c1:  lda V_A1
        cmp #96
        bcs gx_c2
        lda #96
        sec
        sbc V_A1
        jmp gx_c3
gx_c2:  sec
        sbc #96
gx_c3:  cmp #91
        bcs gx_c9
        tax
        lda gx_hw,x
        sta N4
        lda gx_hw+1,x
        sta N5
        lda #80
        sec
        sbc N4
        sta N2
        lda #80
        sec
        sbc N5
        sta N3
        jsr gx_run
        lda #80
        clc
        adc N5
        sta N2
        lda #80
        clc
        adc N4
        sta N3
        jsr gx_run
gx_c9:  jsr gx_nxt
        inc V_A1
        lda V_A1
        cmp #192
        bne gx_c1
        rts

; set pixel x (A) to colour 1 in the SCR pattern
gx_p1:  pha
        lsr
        lsr
        tay
        pla
        and #3
        tax
        lda gx_m1,x
        ora SCR,y
        sta SCR,y
        ldx #0
        rts
; plot pixel x (A) with colour 2 on the row at T0
gx_pl:  pha
        lsr
        lsr
        tay
        pla
        and #3
        tax
        lda gx_m2,x
        ora (T0),y
        sta (T0),y
        rts
gx_run: lda N2
        jsr gx_pl
        lda N2
        cmp N3
        beq gx_rd
        inc N2
        jmp gx_run
gx_rd:  rts
; T0 += 40
gx_nxt: lda T0
        clc
        adc #40
        sta T0
        bcc gx_nr
        inc T0+1
gx_nr:  rts
gx_m1:  .byte $40,$10,$04,$01
gx_m2:  .byte $80,$20,$08,$02
gx_hw:
        icl 'lib\circ.inc'

; ---- 1: focus / pixel checker
gx_focus:
        lda #8
        jsr gx_open
        lda #$0F
        ldx #$00
        ldy #$00
        jsr gx_col
        lda #$0F
        sta COLOR0+1
        lda #$00
        sta COLOR0+2
        lda SAVMSC
        sta T0
        lda SAVMSC+1
        sta T0+1
        lda #0
        sta V_A1
gx_f1:  lda V_A1
        and #1
        beq gx_f2
        lda #$55
        jmp gx_f3
gx_f2:  lda #$AA
gx_f3:  ldy #39
gx_f4:  sta (T0),y
        dey
        bpl gx_f4
        jsr gx_nxt
        inc V_A1
        lda V_A1
        cmp #192
        bne gx_f1
        rts

; ---- 2: sixteen grey levels
gx_ramp:
        lda #9
        jsr gx_open
        lda #0
        sta COLOR0+4
        jsr gx_bars
        jmp gx_fillscr

; ---- 3: sixteen hues in eight luminance bands
gx_pal: lda #11
        jsr gx_open
        lda #1
        sta COLOR0+4
        jsr gx_bars
        jsr gx_fillscr
        lda SDLSTL
        sta T0
        lda SDLSTL+1
        sta T0+1
        ldy #3
        ldx #25
gx_w:   lda (T0),y
        cmp #$41
        beq gx_wd
        dex
        bne gx_wn
        ora #$80
        sta (T0),y
        ldx #24
gx_wn:  and #$40
        beq gx_w1
        iny
        iny
gx_w1:  iny
        bne gx_w
gx_wd:  lda #0
        sta gx_n
        lda #<gx_dli
        sta VDSLST
        lda #>gx_dli
        sta VDSLST+1
        lda #$C0
        sta NMIEN
        rts
gx_n:   .byte 0
gx_lt:  .byte 3,5,7,9,11,13,15
gx_dli: pha
        txa
        pha
        ldx gx_n
        lda gx_lt,x
        sta WSYNC
        sta COLBK
        inx
        cpx #7
        bcc gx_d1
        ldx #0
gx_d1:  stx gx_n
        pla
        tax
        pla
        rti

; SCR = one row of 16 bars, 5 pixels each, two pixels per byte
gx_bars:
        ldy #0
gb_l:   tya
        asl
        jsr gx_d5
        asl
        asl
        asl
        asl
        sta N2
        tya
        asl
        clc
        adc #1
        jsr gx_d5
        ora N2
        sta SCR,y
        iny
        cpy #40
        bne gb_l
        rts
gx_d5:  ldx #0
gd_l:   cmp #5
        bcc gd_d
        sbc #5
        inx
        bne gd_l
gd_d:   txa
        rts

; copy SCR into all 192 rows
gx_fillscr:
        lda SAVMSC
        sta T0
        lda SAVMSC+1
        sta T0+1
        lda #0
        sta V_A1
gf_r:   ldy #39
gf_c:   lda SCR,y
        sta (T0),y
        dey
        bpl gf_c
        jsr gx_nxt
        inc V_A1
        lda V_A1
        cmp #192
        bne gf_r
        rts
