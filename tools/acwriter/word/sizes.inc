; Character size, width, height and weight commands (Esc C), kept in overlay H so the resident code stays small.
hlg lda #1
 sta dlt
 lda #0
 sta wrpf
 jsr stw
 jsr sth
 jmp fnote
hsm lda #$FF
 sta dlt
 lda #0
 sta wrpf
 jsr stw
 jsr sth
 jmp fnote
hwid lda #1
 sta dlt
 sta wrpf
 jmp stw
hht lda #1
 sta dlt
 sta wrpf
 jmp sth
stw lda #25
 sta pcs
 lda #31
 sta pch1
 jmp stepm
sth lda #5
 sta pcs
 lda #11
 sta pch1
 lda #1
 sta anyv
stepm ldx cl
 jsr pfind
 bne zs1
 lda pcs
 clc
 adc #1
zs1 clc
 adc dlt
 cmp pcs
 bcs zs2
 lda pcs
 jmp zs3
zs2 cmp pch1
 bcc zs3
 lda wrpf
 beq zs4
 lda pcs
 jmp zs3
zs4 lda pch1
 sec
 sbc #1
zs3 sta zl
 lda pcs
 clc
 adc #1
 cmp zl
 bne zs5
 lda #0
 sta zl
zs5 lda zl
 sta pam
 jsr hset
 lda #2
 sta fl
 rts
hfont lda #22
 sta pcs
 lda #24
 sta pch1
 ldx cl
 jsr pfind
 beq hf1
 cmp #22
 beq hf2
 lda #0
 beq hf3
hf1 lda #22
 bne hf3
hf2 lda #23
hf3 sta pam
 jsr hset
 jmp fnote
