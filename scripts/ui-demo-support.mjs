/** Serve only this checkout's generated documentation for built-demo regression. */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
export async function serveBuiltDemo(){
 const root=fileURLToPath(new URL('../docs/',import.meta.url));
 const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2'};
 const server=createServer(async(req,res)=>{
  try{const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
   if(!path.startsWith(resolve(root)+sep)){res.writeHead(403);res.end();return;}
   const body=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store','Content-Length':body.length});res.end(body);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 return {url:`http://127.0.0.1:${server.address().port}/_demo/index.html`,close:()=>new Promise(done=>{server.close(done);server.closeAllConnections();})};
}
