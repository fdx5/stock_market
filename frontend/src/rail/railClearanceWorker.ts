import {cutBuilding} from './railClearance';
self.onmessage=e=>{
  const {id,input,matrix,clearances}=e.data;
  try{const result=cutBuilding(input,matrix,clearances);self.postMessage({id,result},result?{transfer:[result.index.buffer,...Object.values(result.attributes).map(a=>a.array.buffer)]}:undefined);}
  catch(error){self.postMessage({id,error:String(error)});}
};
