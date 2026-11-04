
; scrolling
scrolldown
 inc top
 lda #<(SCR+960)
 sta src
 lda #>(SCR+960)
 sta src+1
 lda #<(SCR+640)
 sta dst
 lda #>(SCR+640)
 sta dst+1
 ldx #24
 ldy #0
sd1 lda (src),y
 sta (dst),y
 iny
 bne sd1
 inc src+1
 inc dst+1
 dex
 bne sd1
 lda #ROWS-1
 sta rr
 lda top
 clc
 adc #ROWS-1
 sta t0
 lda #0
 sta fl
 jmp drawdoc

scrollup
 dec top
 lda #<(SCR+6720)
 sta src
 lda #>(SCR+6720)
 sta src+1
 lda #<(SCR+7040)
 sta dst
 lda #>(SCR+7040)
 sta dst+1
 ldx #24
su2 dec src+1
 dec dst+1
 ldy #0
su3 dey
 lda (src),y
 sta (dst),y
 cpy #0
 bne su3
 dex
 bne su2
 lda #0
 sta rr
 lda top
 sta t0
 sta fl
 jmp drawdoc

visible lda anyv
 bne visv
 jmp visible0
visv jsr mkyt
 lda cl
 cmp top
 bcs vv2
 sta top
 lda #2
 sta fl
 jmp mkyt
vv2 sec
 sbc top
 cmp vis
 bcc vv9
 lda cl
 sec
 sbc #ROWS-1
 bcs vv3
 lda #0
vv3 cmp top
 bcs vv4
 lda top
vv4 sta top
vv5 jsr mkyt
 lda cl
 sec
 sbc top
 cmp vis
 bcc vv6
 inc top
 jmp vv5
vv6 lda #2
 sta fl
vv9 rts

visible0
 lda cl
 cmp top
 bcs vb
 lda top
 sec
 sbc cl
 cmp #1
 bne vtop
 lda fl
 cmp #2
 beq vtop
 jmp scrollup
vtop
 lda cl
 sta top
 lda #2
 sta fl
 rts
vb lda cl
 sec
 sbc top
 cmp #ROWS
 bcc vok
 bne vbot
 lda fl
 cmp #2
 beq vbot
 jmp scrolldown
vbot
 lda cl
 sec
 sbc #ROWS-1
 sta top
 lda #2
 sta fl
vok rts

