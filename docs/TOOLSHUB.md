# Craft Tools & Workbench (tools hub)

The hybrid Craft apps are a core proof of concept for the actual system, using very specific data. A hybrid app shows the integration: both sides (web and Atari) can be used together. All of these tools are ways to manipulate existing data and move it into and out of the system from current standards. The goal is to bring the evolved apps to the main system with the same features and a way to present them correctly.

Because of that, the tools are not part of the emulator. The emulator (`web/index.html`) keeps the comprehensive emulation scope; the tools live on their own page, `web/tools.html`, opened by the **Tools ▸** button in the emulator header or side panel (new tab).

## What stays and what moved

| Stays in the emulator | Why |
|---|---|
| System, Cartridges & drives, **File manager**, **WebAFM**, Online & networking, Debugging | machine, media and I/O. WebAFM is a file explorer for disk images, so it stays with the File manager. The DOS boot-records manager boots into the machine, so it stays too. |

| Moved to `tools.html` | Group |
|---|---|
| BASIC, ASM, Inspect | Development |
| FONT (character-set editor), Workbench (MIDI to POKEY, SAP editor), Charset editor (`fontedit.html`), PDF, FujiNet Explorer | Data in/out |
| xCWriter, xCCalc, xCBase, EBookCraft | Hybrid apps (web twin + Atari companion) |

The hub has a search box, a description per tool and an **Emulator connected / not connected** indicator with an **Open emulator** button. BASIC, ASM, Inspect and FONT open as floating panels on the hub; the rest open in a new tab.

Deep links keep working: `index.html#basic`, `#asm`, `#insp`/`#inspect`, `#font`, `#wb`, `#xcw`, `#xcc`, `#xcb`, `#ebc`, `#pdf`, `#fujiexplorer`, `#fontedit` (and `?tab=` / `?tool=`) redirect to `tools.html#<name>`, which opens that tool.

## Link protocol

The emulator tab (`js/toolshub-host.js`) serves its machine API over a `BroadcastChannel` named `ataricraft-tools`; the tools tab (`js/toolshub-link.js`) provides `AC.BasicHost` (`emu()` giving `peek/poke/bootFile`, and `romFont()`), the same object the panels used inside the emulator, so they run unchanged.

Messages (structured clone, bytes as `Uint8Array`):

| Message | From | Meaning |
|---|---|---|
| `{t:'hello'}` | tools | ask emulators to announce themselves |
| `{t:'ready', from, info}` | emulator | announce (also every 3 s); `info` = model, core, booted |
| `{t:'bye', from}` | emulator | tab closing |
| `{t:'req', id, to, op, args}` | tools | call an op on emulator `to` |
| `{t:'res', id, ok, val \| err}` | emulator | result |

Ops: `ping`, `mem`, `peek`, `poke`, `bootFile`, `type`, `romFont`, `screenText`, `screenshot`, `inspect.*` (`ram load progs runProg dump find fill poke ip setIp mock unmock resetNet net state ramText segs`), `banks.*` (`list scan read write fill find page probe install`), `net.get`, `net.reset`, `remote.status|connect|stop`.

Rules:

- The tools tab locks to the first emulator id it hears; requests carry `to:id`, so a second emulator tab never receives them. The peer expires after 8 s without `ready`.
- **Direct path:** if the tools tab was opened by the emulator (Tools ▸ button) or opened the emulator itself, it uses that same-origin window's `ataricraft` object directly (synchronous, exact peek).
- **Mirror path:** a separately opened tools tab keeps a 64 KB memory mirror, refreshed about 3 times a second while a panel is in use; `peek` reads the mirror, `poke`/`bootFile`/`type` go over the channel.
- Same origin only. `pdfview.html` posts `{type:'ac-boot'}` to its opener; the hub forwards it to the emulator.

## Page weight (index.html, cold load, median of 5, `node scripts/toolshub-measure.cjs`)

| | requests | total | JS | load |
|---|---|---|---|---|
| before | 71 | 3465 KB | 3067 KB | 322 ms |
| after | 64 | 3261 KB | 2863 KB | 297 ms |

The built-in program library (`progs.js`) now loads on first use only.

## Tests

`node scripts/toolshub-test.cjs [shots]` covers the reduced tabs, file manager, redirects, hub, BASIC compile+run into a connected emulator (screen text checked), ASM, Inspect and FONT over the channel, and that every page loads. `inspect-test`, `inspect-ui-test` and `fontlib-test` drive the panels on the tools page.
