# Altirra core (WASM)

`web/ref/altirra-web.js` + `web/ref/altirra-wasm.js` are [AltirraSDL](https://github.com/ilmenit/AltirraSDL)'s libretro core
(GPL-2.0, based on Altirra by Avery Lee) built with Emscripten and a small C API (`web_api.inc`) that `web/js/emu-altirra.js` drives.

Rebuild:

1. Clone AltirraSDL and apply `altirra-libretro-web.patch` (CMake executable target + link flags, include of `web_api.inc`);
   copy `web_api.inc` into `src/AltirraLibretro/`.
2. `emcmake cmake -B build/wl -G Ninja -DALTIRRA_WASM=ON ...` then `ninja -C build/wl AltirraLibretro`.
3. Copy `altirra_web.js` to `web/ref/altirra-web.js`; base64 `altirra_web.wasm` into `web/ref/altirra-wasm.js`
   as `window.ALTIRRA_WASM_B64='...'` (lets it load from `file://`).
