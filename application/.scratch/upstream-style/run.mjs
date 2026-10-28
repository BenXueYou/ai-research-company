import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const name='codex-upstream-style-'+Date.now();
const secret=randomBytes(24).toString('hex');
function run(cmd,args,env=process.env,capture=false){const r=spawnSync(cmd,args,{env,encoding:'utf8',stdio:capture?'pipe':'inherit'});if(r.status!==0)throw new Error('Command failed: '+args[0]);return r.stdout?.trim();}
const env={...process.env,POSTGRES_PASSWORD:secret};
run('docker',['run','--detach','--name',name,'--publish','127.0.0.1::5432','-e','POSTGRES_PASSWORD','-e','POSTGRES_USER=acquisition','-e','POSTGRES_DB=issue46_test','postgres:17.6-alpine'],env,true);
try{
  let ready=false;
  for(let i=0;i<60;i++){if(spawnSync('docker',['exec',name,'pg_isready','-U','acquisition','-d','issue46_test'],{stdio:'ignore'}).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,300));}
  if(!ready)throw new Error('Database not ready');
  const port=run('docker',['port',name,'5432/tcp'],env,true).split(':').at(-1);
  run(process.execPath,['node_modules/@playwright/test/cli.js','test','--config','.scratch/upstream-style/playwright.config.mjs'],{...process.env,TEST_DATABASE_URL:`postgresql://acquisition:${secret}@127.0.0.1:${port}/issue46_test`});
}finally{run('docker',['rm','--force',name],env,true);}
