/**
 * 第 09 章：71 个受控断言的可复跑归档（40 + 31）。
 * 源码基线：6868041cae3b9dcab163a1fd85845b9778c3adc5；整理日期：2026-09-12。
 *
 * 原程序与新增封装的边界：
 * - 文末两个 ORIGINAL 区块保留此前分别成功执行的 40/31 断言程序正文。
 *   不改断言、固定输入、模拟 store、导入 hook 或源码提取方式。它们原本就是
 *   两次独立的 Node stdin 执行，因此本封装仍分别启动两个隔离子进程，避免 hook 串扰。
 * - 仅新增：定位源码工作目录、确认提交和干净的 tracked 工作树、提取原程序、
 *   捕获退出状态/JSON 输出/标准错误、汇总为旁边的 09-navigation-results.json。
 * - 40 断言：直接加载原 LibraryCatalog / KnowledgeResolver / GraphResolver /
 *   GraphQueryResolver / RecentBrowseResolver / CoverageSearchService / PerspectiveRunner。
 *   默认 Perspective opener 从原路由源码提取执行；搜索 store 返回固定六节点数据，
 *   不执行真实全文/向量检索。Recent 的 SQL 只运行于 Node 内置 :memory: SQLite。
 * - 31 断言：capsule 函数从编译脚本提取，readFileSync/accessSync 替换成内存夹具；
 *   不读取真实画像或 primer。EventMemoryStore 加载原源码，better-sqlite3 入口由
 *   只接受 :memory: 的 Node SQLite 薄适配器替代。live callback 从 index.ts 提取，
 *   episode ref/log 为内存收集器。失败使用“未初始化的内存 Store”，不破坏真实库。
 * - 固定资料：project:cat-cafe、global:methods、research:payments 的 public/private
 *   变体与 P/L/T/G/X/Y 六个节点；不登记真实 collection、不启动服务、不重建真实索引。
 *
 * 不能推导的生产保证：
 * 不证明真实 FTS/embedding 召回质量、完整 HTTP/鉴权/多租户隔离、完整 plan Loader、
 * magic-word detector、完整 L0 编译、生产 better-sqlite3 驱动兼容性、并发争用、磁盘
 * 耐久性/断电恢复、迁移全集、真实死信文件写入或自动重放，更不证明端到端恰好一次。
 * 71 是两段原程序自行累计并成功返回的断言总数，不是 71 个生产端到端测试用例。
 *
 * 复跑（原验证环境为 Node v24.14.0；需要 registerHooks/类型转换/node:sqlite）：
 *   node "D:/AI/clower-1/clowder-note/memory/verification/09-navigation-checks.mjs"
 * 结果只写入本脚本旁的 09-navigation-results.json，不改其他 verification 文件。
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const sourceRoot = resolve(scriptDir, '../../../clowder-ai');
const resultPath = resolve(scriptDir, '09-navigation-results.json');
const expectedCommit = '6868041cae3b9dcab163a1fd85845b9778c3adc5';
const scriptText = readFileSync(scriptPath, 'utf8');
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const report = {
  schemaVersion: 1,
  chapter: '09-多知识域与记忆导航',
  studyDate: '2026-09-12',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  status: 'running',
  allPassed: false,
  expectedAssertions: 71,
  passedAssertions: 0,
  assertionCounting: '只累计退出成功且 JSON assertions 等于原预期的完整程序组；不把未知的部分执行计为通过。',
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    sourceRoot,
    expectedCommit,
    actualCommit: null,
    trackedSourceClean: null,
    scriptPath,
    scriptSha256: sha256(scriptText),
  },
  scope: {
    originalPrograms: '原 40 与 31 断言程序保存在脚本注释区块，提取后分别以原 Node stdin 方式执行。',
    search: '固定模拟 store；不执行真实 FTS 或 embedding。',
    sqlite: '仅 :memory:；Event 使用 Node 内置 SQLite 薄适配器，不是生产 better-sqlite3 集成验证。',
    capsule: '从原脚本提取函数；文件读取与 primer 可访问性为模拟输入。',
    liveWriter: '从 index.ts 提取 callback；模拟 episode ref/log；用未初始化内存 Store 注入失败。',
    productionGuarantees: [
      '不证明真实 HTTP、鉴权或完整租户隔离。',
      '不证明完整 plan Loader、magic-word detector 或完整 L0 编译。',
      '不证明并发争用、生产驱动、磁盘耐久性、断电恢复或迁移全集。',
      '不证明真实死信文件写入、自动重放或端到端恰好一次。',
      '没有连接真实服务、执行真实索引或创建实际外部 collection。',
    ],
  },
  groups: [],
  diagnostics: [],
};

function extractOriginal(label) {
  const begin = `/* ORIGINAL ${label} BEGIN`;
  const end = `ORIGINAL ${label} END */`;
  const start = scriptText.indexOf(begin);
  if (start < 0) throw new Error(`Missing original program ${label}`);
  const bodyStart = start + begin.length;
  const stop = scriptText.indexOf(end, bodyStart);
  if (stop < 0) throw new Error(`Missing original program terminator ${label}`);
  // 只移除包裹标记旁新增的换行；原程序内部不做格式化/替换。
  return scriptText.slice(bodyStart, stop).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
}

function gitRead(args) {
  const result = spawnSync('git', [
    '-c', `safe.directory=${sourceRoot.replace(/\\/g, '/')}`,
    '-C', sourceRoot, ...args,
  ], { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (result.stderr?.trim()) report.diagnostics.push({ stage: 'git', stderr: result.stderr.trim() });
  if (result.error || result.status !== 0) {
    throw new Error(`Source preflight failed: ${result.error?.message ?? result.stderr ?? `git exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

function runOriginal(label, expectedAssertions) {
  const program = extractOriginal(label);
  const args = ['--experimental-transform-types', '--input-type=module', '-'];
  const execution = spawnSync(process.execPath, args, {
    cwd: sourceRoot,
    input: program,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const group = {
    id: label,
    expectedAssertions,
    reportedAssertions: null,
    passed: false,
    sourceProgramSha256: sha256(program),
    executable: process.execPath,
    args,
    cwd: sourceRoot,
    exitCode: execution.status,
    signal: execution.signal,
    stderr: execution.stderr ?? '',
    output: null,
    error: execution.error?.message ?? null,
  };
  try {
    group.output = JSON.parse(execution.stdout ?? '');
    group.reportedAssertions = group.output.assertions ?? null;
  } catch (error) {
    group.error ??= `Original stdout is not complete JSON: ${error.message}`;
    group.stdout = execution.stdout ?? '';
  }
  group.passed = !execution.error && execution.status === 0 && group.reportedAssertions === expectedAssertions;
  if (!group.passed && !group.error) group.error = `Expected ${expectedAssertions} assertions and exit 0.`;
  return group;
}

try {
  report.environment.actualCommit = gitRead(['rev-parse', 'HEAD']);
  const dirty = gitRead(['status', '--porcelain=v1', '--untracked-files=no']);
  report.environment.trackedSourceClean = dirty.length === 0;
  if (report.environment.actualCommit !== expectedCommit) {
    throw new Error(`Refusing a different source baseline: ${report.environment.actualCommit}`);
  }
  if (dirty) throw new Error(`Refusing modified tracked source files:\n${dirty}`);

  for (const [label, count] of [['40', 40], ['31', 31]]) {
    report.groups.push(runOriginal(label, count));
  }
  report.passedAssertions = report.groups.reduce((sum, group) => sum + (group.passed ? group.reportedAssertions : 0), 0);
  report.allPassed = report.groups.length === 2 && report.groups.every((group) => group.passed) && report.passedAssertions === 71;
  report.status = report.allPassed ? 'passed' : 'failed';
} catch (error) {
  report.status = 'blocked';
  report.diagnostics.push({ stage: 'runner', error: error.stack ?? String(error) });
}
report.finishedAt = new Date().toISOString();
writeFileSync(resultPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  status: report.status,
  passedAssertions: report.passedAssertions,
  expectedAssertions: report.expectedAssertions,
  groups: report.groups.map((group) => ({ id: group.id, passed: group.passed, reportedAssertions: group.reportedAssertions })),
  resultPath,
}, null, 2));
if (!report.allPassed) process.exitCode = 1;

/* ORIGINAL 40 BEGIN
import assert from 'node:assert/strict';import {registerHooks,stripTypeScriptTypes}from'node:module';import{existsSync,readFileSync}from'node:fs';import{resolve}from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';import{DatabaseSync}from'node:sqlite';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&s.endsWith('.js')&&c.parentURL?.startsWith('file:')){const u=new URL(s.replace(/\.js$/,'.ts'),c.parentURL);if(existsSync(fileURLToPath(u)))return{url:u.href,shortCircuit:true}}return next(s,c)}});
const load=n=>import(pathToFileURL(resolve('packages/api/src/domains/memory/'+n+'.ts')).href);
const{LibraryCatalog}=await load('LibraryCatalog');const{KnowledgeResolver}=await load('KnowledgeResolver');const{GraphResolver}=await load('GraphResolver');const{GraphQueryResolver}=await load('GraphQueryResolver');const{RecentBrowseResolver}=await load('RecentBrowseResolver');const{CoverageSearchService}=await load('CoverageSearchService');const{PerspectiveRunner}=await load('PerspectiveRunner');
let n=0;const eq=(a,b)=>{assert.deepEqual(a,b);n++};const ids=['project:cat-cafe','global:methods','research:payments'];const anchors=['doc:retry','LL-042','thread-t42','global:skill/retry','research:payments:doc/retry','research:payments:doc/rollback'];const names=['P','L','T','G','X','Y'];const short=a=>a.map(x=>names[anchors.indexOf(typeof x==='string'?x:x.anchor)]??(typeof x==='string'?x:x.anchor));
const dd=p=>({tool:'cat_cafe_read_file_slice',params:{path:p,startLine:'1',endLine:'120'},hint:`打开文件切片：read_file_slice(path="${p}", startLine=1, endLine=120)`});
const docs=anchors.map((anchor,i)=>({anchor,title:['支付重试方案','幂等键教训','为什么重复扣款','通用重试方法','支付重试案例','退款补偿'][i],kind:['plan','lesson','thread','plan','research','research'][i],status:'active',summary:['响应丢失也不能重复扣款','重试应使用稳定业务键','原始讨论现场','失败分类后再重试','同一订单只能生效一次','补偿操作也要幂等'][i],updatedAt:['2026-09-12T11:00:00.000Z','2026-09-12T10:00:00.000Z','2026-09-11T11:00:00.000Z','2026-09-10T11:00:00.000Z','2026-09-06T11:00:00.000Z','2026-09-04T11:00:00.000Z'][i],...(i===0?{sourcePath:'plans/retry.md',keywords:['稳定业务键'],sourceIds:['thread-t42'],drillDown:dd('docs/plans/retry.md')}:{}),...(i===4?{sourcePath:'retry.md',drillDown:dd('cat-cafe://collection/research%3Apayments/retry.md')}: {})}));
const own=[0,0,0,1,2,2];const edges=[[0,1,'doc_link'],[0,3,'related_to'],[0,4,'wikilink'],[1,2,'related_to'],[4,5,'doc_link']];
function fixture(sensitivity){const catalog=new LibraryCatalog(),stores=new Map(),calls=[],dbs=[];for(let i=0;i<3;i++){catalog.register({id:ids[i],kind:['project','global','research'][i],name:ids[i],displayName:['Project','Methods','Payments'][i],root:resolve('fixture-not-read',String(i)),sensitivity:i===2?sensitivity:'internal',scannerLevel:0,status:'active',indexPolicy:{autoRebuild:false},reviewPolicy:{authorityCeiling:'candidate',requireOwnerApproval:false},createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'});const db=new DatabaseSync(':memory:');dbs.push(db);db.exec('CREATE TABLE evidence_docs(anchor TEXT PRIMARY KEY,title TEXT,kind TEXT,updated_at TEXT)');for(let j=0;j<6;j++)if(own[j]===i){const d=docs[j];db.prepare('INSERT INTO evidence_docs VALUES(?,?,?,?)').run(d.anchor,d.title,d.kind,d.updatedAt)}const store={getDb:()=>db,async getByAnchor(a){return structuredClone(docs.find((d,j)=>own[j]===i&&d.anchor===a)??null)},async getRelated(a){return edges.filter(([x,y])=>(x===4?2:0)===i&&(anchors[x]===a||anchors[y]===a)).map(([x,y,relation])=>({anchor:anchors[x]===a?anchors[y]:anchors[x],relation,fromCollectionId:ids[own[x]],toCollectionId:ids[own[y]],edgeSensitivity:null,provenance:'manual',traversalCount:0,lastTraversedAt:null}))},async search(q,o={}){calls.push({store:ids[i],query:q,...o});const ix=i===1?[3]:i===2?[4,5]:o.scope==='threads'||o.scope==='sessions'?[2]:q==='稳定业务键'?[1]:q==='支付重试'?[0]:[0,1];return structuredClone(ix.slice(0,o.limit??10).map(j=>docs[j]))},async searchWithMeta(q,o){return{items:await this.search(q,o),meta:{degraded:false}}}};stores.set(ids[i],store)}return{catalog,stores,calls,dbs,resolver:new KnowledgeResolver({catalog,stores,projectStore:stores.get(ids[0]),globalStore:stores.get(ids[1])})}}
const f=fixture('public'),p=fixture('private'),o={dimension:'library',scope:'docs',limit:5};const pub=await f.resolver.resolve('重试',o);eq(short(pub.results),['P','G','X','L','Y']);eq(pub.sources,['project','global']);const legacy=await f.resolver.resolve('重试',{scope:'docs',limit:5});eq(short(legacy.results),['P','G','L']);eq(legacy.deprecationWarnings.length,1);eq(short((await f.resolver.resolve('重试',{dimension:'project'})).results),['P','L']);eq(short((await f.resolver.resolve('重试',{dimension:'all',scope:'threads'})).results),['T']);const privateLibrary=await p.resolver.resolve('重试',o);eq(short(privateLibrary.results),['P','G','L']);const explicit=await p.resolver.resolve('重试',{...o,dimension:'collection',collections:[...ids,ids[2],'research:missing']});eq(short(explicit.results),['P','G','X','L','Y']);const redacted=explicit.results.find(d=>d.anchor===anchors[4]);eq(Object.keys(redacted).sort(),['anchor','kind','status','title','updatedAt']);eq(explicit.collectionGroups.length,3);eq((await f.resolver.resolve('重试',{dimension:'collection'})).results,[]);
const g=f.stores.get(ids[1]);f.stores.set(ids[1],{searchWithMeta:async()=>{throw Error('fixture failure')}});const partial=await f.resolver.resolve('重试',o);eq(short(partial.results),['P','X','L','Y']);eq(partial.collectionGroups.map(g=>g.status),['ok','error','ok']);eq(partial.meta,{degraded:true,degradeReason:'evidence_store_error'});f.stores.set(ids[1],g);const ext=f.stores.get(ids[2]);f.stores.delete(ids[2]);const skip=await f.resolver.resolve('重试',o);eq(skip.collectionGroups.map(g=>g.status),['ok','ok','skipped']);eq(skip.meta.degraded,false);f.stores.set(ids[2],ext);
const graph=await new GraphResolver(f.catalog,f.stores).buildSubgraph(anchors[0],{depth:2});eq(short(graph.nodes),['P','L','G','X','T','Y']);eq(graph.edges.length,5);const filtered=await new GraphResolver(f.catalog,f.stores).buildSubgraph(anchors[0],{depth:2,relations:['doc_link']});eq(short(filtered.nodes),['P','L']);const privateGraph=await new GraphResolver(p.catalog,p.stores).buildSubgraph(anchors[0],{depth:2});eq(privateGraph.nodes.filter(n=>n.redacted).map(n=>n.anchor),['[redacted:1]','[redacted:2]']);eq(privateGraph.edges.filter(e=>e.redacted).length,2);const fuzzy=await new GraphQueryResolver(f.catalog,f.stores).resolve('重试');eq(short(fuzzy.candidates),['P','X','G','L']);eq(fuzzy.candidates.map(c=>c.textMatchScore),[6,6,6,3]);eq((await new GraphQueryResolver(p.catalog,p.stores).resolve(anchors[4])).status,'no_match');eq((await new GraphQueryResolver(f.catalog,f.stores).resolve(anchors[0],{depth:1})).status,'graph');
const rOpts={scope:'all',since:'2026-09-05T00:00:00.000Z',limit:3};const recent=await new RecentBrowseResolver(f.catalog,f.stores).list(rOpts);eq(short(recent.items),['P','G','X']);const recentPrivate=await new RecentBrowseResolver(p.catalog,p.stores).list(rOpts);eq(short(recentPrivate.items),['P','L','G']);const mismatch=await new RecentBrowseResolver(f.catalog,f.stores).list({...rOpts,scope:'docs',kinds:['thread']});eq(mismatch.items,[]);eq(mismatch.nudge.includes('scope="threads"'),true);
f.calls.length=0;const cov=await new CoverageSearchService(f.stores.get(ids[0])).search('支付重试');const calls=structuredClone(f.calls);eq(cov.matrix.map(m=>[short([m])[0],m.matchType,m.source]),[['P','direct','docs'],['T','direct','threads'],['L','alias','docs']]);eq(cov.totalHits,3);eq(cov.gaps,[]);eq(cov.degraded,[{source:'convention-graph',reason:'convention graph unavailable'}]);eq(calls.map(c=>[c.query,c.scope,c.limit]),[['支付重试','docs',25],['支付重试','threads',20],['稳定业务键','docs',5],['thread-t42','threads',3]]);
const src=readFileSync('packages/api/src/routes/perspectives.ts','utf8');const openerCode=src.slice(src.indexOf('const SUPPORTED_TYPED_READERS'),src.indexOf('const COLLECTION_URI_PREFIX'))+src.slice(src.indexOf('function defaultOpenAnchor('),src.indexOf('function isNotFoundError('));const opener=new Function(stripTypeScriptTypes(openerCode,{mode:'transform'})+'\nreturn defaultOpenAnchor;')();const runner=new PerspectiveRunner({searchEvidence:async(q,o)=>{const r=await f.resolver.resolve(q,o);return{items:r.results,meta:r.meta}},openAnchor:opener,now:()=>new Date('2026-09-12T12:00:00Z'),randomId:()=> 'run-demo'});const run=await runner.run({id:'F042/retry-proof',defaults:{topic:'重试'},steps:[{id:'s1',type:'search_evidence',query:'重试',scope:'docs',dimension:'library',limit:3},{id:'s2',type:'open_anchor',source:'previous_step',selector:'top',maxOpen:2},{id:'s3',type:'open_anchor',source:'previous_step',selector:'top',maxOpen:2}]},{actorCatId:'codex',inputs:{topic:'补偿'}});eq(short(run.candidateAnchors),['P','G','X']);eq(run.effectiveInputs,{topic:'补偿'});eq(run.steps[0].queryOrAnchor,'重试');eq(run.openedAnchors.map(a=>a.status),['route_identified','unsupported']);eq(run.steps.map(s=>s.openedCount??null),[null,1,0]);eq(run.warnings[0].code,'open_anchor_failed');
console.log(JSON.stringify({assertions:n,search:{public:short(pub.results),privateLibrary:short(privateLibrary.results),privateExplicit:short(explicit.results),redacted,partial:short(partial.results),partialMeta:partial.meta,missingStore:skip.collectionGroups.map(g=>[g.collectionId,g.status])},graph:{nodes:short(graph.nodes),edges:graph.edges.map(e=>[...short([e.from,e.to]),e.relation]),privateNodes:privateGraph.nodes.map(n=>[short([n])[0],n.redacted]),filtered:short(filtered.nodes),fuzzy:fuzzy.candidates.map(c=>[short([c])[0],c.matchReason,c.textMatchScore,c.weightedEdgeScore])},recent:{public:short(recent.items),groups:recent.groups,private:short(recentPrivate.items)},coverage:{calls,result:cov},perspective:run},null,2));for(const d of[...f.dbs,...p.dbs])d.close();
ORIGINAL 40 END */

/* ORIGINAL 31 BEGIN
import assert from 'node:assert/strict';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve('.');
const shim='data:text/javascript,'+encodeURIComponent(`import {DatabaseSync} from 'node:sqlite';export default class extends DatabaseSync{constructor(p){if(p!==':memory:')throw Error('disk forbidden');super(p)}pragma(s){return this.exec('PRAGMA '+s)}}`);
registerHooks({resolve(s,c,next){if(s==='better-sqlite3')return{url:shim,shortCircuit:true};if(s==='@cat-cafe/shared')return{url:pathToFileURL(resolve(root,'packages/shared/src/types/event-memory.ts')).href,shortCircuit:true};if(s.startsWith('.')&&s.endsWith('.js')&&c.parentURL?.startsWith('file:')){const u=new URL(s.replace(/\.js$/,'.ts'),c.parentURL);if(existsSync(fileURLToPath(u)))return{url:u.href,shortCircuit:true}}return next(s,c)}});
let checks=0;function eq(a,b){assert.deepEqual(a,b);checks++}function ok(v){assert.ok(v);checks++}
const source=p=>readFileSync(resolve(root,p),'utf8').replace(/\r\n/g,'\n');
const full=source('scripts/compile-system-prompt-l0.mjs');const end=full.indexOf('/**\n * Compile per-cat L0');ok(end>full.indexOf('const USER_CAPSULE_CHAR_LIMIT'));
const code=full.slice(full.indexOf('const USER_CAPSULE_CHAR_LIMIT'),end).replace('export function resolveUserCapsule','function resolveUserCapsule');
function fixture(raw,primer){const reads=[],probes=[];const fn=new Function('readFileSync','accessSync','resolve',code+'\nreturn resolveUserCapsule;')((p)=>{reads.push(p);if(raw===null)throw Error('missing');return raw},p=>{probes.push(p);if(!primer)throw Error('missing primer')},resolve);return{fn,reads,probes}}
const absent=fixture(null,true);eq(absent.fn('fixture-profile','codex'),'');eq(absent.probes.length,0);
const body='先给结论。\n再给证据。';const valid=fixture('---\nowner: demo\n---\n'+body,true);const text=valid.fn('fixture-profile','codex');ok(text.includes('## 主人画像\n\n'+body));ok(text.includes('private/profile/relationship/codex-primer.md'));eq(valid.reads.length,1);eq(valid.probes.length,1);eq([...body.replace(/\s/g,'')].length,10);
eq(fixture(body,false).fn('fixture-profile','codex'),'## 主人画像\n\n'+body);ok(fixture('字'.repeat(300),false).fn('fixture-profile','codex').endsWith('字'.repeat(300)));
let oversized='';try{fixture('字'.repeat(301),true).fn('fixture-profile','codex')}catch(e){oversized=e.message}ok(oversized.includes('301 characters'));
const {EventMemoryStore}=await import(pathToFileURL(resolve(root,'packages/api/src/domains/memory/EventMemoryStore.ts')).href);const store=new EventMemoryStore(':memory:');await store.initialize();
const record={type:'demo-brake',trigger:'human_brake',cat:'codex',threadId:'t42',messageId:'m101',timestamp:100,summary:'可能需要纠偏',cognitiveTransition:null,relatedHarness:null,confidence:'mid'};
const a=store.markEvent(record,'alice');eq(a.inserted,true);const duplicate=store.markEvent(record,'alice');eq(duplicate.inserted,false);eq(duplicate.event.eventId,a.event.eventId);
const upgraded=store.markEvent({...record,confidence:'high',timestamp:200,summary:'用户明确要求停止重复扣款',cognitiveTransition:'user_brake'},'alice');eq(upgraded.inserted,false);eq(upgraded.event.eventId,a.event.eventId);eq(upgraded.event.confidence,'high');eq(upgraded.event.timestamp,100);
const b=store.markEvent(record,'bob');ok(b.event.eventId!==a.event.eventId);eq(store.listEvents().length,2);eq(store.listEvents({ownerUserId:'alice'}).length,1);eq(store.getByCoord('t42','m101','carol'),[]);assert.throws(()=>store.markEvent(record,''),/ownerUserId is required/);checks++;
const main=source('packages/api/src/index.ts');const start=main.indexOf('onMagicWordDetected: (');const stop=main.indexOf('\n    },\n  };',start)+7;ok(start>0&&stop>start);
const createWriter=new Function('memoryServices','appendMagicWordRefToEpisode','taskOutcomeStore','app',stripTypeScriptTypes('const holder={'+main.slice(start,stop)+'};',{mode:'transform'})+'\nreturn holder.onMagicWordDetected;');
const refs=[],logs=[];const failed=new EventMemoryStore(':memory:');const failWriter=createWriter({eventMemoryStore:failed},(_,ref)=>refs.push(ref),{}, {log:{error:(...a)=>logs.push(a)}});
failWriter([{word:'demo-brake'}],'t42','codex','m101','alice','停止重复扣款');eq(refs.length,0);eq(failed.listDeadLetter().length,1);eq(failed.listDeadLetter()[0].ownerUserId,'alice');eq(failed.listDeadLetter()[0].record.confidence,'high');eq(logs.length,1);
const liveWriter=createWriter({eventMemoryStore:store},(_,ref)=>refs.push(ref),{}, {log:{error:(...a)=>logs.push(a)}});liveWriter([{word:'demo-brake'}],'t42','codex','m101','alice','停止重复扣款');eq(refs[0].eventId,a.event.eventId);eq(store.listEvents().length,2);
console.log(JSON.stringify({assertions:checks,capsule:{missing:'',valid:text,readOperations:valid.reads.map(p=>p.split(/[\\/]/).at(-1)),accessOperations:valid.probes.map(p=>p.split(/[\\/]/).at(-1)),visibleChars:10,oversized},events:{firstInserted:a.inserted,duplicateInserted:duplicate.inserted,upgrade:{inserted:upgraded.inserted,sameId:upgraded.event.eventId===a.event.eventId,confidence:upgraded.event.confidence,timestamp:upgraded.event.timestamp},ownerRows:store.listEvents().map(e=>({owner:e.ownerUserId,thread:e.threadId,message:e.messageId,type:e.type,confidence:e.confidence})),failedWrite:{failureInjected:'store intentionally not initialized',referenceCount:0,deadLetter:failed.listDeadLetter()[0]}}},null,2));store.db.close();
ORIGINAL 31 END */
