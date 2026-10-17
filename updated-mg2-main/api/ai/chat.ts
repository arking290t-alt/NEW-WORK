import type { IncomingMessage, ServerResponse } from 'http';

interface VercelRequest extends IncomingMessage {
  query: { [key: string]: string | string[] };
  cookies: { [key: string]: string };
  body: any;
}
interface VercelResponse extends ServerResponse {
  json?: (body: any) => VercelResponse;
  status?: (code: number) => VercelResponse;
}

type Row = Record<string, any>;

function parseBody(req: IncomingMessage): Promise<any> {
  const r = req as any;
  if (r.body && typeof r.body === 'object') return Promise.resolve(r.body);
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function send(res: VercelResponse, code: number, data: any) {
  if (res.status && res.json) { res.status(code); res.json(data); return; }
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function normalizeDate(v: any): string {
  if (!v) return '';
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().toISOString();
  return String(v);
}

function dateRangeFromMessage(message: string): { from?: Date; to?: Date } {
  const m = message.toLowerCase();
  const year = (m.match(/20\d{2}/)?.[0] || String(new Date().getFullYear()));
  const months: Record<string, number> = { january:0, february:1, march:2, april:3, may:4, june:5, july:6, august:7, september:8, october:9, november:10, december:11, jan:0, feb:1, mar:2, apr:3, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11 };
  for (const [name, month] of Object.entries(months)) {
    if (m.includes(name)) {
      const y = Number(year); return { from: new Date(Date.UTC(y, month, 1)), to: new Date(Date.UTC(y, month + 1, 1)) };
    }
  }
  if (m.includes('today')) { const d = new Date(); const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const to = new Date(from); to.setDate(to.getDate()+1); return {from,to}; }
  return {};
}

function filterRows(rows: Row[], message: string): Row[] {
  const { from, to } = dateRangeFromMessage(message);
  const q = message.toLowerCase();
  let out = rows;
  if (from && to) {
    out = out.filter(r => {
      const raw = normalizeDate(r.createdAt || r.updatedAt || r.orderedAt || r.date || r.completedAt);
      const d = new Date(raw); return !Number.isNaN(d.getTime()) && d >= from && d < to;
    });
  }
  if (q.includes('completed')) out = out.filter(r => String(r.status || '').toLowerCase() === 'completed');
  if (q.includes('pending')) out = out.filter(r => String(r.status || '').toLowerCase() === 'pending');
  if (q.includes('not completed') || q.includes('incomplete')) out = out.filter(r => String(r.status || '').toLowerCase() === 'not completed');
  return out;
}

function wantsReport(message: string): boolean { return /\b(excel|xlsx|spreadsheet|csv|pdf|report|download|export)\b/i.test(message); }
function reportFormat(message: string): 'xlsx'|'pdf'|'csv'|null {
  if (/\bpdf\b/i.test(message)) return 'pdf';
  if (/\b(csv)\b/i.test(message)) return 'csv';
  if (/\b(excel|xlsx|spreadsheet)\b/i.test(message)) return 'xlsx';
  if (/\breport\b|\bexport\b|\bdownload\b/i.test(message)) return 'xlsx';
  return null;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) { c ^= b; for (let k=0;k<8;k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name); const crc = crc32(data);
    const h = Buffer.alloc(30+n.length); h.writeUInt32LE(0x04034b50,0); h.writeUInt16LE(20,4); h.writeUInt16LE(0,6); h.writeUInt16LE(0,8); h.writeUInt16LE(0,10); h.writeUInt16LE(0,12); h.writeUInt32LE(crc,14); h.writeUInt32LE(data.length,18); h.writeUInt32LE(data.length,22); h.writeUInt16LE(n.length,26); h.writeUInt16LE(0,28); n.copy(h,30); parts.push(h,data);
    const c = Buffer.alloc(46+n.length); c.writeUInt32LE(0x02014b50,0); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6); c.writeUInt16LE(0,8); c.writeUInt16LE(0,10); c.writeUInt16LE(0,12); c.writeUInt16LE(0,14); c.writeUInt32LE(crc,16); c.writeUInt32LE(data.length,20); c.writeUInt32LE(data.length,24); c.writeUInt16LE(n.length,28); c.writeUInt16LE(0,30); c.writeUInt16LE(0,32); c.writeUInt16LE(0,34); c.writeUInt16LE(0,36); c.writeUInt32LE(0,38); c.writeUInt32LE(offset,42); n.copy(c,46); central.push(c); offset += h.length + data.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(8,8); end.writeUInt16LE(8,10); end.writeUInt32LE(0,12); end.writeUInt32LE(cd.length,16); end.writeUInt16LE(0,20); return Buffer.concat([...parts, cd, end]);
}
function xmlEscape(s: any): string { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function makeXlsx(rows: Row[]): Buffer {
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const cells = (r: Row, i: number) => `<row r="${i}">${keys.map((k,j)=>`<c r="${String.fromCharCode(65+j)}${i}" t="inlineStr"><is><t>${xmlEscape(r[k])}</t></is></c>`).join('')}</row>`;
  const header = `<row r="1">${keys.map((k,j)=>`<c r="${String.fromCharCode(65+j)}1" t="inlineStr"><is><t>${xmlEscape(k)}</t></is></c>`).join('')}</row>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${header}${rows.map((r,i)=>cells(r,i+2)).join('')}</sheetData></worksheet>`;
  return zipStore({
    '[Content_Types].xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="MG Report" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': Buffer.from(sheet)
  });
}
function makeCsv(rows: Row[]): Buffer { const keys=Array.from(new Set(rows.flatMap(r=>Object.keys(r)))); const esc=(v:any)=>`"${String(v??'').replace(/"/g,'""')}"`; return Buffer.from([keys.map(esc).join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\n'),'utf8'); }
function makePdf(rows: Row[]): Buffer {
  const keys=Array.from(new Set(rows.flatMap(r=>Object.keys(r)))).slice(0,7); const lines=[`MG Manager Report`, `Generated: ${new Date().toLocaleString('en-IN')}`, '', keys.join(' | '), ...rows.slice(0,45).map(r=>keys.map(k=>String(r[k]??'')).join(' | '))];
  const esc=(s:string)=>s.replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
  const stream=`BT /F1 8 Tf 40 800 Td ${lines.map((l,i)=>`(${esc(l.slice(0,125))}) Tj ${i<lines.length-1?'0 -14 Td':''}`).join(' ')} ET`;
  const objs=[`<< /Type /Catalog /Pages 2 0 R >>`,`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let out='%PDF-1.4\n', offsets:number[]=[]; objs.forEach((o,i)=>{offsets[i+1]=Buffer.byteLength(out); out+=`${i+1} 0 obj\n${o}\nendobj\n`;}); const x=Buffer.byteLength(out); out+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`; for(let i=1;i<=objs.length;i++) out+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`; out+=`trailer << /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`; return Buffer.from(out,'binary');
}

function chooseDataset(ctx:any, message:string): {name:string; rows:Row[]} {
  const jobs=Array.isArray(ctx?.jobs)?ctx.jobs:[]; const inventory=Array.isArray(ctx?.inventory)?ctx.inventory:[]; const q=message.toLowerCase();
  if (q.includes('inventory') || q.includes('stock') || q.includes('reel')) return {name:'Inventory', rows:filterRows(inventory,message)};
  return {name:'Jobs', rows:filterRows(jobs,message)};
}

async function callOllama(message:string, history:any[], dataset:any) {
  const url=process.env.OLLAMA_URL || process.env.OLLAMA_BASE_URL;
  const model=process.env.OLLAMA_MODEL || 'gemma4:12b';
  if (!url) throw new Error('OLLAMA_URL is not configured in Vercel. Set it to your Cloudflare Tunnel Ollama /api/chat URL.');
  const system=`You are MG Manager AI, a concise factory management assistant. You have live Firebase data supplied below. Never invent database records. Answer directly from the supplied data. If the user asks for a report, summarize what was selected and say a download is available. Current dataset: ${JSON.stringify(dataset).slice(0,90000)}`;
  const messages=[{role:'system',content:system},...(Array.isArray(history)?history.slice(-8).map((h:any)=>({role:h.role==='model'?'assistant':'user',content:String(h.text||'')})):[]),{role:'user',content:message}];
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages,stream:false,options:{temperature:0.2,num_ctx:8192}})});
  if(!r.ok) throw new Error(`Ollama returned HTTP ${r.status}`);
  const data:any=await r.json(); return data?.message?.content || data?.response || 'Ollama returned an empty response.';
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return;} if(req.method!=='POST'){send(res,405,{error:'Method Not Allowed'});return;}
  const body=await parseBody(req); const message=String(body?.message||'').trim(); if(!message){send(res,400,{error:'Message text is required.'});return;}
  const dataset=chooseDataset(body?.databaseContext,message);
  let reply:string; try { reply=await callOllama(message,body?.history,dataset); } catch(e:any) { send(res,502,{error:e?.message||'Unable to reach local Ollama.'}); return; }
  let report:any=null;
  if(wantsReport(message)){ const format=reportFormat(message)||'xlsx'; const rows=dataset.rows; const data=format==='xlsx'?makeXlsx(rows):format==='csv'?makeCsv(rows):makePdf(rows); report={format,filename:`MG-${dataset.name}-${new Date().toISOString().slice(0,10)}.${format}`,mime:format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':format==='csv'?'text/csv':'application/pdf',base64:data.toString('base64'),rowCount:rows.length}; }
  send(res,200,{reply,report,dataset:{name:dataset.name,rowCount:dataset.rows.length},model:process.env.OLLAMA_MODEL||'gemma4:12b'});
}
