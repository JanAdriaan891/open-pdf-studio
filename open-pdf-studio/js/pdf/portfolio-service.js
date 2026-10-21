import { PDFDocument } from 'pdf-lib';
import { getActiveDocument } from '../core/state.js';
import { readBinaryFile, fileExists, writeBinaryFileAtomic, isTauri } from '../core/platform.js';
import { inspectPortfolio, changePortfolio, extractComponent } from './portfolio.js';
export async function openPortfolioSession(documentId) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || doc.id !== documentId) throw new Error('DOCUMENT_CHANGED');
  if (doc.modified) throw new Error('SAVE_CHANGES_FIRST');
  const original = doc.pdfDoc, revision = doc.inhoudRevisie || 0;
  const check = () => { if (getActiveDocument() !== doc || doc.pdfDoc !== original || doc.modified || (doc.inhoudRevisie || 0) !== revision) throw new Error('DOCUMENT_CHANGED'); };
  let bytes = (await original.getData()).slice(); check();
  let pdf = await PDFDocument.load(bytes.slice()); check();
  return {
    check,
    inspect: () => { check(); return inspectPortfolio(pdf); },
    extract: key => { check(); return extractComponent(pdf,key); },
    bytes: () => { check(); return bytes.slice(); },
    async change(changes) { check(); const result = await changePortfolio(bytes,changes); check(); const next = await PDFDocument.load(result.bytes.slice()); check(); pdf=next; bytes=result.bytes; return result.portfolio; },
  };
}
export async function writePortfolioCopy(session,path) {
  if (!isTauri()) throw new Error('DESKTOP_EXPORT_REQUIRED');
  if (typeof path !== 'string' || !path.toLowerCase().endsWith('.pdf')) throw new Error('PDF_PATH_REQUIRED');
  if (await fileExists(path)) throw new Error('CHOOSE_NEW_FILE');
  const bytes=session.bytes();
  await writeBinaryFileAtomic(path,bytes);
  return {path,portfolio:session.inspect()};
}
export async function portfolioRequest(request) {
  const session=await openPortfolioSession(request.documentId);
  if (request.action === 'inspect') return {documentId:request.documentId,portfolio:session.inspect()};
  if (request.action === 'exportComponent') {
    if (!isTauri()) throw new Error('DESKTOP_EXPORT_REQUIRED');
    if (typeof request.outputPath !== 'string' || !request.outputPath) throw new Error('OUTPUT_PATH_REQUIRED');
    if (await fileExists(request.outputPath)) throw new Error('CHOOSE_NEW_FILE');
    await writeBinaryFileAtomic(request.outputPath,session.extract(request.key));
    return {path:request.outputPath};
  }
  if (request.action !== 'saveCopy') throw new Error('INVALID_ACTION');
  const add=[];
  for (const file of request.add || []) { const bytes=await readBinaryFile(file.path); session.check(); add.push({...file,bytes:new Uint8Array(bytes)}); }
  await session.change({folders:request.folders,add,remove:request.remove,descriptions:request.descriptions});
  return writePortfolioCopy(session,request.outputPath);
}
