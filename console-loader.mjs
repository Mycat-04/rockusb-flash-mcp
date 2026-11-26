import {randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {stripVTControlCharacters} from 'node:util';
import {listDevices} from './rockusb.mjs';

export async function listConsoles() {
  const {autoDetect} = await import('@serialport/bindings-cpp');
  return (await autoDetect().list()).filter(p => p.vendorId && p.productId)
    .map(p => ({port:p.path, adapter:p.friendlyName || p.manufacturer, id:p.pnpId || p.locationId || p.path}));
}

async function openConsole(port, baudRate) {
  const [{autoDetect},{SerialPortStream}] = await Promise.all([import('@serialport/bindings-cpp'),import('@serialport/stream')]);
  const stream = new SerialPortStream({binding:autoDetect(),path:port,baudRate,autoOpen:false});
  let text = '', fault;
  stream.on('error', error => {fault = error;});
  stream.on('data', bytes => {text = (text+bytes.toString('utf8')).slice(-16384);});
  await new Promise((ok,fail) => stream.open(error => error ? fail(error) : ok()));
  return {
    text:() => {if (fault) throw fault; return stripVTControlCharacters(text).replace(/\r/g,'');},
    send:async line => {
      text = '';
      await new Promise((ok,fail) => stream.write(line,error => error ? fail(error) : ok()));
      await new Promise((ok,fail) => stream.drain(error => error ? fail(error) : ok()));
    },
    close:() => stream.isOpen && new Promise((ok,fail) => stream.close(error => error ? fail(error) : ok()))
  };
}

const host = {listConsoles,openConsole,listDevices,sleep,now:Date.now};
const notShell = /(?:login:|password:|=>|hit any key to stop autoboot)\s*$/im;
const rootPrompt = /(?:^|\n)(?:root@[\w.-]+:[^\n#]*|\/[^\n#]*)#\s*$/;
const boardSerial = value => /^[a-f\d]{8,64}$/i.test(value) && !/^0+$/.test(value) ? value.toLowerCase() : '';

async function waitText(tty, pattern, io, message) {
  const deadline = io.now()+3500;
  do {
    const text = tty.text();
    if (notShell.test(text)) throw Error('Log in to the board Linux root shell, then release the serial terminal.');
    const match = text.match(pattern);
    if (match) return match;
    await io.sleep(50);
  } while (io.now()<deadline);
  throw Error(message);
}

async function identifyShell(tty, io) {
  await io.sleep(200);
  if (notShell.test(tty.text())) throw Error('The serial console is at login or the bootloader. A logged-in Linux root shell is required.');
  if (!rootPrompt.test(tty.text())) {
    // Redraw an idle shell. Sending Return here could execute a partially typed command.
    await tty.send('\x0c');
    await waitText(tty,rootPrompt,io,'No idle Linux root prompt. Check baud rate, log in, leave an empty prompt, then release the port.');
  }
  const tag = 'RKU'+randomBytes(8).toString('hex');
  const probe = "printf '\\n"+tag+"|%s|%s|%s|%s|%s|%s\\n' "+
    '"$(id -u)" "$(cat /proc/1/comm)" "$(cat /proc/sys/kernel/random/boot_id)" '+
    '"$(tr -d \'\\000\' </proc/device-tree/model)" "$(tr \'\\000\' , </proc/device-tree/compatible)" '+
    '"$(if [ -r /proc/device-tree/serial-number ]; then tr -d \'\\000\' </proc/device-tree/serial-number; else sed -n \'s/^Serial[[:space:]]*:[[:space:]]*//p\' /proc/cpuinfo; fi)"';
  await tty.send(probe+'\r');
  const match = await waitText(tty,new RegExp('(?:^|\\n)'+tag+'\\|(\\d+)\\|([^|\\n]*)\\|([\\da-f-]{36})\\|([^|\\n]{1,160})\\|([^|\\n]*)\\|([^|\\n]*)\\n','i'),io,'Could not read the Linux board identity from the serial console.');
  const [,uid,init,boot_id,model,compatible,serial] = match;
  if (uid !== '0' || init !== 'systemd' || !/(?:^|,)rockchip,rk\d+/i.test(compatible))
    throw Error('The serial Loader route requires a Rockchip Linux board with systemd and a logged-in root shell.');
  return {boot_id,model,serial:boardSerial(serial)};
}

async function withBoard(port, baud, action, io) {
  const adapter = (await io.listConsoles()).find(row => row.port===port);
  if (!adapter) throw Error('Select a connected USB serial adapter from list_devices.');
  const tty = await io.openConsole(port,baud);
  try {
    return await action({...await identifyShell(tty,io),port,baud,adapter_id:adapter.id},tty);
  } finally {
    await tty.close();
  }
}

export const identifyConsole = (port, baud, io=host) => withBoard(port,baud,device=>device,io);

export async function enterConsoleLoader(plan, onStatus, io=host) {
  const approved = plan.device;
  const before = await withBoard(approved.port,approved.baud,async (current,tty)=>{
    if (['boot_id','model','serial','adapter_id'].some(key=>current[key]!==approved[key]))
      throw Error('The approved board or console changed. Identify the target again.');
    const devices = await io.listDevices(plan.backend);
    if (current.serial && devices.some(d=>boardSerial(d.serial)===current.serial))
      throw Error('This board serial already appears in RockUSB. Check the detected devices.');
    await onStatus('rebooting','Requesting systemctl reboot loader on '+current.port+'.');
    await tty.send('systemctl reboot loader\r');
    return new Set(devices.map(d=>d.location));
  },io);
  await onStatus('waiting_for_loader','Waiting for the board on the separate OTG data connection.');
  const deadline = io.now()+60000;
  let candidates = [], diagnostic = '';
  do {
    try {
      const all = await io.listDevices(plan.backend);
      candidates = all.filter(d=>d.vid==='0x2207' && !before.has(d.location));
      const matching = approved.serial ? all.filter(d=>boardSerial(d.serial)===approved.serial) : [];
      if (matching.length===1 && candidates.includes(matching[0])) {
        const device = matching[0];
        if (device.mode==='loader') return {state:'backend_succeeded',message:'Verified Loader by board serial on OTG.',device};
        if (device.mode==='maskrom') return {state:'failed',message:'The selected board entered Maskrom instead of Loader.',device};
      }
    } catch (error) { diagnostic=error.message; candidates=[]; }
    await io.sleep(1000);
  } while (io.now()<deadline);
  if (candidates.length) return {state:'needs_device_confirmation',message:'A new RockUSB device appeared, but its identity could not be matched to the console board. Ask the user to identify the physical target before any flash.',candidates};
  throw Error('No new RockUSB device was verified. Check OTG data cable and driver; do not resend the reboot automatically.'+(diagnostic?' '+diagnostic:''));
}
