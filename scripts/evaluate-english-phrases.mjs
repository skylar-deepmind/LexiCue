#!/usr/bin/env node
/** Ground truth is consumed only here, never by the extraction pipeline. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import ts from 'typescript';
const flags = process.argv.slice(2);
const get = name => { const i = flags.indexOf(name); return i < 0 ? null : flags[i+1]; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = get('--fixture') ? path.resolve(get('--fixture')).replace(/\.srt$/, '') : path.join(root, 'src-tauri/tests/fixtures/english-phrase-quality-v1');
const gold = JSON.parse(fs.readFileSync(`${fixture}.gold.json`, 'utf8'));
const manifest=JSON.parse(fs.readFileSync(`${fixture}.manifest.json`, 'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(hash(`${fixture}.gold.json`)!==manifest.gold_sha256)throw Error('Gold differs from frozen manifest');
if(hash(path.join(root,'src-tauri/resources/english-expression-core.json'))!==manifest.core_sha256)throw Error('Expression core differs from frozen manifest; do not tune on holdout answers');
const srt = fs.readFileSync(`${fixture}.srt`, 'utf8');
if (crypto.createHash('sha256').update(srt).digest('hex') !== gold.srt_sha256) throw Error('Fixture hash differs from frozen annotations');
registerHooks({
  resolve(specifier,context,next) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/src/')) {
      const target = new URL(specifier, context.parentURL);
      if (!path.extname(target.pathname) && fs.existsSync(fileURLToPath(target)+'.ts')) return {url:target.href+'.ts',shortCircuit:true};
    }
    return next(specifier,context);
  },
  load(url,context,next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return {format:'module',source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,shortCircuit:true};
    return next(url,context);
  }
});
const { parseFile } = await import(new URL('../src/lib/parser.ts',import.meta.url));
const parsed = parseFile(srt, 'srt', 'auto', 'en');
if (parsed.segments.length !== gold.rows.length) { for (let i=0;i<parsed.segments.length;i++) if(parsed.segments[i].en_text!==gold.rows[i].text) {console.error(JSON.stringify({i,actual:parsed.segments[i].en_text,expected:gold.rows[i].text}));break;} }
if (parsed.segments.length !== gold.rows.length) throw Error(`Product parser produced ${parsed.segments.length}, expected ${gold.rows.length}`);
for (const row of gold.rows) {
  if (parsed.segments[row.segment_index].en_text !== row.text) throw Error(`Product parser text mismatch at cue ${row.cue}`);
  for (const a of row.annotations) if (row.text.slice(a.char_start,a.char_end) !== a.surface) throw Error(`Annotation span mismatch at cue ${row.cue}: ${a.canonical}`);
}
if (get('--export-native')) fs.writeFileSync(get('--export-native'), JSON.stringify(parsed.segments.map(s => [s.index,s.en_text])));
const log = get('--results');
if (!log) {
  console.log(JSON.stringify({fixtureValid:true,cues:gold.cues,words:gold.words,durationSeconds:gold.duration_seconds,requiredOccurrences:gold.rows.flatMap(r=>r.annotations).filter(a=>a.requirement==='must_include').length},null,2));
  process.exit(0);
}
const raw = fs.readFileSync(log,'utf8');
const line = raw.split('\n').findLast(l=>l.includes('SUBTITLE_GEMMA_REPORT=') || l.includes('QUALITY_GEMMA_REPORT='));
const report = line ? JSON.parse(line.slice(line.indexOf('REPORT=')+7)) : JSON.parse(raw);
if(report.sourceRows)for(const [index,text] of report.sourceRows) {
  if(gold.rows.find(r=>r.segment_index===index)?.text!==text)throw Error(`Analyzed source differs from frozen fixture at segment ${index}`);
}
const items = report.items ?? [];
const subsetFile=get('--native-fixture');
const subset=subsetFile?new Set(JSON.parse(fs.readFileSync(subsetFile,'utf8')).map(([index])=>index)):report.segmentIndices?new Set(report.segmentIndices):null;
const normalize = s => s.toLowerCase().replace(/\s+/g,' ').trim();
const aliases = {"pull her leg":"pull someone's leg",'give a heads up':'give someone a heads up','fill in':'fill someone in','what up':'what is up',"what's up":'what is up','make your day':'make my day','make my day':"make someone's day"};
const canonical = s => aliases[normalize(s)] ?? normalize(s);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const headwordMatches=(p,a)=>canonical(p.canonical)===canonical(a.canonical)||(a.allowed_canonicals??[]).some(c=>canonical(c)===canonical(p.canonical));
const positionsMatch=(p,a)=>same(p.token_positions,a.token_positions)||(a.acceptable_token_positions??[]).some(pos=>same(p.token_positions,pos));
function score(split) {
  const rows=gold.rows.filter(r=>(!split || r.split===split) && (!subset || subset.has(r.segment_index))); const byIndex=new Map(rows.map(r=>[r.segment_index,r]));
  const predictions=items.filter(i=>byIndex.has(i.segment_index));
  let required=0, hit=0, good=0, exact=0, types=0, slangRequired=0, slangHit=0, tagGood=0, tagTotal=0, emittedTags=0, unverifiedTags=0;
  const misses=[], falsePositives=[], boundaryErrors=[], categoryErrors=[], negativeHits=[];
  const matched=new Map();
  for(const row of rows) for(const a of row.annotations.filter(a=>a.requirement==='must_include')) {
    required++;const informal=a.register_tags.some(t=>['informal','slang'].includes(t));if(informal)slangRequired++;
    const found=predictions.some(p=>p.segment_index===row.segment_index && headwordMatches(p,a) && positionsMatch(p,a));
    if(found){hit++;if(informal)slangHit++;}else misses.push({cue:row.cue,canonical:a.canonical,positions:a.token_positions});
  }
  for(const p of predictions) {
    const row=byIndex.get(p.segment_index);
    const candidates=row.annotations.filter(a=>a.requirement!=='must_reject' && headwordMatches(p,a));
    const a=candidates.find(a=>positionsMatch(p,a))??candidates[0];
    if(a){
      good++;matched.set(p,a);
      if(positionsMatch(p,a))exact++;else boundaryErrors.push({cue:row.cue,canonical:p.canonical,actual:p.token_positions,expected:a.token_positions});
      if(a.allowed_categories.includes(p.category))types++;else categoryErrors.push({cue:row.cue,canonical:p.canonical,actual:p.category,allowed:a.allowed_categories});
    }else falsePositives.push({cue:row.cue,canonical:p.canonical,positions:p.token_positions});
    if(row.annotations.some(a=>a.requirement==='must_reject' && headwordMatches(p,a)))negativeHits.push({cue:row.cue,canonical:p.canonical});
    // Incorrect predictions' labels count as incorrect too; do not hide their
    // invented regions behind a register score calculated on true positives only.
    const meta=p.metadata??{};
    for(const key of ['register_tags','regions','cautions'])for(const tag of meta[key]??[]){emittedTags++;if(a?.register_verified===false){unverifiedTags++;continue;}tagTotal++;if(a?.[key]?.includes(tag))tagGood++;}
  }
  const ratio=(a,b)=>b?+(a/b).toFixed(4):null;
  const requiredExpressions=new Set(rows.flatMap(r=>r.annotations.filter(a=>a.requirement==='must_include').map(a=>canonical(a.canonical))));
  const hitExpressions=new Set(predictions.filter(p=>matched.has(p)).map(p=>canonical(matched.get(p).canonical)));
  const predictedExpressions=new Set(predictions.map(p=>canonical(p.canonical)));
  return {predictions:predictions.length,required,hit,uniqueExpressionRecall:ratio([...requiredExpressions].filter(c=>hitExpressions.has(c)).length,requiredExpressions.size),uniqueExpressionPrecision:ratio(hitExpressions.size,predictedExpressions.size),occurrencePrecision:ratio(exact,predictions.length),precision:ratio(good,predictions.length),recall:ratio(hit,required),boundaryAccuracy:ratio(exact,good),categoryAccuracy:ratio(types,good),informalRecall:ratio(slangHit,slangRequired),registerPrecision:ratio(tagGood,tagTotal),tagVerificationCoverage:ratio(tagTotal,emittedTags),emittedTags,unverifiedTags,misses,falsePositives,boundaryErrors,categoryErrors,negativeHits};
}

const output={fixtureHash:gold.srt_sha256,model:report.model,elapsedMs:report.elapsedMs,overall:score(),development:score('development'),holdout:score('holdout')};
if(get('--output'))fs.writeFileSync(get('--output'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));

if(flags.includes('--assert')) {
  const failures=[];
  const strict=get('--profile')==='strict';
  const minimum=strict?{precision:.90,recall:.85,holdout:.80,informal:.80,category:.90,register:.95}:{precision:.80,recall:.80,holdout:.75,informal:.80,category:.85,register:.85};
  const requireMetric=(name,value,min)=>{if(value==null||value<min)failures.push(`${name}: ${value} < ${min}`);};
  requireMetric('precision',output.overall.precision,minimum.precision);
  requireMetric('recall',output.overall.recall,minimum.recall);
  requireMetric('holdout recall',output.holdout.recall,minimum.holdout);
  requireMetric('informal/slang recall',output.overall.informalRecall,minimum.informal);
  requireMetric('boundary accuracy',output.overall.boundaryAccuracy,.98);
  requireMetric('category accuracy',output.overall.categoryAccuracy,minimum.category);
  requireMetric('register precision',output.overall.registerPrecision,minimum.register);
  if(output.overall.negativeHits.length){
    const message=`${output.overall.negativeHits.length} forbidden-context predictions (already penalized in precision)`;
    if(strict)failures.push(message);else console.error(`Review: ${message}`);
  }
  if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
}
