# Controller profiles (translation layer)

> **Untested on hardware.** Built for the Atari Gamestation Gamepad (DGUNL-7152) before the device was available. How it enumerates (standard HID gamepad, keyboard/mouse, or a custom device) is **unknown**. Everything below was verified only with synthetic events (`scripts/controller-test.cjs`) and a browser smoke test, never with the real unit.

The pad has a **digital d-pad only (no analog stick)**. Analog-stick emulation is intentionally not provided; 5200/Jaguar analog games use d-pad emulation or the trackball.

## Architecture

```
physical device ──► input layer ──► source ids ──► profile (canonical controls) ──► adapter ──► emulator / export
 Gamepad API         ctrlinput.js    gp:b0 ms:dx      ctrlcore.js                    atari8      ctrlhook.js
 WebHID                              kb:Space         dpad, buttons, keypad,         neutral     ctrlexport.js
 keyboard / mouse / wheel            hid:r0:b1:m04    spinner, trackball, console,   (more...)   (MAME, RetroArch, SDL)
                                                      aux buttons
```

- `web/js/ctrlinput.js`: device-agnostic input. Gamepad API polling, optional WebHID raw reports, keyboard/mouse/wheel, "press this control" learning, and an absolute-vs-relative classifier.
- `web/js/ctrlcore.js`: DOM-free profile model, presets, localStorage store, import/export JSON, and the **adapter registry**.
- Adapters are small factories `profile => ({ update(sampler, ctx) })` registered with `AC.CtrlCore.registerAdapter(name, factory)`. Built in: `atari8` (8-bit joystick/paddle/driving/trackball/keypad, and the 5200 via `ctx.model === '5200'`) and `neutral` (booleans and per-tick relative counts, no Atari semantics). A 2600/7800/Lynx/ST adapter can be added without touching the device layer.
- `web/js/ctrlhook.js`: runs the active profile every 16 ms and feeds `emu.down('ctrl', fields)` for ports 1-2. Keyboard handling in `app.js` is untouched; profile output is merged (joy and trig fields are OR-merged, see `emu.js`/`emu-altirra.js`).
- `web/js/ctrlexport.js`: MAME, RetroArch and SDL exporters.
- `web/controller.html` + `web/js/ctrlpage.js`: the diagnostic page, linked from `tools.html` and the `studio.html` header only.

### Source ids

`gp:b<N>` gamepad button, `gp:a<N>` axis (`gp:a<N>+` / `gp:a<N>-` as a digital direction), `kb:<KeyboardEvent.code>`, `ms:b<N>`, `ms:dx` / `ms:dy` / `ms:wheel` (relative), `hid:r<report>:b<byte>:m<hexmask>` (bit), `:u8` (unsigned level), `:s8` (signed level), `:d8` (signed byte as a per-report delta).

## Discovering what the real unit sends

1. Open **Controller** (link in the Tools and Studio headers).
2. Plug in/pair the pad and press a button (browsers hide gamepads until first input). Check the **Devices** list: a Gamepad API entry (note `mapping: standard` vs raw), a WebHID device, or nothing.
3. Move the trackball and the spinner. The **Live view** shows axes with an absolute/relative verdict (absolute: holds position; relative/velocity: returns to rest; wrapping angle), mouse dx/dy/wheel (always relative), key presses, and raw HID reports with changed bytes highlighted.
4. Use **Record** for each physical control; the result is stored in the profile's device map. **Apply device map** fills the Atari bindings.
5. If nothing appears, try **Connect HID device**. Chrome blocks WebHID access to keyboard and mouse top-level collections, so if the unit presents as a keyboard/mouse use the keyboard/mouse path (it works without WebHID).

## Controls and modes

- **Joystick**: d-pad + fire (+ fire 2, OR-merged into the trigger) on a chosen port.
- **Paddle**: `axis` mode maps an absolute axis to POT (dead zone, sensitivity, invert). `encoder` mode accumulates relative deltas into a clamped 0..1 POT (step, sensitivity, invert, optional auto-recentre after idle ms). The emulator range is 0..227 (centre 113/114); the preview also shows the 0..255 view. The paddle path works on the atari800 core only; the Altirra core ignores mouse fields (existing behaviour).
- **Driving controller / spinner**: the continuous 360 degree, no-end-stop control. Relative counts become 2-bit Gray code (`0,1,3,2`) on the joystick up/down lines of the chosen port (16 steps per turn as in the existing Stick tab), at most one step per tick with a clamped queue. Thumb buttons act as fire. Use `driving-port2` for port 2.
- **Trackball**: mouse delta to Atari trak-ball, ST or Amiga quadrature (same tables as the Pad tab, checked by the test) with sensitivity, invert X/Y, swap and pointer lock. Default port 2.
- **Keypad**: 0-9 * # to 5200 keycodes (auto when the model is 5200) or `keychar` on computers. Presets: `keypad-5200`, `keypad-5200-full` (Start, Pause, Reset, two fires), `jaguar` (A/B/C, Pause, Option, 12-key keypad). There is no Jaguar core in Ataricraft; the Jaguar preset is a generic binding set used for exports.
- **Console**: Start, Select, Option, Reset, Pause (5200), Coin/credit. Credit acts as Select on computers and Start on the 5200 (no emulated coin slot).
- **Thumb / aux buttons**: 8 slots, each bound to an emulator function: fire, fire2, start, select, option, reset, break, help, pause, credit. `coin-aux` preset binds X/Y/L1/R1/L2/R2.

A second controller is just a second port: every section has a port setting, and a later second pad adds another profile/adapter instance without redesign (today one active profile drives both ports).

The Stick tab keeps its own USB gamepad handling; with an active profile both apply (OR-merged), which is harmless but can double-fire.

## Exports (all untested on hardware)

Verified against upstream sources, not against the device:

- **MAME** (`ioport.cpp`, `inpttype.ipp`, `input.cpp`, bundled `ctrlr/*.cfg`): `<mameconfig version="10">` with `<port type>` and `<newseq type="standard|increment|decrement">`. Spinner maps to `P<n>_DIAL` only (relative), paddle to `P<n>_PADDLE`, trackball to `P<n>_TRACKBALL_X/Y` with `MOUSECODE`, Start/Credit/Menu to `START1`/`COIN1`/`UI_MENU`. Keypad, Option and Reset have no generic MAME type and are not written. MAME's own axis order/numbering can differ from the browser's.
- **RetroArch autoconfig .cfg** (`retroarch-joypad-autoconfig` examples): `input_*_btn`, `input_*_axis`, labels. Vendor/product id are written as `0` with a TODO when unknown. Browser "standard" mapping indices may differ from the native driver's.
- **RetroArch .rmap** (`configuration.c`): minimal template (device type, port, d-pad mode). Core behaviour for the Atari cores was not verified.
- **SDL gamecontrollerdb**: `GUID,name,a:b0,...,platform:Linux,` with the USB GUID built from vendor/product (little endian; CRC field zero as mappings omit it). The mouse-like trackball and keypad are not part of the SDL model.

## Unverified / open questions

Enumeration type of the real device; Gamepad API vs native driver button numbering; whether the spinner reports absolute, relative or wrapping values; WebHID access to the unit; the libretro Atari cores' remap expectations; MAME `_REVERSE` on mouse axes; MAME keypad ports per driver; Jaguar adapter (none yet).

## Tests

`node scripts/controller-test.cjs` (pure Node, synthetic Gamepad/mouse/keyboard/HID events).
