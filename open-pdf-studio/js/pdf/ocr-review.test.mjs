import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFArray,PDFBool,StandardFonts,degrees,decodePDFRawStream} from 'pdf-lib';
import {reviewQueue,reviewWord,readOcrReview,writeOcrReview} from './ocr-review.js';
import {writeOcrTextLayer} from './saver/ocr-text-layer.js';
const word=(text,confidence)=>({text,confidence,left:30,top:40,width:50,height:12});
test('unknown and low confidence sort first; mixed-language and numeric corrections preserve confidence',()=>{
 const results={2:[word('房間',50),word('123,45',90)],1:[word('unavailable',undefined),word('foo',10)]};
 assert.deepEqual(reviewQueue(results).map(w=>w.text),['unavailable','foo','房間']);
 const changed=reviewWord(word('12B',20),{action:'correct',text:'128',expectedText:'12B'});
 assert.equal(changed.confidence,20);assert.equal(changed.review.originalText,'12B');
 assert.throws(()=>reviewWord(changed,{action:'accept',expectedText:'12B'}),/STALE/);
});
test('verified text layer replaces only owned OCR, retains artwork and rotation, and reopens once',async()=>{
 let pdf=await PDFDocument.create();let page=pdf.addPage([300,400]);page.setRotation(degrees(90));
 page.drawText('VISIBLE ORIGINAL');
 let font=await pdf.embedFont(StandardFonts.Helvetica);
 writeOcrTextLayer(page,[word('Wrong',12)],font);
 pdf=await PDFDocument.load(await pdf.save());page=pdf.getPage(0);font=await pdf.embedFont(StandardFonts.Helvetica);
 const corrected=reviewWord(readOcrReview(pdf)[1][0],{action:'correct',text:'Correct 123.45',expectedText:'Wrong'});
 writeOcrTextLayer(page,[corrected],font);
 pdf=await PDFDocument.load(await pdf.save());page=pdf.getPage(0);
 const contents=page.node.Contents();const refs=contents instanceof PDFArray?contents.asArray():[contents];
 const streams=refs.map(r=>pdf.context.lookup(r));
 assert.equal(streams.filter(s=>s.dict.get(PDFName.of('OPS_OCRLayer'))===PDFBool.True).length,1);
 const text=streams.map(s=>new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n');
 assert.ok(text.includes('3 Tr'));assert.ok(text.includes('436F7272656374203132332E3435'));
 assert.ok(!text.includes('57726F6E67'));assert.equal(page.getRotation().angle,90);
 assert.equal(readOcrReview(pdf)[1][0].review.status,'corrected');
 assert.equal(readOcrReview(pdf)[1][0].text,'Correct 123.45');
});
test('Unicode review metadata roundtrips without inventing confidence',async()=>{
 let pdf=await PDFDocument.create();const page=pdf.addPage();
 writeOcrReview(page,[{...word('日本語 ١٢٣',undefined),review:{status:'accepted',originalText:'日本語 ١٢٣'}}]);
 pdf=await PDFDocument.load(await pdf.save());
 const restored=readOcrReview(pdf)[1][0];assert.equal(restored.text,'日本語 ١٢٣');assert.equal(restored.confidence,null);
});
import {readFileSync} from 'node:fs';
import {embedOcrFont} from './saver/ocr-text-layer.js';
test('a reviewed glyph outside font coverage fails instead of silently becoming notdef',async()=>{
 const pdf=await PDFDocument.create(),page=pdf.addPage();
 const font=await embedOcrFont(pdf,readFileSync(new URL('../../public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf',import.meta.url)));
 const corrected=reviewWord(word('room',10),{action:'correct',expectedText:'room',text:'房間'});
 assert.throws(()=>writeOcrTextLayer(page,[corrected],font),/OCR_REVIEW_TEXT_NOT_ENCODABLE/);
});
