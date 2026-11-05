; Spell checker (Search > Spell check, ^K). Dictionary format and hash: docs/DICTIONARY.md.
; The dictionary (CDIC file) is read once: on a 130XE the 16 KB bit table goes into extended bank 1 (window
; $4000-$7FFF, switched in only inside bk_get / bk_put at $9300); on a stock 64K machine it is placed
; just below $9000, in the unused top of the document area, and released when the check ends.
; Words come from the document, letters and inner apostrophes, with style and paragraph codes skipped.
; Words with digits or non-ASCII characters, 1-letter words and words over 24 letters are not checked.
; The unknown word is shown inverse (style code 4 inserted around it, removed again before moving on).


hspell
 jsr sp_load
 bcc hsp_a
 lda #1
 sta bd
 rts
hsp_a lda cl
 sta sv_ln
 ldy cc
 sty sv_co
 bne hsp_m
 ldy #$FF
 bne hsp_c
hsp_m ldx cl
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldy sv_co
hsp_b dey
 bmi hsp_c
 lda (tp),y
 cmp #39
 beq hsp_b
 cmp #'0'
 bcc hsp_c
 cmp #':'
 bcc hsp_b
 cmp #'A'
 bcc hsp_c
 cmp #'['
 bcc hsp_b
 cmp #'a'
 bcc hsp_c
 cmp #'{'
 bcc hsp_b
hsp_c iny
 sty sv_co
 jmp sp_go

; scan on from (sv_ln, sv_co); report the next unknown word or finish
sp_go
 jsr sp_next
 bcs sp_found
 lda #21
 sta sv_ms
 jmp sp_finish

sp_found
 lda sv_ul
 sta cl
 lda sv_ue
 sta cc
 lda #4
 jsr insert
 lda sv_us
 sta cc
 lda #4
 jsr insert
 jsr sp_sugg
 lda #1
 sta sv_on
 lda #20
 sta cmsg
 lda #2
 sta fl
 lda #1
 sta bd
 rts

sp_finish
 lda #0
 sta sv_on
 lda sv_dl
 cmp #2
 bne spf1
 lda #0
 sta sv_dl
spf1 lda sv_ms
 sta cmsg
 lda #2
 sta fl
 lda #1
 sta bd
 rts

; remove the two highlight codes; cursor ends at the word end
sp_unhl
 lda sv_ul
 sta cl
 lda sv_us
 clc
 adc #1
 sta cc
 jsr delete
 lda sv_ue
 clc
 adc #1
 sta cc
 jsr delete
 lda #2
 sta fl
 rts

spkey
 lda kk
 cmp #$1B
 bne spk1
 jsr sp_unhl
 lda sv_us
 sta cc
 lda #25
 sta sv_ms
 jmp sp_finish
spk1 cmp #'a'
 bcc spk2
 cmp #'{'
 bcs spk2
 sec
 sbc #$20
spk2 cmp #'A'
 bne spk3
 jsr sp_addign
 jmp sp_cont
spk3 cmp #'I'
 beq sp_cont
 cmp #'N'
 beq sp_cont
 cmp #$9B
 beq sp_cont
 cmp #'1'
 bcc spk9
 cmp #'6'
 bcs spk9
 sec
 sbc #'1'
 cmp sv_sg
 bcs spk9
 jmp sp_repl
spk9 rts

sp_cont
 jsr sp_unhl
 lda sv_ul
 sta sv_ln
 lda sv_ue
 sta sv_co
 jmp sp_go

; replace the word with suggestion A (0..4), keeping an initial capital
sp_repl
 sta sv_si
 jsr sp_unhl
 lda sv_ue
 sec
 sbc sv_us
 sta sv_n
 beq sr2
sr1 jsr delete
 dec sv_n
 bne sr1
sr2 lda #1
 sta sv_i
sr3 ldx sv_si
 lda sgl,x
 sta tp
 lda sgh,x
 sta tp+1
 ldy #0
 lda (tp),y
 cmp sv_i
 bcc sr9
 ldy sv_i
 lda (tp),y
 cmp #27
 bne sr4
 lda #39
 bne sr5
sr4 clc
 adc #96
 ldx sv_i
 cpx #1
 bne sr5
 ldx sv_cap
 beq sr5
 and #$DF
sr5 jsr insert
 inc sv_i
 jmp sr3
sr9 lda cl
 sta sv_ln
 lda cc
 sta sv_co
 jmp sp_go

; remember the hash of the word just found
sp_addign
 lda sv_ni
 cmp #32
 bcs sai9
 asl
 asl
 tax
 ldy #0
sai1 lda sv_fx,y
 sta ISB,x
 inx
 iny
 cpy #4
 bne sai1
 inc sv_ni
sai9 rts

sgl dta l(SGB),l(SGB+25),l(SGB+50),l(SGB+75),l(SGB+100)
sgh dta h(SGB),h(SGB+25),h(SGB+50),h(SGB+75),h(SGB+100)

; ---------------------------------------------------------------- scanning
sp_next
sn_line
 ldx sv_ln
 cpx nl
 bcc sn_l1
 clc
 rts
sn_l1 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldy sv_co
sn_skip lda (tp),y
 beq sn_eol
 cmp #13
 beq sn_eol
 cmp #14
 beq sn_eol
 cmp #32
 bcc sn_sk1
 cmp #'0'
 bcc sn_sk1
 cmp #':'
 bcc sn_start
 cmp #'A'
 bcc sn_sk1
 cmp #'['
 bcc sn_start
 cmp #'a'
 bcc sn_sk1
 cmp #'{'
 bcc sn_start
 cmp #128
 bcc sn_sk1
 cmp #160
 beq sn_sk1
 bne sn_start
sn_sk1 iny
 bne sn_skip
sn_eol inc sv_ln
 lda #0
 sta sv_co
 jmp sn_line

sn_start
 sty sv_us
 lda #0
 sta sv_wl
 sta sv_bad
 lda (tp),y
 cmp #'a'
 lda #0
 bcs sn_c0
 lda #1
sn_c0 sta sv_cap
sn_tok lda (tp),y
 beq sn_tj
 cmp #32
 bcs sn_t1
 cmp #13
 beq sn_tj
 cmp #14
 beq sn_tj
 iny
 jmp sn_tok
sn_t1 cmp #39
 beq sn_ap
 cmp #'0'
 bcc sn_tj
 cmp #':'
 bcc sn_bad
 cmp #'A'
 bcc sn_tj
 cmp #'['
 bcc sn_let
 cmp #'a'
 bcc sn_tj
 cmp #'{'
 bcc sn_let
 cmp #128
 bcc sn_tj
 cmp #160
 beq sn_tj
sn_bad lda #1
 sta sv_bad
 iny
 jmp sn_tok
sn_tj jmp sn_te
sn_let ora #$20
 sec
 sbc #96
 ldx sv_wl
 cpx #24
 bcs sn_bad
 sta SWB,x
 inc sv_wl
 iny
 jmp sn_tok
sn_ap iny
 lda (tp),y
 dey
 ora #$20
 cmp #'a'
 bcc sn_ap2
 cmp #'{'
 bcs sn_ap2
 ldx sv_wl
 cpx #24
 bcs sn_bad
 lda #27
 sta SWB,x
 inc sv_wl
 iny
 jmp sn_tok
sn_ap2 ldx sv_wl
 beq sn_tj
 lda SWB-1,x
 cmp #19
 bne sn_tj
 lda #27
 sta SWB,x
 inc sv_wl
 iny
sn_te sty sv_ue
 sty sv_co
 lda sv_bad
 bne sn_next
 lda sv_wl
 cmp #2
 bcc sn_next
 jsr sp_check
 bcs sn_unk
sn_next ldx sv_ln
 lda LPL,x
 sta tp
 lda LPH,x
 sta tp+1
 ldy sv_co
 jmp sn_skip
sn_unk lda sv_ln
 sta sv_ul
 ldx sv_wl
 stx sv_wo
 dex
sn_u1 lda SWB,x
 sta SWO,x
 dex
 bpl sn_u1
 sec
 rts

; ---------------------------------------------------------------- lookup
; hash of the codes at (tp), X letters (>= 1), into sv_x. Same function as tools/cdict.cjs hash().
sp_hash
 stx sv_hc
 lda #$B9
 sta sv_x
 lda #$79
 sta sv_x+1
 lda #$37
 sta sv_x+2
 lda #$9E
 sta sv_x+3
 ldy #0
sph1 ldx #5
sph2 asl sv_x
 rol sv_x+1
 rol sv_x+2
 rol sv_x+3
 bcc sph3
 inc sv_x
sph3 dex
 bne sph2
 lda (tp),y
 eor sv_x
 sta sv_x
 iny
 cpy sv_hc
 bne sph1
 lda sv_x+2
 eor sv_x
 sta sv_x+2
 lda sv_x+3
 eor sv_x+1
 sta sv_x+3
 rts

; carry set when all k probe bits of sv_x are set in the table
sp_test
 lda sv_x
 sta sv_pr
 lda sv_x+1
 and sv_m1
 sta sv_pr+1
 lda sv_x+2
 and sv_m2
 sta sv_pr+2
 lda sv_x+2
 ora #1
 sta sv_h2
 lda sv_x+3
 sta sv_h2+1
 lda sv_k
 sta sv_pc
spt1 lda sv_pr+1
 lsr
 lsr
 lsr
 sta sv_bo+1
 lda sv_pr+2
 asl
 asl
 asl
 asl
 asl
 ora sv_bo+1
 sta sv_bo+1
 lda sv_pr+1
 asl
 asl
 asl
 asl
 asl
 sta sv_bo
 lda sv_pr
 lsr
 lsr
 lsr
 ora sv_bo
 sta sv_bo
 jsr bk_get
 sta sv_hm
 lda sv_pr
 and #7
 tax
 lda sv_hm
 and sbit,x
 beq spt9
 clc
 lda sv_pr
 adc sv_h2
 sta sv_pr
 lda sv_pr+1
 adc sv_h2+1
 sta sv_pr+1
 lda sv_pr+2
 adc #0
 and sv_m2
 sta sv_pr+2
 lda sv_pr+1
 and sv_m1
 sta sv_pr+1
 dec sv_pc
 bne spt1
 sec
 rts
spt9 clc
 rts
sbit dta b(1),b(2),b(4),b(8),b(16),b(32),b(64),b(128)

; word in SWB: carry set = unknown (not in the dictionary, not on the ignore list)
sp_check
 lda #<SWB
 sta tp
 lda #>SWB
 sta tp+1
 ldx sv_wl
 jsr sp_hash
 ldx #3
spc1 lda sv_x,x
 sta sv_fx,x
 dex
 bpl spc1
 jsr sp_test
 bcs spc9
 lda sv_wl
 cmp #3
 bcc spc5
 tax
 lda SWB-1,x
 cmp #19
 bne spc3
 lda SWB-2,x
 cmp #27
 bne spc3
 dex
 dex
 jsr sp_hash
 jsr sp_test
 bcs spc9
 ldx sv_wl
 lda SWB-1,x
spc3 cmp #27
 bne spc5
 lda SWB-2,x
 cmp #19
 bne spc5
 dex
 jsr sp_hash
 jsr sp_test
 bcs spc9
spc5 lda sv_ni
 sta sv_i
spc6 dec sv_i
 bmi spc8
 lda sv_i
 asl
 asl
 tay
 ldx #0
spc7 lda ISB,y
 cmp sv_fx,x
 bne spc6
 iny
 inx
 cpx #4
 bne spc7
spc9 clc
 rts
spc8 sec
 rts

; ---------------------------------------------------------------- suggestions: one letter deleted, or two neighbours swapped
sp_sugg
 lda #0
 sta sv_sg
 lda sv_wo
 sec
 sbc #1
 cmp #2
 bcc sgs2
 lda #0
 sta sv_i
sgd1 ldx sv_i
 beq sgd2
 lda SWO,x
 cmp SWO-1,x
 beq sgd9
sgd2 ldx #0
 ldy #0
sgd3 cpx sv_i
 beq sgd4
 lda SWO,x
 sta SCB,y
 iny
sgd4 inx
 cpx sv_wo
 bne sgd3
 sty sv_sl
 jsr sp_cand
sgd9 inc sv_i
 lda sv_i
 cmp sv_wo
 bne sgd1
sgs2 lda #0
 sta sv_i
sgt1 lda sv_i
 clc
 adc #1
 cmp sv_wo
 bcs sgt9
 ldx sv_i
 lda SWO,x
 cmp SWO+1,x
 beq sgt8
 ldy #0
sgt2 lda SWO,y
 sta SCB,y
 iny
 cpy sv_wo
 bne sgt2
 lda SWO+1,x
 sta SCB,x
 lda SWO,x
 sta SCB+1,x
 lda sv_wo
 sta sv_sl
 jsr sp_cand
sgt8 inc sv_i
 jmp sgt1
sgt9 rts

; SCB (sv_sl letters): keep it as a suggestion when the table accepts it
sp_cand
 lda sv_sg
 cmp #5
 bcs spq9
 lda #<SCB
 sta tp
 lda #>SCB
 sta tp+1
 ldx sv_sl
 jsr sp_hash
 jsr sp_test
 bcc spq9
 ldx sv_sg
 lda sgo,x
 tax
 lda sv_sl
 sta SGB,x
 ldy #0
spq1 lda SCB,y
 inx
 sta SGB,x
 iny
 cpy sv_sl
 bne spq1
 inc sv_sg
spq9 rts
sgo dta b(0),b(25),b(50),b(75),b(100)

; message texts live in msgs.inc (resident)
spm20
 lda #0
 sta sv_ss
 ldx #0
 stx sv_wl
spw1 cpx sv_wo
 beq spw2
 lda SWO,x
 cmp #27
 bne spw1a
 lda #39
 bne spw1b
spw1a clc
 adc #96
spw1b jsr sqe
 ldx sv_wl
 inx
 stx sv_wl
 jmp spw1
spw2 lda #<spm20t
 ldx #>spm20t
 jsr sqs
 lda #0
 sta sv_i
spw3 lda sv_i
 cmp sv_sg
 beq spw9
 clc
 adc #'1'
 jsr sqe
 lda #32
 jsr sqe
 ldx sv_i
 lda sgo,x
 sta sv_n
 tax
 lda SGB,x
 sta sv_ty
 lda #1
 sta sv_t
spw4 lda sv_ty
 cmp sv_t
 bcc spw5
 lda sv_n
 clc
 adc sv_t
 tax
 lda SGB,x
 cmp #27
 bne spw4b
 lda #39
 bne spw4c
spw4b clc
 adc #96
spw4c jsr sqe
 inc sv_t
 jmp spw4
spw5 lda #32
 jsr sqe
 inc sv_i
 jmp spw3
spw9 ldx sv_ss
 lda #0
 sta MSB,x
 lda #<MSB
 ldx #>MSB
 jmp putstr
spm20t dta c'  I ignore  A add  Esc stop  ',b(0)

sqe ldx sv_ss
 cpx #52
 bcs sqe9
 sta MSB,x
 inc sv_ss
sqe9 rts
sqs sta src
 stx src+1
 ldy #0
sqs1 lda (src),y
 beq sqe9
 sty sv_ty
 jsr sqe
 ldy sv_ty
 iny
 bne sqs1
 rts

; ---------------------------------------------------------------- loading the dictionary
sp_open
 stx ICBAL+$30
 sty ICBAH+$30
 ldx #$30
 lda #3
 sta ICCOM,x
 lda #4
 sta ICAX1,x
 lda #0
 sta ICAX2,x
 jmp CIOV

; carry clear = table ready (sv_dl = 1 in an XE bank, 2 in main RAM); carry set = cmsg tells why
sp_load
 lda sv_dl
 beq sl0
 clc
 rts
sl0 jsr bk_det
 ldx #<DNM
 ldy #>DNM
 jsr sp_open
 cpy #$80
 bcc sl2
 lda DNM2
 beq slnf
 ldx #<DNM2
 ldy #>DNM2
 jsr sp_open
 cpy #$80
 bcc sl2
slnf lda #22
 sta cmsg
 sec
 rts
slbj jmp slbad
sl2 lda #24
 sta fln
 lda #0
 sta fln+1
 lda #7
 ldx #<LDB
 ldy #>LDB
 jsr fblk
 cpy #$80
 bcs slbj
 ldx #3
sl3 lda LDB,x
 cmp sdmag,x
 bne slbj
 dex
 bpl sl3
 lda LDB+4
 cmp #1
 bne slbj
 lda LDB+5
 cmp #1
 bne slbj
 lda LDB+6
 beq slbj
 cmp #16
 bcs slbj
 sta sv_k
 lda LDB+8
 ora LDB+11
 bne slbj
 lda LDB+9
 and #7
 bne slbj
 lda LDB+10
 cmp #3
 bcs slbj
 lda LDB+9
 lsr
 lsr
 lsr
 sta sv_pg
 lda LDB+10
 asl
 asl
 asl
 asl
 asl
 ora sv_pg
 sta sv_pg
 cmp #4
 bcc slbj
 sec
 sbc #1
 and sv_pg
 bne slbj
 lda LDB+9
 sta sv_m1
 lda LDB+10
 sta sv_m2
 lda sv_m1
 bne slm1
 dec sv_m2
 lda #$FF
 sta sv_m1
 bne slm2
slm1 dec sv_m1
slm2 lda sv_xe
 beq slm3
 lda #$40
 sta sv_tb
 lda #1
 sta sv_dl
 bne slm5
slm3 lda #$90
 sec
 sbc sv_pg
 sta sv_tb
 sec
 sbc dend+1
 cmp #3
 bcc slbig
 lda #2
 sta sv_dl
slm5 lda #0
 sta sv_pi
 sta fln
 lda #1
 sta fln+1
sl4 lda #7
 ldx #<LDB
 ldy #>LDB
 jsr fblk
 cpy #$80
 bcs slbad2
 lda sv_pi
 jsr bk_put
 inc sv_pi
 lda sv_pi
 cmp sv_pg
 bne sl4
 jsr fclose
 clc
 rts
slbig jsr fclose
 lda #24
 sta cmsg
 sec
 rts
slbad2 lda #0
 sta sv_dl
slbad jsr fclose
 lda #0
 sta sv_dl
 lda #23
 sta cmsg
 sec
 rts
sdmag dta c'CDIC'
sext dta c'.CDC'

; Search > Dictionary: the typed name is in CMDB, stored in DNM (D1: and .CDC are added when missing)
sp_setname
 ldy #0
ssn1 cpy clen
 bcs ssn2
 lda CMDB,y
 cmp #':'
 beq ssn3
 iny
 bne ssn1
ssn2 lda #'D'
 sta DNM
 lda #'1'
 sta DNM+1
 lda #':'
 sta DNM+2
 ldx #3
 bne ssn4
ssn3 ldx #0
ssn4 ldy #0
 sty sv_t
ssn5 cpy clen
 bcs ssn8
 cpx #30
 bcs ssn8
 lda CMDB,y
 cmp #'a'
 bcc ssn6
 cmp #'{'
 bcs ssn6
 sec
 sbc #$20
ssn6 sta DNM,x
 cmp #'.'
 bne ssn7
 sta sv_t
ssn7 inx
 iny
 bne ssn5
ssn8 lda sv_t
 bne ssn9
 ldy #0
ssn8a lda sext,y
 sta DNM,x
 inx
 iny
 cpy #4
 bne ssn8a
ssn9 lda #$9B
 sta DNM,x
 lda #0
 sta DNM2
 sta sv_dl
 lda #26
 sta cmsg
 rts

hsetdict
 lda #4
 sta fop
 jmp fask

; ---------------------------------------------------------------- lookup
