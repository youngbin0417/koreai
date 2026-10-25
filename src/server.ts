import { createRuntime } from './http.js';
import { serverOptions, serverHelp } from './core/platform.js';
import { loadProjectEnv } from './core/project-env.js';
const environment=loadProjectEnv();
const options={...serverOptions(process.argv.slice(2),environment),environment};
if(options.help){console.log(serverHelp);process.exit(0);}
if(process.platform!=='win32')process.umask(0o077);
const runtime=await createRuntime(options);
console.log(`KoreAI 로컬 엔진 ${runtime.baseUrl}\n관리 화면: ${options.dev?'http://127.0.0.1:5173':runtime.publicUrl??runtime.baseUrl}/#setup=${runtime.bootstrapCode}\n브라우저: ${options.channel} · ${options.headless?'headless':'화면 표시'}\n연결 코드는 한 번만 사용할 수 있으며, 비밀정보를 관리하는 사용자에게만 공유하세요.`);
let stopping=false;
const stop=async()=>{if(stopping)return;stopping=true;await runtime.close();process.exit(0);};
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
