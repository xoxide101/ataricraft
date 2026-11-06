# Machine core interface

A machine = **core** (code behind this interface) + **profile** ([MACHINE-PROFILE](MACHINE-PROFILE.md)). Apps use only the interface; a core is chosen by profile id. Nothing here changes the emulator yet.

## Interface (all methods may be async; bytes are `Uint8Array`)

```
info()            -> {profileId, core, version}
profile()         -> the profile JSON
reset(kind)       -> 'cold' | 'warm'
step(n=1)         -> run n CPU instructions   (optional; debugger)
run(frames=1)     -> run whole video frames
read(addr, len, {bank?, layer?}) -> bytes     write(addr, bytes, opts)
banks()           -> current memory layer/bank map (names from the profile)
frame()           -> {width, height, format:'indexed8'|'rgba', pixels, palette?}
audio(maxSamples) -> {rate, channels, samples:Int16Array}
input.key(code, down)   input.joy(port, bits)   input.console(name, down)
media.mount(slot, bytes, {type})   media.eject(slot)   media.read(slot) -> bytes   media.boot(...)
saveState() -> bytes     loadState(bytes)        (opaque, core-specific, versioned)
on(evt, fn)       -> 'frame' | 'break' | 'media' | 'error'
```
Capabilities are listed in `info()` (`step`, `banks`, `audio`, ...); a missing capability throws `Unsupported`, never silently no-ops. Exposed over the transport as `emu.*` ops (existing names stay valid).

## Wrapping the existing emulator (no behaviour change)

Two classes, each a thin adapter holding the existing object and forwarding calls:

| Adapter | Wraps | Mapping |
|---|---|---|
| `Atari8Core(libatari800)` | `web/js/emu.js` `Emu` | `reset`<-coldStart/warmStart, `run`<-frame, `media.mount`<-mountDisk/insertCart, `media.read`<-readDisk, `saveState/loadState`<-snapshot/restore, `read/write`<-mem, `input.key`<-sendKey, models from `MODELS` |
| `Atari8AltirraCore` | `web/js/emu-altirra.js` | same surface, capabilities differ (listed) |

Rules: adapters add no logic beyond argument shaping; the old classes stay importable and keep their current API; the UI switches to the adapter one screen at a time.

## Refactor plan (safe order)

1. **Golden tests first (before any change):** headless Playwright runs boot a known blank ATR + fixed keys, and record `screenHash` after N frames, a memory CRC of RAM, a snapshot->restore->N frames hash. Store the hashes in `scripts/` fixtures. These pass on the *current* code.
2. Add `tools/craftcore/machine-core.cjs` with the interface + a **fake core** (counter machine) and contract tests every core must pass (reset determinism, saveState/loadState equality, read-after-write, `Unsupported` for missing capabilities).
3. Add the two adapters; run goldens through them: hashes must be identical.
4. Switch one consumer (e.g. the transport `emulator` backend), re-run goldens; then others.
5. Only then add the next core (Z80/ZX Spectrum), validated by its profile and contract tests.

Exit criterion for each step: goldens unchanged and the repo's existing checks green.

## Per-machine work (everything else is shared)

CPU/video/sound core, profile JSON, charset/keyboard map, media types, ROM list (local only), free test material. Container adapters, transport, apps and companions stay as they are.
