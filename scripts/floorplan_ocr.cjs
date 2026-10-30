// Local preview only. Production uses the native Tesseract executable with these same models.
const {createWorker}=require('../frontend/node_modules/tesseract.js');
const path=require('path');
let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>body+=s);
process.stdin.on('end',async()=>{let worker;try{
 const input=JSON.parse(body);const numeric=input.rotation||input.mode==='digits';worker=await createWorker(input.mode==='text'?'kor':numeric?'eng':'kor+eng',1,{langPath:path.resolve(__dirname,'../backend/app/assets/floorplan-ocr'),gzip:false,cacheMethod:'none'});
 await worker.setParameters({tessedit_pageseg_mode:input.mode==='text'?'6':'11',...(numeric?{tessedit_char_whitelist:'0123456789'}:{})});
 const result=await worker.recognize(Buffer.from(input.png,'base64'),{}, {tsv:true});
 process.stdout.write(JSON.stringify({tsv:result.data.tsv}));
 }catch(_){process.exitCode=1;}finally{if(worker)await worker.terminate();}});
