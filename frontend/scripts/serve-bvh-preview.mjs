// Read-only local preview and benchmark fixtures; never used in production.
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),fixtures=fileURLToPath(new URL('../../tmp/',import.meta.url));
const server=await createServer({root,configFile:false,plugins:[react(),{name:'bvh-benchmark',configureServer(s){s.middlewares.use((req,res,next)=>{
 const pathname=(req.url??'').split('?')[0];
 if(pathname==='/api/activity/event'){res.statusCode=204;res.end();return;}
 if(req.method==='POST'&&pathname.startsWith('/api/')&&pathname!=='/api/realestate/nearby'){res.statusCode=405;res.end();return;}
 if(pathname==='/__bvh-bench'){res.setHeader('Content-Type','text/html');res.end(readFileSync(new URL('./bvh-bench.html',import.meta.url)));return;}
 if(pathname==='/__hybrid-bench'){res.setHeader('Content-Type','text/html');res.end(readFileSync(new URL('./hybrid-bench.html',import.meta.url)));return;}
 const hybrid=pathname.match(/^\/__hybrid-fixture\/(ganeung|shindonga)\.json$/);
 if(hybrid){res.setHeader('Content-Type','application/json');res.end(readFileSync(fixtures+'hybrid-jobs-'+hybrid[1]+'.json'));return;}
 const match=pathname.match(/^\/__bvh-fixture\/(ganeung|shindonga|luceheim)\.json$/);
 if(match){res.setHeader('Content-Type','application/json');res.end(readFileSync(fixtures+'bvh-'+match[1]+'-fixture.json'));return;}
 next();
 });}}],server:{host:'127.0.0.1',port:4196,strictPort:true,proxy:{
 '/api/realestate/water':{target:process.env.GEOGRAPHY_API||'https://kospimap.com',changeOrigin:true},
 '/api/realestate/crossings':{target:process.env.GEOGRAPHY_API||'https://kospimap.com',changeOrigin:true},
 '/api':{target:'https://kospimap.com',changeOrigin:true}}}});
await server.listen();server.printUrls();
