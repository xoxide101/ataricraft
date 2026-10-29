// Media catalog kept in SQLite (sql.js, WASM, loaded lazily; works from file://). The app persists db.export() in IndexedDB.
(function () {
  let SQLp = null, db = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('cannot load ' + src));
      document.head.append(s);
    });
  }

  function sql() {
    if (!SQLp) SQLp = (async () => {
      await loadScript(base + 'sql-wasm-b64.js');
      await loadScript(base + 'sql-wasm.js');
      const bin = Uint8Array.from(atob(window.AC_SQL_WASM), (c) => c.charCodeAt(0));
      window.AC_SQL_WASM = null;
      return window.initSqlJs({ wasmBinary: bin });
    })();
    return SQLp;
  }

  const SCHEMA = `
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL, name TEXT, ext TEXT, kind TEXT, size INTEGER,
      modified INTEGER, container TEXT, title TEXT, grp TEXT);
    CREATE TABLE IF NOT EXISTS arc (path TEXT PRIMARY KEY, size INTEGER, modified INTEGER, ents TEXT);
    CREATE INDEX IF NOT EXISTS files_kind ON files(kind);
    CREATE INDEX IF NOT EXISTS files_ext ON files(ext);
    CREATE INDEX IF NOT EXISTS files_name ON files(name);`;

  async function open(bytes) {
    const S = await sql();
    if (db) db.close();
    db = new S.Database(bytes || undefined);
    db.run(SCHEMA);
    if (window.AC && AC.ChipDB) AC.ChipDB.seed(db);
    return db;
  }

  async function ensure() { return db || open(); }

  // rows: [{path, name, ext, kind, size, modified, container, title, grp}]
  // Inserts in chunks and yields so the page stays responsive; onProg(done,total) reports progress. arcs: [{path,size,modified,ents}] archive listing cache.
  async function rebuild(rows, meta, onProg, arcs) {
    await ensure();
    db.run('BEGIN');
    try {
      db.run('DELETE FROM files');
      const st = db.prepare('INSERT INTO files (path,name,ext,kind,size,modified,container,title,grp) VALUES (?,?,?,?,?,?,?,?,?)');
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        st.run([r.path, r.name, r.ext, r.kind, r.size || 0, r.modified || null, r.container || '', r.title || '', r.grp || '']);
        if (i % 2000 === 1999) { if (onProg) onProg(i + 1, rows.length); await new Promise((res) => setTimeout(res)); }
      }
      st.free();
      if (arcs) {
        db.run('DELETE FROM arc');
        const as = db.prepare('INSERT OR REPLACE INTO arc (path,size,modified,ents) VALUES (?,?,?,?)');
        for (const a of arcs) as.run([a.path, a.size || 0, a.modified || 0, a.ents]);
        as.free();
      }
      db.run('DELETE FROM meta');
      const ms = db.prepare('INSERT INTO meta (k,v) VALUES (?,?)');
      for (const [k, v] of Object.entries(meta || {})) ms.run([k, String(v)]);
      ms.free();
      db.run('COMMIT');
    } catch (e) { db.run('ROLLBACK'); throw e; }
  }

  async function putArcs(arcs) {
    await ensure();
    db.run('BEGIN');
    const as = db.prepare('INSERT OR REPLACE INTO arc (path,size,modified,ents) VALUES (?,?,?,?)');
    for (const a of arcs) as.run([a.path, a.size || 0, a.modified || 0, a.ents]);
    as.free();
    db.run('COMMIT');
  }

  async function query(text, params) {
    await ensure();
    const res = db.exec(text, params);
    return res.map((r) => ({ columns: r.columns, rows: r.values }));
  }

  async function rows(text, params) {
    await ensure();
    const st = db.prepare(text, params);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    st.free();
    return out;
  }

  const exportBytes = async () => (await ensure()).export();

  const base = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '') || 'js/') + 'sql/';
  window.AC = window.AC || {};
  AC.Catalog = { open, rebuild, putArcs, query, rows, exportBytes };
})();
