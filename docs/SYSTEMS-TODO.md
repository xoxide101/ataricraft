# Systems and hardware to-do

Machines
- [x] Atari 800, 1200XL, 800XL, 65XE, 130XE
- [ ] Atari 5200 (an 8-bit computer in a console case). Needs a 5200 machine model, the 2 KB 5200 BIOS (2-port and 4-port revisions), analog-stick input and the pause/reset keypad. Cartridges are `.a52`/`.bin`.
- [ ] 1400XL and 1450XLD OS ROMs (V&T handler, disk handler ROMs)

Peripherals
- [x] XEP80 (80 columns)
- [ ] 1090 80-column board (firmware rev 9 and charset ROM)
- [ ] 1030 modem and 835 modem (internal 8048/8050 firmware)
- [ ] 850 interface

Drives
- Disks load from ATR images and folder mounts, so drive firmware is not used.
- [ ] Decide whether to model Indus GT behaviour (see below) or keep plain disk images.

Replacement OS ROMs
- [ ] Retry the garbled ones (Q-Meg 2.3 to 4.3, Speeder Plus, Os++, 1200XL rev 10/11, 1400XL) on a 64K model, and as slot 1 and slot 2 cartridges.
