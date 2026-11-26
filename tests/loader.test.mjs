import test from 'node:test';
import assert from 'node:assert/strict';
import {enterLoader, identifyAdb, parseAdbDevices, rockusbAtPort} from '../loader.mjs';

const adbRow = {serial:'cm5',state:'device',transport_id:'8'};
const running = {port:'usb-A',vid:'0x2207',pid:'0x0006',adb:true};
const boot = {...running,pid:'0x350e',adb:false};
const loader = {vid:boot.vid,pid:boot.pid,mode:'loader',location:'1944',serial:''};
const plan = {adb:'adb',backend:'upgrade_tool',device:{...adbRow,port:running.port,pid:running.pid}};

function fixture(options = {}) {
  let clock = 0;
  let reboots = 0;
  const calls = [];
  return {
    get reboots() { return reboots; },
    calls,
    now:() => clock,
    sleep:async ms => {clock += ms;},
    listAdbDevices:async () => options.rows ?? [adbRow],
    usbPorts:async () => reboots ? options.after ?? [boot] : options.before ?? [running],
    listDevices:async () => reboots ? options.devices ?? [loader] : [],
    adbCommand:async (_exe,args) => {
      calls.push(args);
      if (args.at(-1) === 'get-serialno') return options.serial ?? 'cm5';
      if (args.at(-1) === 'get-devpath') return options.devpath ?? 'unknown';
      assert.deepEqual(args,['-t','8','shell','reboot','loader']);
      reboots++;
      if (options.disconnect) throw Error('USB disconnected');
      return '';
    }
  };
}

test('ADB listing preserves authorization state and exact transport IDs',()=>{
  assert.deepEqual(parseAdbDevices('List of devices attached\r\ncm5  device model:Nexus_4 transport_id:8\r\nother unauthorized transport_id:12\r\n'),[
    adbRow,{serial:'other',state:'unauthorized',transport_id:'12'}
  ]);
  assert.deepEqual(parseAdbDevices('List of devices attached\n'),[]);
  assert.throws(()=>parseAdbDevices('error: adb missing'));
});

test('a planned reboot requires an authorized, unique, physical Rockchip ADB target',async ()=>{
  assert.deepEqual(await identifyAdb('adb','cm5',fixture()),plan.device);
  for (const options of [
    {rows:[adbRow,adbRow]}, {rows:[{...adbRow,state:'unauthorized'}]}, {rows:[{...adbRow,state:'offline'}]},
    {rows:[{...adbRow,transport_id:undefined}]}, {before:[running,{...running,port:'usb-B'}]},
    {before:[{...running,vid:'0x18d1'}]}, {serial:'another-board'}
  ]) {
    const io=fixture(options);
    await assert.rejects(identifyAdb('adb','cm5',io));
    assert.equal(io.reboots,0);
  }
});

test('worker rechecks the approved port and transport before sending the reboot',async ()=>{
  for (const options of [{before:[{...running,port:'usb-B'}]}, {rows:[{...adbRow,transport_id:'9'}]}]) {
    const io=fixture(options);
    await assert.rejects(enterLoader(plan,()=>{},io),/changed/);
    assert.equal(io.reboots,0);
  }
});

test('multiple ADB boards can be selected by a proven USB path or unique host USB serial',async ()=>{
  const before = [{...running,port:'usb-B',serial:'other'}, {...running,serial:'CM5'}];
  assert.deepEqual(await identifyAdb('adb','cm5',fixture({before})),plan.device);
  const unnamed = before.map(row=>({...row,serial:undefined}));
  assert.deepEqual(await identifyAdb('adb','cm5',fixture({before:unnamed,devpath:'usb:usb-A'})),plan.device);
  await assert.rejects(identifyAdb('adb','cm5',fixture({before:unnamed})),/unique Rockchip USB port/);
  await assert.rejects(identifyAdb('adb','cm5',fixture({before:before.map(row=>({...row,serial:'cm5'}))})),/unique Rockchip USB port/);
});

test('identical Loader products require a shared unique serial to map the selected port',()=>{
  const ports=[{...boot,serial:'A'},{...boot,port:'usb-B',serial:'B'}];
  const devices=[{...loader,serial:'B',location:'1945'},{...loader,serial:'A'}];
  assert.equal(rockusbAtPort('usb-A',ports,devices),devices[1]);
  assert.equal(rockusbAtPort('usb-B',ports,[devices[1]]),undefined);
  assert.equal(rockusbAtPort('usb-A',ports,[devices[1],devices[1]]),undefined);
});

test('a sole Loader candidate must not contradict the USB serial at the approved port',()=>{
  const ports=[{...boot,serial:'A'}];
  assert.equal(rockusbAtPort('usb-A',ports,[{...loader,serial:'B'}]),undefined);
  const candidate={...loader,serial:'a'};
  assert.equal(rockusbAtPort('usb-A',ports,[candidate]),candidate);
});

test('verified Loader succeeds even when ADB disconnects during reboot',async ()=>{
  const io=fixture({disconnect:true});
  const states=[];
  assert.deepEqual(await enterLoader(plan,state=>states.push(state),io),loader);
  assert.equal(io.reboots,1);
  assert.deepEqual(states,['rebooting','waiting_for_loader']);
});

test('wrong port, ambiguous USB identity, and failure to re-enumerate never report success',async ()=>{
  for (const options of [
    {after:[{...boot,port:'usb-B'}]}, {after:[boot,{...boot,port:'usb-B'}]},
    {devices:[loader,loader]}, {devices:[]}, {after:[running]}, {after:[],disconnect:true}
  ]) {
    const io=fixture(options);
    await assert.rejects(enterLoader(plan,()=>{},io),/not verified/);
    assert.equal(io.reboots,1);
  }
  assert.equal(rockusbAtPort('usb-A',[boot],[{...loader,pid:'0x1234'}]),undefined);
});

test('Maskrom observed on the target port is identified separately',async ()=>{
  const io=fixture({devices:[{...loader,mode:'maskrom'}]});
  await assert.rejects(enterLoader(plan,()=>{},io),/Maskrom/);
  assert.equal(io.reboots,1);
});
