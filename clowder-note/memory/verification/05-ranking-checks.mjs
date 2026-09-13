/**
 * 第 05 章：76 个排序断言的独立、离线复现脚本。
 *
 * 运行要求：Node.js 24+（本任务实际使用 v24.14.0），只使用 Node 内置模块。
 * 运行：node --disable-warning=ExperimentalWarning "D:/AI/clower-1/clowder-note/memory/verification/05-ranking-checks.mjs"
 * 输出：仅覆盖本脚本同目录的 05-ranking-results.json。
 *
 * 验证方式与先前通过标准输入执行的 76 个断言相同：
 * - 从提交 6868041ca 的 TypeScript 源码按已核对行号抽取实际函数/方法主体；
 *   仅在内存中移除类型、import/export 和类方法声明外壳，不修改源码。
 * - 使用固定六篇教学资料，以及 2026-09-12/2026-09-19 UTC 00:00 的模拟时钟。
 * - 数据库是只返回 fixture 统计的 JavaScript 桩，不创建或连接 SQLite/Redis。
 * - embedding/NN 返回由桩提供；不访问网络、不启动 HTTP 服务或子进程。
 * - 路由只抽取 salience 的选择表达式，不执行完整 HTTP handler。
 * - 这不是真实 FTS、真实向量检索、完整应用集成或性能基准。
 *
 * 本次持久化只增加 ESM 文件外壳、源码指纹预检和 JSON 结果写出；
 * 不增加、删除或替换原有 76 个断言。指纹和断言总数护栏不计入 76 项。
 * 指纹按 LF 归一化文本计算，允许 CRLF/LF 差异，拒绝其他源码漂移，
 * 避免固定行号在另一版源码中静默抽取到错误内容。
 * 不读写同目录的 memory-walkthrough-checks.mjs 或 results.json。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(HERE, '../../../clowder-ai/packages/api/src');
const OUTPUT_PATH = path.join(HERE, '05-ranking-results.json');
const SOURCE_BASELINE = '6868041cae3b9dcab163a1fd85845b9778c3adc5';
const EXPECTED_CHECKS = 76;
const EXPECTED_SOURCE_HASHES = {
  'domains/memory/f163-types.ts': 'bc331b8d76a858b2cdd821d64b49943159c422c393be67fc6092e17ccb6e1069',
  'domains/memory/consumption-prior.ts': '45a927fda52b80f0d6f57694ac069e3501368c6819119075cda5a554cd6529e1',
  'domains/memory/recency-decay.ts': '38a19f1f6ab29b07336efbc878c1c693f1358e5ebb70be06da218162c43752d7',
  'domains/memory/mmr.ts': '8b8b395472a7c557cf4592b8268b07bcf7c4691005082b6f2d5c4fb466faa29e',
  'domains/memory/lexical-backfill.ts': '6033f8a158a5cdb75079e8913e86262a53a25ec3e1e4a90c87f14e4c6ab9c4cc',
  'domains/memory/f200-types.ts': '61d59fcdd5fb45e4b6a312202359e0551ba934cb9c75edb409933a1c58378cad',
  'domains/memory/SqliteEvidenceStore.ts': 'a4b61f70b8ad42708791ecdf4078ae4ce403aebbe2f340b778fbba584ba3c70e',
  'routes/evidence.ts': 'f2672014795f8999f128fd1ebd3f79e7d813bd7564f2be6ce1d6e6d9f90008b8',
};

const checks = [];
const sourceHashes = {};
const sourceTexts = new Map();
const startedAt = new Date().toISOString();

async function runValidation() {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('This reproduction requires Node.js 24 or later. No dependencies are downloaded.');
  }

  // Preflight only: these checks protect extraction, not additional ranking assertions.
  for (const [relative, expected] of Object.entries(EXPECTED_SOURCE_HASHES)) {
    const text = fs.readFileSync(path.join(SOURCE_ROOT, relative), 'utf8');
    const hash = createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
    sourceHashes[relative] = hash;
    if (hash !== expected) {
      throw new Error(`Source drift: ${relative}; expected ${expected}, got ${hash}. Do not silently reuse line ranges.`);
    }
    sourceTexts.set(relative, text);
  }

  const read = relative => {
    const text = sourceTexts.get(relative);
    if (text === undefined) throw new Error(`Source not covered by fingerprint preflight: ${relative}`);
    return text;
  };
  const store = read('domains/memory/SqliteEvidenceStore.ts').split(/\r?\n/);
  const range = (lines, a, b) => lines.slice(a - 1, b).join('\n');
  const names = ['f163-types.ts', 'consumption-prior.ts', 'recency-decay.ts', 'mmr.ts', 'lexical-backfill.ts'];

  // Same source fragments and adapters as the original stdin-based execution.
  let ts = names.map(name => read('domains/memory/' + name)).join('\n');
  ts += '\n' + range(read('domains/memory/f200-types.ts').split(/\r?\n/), 94, 98);
  ts += '\n' + range(store, 38, 41) + '\n' + range(store, 1921, 2175);
  ts += '\n' + range(store, 1049, 1071).replace('  private rankRawResults(', 'function rankRawResults(');
  ts += '\n' + range(store, 1077, 1129).replace('  private enrichWithDrillDown(', 'function enrichWithDrillDown(');
  ts += '\n' + range(store, 1230, 1329).replace('  private async hybridRRFSearch(', 'async function hybridRRFSearch(');
  ts += '\nfunction fixtureScore(rerankPool, db) {\n'
    + 'const anchorMetrics = loadAnchorMetrics(db, rerankPool.map(r=>r.anchor));\n'
    + 'const globalMeanCtr=loadGlobalCtrBaseline(db);\n'
    + range(store, 2059, 2085)
    + '\nreturn scored;\n}';
  const route = read('routes/evidence.ts').split(/\r?\n/);
  ts += '\nfunction fixtureRoute(items, salienceCtx) { const f163Flags=freezeFlags();\n'
    + range(route, 248, 252) + '\nreturn reranked;\n}';
  ts = ts.replace(/^import\b[\s\S]*?;\s*$/gm, '');
  let js = stripTypeScriptTypes(ts, { mode: 'strip' })
    .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/g, '')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');
  const exported = [
    'freezeFlags', 'freezeF200Flags', 'computeConsumptionPrior', 'computeRecencyDecay',
    'applyMMR', 'keywordSimilarity', 'applyAuthorityBoost', 'applyConsumptionRerank',
    'lookupShadowRanking', 'findExactLexicalProtectedAnchors', 'annotateMatchReasons',
    'rankRawResults', 'enrichWithDrillDown', 'hybridRRFSearch', 'salience',
    'applySalienceRerank', 'rankToConfidence', 'fixtureScore', 'fixtureRoute',
  ];
  js += '\nglobalThis.api={' + exported.join(',') + '};';

  const day = 86400000;
  const date = s => Date.parse(s + 'T00:00:00Z');
  let clock = date('2026-09-12');
  const env = {}; // Only the VM receives this object; the host process.env is not changed.
  const context = vm.createContext({
    process: { env },
    Date: class extends Date { static now() { return clock; } },
    createHash,
  });
  new vm.Script(js, { filename: 'source-ranking-in-memory.js' }).runInContext(context);
  const api = context.api;

  // Fixed teaching data: timestamps and statistics are not read from production.
  const docs = [
    {
      id: 'A', anchor: 'F163-cache-guide', kind: 'feature', authority: 'validated', activation: 'query',
      title: '缓存失效处理规范', summary: '缓存失效时先核对版本。', keywords: ['cache', 'ttl', 'F163'],
      updatedAt: '2026-06-14', first: '2026-07-01', c: 8, n: 30, last: '2026-09-12',
    },
    {
      id: 'B', anchor: 'doc:popular-cache', kind: 'feature', authority: 'observed', activation: 'query',
      title: 'Redis 缓存维护', summary: '容量和过期参数的维护记录。', keywords: ['cache', 'ttl'],
      updatedAt: '2026-09-12', first: '2026-07-01', c: 20, n: 30, last: '2026-09-12',
    },
    {
      id: 'C', anchor: 'doc:queue-plan', kind: 'plan', authority: 'candidate', activation: 'scoped',
      title: '异步队列重试方案', summary: 'cache 写入失败后转向队列重试。', keywords: ['queue', 'retry', 'F163'],
      updatedAt: '2026-07-29', first: '2026-07-01', c: 0, n: 10, last: '2026-07-29',
    },
    {
      id: 'D', anchor: 'doc:cache-lesson', kind: 'lesson', authority: 'constitutional', activation: 'always_on',
      title: '缓存设计守则', summary: '缓存系统的长期规则。', keywords: ['cache', 'ttl'],
      updatedAt: '2026-09-05', first: '2026-09-05', c: 0, n: 30, last: null,
    },
    {
      id: 'E', anchor: 'doc:old-cache', kind: 'feature', authority: 'observed', activation: 'query',
      title: '早期缓存草案', summary: '已经过时的缓存探索。', keywords: ['cache', 'ttl'],
      updatedAt: '2026-03-16', first: '2026-07-01', c: 0, n: 50, last: '2026-06-14',
    },
    {
      id: 'F', anchor: 'thread-cache', kind: 'thread', authority: 'observed', activation: 'query',
      title: '缓存参数讨论', summary: '讨论缓存参数。', keywords: ['cache', 'ttl'],
      updatedAt: '2026-08-29', first: '2026-07-01', c: 1, n: 1, last: '2026-09-12',
    },
  ].map(d => ({ ...d, status: 'active', updatedAt: d.updatedAt + 'T00:00:00Z', firstIndexedAt: date(d.first) }));

  const clone = order => [...order].map(id => structuredClone(docs.find(d => d.id === id)));
  const ids = arr => Array.from(arr, x => x.id).join('');
  const shortAnchor = anchor => docs.find(d => d.anchor === anchor)?.id ?? anchor;
  const stats = d => ({
    anchor: d.anchor,
    consumed_count_30d: d.c,
    exposure_count_30d: d.n,
    dormancy_days: d.last == null ? null : Math.floor((clock - date(d.last)) / day),
  });

  let reads = 0;
  const db = {
    prepare(sql) {
      reads++;
      if (sql.startsWith('SELECT * FROM anchor_recall_metrics')) {
        return { all(...anchors) { return docs.filter(d => anchors.includes(d.anchor)).map(stats); } };
      }
      if (sql === 'SELECT doc_kind, mean_ctr FROM global_ctr_baseline') {
        return { all() { return ['feature', 'plan', 'lesson', 'thread'].map(doc_kind => ({ doc_kind, mean_ctr: 0.2 })); } };
      }
      throw new Error('Unexpected DB request: ' + sql);
    },
  };

  const eq = (actual, expected, label) => {
    assert.deepEqual(actual, expected, label);
    checks.push(label);
  };
  const near = (actual, expected, label) => {
    assert.ok(Math.abs(actual - expected) < 1e-12, label + ': ' + actual + ' != ' + expected);
    checks.push(label);
  };
  const pop = (items, limit) => api.lookupShadowRanking(items.slice(0, limit ?? items.length).map(d => d.anchor));
  const priorOf = d => api.computeConsumptionPrior({
    consumedCount30d: d.c,
    exposureCount30d: d.n,
    daysSinceLastConsumed: stats(d).dormancy_days,
    docKind: d.kind,
    authority: d.authority,
    firstIndexedAt: d.firstIndexedAt,
  }, { feature: 0.2, plan: 0.2, lesson: 0.2, thread: 0.2 });
  const scoreRows = items => Array.from(api.fixtureScore(items, db), s => ({
    id: s.item.id,
    i: s.originalIndex,
    prior: priorOf(s.item).prior,
    branch: priorOf(s.item).branch,
    age: (clock - Date.parse(s.item.updatedAt)) / day,
    decay: api.computeRecencyDecay((clock - Date.parse(s.item.updatedAt)) / day, s.item.kind).factor,
    S: s.newScore,
    pinned: s.isConstitutional,
  }));
  const ctx = { activeFeatureIds: ['F163'], truthSourceRef: 'F163-cache-guide', recentArtifactRefs: ['doc:queue-plan'] };

  // 01-06: defaults and authority. Assertion labels/order are unchanged.
  eq(api.freezeFlags().authorityBoost, 'off', 'authority default off');
  eq(api.freezeFlags().retrievalRerank, 'off', 'salience default off');
  eq(api.freezeF200Flags().consumptionRerank, 'off', 'consumption default off');
  let a = clone('ABCDEF');
  api.applyAuthorityBoost(a, 'cache');
  eq(ids(a), 'ABCDEF', 'authority off');
  env.F163_AUTHORITY_BOOST = 'shadow';
  api.applyAuthorityBoost(a, 'cache');
  eq(ids(a), 'ABCDEF', 'authority shadow');
  env.F163_AUTHORITY_BOOST = 'on';
  api.applyAuthorityBoost(a, 'cache');
  eq(ids(a), 'DACBEF', 'authority on');

  const priors = Object.fromEntries(docs.map(d => [d.id, priorOf(d)]));
  near(priors.B.shrunkCtr, 0.55, 'B shrunk CTR');
  near(priors.B.prior, 0.35, 'B prior');
  near(priors.E.prior, -1 / 12, 'E negative prior');
  near(priors.C.rawLift, -0.05, 'C negative rawLift');
  near(priors.C.prior, 0, 'C low sample clamp');
  eq(priors.C.branch, 'low-sample', 'C branch');
  near(priors.F.shrunkCtr, 3 / 11, 'F one of one shrink');
  eq(priors.F.branch, 'cold-start', 'F insufficient exposure');
  eq(priors.D.branch, 'cold-start', 'D seven-day grace precedes constitution');
  near(priors.D.shrunkCtr, 0, 'D grace diagnostics zero');
  near(api.computeRecencyDecay(90, 'feature').factor, 0.5, 'feature half-life');
  near(api.computeRecencyDecay(180, 'feature').factor, 1 / 3, 'fractional not exponential');
  near(api.computeRecencyDecay(500, 'lesson').factor, 1, 'lesson no age decay');
  near(api.computeRecencyDecay(45, 'unknown').factor, 0.5, 'unknown half-life');

  const input = clone('DACBEF');
  const mainScores = scoreRows(input);
  const wantScores = { D: 1 / 60 + 0.05, A: 1 / 61 + 0.0075, C: 1 / 62, B: 1 / 63 + 0.1025, E: 1 / 64 - 0.0125 - 1 / 60, F: 1 / 65 };
  for (const row of mainScores) near(row.S, wantScores[row.id], 'main score ' + row.id);
  env.F200_CONSUMPTION_RERANK = 'off';
  let live = clone('DACBEF');
  api.applyConsumptionRerank(live, db, undefined, 'cache');
  eq(ids(live), 'DACBEF', 'F200 off');
  env.F200_CONSUMPTION_RERANK = 'on';
  live = clone('DACBEF');
  api.enrichWithDrillDown.call({ db }, live, undefined, { explain: true }, 'cache');
  eq(ids(live), 'BDACFE', 'main store order');
  eq(Array.from(pop(live), r => shortAnchor(r.anchor)).join(''), 'DACBEF', 'on stores prior order');

  env.F163_RETRIEVAL_RERANK = 'off';
  eq(ids(api.fixtureRoute(live, ctx).items), 'BDACFE', 'route off');
  env.F163_RETRIEVAL_RERANK = 'shadow';
  eq(ids(api.fixtureRoute(live, ctx).items), 'BDACFE', 'route shadow');
  env.F163_RETRIEVAL_RERANK = 'on';
  const routed = api.fixtureRoute(live, ctx).items;
  eq(ids(routed), 'DACBFE', 'route on');
  eq(Array.from(routed, d => d.rankingFactors.bm25Score).join(','), '2,3,4,1,5,6', 'explain retains store ranks');
  eq(Array.from(routed, (_, i) => api.rankToConfidence(i)).join(','), 'high,high,mid,mid,mid,low', 'confidence ranks');
  near(api.salience(docs[0], ctx), 0.9, 'A salience');
  near(api.salience(docs[2], ctx), 0.75, 'C salience');
  near(api.salience(docs[3], ctx), 1, 'D always_on salience');
  eq(ids(api.applySalienceRerank(clone('BAC'), { activeFeatureIds: [], truthSourceRef: null, recentArtifactRefs: [] }).items), 'BAC', 'no context stable order');

  // Named query and the same document crossing the first-14-day boundary.
  let named = clone('ECDBAF');
  api.applyAuthorityBoost(named, '缓存 失效');
  eq(ids(named), 'ECDBAF', 'named query skips all authority');
  eq(Array.from(api.findExactLexicalProtectedAnchors(named, '缓存 失效'), shortAnchor).join(''), 'A', 'only A protected');
  api.applyConsumptionRerank(named, db, undefined, '缓存 失效');
  eq(ids(named), 'ABDCFE', 'protected at seven-day grace');
  pop(named);
  clock = date('2026-09-19');
  const pinScores = scoreRows(clone('ECDBF'));
  const p14 = priorOf(docs[3]);
  eq(p14.branch, 'constitutional', 'exact fourteen days exits grace');
  near(p14.shrunkCtr, 0.05, 'D CTR after grace');
  near(p14.recencyFactor, 0.5, 'never-consumed lesson factor half');
  near(p14.rawLift, -0.075, 'D negative lift after grace');
  near(p14.prior, 0, 'D constitutional prior clamp');
  named = clone('ECDBAF');
  api.applyConsumptionRerank(named, db, undefined, '缓存 失效');
  eq(ids(named), 'ABCDFE', 'local pinned slot plus protected prefix');
  eq(named.findIndex(d => d.id === 'D'), 3, 'D global position changes despite pinned local index two');
  pop(named);
  clock = date('2026-09-12');
  const small = clone('AB');
  api.applyConsumptionRerank(small, db, undefined, '缓存 失效');
  eq(ids(small), 'A', 'protected early-return removes one nonprotected');
  pop(small);

  // Hybrid calls the real extracted method, but NN returns a given rank order.
  const nn = 'BACDFE';
  const hybridThis = {
    db,
    embedDeps: {
      embedding: { embed: async () => [[0]] },
      vectorStore: { search: () => clone(nn).map(d => ({ anchor: d.anchor, distance: 0 })) },
    },
  };
  const hybrid = await api.hybridRRFSearch.call(hybridThis, 'cache', clone('DACBEF'), 6, {});
  eq(ids(hybrid), 'ADBCEF', 'actual hybrid RRF with supplied NN ranks');
  const hybridScores = scoreRows(hybrid);
  let h = structuredClone(hybrid);
  api.applyConsumptionRerank(h, db, 2, 'cache');
  eq(ids(h), 'BC', 'hybrid six movable triggers MMR');
  eq(Array.from(pop(h, 2), r => shortAnchor(r.anchor)).join(''), 'ADBCEF', 'hybrid on shadow pre-F200 RRF');
  eq(ids(api.fixtureRoute(h, ctx).items), 'CB', 'salience after MMR');

  const scored = hybridScores.map(row => ({ item: docs.find(d => d.id === row.id), score: row.S })).sort((x, y) => y.score - x.score);
  const firstRound = scored.map(s => ({ id: s.item.id, score: 0.7 * s.score }));
  const secondRound = scored.filter(s => s.item.id !== 'B').map(s => ({
    id: s.item.id,
    J: api.keywordSimilarity(s.item, docs[1]),
    score: 0.7 * s.score - 0.3 * api.keywordSimilarity(s.item, docs[1]),
  }));
  eq(ids(api.applyMMR(scored, 2)), 'BC', 'pure MMR matches Store');
  near(api.keywordSimilarity(docs[0], docs[1]), 2 / 3, 'A B Jaccard');
  near(api.keywordSimilarity(docs[2], docs[1]), 0, 'C B Jaccard');
  near(api.keywordSimilarity({ keywords: [] }, { keywords: [] }), 0, 'empty keywords similarity zero');
  near(api.keywordSimilarity({ keywords: ['Cache'] }, { keywords: ['cache'] }), 0, 'keywords case-sensitive');
  eq(ids(api.applyMMR(scored.slice(0, 5), 2)), ids(scored.slice(0, 2).map(s => s.item)), 'MMR below threshold slices input');

  env.F200_CONSUMPTION_RERANK = 'shadow';
  h = structuredClone(hybrid);
  api.enrichWithDrillDown.call({ db }, h, 2, { explain: true }, 'cache');
  eq(ids(h), 'AD', 'shadow live truncation');
  eq(Array.from(pop(h, 2), r => shortAnchor(r.anchor)).join(''), 'BC', 'shadow records would-be MMR');
  eq(ids(api.fixtureRoute(h, ctx).items), 'DA', 'salience can reorder F200 shadow live');
  env.F200_CONSUMPTION_RERANK = 'on';
  clock = date('2026-09-19');
  h = structuredClone(hybrid);
  api.enrichWithDrillDown.call({ db }, h, 2, {}, 'cache');
  eq(ids(h), 'BD', 'one pinned leaves only five movable so no MMR');
  pop(h, 2);
  clock = date('2026-09-12');

  // Raw tests begin at the hydrated passage boundary, not at a real passage search.
  let raw = clone('ABCDEF');
  raw.find(d => d.id === 'F').passages = [{ passageId: 'msg-f1', content: 'cache 参数', threadId: 'cache', messageId: 'f1' }];
  raw = api.rankRawResults(raw, 6, new Map([[docs[5].anchor, 0]]));
  eq(ids(raw), 'FABCDE', 'raw passage first');
  api.enrichWithDrillDown.call({ db }, raw, undefined, { explain: true }, 'cache');
  eq(ids(raw), 'BDAFCE', 'raw consumption after passage rank');
  pop(raw);
  eq(ids(api.fixtureRoute(raw, ctx).items), 'DACBFE', 'raw route last');

  const failure = clone('DACBEF');
  api.enrichWithDrillDown.call({ db: { prepare() { throw new Error('injected read failure'); } } }, failure, undefined, { explain: true }, 'cache');
  eq(ids(failure), 'DACBEF', 'metric read failure preserves existing order');
  eq(failure[0].rankingFactors.bm25Score, 1, 'explain still attached after read failure');
  const absent = clone('ABCDEF');
  const emptyDb = { prepare() { return { all() { return []; } }; } };
  api.applyConsumptionRerank(absent, emptyDb, undefined, 'cache');
  eq(ids(absent), 'BDACFE', 'no statistics still changes order by age');
  pop(absent);
  eq(Number.isNaN(api.computeRecencyDecay(Number.NaN, 'feature').factor), true, 'invalid age yields NaN without throw');

  const base = { consumedCount30d: 0, exposureCount30d: 20, daysSinceLastConsumed: 0, docKind: 'feature', authority: 'validated', firstIndexedAt: 0 };
  eq(api.computeConsumptionPrior(base, {}).branch, 'full', 'validated feature not immune');
  eq(api.computeConsumptionPrior({ ...base, exposureCount30d: 4 }, {}).branch, 'cold-start', 'four exposures');
  eq(api.computeConsumptionPrior({ ...base, exposureCount30d: 5 }, {}).branch, 'low-sample', 'five exposures');
  eq(api.computeConsumptionPrior({ ...base, exposureCount30d: 19 }, {}).branch, 'low-sample', 'nineteen exposures');
  eq(api.computeConsumptionPrior({ ...base, docKind: 'decision', authority: 'observed' }, {}).branch, 'constitutional', 'observed decision immune');
  eq(api.computeConsumptionPrior({ ...base, firstIndexedAt: clock - 14 * day + 1, authority: 'constitutional' }, {}).branch, 'cold-start', 'one millisecond inside grace beats constitution');

  // Guard the original assertion count without claiming an extra ranking check.
  if (checks.length !== EXPECTED_CHECKS) {
    throw new Error(`Assertion count drift: expected ${EXPECTED_CHECKS}, got ${checks.length}.`);
  }
  return {
    mainScores, priors, pinScores, hybridScores, firstRound, secondRound,
    readOnlyStubQueries: reads,
    fixture: {
      documents: docs,
      taskContext: ctx,
      clocks: ['2026-09-12T00:00:00Z', '2026-09-19T00:00:00Z'],
      lexicalOrder: 'ABCDEF',
      suppliedNnOrder: nn,
      namedQueryInput: 'ECDBAF',
      baselineByKind: { feature: 0.2, plan: 0.2, lesson: 0.2, thread: 0.2 },
    },
  };
}

let result;
try {
  result = { status: 'passed', failures: [], ...await runValidation() };
} catch (error) {
  // Replace a stale success report with the current failure; a failing run exits nonzero.
  result = {
    status: 'failed',
    failures: [{ name: error?.name ?? 'Error', message: String(error?.message ?? error), stack: error?.stack ?? null }],
  };
  process.exitCode = 1;
}

const report = {
  schemaVersion: 1,
  chapter: '05-搜索结果重排算法',
  sourceBaselineCommit: SOURCE_BASELINE,
  sourceRoot: SOURCE_ROOT,
  sourceFingerprintEncoding: 'SHA-256 over UTF-8 text with CRLF normalized to LF',
  sourceHashes,
  nodeVersion: process.version,
  startedAt,
  completedAt: new Date().toISOString(),
  expectedChecks: EXPECTED_CHECKS,
  checks: checks.length,
  passed: checks,
  validationScope: {
    execution: 'Extracted source functions/methods and route salience expression in an in-memory VM',
    statistics: 'Read-only JavaScript fixture stubs; no SQLite/Redis connection or files',
    retrieval: 'Given lexical/NN ranks and hydrated passage fixture; no real FTS/vector/embedding request',
    clock: 'Fixed simulated UTC clocks; host process.env and host clock are not changed',
    notCovered: ['Full HTTP handler', 'Real databases/services', 'Real recall quality', 'Performance benchmarks'],
    preflight: 'Source fingerprints and the expected total protect reproducibility; not part of the 76 ranking assertions',
  },
  ...result,
};
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ status: report.status, checks: report.checks, expectedChecks: EXPECTED_CHECKS, failures: report.failures.length, output: OUTPUT_PATH }, null, 2));
if (report.status !== 'passed') console.error(report.failures[0].message);
