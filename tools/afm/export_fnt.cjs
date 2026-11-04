// Exports the AFM80 3x7 glyphs as an Atari .FNT (screen-code order); codes 64-95 come from AtariPixel8.fnt
const fs=require('fs');const R=__dirname+'/../../';
const inc=fs.readFileSync(R+'tools/afm/font80.inc','utf8');const pl=[];
for(const m of inc.matchAll(/f80_(\d):\n((?:\s+\.byte [^\n]*\n)+)/g))pl[+m[1]]=m[2].replace(/\.byte/g,'').split(/[,\s]+/).filter(Boolean).map(Number);
const base=fs.readFileSync(R+'web/library/fonts/atari/AtariPixel8.fnt');const out=Buffer.from(base);
for(let sc=0;sc<128;sc++){ if(sc>=64&&sc<96)continue; const a=sc<64?sc+32:sc; const gi=a-32;
 for(let r=0;r<8;r++) out[sc*8+r]= r===0?0:(pl[r-1][gi]<<4); }
fs.writeFileSync(R+'web/library/fonts/atari/Afm3x7.fnt',out);console.log(out.length);