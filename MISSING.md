# Ataricraft: what is missing or only partly working

Status key: OK = works and was tested, PART = partly works, NO = not done.
Research verdicts come from web research and were not tested in this project.

## Machine models
| Model | Status | Notes |
|---|---|---|
| 400 / 800 (OS-A, OS-B, NTSC, PAL) | OK | Boots to Memo Pad on both cores. BASIC is a cartridge (left slot), so the BAS toggle is disabled. 16K RAM option accepted, not confirmed as 16K. |
| 600XL / 800XL / 130XE / XEGS | OK | Built-in BASIC; holding Option at boot disables it. With BASIC off and no disk, Self Test appears, as on real XLs. |
| 1200XL | PART | Function keys F1-F4 mapped as a guess; F5-F12 inert. |
| 1400XL | PART | Runs as plain XL hardware. ROM 00c82145 gives garbage on Atari800 and is not confirmed. Not tested on Altirra. |
| 1440XKD | PART | Added, not yet booted on either core. |
| 1450XLD | PART | Self Test on Atari800. Altirra shows a dark red block, cause unknown. |
| 5200 | PART | Atari800 core only. Carts and the keypad work (Centipede, Missile Command, Galaxian). Altirra maps the cart but shows black. No analog controller layout yet. |

### 1400XL / 1440XKD / 1450XLD hardware that is not emulated
- Votrax-style voice synthesizer (1400XL / 1450XLD) and its speech ROM interface. Needs hooks into the core's hardware registers, not available now.
- Built-in 300 baud modem.
- Parallel bus (PBI) for the external expansion case.
- Built-in disk drives of the XLD: the disks work only as ordinary D1:/D2:.
- 1400XL/XLD own keyboard layout and function keys.

## Software tools
| Item | Status |
|---|---|
| 80COL.COM (software 80-column E: handler with /ON /OFF) | built: 80x24 in ANTIC mode F, 4x8 cells, 12K at top of RAM. ON/OFF + DOS menu + DIR tested Atari800; ON + DIR on Altirra (NTSC colour fringes). BASIC, RESET, cold start untested |
| WebAFM "PC folder as a drive" | built: pick a Windows folder in either pane; real long names kept, 8.3 short name shown, LONGNAME.TXT mirrors them (CRLF on the PC, UTF-8). Copy/move/rename/mkdir/delete to and from disks or other folders write straight to the folder. Tested on a browser-private folder (OPFS), not yet on a real Windows folder. No undo, no sector editor; whole folder is read into memory (1.5 GB cap); Chromium only; drag a folder from Explorer onto either pane to mount it (tested with a simulated drop); edits made outside WebAFM need Refresh |
| nano-style full-screen editor | built: NANO.COM, tested Atari800 only |
| calculator | built: CALC.COM (infix, FP ROM, ~9 digits), tested Atari800 + Altirra |
| 5200 controller analog stick / keypad mapping | PART (keypad only) |

## Multicartridges (research verdicts)
| Cart | Verdict | Notes |
|---|---|---|
| Atarimax 128K / 1MB | Easy | Atari800 types 41/42/75 and Altirra already support it. Needs only a cart file and the right type. |
| Ultimate Cart | Easy | Open firmware (github.com/robinhedwards/UltimateCart). Bank types already exist; needs a file browser over a virtual SD. |
| SIDE2 / SIDE3 | Easy on Altirra only | Altirra emulates SIDE/SIDE2/SIDE3 (3.1). Atari800 has no SIDE. Needs a virtual CF/SD image and device config. Loader firmware is freely downloadable. |
| AVG cart | Medium | Is a SIDE2-compatible device plus extras. SIDE2 subset via Altirra; ATX, CAS, ECI/PBI extras are not modelled. |
| Uno cart | Medium, unverified | Reuses standard bank types. Hardware and firmware details were not confirmed (product page 404). |

## SIO drive emulators (research verdicts)
All four are already covered by the cores (ATR, XEX, XFD, CAS, SIO patch, high-speed SIO). Only the on-device menu UI is unique.
| Device | Verdict | Web work |
|---|---|---|
| SDrive-MAX | Easy | Virtual SD folder browser and auto-mount. |
| SDrive simple | Easy | The real SDrive.atr menu disk runs unmodified. |
| SIO2PC | Easy | Redundant with the cores' H: host device. |
| SIO2SD | Easy | D1-D8 assignment panel and per-drive speed index. |

## Other known gaps
- Altirra core: 5200 shows black with a cart; 1450XLD shows no readable text.
- Not yet verified: stereo left/right audio, KEYTEST joystick/paddle rows, SNDTEST, WebAFM tests on Altirra.
- Not tested: a BASIC cartridge in slot 1 with built-in BASIC on (a cart should take priority).
- Layout on a real Pixel phone in portrait.
