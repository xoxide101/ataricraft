// Progress strip under the top bar. Tasks that finish quickly never show (shown after SHOW_AFTER ms).
(() => {
  window.AC = window.AC || {};
  const SHOW_AFTER = 250;
  const tasks = [];
  let el = null, fill = null, lab = null, pct = null;

  function ui() {
    if (el) return true;
    el = document.getElementById('progstrip');
    if (!el) return false;
    fill = el.querySelector('.pfill'); lab = el.querySelector('.plab'); pct = el.querySelector('.ppct');
    return true;
  }
  const fmtMB = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  function paint() {
    if (!ui()) return;
    const now = performance.now();
    const t = [...tasks].reverse().find((x) => now - x.t0 >= SHOW_AFTER);
    if (!t) { el.style.display = 'none'; return; }
    el.style.display = '';
    const known = t.total > 0;
    el.classList.toggle('indet', !known);
    const p = known ? Math.min(100, (t.done / t.total) * 100) : 0;
    fill.style.width = known ? p.toFixed(1) + '%' : '';
    lab.textContent = t.label + (tasks.length > 1 ? `  (+${tasks.length - 1} more)` : '');
    pct.textContent = known ? (t.bytes ? `${fmtMB(t.done)} / ${fmtMB(t.total)}  ` : `${t.done} / ${t.total}  `) + Math.floor(p) + '%' : (t.note || '');
  }
  let pending = 0;
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => { pending = 0; paint(); }, 60);
  }

  // begin(label, total?, bytes?) -> { set(done,total?), text(label), note(str), end() }
  function begin(label, total, bytes) {
    const t = { label, total: total || 0, done: 0, bytes: !!bytes, note: '', t0: performance.now() };
    tasks.push(t);
    setTimeout(paint, SHOW_AFTER + 10);
    return {
      set(done, tot) { t.done = done; if (tot != null) t.total = tot; schedule(); },
      text(s) { t.label = s; schedule(); },
      note(s) { t.note = s; schedule(); },
      end() { const i = tasks.indexOf(t); if (i >= 0) tasks.splice(i, 1); paint(); },
    };
  }

  // Lets the browser paint the strip before a long synchronous job (the 7z extractor cannot report progress itself).
  const yieldUI = () => new Promise((r) => { const to = setTimeout(r, 60); requestAnimationFrame(() => setTimeout(() => { clearTimeout(to); r(); }, 0)); });

  // Reads a File/Blob into a Uint8Array, reporting bytes read for large ones.
  async function read(file, label) {
    const size = file.size || 0;
    if (!file.stream || size < (2 << 20)) return new Uint8Array(await file.arrayBuffer());
    const p = begin(label || 'Reading ' + (file.name || 'file'), size, true);
    try {
      const out = new Uint8Array(size);
      const rd = file.stream().getReader();
      let n = 0;
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        if (n + value.length > out.length) throw new Error('file grew while reading');
        out.set(value, n); n += value.length; p.set(n);
      }
      return n === size ? out : out.subarray(0, n);
    } finally { p.end(); }
  }

  // Runs fn(progress) with a task around it.
  async function run(label, total, fn, bytes) {
    const p = begin(label, total, bytes);
    try { return await fn(p); } finally { p.end(); }
  }

  AC.Progress = { begin, read, run, yieldUI, fmtMB };
})();
