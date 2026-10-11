export {};
const base=process.env.KOREAI_URL??'http://127.0.0.1:4318';
try{
  const result=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(3000)});
  if(!result.ok)throw new Error();
  console.log(JSON.stringify(await result.json(),null,2));
  console.log('관리 화면의 에이전트 연결에서 클라이언트를 만들고 MCP 설정을 복사하세요.');
}catch{console.error('엔진이 실행되지 않았습니다. npm run build 후 npm start를 실행하세요.');process.exitCode=1;}
