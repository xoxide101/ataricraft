; ACWriter proof of concept: sections in word/, shared pieces in lib/ and ribbon.inc
 icl 'word/defs.inc'
 icl 'word/ovdefs.inc'
 org $0480
bsoff lda $D301
 ora #2
 sta $D301
 rts
 ini bsoff

 org $2000
 icl 'word/main.inc'
 icl 'word/screen.inc'
 icl 'word/text.inc'
 icl 'word/scale.inc'
 icl 'word/spacer.inc'
 icl 'word/picker.inc'
 icl 'word/file.inc'
 icl 'lib/barfont.inc'
 icl 'word/cmds.inc'
 icl 'ribbon.inc'
 icl 'word/scroll.inc'
 icl 'word/doc.inc'
 icl 'lib/util.inc'
 icl 'word/status.inc'
 icl 'word/home.inc'
 icl 'word/import.inc'
 icl 'word/msgs.inc'
 icl 'word/ovl.inc'
SLA = *                        ; overlay slot: 12 pages shared by the edit, spell and page code (word/ovl.inc)
 org SLA+$0C00
 .macro body
 dta b(1),c'ACWriter',b(1),c' hi-res page: 64 columns x 20 lines',b(13)
 dta c'Normal, ',b(1),c'bold',b(1),c', ',b(2),c'italic',b(2),c' and ',b(4-1),c'underline',b(3),c' text.',b(13)
 dta c'The quick brown fox jumps over a lazy dog 0123456789',b(13)
 dta b(13)
 dta c'Every glyph is drawn bit by bit at 5 pixels per',b(13)
 dta c'character, so 64 columns fit across the page and',b(13)
 dta c'the cursor can sit on any of 21 text lines.',b(13)
 dta b(13)
 dta b(1),b(2),c'Bold italic',b(2),b(1),c' works too, and ',b(3),b(1),c'bold underline',b(1),b(3),c'.',b(13)
 dta c'Type here: letters insert, Return splits a line,',b(13)
 dta c'backspace deletes and joins lines, Ctrl-arrows move',b(13)
 dta b(13)
 dta c'Scrolling is a block copy of 21 rows followed by',b(13)
 dta c'drawing a single new line at the edge.',b(13)
 dta b(13)
 dta c'Objects, not bitmaps: the document is a short',b(13)
 dta c'text stream with style codes, so it stays tiny.',b(13)
 dta b(13)
 dta c'A 1-page document fits in a few KB on a stock',b(13)
 dta c'64K XL or XE, leaving the rest for art and fonts.',b(13)
 dta b(13)
 dta c'-- end of this block --',b(13)
 .endm

 org DOC
 body
 body
 dta b(0)

 org $9200
dl :3 dta $70
 dta $4F,a(SCR)
 :14 dta $0F
 dta $8F
 :84 dta $0F
 dta $4F,a(SCR+4000)
 :74 dta $0F
 dta $8F
 :16 dta $0F
 dta $41,a(dl)

 org HM
hmr4 dta b(0),b(2),b(4),b(6),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0)
hmr8 dta b(0),b(1),b(2),b(3),b(4),b(5),b(6),b(7),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0)
hmr12 dta b(0),b(0),b(1),b(2),b(2),b(3),b(4),b(4),b(5),b(6),b(6),b(7),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0)
hmr16 dta b(0),b(0),b(1),b(1),b(2),b(2),b(3),b(3),b(4),b(4),b(5),b(5),b(6),b(6),b(7),b(7),b(0),b(0),b(0),b(0),b(0),b(0),b(0),b(0)
hmr20 dta b(0),b(0),b(0),b(1),b(1),b(2),b(2),b(2),b(3),b(3),b(4),b(4),b(4),b(5),b(5),b(6),b(6),b(6),b(7),b(7),b(0),b(0),b(0),b(0)
hmr24 dta b(0),b(0),b(0),b(1),b(1),b(1),b(2),b(2),b(2),b(3),b(3),b(3),b(4),b(4),b(4),b(5),b(5),b(5),b(6),b(6),b(6),b(7),b(7),b(7)
 org SYM
 icl 'sym.inc'

 org $9400
 icl 'font4.inc'

; Overlay images are assembled to run at SLA but stored page aligned in the display-buffer area ($A100..), where
; the startup code copies them into bank 2 (ovstage); the screen buffer is cleared after that.
 org $A100
 org r:SLA
 .local E
 icl 'word/edit.inc'
e_end = *
 .endl
 org $A900
 org r:SLA
 .local S
 icl 'word/spell.inc'
e_end = *
 .endl
 org $B100
 org r:SLA
 .local P
 icl 'word/page.inc'
 icl 'craftpg.inc'
e_end = *
 .endl

 org $96A0
 icl 'word/ovlcopy.inc'

BFNT = $9800
 org BFNT
 icl 'font6.inc'

 org $1500
 icl 'word/helpdoc.inc'
 icl 'word/spellbk.inc'
 run start