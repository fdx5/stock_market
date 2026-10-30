import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react(),{name:'apartment-preview-entry',configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url==='/'){res.statusCode=302;res.setHeader('Location','/walk?'+new URLSearchParams({interior:'demo',original:'1',name:'신도6차',town:'호원동',lat:'37.726955',lon:'127.038392',hour:'14'}));res.end();}else next();});}}],server:{host:'127.0.0.1',port:5324,strictPort:true,proxy:{'/api':'http://127.0.0.1:8012'}}});
