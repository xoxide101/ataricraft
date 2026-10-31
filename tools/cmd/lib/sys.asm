; sys.asm - equates shared by CMD.COM and every stand-alone tool.
; Pure definitions, no code. Sections: OS vectors/IOCB/DCB/zero-page names, scratch zero page,
; the program memory map and the DB-relative data block layout.
CIOV    = $E456         ; CIO entry
SIOV    = $E459         ; SIO entry
ICHID   = $0340
ICCOM   = $0342
ICSTA   = $0343
ICBAL   = $0344
ICBAH   = $0345
ICBLL   = $0348
ICBLH   = $0349
ICAX1   = $034A
ICAX2   = $034B
DDEVIC  = $0300
DUNIT   = $0301
DCOMND  = $0302
DSTATS  = $0303
DBUFLO  = $0304
DBUFHI  = $0305
DTIMLO  = $0306
DBYTLO  = $0308
DBYTHI  = $0309
DAUX1   = $030A
DAUX2   = $030B
HATABS  = $031A
; ---- OS RAM / hardware names ----
RTCLOK  = $12           ; 3-byte frame clock, $12-$14
DOSVEC  = $0A           ; DOS run vector (jump here to return to DOS)
RUNAD   = $02E0         ; run address of a loaded binary
INITAD  = $02E2         ; init address of a binary load segment
MEMLO   = $02E7         ; lowest free RAM
RAMTOP  = $6A           ; top of RAM, in pages
ATRACT  = $4D           ; attract-mode counter (write 0 to keep colours alive)
CH      = $02FC         ; last key code, $FF = none
PORTB   = $D301         ; PIA port B: bit 0 = OS ROM, upper bits = XL/XE banking
COLDST  = $0244         ; non-zero forces a cold start on reset
BASICF  = $03F8         ; non-zero when BASIC is disabled
CRSINH  = $02F0         ; cursor inhibit flag

EOL     = $9B           ; ATASCII end of line
API_VER = 1             ; version byte of the plug-in API table in cmd.asm

; zero page (free when no BASIC floating point is in use): ARG = command line cursor,
; T0/T1 = pointer scratch, N0-N5 = number/loop scratch. Routines clobber these freely.
ARG     = $D4
T0      = $D6
T1      = $D8
N0      = $DA
N1      = $DB
N2      = $DC
N3      = $DD
N4      = $DE
N5      = $DF

; memory map: CODE $3800 = program start; DB = data block (variables below);
; IOBUF $7000-$7FFF = 4K general I/O buffer; LNMEM $8000 = LONGNAME.TXT cache (max $0FFF bytes);
; PLUG $9000 = plug-in (.CMX) load area (max $0BFF bytes)
CODE    = $3800
        .ifndef DB
DB      = $6000         ; data block (CMD.COM moves it up because its code outgrew $6000)
        .endif
LINE    = DB+$0000         ; 128  command line
TOK     = DB+$0080         ; 64   current token
FSPEC   = DB+$00C0         ; 64   file spec 1
FSPEC2  = DB+$0100         ; 64   file spec 2
CWD     = DB+$0140         ; 48   current folder, e.g. D1:>GAMES>
NAMEB   = DB+$0170         ; 16   8.3 name built from a directory record
DREC    = DB+$0380         ; 80   directory record
LNB     = DB+$01C0         ; 64   long name scratch
PATHV   = DB+$0200         ; 48   PATH variable
PROMPTV = DB+$0230         ; 16   PROMPT text
ENVB    = DB+$0240         ; 192  SET variables, NAME=VALUE,$9B ... $00
DATEB   = DB+$03D0         ; 16   DATE text (session only)
TIMEB   = DB+$03E0         ; 16   TIME text (session only)
SCR     = DB+$0300         ; 64   scratch
V_ERR   = DB+$0340
V_PCH   = DB+$0341
V_PSX   = DB+$0342
V_PSY   = DB+$0343
V_SPL   = DB+$0344
V_SPH   = DB+$0345
V_BLL   = DB+$0346
V_BLH   = DB+$0347
V_DOS   = DB+$0348         ; 0=DOS 2.x 1=MyDOS 2=SpartaDOS(X) 3=other (BW-DOS ...)
V_FREE  = DB+$0349         ; 2 bytes, free sectors from the directory footer
V_LNL   = DB+$034B         ; 2 bytes, LONGNAME.TXT cache length
V_FLG   = DB+$034D         ; command flags
V_CNT   = DB+$034E         ; 2 bytes, generic counter
V_QUIT  = DB+$0350
V_TOOL  = DB+$0351         ; 1 when running as a stand-alone tool
V_NSEL  = DB+$0352
V_ECHO  = DB+$0353
V_BAT   = DB+$0354         ; script nesting
V_LNOK  = DB+$0355
V_A0    = DB+$0358         ; 8 bytes of command scratch
V_A1    = DB+$0360
V_A2    = DB+$0368
V_FNL   = DB+$0370
V_RC    = DB+$0371
V_BPL   = DB+$0372
V_BPH   = DB+$0373
V_LE    = DB+$0374         ; 2 bytes, end of the LONGNAME.TXT cache
TABF    = DB+$0400         ; 1 when COMPLETE ON
TC_N    = DB+$0401         ; length of the line being typed
TC_PS   = DB+$0402         ; start of the name part of the last word
TC_PL   = DB+$0403
TC_CNT  = DB+$0404         ; matches found
TC_D    = DB+$0405
TC_D1   = DB+$0406         ; first match is a folder
TC_TS   = DB+$0407         ; start of the last word
TC_SP   = DB+$0408         ; 1 when the last word is not the first
TC_CM   = DB+$0410         ; 40 text all matches have in common
IOBUF   = $7000
IOBLEN  = $1000
LNMEM   = $8000
LNMAX   = $0FFF
PLUG    = $9000
PLUGMAX = $0BFF
