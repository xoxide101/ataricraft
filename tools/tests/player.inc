; player.inc - shared shell for MIDIPLAY.COM and MP3PLAY.COM (needs common.inc first, MADS).
; The including program defines: s_title (zero-terminated), s_kind (zero-terminated), magic (4 bytes), doplay
; (plays the file in BUF; returns when it ends or a key is pressed; keeps interrupts as it found them), and prepfile
; (called after a file is loaded, may convert BUF in place; rts if nothing to do).
; Flow: ask for a file name, load it to BUF, check the 4-byte magic, then L / R / B pick the output (left POKEY,
; right POKEY, both), SPACE plays, N loads another file, ESC exits to DOS.
;
; MEMORY: the program's code is at $2000 up; the file is loaded into BUF $4000..BUFTOP-1 ($B7FF), at most
;   $7800 bytes minus one (a file that fills the buffer is "too big"). Text goes to the E: screen editor
;   (IOCB 0) for the prompt and to GR.0 screen RAM via common.inc locate/puts for the status page.
; ZERO PAGE: pp ($90-$91) and wt ($92) are for the .PMD player in the including program; common.inc owns
;   $80..$8B (sp, sa, si, v16, t1..t4); midread.inc uses $A0..$C6.
; VARIABLES: route (1 = left, 2 = right, 3 = both; bit 0 = left POKEY, bit 1 = right POKEY), stereo (1 when a
;   second POKEY at $D210 was found), ioerr, size (bytes loaded), fname/path/dname (typed name, CIO name, text).
; CONNECTIONS: this file defines start, getname, loadfile, draw, silence, detect, route, stereo, size and the
;   AUDxx/R_xx equates; it calls the includer's doplay and prepfile and the includer's s_title/s_kind/magic.
; KEYS (KBCODE values as returned by getkey): $1C ESC, $23 N, $00 L, $28 R, $15 B, $21 SPACE.
; POKEY #2 sits at $D210..$D21F (the stereo upgrade); on a mono machine those addresses mirror POKEY #1.
AUDF1   = $D200
AUDC1   = $D201
AUDCTL  = $D208
SKCTL   = $D20F
R_AUDF1 = $D210
R_AUDC1 = $D211
R_SKCTL = $D21F
R_RANDOM= $D21A
SDMCTL  = $022F         ; shadow of DMACTL
DMACTL  = $D400         ; ANTIC DMA control (0 = screen DMA off)
BUF     = $4000         ; file buffer start
BUFTOP  = $B800         ; first address after the buffer

pp      = $90           ; (2) .PMD record pointer
wt      = $92           ; frames to wait before the next .PMD record

        .macro loc      ; loc col,row - position the text cursor (X = col, Y = row)
        ldx #:1
        ldy #:2
        jsr locate
        .endm
        .macro say      ; say label - print a zero-terminated string at the cursor
        lda #<:1
        ldy #>:1
        jsr puts
        .endm

; start - main program. Hide the cursor, default route = both, detect stereo, then loop:
; newfile (prompt, load, retry on error) -> mloop (key commands) until ESC. Entered once from the includer.
start   lda #1
        sta CRSINH      ; hide the cursor
        lda #3
        sta route
        jsr detect
        jsr silence
newfile lda #$7D        ; clear screen
        jsr eput
        lda #<s_title
        ldy #>s_title
        jsr eprint
        lda #$9B        ; EOL
        jsr eput
        lda #<s_ask
        ldy #>s_ask
        jsr eprint
        jsr getname
        bcs quit        ; blank line = exit
        jsr loadfile
        bcc ldok
        jsr showerr
        jmp newfile
ldok    jsr draw
mloop   jsr getkey
        cmp #$1C        ; ESC
        beq quit
        cmp #$23        ; N
        bne mk1
        jmp newfile
mk1     cmp #$00        ; L
        bne mk2
        lda #1
        bne setr
mk2     cmp #$28        ; R
        bne mk3
        lda #2
        bne setr
mk3     cmp #$15        ; B
        bne mk4
        lda #3
setr    sta route
        jsr draw
        jmp mloop
mk4     cmp #$21        ; SPACE
        bne mloop
        loc 0,14
        say s_playing
        jsr doplay
        jsr silence
        loc 0,14
        say s_done
        jmp mloop
quit    jsr silence
        lda #$7D
        jsr eput
        lda #0
        sta CRSINH
        rts             ; back to DOS

; eprint: A/Y = address of an EOL ($9B) terminated string -> screen editor (CIO put-chars, IOCB 0).
; The length counts up to and including the EOL (or stops at a 0 byte). Clobbers A,X,Y,sa.
eprint  sta sa
        sty sa+1
        ldy #0
ep1     lda (sa),y
        beq ep2
        iny
        cmp #$9B
        bne ep1
ep2     sty ICBLL
        lda #0
        sta ICBLH
        lda sa
        sta ICBAL
        lda sa+1
        sta ICBAH
        lda #9
        sta ICCOM
        ldx #0
        jmp CIOV

; getname: read a line from E: (CIO get-record, IOCB 0, 60 bytes max) into fname, then build path (EOL
; terminated, for CIO open; "D:" is prefixed when the name has no ':') and dname (zero terminated, for display).
; Out: carry set = blank line (just EOL), else clear. Clobbers A,X,Y.
getname lda #5
        sta ICCOM
        lda #<fname
        sta ICBAL
        lda #>fname
        sta ICBAH
        lda #60
        sta ICBLL
        lda #0
        sta ICBLH
        ldx #0
        jsr CIOV
        lda fname
        cmp #$9B
        beq gnblank
        ldy #0
gn1     lda fname,y
        cmp #$9B
        beq gn2
        cmp #':'
        beq gn3
        iny
        bne gn1
gn2     lda #'D'
        sta path
        sta dname
        lda #':'
        sta path+1
        sta dname+1
        ldx #2
        bne gn4
gn3     ldx #0
gn4     ldy #0
gn5     lda fname,y
        cmp #$9B
        beq gn6
        sta path,x
        sta dname,x
        inx
        iny
        bne gn5
gn6     lda #$9B
        sta path,x
        lda #0
        sta dname,x
        clc
        rts
gnblank sec
        rts

; loadfile: open path on IOCB 1 (X=$10; CIO 3 = open, mode 4 = read), read up to BUFTOP-BUF bytes into BUF (CIO 7,
; get chars), save the count in size (ICBLL/H after the call), close (CIO 12). End of file (136) counts as OK.
; Then size must be < $7800 (else ioerr 1) and >= 8 (else bad), prepfile runs, and BUF[0..3] must equal magic.
; Out: carry set = error, ioerr = CIO status, 0 = wrong file type, 1 = too big; carry clear = loaded.
; Clobbers A,X,Y.
loadfile ldx #$10
        lda #3          ; CIO open
        sta ICCOM,x
        lda #<path
        sta ICBAL,x
        lda #>path
        sta ICBAH,x
        lda #4          ; open for input
        sta ICAX1,x
        lda #0
        sta ICAX2,x
        jsr CIOV
        bpl lf1
        sty ioerr
        sec
        rts
lf1     ldx #$10
        lda #7          ; CIO get characters
        sta ICCOM,x
        lda #<BUF
        sta ICBAL,x
        lda #>BUF
        sta ICBAH,x
        lda #<(BUFTOP-BUF)
        sta ICBLL,x
        lda #>(BUFTOP-BUF)
        sta ICBLH,x
        jsr CIOV
        sty ioerr
        ldx #$10
        lda ICBLL,x
        sta size
        lda ICBLH,x
        sta size+1
        lda #12
        sta ICCOM,x     ; CIO close
        jsr CIOV
        lda ioerr
        cmp #1
        beq lf2
        cmp #136        ; EOF is the normal end of a short read
        bne lferr
lf2     lda size+1
        cmp #>(BUFTOP-BUF)
        bcc lf3
        lda #1
        sta ioerr
        sec
        rts
lf3     lda size+1
        bne lf4
        lda size
        cmp #8
        bcc lfbad       ; too short to be any music file
lf4     jsr prepfile    ; includer may convert BUF in place
        ldx #3
lf5     lda BUF,x
        cmp magic,x
        bne lfbad
        dex
        bpl lf5
        clc
        rts
lfbad   lda #0
        sta ioerr
lferr   sec
        rts

; showerr: print the message for ioerr at row 8 and wait for a key. Clobbers A,X,Y.
showerr loc 0,8
        lda ioerr
        bne se1
        say s_bad
        jmp se9
se1     cmp #1
        bne se2
        say s_big
        jmp se9
se2     say s_ioerr
        lda ioerr
        jsr puthex
se9     loc 0,10
        say s_any
        jsr getkey
        rts

; draw: clear the screen and show title, file name, size, kind, current route, stereo status and the key help.
; Clobbers A,X,Y,v16.
draw    lda #$7D
        jsr eput
        loc 0,0
        say s_title
        loc 0,2
        say s_file
        say dname
        loc 0,3
        say s_size
        lda size
        sta v16
        lda size+1
        sta v16+1
        jsr putdec
        say s_bytes
        loc 0,4
        say s_kind
        loc 0,6
        say s_route
        lda route
        asl             ; route*2 indexes rtab (words)
        tax
        lda rtab,x
        ldy rtab+1,x
        jsr puts
        loc 0,7
        lda stereo
        beq dr1
        say s_st
        jmp dr2
dr1     say s_mono
dr2     loc 0,9
        say s_k1
        loc 0,10
        say s_k2
        loc 0,11
        say s_k3
        loc 0,12
        say s_k4
        rts

; ---- POKEY helpers
; silence: AUDCTL = 0, all four AUDF/AUDC pairs = 0 on POKEY 1 (and POKEY 2 when stereo), SKCTL = 3
; (leave init mode, keyboard scan on). Clobbers A,X.
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

; detect: stereo present when POKEY #2 runs its own random generator while #1 is held in init mode (SKCTL
; bits 0-1 = 0 stops RANDOM). Probe 1: #1 in init, #2 running; probe 2: the other way round. On a mono
; machine $D21x mirrors $D20x so the writes hit the same chip and RANDOM/R_RANDOM change together.
; Stereo if one side stayed constant (t3/t4 = 0 changes) while the other one changed. Out: stereo = 0/1.
; Leaves both SKCTL at 3. Clobbers A,X,t1..t4.
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

; dprobe: A -> SKCTL, X -> R_SKCTL, wait for the generators to settle, then sample RANDOM and R_RANDOM
; 8 times (~20 loops apart). t3 = number of samples where RANDOM changed, t4 = same for R_RANDOM.
; Interrupts are off during the probe. Clobbers A,X,Y,t1..t4.
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

; ---- data. fname/path/dname are 64-byte buffers (typed line, CIO name, display name); rtab = route text table
route   .byte 3
stereo  .byte 0
ioerr   .byte 0
size    .word 0
fname   .ds 64
path    .ds 64
dname   .ds 64
rtab    .word 0,r1,r2,r3
r1      .byte 'LEFT only (POKEY 1)',0
r2      .byte 'RIGHT only (POKEY 2)',0
r3      .byte 'BOTH (left and right)',0
s_ask   .byte 'File (D1:NAME.EXT, blank = exit)',$9B
s_file  .byte 'File:   ',0
s_size  .byte 'Size:   ',0
s_bytes .byte ' bytes',0
s_route .byte 'Output: ',0
s_st    .byte 'POKEY 2 found: stereo',0
s_mono  .byte 'Mono machine: L, R and B sound the same',0
s_k1    .byte 'L  left only',0
s_k2    .byte 'R  right only',0
s_k3    .byte 'B  both',0
s_k4    .byte 'SPACE play (any key stops)  N new file  ESC exit',0
s_playing .byte 'Playing...                    ',0
s_done  .byte 'Done.                          ',0
s_bad   .byte 'Not a valid file for this player.',0
s_big   .byte 'File too big for memory.',0
s_ioerr .byte 'DOS error $',0
s_any   .byte 'Press a key',0
