# Transport protocol (v1)

Extends [TRANSPORT.md](TRANSPORT.md) (`web/js/transport.js`). Implementation: `tools/craftcore/framing.cjs` (codec, Endpoint) and `loopback.cjs` (loopback transport). Tests: `scripts/craftcore-test.cjs`.

## 1. Interface (unchanged)

```
open() -> {state}      send({op, args, body}) -> {ok, meta, body, error}
receive(ms) -> event|null    close()    status()    on(evt, fn) / off(evt, fn)
```
Reply: `{ok, meta, body, error:{name, code, message}}`. States: `closed | open | error`. Backends implement this; apps never see the wire.

| Backend | Wire | Notes |
|---|---|---|
| emulator | direct call, no framing | exists (`emulator`) |
| loopback | framed bytes in-process, fault injection | `loopback.cjs`; exists in `transport.js` as an unframed stub |
| relay / HTTP / WebSocket | HTTP JSON today; framed binary over WS later | existing relay |
| serial P:/R: | framed bytes over a 8-bit serial line | Atari side uses the small-buffer profile |
| FujiNet network | `N:` TCP/UDP, same frames | |
| pipe/file | frames appended to a file or named pipe | offline hand-off |

## 2. Frame

All integers little-endian. `crc` covers every byte **after** the sync byte up to the payload end.

| Off | Size | Field |
|---|---|---|
| 0 | 1 | `sync` = `0xC7` |
| 1 | 1 | `ver` = 1 |
| 2 | 1 | `type`: 1 REQ, 2 RES, 3 EVT, 4 ACK, 5 NAK, 6 ERR |
| 3 | 1 | `flags`: bit0 MORE (more chunks follow), bit1 CRC32 |
| 4 | 2 | `msgId` (request/reply pairing) |
| 6 | 2 | `seq` (chunk index from 0) |
| 8 | 2 | `len` payload bytes (0-65535; endpoints negotiate a smaller `maxChunk`, 64-256 for 8-bit) |
| 10 | len | payload |
| 10+len | 2 or 4 | CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), or CRC-32/IEEE if flag CRC32 |

Decoder rules: scan for `C7`; on bad version/CRC/length drop one byte and rescan (so garbage never stalls the stream); a damaged length that promises bytes that never come is abandoned when a later valid frame appears; never throws.

## 3. Chunking and reliability

A message payload is split into chunks of `maxChunk` bytes; all but the last carry MORE. **Stop-and-wait**: the sender transmits one data frame, waits for `ACK(msgId, seq)`; `NAK` or silence (`ackTimeoutMs`) retransmits up to `retries`, then fails with `Timeout`. Receiver: in-order chunk -> ACK; duplicate -> re-ACK and ignore (a lost ACK never duplicates data); gap -> NAK with the expected seq. One message in flight per direction; `maxMessage` bounds reassembly (`TooLarge`). Stop-and-wait is chosen because an 8-bit client has one small buffer; windowing is a later optional flag.

## 4. Messages (payload of REQ / RES / ERR)

- **REQ**: `opcode u8` [if 0: `nameLen u8`, `name`] `metaLen u16` `meta` (JSON args) `body` (raw bytes).
- **RES**: `0 u16` `metaLen u16` `meta` (JSON) `body`.
- **ERR**: `code u16` `metaLen u16` `meta` = JSON `{name, message, native?}`.
- **EVT**: same layout as RES, `msgId` 0; pushed by the far end.

Opcodes (0 = name string follows; 128-255 reserved for applications): `sys.hello 1, sys.ping 2, sys.echo 3, sys.caps 4; fs.list 16, fs.read 17, fs.write 18, fs.mkdir 19, fs.rmdir 20, fs.unlink 21, fs.rename 22; net.http 32, net.tcp.open/read/write/close 33-36, net.udp.open/send/read/close 37-40; disk.read 48, disk.write 49, disk.mount 50, disk.eject 51; sql.query 64, sql.exec 65, sql.schema 66, sql.tables 67; container.put 80, container.get 81, container.list 82`. Ops not in the table (e.g. `emu.*`, `dosboot.*`, `relay.caps`) go by name.

Handshake: client sends `sys.hello {protocol, maxChunk, crc32}`; server replies `{protocol, caps:{allowWrite, maxChunk, ...}}`. A server in read-only mode refuses every op for which `isWrite(req)` is true (same predicate as `transport.js`) with `NotAllowed`, whatever the client believes.

## 5. Error codes

| Code | Name | Meaning |
|---|---|---|
| 0 | OK | |
| 1 | Error | generic |
| 2 | NotFound | |
| 3 | Exists | |
| 4 | NotAllowed | read-only, allow-list, policy |
| 5 | BadToken | auth failed |
| 6 | Unreachable | no link / closed |
| 7 | Unsupported | unknown op or opcode |
| 8 | BadFrame | malformed frame/message |
| 9 | BadChecksum | CRC failed |
| 10 | TooLarge | frame/message over limit |
| 11 | Timeout | no ACK / no reply |
| 12 | Busy | try later |
| 13 | BadVersion | protocol mismatch |
| 14 | Aborted | link closed mid-call |
| 15 | OutOfOrder | chunk gap |

## 6. Reconciliation with `transport.js`

- `PROTOCOL = 1` is the same; **error names are identical** (NotFound, Exists, NotAllowed, BadToken, Unreachable, Unsupported, Error); the framing adds names from 8 up.
- Today `error.code` holds the relay's native number (e.g. 167). On the wire `code` is the protocol number above and the native number travels as `error.native`. *Proposed:* make `transport.js` follow (code = protocol number, `native` = old value). Not done; no existing caller changes until approved.
- `WRITE_OPS` / `isWrite` are reused unchanged by the loopback server.
- The loopback in `transport.js` stays the cheap unframed stub; `tools/craftcore/loopback.cjs` is the framed one used by tests and for developing Atari-side code without hardware.

## 7. Versioning

`ver` in each frame; a different major gets `BadVersion`. Minor additions (new opcodes, meta keys) are backward compatible: unknown meta keys are ignored; unknown opcodes give `Unsupported`.

## 8. Tested

3000 random frames (CRC-16 and CRC-32) encode/decode exactly; every single-bit flip is rejected; the decoder survives garbage, fragmentation and length bombs; 96 messages up to 3 KB are exact under drop/corrupt/duplicate/fragment faults; dead links report `Timeout`.
