import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyConsole, enterConsoleLoader} from '../console-loader.mjs';

const adapter={port:'COM4',id:'usb-adapter-1'};
const bootId='1a7c232d-3eac-4a93-8e3f-3b8aa719e8c0';
const serial='d6a7ad02cffedd58';
const loader={vid:'0x2207',pid:'0x350b',location:'1941',mode:'loader',serial};
const plan={backend:'upgrade_tool',device:{port:'COM4',baud:1500000,adapter_id:adapter.id,model:'ArmSoM Sige7S',boot_id:bootId,serial}};

function fixture(options={}) {
  let tick=0, sent=false, closed=0, output=options.prompt??'root@armsom:~# ';
  const commands=[];
  return {
    now:()=>tick,sleep:async ms=>{tick+=ms;},get closed(){return closed;},commands,
    listConsoles:async()=>[adapter],
    listDevices:async()=>sent?(options.after??[loader]):(options.before??[]),
    openConsole:async()=>({
      text:()=>output, close:async()=>{closed++;},
      send:async cmd=>{
        commands.push(cmd);
        if (cmd==='\x0c') return;
        if (cmd==='systemctl reboot loader\r') {sent=true;return;}
        const tag=cmd.match(/RKU[\da-f]{16}/)[0];
        output=cmd+'\n'+tag+'|0|systemd|'+(options.bootId??bootId)+'|ArmSoM Sige7S|armsom,sige7s,rockchip,rk3588,|'+serial+'\nroot@armsom:~# ';
      }
    })
  };
}

test('serial preflight identifies the board without issuing a reboot',async()=>{
  const io=fixture();
  assert.deepEqual(await identifyConsole('COM4',1500000,io),plan.device);
  assert.equal(io.commands.length,1);
  assert.ok(io.commands[0].startsWith('printf '));
  assert.equal(io.closed,1);
});
test('login, bootloader, busy line or a changed Linux boot never get a reboot command',async()=>{
  for (const options of [{prompt:'armsom login: '},{prompt:'=> '},{prompt:'root@armsom:~# shutdown'},{bootId:'3a7c232d-3eac-4a93-8e3f-3b8aa719e8c0'}]) {
    const io=fixture(options);
    await assert.rejects(enterConsoleLoader(plan,()=>{},io));
    assert.ok(!io.commands.includes('systemctl reboot loader\r'));
    assert.equal(io.closed,1);
  }
});
test('a serial reboot succeeds only for a new Loader matching the approved board serial',async()=>{
  const io=fixture();
  const result=await enterConsoleLoader(plan,()=>{},io);
  assert.deepEqual(result.device,loader);
  assert.equal(result.state,'backend_succeeded');
  assert.equal(io.commands.filter(cmd=>cmd==='systemctl reboot loader\r').length,1);
  for (const after of [[{...loader,serial:''}],[{...loader,serial:'deadbeef'}],[loader,{...loader,location:'1942'}]]) {
    const other=fixture({after});
    assert.equal((await enterConsoleLoader(plan,()=>{},other)).state,'needs_device_confirmation');
  }
});
test('existing devices, Maskrom and missing OTG do not satisfy a serial Loader plan',async()=>{
  const existing=fixture({before:[loader]});
  await assert.rejects(enterConsoleLoader(plan,()=>{},existing),/already appears/);
  assert.ok(!existing.commands.includes('systemctl reboot loader\r'));
  const maskrom=fixture({after:[{...loader,mode:'maskrom'}]});
  assert.equal((await enterConsoleLoader(plan,()=>{},maskrom)).state,'failed');
  await assert.rejects(enterConsoleLoader(plan,()=>{},fixture({after:[]})),/No new RockUSB/);
});
