// SQL gateway core (SQLite first). Policy lives here, enforcement of table/function/write limits is the SQLite authorizer in worker.cjs.
// Clients name a database by ALIAS only; paths and credentials live in a config file outside git (see config.example.json).
'use strict';
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

class GateError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const DEFAULTS = { maxRows: 1000, maxBytes: 1048576, timeoutMs: 5000, maxSql: 4000, maxParams: 100, maxParamLen: 10000 };

// Token-level pre-check. Not the security boundary (the authorizer is), but it rejects the whole class of
// string-literal / comment / multi-statement tricks before SQLite sees them: values must be bound as parameters.
function precheck(sql, mode, cfg) {
  if (typeof sql !== 'string') throw new GateError('bad-sql', 'sql must be a string');
  if (sql.length > cfg.maxSql) throw new GateError('too-long', 'sql is longer than ' + cfg.maxSql);
  if (/[\0\u0080-\uffff]/.test(sql)) throw new GateError('bad-sql', 'only plain ASCII SQL is accepted');
  if (/--|\/\*|\*\//.test(sql)) throw new GateError('bad-sql', 'comments are not allowed');
  if (/['`]/.test(sql)) throw new GateError('literal', 'string literals are not allowed: pass values as ? parameters');
  const body = sql.replace(/;\s*$/, '');
  if (body.includes(';')) throw new GateError('multi', 'only one statement is allowed');
  if (/\?\s*\d|:\w|@\w|\$\w/.test(body)) throw new GateError('bad-sql', 'only anonymous ? parameters are allowed');
  const first = /^\s*([A-Za-z]+)/.exec(body);
  const kw = first ? first[1].toUpperCase() : '';
  if (mode === 'query' && kw !== 'SELECT' && kw !== 'WITH') throw new GateError('not-select', 'only SELECT is allowed here');
  if (mode === 'exec' && !['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(kw)) throw new GateError('not-write', 'sql.exec takes INSERT, UPDATE, DELETE or REPLACE');
  return body;
}

function checkParams(params, cfg) {
  if (params === undefined || params === null) return [];
  if (!Array.isArray(params)) throw new GateError('bad-params', 'params must be an array');
  if (params.length > cfg.maxParams) throw new GateError('bad-params', 'too many params');
  return params.map((p) => {
    if (p === null || typeof p === 'number' && Number.isFinite(p)) return p;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'string' && p.length <= cfg.maxParamLen) return p;
    throw new GateError('bad-params', 'a param is not null, a finite number, a boolean or a short string');
  });
}

function loadConfig(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return normConfig(j, path.dirname(path.resolve(file)));
}

function normConfig(j, base) {
  const cfg = Object.assign({}, DEFAULTS, j.limits || {}, { audit: j.audit || null, databases: {} });
  for (const [alias, d] of Object.entries(j.databases || {})) {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(alias)) throw new GateError('bad-config', 'bad alias ' + alias);
    if (d.engine && d.engine !== 'sqlite') throw new GateError('bad-config', alias + ': engine ' + d.engine + ' is not implemented yet (sqlite only)');
    if (!Array.isArray(d.tables) || !d.tables.length) throw new GateError('bad-config', alias + ': tables (the allow-list) is required');
    cfg.databases[alias] = { path: path.resolve(base || '.', d.path), tables: d.tables.map(String), readOnly: d.readOnly !== false };
  }
  return cfg;
}

function createGate(config) {
  const cfg = config.databases && config.maxRows ? config : normConfig(config, '.');
  const audit = (rec) => {
    if (!cfg.audit) return;
    try { fs.appendFileSync(cfg.audit, JSON.stringify(Object.assign({ t: new Date().toISOString() }, rec)) + '\n'); } catch (e) { /* auditing must not break queries */ }
  };
  const db = (alias) => { const d = cfg.databases[alias]; if (!d) throw new GateError('no-database', 'unknown database alias'); return d; };
  const work = (d, data, tag) => new Promise((resolve, reject) => {
    const w = fork(path.join(__dirname, 'worker.cjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=128'] });
    let done = false;
    const fin = (fn, v) => { if (done) return; done = true; clearTimeout(timer); w.kill('SIGKILL'); fn(v); };
    const timer = setTimeout(() => fin(reject, new GateError('timeout', 'query exceeded ' + cfg.timeoutMs + ' ms')), cfg.timeoutMs);
    w.on('message', (m) => (m.ok ? fin(resolve, m.result) : fin(reject, new GateError(m.code, m.message))));
    w.on('error', (e) => fin(reject, new GateError('worker', e.message)));
    w.on('exit', () => fin(reject, new GateError('worker', 'query process ended unexpectedly')));
    w.send(Object.assign({ path: d.path, tables: d.tables, maxRows: cfg.maxRows, maxBytes: cfg.maxBytes }, data));
  }).then((r) => { audit({ op: tag, ok: true }); return r; }, (e) => { audit({ op: tag, ok: false, code: e.code }); throw e; });

  return {
    config: cfg,
    caps() { return { engines: ['sqlite'], databases: Object.keys(cfg.databases).map((a) => ({ alias: a, readOnly: cfg.databases[a].readOnly })), limits: { maxRows: cfg.maxRows, maxBytes: cfg.maxBytes, timeoutMs: cfg.timeoutMs, maxSql: cfg.maxSql } }; },
    tables(alias) { return work(db(alias), { op: 'tables', mode: 'query' }, 'sql.tables'); },
    schema(alias, table) { return work(db(alias), { op: 'schema', mode: 'query', table }, 'sql.schema'); },
    async query(alias, sql, params, opts) {
      const d = db(alias), body = precheck(sql, 'query', cfg), p = checkParams(params, cfg);
      const rows = Math.min(cfg.maxRows, Math.max(1, (opts && opts.maxRows) | 0 || cfg.maxRows));
      const r = await work(d, { op: 'query', mode: 'query', sql: body, params: p, maxRows: rows }, 'sql.query');
      return r;
    },
    async exec(alias, sql, params) {
      const d = db(alias);
      if (d.readOnly) throw new GateError('read-only', 'this database is read-only');
      const body = precheck(sql, 'exec', cfg), p = checkParams(params, cfg);
      return work(d, { op: 'exec', mode: 'exec', sql: body, params: p }, 'sql.exec');
    },
  };
}

module.exports = { createGate, loadConfig, normConfig, precheck, checkParams, GateError, DEFAULTS };
