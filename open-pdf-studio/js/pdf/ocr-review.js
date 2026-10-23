import {PDFName,PDFArray,PDFDict,PDFRawStream,PDFBool} from 'pdf-lib';
import {pdfTextString,decodePdfTextObject} from './saver/pdf-text.js';
const N=PDFName.of;
export function validOcrWords(words){
 if(!Array.isArray(words)||words.length>50000)throw new Error('INVALID_OCR_WORDS');
 return words.map(w=>{
  if(typeof w?.text!=='string'||w.text.length>2000||!['left','top','width','height'].every(k=>Number.isFinite(w[k]))||w.width<=0||w.height<=0)throw new Error('INVALID_OCR_WORD');
  const out={text:w.text,left:w.left,top:w.top,width:w.width,height:w.height,
   confidence:Number.isFinite(w.confidence)&&w.confidence>=0&&w.confidence<=100?w.confidence:null};
  if(w.review&&['accepted','corrected'].includes(w.review.status))out.review={
   status:w.review.status,originalText:typeof w.review.originalText==='string'?w.review.originalText.slice(0,2000):w.text};
  return out;
 });
}
export function reviewQueue(results,threshold=80){
 if(!Number.isFinite(threshold)||threshold<0||threshold>100)throw new Error('INVALID_THRESHOLD');
 const queue=[];
 for(const [page,words]of Object.entries(results||{})){
  validOcrWords(words).forEach((word,index)=>{
   if(word.confidence===null||word.confidence<threshold||word.review)queue.push({page:Number(page),index,...word});
  });
 }
 return queue.sort((a,b)=>(a.confidence??-1)-(b.confidence??-1)||a.page-b.page||a.index-b.index);
}
export function reviewWord(word,{action,text,expectedText}){
 if(word.text!==expectedText)throw new Error('STALE_OCR_WORD');
 if(!['accept','correct'].includes(action))throw new Error('INVALID_ACTION');
 if(action==='correct'&&(typeof text!=='string'||!text.trim()||text.length>2000))throw new Error('INVALID_TEXT');
 return {...word,text:action==='correct'?text:word.text,review:{status:action==='correct'?'corrected':'accepted',originalText:word.review?.originalText??word.text}};
}
export function readOcrReview(pdf){
 const results={};
 pdf.getPages().forEach((page,i)=>{
  const raw=page.node.get(N('OPS_OCRReview'));const value=raw&&pdf.context.lookup(raw);
  const text=decodePdfTextObject(value);
  if(typeof text!=='string'||text.length>10000000)return;
  try{const data=JSON.parse(text);if(data.version===1)results[i+1]=validOcrWords(data.words);}catch{}
 });
 return results;
}
export function writeOcrReview(page,words){
 page.node.set(N('OPS_OCRReview'),pdfTextString(JSON.stringify({version:1,words:validOcrWords(words)})));
}
export function removeOwnedOcrLayer(page){
 const ctx=page.doc.context,raw=page.node.get(N('Contents')),value=raw&&ctx.lookup(raw);
 const owned=v=>{const stream=ctx.lookup(v);return stream?.dict instanceof PDFDict&&stream.dict.get(N('OPS_OCRLayer'))===PDFBool.True;};
 if(value instanceof PDFArray){for(let i=value.size()-1;i>=0;i--)if(owned(value.get(i)))value.remove(i);}
 else if(raw&&owned(raw))page.node.delete(N('Contents'));
}
