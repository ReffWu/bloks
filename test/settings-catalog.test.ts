import test from "node:test";
import assert from "node:assert/strict";
import { settingsCatalog, type SettingsCatalogInput } from "../server/settings-catalog.ts";
import { SettingsPages, SETTINGS_CATEGORIES, SETTINGS_PAGE_BYTES } from "../server/settings-pages.ts";
import { DeviceSettings } from "../server/settings-devices.ts";
const secret='PRIVATE_CATALOG_SENTINEL';
function fixture():SettingsCatalogInput{
  const cfg={secrets:{TOKEN:secret},agents:{turnLimit:24},mcpServers:[{id:'mcp',name:secret,transport:'stdio',command:secret}],providers:{grok:{key:secret}},telegram:{bots:{agent:{token:secret,ownerUserId:123,enabled:true,pairing:secret}}}};
  return {agentId:'agent',workspace:{saved:cfg,runtime:cfg,resolved:{beforeTurn:200000,beforeTurnAt:.6,stallMinutes:15},redact:(s)=>s},savedObservation:{source:'owner-load',observedAt:100},
    bots:[{id:'agent',name:secret,modelSelection:{instanceId:'engine',model:secret},mcpServers:['mcp'],skillIds:['skill'],tasks:[{id:'lane',goal:{text:secret,budget:20,check:secret}}]}],
    rooms:[{id:'visible',name:'Visible room',memberIds:['agent'],sharing:{tools:'conversation',history:'join'}},{id:'hidden',name:'Hidden room',memberIds:['other']}],
    projects:[{id:'project',name:secret,memberIds:['agent'],folders:[secret]},{id:'hidden-project',name:'Hidden project',memberIds:['other']}],
    routines:[{id:'routine',targetKind:'agent',targetId:'agent',name:secret,prompt:secret,enabled:true,days:[],time:'09:00'}],
    watchers:[{id:'watcher',botId:'agent',kind:'check',target:secret,name:secret,enabled:true}],
    workflows:[{id:'workflow',name:secret,enabled:true,trigger:{kind:'message',targetKind:'room',targetId:'visible'},steps:[{action:'post',targetId:'visible',text:secret}]}],
    hooks:[{id:'hook',name:secret,token:secret,workflowId:'workflow',enabled:true}],rules:[{id:'rule',effect:'deny',field:'command',op:'contains',value:secret,enabled:true}],
    profileNotes:[{id:'kept',text:secret,state:'kept'},{id:'suggested',text:secret,state:'suggested'}],sidebarSections:['Visible section'],
    skills:{lastObserved:{observedAt:100,invalidatedAt:null,omittedItems:0,items:[{id:'skill',name:secret,description:'A neutral fixture',version:null,source:'user',body:true,registry:false,sha256:false,omitted:[]}]},lastAttempt:{at:100,status:'complete'}},
    engines:[{id:'engine',loaded:true,input:{driver:'codex',displayName:secret,environment:{TOKEN:secret}}}],
    ownerDevices:[{id:'device',name:secret}],devices:new DeviceSettings().inspect(null),
    boot:{version:'2.10.0',port:8799,listening:'loopback',timezone:'Etc/UTC',remoteEnabled:false}};
}
function page(pages:SettingsPages,input:SettingsCatalogInput,category:Parameters<typeof settingsCatalog>[0],id?:string){
  const result=pages.read(new URLSearchParams({category,...(id?{id}:{})}),'agent:agent',(c)=>settingsCatalog(c,input,pages));
  return {status:result.status,body:result.body as {rows:{reference:string;observation:Record<string,unknown>}[];total:number;continuation:string|null}};
}

test('all inventory categories have an explicit record or bounded collection and safe controls/status, with no protected text',()=>{
  const input=fixture();const pages=new SettingsPages();
  for(const [category] of SETTINGS_CATEGORIES){
    const result=page(pages,input,category);assert.equal(result.status,200,category);assert.ok(result.body.total>0,category);
    const text=JSON.stringify(result.body);assert.ok(!text.includes(secret),category);assert.ok(Buffer.byteLength(text)<=SETTINGS_PAGE_BYTES,category);
    assert.ok(!text.includes('Private member'),category);
  }
});

test('room and project visibility applies before totals, refs and projection, including workflows and their webhook targets',()=>{
  const input=fixture();const pages=new SettingsPages();const before=page(pages,input,'room');assert.equal(before.body.total,1);
  input.rooms=[...input.rooms,{id:'another-hidden',memberIds:['other'],get name(){throw new Error('hidden projector reached');}}];
  assert.deepEqual(page(pages,input,'room'),before);
  assert.equal(page(pages,input,'room',pages.reference('room','hidden')).status,404);
  input.workflows=[...input.workflows,{id:'private-workflow',trigger:{targetKind:'room',targetId:'hidden'},steps:[]}];
  input.hooks=[...input.hooks,{id:'private-hook',workflowId:'private-workflow',name:'Hidden hook'}];
  const automations=page(pages,input,'automations');assert.ok(!JSON.stringify(automations).includes('Hidden hook'));
  const project=page(pages,input,'projects.skills');assert.ok(!JSON.stringify(project).includes('Hidden project'));
  const owner={...input,agentId:null};assert.equal(page(pages,owner,'room').body.total,3);
});

test('projected instance, MCP and skill references resolve to the same category entity refs',()=>{
  const input=fixture();const pages=new SettingsPages();
  const agent=page(pages,input,'agent').body.rows[0]!.observation as {fields:{id:string;effective:{value?:string;values?:string[]}}[]};
  for(const [key,category] of [['modelSelection.instance','workspace.engines'],['mcpServers','workspace.apps'],['skillIds','projects.skills']] as const){
    const field=agent.fields.find((f)=>f.id===key)!;const ref=field.effective.value??field.effective.values?.[0];assert.ok(ref);
    const selected=page(pages,input,category,ref);assert.equal(selected.status,200,key);assert.equal(selected.body.rows.length,1);
  }
});

test('device projection dates older answers as last-reported and never shows device ids or the ask',()=>{
  let elapsed=0;const devices=new DeviceSettings({monotonic:()=>elapsed,wall:()=>1000+elapsed});
  let request='';const first=devices.ask((frame)=>{request=frame.request;});
  const source={path:'relay' as const,deviceId:secret};
  assert.ok(devices.reportWindow(source,{request,label:'fixture-window',snapshot:{schema:1,revision:1,observedAt:1050,values:{'theme.applied':{status:'observed',value:'dark'},'native.mode':{status:'observed',value:'remote'}}}},null));
  const input=fixture();input.devices=devices.inspect(first);const pages=new SettingsPages();
  const fresh=JSON.stringify(page(pages,input,'device.browser'));assert.match(fresh,/"current"/);
  elapsed=60000;const later=devices.ask(()=>{});input.devices=devices.inspect(later);
  const text=JSON.stringify(page(pages,input,'device.browser'));
  assert.match(text,/last-reported/);assert.match(text,/dark/);assert.ok(!text.includes('"current"'));
  for(const protectedValue of [secret,request])assert.ok(!text.includes(protectedValue));
  const native=page(pages,input,'device.native');assert.match(JSON.stringify(native),/native.mode/);assert.ok(!JSON.stringify(native).includes('theme.applied'));
});


test('F1 common short MCP and URL values preserve catalog names and descriptions while credentials remain redacted',()=>{
  const input=fixture();
  const cfg={...input.workspace.runtime as object,
    composio:{key:secret,url:'https://example.test/mcp'},
    custom:[{id:'endpoint',name:'Endpoint v1',url:'https://example.test/v1',keys:[{key:secret}]}],
    mcpServers:[{id:'mcp',name:'github-mcp',transport:'stdio',command:'npx',args:['-y','mcp'],env:{TOKEN:secret}}],
    remote:{devices:[{id:'a',hash:secret}]},
  };
  input.workspace={...input.workspace,saved:cfg,runtime:cfg};
  input.bots=[{id:'agent',name:'Daily-yoga coach',description:'Runs npx tools and mcp servers',title:secret}];
  const pages=new SettingsPages();
  const fields=page(pages,input,'agent').body.rows[0]!.observation.fields as {id:string;effective:unknown}[];
  assert.deepEqual(fields.find((f)=>f.id==='name')!.effective,{status:'value',value:'Daily-yoga coach'});
  assert.deepEqual(fields.find((f)=>f.id==='description')!.effective,{status:'value',value:'Runs npx tools and mcp servers'});
  assert.deepEqual(fields.find((f)=>f.id==='title')!.effective,{status:'value',value:'[redacted]'});
  const mcp=page(pages,input,'workspace.apps',pages.reference('workspace.apps','mcp:mcp')).body.rows[0]!.observation.fields as {id:string;effective:unknown}[];
  assert.deepEqual(mcp.find((f)=>f.id==='name')!.effective,{status:'value',value:'github-mcp'});
  for(const [category] of SETTINGS_CATEGORIES)assert(!JSON.stringify(page(pages,input,category)).includes(secret),category);
});
