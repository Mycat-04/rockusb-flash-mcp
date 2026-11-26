import {execFile, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {createReadStream} from 'node:fs';
import {open, stat, statfs, unlink} from 'node:fs/promises';
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
  const clean = stripVTControlCharacters(text.replace(/\x1b\[\d+C/g,' ')).split(/Input No to switch/i,1)[0];
  const rows = [...clean.matchAll(/No\s*=\s*(\d+)\s+([\w-]+)[ \t]*(\(\*\))?/gi)]
    .map(m => ({number:Number(m[1]), name:m[2].toUpperCase(), current:!!m[3]}));
  if (!rows.length || rows.filter(r => r.current).length !== 1) throw Error('Unable to identify the current storage from the Rockchip menu.');
  if (new Set(rows.map(row => row.name)).size !== rows.length || new Set(rows.map(row => row.number)).size !== rows.length)
    throw Error('Ambiguous storage names or numbers in the Rockchip menu.');
  return rows;
}

export function checkFlashStorage(active, requested) {
  if (!requested) return;
  if (!active) throw Error('Cannot verify the requested '+requested+' storage in this mode. A running Loader is required.');
  if (active !== requested.toUpperCase()) throw Error('Active storage is '+active+', requested '+requested+'. Check storage_menu before switching.');
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

export function selectPartition(text, name) {
  const matches = partitionTable(text).filter(row => row.name === name);
  if (matches.length !== 1) throw Error('Select a unique partition name from the current partition table.');
  const [part] = matches;
  if (!part.sectors || part.sectors === 0xffffffff || part.start + part.sectors > 2 ** 32)
    throw Error('The backend requires a partition with a known 32-bit LBA range.');
  return part;
}

export const operations = ['switch_storage','erase_flash','download_boot','write_loader','write_partition','backup_partition','reboot','enter_maskrom'];
export function usbCommand(plan, image, dir) {
  switch (plan.operation) {
    case 'erase_flash': return {args:['ef',image], success:/erase flash ok\./i};
    case 'download_boot': return {args:['db',image], success:/download boot ok\./i};
    case 'write_loader': return {args:['ul',image], success:/upgrade loader ok\./i};
    case 'write_partition': {
      // DI treats names such as "b" as built-in aliases. Address the approved LBA range directly.
      const sectors = Math.ceil(plan.image.bytes / 512);
      if (!sectors || sectors > plan.partition.sectors) throw Error('Image exceeds the approved partition range.');
      return {args:['wl','0x'+plan.partition.start.toString(16),'0x'+sectors.toString(16),image],success:/Write LBA from file\s*(?:\.\.\.)?\s*\(100%\)/i};
    }
    case 'backup_partition': return {args:['rl','0x'+plan.partition.start.toString(16),'0x'+plan.partition.sectors.toString(16),path.join(dir,'partition.img')],success:/Read LBA to file\s*\(100%\)/i};
    case 'enter_maskrom': return {args:['rd','3'], success:/reset device ok\./i};
    case 'reboot': return {args:['rd'], success:/reset device ok\./i};
    default: throw Error('Unsupported operation.');
  }
}

async function runCommand(backend, location, args, log) {
  const child = spawn(backend,['-s',location,...args],{cwd:path.dirname(backend),windowsHide:true,stdio:['ignore',log.fd,log.fd]});
  const [code] = await once(child,'close');
  if (code !== 0) throw Error('Rockchip operation failed with exit code ' + code);
}

async function runChecked(plan, command, log, run) {
  const start = (await log.stat()).size;
  await run(plan.backend,plan.device.location,command.args,log);
  const end = (await log.stat()).size;
  const tail = Buffer.alloc(Math.min(8192,end-start));
  await log.read(tail,0,tail.length,end-tail.length);
  if (!command.success.test(tail.toString())) throw Error('No recognized completion marker. Inspect the log before retrying.');
}

export async function runUsbOperation(plan,image,dir,run=runCommand) {
  if (plan.operation === 'switch_storage') {
    await storageMenu(plan.backend,plan.device,plan.requested_storage);
    return;
  }
  const command = usbCommand(plan,image,dir);
  const log = await open(path.join(dir,'upgrade.log'),'wx+',0o600);
  try {
    if (plan.operation === 'write_partition') {
      const bytesToRead = Math.ceil(plan.image.bytes / 512) * 512;
      const {bavail,bsize} = await statfs(dir);
      if (bavail * bsize < bytesToRead) throw Error('Free more disk space for partition readback before writing.');
      await runChecked(plan,command,log,run);
      const readback = path.join(dir,'verify.img');
      try {
        const verify = {args:['rl',command.args[1],command.args[2],readback],success:/Read LBA to file\s*\(100%\)/i};
        await runChecked(plan,verify,log,run);
        if ((await stat(readback)).size !== bytesToRead) throw Error('Incomplete partition readback.');
        const hash = createHash('sha256');
        for await (const bytes of createReadStream(readback,{end:plan.image.bytes-1})) hash.update(bytes);
        if (hash.digest('hex') !== plan.image.sha256) throw Error('Partition readback differs from the approved image.');
      } finally {
        await unlink(readback).catch(error => {if (error.code !== 'ENOENT') throw error;});
      }
      return;
    }
    await runChecked(plan,command,log,run);
    if (plan.operation === 'backup_partition') {
      if ((await stat(command.args.at(-1))).size !== plan.partition.sectors*512) throw Error('Incomplete partition backup.');
    }
  } finally {await log.close();}
}
