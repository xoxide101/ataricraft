; WGET.COM - fetch a URL through the FujiNet N: device (N1:, $71) and show it on screen.
; Also saves to D1:WGET.TXT when a DOS disk is mounted. Needs FujiNet on and the relay for anything but N:TEST://.
; Type a URL such as http://example.com/ at the prompt. Polls status (no PROCEED support).
        org $2000
CIOV    = $E456
SIOV    = $E459
ICCOM   = $0342
ICBAL   = $0344
ICBAH   = $0345
ICBLL   = $0348
ICBLH   = $0349
ICAX1   = $034A
ICAX2   = $034B
CH      = $02FC
DDEVIC  = $0300
SPEC    = $3000
STAT    = $3100
BUF     = $3200

start   lda #0
        sta saved
        lda #<prompt
        ldy #>prompt
        jsr puts
        ; get the URL line after the "N:" prefix
        lda #$05
        sta ICCOM
        lda #<(SPEC+2)
        sta ICBAL
        lda #>(SPEC+2)
        sta ICBAH
        lda #200
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV
        lda #'N'
        sta SPEC
        lda #':'
        sta SPEC+1
        ; try to open the output file on IOCB1
        lda #$03
        sta ICCOM+$10
        lda #<fname
        sta ICBAL+$10
        lda #>fname
        sta ICBAH+$10
        lda #8
        sta ICAX1+$10
        lda #0
        sta ICAX2+$10
        ldx #$10
        jsr CIOV
        bmi nofile
        lda #1
        sta saved
nofile  ; open N: for reading, LF translated to EOL
        lda #'O'
        sta cmd
        lda #$80
        sta stats
        lda #<SPEC
        sta bl
        lda #>SPEC
        sta bh
        lda #0
        sta ll
        lda #1
        sta lh
        lda #4
        sta al
        lda #2
        sta ah
        jsr sio
        cpy #1
        beq opened
        lda #<emsg
        ldy #>emsg
        jsr puts
        jmp finish
opened
loop    lda #'S'
        sta cmd
        lda #$40
        sta stats
        lda #<STAT
        sta bl
        lda #>STAT
        sta bh
        lda #4
        sta ll
        lda #0
        sta lh
        sta al
        sta ah
        jsr sio
        lda STAT
        ora STAT+1
        beq idle
        lda STAT+1
        beq lenok
        lda #255
        sta STAT
lenok   lda #'R'
        sta cmd
        lda #<BUF
        sta bl
        lda #>BUF
        sta bh
        lda STAT
        sta ll
        sta al
        lda #0
        sta lh
        sta ah
        jsr sio
        ; echo the chunk to the screen and, if open, to the file
        lda STAT
        sta ICBLL
        lda #0
        sta ICBLH
        lda #<BUF
        sta ICBAL
        lda #>BUF
        sta ICBAH
        lda #$0B
        sta ICCOM
        ldx #0
        jsr CIOV
        lda saved
        bne wfile
        jmp loop
wfile   lda STAT
        sta ICBLL+$10
        lda #0
        sta ICBLH+$10
        lda #<BUF
        sta ICBAL+$10
        lda #>BUF
        sta ICBAH+$10
        lda #$0B
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        jmp loop
idle    lda STAT+2
        beq finish
        jmp loop
finish  lda #'C'
        sta cmd
        lda #0
        sta stats
        sta ll
        sta lh
        sta al
        sta ah
        lda #<BUF
        sta bl
        lda #>BUF
        sta bh
        jsr sio
        lda saved
        beq nosave
        lda #$0C
        sta ICCOM+$10
        ldx #$10
        jsr CIOV
        lda #<smsg
        ldy #>smsg
        jsr puts
nosave  lda #<dmsg
        ldy #>dmsg
        jsr puts
        lda #$FF
        sta CH
wait    lda CH
        cmp #$FF
        beq wait
        rts

; print the EOL-terminated string at A/Y on the screen
puts    sta ICBAL
        sty ICBAH
        lda #$09
        sta ICCOM
        lda #255
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jmp CIOV

; one SIO call to device $71 using the variables below; returns status in Y
sio     lda #$71
        sta DDEVIC
        lda #1
        sta DDEVIC+1
        lda cmd
        sta DDEVIC+2
        lda stats
        sta DDEVIC+3
        lda bl
        sta DDEVIC+4
        lda bh
        sta DDEVIC+5
        lda #$0F
        sta DDEVIC+6
        lda ll
        sta DDEVIC+8
        lda lh
        sta DDEVIC+9
        lda al
        sta DDEVIC+10
        lda ah
        sta DDEVIC+11
        jsr SIOV
        rts

cmd     .byte 0
stats   .byte 0
bl      .byte 0
bh      .byte 0
ll      .byte 0
lh      .byte 0
al      .byte 0
ah      .byte 0
saved   .byte 0
fname   .byte 'D1:WGET.TXT',$9B
prompt  .byte 'URL? ',$9B
emsg    .byte 'Open failed',$9B
smsg    .byte 'Saved D1:WGET.TXT',$9B
dmsg    .byte 'Done - press a key',$9B
