import { ActionError } from '../types.js';

const invalid=()=>new ActionError('INVALID_RESPONSE','OP.GG 데이터 형식이 변경됐거나 유효하지 않습니다.');
/** Parse observed OP.GG class notation as data only. No eval, functions or property access. */
export function decodeOpggData(raw:string):{format:'json'|'opgg-class-data';value:unknown}{
  if(raw.length>1_000_000)throw new ActionError('RESULT_TOO_LARGE','OP.GG 데이터가 너무 큽니다.');
  const input=raw.trim();if(input.startsWith('{') || input.startsWith('[')){try{return{format:'json',value:JSON.parse(input)};}catch{throw invalid();}}
  const classes=new Map<string,string[]>();let body=input;
  while(body.startsWith('class ')){
    const newline=body.indexOf('\n');if(newline<0 || classes.size>=100)throw invalid();
    const line=body.slice(0,newline).trim(),match=/^class ([A-Za-z_]\w{0,63}): (.+)$/.exec(line);if(!match)throw invalid();
    const name=match[1]!,fields=match[2]!.split(',').map(value=>value.trim());
    if(classes.has(name) || fields.length>80 || new Set(fields).size!==fields.length || fields.some(field=>!/^\w+$/.test(field) || ['__proto__','constructor','prototype'].includes(field)))throw invalid();
    classes.set(name,fields);body=body.slice(newline+1).trimStart();
  }
  if(!classes.size)throw invalid();let offset=0,nodes=0;
  const space=()=>{while(/\s/.test(body[offset]??'') && offset<body.length)offset++;};
  function value(depth:number):unknown{
    if(++nodes>50_000 || depth>30)throw invalid();space();
    const first=body[offset];
    if(first==='"'){
      const token=/^"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(body.slice(offset));if(!token)throw invalid();offset+=token[0].length;
      try{return JSON.parse(token[0]);}catch{throw invalid();}
    }
    if(first==='['){offset++;const values:unknown[]=[];space();if(body[offset]===']'){offset++;return values;}
      for(;;){if(values.length>=1000)throw invalid();values.push(value(depth+1));space();const next=body[offset++];if(next===']')return values;if(next!==',')throw invalid();}
    }
    const literal=/^(null|true|false)(?!\w)/.exec(body.slice(offset));if(literal){offset+=literal[0].length;return literal[0]==='null'?null:literal[0]==='true';}
    const number=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(body.slice(offset));if(number){offset+=number[0].length;const parsed=Number(number[0]);if(!Number.isFinite(parsed) || Number.isInteger(parsed)&&!Number.isSafeInteger(parsed))throw invalid();return parsed;}
    const name=/^[A-Za-z_]\w{0,63}/.exec(body.slice(offset));if(!name || !classes.has(name[0]))throw invalid();offset+=name[0].length;space();if(body[offset++]!=='(')throw invalid();
    const fields=classes.get(name[0])!,entries: [string,unknown][]=[];
    for(const[index,field]of fields.entries()){if(index){space();if(body[offset++]!==',')throw invalid();}entries.push([field,value(depth+1)]);}
    space();if(body[offset++]!==')')throw invalid();return Object.fromEntries(entries);
  }
  const parsed=value(0);space();if(offset!==body.length)throw invalid();return{format:'opgg-class-data',value:parsed};
}
