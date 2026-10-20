import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup, mergeRecords, classification, matches, sortVideos, syncRecords} from '../site/core.mjs';
const id='abcdefghijk';
test('live synchronization accepts newer completion cancellation',()=>{
  assert.equal(syncRecords({[id]:{completed:true,updated:10}}, {[id]:{completed:false,updated:20}})[id].completed,false);
});
test('reject hostile or malformed backup without changing existing records',()=>{
  assert.throws(()=>validateBackup({schema:1,records:{[id]:{position:-1}}}));
  assert.throws(()=>validateBackup(JSON.parse('{"schema":1,"records":{"__proto__":{}}}')));
  assert.throws(()=>validateBackup({schema:1,records:{[id]:{position:Infinity}}}));
});
test('merge by ID preserves complete and uses newer position',()=>{
  const result=mergeRecords({[id]:{position:20,completed:true,updated:100}}, {[id]:{position:4,completed:false,updated:200,manual:'exclude'}});
  assert.equal(result[id].completed,true);assert.equal(result[id].position,4);assert.equal(result[id].manual,'exclude');
});
test('local manual decision overrides shared and auto labels',()=>{
  assert.equal(classification({id,suggested:'exclude',manual:'review'},{[id]:{manual:'include'}}),'include');
  assert.equal(classification({id,suggested:'exclude',manual:'review'},{[id]:{manual:'auto'}}),'exclude');
});
test('backfilled earlier ID remains unwatched independently of last position',()=>{
  const rows=sortVideos([{id:'b'.repeat(11),published_utc:'2024-01-01T00:00:00Z'},{id,published_utc:'2023-01-01T00:00:00Z'}]);
  assert.equal(rows[0].id,id);
  assert.equal(matches({...rows[0],suggested:'include',channel:'test'}, {}, {mode:'unwatched',channel:'',query:''}),true);
});
