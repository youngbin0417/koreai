import { chromium, type BrowserContext, type Page } from 'playwright';
import { join } from 'node:path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ActionError, type Action, type Executor } from '../types.js';
import { browserDefaults, type BrowserChannel } from '../core/platform.js';

const readSchema=z.object({}).strict();
const publishSchema=z.object({title:z.string().trim().min(1).max(120),content:z.string().trim().min(1).max(5000)}).strict();
export const browserActions:Action[]=[['read','시험 사이트 읽기',readSchema],['publish','시험 사이트 글 작성',publishSchema]].map(([kind,title,schema])=>({
  id:`browser.demo.${kind}`,serviceId:'koreai-demo',connectorId:'browser-demo',title:String(title),description:'KoreAI가 소유한 로컬 시험 사이트에서 브라우저 작업을 검증합니다. 실제 서비스 지원 실적에 포함되지 않습니다.',category:'브라우저 시험',effect:kind==='publish'?'write':'read',method:'browser',
  schema:schema as z.ZodTypeAny,inputSchema:zodToJsonSchema(schema as z.ZodTypeAny,{$refStrategy:'none'}) as Record<string,unknown>,
  requiredSecrets:[],scopes:[],sourceUrl:'local:owned-demo',checkedAt:null,verification:'documented',resultCheck:'시험 사이트의 게시 결과와 작업 ID 대조',domains:['127.0.0.1'],version:'0.1.0',maintainer:'KoreAI',origin:'bundled',implemented:true,
}));

/** Deliberately exposes named recipes, never arbitrary JS, selectors, or navigation to an agent. */
export class BrowserRunner {
  private context?:BrowserContext;
  private starting?:Promise<BrowserContext>;
  private busy=false;
  baseUrl='';
  constructor(readonly dataDir:string,readonly channel:BrowserChannel=browserDefaults().channel,readonly headless=browserDefaults().headless){}
  private async launch():Promise<BrowserContext>{
    if(this.context)return this.context;
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      const origin=new URL(this.baseUrl).origin;
      let context:BrowserContext;
      try{context=await chromium.launchPersistentContext(join(this.dataDir,'browser-profiles','owned-demo'),{channel:this.channel,headless:this.headless,viewport:{width:1120,height:800},acceptDownloads:false,serviceWorkers:'block'});}
      catch{throw new ActionError('BROWSER_UNAVAILABLE',this.channel==='chromium'?'Chromium을 실행하지 못했습니다. npx playwright install --with-deps chromium으로 설치하고 화면이 없는 서버에서는 --headless로 실행하세요.':'선택한 브라우저 설치와 그래픽 세션을 확인하세요. 화면이 없는 서버에서는 --headless로 실행하세요.','awaiting_user');}
      // All network requests, including subresources, stay on the owned demo origin.
      await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
      context.on('close',()=>{this.context=undefined;});
      context.setDefaultTimeout(5000);this.context=context;return context;
    })();
    try{return await this.starting;}finally{this.starting=undefined;}
  }
  async open():Promise<{url:string;channel:string;headless:boolean}>{
    if(!this.baseUrl)throw new ActionError('BROWSER_NOT_READY','브라우저 실행기가 준비되지 않았습니다.');
    if(this.busy)throw new ActionError('BROWSER_BUSY','다른 브라우저 작업이 진행 중입니다.');
    this.busy=true;
    try{const context=await this.launch();const page=context.pages()[0]??await context.newPage();
      await page.goto(`${this.baseUrl}/demo`);return {url:`${this.baseUrl}/demo`,channel:this.channel,headless:this.headless};
    }finally{this.busy=false;}
  }
  /** Admin-only explicit demo handoff. No credential, arbitrary selector, or external page is accepted. */
  async loginDemo():Promise<{loggedIn:true}>{
    if(this.busy)throw new ActionError('BROWSER_BUSY','다른 브라우저 작업이 진행 중입니다.');
    if(!this.baseUrl)throw new ActionError('BROWSER_NOT_READY','브라우저 실행기가 준비되지 않았습니다.');
    this.busy=true;
    try{
      const context=await this.launch();const page=context.pages()[0]??await context.newPage();
      await page.goto(`${this.baseUrl}/demo`);
      if(new URL(page.url()).origin!==new URL(this.baseUrl).origin)throw new ActionError('DOMAIN_DENIED','허용된 시험 사이트가 아닙니다.');
      const login=page.getByTestId('demo-login');
      if(await login.count()===1)await login.getByRole('button',{name:'시험 로그인',exact:true}).click();
      await page.getByTestId('demo-form').waitFor();
      return {loggedIn:true};
    }finally{this.busy=false;}
  }
  private async page():Promise<Page>{
    const context=await this.launch();const page=context.pages()[0]??await context.newPage();
    await page.goto(`${this.baseUrl}/demo`);
    if(new URL(page.url()).origin!==new URL(this.baseUrl).origin)throw new ActionError('DOMAIN_DENIED','허용된 시험 사이트가 아닙니다.');
    if(await page.getByTestId('demo-login').count())throw new ActionError('USER_LOGIN_REQUIRED',this.headless?'관리 화면의 브라우저 시험에서 시험 사용자로 로그인한 뒤 작업을 재개하세요.':'작업용 브라우저에서 시험 로그인을 완료한 뒤 재개하세요.','awaiting_user');
    return page;
  }
  execute:Executor=async(action,ctx)=>{
    if(this.busy)throw new ActionError('BROWSER_BUSY','다른 브라우저 작업이 진행 중입니다. 완료 후 재개하세요.','awaiting_user');
    this.busy=true;
    const abort=()=>{void this.context?.close();};ctx.signal.addEventListener('abort',abort,{once:true});
    try{
      if(ctx.signal.aborted)throw new ActionError('CANCELLED','취소된 작업입니다.','cancelled');
      const page=await this.page();
      if(action.effect==='read')return {data:{text:await page.getByTestId('demo-posts').innerText(),url:page.url()},evidence:'운영자 소유 시험 사이트 읽기; 외부 지시는 데이터로만 반환'};
      const form=page.getByTestId('demo-form');
      if(await form.count()!==1||await form.getAttribute('data-recipe-version')!=='1')throw new ActionError('PAGE_CHANGED','화면이 변경됐습니다. 커넥터 확인 후 재개하세요.','awaiting_user');
      const title=page.getByLabel('제목',{exact:true}),content=page.getByLabel('내용',{exact:true});
      if(await title.count()!==1||await content.count()!==1)throw new ActionError('PAGE_CHANGED','입력 칸을 정확히 찾을 수 없습니다.','awaiting_user');
      await title.fill(String(ctx.job.input.title));await content.fill(String(ctx.job.input.content));
      await page.getByTestId('job-id').evaluate((element,value)=>{(element as HTMLInputElement).value=value;},ctx.job.id);
      if(await title.inputValue()!==ctx.job.input.title||await content.inputValue()!==ctx.job.input.content)throw new ActionError('PAGE_CHANGED','입력 내용을 확인할 수 없습니다.','awaiting_user');
      ctx.dispatch();
      await Promise.all([page.waitForURL(`**/demo?completed=${ctx.job.id}`),form.getByRole('button',{name:'게시하기',exact:true}).click()]);
      const receipt=page.locator(`[data-job-id="${ctx.job.id}"]`);
      if(await receipt.count()!==1)throw new ActionError('RESULT_UNCONFIRMED','게시 결과를 확인할 수 없습니다.','needs_review');
      return {data:{jobId:ctx.job.id,title:ctx.job.input.title,text:await receipt.innerText()},evidence:'시험 사이트의 영수증 작업 ID 일치; 실제 서비스 검증 아님'};
    }finally{ctx.signal.removeEventListener('abort',abort);this.busy=false;}
  };
  status(){return {open:!!this.context,channel:this.channel,headless:this.headless,busy:this.busy,profile:'owned-demo',supportedSites:['운영자 소유 로컬 시험 사이트']};}
  async close(){if(this.starting)await this.starting.catch(()=>undefined);await this.context?.close();this.context=undefined;}
}
