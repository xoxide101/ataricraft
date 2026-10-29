; SNDTEST.COM - POKEY test: detects a second (stereo) POKEY at $D210 and plays tones on the left, right or both. ESC exits.
        org $2000
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

start    lda #$7D
        jsr eput
        lda #1
        sta CRSINH
        jsr detect
        jsr silence
        ldx #0
        ldy #0
        jsr locate
        lda #<s_title
        ldy #>s_title
        jsr puts
        ldx #0
        ldy #2
        jsr locate
        lda stereo
        bne st_y
        lda #<s_mono
        ldy #>s_mono
        jmp st_p
st_y    lda #<s_ster
        ldy #>s_ster
st_p    jsr puts
        ldx #0
        ldy #4
        jsr locate
        lda #<s_menu
        ldy #>s_menu
        jsr puts
        ldx #0
        ldy #5
        jsr locate
        lda #<s_menu2
        ldy #>s_menu2
        jsr puts
        ldx #0
        ldy #6
        jsr locate
        lda #<s_menu3
        ldy #>s_menu3
        jsr puts
        ldx #0
        ldy #7
        jsr locate
        lda #<s_menu4
        ldy #>s_menu4
        jsr puts
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
notesc  ldx #9
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
; walk a C major scale on the left (and the right a third up) every 24 frames
m_scale lda RTCLOK+2
        sta t1
        lda step
        cmp #8
        bcc sc1
        lda #0
        sta step
sc1     lda RTCLOK+2
        and #$1F
        bne sc2
        inc step
sc2     lda step
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
; 16-bit mode: channels 1+2 joined for a very low tone, left only
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

; stereo present when POKEY #2 runs its own random generator while #1 is held in init mode
detect  lda #0
        sta stereo
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
        stx t3
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

shownow ldx #0
        ldy #14
        jsr locate
        lda #<s_blank
        ldy #>s_blank
        jsr puts
        ldx #0
        ldy #14
        jsr locate
        lda #<s_play
        ldy #>s_play
        jsr puts
        lda mode
        asl
        tax
        lda ntab,x
        ldy ntab+1,x
        jmp puts

quit    jsr silence
        lda #0
        sta AUDCTL
        sta CRSINH
        lda #$7D
        jmp eput

stereo  .byte 0
mode    .byte 0
step    .byte 0
jv      .word 0
keymap  .byte $32,$1F,$1E,$1A,$18,$1D,$1B,$33,$35,$30   ; keys 0 1 2 3 4 5 6 7 8 9 (OS key codes)
scale   .byte 121,107,95,90,80,71,63,59
ntab    .word n0,n1,n2,n3,n4,n5,n6,n7,n8,n9
n0      .byte 'silence',0
n1      .byte 'LEFT pure tone (POKEY 1)',0
n2      .byte 'RIGHT pure tone (POKEY 2)',0
n3      .byte 'both channels',0
n4      .byte 'alternating left / right',0
n5      .byte 'scale, left and right',0
n6      .byte '4-voice chord (POKEY 1)',0
n7      .byte 'noise, both',0
n8      .byte '16-bit low tone (POKEY 1)',0
n9      .byte 'sweep, both',0
s_title .byte 'SNDTEST  POKEY audio, mono and stereo',0
s_mono  .byte 'Second POKEY: not found (mono machine)',0
s_ster  .byte 'Second POKEY: FOUND (stereo)',0
s_blank .byte '                                        ',0
s_play  .byte 'Playing: ',0
s_menu  .byte '0 silence  1 left  2 right  3 both',0
s_menu2 .byte '4 alternate  5 scale  6 chord',0
s_menu3 .byte '7 noise  8 16-bit low  9 sweep',0
s_menu4 .byte 'ESC exits',0
        run start
