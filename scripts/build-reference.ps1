# Builds the libatari800 reference core to WebAssembly with Emscripten.
# Usage: powershell -File scripts\build-reference.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$emsdk = if ($env:EMSDK_DIR) { $env:EMSDK_DIR } else { 'C:\Users\raver\tools\emsdk' }
& "$emsdk\emsdk_env.ps1" | Out-Null

$src = Join-Path $root 'vendor\atari800\src'
$out = Join-Path $root 'web\ref'
New-Item -ItemType Directory -Force $out | Out-Null

# Core files shared with the desktop build. input/statesav/sound come from libatari800 instead.
$core = 'acidtest afile antic artifact atari binload cartridge cartridge_info xep80 xep80_fonts cassette cfg colours colours_external colours_ntsc colours_pal compfile cpu crc32 devices esc gtia img_tape input log memory monitor pbi pia pokey rtime screen sio statesav sysrom util pokeysnd mzpokeysnd remez sound'.Split(' ') | ForEach-Object { "$src\$_.c" }
$lib = 'api main init exit input video statesav sound'.Split(' ') | ForEach-Object { "$src\libatari800\$_.c" }
$lib += "$root\build\ac_glue.c"
# src\ and src\libatari800\ both have input/statesav/sound .c files; emcc keeps both objects (distinct paths).

$exports = '["_libatari800_init","_libatari800_next_frame","_libatari800_clear_input_array","_libatari800_get_screen_ptr","_libatari800_get_main_memory_ptr","_libatari800_get_sound_buffer","_libatari800_get_sound_buffer_len","_libatari800_get_num_sound_channels","_libatari800_get_current_state","_libatari800_restore_state","_libatari800_mount_disk_image","_libatari800_reboot_with_file","_libatari800_get_frame_number","_libatari800_error_message","_ac_cart_insert","_ac_cart_set_type","_ac_cart_eject","_ac_cart_type","_ac_cart_type_count","_ac_cart_type_desc","_ac_cart_type_kb","_ac_disk_eject","_ac_detect","_ac_tape_insert","_ac_tape_eject","_ac_tape_rewind","_ac_tape_status","_ac_tape_size","_ac_tape_pos","_ac_tape_boot","_ac_disk_mount","_ac_xep80_enabled","_ac_xep80_height","_ac_xep80_screen","_malloc","_free"]'

emcc -O2 "-I$root\build" "-I$src" "-I$src\libatari800" -DHAVE_CONFIG_H @core @lib `
  "-sEXPORTED_FUNCTIONS=$exports" '-sEXPORTED_RUNTIME_METHODS=["ccall","cwrap","FS","HEAPU8"]' `
  -sUSE_ZLIB=1 -sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_NAME=AtariRef -sSINGLE_FILE=1 "-sENVIRONMENT=web,node" -o "$out\atari-ref.js"
if ($LASTEXITCODE -ne 0) { throw "emcc failed ($LASTEXITCODE)" }
Write-Host "built $out\atari-ref.js"
