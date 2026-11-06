/* Inspect panel for the tools page. The engine (RAM report, net log, banks, injection) stays in the emulator tab (js/inspect.js);
   every call here goes through AC.ToolsLink (see docs/TOOLSHUB.md and docs/INSPECT.md). */
(function () {
  const AC = (window.AC = window.AC || {});
  let win = null, timer = 0, busy = false;
  const hex = (n, w) => n.toString(16).toUpperCase().padStart(w, '0');
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  const C = (op, args, ms) => AC.ToolsLink.call(op, args, ms);
  const I = (fn, ...args) => C('inspect.' + fn, { args });
  const BK = (fn, ...args) => C('banks.' + fn, { args }, 120000);
  const segText = (r) => (r.segs || []).map((x) => `$${hex(x[0], 4)}-$${hex(x[1], 4)}`).join(' ');

  function open() {
    if (win) { win.style.display = 'flex'; return; }
    win = el('div', 'position:fixed;top:60px;right:20px;width:660px;max-height:86vh;overflow:auto;z-index:50;background:#14171d;color:#dfe3ea;border:1px solid #3a4150;border-radius:8px;display:flex;flex-direction:column;font:12px system-ui,sans-serif;box-shadow:0 8px 30px #000a');
    const bar = el('div', 'display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid #2a2f39;cursor:move;flex-wrap:wrap');
    const TIPS = { RAM: 'Page map of the 64 KB CPU address space with the system variables', Network: 'Log and counters for every N: / FujiNet call', IP: 'View and edit the IP settings the Atari sees from the virtual adapter', Banks: 'Browse extended RAM bank by bank (libatari800 core)', Inject: 'Poke memory, run programs, type text and fake network replies', Remote: 'Let scripts outside the browser drive the emulator', X: 'Close the panel',
      Clear: 'Empty the network log and reset the counters', Apply: 'Use these values for the virtual adapter', Reset: 'Back to the default loopback settings', Poke: 'Write the hex bytes at the address (works while the program runs)', Dump: 'Show length bytes starting at the address as hex', Find: 'Search for hex bytes (A9 00) or text', Type: 'Send the text to the Atari as keystrokes', 'Run a .COM/.XEX…': 'Pick a program file from your PC and boot it', 'Add fake reply': 'Answer N:HTTP requests whose URL contains the text with this status and body', 'Remove all': 'Delete every fake reply', Connect: 'Start taking commands from the relay', Disconnect: 'Stop taking commands from the relay', '< 256': 'Previous 256 bytes', '256 >': 'Next 256 bytes', Go: 'Jump the hex view to the offset (hex, 0000-3EFF)' };
    const btn = (t, f, tip) => { const b = el('button', 'padding:3px 8px', t); if (tip || TIPS[t]) b.title = tip || TIPS[t]; b.onclick = f; return b; };
    const body = el('div', 'padding:8px;display:flex;flex-direction:column;gap:8px'), tabs = {};
    const show = (k) => { for (const n in tabs) { tabs[n].box.style.display = n === k ? '' : 'none'; tabs[n].btn.style.opacity = n === k ? 1 : .6; } localStorage.setItem('ac.inspect.tab', k); refresh(); };
    const mk = (k, label) => { const box = el('div', 'display:flex;flex-direction:column;gap:6px'), b = btn(label, () => show(k)); tabs[k] = { box, btn: b }; bar.append(b); body.append(box); return box; };
    const link = el('div', 'color:#8a93a3;padding:0 8px 6px;font-size:11px');
    bar.append(el('b', '', 'INSPECT'));
    const ramBox = mk('ram', 'RAM'), netBox = mk('net', 'Network'), ipBox = mk('ip', 'IP'), bnkBox = mk('bnk', 'Banks'), injBox = mk('inj', 'Inject'), remBox = mk('rem', 'Remote');
    bar.append(el('span', 'flex:1'), btn('X', () => { win.style.display = 'none'; }));

    // RAM
    const cv = el('canvas'); cv.width = 512; cv.height = 256; cv.style.cssText = 'width:512px;height:256px;image-rendering:pixelated;background:#000;align-self:center'; const ramInfo = el('pre', 'margin:0;font:12px Consolas,monospace;white-space:pre-wrap'), tip = el('div', 'color:#8a93a3', 'Each cell is a 256-byte page ($00 top-left, 16 per row). Brightness = non-zero bytes, red = changed since the last refresh.');
    cv.onmousemove = (e) => { const r = cv.getBoundingClientRect(), p = (((e.clientY - r.top) / r.height * 16) | 0) * 16 + (((e.clientX - r.left) / r.width * 16) | 0); const x = lastRam && lastRam.pages[p]; if (x) tip.textContent = `Page $${hex(p, 2)}00  ${x.label}  ${x.nonzero}/256 non-zero, ${x.changed} changed`; };
    ramBox.append(cv, ramInfo, tip);
    let lastRam = null, net = null;
    // Network
    const netInfo = el('pre', 'margin:0;font:12px Consolas,monospace;white-space:pre-wrap'), netLog = el('pre', 'margin:0;font:11px Consolas,monospace;white-space:pre;overflow:auto;max-height:300px;background:#0c0e12;padding:6px;border-radius:4px');
    netBox.append(el('div', 'display:flex;gap:6px', ''), netInfo, netLog); netBox.firstChild.append(btn('Clear', async () => { await C('net.reset'); refresh(); }));
    // IP
    const fields = {}, ipMsg = el('div', 'color:#8a93a3');
    const grid = el('div', 'display:grid;grid-template-columns:110px 1fr;gap:4px 8px;align-items:center');
    for (const [k, l] of [['ssid', 'Network name'], ['hostname', 'Hostname'], ['ip', 'IP address'], ['mask', 'Netmask'], ['gw', 'Gateway'], ['dns', 'DNS'], ['mac', 'MAC'], ['bssid', 'BSSID']]) { const i = el('input', 'background:#0c0e12;color:#dfe3ea;border:1px solid #2a2f39;border-radius:4px;padding:3px 6px'); fields[k] = i; grid.append(el('label', '', l), i); }
    const dh = el('input'); dh.type = 'checkbox'; fields.dhcp = dh; grid.append(el('label', '', 'DHCP lease'), dh);
    const fillIp = (cfg) => { for (const k in fields) if (k === 'dhcp') fields[k].checked = cfg.dhcp; else fields[k].value = cfg[k]; };
    const apply = async () => { try { const o = {}; for (const k in fields) o[k] = k === 'dhcp' ? fields[k].checked : fields[k].value; await I('setIp', o); ipMsg.textContent = 'Applied. The Atari sees this the next time it reads the adapter config (FujiNet command $E8, or IPCONFIG).'; } catch (e) { ipMsg.textContent = 'Error: ' + e.message; } };
    const fromPc = async () => { try { const base = localStorage.getItem('ac.tnfsbridge') || 'http://127.0.0.1:8765', r = await (await fetch(base + '/ctl/info', { method: 'POST', headers: { 'X-AC-Token': localStorage.getItem('ac.nettoken') || '' } })).json(); const a = r.interfaces && r.interfaces[0]; if (!a) throw new Error('no interface'); fields.ip.value = a.address; fields.mask.value = a.netmask; fields.gw.value = a.gateway || fields.gw.value; fields.mac.value = a.mac || fields.mac.value; fields.dhcp.checked = true; apply(); } catch (e) { ipMsg.textContent = 'Needs the relay: ' + e.message; } };
    ipBox.append(grid, el('div', 'display:flex;gap:6px', ''), ipMsg); ipBox.children[1].append(btn('Apply', apply), btn('Use this PC\'s address (relay)', fromPc, 'Copies the PC\'s first non-loopback IPv4 settings from the relay'), btn('Reset', async () => { fillIp(await I('setIp', { ip: '127.0.0.1', gw: '127.0.0.1', mask: '255.0.0.0', dns: '8.8.8.8', dhcp: false })); }));
    // Banks (extended RAM)
    function inp0(ph, w) { const i = el('input', `background:#0c0e12;color:#dfe3ea;border:1px solid #2a2f39;border-radius:4px;padding:3px 6px;${w ? 'width:' + w : ''}`); i.placeholder = ph; return i; }
    const bInfo = el('pre', 'margin:0;font:12px Consolas,monospace;white-space:pre-wrap'), bCv = el('canvas'), bHex = el('pre', 'margin:0;font:11px Consolas,monospace;background:#0c0e12;padding:6px;border-radius:4px;overflow:auto'), bFind = inp0('find (hex bytes or text)', '200px'), bOff = inp0('offset (hex)', '90px');
    bCv.width = 512; bCv.height = 256; bCv.style.cssText = 'width:512px;height:256px;image-rendering:pixelated;background:#000;align-self:center;cursor:pointer';
    let bScan = null, bSel = 0, bBase = 0;
    const bShow = async () => { try { const d = await BK('read', bSel, bBase, 256); let s = `Bank ${bSel}  (PORTB $${hex(bScan ? bScan[bSel].portb : 0, 2)})  offset $${hex(bBase, 4)}  = CPU $${hex(0x4000 + bBase, 4)}\n`; for (let i = 0; i < 256; i += 16) s += `${hex(bBase + i, 4)}  ${[...d.subarray(i, i + 16)].map((x) => hex(x, 2)).join(' ')}  ${[...d.subarray(i, i + 16)].map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')}\n`; bHex.textContent = s; } catch (e) { bHex.textContent = 'Error: ' + e.message; } };
    const bDraw = () => { const g = bCv.getContext('2d'), h = Math.max(1, Math.min(8, (256 / bScan.length) | 0)); g.fillStyle = '#000'; g.fillRect(0, 0, 512, 256); bScan.forEach((b, i) => b.pages.forEach((nz, p) => { g.fillStyle = nz ? `rgb(${nz / 3 | 0},${Math.min(255, 70 + nz) | 0},${nz / 2 | 0})` : '#12161c'; g.fillRect(p * 8, i * h, 7, h - 1); })); if (bSel < bScan.length) { g.strokeStyle = '#fc0'; g.strokeRect(0.5, bSel * h + 0.5, 511, h - 1); } bCv.dataset.h = h; };
    const bRun = async () => { try { bInfo.textContent = 'Scanning…'; bScan = await BK('scan'); const pg = await BK('page'); bInfo.textContent = bScan.length ? `${bScan.length} extended banks (${bScan.length * 16} KB). Monitor at $${hex(pg << 8, 4)}. Each row is one 16 KB bank, each cell a 256-byte page ($4000-$7FFF window); brightness = non-zero bytes.` : 'No extended RAM on this machine (pick a 130XE / Rambo / 576K / 1088K RAM size).'; if (bScan.length) { bDraw(); await bShow(); } } catch (e) { bInfo.textContent = 'Error: ' + e.message; } };
    bCv.onclick = (e) => { if (!bScan) return; const r = bCv.getBoundingClientRect(), h = +bCv.dataset.h || 4, i = Math.floor((e.clientY - r.top) / r.height * 256 / h); if (i >= 0 && i < bScan.length) { bSel = i; bBase = 0; bDraw(); bShow(); } };
    const bRow = el('div', 'display:flex;gap:6px;flex-wrap:wrap;align-items:center'); bRow.append(btn('Scan banks', bRun, 'Installs the resident bank monitor (VBI hook) and maps every bank in turn'), btn('< 256', () => { bBase = Math.max(0, bBase - 256); bShow(); }), bOff, btn('Go', () => { bBase = Math.min(16384 - 256, parseInt(bOff.value || '0', 16) || 0); bShow(); }), btn('256 >', () => { bBase = Math.min(16384 - 256, bBase + 256); bShow(); }), bFind, btn('Find', async () => { try { const r = await BK('find', bFind.value, 32); bInfo.textContent = r.length ? 'Found: ' + r.map((x) => `bank ${x.bank} +$${hex(x.offset, 4)}`).join('  ') : 'Not found in any bank.'; } catch (e) { bInfo.textContent = 'Error: ' + e.message; } }));
    bnkBox.append(el('div', 'color:#8a93a3', 'Extended RAM. Needs the libatari800 core. The monitor sits in a free page and hooks the vertical-blank vector, so the running program must keep the OS interrupts on. Reading holds a bank for about two frames.'), bRow, bInfo, bCv, bHex);
    // Inject
    const inp = inp0, say = el('div', 'color:#8a93a3;white-space:pre-wrap');
    const guard = (f) => async () => { try { say.textContent = String(await f()); } catch (e) { say.textContent = 'Error: ' + e.message; } };
    const pAddr = inp('address (hex)', '90px'), pBytes = inp('bytes (hex, spaces)', '260px'), pLen = inp('length', '60px');
    const rowA = el('div', 'display:flex;gap:6px;flex-wrap:wrap;align-items:center'); rowA.append(pAddr, pBytes, btn('Poke', guard(async () => { const a = parseInt(pAddr.value, 16), d = pBytes.value.trim().split(/\s+/).map((x) => parseInt(x, 16)); if (isNaN(a) || d.some(isNaN)) throw new Error('bad hex'); return `Wrote ${await I('poke', a, d)} byte(s) at $${hex(a, 4)}`; })), pLen,
      btn('Dump', guard(async () => { const a = parseInt(pAddr.value, 16), n = +pLen.value || 64, d = Uint8Array.from(atob(await I('dump', a, n)), (c) => c.charCodeAt(0)); let s = ''; for (let i = 0; i < d.length; i += 16) s += `$${hex(a + i, 4)}  ${[...d.subarray(i, i + 16)].map((x) => hex(x, 2)).join(' ')}\n`; return s; })));
    const pFind = inp('find (hex bytes or text)', '200px'); const rowF = el('div', 'display:flex;gap:6px'); rowF.append(pFind, btn('Find', guard(async () => 'Found at: ' + ((await I('find', pFind.value, 0, 0xFFFF)).map((a) => '$' + hex(a, 4)).join(' ') || 'nowhere'))));
    const fi = el('input'); fi.type = 'file'; fi.style.display = 'none'; fi.onchange = guard(async () => { const f = fi.files[0]; if (!f) return ''; const b = new Uint8Array(await f.arrayBuffer()); fi.value = ''; const r = await C('inspect.load', { name: f.name, bytes: b }); return `Booted ${f.name} (${b.length} bytes), segments: ${segText(r) || 'n/a'}`; });
    const typ = inp('type text into the Atari', '260px'); const rowT = el('div', 'display:flex;gap:6px'); rowT.append(btn('Run a .COM/.XEX…', () => fi.click()), typ, btn('Type', guard(async () => { await C('type', { text: typ.value }); return 'Typed.'; })));
    const mP = inp('URL contains…', '200px'), mS = inp('status', '60px'), mB = inp('reply body text', '240px'); mS.value = '200'; const rowM = el('div', 'display:flex;gap:6px;flex-wrap:wrap'); rowM.append(mP, mS, mB, btn('Add fake reply', guard(async () => { if (!mP.value) throw new Error('enter part of a URL'); await I('mock', mP.value, +mS.value || 200, mB.value); return 'The Atari now gets that reply for N:HTTP requests whose URL contains "' + mP.value + '".'; })), btn('Remove all', guard(async () => { await I('unmock'); return 'Fake replies removed.'; })));
    const pSel = el('select', 'background:#0c0e12;color:#dfe3ea;border:1px solid #2a2f39;border-radius:4px;padding:3px 6px'), pDesc = el('div', 'color:#8a93a3');
    let progs = [];
    const pShow = () => { const p = progs.find((x) => x.name === pSel.value); pDesc.textContent = p ? p.desc : ''; }; pSel.onchange = pShow;
    const loadProgs = async () => {
      if (progs.length) return;
      try { progs = await C('inspect.progs', {}, 30000); } catch (e) { return; }
      for (const g of [...new Set(progs.map((p) => p.group))]) { const og = el('optgroup'); og.label = g; progs.filter((p) => p.group === g).forEach((p) => { const o = el('option', '', p.name); o.value = p.name; og.append(o); }); pSel.append(og); }
      pShow();
    };
    const rowP = el('div', 'display:flex;gap:6px;align-items:center;flex-wrap:wrap'); rowP.append(pSel, btn('Run built-in program', guard(async () => { const r = await C('inspect.runProg', { name: pSel.value }, 30000); return `Started ${pSel.value} (${(r.segs || []).length} segment(s)). It replaces whatever is running, like booting the file.`; }), 'Boots the selected program in the emulator, no disk needed'), pDesc);
    injBox.append(el('b', '', 'Memory'), rowA, rowF, el('b', '', 'Programs and keys'), rowP, rowT, el('b', '', 'Network replies (injected into the N: device)'), rowM, say, fi);
    // Remote
    const remInfo = el('div', 'white-space:pre-wrap;color:#8a93a3'), rurl = inp('relay address', '240px'); rurl.value = localStorage.getItem('ac.tnfsbridge') || 'http://127.0.0.1:8765';
    remBox.append(el('div', '', 'Lets scripts outside the browser read and drive the emulator through the local relay (token protected, local only).'), el('div', 'display:flex;gap:6px'), remInfo, el('pre', 'margin:0;font:11px Consolas,monospace;color:#aab', 'node tools/ctl.cjs state\nnode tools/ctl.cjs peek 0600 32\nnode tools/ctl.cjs poke 0600 A9 01 60\nnode tools/ctl.cjs run GAME.XEX\nnode tools/ctl.cjs net | ip | ram | type "PRINT 1"'));
    remBox.children[1].append(rurl, btn('Connect', async () => { localStorage.setItem('ac.tnfsbridge', rurl.value); try { remInfo.textContent = await C('remote.connect', { url: rurl.value }); } catch (e) { remInfo.textContent = e.message; } }), btn('Disconnect', async () => { try { remInfo.textContent = await C('remote.stop'); } catch (e) { remInfo.textContent = e.message; } }));

    async function refresh() {
      if (busy) return;
      const k = localStorage.getItem('ac.inspect.tab') || 'ram';
      if (!AC.ToolsLink.connected()) { ramInfo.textContent = 'The emulator is not connected. Use the Emulator button at the top of the page to open it.'; return; }
      busy = true;
      try {
        if (k === 'ram') {
          try {
            const r = lastRam = await C('inspect.ram'), g = cv.getContext('2d'), im = g.createImageData(512, 256);
            r.pages.forEach((p, i) => { const x0 = (i & 15) * 32, y0 = (i >> 4) * 16, v = Math.min(255, 40 + p.nonzero), hot = p.changed > 0; for (let y = 0; y < 15; y++) for (let x = 0; x < 31; x++) { const o = ((y0 + y) * 512 + x0 + x) * 4; im.data[o] = hot ? 255 : p.nonzero ? v / 3 : 18; im.data[o + 1] = hot ? 90 : p.nonzero ? v : 18; im.data[o + 2] = hot ? 60 : p.nonzero ? v / 2 : 22; im.data[o + 3] = 255; } });
            g.putImageData(im, 0, 0); ramInfo.textContent = r.text;
          } catch (e) { ramInfo.textContent = 'Boot the emulator first.'; }
        } else if (k === 'net') {
          net = await C('net.get'); const s = net.summary; netInfo.textContent = `calls ${s.calls}   errors ${s.errors}   sent ${s.tx} B   received ${s.rx} B   open sockets ${s.open}   fake replies ${s.mocks.length}`;
          const rows = net.events.map((e) => `${new Date(e.t).toLocaleTimeString()} ${e.kind.padEnd(5)} ${(e.status || (e.err ? 'E' + e.err : '')).toString().padEnd(4)} ${String(e.rx || '').padStart(6)} ${String(e.ms != null ? e.ms + 'ms' : '').padStart(6)}  ${e.desc}`);
          netLog.textContent = rows.length ? rows.join('\n') : 'No network activity yet (enable FujiNet and use N: from the Atari).';
        } else if (k === 'ip') { if (!ipBox.contains(document.activeElement) || document.activeElement === document.body) fillIp(await I('ip')); }
        else if (k === 'inj') await loadProgs();
        else if (k === 'rem') remInfo.textContent = await C('remote.status');
      } catch (e) { /* the emulator went away; the status bar says so */ } finally { busy = false; }
    }
    let dx = 0, dy = 0, drag = false;
    bar.onmousedown = (e) => { if (e.target !== bar) return; drag = true; const r = win.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; };
    window.addEventListener('mousemove', (e) => { if (drag) { win.style.left = e.clientX - dx + 'px'; win.style.top = e.clientY - dy + 'px'; win.style.right = 'auto'; } });
    window.addEventListener('mouseup', () => { drag = false; });
    win.append(bar, body, link); document.body.append(win);
    show(localStorage.getItem('ac.inspect.tab') || 'ram');
    loadProgs();
    timer = setInterval(() => { if (win.style.display !== 'none') refresh(); }, 600);
    AC.ToolsLink.onChange((s) => { link.textContent = s.connected ? 'Linked to the emulator tab (' + s.info.model + ', ' + s.info.core + ')' : 'The emulator is not connected'; refresh(); });
  }

  AC.InspectPanel = { open };
})();
