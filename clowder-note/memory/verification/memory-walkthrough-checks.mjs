/**
 * Memory notes: executable walkthroughs, not production integration tests.
 * Run with Node 24+: node --experimental-transform-types <this-file>
 * Reads repository TS; creates SQLite :memory: only; writes results.json HERE only.
 * SQLite adapter adds better-sqlite3's synchronous transaction convenience API.
 * Resolution hook maps existing source-relative .js imports to sibling .ts files.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { DatabaseSync } from 'node:sqlite';

const here=dirname(fileURLToPath(import.meta.url));
const sourceRoot=resolve(here,'../../../clowder-ai');
const sourceUrl=pathToFileURL(sourceRoot + '/').href;
// Guard only; not counted among algorithm scenarios. LF-normalized source fingerprints.
const EXPECTED_SOURCES={
  "packages/api/src/domains/memory/schema.ts": "06120411eecef3f56d8431d079203e8f0504bfcd0cd4aa49f97e5e57ce40cdb7",
  "packages/api/src/domains/memory/fts-query-builder.ts": "3eea45ca8f9f0220686c6d8c7a80c591c936894fed7fc4d89a03aa2f934bfd5b",
  "packages/api/src/domains/memory/lexical-backfill.ts": "6033f8a158a5cdb75079e8913e86262a53a25ec3e1e4a90c87f14e4c6ab9c4cc",
  "packages/api/src/domains/memory/AbstractiveSummaryClient.ts": "c12c57639c0df30657ef5c23961599d36a078a7e99df60365d8b22c96f8e0b25",
  "packages/api/src/domains/memory/SummaryCompactionTask.ts": "e957de8b018ca2426f0b05f83bd83ae3206375f0560fdc250774db8e51883b67",
  "packages/api/src/domains/memory/summary-config.ts": "e6a9f1f596d8159876db797dc92c42582d3e66f795f58ccdac8df86c8392c73c",
  "packages/api/src/domains/memory/PassageVectorStore.ts": "e07cef8ece2b8ca0c4183ce2bc3b80c6d30f50c3b25e7a854892d26e07b1b9a8",
  "packages/api/src/domains/memory/VectorStore.ts": "9e685dd31ebca752637d02b86cf9ae966b707208fbd858e97aaca07df920c8f4",
  "packages/api/src/domains/memory/f163-duplicate-scanner.ts": "7762350afe34f088f003830fa9d981a3a6986e1e75accc51277fb5ed7268554b",
  "packages/api/src/domains/memory/f163-contradiction-detector.ts": "fef47a9d12eb727d59a96e9f6d3b79040f654c36358d35da6bce6a9ca835ca54",
  "packages/api/src/domains/memory/RecallEventCorrelator.ts": "d0097f1a47a699c7007e367c11a2603562c3643ee9f8a265fff601a488fd823e",
  "packages/api/src/domains/memory/RecallMetricsComputer.ts": "334580d3589840ac8f7de451e986ab0238d675615c03322640a7149d54a96a6f",
  "packages/api/src/domains/memory/recall-target-match.ts": "f2279383ad34e75156f493f021c03954cd3d08ba670ce32606e6b2a5650e251f",
  "packages/api/src/domains/memory/parse-shell-read-paths.ts": "901c2eafcd2d8377ba200e545f8e93c8f171534a817a58964b1299a8a31f78d8",
  "packages/api/src/domains/memory/EntityRegistry.ts": "c8e539f27839a8035374fc0ec0711405bec7d6681053ba440d8da3c99670e8f6",
  "packages/api/src/domains/memory/f163-types.ts": "bc331b8d76a858b2cdd821d64b49943159c422c393be67fc6092e17ccb6e1069",
  "packages/api/src/domains/memory/SqliteEvidenceStore.ts": "a4b61f70b8ad42708791ecdf4078ae4ce403aebbe2f340b778fbba584ba3c70e",
  "packages/api/src/domains/cats/services/session/extractDecisionSignals.ts": "3e36c9f134c44d6f959e31afe6c6ba76903c99c559648ebcf862cc4374e8a3b8",
  "packages/api/src/domains/cats/services/session/buildThreadMemory.ts": "df193d0ef0f5f95e64d0134b3dd1192d536f730cadcc58bad0891ac91dd3d915",
  "packages/api/src/domains/cats/services/session/TranscriptWriter.ts": "4b5e6674c63361da662087867c22a87678facc51320f8d83eec7e2db435ce464",
  "packages/api/src/domains/cats/services/session/SessionBootstrap.ts": "5f4e9cf05ca2a5f8e5f6a48408296049e8c674c6c69f81f3d4fa18e8e534d0d7",
  "packages/api/src/domains/cats/services/stores/ports/MemoryGovernanceStore.ts": "082a0d9c0b88ad506a840aeb02d95bbc379e56696df68c602533dd8f58d0562c",
  "packages/api/src/domains/cats/services/tool-usage/derive-result-summary.ts": "f2f504748529feccde2c2014c43d50221d3800c0f5c629f6c9e2381454c64f81"
};
const sourceDrift=[];
for(const [relative,expected] of Object.entries(EXPECTED_SOURCES)){const file=join(sourceRoot,relative);const actual=existsSync(file)?createHash('sha256').update(readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex'):null;if(actual!==expected)sourceDrift.push({relative,expected,actual});}
if(sourceDrift.length){writeFileSync(join(here,'results.json'),JSON.stringify({generatedAt:new Date().toISOString(),sourceCommit:'6868041ca',preflightPassed:false,sourceDrift,cases:0,passed:0,failed:0},null,2)+'\n','utf8');throw new Error('Source drift: refusing to reuse these fixtures and extraction ranges. See results.json');}

registerHooks({ resolve(specifier, context, nextResolve) {
  if(context.parentURL?.startsWith(sourceUrl) && specifier.startsWith('.') && specifier.endsWith('.js')) {
    const candidate=new URL(specifier.replace(/\.js$/,'.ts'),context.parentURL);
    if(existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href,context);
  }
  return nextResolve(specifier,context);
}});
const imp=(rel)=>import(pathToFileURL(join(sourceRoot,rel)).href);
const base='packages/api/src/domains/memory/';
const schema=await imp(base+'schema.ts');
const {buildProgressiveFtsQueries}=await imp(base+'fts-query-builder.ts');
const {rankLexicalBackfillRows}=await imp(base+'lexical-backfill.ts');
const {parseNaturalLanguageOutput}=await imp(base+'AbstractiveSummaryClient.ts');
const {processThread}=await imp(base+'SummaryCompactionTask.ts');
const {SUMMARY_CONFIG,hasHighValueSignal}=await imp(base+'summary-config.ts');
const {passageVectorKey,parsePassageVectorKey}=await imp(base+'PassageVectorStore.ts');
const {VectorStore}=await imp(base+'VectorStore.ts');
const {DuplicateScanner}=await imp(base+'f163-duplicate-scanner.ts');
const {ContradictionDetector}=await imp(base+'f163-contradiction-detector.ts');
const {RecallEventCorrelator}=await imp(base+'RecallEventCorrelator.ts');
const {RecallMetricsComputer}=await imp(base+'RecallMetricsComputer.ts');
const {targetMatch}=await imp(base+'recall-target-match.ts');
const results=[];const dbs=[];
function db(full=true){
 const native=new DatabaseSync(':memory:');dbs.push(native);
 const adapter={exec:s=>native.exec(s),prepare:s=>{const stmt=native.prepare(s);const flat=args=>args.length===1&&Array.isArray(args[0])?args[0]:args;return {run:(...args)=>stmt.run(...flat(args)),get:(...args)=>stmt.get(...flat(args)),all:(...args)=>stmt.all(...flat(args))};},transaction:fn=>(...args)=>{
  native.exec('BEGIN');try{const r=fn(...args);native.exec('COMMIT');return r;}catch(e){native.exec('ROLLBACK');throw e;}
 }};
 if(full)schema.applyMigrations(adapter);
 return adapter;
}
async function check(name,fn){try{const evidence=await fn();results.push({name,passed:true,evidence});}catch(e){results.push({name,passed:false,error:e.stack||String(e)});}}
const now=Date.now();
const sqlStore=db();
const add=(anchor,kind,title,summary,keywords=[])=>sqlStore.prepare('INSERT INTO evidence_docs(anchor,kind,status,title,summary,keywords,updated_at) VALUES (?,?,\'active\',?,?,?,?)').run(anchor,kind,title,summary,JSON.stringify(keywords),new Date(now).toISOString());
add('F102','feature','F102 memory architecture','design evidence catalogue',['retry']);
add('L-B','lesson','F102 retry protocol','on failure preserve idempotency',['F102','retry']);
add('D-C','discussion','cat cooperation','short unrelated report',['cat']);
const query=(q)=>sqlStore.prepare('SELECT d.anchor,bm25(evidence_fts,5.0,1.0) AS rank FROM evidence_fts f JOIN evidence_docs d ON d.rowid=f.rowid WHERE evidence_fts MATCH ? ORDER BY rank LIMIT 20').all(q);
const qs=buildProgressiveFtsQueries('F102 retry on cat');
await check('03-query-levels',()=>{assert.deepEqual(qs,['"F102" "retry" "on" "cat"','"F102" AND "retry" AND ("on" OR "cat")','"F102" OR "retry" OR "on" OR "cat"']);return qs;});
await check('03-relaxation-before-D',()=>{const levels=qs.map(q=>({query:q,hits:query(q)}));assert.equal(levels[0].hits.length,0);assert.deepEqual(levels[1].hits.map(x=>x.anchor),['L-B']);assert.equal(levels[2].hits.length,3);return levels;});
add('P-D','plan','F102 retry cat adapter','on timeout use stable key');
await check('03-first-nonempty-is-not-fill-topk',()=>{const levels=qs.map(q=>({query:q,hits:query(q)}));assert.deepEqual(levels[0].hits.map(x=>x.anchor),['P-D']);assert.equal(levels[1].hits.length,2);return {levels,selectedFtsStage:0,selectedFtsAnchors:['P-D'],requestedLimit:5};});
await check('03-keywords-are-not-fts-column',()=>{const anchors=query('"retry"').map(x=>x.anchor);assert.ok(!anchors.includes('F102'));assert.equal(sqlStore.prepare("SELECT COUNT(*) AS n FROM evidence_docs WHERE anchor='F102' AND keywords LIKE '%retry%'").get().n,1);return {ftsAnchors:anchors,keywordOnlyAnchor:'F102'};});
await check('03-short-query-no-or',()=>{assert.equal(buildProgressiveFtsQueries('回调重复消息').length,1);assert.equal(buildProgressiveFtsQueries('F102 retry cat').length,1);return buildProgressiveFtsQueries('F102 retry cat');});
await check('03-lexical-coverage-not-frequency',()=>{
 const row=(anchor,title,summary,keywords)=>({anchor,title,summary,keywords:JSON.stringify(keywords),updated_at:'2026-09-12',superseded_by:null,source_path:null,provenance_tier:null});
 const out=rankLexicalBackfillRows([row('A','misc','retry',['retry']),row('B','retry key retry key','misc',[])],['retry','key']);
 assert.deepEqual(out.rows.map(r=>r.anchor),['A','B']);assert.equal(out.signals.get('B').titleHits,2);
 return {order:out.rows.map(r=>r.anchor),signals:Object.fromEntries(out.signals)};
});
await check('03-four-doc-substring-ranking',()=>{const rows=sqlStore.prepare('SELECT anchor,title,summary,keywords,updated_at,source_path,provenance_tier,superseded_by FROM evidence_docs').all();const out=rankLexicalBackfillRows(rows,['f102','retry','on','cat']);assert.deepEqual(out.rows.map(r=>r.anchor),['L-B','D-C','F102','P-D']);return {order:out.rows.map(r=>r.anchor),signals:Object.fromEntries(out.signals)};});
await check('02-10-count-equality-does-not-prove-fts-postings',()=>{
 const d=db(false);d.exec(schema.SCHEMA_V1);d.prepare("INSERT INTO evidence_docs(anchor,kind,status,title,summary,updated_at) VALUES('X','lesson','active','alpha','beta','2026-09-12')").run();
 const docs=d.prepare('SELECT count(*) AS n FROM evidence_docs').get().n,fts=d.prepare('SELECT count(*) AS n FROM evidence_fts').get().n,hits=d.prepare("SELECT count(*) AS n FROM evidence_fts WHERE evidence_fts MATCH 'alpha'").get().n;
 assert.equal(docs,fts);assert.equal(hits,0);return {docs,fts,alphaMatchCount:hits,note:'source schema WITHOUT synchronization triggers is the intentional broken fixture'};
});
const {aliasMatchesText,normalizeEntityAlias}=await imp(base+'EntityRegistry.ts');
await check('03-entity-boundaries-differ-from-substring',()=>{assert.equal(aliasMatchesText('cat cooperation','cat'),true);assert.equal(aliasMatchesText('catalogue','cat'),false);assert.equal(aliasMatchesText('F10','F1'),false);assert.equal(aliasMatchesText('布偶猫','布偶'),true);assert.equal(normalizeEntityAlias('  Ｆ１０  '),'f10');return {catWord:true,catInCatalogue:false,F1InF10:false,CJKSubstring:true,NFKC:'f10'};});
await check('04-production-rrf-accumulation-loops',()=>{
 const text=readFileSync(join(sourceRoot,base+'SqliteEvidenceStore.ts'),'utf8');const origin=text.indexOf('private async hybridRRFSearch(');const a=text.indexOf('// BM25 ranks',origin),b=text.indexOf('// Collect all unique anchors',a);assert.ok(a>0&&b>a);
 const apply=new Function('lexicalResults','nnResults','scores','RRF_K','nnWeight',text.slice(a,b));
 const lexical=[{anchor:'A'},...['x1','x2','x3'].map(anchor=>({anchor})),{anchor:'B'}];const nn=[{anchor:'B'},...Array.from({length:8},(_,i)=>({anchor:`v${i}`})),{anchor:'A'}];
 const trace={};for(const w of [1,1.5]){const scores=new Map();apply(lexical,nn,scores,60,w);assert.ok(scores.get('B')>scores.get('A'));trace[w]={A:scores.get('A'),B:scores.get('B')};}
 return {trace,scope:'actual two accumulation loops, fixed NN fixture; no real vec0 KNN or embeddings'};
});
await check('04-vector-key-is-unambiguous-pair',()=>{const key=passageVectorKey('thread:T/42','msg:[m101]');assert.deepEqual(parsePassageVectorKey(key),{docAnchor:'thread:T/42',passageId:'msg:[m101]'});assert.throws(()=>parsePassageVectorKey('[1,"x"]'));return key;});
await check('04-metadata-revision-only-is-not-compared',()=>{const d=db();const store=new VectorStore(d,3);store.initMeta({modelId:'model-a',modelRev:'r1',dim:3});const same=store.checkMetaConsistency({modelId:'model-a',modelRev:'r2',dim:3});const changed=store.checkMetaConsistency({modelId:'model-b',modelRev:'r1',dim:3});assert.equal(same.consistent,true);assert.equal(changed.consistent,false);return {same,changed};});
const parserInput={threadId:'T42',previousSummary:null,messages:[{id:'m101',content:'第一次写入成功但响应丢失。',timestamp:now-1200000},{id:'m102',content:'决定使用稳定业务键。',timestamp:now-1200000}]};
const modelText='# 回调重试的幂等策略\n\n保留幂等键，避免重复送达产生重复副作用。\n\n## Durable Knowledge\n[decision!] 网络重试必须保持业务幂等 — 对重复送达的写入使用稳定业务键。';
await check('06-parser-confirmation-is-output-punctuation',()=>{const explicit=parseNaturalLanguageOutput(modelText,parserInput),plain=parseNaturalLanguageOutput(modelText.replace('[decision!]','[decision]'),parserInput);assert.equal(explicit.segments[0].candidates[0].confidence,'explicit');assert.equal(plain.segments[0].candidates[0].confidence,'inferred');assert.equal(explicit.segments[0].candidates[0].evidence[0].messageId,'m101');return {explicit,plainConfidence:plain.segments[0].candidates[0].confidence};});
await check('06-parser-multiple-titles-still-one-segment',()=>{const out=parseNaturalLanguageOutput(modelText+'\n\n# 第二个话题\n另一个议题仍处于同一批次。',parserInput);assert.equal(out.segments.length,1);return {segments:out.segments.length,boundary:out.segments[0].boundaryReason};});
await check('06-parser-format-fallback-and-noise-rejection',()=>{assert.equal(parseNaturalLanguageOutput('# 只有标题没有任何正文内容',parserInput),null);const plain=parseNaturalLanguageOutput('没有标题但这是一句足够长而且可以作为摘要的正文',parserInput);assert.equal(plain.segments.length,1);const noisy=parseNaturalLanguageOutput('# 本批工作总结\n\n讨论了实现细节与未来原则。\n\n[decision!] 修复了 parser.ts 中的错误 — 已经运行了测试。',parserInput);assert.equal(noisy.segments[0].candidates,undefined);return {titleOnly:null,noMarkdown:plain,noisyExplicitCandidates:0};});
const taskText=readFileSync(join(sourceRoot,base+'SummaryCompactionTask.ts'),'utf8');const fStart=taskText.indexOf('function isEligible('),fEnd=taskText.indexOf('\n}',fStart)+2;
const eligibleCode=stripTypeScriptTypes(taskText.slice(fStart,fEnd));
const eligible=runInNewContext(eligibleCode+'\nisEligible',{hasHighValueSignal,Date:class extends Date {static now(){return now;}}});
function state(overrides={}){return {thread_id:'T42',last_summarized_message_id:null,pending_message_count:20,pending_token_count:2000,pending_signal_flags:0,summary_type:'concat',last_abstractive_at:null,abstractive_token_count:null,carry_over:0,...overrides};}
await check('06-gate-carryover-does-not-bypass-quiet',()=>{const quiet={threadId:'T42',lastMessageAt:now-20*60000},hot={threadId:'T42',lastMessageAt:now-60000};const s=state({pending_message_count:5,pending_token_count:50,last_abstractive_at:new Date(now-60000).toISOString(),carry_over:1});assert.equal(eligible(s,quiet,SUMMARY_CONFIG),true);assert.equal(eligible(s,hot,SUMMARY_CONFIG),false);assert.equal(eligible({...s,carry_over:0},quiet,SUMMARY_CONFIG),false);return {tailQuiet:true,tailHot:false,tailWithoutCarryover:false};});
function prepareTask(count){
 const d=db();d.prepare("INSERT INTO evidence_docs(anchor,kind,status,title,summary,updated_at) VALUES('thread-T42','thread','active','回调排查','old-summary',?)").run(new Date(now).toISOString());
 d.prepare("INSERT INTO summary_state(thread_id,pending_message_count,pending_token_count,pending_signal_flags,summary_type,carry_over) VALUES('T42',?,?,0,'concat',0)").run(count,count*100);
 const messages=Array.from({length:count},(_,i)=>({id:`m${String(i+1).padStart(3,'0')}`,content:'消息 '+i,timestamp:now-20*60000}));
 const calls=[];
 const deps={db:d,enabled:()=>true,getThreadLastActivity:async()=>({threadId:'T42',lastMessageAt:now-20*60000}),getMessagesAfterWatermark:async(_thread,id,limit)=>{calls.push({after:id,limit});const start=id?messages.findIndex(m=>m.id===id)+1:0;return messages.slice(start,start+limit);},generateAbstractive:async(input)=>({segments:[{summary:'new-summary',topicKey:'retry',topicLabel:'重试',boundaryReason:'single batch',boundaryConfidence:'high',fromMessageId:input.messages[0].id,toMessageId:input.messages.at(-1).id,messageCount:input.messages.length,candidates:[]}]}),logger:{info(){},error(){}}};
 return {d,deps,calls,messages,getState:()=>d.prepare("SELECT * FROM summary_state WHERE thread_id='T42'").get()};
}
await check('06-production-processThread-205-messages-tail',async()=>{const t=prepareTask(205);const ok=await processThread(t.getState(),t.deps,SUMMARY_CONFIG);assert.equal(ok,true);const s=t.getState();assert.equal(s.last_summarized_message_id,'m200');assert.equal(s.pending_message_count,5);assert.equal(s.carry_over,1);assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM summary_segments').get().n,1);return {state:s,calls:t.calls};});
await check('06-production-processThread-second-tail-batch',async()=>{const t=prepareTask(205);await processThread(t.getState(),t.deps,SUMMARY_CONFIG);const afterFirst={...t.getState()};await processThread(t.getState(),t.deps,SUMMARY_CONFIG);const afterSecond=t.getState();assert.equal(afterSecond.last_summarized_message_id,'m205');assert.equal(afterSecond.pending_message_count,0);assert.equal(afterSecond.carry_over,0);assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM summary_segments').get().n,2);return {afterFirst,afterSecond,segments:t.d.prepare('SELECT from_message_id,to_message_id,message_count FROM summary_segments').all()};});
await check('06-model-null-does-not-advance',async()=>{const t=prepareTask(20);t.deps.generateAbstractive=async()=>null;const ok=await processThread(t.getState(),t.deps,SUMMARY_CONFIG);assert.equal(ok,false);assert.equal(t.getState().last_summarized_message_id,null);assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM summary_segments').get().n,0);return {ok,watermark:t.getState().last_summarized_message_id};});
await check('06-transaction-failure-rolls-back-segment-and-watermark',async()=>{const t=prepareTask(20);t.d.exec("CREATE TRIGGER fail_summary BEFORE UPDATE OF summary ON evidence_docs BEGIN SELECT RAISE(ABORT,'fixture fail'); END");await assert.rejects(processThread(t.getState(),t.deps,SUMMARY_CONFIG),/fixture fail/);assert.equal(t.getState().last_summarized_message_id,null);assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM summary_segments').get().n,0);return {segments:0,watermark:null};});
await check('06-reembed-failure-does-not-roll-back-committed-summary',async()=>{const t=prepareTask(20);t.deps.reEmbed=async()=>{throw new Error('fixture embedding offline');};assert.equal(await processThread(t.getState(),t.deps,SUMMARY_CONFIG),true);assert.equal(t.getState().last_summarized_message_id,'m020');return {watermark:t.getState().last_summarized_message_id,summary:t.d.prepare("SELECT summary FROM evidence_docs WHERE anchor='thread-T42'").get().summary};});
await check('06-candidate-failure-retains-replay-source',async()=>{const t=prepareTask(20);const generate=t.deps.generateAbstractive;t.deps.generateAbstractive=async(input)=>{const out=await generate(input);out.segments[0].candidates=[{kind:'lesson',title:'网络重试必须保持业务幂等',claim:'稳定业务键消除重复写入',confidence:'inferred'}];return out;};t.deps.submitCandidate=async()=>{throw new Error('fixture marker write failed');};assert.equal(await processThread(t.getState(),t.deps,SUMMARY_CONFIG),true);const row=t.d.prepare('SELECT candidates FROM summary_segments').get();assert.equal(JSON.parse(row.candidates).length,1);assert.equal(t.getState().last_summarized_message_id,'m020');return {watermark:t.getState().last_summarized_message_id,storedCandidates:JSON.parse(row.candidates),markerFileWritten:false};});

const {extractDecisionSignals}=await imp('packages/api/src/domains/cats/services/session/extractDecisionSignals.ts');
await check('07-decision-question-rules-are-not-exclusive',()=>{const out=extractDecisionSignals({transcriptText:'是否使用 Redis 还需要确认。\n决定采用稳定幂等键。\n参考 ADR-020 和 F102。',summaryConclusions:['采用稳定幂等键'],summaryOpenQuestions:[]});assert.ok(out.decisions.includes('是否使用 Redis 还需要确认'));assert.ok(out.openQuestions.includes('是否使用 Redis 还需要确认'));assert.ok(!out.decisions.includes('决定采用稳定幂等键'));return out;});
await check('07-threadMemory-source-with-token-estimator-stub',()=>{
 const original=readFileSync(join(sourceRoot,'packages/api/src/domains/cats/services/session/buildThreadMemory.ts'),'utf8');
 const js=stripTypeScriptTypes(original).replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
 const {buildThreadMemory}=runInNewContext(js+'\n;({buildThreadMemory})',{estimateTokens:text=>text.length,formatPromptTimeRange:()=> 'TIME',Date});
 const digest={v:1,sessionId:'S2',threadId:'T42',catId:'cat-a',seq:1,time:{createdAt:0,sealedAt:60000},invocations:[],filesTouched:[{path:'src/api.ts',ops:['read','edit']}],errors:[]};
 const existing={v:1,summary:'OLD_RECENT\nOLD_OLDEST',sessionsIncorporated:7,updatedAt:1,recentArtifacts:[{ref:'A',updatedAt:1},{ref:'B',updatedAt:2}]};
 const full=buildThreadMemory(existing,digest,10000,undefined,[{ref:'A',updatedAt:5}]);
 const budget=full.summary.split('\n').slice(0,2).join('\n').length;
 const trimmed=buildThreadMemory(existing,digest,budget,undefined,[{ref:'A',updatedAt:5}]);
 assert.ok(trimmed.summary.startsWith('Session #2'));assert.ok(trimmed.summary.endsWith('OLD_RECENT'));assert.ok(!trimmed.summary.includes('OLD_OLDEST'));assert.equal(trimmed.sessionsIncorporated,8);assert.equal(trimmed.recentArtifacts[0].ref,'A');assert.equal(trimmed.recentArtifacts[0].updatedAt,5);
 return {full:full.summary,budget,trimmed,scope:'original function module body; character-count token stub + time-format stub, not actual tokenizer or provider budget'};
});
await check('07-transcript-live-buffer-merge-original-fragment',()=>{
 const original=readFileSync(join(sourceRoot,'packages/api/src/domains/cats/services/session/TranscriptWriter.ts'),'utf8');
 const a=original.indexOf('const bufKeys = new Set(buf.map'),end='this.buffers.set(session.sessionId, buf);',b=original.indexOf(end,a)+end.length;assert.ok(a>0&&b>a);
 const merge=new Function('buf','liveEvents','session',original.slice(a,b)+';return buf;');
 const before={eventNo:0,timestamp:100,invocationId:'I-old',event:{type:'text',content:'before'}};
 const after={eventNo:0,timestamp:200,invocationId:'I-new',event:{type:'text',content:'after'}};
 const out=merge.call({buffers:new Map()},[after],[before,after],{sessionId:'S1'});assert.equal(out.length,2);assert.deepEqual(out.map(e=>e.eventNo),[0,1]);assert.deepEqual(out.map(e=>e.invocationId),['I-old','I-new']);
 const collision=merge.call({buffers:new Map()},[{...after,invocationId:'I-new'}],[{...after,invocationId:'I-old'}],{sessionId:'S1'});assert.equal(collision.length,1);
 return {merged:out,identicalTimeAndPayloadDifferentInvocationCount:collision.length,scope:'original merge fragment, buffers and events in memory, no filesystem flush'};
});

await check('07-bootstrap-budget-original-drop-fragment',()=>{
 const src=readFileSync(join(sourceRoot,'packages/api/src/domains/cats/services/session/SessionBootstrap.ts'),'utf8');const a=src.indexOf('const fixedAlwaysKeepTokens ='),b=src.indexOf('  const text =',a);assert.ok(a>0&&b>a);
 const body=src.slice(a,b)+';return {threadMemorySection,recallSection,digestSection,taskSection,hasThreadMemory,hasDigest,hasTaskSnapshot,remainingBudget};';
 const run=new Function('identitySection','toolsSection','handoffNoteSection','threadMemorySection','recallSection','digestSection','taskSection','hasThreadMemory','hasDigest','hasTaskSnapshot','MAX_BOOTSTRAP_TOKENS','HANDOFF_NOTE_VARIABLE_RESERVE_TOKENS','estimateTokens','capHandoffNoteToBudget',body);
 const invoke=tm=>run('I'.repeat(450),'','', 'M'.repeat(tm),'R'.repeat(250),'D'.repeat(500),'T'.repeat(200),true,true,true,2000,400,t=>t.length,s=>s);
 const one=invoke(1000),two=invoke(1700);assert.equal(one.recallSection.length,0);assert.equal(one.taskSection.length,0);assert.equal(one.digestSection.length,500);assert.equal(one.threadMemorySection.length,1000);assert.equal(two.threadMemorySection.length,0);assert.equal(two.hasThreadMemory,false);
 const compact=x=>({remainingBudget:x.remainingBudget,tm:x.threadMemorySection.length,recall:x.recallSection.length,digest:x.digestSection.length,task:x.taskSection.length,hasThreadMemory:x.hasThreadMemory});
 return {fitsAfterDroppingRecallAndTask:compact(one),oversizeThreadMemory:compact(two),scope:'original budget fragment with explicit character-count estimator; no actual tokenizer or provider call'};
});
const {resolveTransition}=await imp('packages/api/src/domains/cats/services/stores/ports/MemoryGovernanceStore.ts');
await check('08-legacy-governance-table-is-strict',()=>{assert.equal(resolveTransition('draft','submit_review'),'pending_review');assert.equal(resolveTransition('pending_review','approve'),'published');assert.throws(()=>resolveTransition('draft','approve'));return {draftSubmitReview:'pending_review',pendingApprove:'published',draftApprove:'throws'};});
await check('08-duplicate-single-linkage-chain',()=>{const d=db();const ins=d.prepare("INSERT INTO evidence_docs(anchor,kind,status,title,summary,updated_at) VALUES(?,'lesson','active',?,'',?)");for(const [a,title] of [['A','alpha beta'],['B','alpha beta gamma delta'],['C','gamma delta']])ins.run(a,title,new Date(now).toISOString());const out=new DuplicateScanner().scan(d,{threshold:0.6,kinds:['lesson']});assert.equal(out.length,1);assert.deepEqual(new Set(out[0].anchors),new Set(['A','B','C']));return out;});
await check('08-contradiction-is-overlap-not-logical-proof',async()=>{const prior=process.env.F163_CONTRADICTION_DETECTION;process.env.F163_CONTRADICTION_DETECTION='suggest';try{const detector=new ContradictionDetector({search:async()=>[{anchor:'D1',kind:'decision',status:'active',title:'retry request',summary:'',updatedAt:new Date(now).toISOString()}]});const out=await detector.check({title:'retry request',kind:'decision'});assert.ok(Math.abs(out[0].similarity-1)<1e-12);assert.equal(out[0].reason,'lexical_overlap');return out;}finally{if(prior===undefined)delete process.env.F163_CONTRADICTION_DETECTION;else process.env.F163_CONTRADICTION_DETECTION=prior;}});
const recallDb=db();const correlator=new RecallEventCorrelator(recallDb);
function event(toolName,step,elapsed,summary={},extra={}){return {invocationId:'I1',sessionId:'S1',threadId:'T42',catId:'cat-a',toolName,timestamp:now+elapsed,turnIndex:step,status:'ok',summary,...extra};}
const search=()=>event('search_evidence',0,0,{query:'retry',_f200Candidates:[{anchor:'DOC-A',rank:0,sourcePath:'docs/a.md',docKind:'lesson'}]});
function windowCase(step,ms){const ev=[search(),...Array.from({length:step-1},(_,i)=>event('Edit',i+1,i*1000)),event('Read',step,ms,{file_path:'/work/docs/a.md'})];return correlator.correlateWindow(ev)[0];}
await check('10-window-OR-semantics',()=>{const a=windowCase(21,120000),b=windowCase(3,360000),c=windowCase(21,360000);assert.equal(a.consumed.length,1);assert.equal(b.consumed.length,1);assert.equal(c.consumed.length,0);return {step21time2min:a.consumed,step3time6min:b.consumed,step21time6min:c.consumed};});
await check('10-other-cat-and-next-invocation-are-not-consumption',()=>{const foreign=correlator.correlateWindow([search(),event('Read',1,1,{file_path:'/work/docs/a.md'},{catId:'cat-b'})])[0];const next=correlator.correlateWindow([search(),event('Read',1,1,{file_path:'/work/docs/a.md'},{invocationId:'I2'})])[0];assert.equal(foreign.consumed.length,0);assert.equal(next.consumed.length,0);return {foreignCat:0,nextInvocation:0};});
await check('10-target-match-is-substring-and-not-read-success',()=>{assert.equal(targetMatch('Read',{file_path:'/work/docs/a.md.bak'},{kind:'doc',sourcePath:'docs/a.md',anchor:'DOC-A'}),true);const out=correlator.correlateWindow([search(),event('Read',1,1,{file_path:'/work/docs/a.md'},{status:'error'})])[0];assert.equal(out.consumed.length,1);return {substringBackupMatches:true,errorStatusStillMatchedAtThisLayer:true};});
await check('10-passage-target-not-matched-by-thread-reader',()=>{assert.equal(targetMatch('get_thread_context',{threadId:'T42'},{kind:'passage',passageId:'msg-m101',threadId:'T42'}),false);assert.equal(targetMatch('get_thread_context',{threadId:'T42'},{kind:'thread',threadId:'T42'}),true);return {passageTarget:false,threadTarget:true};});

const {deriveResultSummary}=await imp('packages/api/src/domains/cats/services/tool-usage/derive-result-summary.ts');
await check('10-output-parser-keeps-count-separate-and-source-blocks',()=>{const text='Found 3 result(s)\n[high] A\n  anchor: DOC-A\n  type: lesson\n[mid] B\n  anchor: DOC-B\n  type: lesson\n  sourcePath: docs/b.md\n';const out=deriveResultSummary('search_evidence',[{type:'text',text}]);assert.equal(out.resultCount,3);assert.equal(out._f200Candidates.length,2);assert.equal(out._f200Candidates[0].sourcePath,undefined);assert.equal(out._f200Candidates[1].sourcePath,'docs/b.md');return out;});
await check('10-two-searches-one-read-is-ambiguous',()=>{const out=correlator.correlateWindow([search(),{...search(),timestamp:now+1000,turnIndex:1},event('Read',2,2000,{file_path:'/work/docs/a.md'})]);assert.equal(out.length,2);assert.equal(out[0].resultSetId,out[1].resultSetId);assert.equal(out[0].attributionClarity,'ambiguous');assert.equal(out[1].attributionClarity,'ambiguous');return out.map(r=>({tool:r.toolName,bundle:r.resultSetId,clarity:r.attributionClarity,consumed:r.consumed.length}));});
await check('10-graph-dual-role-closes-and-opens-bundles',()=>{const out=correlator.correlateWindow([search(),event('graph_resolve',1,1000,{query:'DOC-A',_f200Candidates:[{anchor:'DOC-A',rank:0,sourcePath:'docs/a.md'}]}),{...search(),timestamp:now+2000,turnIndex:2}]);assert.equal(out.length,3);assert.equal(new Set(out.map(x=>x.resultSetId)).size,3);return out.map(r=>({tool:r.toolName,bundle:r.resultSetId}));});
await check('10-one-shell-read-can-consume-two-docs',()=>{const start=search();start.summary._f200Candidates.push({anchor:'DOC-B',rank:1,sourcePath:'docs/b.md',docKind:'lesson'});const out=correlator.correlateWindow([start,event('command_execution',1,1000,{command:'cat /work/docs/a.md /work/docs/b.md'})])[0];assert.equal(out.consumed.length,2);return out.consumed;});
await check('10-search-text-thread-anchor-does-not-infer-thread-ref',()=>{const summary=deriveResultSummary('search_evidence','Found 1 result(s)\n[high] Thread\n  anchor: thread-T42\n  type: discussion\n  sourcePath: threads/T42\n');const out=correlator.correlateWindow([event('search_evidence',0,0,summary),event('get_thread_context',1,1000,{threadId:'T42',messageId:'m101'})])[0];assert.equal(out.candidates[0].targetRef.kind,'doc');assert.equal(out.consumed.length,0);return {candidate:out.candidates[0],consumed:out.consumed,scope:'specific production text-parser + correlator composition; other producers may provide explicit typed coordinates'};});
await check('10-core-metrics-three-recalls',()=>{const d=db();const c=new RecallEventCorrelator(d);const one=windowCase(1,1),secondStart=search(),three=windowCase(21,360000);secondStart.summary._f200Candidates=[{anchor:'X',rank:0,sourcePath:'docs/x.md'},{anchor:'Y',rank:1,sourcePath:'docs/y.md'},{anchor:'DOC-A',rank:2,sourcePath:'docs/a.md'}];const two=correlator.correlateWindow([secondStart,event('Read',1,1,{file_path:'/work/docs/a.md'})])[0];assert.equal(two.consumed[0].rank,2);c.persistBatch([one,two,three]);const report=new RecallMetricsComputer(d).computeMetrics({days:7});assert.equal(report.totalEvents,3);assert.ok(Math.abs(report.core.consumedAt3-2/3)<1e-12);assert.ok(Math.abs(report.core.consumedMRR-4/9)<1e-12);return report.core;});
for(const d of dbs)d.close();
const output={sourceFingerprints:EXPECTED_SOURCES,preflightPassed:true,generatedAt:new Date().toISOString(),sourceCommit:'6868041ca',runtime:process.version,scope:'Original TS imports + selected original SQL/loop snippets; synchronous transaction adapter over Node SQLite :memory:; fixed NN fixtures; no real Redis, embedding, LLM or service startup.',cases:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};
writeFileSync(join(here,'results.json'),JSON.stringify(output,null,2)+'\n','utf8');
console.log(JSON.stringify(output,null,2));
if(output.failed)process.exitCode=1;