; --- app command layer (shell is in ribbon.inc) ---
cmdexec
 cmp #34
 bcc ce0
 lda #17
ce0 tax
 lda cejh,x
 pha
 lda cejl,x
 pha
 rts

hst txa
 clc
 adc #1
 jmp insert
htop lda #0
 sta cl
 sta cc
 lda #2
 sta fl
 rts
hend lda nl
 sec
 sbc #1
 sta cl
 lda #0
 sta cc
 lda #2
 sta fl
 rts
hmenu txa
 sec
 sbc #11
 sta cmode
 lda #2
 sta mn
 lda #1
 sta bd
 rts
hlin lda #64
 sta cnt
cnl lda #'-'
 jsr insert
 dec cnt
 bne cnl
 lda #2
 sta fl
 lda #1
 sta bd
 rts
hnew lda #0
 sta DOC
 sta cl
 sta cc
 sta top
 sta anyv
 jsr scan
 lda #2
 sta fl
 rts
hsize lda #3
 sta cmsg
 rts
hrul lda rz
 eor #1
 sta rz
 jmp ruler
hbar lda iv
 eor #1
 sta iv
 jmp status
hstub lda #4
 sta cmsg
 rts
hhil lda mhl
 eor #1
 sta mhl
 rts
hmar lda lm
 beq hm1
 cmp #4
 beq hm2
 lda #0
 sta lm
 lda #63
 sta rm
 jsr status
 lda #2
 sta fl
 rts
hm1 lda #4
 sta lm
 lda #59
 sta rm
 jsr status
 lda #2
 sta fl
 rts
hm2 lda #8
 sta lm
 lda #55
 sta rm
 jsr status
 lda #2
 sta fl
 rts
; paragraph alignment: an invisible marker byte at the start of the paragraph's first line (15 centre, 16 right)
hal lda #0
 beq hsa
hac lda #15
 bne hsa
har lda #16
 bne hsa
haj lda #17
hsa sta pam
 lda #15
 sta pcs
 lda #18
 sta pch1
hset lda cl
 sta scl
 lda cc
 sta scc
 ldx cl
 jsr pfind
 sta pao
 lda pal
 sta cl
 lda pao
 beq hs1
 ldx pidx
 inx
 stx cc
 jsr delete
 lda scl
 cmp cl
 bne hs1
 lda scc
 cmp pidx
 bcc hs1
 beq hs1
 dec scc
hs1 lda pam
 beq hs2
 lda #0
 sta cc
 lda pam
 jsr insert
 lda scl
 cmp cl
 bne hs2
 inc scc
hs2 lda scl
 sta cl
 lda scc
 sta cc
 lda #2
 sta fl
 rts

hind lda #18
 sta pcs
 lda #19
 sta pch1
 ldx cl
 jsr pfind
 beq hi1
 lda #0
 beq hi2
hi1 lda #18
hi2 sta pam
 jmp hset
hbul lda #19
 sta pcs
 lda #21
 sta pch1
 ldx cl
 jsr pfind
 beq hb1
 cmp #19
 beq hb2
 lda #0
 beq hb3
hb1 lda #19
 bne hb3
hb2 lda #20
hb3 sta pam
 jmp hset

hlg lda #1
 sta dlt
 lda #0
 sta wrpf
 jsr stw
 jmp sth
hsm lda #$FF
 sta dlt
 lda #0
 sta wrpf
 jsr stw
 jmp sth
; keep-together characters: a space and a hyphen that reflow never breaks at
hnb lda #160
 jmp insert
hnh lda #173
 jmp insert
; spacer: a paragraph of marker 24 is drawn as a hatched frame that text never flows into
hspc lda #24
 sta pcs
 lda #25
 sta pch1
 ldx cl
 jsr pfind
 beq hsp1
 lda #0
 beq hsp2
hsp1 lda #24
hsp2 sta pam
 jmp hset
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
 jmp hset

; themes: paper, blue, amber, green (body bg, body ink, bar bg, bar ink)
hcol ldx th
 inx
 cpx #4
 bcc hc1
 ldx #0
hc1 stx th
 lda thc2,x
 sta COLOR2
 lda thc1,x
 sta COLOR1
 lda thb,x
 sta tcb
 lda thi,x
 sta tci
 rts
thc2 dta b($0F),b($0A),b($10),b($C0)
thc1 dta b(0),b(0),b($0A),b($0A)
thb dta b($0F),b($94),b($1C),b($C8)
thi dta b(0),b($0A),b(0),b(0)

cejl dta l(hst-1),l(hst-1),l(hst-1),l(htop-1),l(hend-1),l(hnew-1),l(hsize-1),l(hrul-1),l(hbar-1),l(hcol-1),l(hlin-1)
 dta l(hmenu-1),l(hmenu-1),l(hmenu-1),l(hmenu-1),l(hmenu-1),l(hmenu-1),l(hstub-1),l(hhil-1),l(hmar-1),l(hal-1),l(hac-1),l(har-1),l(haj-1),l(hind-1),l(hbul-1),l(hfont-1),l(hlg-1),l(hsm-1),l(hwid-1),l(hht-1),l(hnb-1),l(hnh-1),l(hspc-1)
cejh dta h(hst-1),h(hst-1),h(hst-1),h(htop-1),h(hend-1),h(hnew-1),h(hsize-1),h(hrul-1),h(hbar-1),h(hcol-1),h(hlin-1)
 dta h(hmenu-1),h(hmenu-1),h(hmenu-1),h(hmenu-1),h(hmenu-1),h(hmenu-1),h(hstub-1),h(hhil-1),h(hmar-1),h(hal-1),h(hac-1),h(har-1),h(haj-1),h(hind-1),h(hbul-1),h(hfont-1),h(hlg-1),h(hsm-1),h(hwid-1),h(hht-1),h(hnb-1),h(hnh-1),h(hspc-1)

; menu keys: Esc opens, then a menu letter, then an item letter
menuopen
 lda #1
 sta mn
 sta bd
 lda #0
 sta cmsg
 rts

menukey
 lda kk
 cmp #$1B
 bne mk1
 lda #0
 sta mn
 lda #1
 sta bd
 rts
mk1 cmp #$7F
 bne mk2
 jsr ribnext
 lda #2
 sta mn
 rts
mk2 cmp #$1F
 bne mk3
 jsr ribnext
 lda #2
 sta mn
 rts
mk3 cmp #$1E
 bne mk4
 jsr ribprev
 lda #2
 sta mn
 rts
mk4 cmp #'a'
 bcc mk5
 cmp #'{'
 bcs mk5
 sec
 sbc #$20
mk5 sta kk
 lda mn
 cmp #1
 bne mk7
 ldx #0
mk6 lda mhot,x
 cmp kk
 beq mk6f
 inx
 cpx #NMENU
 bne mk6
 rts
mk6f stx cmode
 lda #2
 sta mn
 lda #1
 sta bd
 rts
mk7 ldx cmode
 lda ipl,x
 sta src
 lda iph,x
 sta src+1
 ldy #0
mk8 lda (src),y
 beq mk9
 cmp kk
 beq mk8f
 iny
 iny
 bne mk8
mk8f iny
 lda (src),y
 pha
 lda #0
 sta mn
 lda #1
 sta cmsg
 sta bd
 pla
 jmp cmdexec
mk9 rts

items
 ldx cmode
 lda itl,x
 pha
 lda ith,x
 tax
 pla
 jmp putstr

mhot dta c'FESCPD'
ipl dta l(ip0),l(ip1),l(ip2),l(ip3),l(ip4),l(ip5)
iph dta h(ip0),h(ip1),h(ip2),h(ip3),h(ip4),h(ip5)
ip0 dta c'N',b(5),c'O',b(17),c'S',b(17),c'A',b(17),c'X',b(17),b(0)
ip1 dta c'U',b(17),c'T',b(17),c'C',b(17),c'P',b(17),c'O',b(3),c'E',b(4),b(0)
ip2 dta c'F',b(17),c'N',b(17),c'R',b(17),c'G',b(17),b(0)
ip3 dta c'R',b(17),c'B',b(0),c'I',b(1),c'U',b(2),c'S',b(28),c'L',b(27),c'O',b(26),c'W',b(29),c'T',b(30),c'N',b(31),c'H',b(32),b(0)
ip4 dta c'L',b(20),c'C',b(21),c'R',b(22),c'J',b(23),c'B',b(25),c'I',b(24),c'G',b(33),b(0)
ip5 dta c'R',b(7),c'T',b(17),c'M',b(19),c'B',b(8),c'C',b(9),c'Z',b(6),c'L',b(10),c'H',b(18),b(0)

itl dta l(it0),l(it1),l(it2),l(it3),l(it4),l(it5)
ith dta h(it0),h(it1),h(it2),h(it3),h(it4),h(it5)
it0 dta b(3),c'N',b(3),c'ew  ',b(3),c'O',b(3),c'pen  ',b(3),c'S',b(3),c'ave  Save-',b(3),c'A',b(3),c's  E',b(3),c'x',b(3),c'it',b(0)
it1 dta b(3),c'U',b(3),c'ndo  Cu',b(3),c't',b(3),c'  ',b(3),c'C',b(3),c'opy  ',b(3),c'P',b(3),c'aste  T',b(3),c'o',b(3),c'p  ',b(3),c'E',b(3),c'nd',b(0)
it2 dta b(3),c'F',b(3),c'ind  ',b(3),c'N',b(3),c'ext  ',b(3),c'R',b(3),c'eplace  ',b(3),c'G',b(3),c'oto',b(0)
it3 dta b(3),c'R',b(3),c'egular ',b(3),c'B',b(3),c'old ',b(3),c'I',b(3),c'talic ',b(3),c'U',b(3),c'nderline ',b(3),c'S',b(3),c'maller ',b(3),c'L',b(3),c'arger F',b(3),c'o',b(3),c'nts',b(0)
it4 dta b(3),c'L',b(3),c'eft  ',b(3),c'C',b(3),c'enter  ',b(3),c'R',b(3),c'ight  ',b(3),c'J',b(3),c'ustify  ',b(3),c'B',b(3),c'ullet  ',b(3),c'I',b(3),c'ndent',b(0)
it5 dta b(3),c'R',b(3),c'uler  ',b(3),c'T',b(3),c'abs  ',b(3),c'M',b(3),c'argins  ',b(3),c'B',b(3),c'ars  ',b(3),c'C',b(3),c'olor  Si',b(3),c'z',b(3),c'e  ',b(3),c'L',b(3),c'ine  ',b(3),c'H',b(3),c'ilite',b(0)

dli1
 pha
 txa
 pha
 lda #<dli2
 sta VDSLST
 lda #>dli2
 sta VDSLST+1
 lda tci
 ldx tcb
 sta WSYNC
 sta COLPF1
 stx COLPF2
 pla
 tax
 pla
 rti

dli2
 pha
 txa
 pha
 lda #<dli1
 sta VDSLST
 lda #>dli1
 sta VDSLST+1
 lda COLOR1
 ldx COLOR2
 sta WSYNC
 sta COLPF1
 stx COLPF2
 pla
 tax
 pla
 rti

appmsg
 lda #<m1
 ldx #>m1
 jsr putstr
 lda nl
 jsr putnum
 lda #<m2
 ldx #>m2
 jsr putstr
 lda dend+1
 sec
 sbc #>DOC
 jsr putnum
 lda #<m3
 ldx #>m3
 jmp putstr

m1 dta c'Document: ',b(0)
m2 dta c' lines, about ',b(0)
m3 dta c' x 256 bytes.',b(0)

NMENU = 6
tn0 dta b(4),c'F',b(4),c'ile',b(0)
tn1 dta b(4),c'E',b(4),c'dit',b(0)
tn2 dta b(4),c'S',b(4),c'earch',b(0)
tn3 dta b(4),c'C',b(4),c'haracter',b(0)
tn4 dta b(4),c'P',b(4),c'aragraph',b(0)
tn5 dta b(4),c'D',b(4),c'ocument',b(0)
tabl dta l(tn0),l(tn1),l(tn2),l(tn3),l(tn4),l(tn5)
tabh dta h(tn0),h(tn1),h(tn2),h(tn3),h(tn4),h(tn5)
tl0 dta c'  Esc',b(0)
tooll dta l(tl0),l(tl0),l(tl0),l(tl0),l(tl0),l(tl0)
toolh dta h(tl0),h(tl0),h(tl0),h(tl0),h(tl0),h(tl0)
cmdtab dta c'bold',b(0),c'italic',b(0),c'underline',b(0),c'top',b(0),c'end',b(0)
 dta c'new',b(0),c'size',b(0),c'ruler',b(0),c'bars',b(0),c'color',b(0),c'line',b(0)
 dta c'file',b(0),c'edit',b(0),c'search',b(0),c'character',b(0),c'paragraph',b(0),c'document',b(0),b(0)

