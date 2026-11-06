# Transport (`web/js/transport.js`)

One small interface between an app and "whatever link reaches the resource". Apps (FujiNet Explorer today; the SQL gateway and printing later) call `send({op,args,body})` and never know whether the answer came from the relay, the emulator tab, or a test double. Loaded as `AC.Transport` in the browser and via `require` in Node.

## Interface

```js
const t = AC.Transport.relay({ base, token });   // any backend
await t.open();                      // -> status {state:'open'|'error'|'closed', message, caps}
const r = await t.send({ op:'fs.list', args:{scheme:'tnfs', host:'h:16384', path:'/'} , body });
t.receive(timeoutMs);                // next pushed event, or null on timeout
t.status();  t.on('message'|'status', fn);  await t.close();
await AC.Transport.call(t, op, args, body);   // like send, but throws on error
```

Reply: `{ ok, meta, body, error:{name, code, message} }`. `meta` is JSON, `body` is a `Uint8Array`. Error names: `NotFound`, `Exists`, `NotAllowed`, `BadToken`, `Unreachable`, `Unsupported`, `Error`. Backends never throw from `send`.

## Operations (protocol 1)

| Op | Args | Notes |
|---|---|---|
| `fs.list` / `fs.read` / `fs.write` (`append`) / `fs.mkdir` / `fs.rmdir` / `fs.unlink` / `fs.rename` (`to`) | `scheme` = `sd` `tnfs` `ftp` `pc` `mem`, `host`, `path`, `user`, `pass` | list returns `meta.value=[{name,dir,size,mtime}]` |
| `net.http` | `url`, `method`, headers | PUT/DELETE/PATCH are writes |
| `net.tcp.open/read/write/close`, `net.udp.open/send/read/close` | host, port, id | one socket per id |
| `relay.caps` | | `{allowWrite, allowLan, sd, time, tzOffset}` from `GET/POST /net/caps` |
| `dosboot.roots` / `dosboot.media` / `dosboot.rescan` / `dosboot.record` | see `DOSBOOT.md` | rescan and record are treated as writes client-side |
| `emu.*` | `ping disks mount eject swap disk.read boot printer printer.clear fujinet.get/set net.get/set time screenshot` | served by `web/js/fxhost.js` in the emulator tab |

## Backends

| Backend | Reaches | Notes |
|---|---|---|
| `relay({base,token})` | `tools/tnfs-bridge` over HTTP (`/net/*`, `/dosboot/*`) with `X-AC-Token`/`X-AC-Args`; relay errors arrive as `502` + `X-AC-Err` | **WebSocket is not implemented**: the relay has no WS endpoint. The interface (`receive`, `message` events) already fits it. |
| `emulator({channel|target})` | the emulator tab in the same browser via `BroadcastChannel('fujiexplorer')`, or a direct `target.handle(op,args,body)` | needs `index.html` open and served from the same origin (use the relay address). `serve(handlers)` is the emulator half. |
| `loopback(opts)` | in-memory `mem` file system plus `lb.handle(op, fn)` stubs, `lb.log`, `lb.push(evt)` | for tests and offline demos; `{allowWrite:false}` makes it read-only |
| `local()` | File System Access directory handles, scheme `pc` | `addRoot(name, handle)` |
| `router({relay,emulator,local})` | picks by op: `emu.*` to emulator, `fs.*` with `pc` to local, the rest to relay | what the Explorer uses |

## Write safety

`caps.allowWrite===false` (relay started without `--allow-write`) makes the relay backend answer every write op (`WRITE_OPS`, `net.http` with PUT/DELETE/PATCH) with `NotAllowed` **before sending anything**. The relay enforces it again (`X-AC-Err: 167`); tests check both. The token is required for every `/net/*` call; a wrong token gives `BadToken`. `dosboot.rescan/record` only need the token on the server, but are gated more strictly here.

## Adding a backend

Implement `open/send/receive/close/status/on` (copy `loopback`), return replies in the shape above, translate errors to the error names, and honour `caps.allowWrite`. Then pass it to `router` or use it directly. The SQL gateway and printing should add ops (`sql.*`, `print.*`) and a backend, not a new client.
