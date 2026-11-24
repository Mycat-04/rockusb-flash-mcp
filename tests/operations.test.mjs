import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {checkCardSize} from '../sd.mjs';
import {parseStorage,partitionTable,usbCommand} from '../operations.mjs';
import {components} from '../scripts/setup-windows.mjs';

test('only one current storage is accepted, including output from ConPTY',()=>{
  assert.deepEqual(parseStorage('No=1 FLASH\r\nNo=2\x1b[4CEMMC(*)'),[
    {number:1,name:'FLASH',current:false},{number:2,name:'EMMC',current:true}]);
  assert.throws(()=>parseStorage('No=1 FLASH\nNo=2 EMMC'));
  assert.throws(()=>parseStorage('No=1 FLASH(*)\nNo=2 EMMC(*)'));
});
test('partition readback uses the start and count from the device',()=>{
  const [part]=partitionTable('01 0x00008000 0x00002000 boot\r\n');
  assert.deepEqual(part,{name:'boot',start:32768,sectors:8192});
  assert.deepEqual(usbCommand({operation:'backup_partition',partition:part},null,'job').args,['rl','0x8000','0x2000',path.join('job','partition.img')]);
});
test('update-card FAT32 limit is distinct from host USB and boot card',()=>{
  assert.throws(()=>checkCardSize('upgrade',2**32,64*2**30),/FAT32/);
  assert.doesNotThrow(()=>checkCardSize('upgrade',2**32-1,64*2**30));
  assert.doesNotThrow(()=>checkCardSize('boot',5143798403,64*2**30));
  assert.throws(()=>checkCardSize('boot',1024,512),/larger/);
});
test('setup verifies archives and each selected executable or driver file',()=>{
  for(const spec of Object.values(components)) {
    assert.equal(new URL(spec.url).protocol,'https:');
    assert.match(spec.hash,/^[a-f0-9]{64}$/);
    for(const sha of Object.values(spec.files)) assert.match(sha,/^[a-f0-9]{64}$/);
  }
});
