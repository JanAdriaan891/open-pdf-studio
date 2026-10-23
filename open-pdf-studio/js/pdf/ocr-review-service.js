import {PDFDocument} from 'pdf-lib';
import {getActiveDocument} from '../core/state.js';
import {execute} from '../core/undo-manager.js';
import {opslaanGeweigerd} from './wachtwoord-pdf.js';
import {readOcrReview,reviewQueue,reviewWord} from './ocr-review.js';
async function documentFor(id){
 const doc=getActiveDocument();if(!doc?.pdfDoc||doc.id!==id)throw new Error('DOCUMENT_CHANGED');
 const pdf=doc.pdfDoc;
 if(!Object.keys(doc.ocrResults||{}).length){
  const parsed=await PDFDocument.load((await pdf.getData()).slice(),{updateMetadata:false});
  if(getActiveDocument()!==doc||doc.pdfDoc!==pdf)throw new Error('DOCUMENT_CHANGED');
  if(!Object.keys(doc.ocrResults||{}).length)doc.ocrResults=readOcrReview(parsed);
 }
 return doc;
}
export async function listOcrReview(documentId,threshold=80,options={}){
 const doc=await documentFor(documentId);
 const words=reviewQueue(doc.ocrResults,threshold);
 const offset=Math.max(0,Math.floor(Number(options.offset)||0)),limit=Math.min(1000,Math.max(1,Math.floor(Number(options.limit)||100)));
 return {documentId,offset,limit,revision:doc.inhoudRevisie||0,words:words.slice(offset,offset+limit),total:words.length,reviewed:words.filter(w=>w.review).length};
}
export async function updateOcrReview(request){
 const doc=await documentFor(request.documentId);
 if(opslaanGeweigerd(doc))throw new Error('READ_ONLY_DOCUMENT');
 if(request.revision!==(doc.inhoudRevisie||0))throw new Error('DOCUMENT_CHANGED');
 const word=doc.ocrResults[request.page]?.[request.index];
 if(!word)throw new Error('OCR_WORD_NOT_FOUND');
 reviewQueue(doc.ocrResults,request.threshold??80);
 const oldWord=JSON.parse(JSON.stringify(word)),newWord=reviewWord(oldWord,request);
 doc.ocrResults[request.page][request.index]=newWord;
 execute({type:'ocrWord',page:request.page,index:request.index,oldWord,newWord});
 return listOcrReview(request.documentId,request.threshold??80,request);
}
