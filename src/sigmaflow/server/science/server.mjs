/**
 * Zero-dependency local server and DEMO Agent protocol.
 * NOT a production model backend. Never executes commands, code or uploaded files.
 * Default: http://127.0.0.1:5173 . Bind publicly only behind production authentication.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const runs = new Map();
const mime = { '.html':'text/html;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.css':'text/css;charset=utf-8', '.svg':'image/svg+xml', '.csv':'text/csv;charset=utf-8', '.fasta':'text/plain;charset=utf-8', '.json':'application/json;charset=utf-8' };
const headers = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'same-origin',
  'X-Frame-Options':'DENY',
  'Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https: http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
};
function json(res, code, data) { res.writeHead(code, { ...headers, 'Content-Type':mime['.json'] }); res.end(JSON.stringify(data)); }
async function readJSON(req) {
  let total = 0; const chunks = [];
  for await (const chunk of req) { total += chunk.length; if (total > 128 * 1024) throw Object.assign(new Error('Payload too large'),{status:413}); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON'),{status:400}); }
}
function snapshot(run) {
  return { id:run.id, status:run.status, progress:run.progress, steps:run.steps, isDemo:true, createdAt:run.createdAt };
}
function broadcast(run) {
  const event = `event: state\ndata: ${JSON.stringify(snapshot(run))}\n\n`;
  for (const response of run.clients) {
    response.write(event);
    if (['complete','cancelled'].includes(run.status)) { response.end(); run.clients.delete(response); }
  }
}
const timer = setInterval(() => {
  for (const [id,run] of runs) {
    if (Date.now() - run.createdAt > 3600000 && !run.clients.size) { runs.delete(id); continue; }
    if (run.status !== 'running') continue;
    const step = run.steps.find(s=>s.status !== 'complete');
    if (!step) { run.status='complete'; run.progress=100; broadcast(run); continue; }
    step.status='running'; step.progress=Math.min(100,step.progress+25);
    if (step.progress===100) { step.status='complete'; step.output=`模拟步骤「${step.title}」已完成。未执行真实分析。`; }
    run.progress=Math.round(run.steps.reduce((n,s)=>n+s.progress,0)/run.steps.length);
    if (run.steps.every(s=>s.status==='complete')) run.status='complete';
    broadcast(run);
  }
},700);

const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost'); const pathname=decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      if (req.method==='POST') {
        // Same-origin local development only. A production service must use real auth + CSRF protection.
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res,403,{error:'Cross-origin writes are disabled in the demo server'});
        if (!String(req.headers['content-type'] || '').includes('application/json')) return json(res,415,{error:'Use application/json'});
      }
      if (pathname==='/api/health' && req.method==='GET') return json(res,200,{status:'ok',demo:true,service:'SigmaFlow Science local demo',protocol:'1.0'});
      if (pathname==='/api/runs' && req.method==='POST') {
        const body=await readJSON(req);
        if (typeof body.prompt!=='string' || !body.prompt.trim() || body.prompt.length>6000 || !Array.isArray(body.steps) || body.steps.length<1 || body.steps.length>10) return json(res,400,{error:'prompt and 1–10 steps are required'});
        if (runs.size>=100) return json(res,429,{error:'Demo server run limit reached; restart to reset'});
        const run={id:randomUUID(),status:'running',progress:0,isDemo:true,createdAt:Date.now(),clients:new Set(),steps:body.steps.map((s,index)=>({title:String(s.title || `Step ${index+1}`).slice(0,200),description:String(s.description||'').slice(0,500),tool:String(s.tool||'demo').slice(0,100),progress:0,status:'waiting',index,output:''}))};
        runs.set(run.id,run);return json(res,201,{id:run.id,isDemo:true});
      }
      const match=pathname.match(/^\/api\/runs\/([\w-]+)(?:\/(events|control))?$/);
      if (match) {
        const run=runs.get(match[1]);if(!run)return json(res,404,{error:'Run not found. Demo state is lost when the server restarts.'});
        if(match[2]==='events' && req.method==='GET') {
          res.writeHead(200,{...headers,'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no','Cache-Control':'no-cache'});
          res.write(`event: state\ndata: ${JSON.stringify(snapshot(run))}\n\n`);
          if(['complete','cancelled'].includes(run.status)){res.end();return;}
          run.clients.add(res);const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),15000);
          req.on('close',()=>{clearInterval(heartbeat);run.clients.delete(res);});return;
        }
        if(match[2]==='control' && req.method==='POST') {
          const body=await readJSON(req);const statuses={pause:'paused',resume:'running',cancel:'cancelled'};
          if(!statuses[body.action])return json(res,400,{error:'action must be pause, resume, or cancel'});
          if(['complete','cancelled'].includes(run.status))return json(res,409,{error:'Run is already terminal'});
          run.status=statuses[body.action];broadcast(run);return json(res,200,snapshot(run));
        }
        if(!match[2] && req.method==='GET')return json(res,200,snapshot(run));
      }
      return json(res,404,{error:'API route not found'});
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
    const requested=pathname==='/'?'/index.html':pathname;
    const allowed=/^\/(index\.html|(?:js|css)\/[a-zA-Z0-9._-]+\.(?:js|css)|sample-data\/[a-zA-Z0-9._-]+\.(?:csv|fasta|json))$/;
    if(!allowed.test(requested))return json(res,404,{error:'Not found'});
    const full=path.join(root,requested);const body=await fs.readFile(full);
    res.writeHead(200,{...headers,'Content-Type':mime[path.extname(full)] || 'application/octet-stream','Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);
  } catch(error) { if(!res.headersSent)json(res,error.status || (error.code==='ENOENT'?404:500),{error:error.status ? error.message : 'Request failed'});else res.end(); }
});
server.listen(port,host,()=>console.log(`\n  SigmaFlow Science\n  http://${host}:${port}\n  Local demo only · No LLM / bioinformatics execution\n  Ctrl+C to stop\n`));
function stop(){clearInterval(timer);for(const run of runs.values())for(const res of run.clients)res.end();server.close(()=>process.exit(0));}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
