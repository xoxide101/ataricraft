// Browser (Emscripten) host for the libretro core: a small C API that gives a
// JS front end per-drive disks, carts, tape, keys, joysticks, video and audio.
#include <emscripten.h>
#include "cassette.h"
#include <map>
#include <sys/stat.h>
#include <at/atcore/devicevideo.h>
#include <vd2/system/VDString.h>
#include <vd2/Kasumi/pixmap.h>

namespace {

std::map<std::string, std::string> g_webOpts;
bool g_webOptsDirty = false;

// User-supplied OS/BASIC images (written to the virtual FS by the page); registered with the firmware manager at boot.
struct WebFwReq { const char *opt; ATFirmwareType type; std::string path; };
std::vector<WebFwReq> g_webFwReqs;

void WebRegisterFirmware(ATFirmwareManager& fwm) {
	for (const WebFwReq& r : g_webFwReqs) {
		const VDStringW w = VDTextU8ToW(VDStringSpanA(r.path.c_str()));
		const uint64 id = ATGetFirmwareIdFromPath(w.c_str());
		ATFirmwareInfo existing {};
		if (!fwm.GetFirmwareInfo(id, existing)) {
			ATFirmwareInfo fw {};
			fw.mId = id;
			fw.mFlags = 0;
			fw.mbVisible = true;
			fw.mbAutoselect = false;
			fw.mName = VDStringW(VDFileSplitPath(w.c_str()));
			fw.mPath = w;
			fw.mType = r.type;
			fwm.AddFirmware(fw);
		}
		char v[32];
		snprintf(v, sizeof v, "fw_%llx", (unsigned long long)id);
		g_webOpts[r.opt] = v;
	}
}
uint16_t g_webPad[4] = {};
std::vector<uint8_t> g_webFrame;
unsigned g_webW = 0, g_webH = 0;
size_t g_webPitch = 0;
std::vector<int16_t> g_webAudio;
double g_webFps = 60.0, g_webRate = 44100.0;

VDStringW WebPath(const char *p) {
	return VDTextU8ToW(VDStringSpanA(p));
}

bool WebEnv(unsigned cmd, void *data) {
	switch (cmd) {
		case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
			*(const char **)data = "/system";
			return true;
		case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
			*(const char **)data = "/saves";
			return true;
		case RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY:
			*(const char **)data = "/system";
			return true;
		case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
			return *(retro_pixel_format *)data == RETRO_PIXEL_FORMAT_XRGB8888;
		case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
			*(unsigned *)data = 2;
			return true;
		case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
			return true;
		case RETRO_ENVIRONMENT_GET_VARIABLE: {
			retro_variable *v = (retro_variable *)data;
			auto it = g_webOpts.find(v->key);
			if (it == g_webOpts.end())
				return false;
			v->value = it->second.c_str();
			return true;
		}
		case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
			*(bool *)data = g_webOptsDirty;
			g_webOptsDirty = false;
			return true;
		case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
			return true;
		case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
		case RETRO_ENVIRONMENT_SET_GEOMETRY:
		case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO:
			return true;
		default:
			return false;
	}
}

void WebVideo(const void *data, unsigned w, unsigned h, size_t pitch) {
	if (!data)
		return;
	g_webFrame.assign((const uint8_t *)data, (const uint8_t *)data + pitch * h);
	g_webW = w;
	g_webH = h;
	g_webPitch = pitch;
}

size_t WebAudioBatch(const int16_t *data, size_t frames) {
	g_webAudio.insert(g_webAudio.end(), data, data + frames * 2);
	return frames;
}

void WebAudioSample(int16_t l, int16_t r) {
	g_webAudio.push_back(l);
	g_webAudio.push_back(r);
}

void WebPoll() {}

int16_t WebInput(unsigned port, unsigned device, unsigned index, unsigned id) {
	if (port >= 4 || index != 0 || (device & RETRO_DEVICE_MASK) != RETRO_DEVICE_JOYPAD)
		return 0;
	if (id == RETRO_DEVICE_ID_JOYPAD_MASK)
		return (int16_t)g_webPad[port];
	return id < 16 ? (g_webPad[port] >> id) & 1 : 0;
}

ATMediaWriteMode WebWriteMode(int m) {
	switch (m) {
		case 0: return kATMediaWriteMode_RO;
		case 1: return kATMediaWriteMode_VRWSafe;
		case 2: return kATMediaWriteMode_VRW;
		default: return kATMediaWriteMode_RW;
	}
}

std::vector<uint32_t> g_xepFrame;
unsigned g_xepW = 0, g_xepH = 0;

IATDeviceVideoOutput *WebXepOutput() {
	ATDeviceManager *dm = g_sim.GetDeviceManager();
	IATDeviceVideoManager *vm = dm ? dm->GetService<IATDeviceVideoManager>() : nullptr;
	return vm ? vm->GetOutputByName("xep80") : nullptr;
}

}

extern "C" {

// H: host drive mapped to the Emscripten folder /host (read/write).
EMSCRIPTEN_KEEPALIVE int aw_host(int on) {
	if (!g_core.simulatorInitialized)
		return 0;
	ATDeviceManager *dm = g_sim.GetDeviceManager();
	IATDevice *ex = dm->GetDeviceByTag("hostfs");
	if (ex)
		dm->RemoveDevice(ex);
	if (!on)
		return 1;
	mkdir("/host", 0777);
	ATPropertySet ps;
	ps.SetBool("readonly", false);
	ps.SetBool("lowercase", false);
	ps.SetString("path1", L"/host");
	try {
		return dm->AddDevice("hostfs", ps, false) ? 1 : 0;
	} catch (...) {
		return 0;
	}
}

// XEP80 80-column adapter on joystick port 1.
EMSCRIPTEN_KEEPALIVE int aw_xep(int on) {
	if (!g_core.simulatorInitialized)
		return 0;
	ATDeviceManager *dm = g_sim.GetDeviceManager();
	IATDevice *ex = dm->GetDeviceByTag("xep80");
	if (ex)
		dm->RemoveDevice(ex);
	g_xepW = g_xepH = 0;
	if (!on)
		return 1;
	ATPropertySet ps;
	ps.SetUint32("port", 1);
	try {
		return dm->AddDevice("xep80", ps, false) ? 1 : 0;
	} catch (...) {
		return 0;
	}
}

// Refreshes the XEP80 frame; returns 1 when the adapter is present and sending a valid signal.
EMSCRIPTEN_KEEPALIVE int aw_xep_update() {
	IATDeviceVideoOutput *o = WebXepOutput();
	if (!o)
		return 0;
	o->UpdateFrame();
	const ATDeviceVideoInfo& vi = o->GetVideoInfo();
	if (!vi.mbSignalValid)
		return 0;
	const VDPixmap& pm = o->GetFrameBuffer();
	if (!pm.data || pm.format != nsVDPixmap::kPixFormat_Pal1)
		return 0;
	const unsigned w = pm.w, h = pm.h;
	g_xepW = w;
	g_xepH = h;
	g_xepFrame.resize((size_t)w * h);
	const uint32 fg = pm.palette ? (pm.palette[1] | 0xFF000000u) : 0xFFFFFFFFu;
	const uint32 bg = pm.palette ? (pm.palette[0] | 0xFF000000u) : 0xFF000000u;
	for (unsigned y = 0; y < h; ++y) {
		const uint8 *row = (const uint8 *)pm.data + (ptrdiff_t)y * pm.pitch;
		uint32_t *d = &g_xepFrame[(size_t)y * w];
		for (unsigned x = 0; x < w; ++x)
			d[x] = (row[x >> 3] & (0x80 >> (x & 7))) ? fg : bg;
	}
	return 1;
}
EMSCRIPTEN_KEEPALIVE const uint32_t *aw_xep_frame() { return g_xepFrame.data(); }
EMSCRIPTEN_KEEPALIVE int aw_xep_w() { return (int)g_xepW; }
EMSCRIPTEN_KEEPALIVE int aw_xep_h() { return (int)g_xepH; }

// Dumps one of Altirra's built-in firmware images (kernel, kernelxl, kernel816, 5200, basic); returns its size, 0 if unknown.
std::vector<uint8> g_fwDump;
EMSCRIPTEN_KEEPALIVE int aw_fw(const char *name) {
	static const struct { const char *n; uint64 id; } T[] = {
		{ "kernel", kATFirmwareId_Kernel_LLE }, { "kernelxl", kATFirmwareId_Kernel_LLEXL },
		{ "kernel816", kATFirmwareId_Kernel_816 }, { "5200", kATFirmwareId_5200_LLE },
		{ "basic", kATFirmwareId_Basic_ATBasic },
	};
	for (auto& e : T) {
		if (strcmp(e.n, name))
			continue;
		vdfastvector<uint8> buf;
		bool usable = false;
		uint32 len = 0;
		if (!ATLoadInternalFirmware(e.id, nullptr, 0, 0, nullptr, &len, &buf, &usable))
			return 0;
		g_fwDump.assign(buf.begin(), buf.end());
		return (int)g_fwDump.size();
	}
	return 0;
}
EMSCRIPTEN_KEEPALIVE const uint8_t *aw_fw_data() { return g_fwDump.data(); }

EMSCRIPTEN_KEEPALIVE void aw_fw_custom(const char *kind, const char *path) {
	WebFwReq r;
	r.path = path;
	if (!strcmp(kind, "basic")) {
		r.opt = "altirra_basic_firmware";
		r.type = kATFirmwareType_Basic;
	} else {
		r.opt = "altirra_os_firmware";
		r.type = !strcmp(kind, "os800") ? kATFirmwareType_Kernel800_OSB : kATFirmwareType_KernelXL;
	}
	g_webFwReqs.push_back(r);
}

EMSCRIPTEN_KEEPALIVE int aw_init() {
	mkdir("/system", 0777);
	mkdir("/saves", 0777);
	retro_set_environment(WebEnv);
	retro_set_video_refresh(WebVideo);
	retro_set_audio_sample(WebAudioSample);
	retro_set_audio_sample_batch(WebAudioBatch);
	retro_set_input_poll(WebPoll);
	retro_set_input_state(WebInput);
	retro_init();
	return 1;
}

EMSCRIPTEN_KEEPALIVE void aw_opt(const char *key, const char *value) {
	g_webOpts[key] = value;
	g_webOptsDirty = true;
}

EMSCRIPTEN_KEEPALIVE int aw_boot() {
	if (!retro_load_game(nullptr))
		return 0;
	retro_system_av_info av {};
	retro_get_system_av_info(&av);
	g_webFps = av.timing.fps;
	g_webRate = av.timing.sample_rate;
	return 1;
}

EMSCRIPTEN_KEEPALIVE void aw_shutdown() {
	retro_unload_game();
	retro_deinit();
}

EMSCRIPTEN_KEEPALIVE void aw_run() {
	g_webAudio.clear();
	retro_run();
	retro_system_av_info av {};
	retro_get_system_av_info(&av);
	g_webFps = av.timing.fps;
	g_webRate = av.timing.sample_rate;
}

EMSCRIPTEN_KEEPALIVE const uint8_t *aw_frame() { return g_webFrame.data(); }
EMSCRIPTEN_KEEPALIVE int aw_frame_w() { return (int)g_webW; }
EMSCRIPTEN_KEEPALIVE int aw_frame_h() { return (int)g_webH; }
EMSCRIPTEN_KEEPALIVE int aw_frame_pitch() { return (int)g_webPitch; }
EMSCRIPTEN_KEEPALIVE const int16_t *aw_audio() { return g_webAudio.data(); }
EMSCRIPTEN_KEEPALIVE int aw_audio_frames() { return (int)(g_webAudio.size() / 2); }
EMSCRIPTEN_KEEPALIVE double aw_fps() { return g_webFps; }
EMSCRIPTEN_KEEPALIVE double aw_rate() { return g_webRate; }

EMSCRIPTEN_KEEPALIVE void aw_reset(int cold) {
	if (cold)
		DoColdReset();
	else
		DoWarmReset();
}

EMSCRIPTEN_KEEPALIVE void aw_key(int down, unsigned keycode, unsigned ch) {
	KeyboardCallback(down != 0, keycode, ch, 0);
}

// Raw POKEY scancode (same values as libatari800 AKEY codes, ctrl=0x80, shift=0x40).
EMSCRIPTEN_KEEPALIVE int aw_char_scan(unsigned ch) {
	uint32 sc = 0;
	if (!ATUIGetScanCodeForCharacter32(ch, sc) || sc >= kATUIKeyScanCodeFirst)
		return -1;
	return (int)sc;
}

EMSCRIPTEN_KEEPALIVE void *aw_alloc(int n) { return malloc((size_t)n); }
EMSCRIPTEN_KEEPALIVE void aw_free(void *p) { free(p); }
EMSCRIPTEN_KEEPALIVE void aw_scan(unsigned code) {
	if (g_core.simulatorInitialized)
		g_sim.GetPokey().PushKey((uint8)code, false);
}

EMSCRIPTEN_KEEPALIVE void aw_break(int down) {
	if (g_core.simulatorInitialized)
		g_sim.GetPokey().SetBreakKeyState(down != 0, true);
}

EMSCRIPTEN_KEEPALIVE void aw_joy(int port, unsigned mask) {
	if (port >= 0 && port < 4)
		g_webPad[port] = (uint16_t)mask;
}

EMSCRIPTEN_KEEPALIVE void aw_console(unsigned bit, int down) {
	if (g_core.simulatorInitialized)
		g_sim.GetGTIA().SetConsoleSwitch((uint8)bit, down != 0);
}

EMSCRIPTEN_KEEPALIVE int aw_disk_mount(int n, const char *path, int writeMode) {
	if (!g_core.simulatorInitialized || n < 0 || n >= 15)
		return 0;
	try {
		ATDiskInterface& di = g_sim.GetDiskInterface(n);
		di.UnloadDisk();
		di.SetWriteMode(WebWriteMode(writeMode));
		const VDStringW w = WebPath(path);
		di.LoadDisk(w.c_str());
		return di.IsDiskLoaded() ? 1 : 0;
	} catch (...) {
		return 0;
	}
}

EMSCRIPTEN_KEEPALIVE void aw_disk_eject(int n) {
	if (g_core.simulatorInitialized && n >= 0 && n < 15)
		g_sim.GetDiskInterface(n).UnloadDisk();
}

EMSCRIPTEN_KEEPALIVE int aw_disk_loaded(int n) {
	return g_core.simulatorInitialized && n >= 0 && n < 15
		&& g_sim.GetDiskInterface(n).IsDiskLoaded();
}

EMSCRIPTEN_KEEPALIVE int aw_disk_dirty(int n) {
	return g_core.simulatorInitialized && n >= 0 && n < 15
		&& g_sim.GetDiskInterface(n).IsDirty();
}

EMSCRIPTEN_KEEPALIVE int aw_disk_save(int n, const char *path) {
	if (!g_core.simulatorInitialized || n < 0 || n >= 15)
		return 0;
	try {
		ATDiskInterface& di = g_sim.GetDiskInterface(n);
		if (!di.IsDiskLoaded())
			return 0;
		const VDStringW w = WebPath(path);
		di.SaveDiskAs(w.c_str(), kATDiskImageFormat_ATR);
		return 1;
	} catch (...) {
		return 0;
	}
}

EMSCRIPTEN_KEEPALIVE int aw_cart_load(int slot, const char *path, int mapper) {
	if (!g_core.simulatorInitialized)
		return 0;
	try {
		ATCartLoadContext ctx {};
		if (mapper > 0)
			ctx.mCartMapper = mapper;
		const VDStringW w = WebPath(path);
		return g_sim.LoadCartridge(slot, w.c_str(), &ctx) ? 1 : 0;
	} catch (...) {
		return 0;
	}
}

EMSCRIPTEN_KEEPALIVE void aw_cart_eject(int slot) {
	if (g_core.simulatorInitialized)
		g_sim.UnloadCartridge(slot);
}

// Generic loader: .xex/.com, .cas, .atr, .car, ... picked by content.
EMSCRIPTEN_KEEPALIVE int aw_load(const char *path) {
	if (!g_core.simulatorInitialized)
		return 0;
	try {
		ATImageLoadContext ctx {};
		const VDStringW w = WebPath(path);
		return g_sim.Load(w.c_str(), kATMediaWriteMode_RO, &ctx) ? 1 : 0;
	} catch (...) {
		return 0;
	}
}

EMSCRIPTEN_KEEPALIVE int aw_tape_load(const char *path) {
	if (!g_core.simulatorInitialized)
		return 0;
	try {
		const VDStringW w = WebPath(path);
		g_sim.GetCassette().Load(w.c_str());
		return g_sim.GetCassette().IsLoaded() ? 1 : 0;
	} catch (...) {
		return 0;
	}
}

EMSCRIPTEN_KEEPALIVE void aw_tape_eject() {
	if (g_core.simulatorInitialized)
		g_sim.GetCassette().Unload();
}

EMSCRIPTEN_KEEPALIVE void aw_tape_rewind() {
	if (g_core.simulatorInitialized)
		g_sim.GetCassette().RewindToStart();
}

EMSCRIPTEN_KEEPALIVE void aw_tape_play(int play) {
	if (!g_core.simulatorInitialized)
		return;
	if (play)
		g_sim.GetCassette().Play();
	else
		g_sim.GetCassette().Stop();
}

EMSCRIPTEN_KEEPALIVE double aw_tape_pos() {
	return g_core.simulatorInitialized ? g_sim.GetCassette().GetPosition() : 0;
}

EMSCRIPTEN_KEEPALIVE double aw_tape_len() {
	return g_core.simulatorInitialized ? g_sim.GetCassette().GetLength() : 0;
}

EMSCRIPTEN_KEEPALIVE int aw_tape_loaded() {
	return g_core.simulatorInitialized && g_sim.GetCassette().IsLoaded();
}

EMSCRIPTEN_KEEPALIVE int aw_state_size() { return (int)retro_serialize_size(); }
EMSCRIPTEN_KEEPALIVE int aw_state_save(void *dst, int size) {
	return retro_serialize(dst, (size_t)size) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE int aw_state_load(const void *src, int size) {
	return retro_unserialize(src, (size_t)size) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE uint8_t *aw_ram() {
	return (uint8_t *)retro_get_memory_data(RETRO_MEMORY_SYSTEM_RAM);
}
EMSCRIPTEN_KEEPALIVE int aw_ram_size() {
	return (int)retro_get_memory_size(RETRO_MEMORY_SYSTEM_RAM);
}

}
