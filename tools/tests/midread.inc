; midread.inc - plays a standard MIDI file (.mid, format 0 or 1, up to 8 tracks) straight from BUF on the Atari.
; Same voice rules as tools/midiconv.cjs: 4 pure-tone voices (oldest stolen), channel 10 = noise drums (3 frames),
; velocity -> volume, tempo changes followed, 60 Hz frames. prepfile recognises 'MThd', records the track
; chunks and rewrites the first 4 bytes to the PMD magic so the shell's file check passes; ismid then selects this player.
;
; FORMAT / LIMITS
;   Input is the whole .mid in BUF ($4000..$B7FF). Format 0 or 1, at most 8 'MTrk' chunks (more are ignored),
;   each chunk's length < 64K and ending below $B900. SMPTE time division (bit 15 set) and a zero division are
;   rejected. Only note on/off (8x, 9x), tempo (FF 51 03) and end of track (FF 2F) are acted on; all other
;   events are skipped. Running status is supported. Note 47..108 is the playable range: other notes are
;   folded by octaves into it. Channel 10 (status low nibble 9) is drums: noise, never steals a voice.
;
; MEMORY
;   BUF $4000.. holds the file untouched (only the first 4 bytes are rewritten to 'PMD',1). Per-track and
;   per-voice state lives in the small tables below (8 and 4 entries). Zero page $A0..$C6 as listed here.
;
; TIMING
;   One 60 Hz frame adds 16667 us to the 24-bit budget bu. While bu >= tui (microseconds per MIDI tick =
;   tempo / division) one tick is subtracted and every track is advanced by one tick (mtick). Several ticks
;   can run per frame; none run when the budget is short. Default tempo is 500000 us/quarter (120 bpm).
;
; CONNECTIONS
;   Uses from player.inc: BUF, BUFTOP, AUDF1/AUDC1, R_AUDF1/R_AUDC1, route (bit0 left, bit1 right), silence.
;   Uses from common.inc: vsync, CH, t2 (key code is parked in t2). Uses pitch.inc's ptab.
;   Defines prepfile (called by player.inc after load), mplay (called by midiplay.asm doplay when ismid <> 0)
;   and ismid. Also pp/wt ($90/$92) belong to player.inc and are used only by the .PMD player.
;
; ZERO PAGE (all $A0..$C6; $80..$8B are common.inc, $90..$92 player.inc)
tp      = $A0           ; (2) track read pointer, also chunk scan pointer in prepfile
cx      = $A2           ; current track index 0..nt-1
ms      = $A3           ; current MIDI status byte (running status resolved)
d1      = $A4           ; event data byte 1 (note number / meta type)
d2      = $A5           ; event data byte 2 (velocity)
v0      = $A6           ; (2) vlq result / chunk length / meta length, low
v1      = $A7           ;     high
ndone   = $A8           ; number of tracks that have ended
nt      = $A9           ; tracks used
bu0     = $AA           ; microsecond budget (24 bit, bu0 = low)
bu1     = $AB
bu2     = $AC
tui0    = $AD           ; microseconds per mtick (16 bit)
tui1    = $AE
tm0     = $AF           ; tempo, microseconds per quarter note (24 bit, tm0 = low)
tm1     = $B0
tm2     = $B1
dvl     = $B2           ; time division (ticks per quarter note), low
dvh     = $B3           ; high (bit 7 clear)
agec    = $B4           ; running counter of notes started; stamps voice age (wraps at 256)
ismid   = $B5           ; 1 = BUF holds a .mid accepted by prepfile, 0 = plain .PMD
dv0     = $B6           ; div24: dividend in, quotient out (24 bit)
dv1     = $B7
dv2     = $B8
rm0     = $B9           ; div24: remainder (24 bit)
rm1     = $BA
rm2     = $BB
ch0     = $BC           ; MIDI channel 0..15 of the current event
vol     = $BD           ; volume 0..15 from velocity
fv      = $BE           ; AUDF to write (setv)
cv      = $BF           ; AUDC to write (setv); 0 = silent
best    = $C0           ; noteon: voice chosen for stealing ($FF = none)
bage    = $C1           ; noteon: age of that voice
nf      = $C2           ; prepfile: MTrk chunks found so far
pg0     = $C3           ; prepfile: chunk data start
pg1     = $C4
pf0     = $C5           ; prepfile: chunk data end (= start of next chunk)
pf1     = $C6

; Per-track tables (index = track 0..7): data start (tsl/tsh), data end (tel/teh), saved read pointer
; (tcl/tch), ticks left to the next event (tw0/tw1), done flag (tdn), running status (trs).
; Per-voice tables (index = voice 0..3): vn = note number being played, $FF = free, $FE = drum;
; vc = its channel; va = age stamp (agec when started); vd = frames of drum noise left (0 = no decay).
tsl     .byte 0,0,0,0,0,0,0,0
tsh     .byte 0,0,0,0,0,0,0,0
tel     .byte 0,0,0,0,0,0,0,0
teh     .byte 0,0,0,0,0,0,0,0
tcl     .byte 0,0,0,0,0,0,0,0
tch     .byte 0,0,0,0,0,0,0,0
tw0     .byte 0,0,0,0,0,0,0,0
tw1     .byte 0,0,0,0,0,0,0,0
tdn     .byte 0,0,0,0,0,0,0,0
trs     .byte 0,0,0,0,0,0,0,0
vn      .byte 255,255,255,255
vc      .byte 0,0,0,0
va      .byte 0,0,0,0
vd      .byte 0,0,0,0

        icl 'pitch.inc'

; prepfile - called by the shell after the file is in BUF (BUF+0..3 = 'MThd', header: +8/9 format, +10/11 number
; of tracks, +12/13 division). In: BUF. Out: ismid = 1 and BUF magic rewritten to 'PMD',1 if it is a usable .mid;
; otherwise ismid = 0 and BUF is left alone. Clobbers A,X,Y,tp,pg,pf,nf,nt,dvl/dvh,v0/v1.
; Algorithm: validate header, then walk the chunk list from BUF+14 recording start/end of each 'MTrk'.
prepfile jmp pfs
pq      rts             ; shared rts for the many bne pq bail-outs (branch range)
pfs      lda #0
        sta ismid
        sta nf
        lda BUF
        cmp #'M'
        bne pq
        lda BUF+1
        cmp #'T'
        bne pq
        lda BUF+2
        cmp #'h'
        bne pq
        lda BUF+3
        cmp #'d'
        bne pq
        lda BUF+12
        bmi pq          ; SMPTE time division is not supported
        sta dvh
        lda BUF+13
        sta dvl
        ora dvh
        beq pq          ; division 0 would divide by zero
        lda BUF+10
        bne pq8
        lda BUF+11
        cmp #9
        bcc pq9
pq8     lda #8          ; at most 8 tracks
pq9     sta nt
        lda #<(BUF+14)
        sta tp
        lda #>(BUF+14)
        sta tp+1
pw1     lda tp+1
        cmp #>(BUFTOP-8)
        bcs pw9         ; no room for another chunk header
        ldy #4
        lda (tp),y
        iny
        ora (tp),y
        bne pw9         ; chunk length >= 64K
        iny
        lda (tp),y
        sta v1
        iny
        lda (tp),y
        sta v0
        clc
        lda tp
        adc #8
        sta pg0         ; pg = data start (after 8-byte chunk header)
        lda tp+1
        adc #0
        sta pg1
        clc
        lda pg0
        adc v0
        sta pf0         ; pf = data end
        lda pg1
        adc v1
        sta pf1
        bcs pw9
        cmp #$B9
        bcs pw9         ; chunk runs past the buffer
        ldy #0
        lda (tp),y
        cmp #'M'
        bne pw2
        ldy #2
        lda (tp),y
        cmp #'r'
        bne pw2         ; only 'MTrk' chunks count; others are skipped
        ldx nf
        lda pg0
        sta tsl,x
        lda pg1
        sta tsh,x
        lda pf0
        sta tel,x
        lda pf1
        sta teh,x
        inc nf
        lda nf
        cmp nt
        bcs pw9
pw2     lda pf0
        sta tp
        lda pf1
        sta tp+1
        jmp pw1
pw9     lda nf
        bne pw8
        jmp pq          ; no track found: not playable
pw8
        sta nt          ; nt = tracks actually found
        lda #'P'
        sta BUF
        lda #'M'
        sta BUF+1
        lda #'D'
        sta BUF+2
        lda #1
        sta BUF+3
        sta ismid
        ; falls into rdb: it reads one byte and returns, which also serves as prepfile's rts

; --- reading
; rdb: A = next byte at (tp), tp advanced. Clobbers Y (=0).
rdb     ldy #0
        lda (tp),y
        inc tp
        bne rb1
        inc tp+1
rb1     rts

; vlq: read a MIDI variable-length quantity at tp -> v1:v0 (16 bits kept). Clobbers A,X,Y.
; Each byte: shift v left 7, OR in the low 7 bits; bit 7 set means another byte follows.
vlq     lda #0
        sta v0
        sta v1
vq1     jsr rdb
        pha
        ldx #7
vq2     asl v0
        rol v1
        dex
        bne vq2
        pla
        pha
        and #$7F
        ora v0
        sta v0
        pla
        bmi vq1
        rts

; skipv: tp += v1:v0 (skip an event body whose length was just read). Clobbers A.
skipv   clc
        lda tp
        adc v0
        sta tp
        lda tp+1
        adc v1
        sta tp+1
        rts

; --- tempo: mtick length in microseconds = tempo / division
; div24: dv2:dv1:dv0 = dv2:dv1:dv0 / dvh:dvl (24-bit restoring division, 24 passes); remainder in rm2:rm1:rm0.
; Each pass shifts the dividend's top bit into rm; if rm >= divisor (rm2 <> 0 always is) subtract it and
; set the quotient bit (inc dv0, the bit just shifted in is 0). Clobbers A,X.
div24   lda #0
        sta rm0
        sta rm1
        sta rm2
        ldx #24
dv_l    asl dv0
        rol dv1
        rol dv2
        rol rm0
        rol rm1
        rol rm2
        lda rm2
        bne dv_s
        lda rm1
        cmp dvh
        bcc dv_n
        bne dv_s
        lda rm0
        cmp dvl
        bcc dv_n
dv_s    sec
        lda rm0
        sbc dvl
        sta rm0
        lda rm1
        sbc dvh
        sta rm1
        lda rm2
        sbc #0
        sta rm2
        inc dv0
dv_n    dex
        bne dv_l
        rts

; settempo: tui1:tui0 = tm2:tm1:tm0 / dvh:dvl, clamped to 1..$FFFF. Clobbers A,X,dv,rm.
settempo lda tm0
        sta dv0
        lda tm1
        sta dv1
        lda tm2
        sta dv2
        jsr div24
        lda dv2
        beq st_a
        lda #$FF
        sta dv0
        sta dv1
st_a    lda dv0
        ora dv1
        bne st_b
        lda #1
        sta dv0
st_b    lda dv0
        sta tui0
        lda dv1
        sta tui1
        rts

; --- voices (X = voice 0-3, fv = AUDF, cv = AUDC)
; setv: write fv/cv to voice X on the selected side(s). Voice X = POKEY channel X, register offset 2*X.
; route bit 0 = left POKEY, bit 1 = right POKEY. Clobbers A,Y.
setv    txa
        asl
        tay
        lda route
        and #1
        beq sv1
        lda fv
        sta AUDF1,y
        lda cv
        sta AUDC1,y
sv1     lda route
        and #2
        beq sv2
        lda fv
        sta R_AUDF1,y
        lda cv
        sta R_AUDC1,y
sv2     rts

; silx: silence voice X (AUDC = 0, AUDF unchanged).
silx    lda #0
        sta cv
        jmp setv

; noteoff: ms = status (channel in low nibble), d1 = note. Frees and silences the voice playing that note on
; that channel, if any (a stolen note finds nothing). Clobbers A,X,Y,ch0,cv.
noteoff lda ms
        and #$0F
        sta ch0
        ldx #3
nf1     lda vn,x
        cmp d1
        bne nf2
        lda vc,x
        cmp ch0
        bne nf2
        lda #$FF
        sta vn,x
        jmp silx
nf2     dex
        bpl nf1
        rts

; noteon: ms = status, d1 = note, d2 = velocity (non-zero). Volume = (velocity+4)/8, max 15.
; Channel 10 goes to drum. Otherwise the note is folded into 47..108 (octaves), AUDF from ptab, AUDC = $A0|vol
; ($Ax = pure tone), minimum volume 3. Voice choice: a free voice, else steal the oldest non-drum voice
; (largest agec - va; first found wins ties). If all four voices are drums the note is dropped.
; Clobbers A,X,Y,ch0,vol,fv,cv,best,bage.
noteon  lda ms
        and #$0F
        sta ch0
        lda d2
        clc
        adc #4
        lsr
        lsr
        lsr
        cmp #16
        bcc nv1
        lda #15
nv1     sta vol
        lda ch0
        cmp #9          ; channel 10 (0-based 9) = drums
        bne ton
        jmp drum
ton     lda vol
        cmp #3
        bcs nv2
        lda #3
nv2     ora #$A0
        sta cv
        lda d1
nt1     cmp #47         ; fold into the ptab range 47..108
        bcs nt2
        clc
        adc #12
        jmp nt1
nt2     cmp #109
        bcc nt3
        sec
        sbc #12
        jmp nt2
nt3     sec
        sbc #47
        tax
        lda ptab,x
        sta fv
        ldx #3
pk1     lda vn,x        ; look for a free voice (vn = $FF)
        cmp #$FF
        beq pk9
        dex
        bpl pk1
        lda #$FF        ; none free: steal the oldest non-drum voice
        sta best
        ldx #3
st1     lda vn,x
        cmp #$FE
        beq st3
        lda agec
        sec
        sbc va,x
        ldy best
        cpy #$FF
        beq st2
        cmp bage
        bcc st3
        beq st3
st2     sta bage
        stx best
st3     dex
        bpl st1
        ldx best
        cpx #$FF
        beq pkx
pk9     lda d1
        sta vn,x        ; found/stolen voice: record note, channel, age
        lda ch0
        sta vc,x
        inc agec
        lda agec
        sta va,x
        lda #0
        sta vd,x
        jmp setv
pkx     rts

; drum: d1 = GM drum note, vol set. Needs a free voice (never steals, else the hit is dropped). Plays noise
; (AUDC = $80|vol, minimum volume 4) for 3 frames; AUDF by drum type: note <37: 150, <41: 60, <45: 12, else 30.
; The voice is marked $FE so decay frees it. Clobbers A,X,Y,fv,cv.
drum    ldx #3
dr1l    lda vn,x
        cmp #$FF
        beq dr2l
        dex
        bpl dr1l
        rts
dr2l    lda vol
        cmp #4
        bcs dr3
        lda #4
dr3     ora #$80
        sta cv
        lda d1
        ldy #150
        cmp #37
        bcc dn
        ldy #60
        cmp #41
        bcc dn
        ldy #12
        cmp #45
        bcc dn
        ldy #30
dn      sty fv
        lda #$FE
        sta vn,x
        lda #3
        sta vd,x
        jmp setv

; decay: once per frame, count down drum voices; when vd reaches 0 the voice is freed and silenced.
decay   ldx #3
dc1     lda vd,x
        beq dc2
        dec vd,x
        bne dc2
        lda #$FF
        sta vn,x
        jsr silx
dc2     dex
        bpl dc1
        rts

; --- one track: run every event whose wait is zero
; trkrun: track cx. Loads its pointer, executes events until one has a non-zero delta (pointer saved in
; tcl/tch) or the track ends (tdn = 1, ndone++). Status < $80 reuses the running status trs; $F0..$FF are
; meta/sysex (only FF 2F end and FF 51 tempo matter); C0/D0 have one data byte, the rest two; 9x with
; velocity 0 is a note off; A0/B0/E0 are ignored. Each event is followed by its delta time (vlq -> tw0/tw1).
; Clobbers A,X,Y,tp,ms,d1,d2,v0,v1 and whatever noteon/noteoff/settempo use.
trkrun  ldx cx
        lda tdn,x
        beq tr0
        rts
tr0     lda tcl,x
        sta tp
        lda tch,x
        sta tp+1
tr1     ldx cx
        lda tw0,x
        ora tw1,x
        beq tr1b
        jmp trsave
tr1b                    ; (wait is zero; beq/jmp pair because trsave is out of branch range)
        lda tp+1
        cmp teh,x
        bcc tr2
        beq tr1c
        jmp trend
tr1c    lda tp
        cmp tel,x
        bcc tr2
        jmp trend       ; pointer reached the chunk end
tr2     jsr rdb
        sta ms
        lda ms
        bmi tr3
        lda tp          ; data byte where a status was expected: unread it, use running status
        bne tr2a
        dec tp+1
tr2a    dec tp
        ldx cx
        lda trs,x
        bmi tr2b
        jmp trend       ; no running status yet: corrupt track, stop it
tr2b    sta ms
        jmp tr4
tr3     cmp #$F0
        bcs tmeta
        ldx cx
        sta trs,x       ; remember as running status
tr4     lda ms
        and #$F0
        cmp #$C0
        beq t1b         ; program change / channel pressure: one data byte
        cmp #$D0
        beq t1b
        jsr rdb
        sta d1
        jsr rdb
        sta d2
        lda ms
        and #$F0
        cmp #$90
        beq tnon
        cmp #$80
        bne tdel
        jsr noteoff
        jmp tdel
tnon    lda d2
        bne tnon2
        jsr noteoff
        jmp tdel
tnon2   jsr noteon
        jmp tdel
t1b     jsr rdb
tdel    jsr vlq
        ldx cx
        lda v0
        sta tw0,x
        lda v1
        sta tw1,x
        jmp tr1
tmeta   lda ms
        cmp #$FF
        beq tmf
        jsr vlq         ; sysex ($F0/$F7): length, then skip it
        jsr skipv
        jmp tdel
tmf     jsr rdb         ; meta event: type, length
        sta d1
        jsr vlq
        lda d1
        cmp #$2F        ; end of track
        bne tmn
        jmp trend
tmn
        cmp #$51        ; set tempo, 3 bytes big endian
        bne tmskip
        lda v0
        cmp #3
        bne tmskip
        jsr rdb
        sta tm2
        jsr rdb
        sta tm1
        jsr rdb
        sta tm0
        jsr settempo
        jmp tdel
tmskip  jsr skipv
        jmp tdel
trsave  lda tp
        sta tcl,x
        lda tp+1
        sta tch,x
        rts
trend   ldx cx
        lda #1
        sta tdn,x
        inc ndone
        rts

; mtick: advance every unfinished track by one MIDI tick: decrement a non-zero wait (16-bit), then trkrun
; (which does nothing further while the wait is still non-zero). Clobbers A,X,Y and trkrun's.
mtick    ldx #0
tk1     stx cx
        lda tdn,x
        bne tk3
        lda tw0,x
        ora tw1,x
        beq tk2
        lda tw0,x
        bne tk4
        dec tw1,x
tk4     dec tw0,x
tk2     jsr trkrun
tk3     ldx cx
        inx
        cpx nt
        bcc tk1
        rts

; mplay - play the .mid in BUF (called from doplay). Returns at the end of all tracks or on a key press
; (the key code is left in t2, CH cleared). Init: silence, free all voices, zero budget, default tempo
; 500000 us ($07A120), then per track: point at its data, read the first delta and run time-zero events.
; Main loop per frame: vsync, drum decay, bu += 16667 us (one 60 Hz frame), then while bu >= tui: bu -= tui
; and mtick. Clobbers everything.
mplay   jsr silence
        ldx #3
mp1     lda #$FF
        sta vn,x
        lda #0
        sta vd,x
        dex
        bpl mp1
        sta agec
        sta ndone
        sta bu0
        sta bu1
        sta bu2
        lda #$20
        sta tm0
        lda #$A1
        sta tm1
        lda #$07
        sta tm2
        jsr settempo
        ldx #0
mp2     stx cx
        lda tsl,x
        sta tcl,x
        sta tp
        lda tsh,x
        sta tch,x
        sta tp+1
        lda #0
        sta tdn,x
        sta trs,x
        jsr vlq
        ldx cx
        lda v0
        sta tw0,x
        lda v1
        sta tw1,x
        lda tp
        sta tcl,x
        lda tp+1
        sta tch,x
        jsr trkrun
        ldx cx
        inx
        cpx nt
        bcc mp2
        lda #$FF
        sta CH
mfr     jsr vsync
        jsr decay
        clc
        lda bu0
        adc #<16667
        sta bu0
        lda bu1
        adc #>16667
        sta bu1
        lda bu2
        adc #0
        sta bu2
mtk     lda bu2
        bne mt1
        lda bu1
        cmp tui1
        bcc mkey
        bne mt1
        lda bu0
        cmp tui0
        bcc mkey
mt1     sec             ; bu -= tui (24-bit), then run one tick
        lda bu0
        sbc tui0
        sta bu0
        lda bu1
        sbc tui1
        sta bu1
        lda bu2
        sbc #0
        sta bu2
        jsr mtick
        jmp mtk
mkey    lda ndone       ; all tracks finished?
        cmp nt
        bcs mend
        lda CH          ; $FF = no key
        cmp #$FF
        beq mfr
        sta t2
        lda #$FF
        sta CH
mend    rts
