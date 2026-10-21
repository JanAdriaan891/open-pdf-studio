import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import * as mupdf from 'mupdf';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {UNICODE_CASES,createUnicodeFixture,verifyUnicodeExtraction} from './unicode-export-contract.js';
const directory=process.env.OPS_UNICODE_FONT_DIR;
const assets=JSON.parse(await readFile(new URL('../../scripts/unicode-fonts.json',import.meta.url),'utf8'));
const load=async name=>{
 const b=await readFile(path.join(directory,name));
 assert.equal(createHash('sha256').update(b).digest('hex'),assets.find(a=>a.name===name).sha256);
 return b;
};
for(const c of UNICODE_CASES) test(`Unicode visible + OCR roundtrip: ${c.text}`,{skip:directory?false:'Set OPS_UNICODE_FONT_DIR; CI provisions pinned fonts', todo:c.direction==='rtl'?'Arabic shaped glyphs without Unicode mapping produce control characters; not qualified':false},async()=>{
 const output=await createUnicodeFixture(await load(c.font),c.text);
 await verifyUnicodeExtraction(pdfjs,output,c.text);
 const doc=mupdf.Document.openDocument(output,'application/pdf');
 try {
  for(const number of [0,1]) {
   const page=doc.loadPage(number);let pix;
   try {
    pix=page.toPixmap(mupdf.Matrix.identity,mupdf.ColorSpace.DeviceRGB,false,false);
    const dark=pix.getPixels().reduce((n,v)=>n+(v<220?1:0),0);
    if(number===0)assert.ok(dark>100,'Visible page has ink');
    else assert.equal(dark,0,'OCR remains invisible');
   } finally {pix?.destroy();page.destroy();}
  }
 } finally {doc.destroy();}
});
test('fixture contract rejects absent glyphs instead of claiming a successful Unicode roundtrip',{skip:!directory},async()=>{
 await assert.rejects(createUnicodeFixture(await load('Inter-Regular.ttf'),'中文'),/Missing glyph/);
});
