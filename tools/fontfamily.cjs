// Family registry (see docs/FONT.md, "Family registry"). The code lives in web/js/fontedit/fontfamily.js so the editor loads the same file.
'use strict';
const FF = require('../web/js/fontedit/fontfamily.js');
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'font', 'family-manifest.json');
// the repo manifest (font/family-manifest.json); falls back to the shipped defaults
FF.load = (file) => { try { return FF.parse(fs.readFileSync(file || FILE, 'utf8')); } catch (e) { return FF.craft(); } };
FF.save = (m, file) => { fs.writeFileSync(file || FILE, FF.serialize(m)); };
FF.FILE = FILE;
module.exports = FF;
