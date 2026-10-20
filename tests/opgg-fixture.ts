import assert from 'node:assert/strict';
import {opggActions,opggExample,opggRequestTemplate,opggEndpoint} from '../src/connectors/opgg.js';

export const identity={game_name:'시험 소환사',tagline:'KR1'},playerInput={gameName:'시험 소환사',tagLine:'KR1',region:'KR'};
export const profile=()=>({data:{summoner:{...identity,region:'kr',level:100,updated_at:'2026-10-20T22:00:00+09:00',puuid:'omit-unrequested-private-id',league_stats:[{game_type:'SOLORANKED',win:10,lose:5,updated_at:null,tier_info:{tier:'GOLD',division:1,lp:50}}]}}});
export const matches=()=>({data:{game_history:[{id:'KR_1234',created_at:'2026-10-20T21:00:00+09:00',game_type:'SOLORANKED',game_length_second:1200,participants:[{summoner:{...identity},champion_name:'아리',position:'MID',stats:{kill:3,death:0,assist:5,result:'WIN'}},{summoner:{game_name:'다른 사람',tagline:'KR2'},champion_name:'에코',position:'MID',stats:{kill:0,death:3,assist:0,result:'LOSE'}}]}]}});
export const meta=(position='mid')=>({data:{positions:{[position]:[{champion:'아리',rank:1,tier:1,win_rate:0.51,pick_rate:0.1,ban_rate:0.03},{champion:'에코',rank:2,tier:1,win_rate:0.52,pick_rate:0.05,ban_rate:0.01}]}}});
export const tft=()=>({data:[{id:'deck1',name:{ko_KR:'시험 덱',en_US:'Test deck'},teamCode:'ABC123TFTSet18',cost:42,units:[{key:'TFT_Test',items:['Item_A'],tier:2,isCore:true}],stat:{opTier:'OP',deck:{avgPlacement:3.5,winRate:0.2,top4Rate:0.7,pickRate:0.1,compsCount:10}}}],metadata:{gameStatCounts:1000,gameStatDateTime:'2026-10-20T12:00:00Z'}});
export const agents=()=>[{agent_id:'agent1',name:'Jett',names:{ko_KR:'제트'},skills:[{slot:'Ability1',name:'Updraft',names:{ko_KR:'상승기류'}}]},{agent_id:'agent2',name:'Sage',names:{ko_KR:'세이지'},skills:[]}];
export const payload=(id:string,input:Record<string,any>)=>id==='opgg.lol.profile'?profile():id==='opgg.lol.matches'?matches():id==='opgg.lol.meta'?meta(input.position):id==='opgg.tft.meta'?tft():agents();
export const content=(value:unknown)=>({content:[{type:'text',text:typeof value==='string'?value:JSON.stringify(value)}]});
export function opggMock(){
  const record={methods:[] as string[],calls:[] as {name:string;arguments:Record<string,any>}[],headers:[] as Headers[]};
  const flags={missing:false,changed:false,duplicate:false,toolError:false,status:0,statusAt:'initialize',invalidUtf8:false,oversized:false,onList:undefined as undefined|(()=>void)};
  const fetcher:typeof fetch=async(address,init)=>{
    assert.equal(String(address),opggEndpoint);assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');const headers=new Headers(init?.headers);record.headers.push(headers);assert.equal(headers.get('Authorization'),null);assert.equal(headers.get('Cookie'),null);
    if(init?.method==='GET')return new Response(null,{status:405});const request=JSON.parse(String(init?.body));record.methods.push(request.method);
    if(flags.status && request.method===flags.statusAt)return new Response('unit-opgg-private-secret',{status:flags.status});
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    let result:unknown;
    if(request.method==='initialize')result={protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'owned-opgg-fixture',version:'1.0'}};
    else if(request.method==='tools/list'){
      flags.onList?.();const tools=opggActions.map(action=>({name:opggRequestTemplate(action.id,opggExample(action.id)).body.params.name,inputSchema:flags.changed?{type:'object',required:['changedRequiredField'],properties:{changedRequiredField:{type:'string'}}}:{type:'object'},outputSchema:{type:'array'}}));
      result={tools:flags.missing?[]:flags.duplicate?[...tools,tools[0]]:tools};
    }else if(request.method==='tools/call'){
      record.calls.push(request.params);const action=opggActions.find(action=>opggRequestTemplate(action.id,opggExample(action.id)).body.params.name===request.params.name)!;
      const input={position:request.params.arguments.position};const data=payload(action.id,input) as any;
      if(action.id==='opgg.lol.profile')Object.assign(data.data.summoner,{game_name:request.params.arguments.game_name,tagline:request.params.arguments.tag_line});
      if(action.id==='opgg.lol.matches')Object.assign(data.data.game_history[0].participants[0].summoner,{game_name:request.params.arguments.game_name,tagline:request.params.arguments.tag_line});
      result=flags.toolError?{...content('unit-opgg-private-secret'),isError:true}:content(data);
      if(flags.invalidUtf8)return new Response(new Uint8Array([0xff]),{headers:{'Content-Type':'application/json'}});
      if(flags.oversized)result=content('x'.repeat(2_000_100));
    }else throw Error('Unexpected MCP method');
    return Response.json({jsonrpc:'2.0',id:request.id,result});
  };
  return{fetcher,record,flags};
}
