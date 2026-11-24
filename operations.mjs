import {execFile, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createReadStream} from 'node:fs';
import {open, stat} from 'node:fs/promises';
import path from 'node:path';
import {promisify, stripVTControlCharacters} from 'node:util';

const exec = promisify(execFile);
export const queries = {
  connection:'td', flash_info:'rfi', chip_info:'rci', partitions:'pl', capabilities:'rcb', flash_id:'rid'
};
export async function query(tool, device, kind) {
  if (!Object.hasOwn(queries, kind)) throw Error('Unknown device query.');
  const {stdout,stderr} = await exec(tool,['-s',device.location,queries[kind]], {
    cwd:path.dirname(tool), windowsHide:true, timeout:20000, maxBuffer:256*1024
  });
  const text = (stdout + stderr).replace(/\r/g,'').trim();
  if (/\b(?:fail(?:ed)?|error|quit)\b/i.test(text)) throw Error(text.slice(-1024));
  return text;
}

export function parseStorage(text) {
  // ConPTY represents tab stops by cursor-right sequences.
  const clean = stripVTControlCharacters(text.replace(/\x1b\[\d+C/g,' '));
  const rows = [...clean.matchAll(/No\s*=\s*(\d+)\s+([\w-]+)(\(\*\))?/gi)]
    .map(m => ({number:Number(m[1]), name:m[2].toUpperCase(), current:!!m[3]}));
  if (!rows.length || rows.filter(r => r.current).length !== 1) throw Error('Unable to identify the current storage from the Rockchip menu.');
  return rows;
}

export async function storageMenu(tool, device, select) {
  if (!select) {
    // Some vendor builds loop on EOF. Stop this read-only process once the menu is complete.
    const child = spawn(tool,['-s',device.location,'ssd'],{cwd:path.dirname(tool),windowsHide:true,stdio:['pipe','pipe','pipe']});
    let text = '';
    let complete = false;
    const timer = setTimeout(() => child.kill(),7000);
    const closed = once(child,'close');
    child.stdout.on('data',chunk => {
      if (complete) return;
      text = (text+chunk).slice(0,32768);
      if (/Input No to switch/i.test(text)) { complete = true; child.kill(); }
    });
    child.stderr.resume();
    child.stdin.on('error',()=>{});
    child.stdin.end('Q\n');
    try { await closed; return parseStorage(text); } finally { clearTimeout(timer); }
  }
  const {spawn:openTerminal} = await import('node-pty');
  const terminal = openTerminal(tool,['-s',device.location,'ssd'],{cwd:path.dirname(tool),cols:220,rows:40});
  await new Promise((resolve,reject) => {
    let text = '';
    let sent = false;
    let problem;
    let confirmed=false;
    const timer = setTimeout(() => { problem = Error('Storage switch timed out. Recheck storage before retrying.'); terminal.kill(); },20000);
    terminal.onData(chunk => {
      text = (text + chunk).slice(-32768);
      if (!/Input No to switch/i.test(text)) return;
      try {
        if(sent) {
          confirmed=parseStorage(text).some(row=>row.current && row.name===select);
          if(!confirmed) problem=Error('Loader retained a different storage selection.');
          terminal.kill();
          return;
        }
        const entry = parseStorage(text).find(row => row.name === select);
        if (!entry) throw Error('Storage is absent from the current menu.');
        sent = true;
        text = '';
        terminal.write(String(entry.number)+'\r');
      } catch (e) { problem=e; terminal.kill(); }
    });
    terminal.onExit(({exitCode}) => {
      clearTimeout(timer);
      if (problem || !sent || (!confirmed && exitCode !== 0)) reject(problem || Error('Storage switch failed. Inspect the current storage.'));
      else resolve();
    });
  });
  const after = await storageMenu(tool, device);
  if (!after.some(r => r.name === select && r.current)) throw Error('Requested storage is not active after switching.');
  return after;
}

export async function fileDigest(file) {
  const info = await stat(file);
  if (!info.isFile() || !info.size) throw Error('Choose a non-empty regular file.');
  const hash = createHash('sha256');
  for await (const buf of createReadStream(file)) hash.update(buf);
  return {file,bytes:info.size,sha256:hash.digest('hex')};
}

export function partitionTable(text) {
  return [...text.matchAll(/^\s*\d+\s+(0x[\da-f]+)\s+(0x[\da-f]+)\s+([\w.-]+)\s*$/gim)]
    .map(m=>({name:m[3],start:Number(m[1]),sectors:Number(m[2])}));
}

export const operations = ['switch_storage','erase_flash','download_boot','write_loader','write_partition','backup_partition','reboot','enter_maskrom'];
export function usbCommand(plan, image, dir) {
  const partition = plan.partition?.name;
  switch (plan.operation) {
    case 'erase_flash': return {args:['ef',image], success:/erase flash ok\./i};
    case 'download_boot': return {args:['db',image], success:/download boot ok\./i};
    case 'write_loader': return {args:['ul',image], success:/upgrade loader ok\./i};
    case 'write_partition': return {args:['di','-'+partition,image], success:/download (?:sparse )?image ok\./i};
    case 'backup_partition': return {args:['rl','0x'+plan.partition.start.toString(16),'0x'+plan.partition.sectors.toString(16),path.join(dir,'partition.img')]};
    case 'enter_maskrom': return {args:['rd','3'], success:/reset device ok\./i};
    case 'reboot': return {args:['rd'], success:/reset device ok\./i};
    default: throw Error('Unsupported operation.');
  }
}

export async function runUsbOperation(plan,image,dir) {
  if (plan.operation === 'switch_storage') {
    await storageMenu(plan.backend,plan.device,plan.requested_storage);
    return;
  }
  const {args,success} = usbCommand(plan,image,dir);
  const log = await open(path.join(dir,'upgrade.log'),'wx',0o600);
  try {
    const child = spawn(plan.backend,['-s',plan.device.location,...args],{cwd:path.dirname(plan.backend),windowsHide:true,stdio:['ignore',log.fd,log.fd]});
    const [code] = await once(child,'close');
    if (code !== 0) throw Error('Rockchip operation failed with exit code ' + code);
    if (plan.operation === 'backup_partition') {
      if ((await stat(args.at(-1))).size !== plan.partition.sectors*512) throw Error('Incomplete partition backup.');
      return;
    }
    const reader = await open(path.join(dir,'upgrade.log'),'r');
    try {
      const {size} = await reader.stat();
      const tail = Buffer.alloc(Math.min(8192,size));
      await reader.read(tail,0,tail.length,size-tail.length);
      if (!success.test(tail.toString())) throw Error('No recognized completion marker. Inspect the log before retrying.');
    } finally {await reader.close();}
  } finally {await log.close();}
}
