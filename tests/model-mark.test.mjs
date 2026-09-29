import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../public/frame/model-mark.js';
const icons=JSON.parse(fs.readFileSync(new URL('../public/frame/assets/model-marks/catalog.json',import.meta.url))).icons;
const resolve=text=>globalThis.PhaseModelMark.resolve(text,icons);
test('model ID resolves the supplied icon and semantic version without losing the full ID',()=>{
 for(const [id,icon,version]of [
  ['Astra Opus5.5','claude','5.5'],['Claude Sonnet 4.6','claude','4.6'],
  ['gpt-5.2','openai','5.2'],['Gemini 2.5 Flash','gemini','2.5'],
  ['DeepSeek-V3.2','deepseek','3.2'],['Qwen3-235B','qwen','3'],
  ['glm-4-6','zhipu','4.6'],['MiMo V2','xiaomimimo','2'],
  ['ai21 3.2','ai21','3.2'],['claude-sonnet-4-20250514','claude','4'],
 ]){const mark=resolve(id);assert.equal(mark.icon,icon,id);assert.equal(mark.version,version,id);assert.equal(mark.text,id);}
});
test('empty, unknown and hostile model labels never become arbitrary asset paths',()=>{
 assert.deepEqual(resolve(''),{text:'',icon:null,brand:'',version:'—'});
 assert.equal(resolve('Unknown Research Model 1.2').icon,null);
 assert.equal(resolve('<img src=x onerror=alert(1)>').icon,null);
 assert.equal(resolve('../../fake.svg 3').icon,null);
 assert.equal(resolve('gpt experimental').version,'—');
 assert.ok(resolve('x'.repeat(100)).text.length<=80);
});
test('all imported icons have local assets, full catalog and upstream attribution',()=>{
 assert.equal(icons.length,340);
 for(const icon of icons)assert.ok(fs.existsSync(new URL('../public/frame/assets/model-marks/'+icon.id+'.svg',import.meta.url)),icon.id);
 assert.match(fs.readFileSync(new URL('../public/frame/assets/model-marks/UPSTREAM-LICENSE',import.meta.url),'utf8'),/Copyright \(c\) 2023 LobeHub/);
});
