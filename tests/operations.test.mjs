import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkCardSize} from '../sd.mjs';
import {checkFlashStorage,parseStorage,partitionTable,runUsbOperation,selectPartition,usbCommand} from '../operations.mjs';
import {components} from '../scripts/setup-windows.mjs';

test('only one current storage is accepted, including output from ConPTY',()=>{
  assert.deepEqual(parseStorage('No=1 FLASH\r\nNo=2\x1b[4CEMMC(*)'),[
    {number:1,name:'FLASH',current:false},{number:2,name:'EMMC',current:true}]);
  assert.throws(()=>parseStorage('No=1 FLASH\nNo=2 EMMC'));
  assert.throws(()=>parseStorage('No=1 FLASH(*)\nNo=2 EMMC(*)'));
  assert.throws(()=>parseStorage('No=1 EMMC(*)\nNo=1 SD'),/Ambiguous/);
  assert.throws(()=>parseStorage('No=1 EMMC(*)\nNo=2 EMMC'),/Ambiguous/);
  assert.equal(parseStorage('No=1 EMMC (*)\nInput No to switch\nNo=1 EMMC (*)')[0].current,true);
});
test('partition selection rejects duplicates, unknown or overflowing LBA ranges',()=>{
  const rows='01 0x00008000 0x00002000 b\n02 0x0000a000 0xffffffff data\n';
  assert.deepEqual(selectPartition(rows,'b'),{name:'b',start:32768,sectors:8192});
  assert.throws(()=>selectPartition(rows+rows,'b'),/unique/);
  assert.throws(()=>selectPartition(rows,'data'),/range/);
  assert.throws(()=>selectPartition('01 0xfffffffe 0x00000004 b','b'),/range/);
});

test('raw partition writes address the approved LBAs and verify the returned bytes',async t=>{
  const data=Buffer.alloc(513,19);
  const plan={operation:'write_partition',backend:'mock',device:{location:'123'},
    partition:{name:'b',start:128,sectors:20},image:{bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')}};
  for(const scenario of ['success','wrong bytes','short read','no read marker']) {
    const dir=await mkdtemp(path.join(os.tmpdir(),'rockusb-partition-'));
    t.after(()=>rm(dir,{recursive:true,force:true}));
    const image=path.join(dir,'firmware.img');
    const calls=[];
    const run=async (_backend,location,args,log)=>{
      assert.equal(location,'123');
      calls.push(args.slice(0,3));
      if(args[0]==='wl') {
        assert.equal(args[3],image);
        await log.write('Write LBA from file (100%)\r');
      } else {
        const readback=Buffer.alloc(scenario==='short read'?513:1024);
        data.copy(readback);
        if(scenario==='wrong bytes') readback[12]=0;
        await writeFile(args[3],readback);
        if(scenario!=='no read marker') await log.write('Read LBA to file (100%)\r');
      }
    };
    const result=runUsbOperation(plan,image,dir,run);
    if(scenario==='success') await result;
    else await assert.rejects(result,/differs|Incomplete|completion marker/);
    assert.deepEqual(calls,[['wl','0x80','0x2'],['rl','0x80','0x2']]);
  }
});
test('partition readback uses the start and count from the device',()=>{
  const [part]=partitionTable('01 0x00008000 0x00002000 boot\r\n');
  assert.deepEqual(part,{name:'boot',start:32768,sectors:8192});
  assert.deepEqual(usbCommand({operation:'backup_partition',partition:part},null,'job').args,['rl','0x8000','0x2000',path.join('job','partition.img')]);
});
test('an explicitly requested flash medium must match the active Loader storage',()=>{
  assert.doesNotThrow(()=>checkFlashStorage('EMMC','eMMC'));
  assert.throws(()=>checkFlashStorage('SPINOR','eMMC'),/Active storage is SPINOR/);
  assert.throws(()=>checkFlashStorage(undefined,'EMMC'),/Cannot verify/);
  assert.doesNotThrow(()=>checkFlashStorage('SPINOR'));
  assert.doesNotThrow(()=>checkFlashStorage(undefined));
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
