'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('inbound and outbound share a disabled call-length ceiling (0 means no timer)',()=>{
 const {MAX_CALL_MS}=require('../lib/call-limits');
 assert.equal(MAX_CALL_MS,1200000);
 for(const file of ['sip-handler.js','live-outbound.js']){
  const source=fs.readFileSync(require.resolve('../lib/'+file),'utf8');
  assert.match(source,/require\('\.\/call-limits'\)/);
  assert.doesNotMatch(source,/480000|300000/);
 }
 const sip=fs.readFileSync(require.resolve('../lib/sip-handler.js'),'utf8');
 assert.match(sip,/MAX_CALL_MS/);
 assert.doesNotMatch(sip,/setTimeout\([^\n]*,\s*require\('\.\/call-limits'\)\.MAX_CALL_MS\s*\)/);
});
