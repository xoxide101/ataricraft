// Circuit Runner map format shared by the build script and the Workbench.
// Current: cols 512, 25 rows of 1024 hex digits (two per column, bit 7 = COLPF3 variant).
// Rows 0-5 far, 6-11 mid, 12-22 near, 23-24 sky (the topmost, slowest layer).
// Older files (cols 256, 23 rows) are upgraded on load: columns repeated, empty sky rows added.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else { root.AC = root.AC || {}; root.AC.CircuitMap = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 512, ROWS = 25, LEGACY_COLS = 256, LEGACY_ROWS = 23;
  const DEFAULT_SKY = { bk: '$00', pf: ['$0E', '$0A', '$92', '$1E'] };
  const hexOk = (r, n) => typeof r === 'string' && r.length === n * 2 && /^[0-9a-fA-F]+$/.test(r);

  function check(m) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.rows)) return '"map" must have a rows list';
    const legacy = m.cols === LEGACY_COLS && m.rows.length === LEGACY_ROWS;
    if (!legacy && !(m.cols === COLS && m.rows.length === ROWS)) return '"map" must have cols ' + COLS + ' and ' + ROWS + ' rows (older files: cols ' + LEGACY_COLS + ', ' + LEGACY_ROWS + ' rows)';
    if (m.rows.some((r) => !hexOk(r, m.cols))) return 'every map row must be ' + m.cols * 2 + ' hex digits';
    return '';
  }
  function upgrade(m) {
    if (m.cols === COLS) return m;
    return { cols: COLS, note: noteText, rows: m.rows.map((r) => r + r).concat(Array.from({ length: ROWS - LEGACY_ROWS }, () => '00'.repeat(COLS))) };
  }
  const noteText = 'rows 0-5 far, 6-11 mid, 12-22 near, 23-24 sky; two hex digits per column';
  function toRows(m) { return m.rows.map((h) => Uint8Array.from({ length: m.cols }, (_, c) => parseInt(h.substr(c * 2, 2), 16))); }
  function ensureSky(bands) { if (bands && !bands.sky) bands.sky = JSON.parse(JSON.stringify(DEFAULT_SKY)); return bands; }
  return { COLS, ROWS, check, upgrade, toRows, ensureSky, noteText, DEFAULT_SKY };
});
