import { PDFDocument, PDFDict, PDFArray, PDFRef, PDFName, PDFRawStream } from 'pdf-lib';

const N=PDFName.of;
const name=v=>v instanceof PDFName?v.decodeText():'';
const dict=v=>v instanceof PDFRawStream?v.dict:v instanceof PDFDict?v:null;
const CATEGORIES=['metadata','comments','attachments','actions'];
function walk(pdf,visit) {
  const seen=new Set();
  const stack=[{value:pdf.context.trailerInfo.Root || pdf.context.getObjectRef(pdf.catalog),path:'Catalog'},{value:pdf.context.trailerInfo.Info,path:'Info'}];
  while(stack.length){
    let {value,path}=stack.pop();
    if(value instanceof PDFRef){if(seen.has(value.toString()))continue;seen.add(value.toString());value=pdf.context.lookup(value);}
    if(!value)continue;
    visit(value,path);
    const d=dict(value);
    if(d)for(const [key,child] of d.entries()) stack.push({value:child,path:path+'/'+key.decodeText()});
    else if(value instanceof PDFArray)for(let i=0;i<value.size();i++)stack.push({value:value.get(i),path:path+'/'+i});
  }
  return seen;
}
function inventory(pdf) {
  const findings=[];
  const add=(category,path,detail,removable=true)=>findings.push({category,path,detail,removable});
  if(pdf.context.trailerInfo.Info)add('metadata','Info','Document information dictionary');
  walk(pdf,(v,path)=>{
    const d=dict(v);if(!d)return;
    const type=name(d.get(N('Type'))),subtype=name(d.get(N('Subtype')));
    if(d.has(N('Metadata')))add('metadata',path+'/Metadata','XMP metadata stream');
    if(d.has(N('PieceInfo')))add('metadata',path+'/PieceInfo','Private application data');
    if((type==='Annot'||(subtype&&d.has(N('Rect'))))&&subtype!=='Widget')add('comments',path,'Annotation: '+subtype);
    if(type==='EmbeddedFile'||d.has(N('EF')))add('attachments',path,'Embedded file');
    if(['A','AA','OpenAction','JavaScript'].some(k=>d.has(N(k)))||d.has(N('JS')))
      add('actions',path,'Document, page, field or annotation actions (including navigation)');
    if(type==='OCG'||type==='OCMD'||d.has(N('OCProperties')))add('hiddenContent',path,'Optional content/layers; visibility-dependent content is not removed',false);
    if(type==='Sig'||name(d.get(N('FT')))==='Sig')add('signatures',path,'Rewriting changes signed bytes; existing signatures will not validate',false);
    if(d.has(N('OutputIntents')))add('conformance',path,'Output intent present; no PDF/A or PDF/X conformance is certified',false);
  });
  const reachable=walk(pdf,()=>{});
  const unreachable=pdf.context.enumerateIndirectObjects().filter(([ref])=>!reachable.has(ref.toString())).length;
  return {findings,unreachableObjects:unreachable,limitations:[
    'Inspection covers structural metadata, annotations, embedded files, actions and optional-content dictionaries.',
    'Invisible text, clipped/covered page content, image pixels and arbitrary application-private streams are not classified or removed.',
    'Removing comments removes non-widget annotations, including visible markups and links. Removing actions also disables navigation and form actions.',
    'A rewritten copy cannot preserve existing digital signatures. Conformance requires independent validation.',
  ]};
}
export async function inspectHiddenInformation(bytes) {
  const pdf=await PDFDocument.load(bytes.slice(),{updateMetadata:false});
  return inventory(pdf);
}
function sweep(pdf) {
  const reachable=walk(pdf,()=>{});let count=0;
  for(const [ref] of pdf.context.enumerateIndirectObjects())if(!reachable.has(ref.toString())){pdf.context.delete(ref);count++;}
  return count;
}
export async function removeHiddenInformation(bytes, categories) {
  if(!Array.isArray(categories)||!categories.length||categories.some(c=>!CATEGORIES.includes(c)))throw new Error('INVALID_REMOVAL_CATEGORIES');
  const selected=new Set(categories);
  const pdf=await PDFDocument.load(bytes.slice(),{updateMetadata:false});
  const before=inventory(pdf);
  const attachmentRefs=new Set();
  if(selected.has('attachments')){
    for(const [ref,v]of pdf.context.enumerateIndirectObjects()){
      const d=dict(v);
      if(d&&(name(d.get(N('Type')))==='EmbeddedFile'||d.has(N('EF'))))attachmentRefs.add(ref.toString());
    }
  }
  // Traverse a snapshot before unlinking, so every still-reachable owner is processed.
  const objects=[];walk(pdf,(v)=>objects.push(v));
  if(selected.has('metadata')) { delete pdf.context.trailerInfo.Info; delete pdf.context.trailerInfo.ID; }
  for(const v of objects){
    const d=dict(v);
    if(d){
      if(selected.has('metadata'))for(const key of ['Metadata','PieceInfo'])d.delete(N(key));
      if(selected.has('actions'))for(const key of ['A','AA','OpenAction','JavaScript','JS'])d.delete(N(key));
      if(selected.has('attachments'))for(const key of ['EmbeddedFiles','AF','EF'])d.delete(N(key));
      const annots=pdf.context.lookup(d.get(N('Annots')));
      if(annots instanceof PDFArray){
        for(let i=annots.size()-1;i>=0;i--){
          const a=pdf.context.lookup(annots.get(i));const ad=dict(a);
          const subtype=ad&&name(ad.get(N('Subtype')));
          if((selected.has('comments')&&subtype&&subtype!=='Widget')||(selected.has('attachments')&&subtype==='FileAttachment'))annots.remove(i);
        }
      }
      if(selected.has('attachments'))for(const [key,value]of d.entries()){
        if(value instanceof PDFRef&&attachmentRefs.has(value.toString()))d.delete(key);
      }
    } else if(v instanceof PDFArray && selected.has('attachments')){
      for(let i=v.size()-1;i>=0;i--){const value=v.get(i);if(value instanceof PDFRef&&attachmentRefs.has(value.toString()))v.remove(i);}
    }
  }
  const removedUnreachableObjects=sweep(pdf);
  const output=await pdf.save({useObjectStreams:false,updateFieldAppearances:false});
  const after=await inspectHiddenInformation(output);
  if(after.findings.some(f=>selected.has(f.category)))throw new Error('REMOVAL_VERIFICATION_FAILED');
  return {bytes:output,report:{selected:[...selected],before,after,removedUnreachableObjects,verified:true,
    verification:'Reopened the rewritten output and inspected its reachable object graph; this is not an all-content sanitization guarantee.'}};
}
