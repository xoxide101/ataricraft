; Message line texts (cmsg 20..39). Resident: the status line draws them in every mode, while the
; spell, edit and page code lives in the overlay slot (ovl.inc) and is swapped in on use.
MSB = $9C00
spmsg
 lda cmsg
 cmp #20
 bne spmx
 jmp o_spm20
spmx cmp #33
 bne spmy
 jmp o_exrepm
spmy cmp #27
 bcc spmz
 sec
 sbc #27
 asl
 tax
 lda exmt,x
 pha
 lda exmt+1,x
 tax
 pla
 jmp putstr
spmz sec
 sbc #21
 asl
 tax
 lda spmt,x
 pha
 lda spmt+1,x
 tax
 pla
 jmp putstr
spmt dta a(spm21),a(spm22),a(spm23),a(spm24),a(spm25),a(spm26)
spm21 dta c'Spell check finished.',b(0)
spm22 dta c'No EN.CDC on D1: or H: (Search > Dictionary)',b(0)
spm23 dta c'Bad dictionary file (need CDIC v1, 4-64 pages).',b(0)
spm24 dta c'Table does not fit: 130XE needed, or less text.',b(0)
spm25 dta c'Spell check stopped.',b(0)
spm26 dta c'Dictionary name set.',b(0)
exmt dta a(exm27),a(exm28),a(exm29),a(exm30),a(exm31),a(exm32),a(exm33),a(exm34),a(exm35),a(exm36),a(exm37),a(exm38),a(exm39),a(exm40),a(exm41),a(exm42),a(exm43),a(exm44),a(exm45),a(exm46),a(exm47)
exm27 dta c'Not found.',b(0)
exm28 dta c'Nothing to copy.',b(0)
exm29 dta c'Too big for the clipboard (384 bytes).',b(0)
exm30 dta c'Copied.',b(0)
exm31 dta c'Cut.',b(0)
exm32 dta c'Replace?  Y yes  N skip  A all  Esc stop',b(0)
exm33 dta c'Replaced.',b(0)
exm34 dta c'Mark set. Move, then ^Y copy or ^D cut. Esc clears.',b(0)
exm35 dta c'The clipboard is empty.',b(0)
exm36 dta c'No room in the document.',b(0)
exm37 dta c'Replace stopped.',b(0)
exm38 dta c'Found. ^G next, ^R replace, Esc clears.',b(0)
exm39 dta c'Needs 128K (130XE); uses more if found.',b(0)
exm40 dta c'Not available now.',b(0)
exm41 dta c'Font set for this paragraph.',b(0)
exm42 dta c'Font file not found.',b(0)
exm43 dta c'Too many fonts (4 max).',b(0)
exm44 dta c'Too many font changes (8 max).',b(0)
exm45 dta c'Segment 1 of 1  (^N next, ^O previous)',b(0)
exm46 dta c'No more banks: segments need 256K+ (5 max).',b(0)
exm47 dta c'This is the first segment.',b(0)
exprl dta l(exp5),l(exp5),l(exp7),l(exp8),l(exp9)
exprh dta h(exp5),h(exp5),h(exp7),h(exp8),h(exp9)
exp9 dta c'Font file (ROM = standard): ',b(0)
exp5 dta c'Find: ',b(0)
exp7 dta c'Replace with (Return alone deletes): ',b(0)
exp8 dta c'Go to line: ',b(0)
