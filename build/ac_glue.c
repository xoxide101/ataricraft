/* ataricraft glue: cartridge and disk slot control for the libatari800 reference build. */
#include "config.h"
#include "cartridge.h"
#include "cartridge_info.h"
#include "sio.h"
#include "afile.h"
#include "cassette.h"
#include "atari.h"
#include <emscripten.h>

/* SIO hook: JS (Module.acSio) returns 0 = not handled, else 'C','N','E' etc. */
EM_JS(int, ac_sio_js, (int dev, int cmd, int dstats, int aux, int data, int len), {
	return Module.acSio ? (Module.acSio(dev, cmd, dstats, aux, data, len) | 0) : 0;
});

static CARTRIDGE_image_t *slot_cart(int slot)
{
	return slot == 2 ? &CARTRIDGE_piggyback : &CARTRIDGE_main;
}

/* Returns 0 ok, >0 = size in KB when the type must be chosen, <0 error. */
EMSCRIPTEN_KEEPALIVE int ac_cart_insert(int slot, const char *path)
{
	int r = slot == 2 ? CARTRIDGE_Insert_Second(path) : CARTRIDGE_InsertAutoReboot(path);
	return r == CARTRIDGE_BAD_CHECKSUM ? 0 : r; /* a bad CART checksum is only a warning */
}

EMSCRIPTEN_KEEPALIVE void ac_cart_set_type(int slot, int type)
{
	if (slot == 2)
		CARTRIDGE_SetType(&CARTRIDGE_piggyback, type);
	else
		CARTRIDGE_SetTypeAutoReboot(&CARTRIDGE_main, type);
}

EMSCRIPTEN_KEEPALIVE void ac_cart_eject(int slot)
{
	if (slot == 2)
		CARTRIDGE_Remove_Second();
	else
		CARTRIDGE_RemoveAutoReboot();
}

EMSCRIPTEN_KEEPALIVE int ac_cart_type(int slot) { return slot_cart(slot)->type; }
EMSCRIPTEN_KEEPALIVE int ac_cart_type_count(void) { return CARTRIDGE_TYPE_COUNT; }
EMSCRIPTEN_KEEPALIVE const char *ac_cart_type_desc(int i) { return CARTRIDGES[i].description; }
EMSCRIPTEN_KEEPALIVE int ac_cart_type_kb(int i) { return CARTRIDGES[i].kb; }

EMSCRIPTEN_KEEPALIVE void ac_disk_eject(int n) { SIO_Dismount(n); }

/* Format detection (AFILE_* code) from content, independent of file extension. */
EMSCRIPTEN_KEEPALIVE int ac_detect(const char *path) { return AFILE_DetectFileType(path); }

/* Tape: 1 = inserted, 0 = failed. */
EMSCRIPTEN_KEEPALIVE int ac_tape_insert(const char *path) { return CASSETTE_Insert(path); }
EMSCRIPTEN_KEEPALIVE void ac_tape_eject(void) { CASSETTE_Remove(); }
EMSCRIPTEN_KEEPALIVE void ac_tape_rewind(void) { CASSETTE_Seek(0); }
EMSCRIPTEN_KEEPALIVE int ac_tape_status(void) { return CASSETTE_status; }
EMSCRIPTEN_KEEPALIVE unsigned int ac_tape_size(void) { return CASSETTE_GetSize(); }
EMSCRIPTEN_KEEPALIVE unsigned int ac_tape_pos(void) { return CASSETTE_GetPosition(); }
EMSCRIPTEN_KEEPALIVE void ac_tape_boot(void)
{
	CASSETTE_Seek(0);
	CASSETTE_hold_start = TRUE;
	Atari800_Coldstart();
}

/* Disk: 1 = mounted. */
EMSCRIPTEN_KEEPALIVE int ac_disk_mount(int n, const char *path) { return SIO_Mount(n, path, 0); }

/* cfg.c references these when HAVE_LIBZ is set; screenshot/video export is not built. */
int File_Export_ReadConfig(char *string, char *ptr) { return 0; }
void File_Export_WriteConfig(FILE *fp) { }
