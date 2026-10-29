; SNDTEST.COM - POKEY audio test, mono and stereo. Detects a second POKEY ($D210) and checks the first one's
; random generator automatically. G runs a guided listening test (left, right, both, noise, sweep) where you
; answer Y / N and get PASS or FAIL per step; keys 0-9 are free-play tones. ESC exits.
        org $2000
NA      = 15
NMAP    = 0
NB      = 0
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
        loc 0,12
        say s_mhelp
        lda #0
        sta mode

loop    lda #0
        sta ATRACT
        jsr vsync
        lda CH
        cmp #$FF
        beq nokey
        ldx #$FF
        stx CH
        cmp #$1C
        bne notesc
        jmp quit
notesc  cmp #$3D
        bne notg
        jsr guided
        jmp loop
notg    ldx #9
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
nokey   jsr play
        jmp loop

; ---- guided listening test
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
        ldx #6
        lda #2
        jsr setres
        jmp gnext
gs2     lda gpos
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
        cmp #$2B
        beq gyes
        cmp #$23
        beq gno
        cmp #$1C
        bne gw2
        jmp gabort
gw2     cmp #$3E
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

; X = step row (5..9): write its label
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

; run the active mode once per frame
play    lda mode
        asl
        tax
        lda jtab,x
        sta jv
        lda jtab+1,x
        sta jv+1
        jmp (jv)
jtab    .word m_off,m_left,m_right,m_both,m_alt,m_scale,m_chord,m_noise,m_low,m_sweep
m_off   rts

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
; swap the tone between left and right about every half second
m_alt   lda RTCLOK+2
        and #$20
        beq alt_l
        lda #0
        sta AUDC1
        jmp m_right
alt_l   lda #0
        sta R_AUDF1+1
        jmp m_left
; walk a C major scale on the left (and the right) every 32 frames
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
m_noise lda #40
        sta AUDF1
        sta R_AUDF1
        lda #$88
        sta AUDC1
        sta R_AUDF1+1
        rts
; 16-bit mode: channels 1+2 joined for a very low tone
m_low   lda #$50
        sta AUDCTL
        lda #$00
        sta AUDF1
        lda #$10
        sta AUDF1+2
        lda #$A8
        sta AUDC1+2
        rts
; slow frequency sweep on both channels
m_sweep lda RTCLOK+2
        asl
        sta AUDF1
        sta R_AUDF1
        lda #$A8
        sta AUDC1
        sta R_AUDF1+1
        rts

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

; POKEY 1 check: its random generator must be changing
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

; stereo present when POKEY #2 runs its own random generator while #1 is held in init mode
detect  lda #0
        sta stereo
        sta t3
        sta t4
        sei
        lda #0
        sta SKCTL
        lda #3
        sta R_SKCTL
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
        lda #3
        sta SKCTL
        cli
        lda t3
        bne dend
        lda t4
        beq dend
        lda #1
        sta stereo
dend    rts

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

quit    jsr silence
        jsr gs_off
        lda #0
        sta CRSINH
        rts

stereo  .byte 0
p1ok    .byte 0
fails   .byte 0
gpos    .byte 0
mode    .byte 0
step    .byte 0
jv      .word 0
gmode   .byte 1,2,3,7,9
keymap  .byte $32,$1F,$1E,$1A,$18,$1D,$1B,$33,$35,$30   ; keys 0 1 2 3 4 5 6 7 8 9 (OS key codes)
scale   .byte 121,107,95,90,80,71,63,59
ntab    .word n0,n1,n2,n3,n4,n5,n6,n7,n8,n9
n0      .byte 'silence',0
n1      .byte 'LEFT tone (POKEY 1)',0
n2      .byte 'RIGHT tone (POKEY 2)',0
n3      .byte 'both channels',0
n4      .byte 'alternating left / right',0
n5      .byte 'scale, left and right',0
n6      .byte '4-voice chord (POKEY 1)',0
n7      .byte 'noise, both',0
n8      .byte '16-bit low tone (POKEY 1)',0
n9      .byte 'sweep, both',0
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
s_mhelp .byte 'G guided test   0-9 free play   ESC exit',0
s_menu  .byte '0 off 1 L 2 R 3 both 4 alt 5 scale 6 chord',0
s_ok    .byte 'RESULT: PASS - all heard steps OK',0
s_bad   .byte 'RESULT: FAIL - a step was not heard',0
        run start
