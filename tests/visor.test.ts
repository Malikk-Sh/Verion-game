import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultVisorSettings,parseVisorSettings } from '../src/ui/visor';

test('Old browser preferences get the enhanced visor defaults',()=>{
 for(const input of [undefined,null,false,{}])assert.deepEqual(parseVisorSettings(input),defaultVisorSettings());
});
test('Disabled vignette and independent custom coverage survive normalization',()=>{
 assert.deepEqual(parseVisorSettings({strength:0,spread:135}),{strength:0,spread:135});
 assert.deepEqual(parseVisorSettings({strength:120,spread:65}),{strength:120,spread:65});
});
test('Malformed visor preferences are repaired independently and constrained to valid ranges',()=>{
 assert.deepEqual(parseVisorSettings({strength:NaN,spread:'120'}),{strength:100,spread:100});
 assert.deepEqual(parseVisorSettings({strength:200,spread:40}),{strength:150,spread:60});
 assert.deepEqual(parseVisorSettings({strength:-1,spread:Infinity}),{strength:0,spread:100});
 assert.deepEqual(parseVisorSettings({strength:122,spread:138}),{strength:120,spread:140});
});
