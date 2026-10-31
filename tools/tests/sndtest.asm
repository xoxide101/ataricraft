; SNDTEST.COM - POKEY audio test, mono and stereo. Detects a second POKEY ($D210) and checks the first one's
; random generator automatically. G runs a guided listening test (left, right, both, noise, sweep) where you
; answer Y / N and get PASS or FAIL per step; keys 0-9 are free-play tones. ESC exits.
;
; KEYS (OS key codes as returned in CH): G ($3D) guided test, 0-9 tones, D ditty, L static left, R static
;   right, S sample, ESC ($1C) exit. In the guided test: Y ($2B) heard, N ($23) not heard, S ($3E) skip,
;   ESC aborts.
; MODES (variable mode, index into jtab/ntab/keymap): 0 off, 1 left tone, 2 right tone, 3 both, 4 alternating,
;   5 scale, 6 4-voice chord, 7 noise, 8 16-bit low tone, 9 sweep, 10 ditty, 11 static left, 12 static right,
;   13 sample test. Each mode's routine (m_xxx) is called once per frame by play and just (re)writes POKEY.
; GUIDED STEPS (rows 5..9 of the screen = steps 0..4): left, right, both, noise, sweep (gmode table).
; SCREEN: coloured text rows from cscreen.inc (NA = 15 rows, no map, no rows below). Row 0 title, 2 POKEY 1
;   check, 3 POKEY 2 detect, 5..9 guided steps with PASS/FAIL, 11 current mode, 12 help/question, 13 result,
;   14 and 16 key menus.
; MEMORY: code at $2000; cscreen.inc takes TXTBUF $3000, MAPBUF $3300, DLIST $3400, FONT $3800.
;   sample.bin (4096 bytes) is included at the end of the program (16 pages of 4-bit volumes, one per byte).
; ZERO PAGE: $80..$8B common.inc (sp, sa, si, v16, t1..t4); $90/$91 sample read pointer in smpplay;
;   $B7..$B9 cscreen.inc (dlr, d1, d2). t1/t2/t3/t4 are scratch (see each routine).
; POKEY: left = $D200.., right (second POKEY, stereo upgrade) = $D210..; right-side AUDC is written as
;   R_AUDF1+1 etc. AUDC values: $A8 = pure tone volume 8, $88 = noise volume 8, $10|n = volume-only level n.
; CONNECTIONS: uses common.inc (eput, locate/loc, puts/say, vsync, RANDOM, CH...) and cscreen.inc (gs_init,
;   gs_off, bar, setres, clrrow, sbase); defines NA/NMAP/NB for cscreen.inc before including it.
        org $2000
NA      = 15            ; text rows above the map (cscreen.inc)
NMAP    = 0             ; no map rows
NB      = 0             ; no rows below
AUDF1   = $D200
AUDC1   = $D201
AUDCTL  = $D208
SKCTL   = $D20F
R_AUDF1 = $D210
R_AUDCTL= $D218
R_SKCTL = $D21F
R_RANDOM= $D21A
        jmp start
        icl 'common.inc'
        icl 'cscreen.inc'

; start - set up: detect stereo, check POKEY 1, take over the screen (gs_init), draw the static page, then
; fall into the main loop. PASS/FAIL/n-a labels: setres A = 0 pass, 1 fail, 2 n/a; fails counts failures.
start   lda #$7D
        jsr eput
        lda #1
        sta CRSINH
        jsr detect
        jsr silence
        jsr p1check
        jsr gs_init
        ldx #0
        lda #1
        jsr bar
        loc 0,0
        say s_title
        loc 0,2
        say s_p1
        lda p1ok
        beq p1bad
        lda #0
        jmp p1s
p1bad   lda #1
        inc fails
p1s     ldx #2
        jsr setres
        loc 0,3
        say s_p2
        lda stereo
        beq p2m
        loc 0,3
        say s_p2s
        lda #0
        jmp p2s
p2m     loc 0,3
        say s_p2m
        lda #2
p2s     ldx #3
        jsr setres
        ldx #5
ig1     stx t4
        jsr rowtxt
        ldx t4
        inx
        cpx #10
        bne ig1
        loc 0,14
        say s_menu
        loc 0,16
        say s_menu2
        loc 0,12
        say s_mhelp
        lda #0
        sta mode

; main loop: once per frame reset the attract timer, read a key (CH, $FF = none), then run the current mode.
; G runs guided; a key found in keymap (index = mode) switches mode; S (mode 13) runs the sample test
; once and returns to silence. ESC quits.
loop     lda #0
        sta ATRACT      ; keep the screen from going into attract mode
        jsr vsync
        lda CH
        cmp #$FF
        beq nokey
        ldx #$FF
        stx CH
        cmp #$1C        ; ESC
        bne notesc
        jmp quit
notesc  cmp #$3D        ; G
        bne notg
        jsr guided
        jmp loop
notg    ldx #13
fk      cmp keymap,x
        beq found
        dex
        bpl fk
        jmp nokey
found   stx mode
        lda #0
        sta step
        jsr silence
        jsr shownow
        lda mode
        cmp #13
        bne nokey
        jsr smpseq
        lda #0
        sta mode
        jsr silence
nokey   jsr play
        jmp loop

; ---- guided listening test
; guided: reset the step rows (5..9), then for gpos = 0..4 play gmode[gpos] and wait for Y / N / S / ESC.
; Y = PASS (setres 0), N = FAIL (1, fails++), S = skipped (3). Step 1 (right tone) is marked n/a (2) on a mono
; machine. Bars: scheme 3 (yellow) while a step is active. At the end row 13 shows PASS (scheme 2) if fails = 0,
; else FAIL (scheme 4). ESC aborts. Uses t4 as a row counter; clobbers A,X,Y,mode,step.
guided  lda #0
        sta fails
        sta gpos
        sta mode
        jsr silence
        ldx #5
gc1     stx t4
        jsr clrrow
        ldx t4
        jsr rowtxt
        ldx t4
        lda #0
        jsr bar
        ldx t4
        inx
        cpx #10
        bne gc1
        ldx #13
        lda #0
        jsr bar
        ldx #13
        jsr clrrow
gloop   ldx gpos
        cpx #5
        bcc gs1
        jmp gdone
gs1     lda gpos
        cmp #1
        bne gs2
        lda stereo
        bne gs2
        ldx #6          ; mono machine: the right-only step cannot be heard, mark n/a
        lda #2
        jsr setres
        jmp gnext
gs2     lda gpos        ; row = 5 + gpos
        clc
        adc #5
        tax
        lda #3
        jsr bar
        ldx gpos
        lda gmode,x
        sta mode
        lda #0
        sta step
        jsr silence
        ldx #12
        jsr clrrow
        loc 0,12
        say s_ask
        ldx #11
        jsr clrrow
        loc 0,11
        say s_play
        ldx mode
        txa
        asl
        tax
        lda ntab,x
        ldy ntab+1,x
        jsr puts
gwait   lda #0
        sta ATRACT
        jsr vsync
        jsr play
        lda CH
        cmp #$FF
        beq gwait
        ldx #$FF
        stx CH
        cmp #$2B        ; Y
        beq gyes
        cmp #$23        ; N
        beq gno
        cmp #$1C        ; ESC
        bne gw2
        jmp gabort
gw2     cmp #$3E        ; S = skip
        bne gwait
        lda gpos
        clc
        adc #5
        tax
        lda #3
        jsr setres
        jmp gnext
gyes    lda gpos
        clc
        adc #5
        tax
        lda #0
        jsr setres
        jmp gnext
gno     inc fails
        lda gpos
        clc
        adc #5
        tax
        lda #1
        jsr setres
gnext   jsr silence
        inc gpos
        jmp gloop
gdone   lda #0
        sta mode
        jsr silence
        ldx #11
        jsr clrrow
        ldx #12
        jsr clrrow
        lda fails
        bne gbad
        ldx #13
        lda #2
        jsr bar
        loc 0,13
        say s_ok
        jmp gend
gbad    ldx #13
        lda #4
        jsr bar
        loc 0,13
        say s_bad
gend    loc 0,12
        say s_mhelp
        rts
gabort  lda #0
        sta mode
        jsr silence
        ldx #11
        jsr clrrow
        ldx #12
        jsr clrrow
        loc 0,12
        say s_mhelp
        rts

; rowtxt: X = step row (5..9): write its label from gtab at column 0. Preserves X. Clobbers A,Y,sa.
rowtxt  txa
        pha
        sec
        sbc #5
        asl
        tay
        lda gtab,y
        sta sa
        lda gtab+1,y
        sta sa+1
        pla
        pha
        tay
        ldx #0
        jsr locate
        lda sa
        ldy sa+1
        jsr puts
        pla
        tax
        rts

; play: run the active mode's routine once per frame via jtab (indirect jump through jv; each m_xxx ends in rts).
play    lda mode
        asl
        tax
        lda jtab,x
        sta jv
        lda jtab+1,x
        sta jv+1
        jmp (jv)
jtab    .word m_off,m_left,m_right,m_both,m_alt,m_scale,m_chord,m_noise,m_low,m_sweep,m_ditty,m_sl,m_sr,m_off
m_off   rts

; static (noise) on one side only: AUDF 40, AUDC $88 = noise volume 8. m_sr writes the right POKEY
; (R_AUDF1+1 is R_AUDC1).
m_sl    lda #40
        sta AUDF1
        lda #$88
        sta AUDC1
        rts
m_sr    lda #40
        sta R_AUDF1
        lda #$88
        sta R_AUDF1+1
        rts

; sample test: the same 4-bit sample through POKEY volume-only mode, left, right, then both (both only on a mono machine)
; smpseq: smpplay for left (1) and right (2) with a 20-frame gap when stereo, then both (3). Clobbers A,X,Y,t1.
smpseq  lda stereo
        beq sq3
        lda #1
        jsr smpplay
        jsr gap
        lda #2
        jsr smpplay
        jsr gap
sq3     lda #3
        jsr smpplay
        rts
gap     ldx #20         ; ~1/3 second of silence
gp1     jsr vsync
        dex
        bne gp1
        rts
; smpplay: A = side mask (bit 0 left, bit 1 right). Plays sample (16 pages, 4096 bytes, one 4-bit level per
; byte; values must be 0..15) with interrupts off (NMIEN = 0): AUDC = $10 | level ($10 = volume-only),
; held for two scanlines (2 x WSYNC, ~7.9 kHz). $90/$91 = read pointer. Ends with NMIEN = $40 and silence.
smpplay sta smpch
        jsr silence
        sei
        lda #0
        sta NMIEN
        lda #<sample
        sta $90
        lda #>sample
        sta $91
        ldy #0
        ldx #16         ; pages
sl1     lda ($90),y
        ora #$10
        sta t1
        lda smpch
        and #1
        beq sl2
        lda t1
        sta AUDC1
sl2     lda smpch
        and #2
        beq sl3
        lda t1
        sta R_AUDF1+1   ; = R_AUDC1
sl3     sta WSYNC
        sta WSYNC
        iny
        bne sl1
        inc $91
        dex
        bne sl1
        lda #$40        ; VBI back on
        sta NMIEN
        cli
        jmp silence

; --- mode routines (called every frame by play; each just sets the POKEY registers)
; m_left / m_right / m_both: pure tone AUDF 71, AUDC $A8 (pure tone, volume 8).
m_left  lda #71
        sta AUDF1
        lda #$A8
        sta AUDC1
        rts
m_right lda #71
        sta R_AUDF1
        lda #$A8
        sta R_AUDF1+1
        rts
m_both  jsr m_left
        jmp m_right
; swap the tone between left and right about every half second (RTCLOK+2 bit 5 = every 32 frames)
m_alt   lda RTCLOK+2
        and #$20
        beq alt_l
        lda #0
        sta AUDC1
        jmp m_right
alt_l   lda #0
        sta R_AUDF1+1
        jmp m_left
; walk a C major scale on the left (and the right) every 32 frames; step (0..7) indexes scale (AUDF values)
m_scale lda step
        cmp #8
        bcc ms1
        lda #0
        sta step
ms1     lda RTCLOK+2
        and #$1F
        bne ms2
        inc step
ms2     lda step
        and #7
        tax
        lda scale,x
        sta AUDF1
        sta R_AUDF1
        lda #$A8
        sta AUDC1
        sta R_AUDF1+1
        rts
; m_chord: all four POKEY 1 channels (AUDF1/3/5/7 = AUDF1+0/2/4/6) as a chord, pure tone volume 4 ($A4)
m_chord lda #121
        sta AUDF1
        lda #95
        sta AUDF1+2
        lda #81
        sta AUDF1+4
        lda #60
        sta AUDF1+6
        lda #$A4
        sta AUDC1
        sta AUDC1+2
        sta AUDC1+4
        sta AUDC1+6
        rts
; m_noise: noise ($88) on both sides, AUDF 40
m_noise lda #40
        sta AUDF1
        sta R_AUDF1
        lda #$88
        sta AUDC1
        sta R_AUDF1+1
        rts
; 16-bit mode: channels 1+2 joined for a very low tone (AUDCTL $50 = bit 6 channel 1 at 1.79 MHz + bit 4 join
; 1+2; the 16-bit period is AUDF2:AUDF1 = $1000 and the sound comes from channel 2's AUDC)
m_low   lda #$50
        sta AUDCTL
        lda #$00
        sta AUDF1
        lda #$10
        sta AUDF1+2
        lda #$A8
        sta AUDC1+2
        rts
; slow frequency sweep on both channels (AUDF = 2 * frame counter: one full sweep every 128 frames)
m_sweep lda RTCLOK+2
        asl
        sta AUDF1
        sta R_AUDF1
        lda #$A8
        sta AUDC1
        sta R_AUDF1+1
        rts

; stereo ditty, 4 phases of 256 frames: both / left alone (melody an octave down) / right alone / both
; phase = RTCLOK+1 & 3 (t1). Melody note = mel[RTCLOK+2 / 8 & 31] (t2, 8 frames per note, 0 = rest); bass note
; = bass[RTCLOK+2 / 16 & 15]. Left: phase 2 silent, phase 1 melody an octave down (AUDF*2+1), else bass.
; Right: phase 1 silent, else melody. AUDF 0 is a rest: its AUDC is set to 0, else $A8. Clobbers A,X,t1,t2.
m_ditty lda RTCLOK+1
        and #3
        sta t1
        lda RTCLOK+2
        lsr
        lsr
        lsr
        and #31
        tax
        lda mel,x
        sta t2
        lda t1
        cmp #2
        bne dl_a
        lda #0
        beq dl_s
dl_a    cmp #1
        bne dl_b
        lda t2
        beq dl_s
        asl
        adc #1
        jmp dl_s
dl_b    lda RTCLOK+2
        lsr
        lsr
        lsr
        lsr
        and #15
        tax
        lda bass,x
dl_s    sta AUDF1
        beq dt1
        lda #$A8
dt1     sta AUDC1
        lda t1
        cmp #1
        bne dr_a
        lda #0
        beq dt3
dr_a    lda t2
dt3     sta R_AUDF1
        beq dt2
        lda #$A8
dt2     sta R_AUDF1+1
        rts

; silence: AUDCTL = 0 and all AUDF/AUDC (4 channels) of both POKEYs = 0, SKCTL = 3 (leave init mode, key scan on;
; R_SKCTL only if stereo). Clobbers A,X.
silence ldx #7
        lda #0
        sta AUDCTL
si1     sta AUDF1,x
        sta R_AUDF1,x
        dex
        bpl si1
        lda #3
        sta SKCTL
        lda stereo
        beq si2
        sta R_SKCTL
si2     rts

; POKEY 1 check: its random generator must be changing. Out: p1ok = 1 if RANDOM differs from its first
; sample within 256 tries (~30 loops apart), else 0. Clobbers A,X,Y,t1.
p1check lda #0
        sta p1ok
        ldx #0
        lda RANDOM
        sta t1
pk1     ldy #30
pk2     dey
        bne pk2
        lda RANDOM
        cmp t1
        bne pkok
        inx
        bne pk1
        rts
pkok    lda #1
        sta p1ok
        rts

; detect: stereo present when POKEY #2 runs its own random generator while #1 is held in init mode (SKCTL
; bits 0-1 = 0 stops RANDOM). Probe 1: #1 in init, #2 running; probe 2: the other way round. On a mono
; machine $D21x mirrors $D20x so both counters move together. Stereo if exactly one side stayed constant.
; Out: stereo = 0/1; SKCTL and R_SKCTL left at 3. Clobbers A,X,t1..t4.
detect  lda #0
        sta stereo
        lda #0
        ldx #3
        jsr dprobe
        lda t3
        bne dB
        lda t4
        bne dyes
dB      lda #3
        ldx #0
        jsr dprobe
        lda t4
        bne dend
        lda t3
        beq dend
dyes    lda #1
        sta stereo
dend    lda #3
        sta SKCTL
        sta R_SKCTL
        rts

; A = SKCTL for POKEY 1, X = SKCTL for POKEY 2; counts random changes in t3 (P1) and t4 (P2): after a settling
; delay, RANDOM / R_RANDOM are sampled 8 times (~20 loops apart) against a first reading (t1/t2). Interrupts off.
; Clobbers A,X,Y,t1..t4.
dprobe  sei
        sta SKCTL
        stx R_SKCTL
        lda #0
        sta t3
        sta t4
        ldx #30
dl1     dex
        bne dl1
        lda RANDOM
        sta t1
        lda R_RANDOM
        sta t2
        ldx #0
dl2     ldy #20
dl3     dey
        bne dl3
        lda RANDOM
        cmp t1
        beq dl4
        inc t3
dl4     lda R_RANDOM
        cmp t2
        beq dl5
        inc t4
dl5     inx
        cpx #8
        bne dl2
        cli
        rts
; shownow: write "Playing: <name of mode>" on row 11. Clobbers A,X,Y.
shownow ldx #11
        jsr clrrow
        loc 0,11
        say s_play
        lda mode
        asl
        tax
        lda ntab,x
        ldy ntab+1,x
        jmp puts

; quit: silence, give the OS screen back (gs_off clears it), show the cursor again, return to DOS.
quit    jsr silence
        jsr gs_off
        lda #0
        sta CRSINH
        rts

; ---- data
stereo  .byte 0         ; 1 = second POKEY found
p1ok    .byte 0         ; 1 = POKEY 1 random generator running
fails   .byte 0         ; guided steps answered N
gpos    .byte 0         ; guided step 0..4
mode    .byte 0         ; current mode 0..13
step    .byte 0         ; scale step
jv      .word 0         ; indirect jump vector used by play
gmode   .byte 1,2,3,7,9 ; mode used by each guided step
smpch   .byte 0
keymap  .byte $32,$1F,$1E,$1A,$18,$1D,$1B,$33,$35,$30,$3A,$00,$28,$3E   ; keys 0-9, D, L, R, S (OS key codes)
scale   .byte 121,107,95,90,80,71,63,59   ; AUDF for a C major scale
ntab    .word n0,n1,n2,n3,n4,n5,n6,n7,n8,n9,n10,n11,n12,n13   ; mode names
n11     .byte 'static, LEFT only',0
n12     .byte 'static, RIGHT only',0
n13     .byte 'sample: left, right, both (4-bit, volume-only)',0
n0       .byte 'silence',0
n1      .byte 'LEFT tone (POKEY 1)',0
n2      .byte 'RIGHT tone (POKEY 2)',0
n3      .byte 'both channels',0
n4      .byte 'alternating left / right',0
n5      .byte 'scale, left and right',0
n6      .byte '4-voice chord (POKEY 1)',0
n7      .byte 'noise, both',0
n8      .byte '16-bit low tone (POKEY 1)',0
n9      .byte 'sweep, both',0
n10     .byte 'ditty: low bass LEFT, high melody RIGHT',0
bass    .byte 243,162,144,162,181,144,181,216,243,162,144,162,181,216,243,243   ; ditty bass AUDF, 16 notes
mel     .byte 60,47,39,47,60,47,39,0,53,39,35,39,53,39,35,0   ; ditty melody AUDF, 32 notes (0 = rest)
        .byte 60,47,39,29,23,29,39,47,35,39,35,29,39,47,60,0
gtab    .word g1,g2,g3,g4,g5
g1      .byte 'STEP 1  LEFT tone (or mono tone)',0
g2      .byte 'STEP 2  RIGHT tone',0
g3      .byte 'STEP 3  both channels together',0
g4      .byte 'STEP 4  noise',0
g5      .byte 'STEP 5  frequency sweep',0
s_title .byte 'SNDTEST  POKEY audio, mono and stereo',0
s_p1    .byte 'POKEY 1 ($D200) random generator',0
s_p2    .byte 'POKEY 2 ($D210)',0
s_p2s   .byte 'POKEY 2 ($D210) STEREO found',0
s_p2m   .byte 'POKEY 2 ($D210) none (mono)',0
s_ask   .byte 'Did you hear it?  Y yes  N no  S skip',0
s_play  .byte 'Playing: ',0
s_mhelp .byte 'G guided  0-9 free play  D ditty  ESC exit',0
s_menu  .byte '0 off 1 L 2 R 3 both 4 alt 5 scale 6 chord D ditty',0
s_menu2 .byte 'L static left  R static right  S sample',0
sample  ins 'sample.bin'        ; 4096 bytes of 4-bit levels (0..15), played by smpplay
s_ok    .byte 'RESULT: PASS - all heard steps OK',0
s_bad   .byte 'RESULT: FAIL - a step was not heard',0
        run start
