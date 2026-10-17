import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultVisorSettings,parseVisorSettings } from '../src/ui/visor';

test('Old browser preferences get the enhanced visor defaults',()=>{
 for(const input of [undefined,null,false,{}])assert.deepEqual(parseVisorSettings(input),defaultVisorSettings());
});
test('Disabled vignette and independent custom coverage survive normalization',()=>{
 assert.deepEqual(parseVisorSettings({strength:0,spread:135}),{strength:0,spread:135,opacity:70});
 assert.deepEqual(parseVisorSettings({strength:120,spread:65,opacity:40}),{strength:120,spread:65,opacity:40});
 assert.equal(defaultVisorSettings().opacity,70,'the frame sprite is 70% opaque by default');
});
test('Malformed visor preferences are repaired independently and constrained to valid ranges',()=>{
 assert.deepEqual(parseVisorSettings({strength:NaN,spread:'120'}),{strength:100,spread:100,opacity:70});
 assert.deepEqual(parseVisorSettings({strength:200,spread:40,opacity:130}),{strength:150,spread:60,opacity:100});
 assert.deepEqual(parseVisorSettings({strength:-1,spread:Infinity}),{strength:0,spread:100,opacity:70});
 assert.deepEqual(parseVisorSettings({strength:122,spread:138}),{strength:120,spread:140,opacity:70});
});
