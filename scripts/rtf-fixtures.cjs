// Hand-written RTF variants (WordPad-style, unicode/escapes, tables, pictures, fields, lists, nested groups).
// Exports { name: string } so test-roundtrip.cjs and the emulator scripts share them.
const RTFS = {};

RTFS.wordpad = '{\\rtf1\\ansi\\ansicpg1252\\deff0\\nouicompat\\deflang1033{\\fonttbl{\\f0\\fnil\\fcharset0 Calibri;}{\\f1\\fnil\\fcharset0 Arial;}}\r\n' +
  '{\\colortbl ;\\red255\\green0\\blue0;}\r\n{\\*\\generator Riched20 10.0.19041}\\viewkind4\\uc1 \r\n' +
  '\\pard\\sa200\\sl276\\slmult1\\qc\\b\\f0\\fs22\\lang9 WordPad Title\\b0\\par\r\n' +
  '\\pard\\sa200\\sl276\\slmult1\\f1 Plain \\b bold\\b0  \\i italic\\i0  \\ul underline\\ulnone  and \\cf1 red\\cf0  text.\\par\r\n' +
  '\\pard{\\pntext\\f2\\\'B7\\tab}{\\*\\pn\\pnlvlblt\\pnf2\\pnindent0{\\pntxtb\\\'B7}}\\fi-720\\li720\\sa200 First bullet\\par\r\n' +
  '{\\pntext\\f2\\\'B7\\tab}Second bullet\\par\r\n' +
  '\\pard\\sa200\\qr Right side\\par\r\n\\pard\\sa200 Done.\\par\r\n}';

RTFS.escapes = '{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl{\\f0\\fswiss Arial;}}{\\colortbl;\\red0\\green0\\blue0;}{\\stylesheet{\\s0 Normal;}{\\s1 heading 1;}}' +
  '{\\info{\\title Secret Title}{\\author Nobody}{\\*\\company ACME}}\r\n' +
  '\\pard\\plain Smart \\u8217?quote, dash\\u8212?x, euro \\u8364\\\'80 and caf\\\'e9 and \\u233 e-acute.\\par\r\n' +
  '\\uc2 Two skip \\u8220\\\'93\\\'93q\\u8221\\\'94\\\'94 after.\\uc1\\par\r\n' +
  'Negative \\u-10179?\\u-8704? done and {\\*\\unknowndest hidden text}visible, esc \\\\ \\{ \\}.\\par\r\n' +
  '{\\b bold {\\i bold-italic {\\ul all three}} bold-italic-end} plain again\\par\r\n' +
  'Line one\\line Line two\\tab tabbed\\par\r\n\\pard\\qc Centred\\par\\pard\\ql Left again\\par\r\n' +
  '{\\pict\\wmetafile8\\picw1000\\pich1000 0102030405060708090a0b0c0d0e0f}Before-after picture.\\par\r\n' +
  '{\\pict{\\*\\picprop}\\pngblip\\picw10\\pich10 89504e470d0a1a0a}After PNG.\\par\r\n' +
  '{\\field{\\*\\fldinst HYPERLINK "http://example.com/"}{\\fldrslt{\\ul\\cf1 link text}}} trailing.\\par\r\n' +
  '{\\field{\\*\\fldinst PAGE}{\\fldrslt 3}} page field.\\par\r\n' +
  '{\\header\\pard header text\\par}{\\footer footer text\\par}Body end.\\par\r\n}';

RTFS.table = '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\r\n' +
  'Before table\\par\r\n' +
  '\\trowd\\trgaph108\\cellx2000\\cellx4000\\cellx6000\r\n' +
  '\\pard\\intbl Name\\cell Qty\\cell Price\\cell\\row\r\n' +
  '\\trowd\\trgaph108\\cellx2000\\cellx4000\\cellx6000\r\n' +
  '\\pard\\intbl\\b Apple\\b0\\cell 3\\cell 1.50\\cell\\row\r\n' +
  '\\pard After table\\par\r\n}';

RTFS.word = null;
module.exports = RTFS;
