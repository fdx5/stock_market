import {build} from 'esbuild';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=await mkdtemp(join(tmpdir(),'planting-water-'));
try{
  const output=join(directory,'tests.cjs');
  await build({entryPoints:['tests/planting-water.test.ts'],outfile:output,bundle:true,platform:'node',format:'cjs'});
  process.exitCode=spawnSync(process.execPath,['--test',output],{stdio:'inherit'}).status??1;
}finally{await unlink(join(directory,'tests.cjs')).catch(()=>{});await rmdir(directory);}
