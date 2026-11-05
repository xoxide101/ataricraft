; Overlay copy routines. Lives at $96A0, outside the $4000-$7FFF bank window and outside the slot, so it
; keeps running while bank 2 is mapped. The bank window and the slot overlap in address space, so every
; page goes bank -> LDB (bank mapped) -> slot (bank unmapped). Interrupts are masked meanwhile.
ovlp dta b(0)                  ; pages left
ovpb dta b(0)                  ; PORTB to restore

; bank 2 (PORTB bits 2-3 = 10, bit 4 = 0: CPU sees the bank)
ovlsw
 ldx ovrq
 lda ovbp,x
 sta ov1+2
 lda ovnp,x
 sta ovlp
 lda #>SLA
 sta ov2+2
 sei
 lda #0
 sta NMIEN
 lda PORTB
 sta ovpb
ovl1 and #$E3
 ora #$08
 sta PORTB
 ldy #0
ov1 lda $4000,y
 sta LDB,y
 iny
 bne ov1
 lda ovpb
 sta PORTB
 ldy #0
ov3 lda LDB,y
ov2 sta SLA,y
 iny
 bne ov3
 inc ov1+2
 inc ov2+2
 dec ovlp
 bne ovl1x
 lda ovrq
 sta ovid
 lda #$C0
 sta NMIEN
 cli
 rts
ovl1x lda ovpb
 jmp ovl1

; startup: copy the staged images (page aligned at ovsp) into bank 2, packing them from $4000 up
ovstage
 lda #$40
 sta ovdp
 ldx #0
ovs0 lda ovdp
 sta ovbp,x
 lda ovsp,x
 sta ovs1+2
 lda ovdp
 sta ovs2+2
 lda ovnp,x
 sta ovlp
 stx ovsx
 sei
 lda #0
 sta NMIEN
 lda PORTB
 sta ovpb
ovs3 lda ovpb
 and #$E3
 ora #$08
 sta PORTB
 ldy #0
ovs1 lda $A100,y
ovs2 sta $4000,y
 iny
 bne ovs1
 lda ovpb
 sta PORTB
 inc ovs1+2
 inc ovs2+2
 inc ovdp
 dec ovlp
 bne ovs3
 lda #$C0
 sta NMIEN
 cli
 ldx ovsx
 inx
 cpx #4
 bne ovs0
 lda #$FF
 sta ovid
 rts
ovdp dta b(0)
ovsp dta b($A1,$A9,$B1,$80)
ovnp dta b([E.e_end-SLA+255]/256),b([S.e_end-SLA+255]/256),b([P.e_end-SLA+255]/256),b([Z.e_end-SLA+255]/256)
ovbp dta b(0,0,0,0)
