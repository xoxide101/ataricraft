; pitch.inc - POKEY AUDF for MIDI notes 47..108 (64 kHz clock, pure tone): round(63921 / (2 f)) - 1, clamped to 255. Same as tools/midiconv.cjs.
ptab
        .byte 255,243,230,217,204,193,182,172,162,153,144,136,128,121,114,108
        .byte 102,96,91,85,81,76,72,68,64,60,57,53,50,47,45,42
        .byte 40,37,35,33,31,30,28,26,25,23,22,21,19,18,17,16
        .byte 15,14,13,13,12,11,10,10,9,9,8,8,7,7
