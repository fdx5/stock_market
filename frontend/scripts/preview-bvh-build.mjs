import {preview} from 'vite';
import {fileURLToPath} from 'node:url';
const server=await preview({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,
 plugins:[{name:'read-only-preview',configurePreviewServer(s){s.middlewares.use((req,res,next)=>{
  const p=(req.url??'').split('?')[0];if(p==='/api/activity/event'){res.statusCode=204;res.end();return;}
  if(req.method==='POST'&&p.startsWith('/api/')&&p!=='/api/realestate/nearby'){res.statusCode=405;res.end();return;}next();
 });}}],preview:{host:'127.0.0.1',port:4197,strictPort:true,proxy:{
 '/api/realestate/water':{target:process.env.GEOGRAPHY_API||'https://kospimap.com',changeOrigin:true},
 '/api/realestate/crossings':{target:process.env.GEOGRAPHY_API||'https://kospimap.com',changeOrigin:true},
 '/api':{target:'https://kospimap.com',changeOrigin:true}}}});
server.printUrls();
