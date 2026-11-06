// Node loader: require('web/js/ebookcraft/index.js') gives the whole EBC namespace (same files the browser loads, same order).
'use strict';
require('./ebc-base.js');
try { globalThis.XCW = globalThis.XCW || require('../../../tools/xcwcore.cjs'); } catch (e) { /* CWD/DOCX import and CWD export are optional */ }
require('./ebc-image.js');
require('./ebc-pdf.js');
require('./ebc-book.js');
require('./ebc-viewer-data.js');
require('./ebc-atari.js');
for (const f of ['./ebc-pack.js', './ebc-ocr.js']) { try { require(f); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } }
module.exports = globalThis.EBC;
