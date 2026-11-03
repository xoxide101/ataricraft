// Workbench Images tab: sort a pile of image files by format and convert them (PNG, BMP, JPEG, WebP and the Atari GR.8 / GR.9 / GR.15 dumps).
// Uses AC.img (imgconv.js). Browser codecs handle JPEG/WebP/GIF/ICO/TIFF decode and JPEG/WebP encode; everything else is pure code.
(function () {
  const root = document.getElementById('images'); if (!root) return;
  const I = AC.img, $ = (id) => document.getElementById(id);
  root.innerHTML = `
  <div style="padding:10px 16px">
  <div class="row"><b>Images</b><span style="opacity:.7">Drop files or pick a folder. Nothing leaves the browser.</span></div>
  <div class="row" id="imdrop" style="border:2px dashed #3a4150;border-radius:6px;padding:14px;justify-content:center">
    <label class="b" style="cursor:pointer">Add files <input type="file" id="imfiles" multiple style="display:none"></label>
    <label class="b" style="cursor:pointer">Add folder <input type="file" id="imdir" webkitdirectory multiple style="display:none"></label>
    <button class="b" id="imclear">Clear</button><span id="imcount" style="opacity:.8"></span>
  </div>
  <div class="row" id="imtypes"></div>
  <div class="row"><label>Show <select id="imfilter"><option value="">all types</option></select></label>
    <label>Name <input type="text" id="imname" style="width:160px" placeholder="contains..."></label>
    <button class="b" id="imall">Select shown</button><button class="b" id="imnone">Select none</button><span id="imsel" style="opacity:.8"></span></div>
  <div class="row"><b>Convert to</b>
    <select id="imto"></select>
    <label>W <input type="text" id="imw" style="width:56px" placeholder="auto"></label><label>H <input type="text" id="imh" style="width:56px" placeholder="auto"></label>
    <label>Fit <select id="imfit"><option value="contain">contain</option><option value="cover">cover</option><option value="stretch">stretch</option></select></label>
    <label>Quality <input type="text" id="imq" value="90" style="width:40px" title="JPEG / WebP, 1 to 100"></label>
    <span id="imatari" class="row" style="margin:0">
      <label><input type="checkbox" id="imdith"> Dither</label>
      <label>Colours (hex) <input type="text" id="imcols" style="width:130px" placeholder="GR.15: 00,28,CA,94"></label>
      <label>Hue <select id="imhue"></select></label>
      <label>Video <select id="imvid"><option value="ntsc">NTSC</option><option value="pal">PAL</option></select></label>
      <label><input type="checkbox" id="imnative"> Keep native size when reading Atari</label>
      <label><input type="checkbox" id="imtrail" title="GR.15 only: append the 4 MicroPainter colour bytes (7684 bytes)"> MicroPainter colour bytes</label>
    </span></div>
  <div class="row"><button class="b" id="imconv">Convert selected</button><button class="b" id="imorg">Download organized ZIP (folder per type)</button><span id="imstat" style="opacity:.85"></span></div>
  <div style="overflow:auto;max-height:55vh"><table id="imtab" style="border-collapse:collapse;width:100%"></table></div></div>`;

  const items = []; // {id, name, bytes, info, thumb, sel}
  let nid = 1;
  const NATIVE = ['png', 'gif', 'jpg', 'webp', 'bmp', 'ico'];
  const TARGETS = [['png', 'PNG'], ['bmp', 'BMP'], ['gif', 'GIF (one frame)'], ['jpg', 'JPEG'], ['webp', 'WebP'], ['gr15', 'Atari GR.15 / MIC (160x192, 4 colours)'], ['gr8', 'Atari GR.8 (320x192, 2 shades)'], ['gr9', 'Atari GR.9 (80x192, 16 shades)']];
  $('imto').innerHTML = TARGETS.map((t) => `<option value="${t[0]}">${t[1]}</option>`).join('');
  $('imhue').innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i}</option>`).join('');

  const status = (t, err) => { $('imstat').textContent = t; $('imstat').style.color = err ? '#ff6b6b' : ''; };
  const hex = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => parseInt(x, 16));
  const atariOpts = () => ({ dither: $('imdith').checked, colors: hex($('imcols').value).length ? hex($('imcols').value) : null, hue: +$('imhue').value, video: $('imvid').value, native: $('imnative').checked, trailer: $('imtrail').checked, fit: $('imfit').value });

  async function decode(it) {
    const f = it.info.format;
    if (I.FORMATS[f].atari) return I.decodeAtari(it.bytes, f, atariOpts());
    if (f === 'bmp') { try { return I.decodeBMP(it.bytes); } catch (e) { /* fall through to the browser codec */ } }
    const bmp = await createImageBitmap(new Blob([it.bytes], { type: I.FORMATS[f].mime || '' }));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    return { w: c.width, h: c.height, data: new Uint8Array(d.data.buffer) };
  }
  const toCanvas = (img) => { const c = document.createElement('canvas'); c.width = img.w; c.height = img.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0); return c; };
  async function encode(img, to) {
    if (to === 'jpg' || to === 'webp') {
      const c = toCanvas(img), blob = await new Promise((r) => c.toBlob(r, to === 'jpg' ? 'image/jpeg' : 'image/webp', Math.max(1, Math.min(100, +$('imq').value || 90)) / 100));
      if (!blob || blob.type !== (to === 'jpg' ? 'image/jpeg' : 'image/webp')) throw new Error('This browser cannot write ' + to);
      return new Uint8Array(await blob.arrayBuffer());
    }
    return I.encode(img, to, atariOpts());
  }
  const resized = (img) => {
    const w = +$('imw').value, h = +$('imh').value;
    if (!w && !h) return img;
    return I.resize(img, w || Math.round(img.w * h / img.h), h || Math.round(img.h * w / img.w), $('imfit').value);
  };

  function shown() {
    const t = $('imfilter').value, q = $('imname').value.toLowerCase();
    return items.filter((it) => (!t || it.info.format === t) && (!q || it.name.toLowerCase().includes(q)));
  }
  function render() {
    const org = I.organize(items.map((it) => ({ name: it.name, bytes: it.bytes })));
    const keys = Object.keys(org.groups).sort();
    $('imtypes').innerHTML = keys.map((k) => `<button class="b" data-k="${k}">${I.FORMATS[k].label.split(' ')[0]} <b>${org.groups[k].length}</b></button>`).join('') || '<span style="opacity:.6">No images yet.</span>';
    $('imtypes').querySelectorAll('button').forEach((b) => (b.onclick = () => { $('imfilter').value = b.dataset.k; render(); }));
    const cur = $('imfilter').value;
    $('imfilter').innerHTML = '<option value="">all types</option>' + keys.map((k) => `<option value="${k}">${I.FORMATS[k].label}</option>`).join('');
    $('imfilter').value = keys.includes(cur) ? cur : '';
    const list = shown();
    $('imcount').textContent = items.length + ' image' + (items.length === 1 ? '' : 's') + (org.unknown.length ? ', ' + org.unknown.length + ' skipped (not images)' : '');
    $('imsel').textContent = items.filter((i) => i.sel).length + ' selected, ' + list.length + ' shown';
    $('imtab').innerHTML = '<tr style="text-align:left;opacity:.7"><th></th><th></th><th>Name</th><th>Type</th><th>Size</th><th>Pixels</th></tr>' + list.map((it) => `<tr data-i="${it.id}" style="border-top:1px solid #2a2f39"><td><input type="checkbox" ${it.sel ? 'checked' : ''}></td><td style="width:52px">${it.thumb ? `<img src="${it.thumb}" style="max-width:48px;max-height:36px;image-rendering:pixelated">` : ''}</td><td>${it.name.replace(/</g, '&lt;')}</td><td>${I.FORMATS[it.info.format].label.split(' ')[0]}</td><td>${it.bytes.length}</td><td>${it.info.w}x${it.info.h}</td></tr>`).join('');
    $('imtab').querySelectorAll('tr[data-i]').forEach((tr) => (tr.querySelector('input').onchange = (e) => { items.find((i) => i.id === +tr.dataset.i).sel = e.target.checked; $('imsel').textContent = items.filter((i) => i.sel).length + ' selected'; }));
  }
  async function add(files) {
    let skipped = 0;
    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer()), name = f.webkitRelativePath || f.name, info = I.info(bytes, name);
      if (!info) { skipped++; continue; }
      const it = { id: nid++, name, bytes, info, sel: true, thumb: '' };
      items.push(it);
      try { const img = await decode(it), c = toCanvas(I.resize(img, Math.min(48, img.w), Math.max(1, Math.round(img.h * Math.min(48, img.w) / img.w)), 'stretch')); it.thumb = c.toDataURL(); } catch (e) { /* no thumbnail */ }
    }
    status(skipped ? skipped + ' file' + (skipped === 1 ? '' : 's') + ' skipped (not images)' : '');
    render();
  }
  const save = (name, bytes, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: type || 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const base = (n) => n.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');

  $('imfiles').onchange = (e) => add([...e.target.files]).then(() => (e.target.value = ''));
  $('imdir').onchange = (e) => add([...e.target.files]).then(() => (e.target.value = ''));
  $('imclear').onclick = () => { items.length = 0; render(); status(''); };
  $('imfilter').onchange = render; $('imname').oninput = render;
  $('imall').onclick = () => { shown().forEach((i) => (i.sel = true)); render(); };
  $('imnone').onclick = () => { items.forEach((i) => (i.sel = false)); render(); };
  const syncAtari = () => { const a = I.FORMATS[$('imto').value].atari; $('imatari').style.display = a || items.some((i) => I.FORMATS[i.info.format].atari) ? '' : 'none'; };
  $('imto').onchange = syncAtari;
  const dz = $('imdrop');
  dz.ondragover = (e) => { e.preventDefault(); dz.style.borderColor = '#ff9d3a'; };
  dz.ondragleave = () => (dz.style.borderColor = '');
  dz.ondrop = (e) => { e.preventDefault(); dz.style.borderColor = ''; add([...e.dataTransfer.files]); };

  $('imconv').onclick = async () => {
    const sel = items.filter((i) => i.sel && shown().includes(i)), to = $('imto').value;
    if (!sel.length) return status('Select at least one image.', true);
    const out = []; let bad = 0;
    for (const it of sel) {
      try {
        status('Converting ' + (out.length + bad + 1) + ' of ' + sel.length + '...');
        out.push({ name: base(it.name) + '.' + I.extFor(to), bytes: await encode(resized(await decode(it)), to) });
      } catch (e) { bad++; status(it.name + ': ' + e.message, true); }
    }
    if (!out.length) return;
    if (out.length === 1) save(out[0].name, out[0].bytes);
    else { const seen = {}; out.forEach((o) => { const n = (seen[o.name] = (seen[o.name] || 0) + 1); if (n > 1) o.name = o.name.replace(/(\.[^.]+)$/, '-' + n + '$1'); }); save('converted-' + to + '.zip', I.zip(out), 'application/zip'); }
    status('Converted ' + out.length + (bad ? ', ' + bad + ' failed' : '') + '.', !!bad);
  };
  $('imorg').onclick = () => {
    const sel = items.filter((i) => i.sel);
    if (!sel.length) return status('Select at least one image.', true);
    const seen = {}, files = sel.map((it) => { const dir = I.folderName(it.info.format), n = it.name.replace(/^.*[\\/]/, ''), key = dir + '/' + n.toLowerCase(), k = (seen[key] = (seen[key] || 0) + 1); return { name: dir + '/' + (k > 1 ? n.replace(/(\.[^.]*)?$/, '-' + k + '$1') : n), bytes: it.bytes }; });
    save('images-by-type.zip', I.zip(files), 'application/zip');
    status('Zipped ' + files.length + ' images into ' + new Set(files.map((f) => f.name.split('/')[0])).size + ' folders.');
  };
  render(); syncAtari();
})();
