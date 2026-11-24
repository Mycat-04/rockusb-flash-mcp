import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {access, copyFile, mkdir, mkdtemp, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const ps = path.join(system, 'WindowsPowerShell/v1.0/powershell.exe');
const driverDir = 'DriverAssitant_v5.13/Driver/x64/win10/';
const usbDir = 'upgrade_tool_v2.46_for_window/';
const upstream = 'https://raw.githubusercontent.com/ArmSoM/rockchip-tools/main/downloads/';
const vcRuntime={
  name:'vc_redist.x64.exe',hash:'9c02c9ed120f671b900e6b9471d890e3b2414117a7e53f4ae2e855466fa2b7c9',
  url:'https://download.visualstudio.microsoft.com/download/pr/78d061c5-9ef3-42ab-98ed-3309d1095dc4/9C02C9ED120F671B900E6B9471D890E3B2414117A7E53F4AE2E855466FA2B7C9/VC_redist.x64.exe'
};
export const components = {
  usb:{
    name:'upgrade_tool_v2.46.zip', url:upstream+'upgrade-tool/upgrade_tool_v2.46.zip',
    hash:'de1dc7ce00ed5cfdaa0432f1c7e3efaf096e5dbb7e0ad851345739f6342c06dc',
    files:{[usbDir+'upgrade_tool.exe']:'789c509dde39206d27b2f8915a5a169ff5eafb5b21fdb2108d0709bdda9ebde0',
      [usbDir+'config.ini']:'de40a55a95df909810245a0bc0e2d1919758205c5c6fe7a5788194aaff715472'}
  },
  driver:{
    name:'DriverAssitant_v5.13.zip', url:upstream+'driver-assistant/DriverAssitant_v5.13.zip',
    hash:'b2cabce5ab23551d8649c1201ef741fd73c8326044b78edac5439f013f034ff9',
    files:{[driverDir+'rockusb.inf']:'4fc1ea1a32e235f03805b0955dc06203be15738d0672d9679a9539ccc23e8887',
      [driverDir+'rockusb.cat']:'f9098e5a0067b5d01cb6f5be87f42a196503aee7e2d1fc41d573c80fd5c9f10f',
      [driverDir+'rockusb.sys']:'dbe50ec840008e3db5f4acd6063f622438f3bbb049e4db84e1721ea0425fcac1'}
  },
  sd:{
    name:'rockchip_sd_tool-windows-x86_64-1.3.1.zip',
    url:'https://github.com/TheGammaSqueeze/rockchip_sd_tool/releases/download/v1.3.1/rockchip_sd_tool-windows-x86_64-1.3.1.zip',
    hash:'155e2e71373b75623d706adc068b1ad5ef3ef2478b52099302390f214d641223',
    files:{'rockchip_sd_tool.exe':'404b7cba94275d001468312bc6b90547b515b22b4b83924d55c88fcacd702715'}
  }
};

export async function digest(file) {
  const hash=createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}
async function matches(file, expected) {
  try { return await digest(file) === expected; }
  catch (e) { if (e.code==='ENOENT') return false; throw e; }
}
function run(exe, args) {
  return execFileSync(exe,args,{windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024});
}
async function download(spec, cache) {
  const archive=path.join(cache,spec.name);
  if (!await matches(archive,spec.hash)) {
    console.log('Downloading '+spec.name);
    const partial=archive+'.'+randomUUID()+'.part';
    try {
      run(path.join(system,'curl.exe'),['--fail','--location','--proto','=https','--proto-redir','=https','--retry','2','--connect-timeout','20','--max-time','300','--output',partial,spec.url]);
      if (!await matches(partial,spec.hash)) throw Error('SHA-256 mismatch: '+spec.name);
      await rename(partial,archive);
    } finally { await unlink(partial).catch(e=>{if(e.code!=='ENOENT')throw e;}); }
  }
  return archive;
}
async function prepareComponent(spec, target, cache) {
  const entries=Object.entries(spec.files);
  if ((await Promise.all(entries.map(([file,sha])=>matches(path.join(target,file),sha)))).every(Boolean)) return;
  await mkdir(target,{recursive:true});
  const archive=await download(spec,cache);
  run(path.join(system,'tar.exe'),['-xf',archive,'-C',target,...Object.keys(spec.files)]);
  for (const [file,sha] of entries) if (!await matches(path.join(target,file),sha)) throw Error('Invalid extracted file: '+file);
}
function hasDriver() {
  const data=execFileSync(path.join(system,'pnputil.exe'),['/enum-drivers'],{windowsHide:true,maxBuffer:16*1024*1024});
  return /\brockusb\.inf\b/i.test(data.toString(data[1]===0 || data[0]===255 ? 'utf16le':'latin1'));
}
function installDriver(inf) {
  // Only Windows' signed driver installer runs elevated. Supply the path as data.
  const code="$ErrorActionPreference='Stop'; $f=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+Buffer.from(inf).toString('base64')+"')); $p=Start-Process -FilePath ([Environment]::SystemDirectory+'\\pnputil.exe') -ArgumentList ('/add-driver \"'+$f+'\" /install') -Verb RunAs -Wait -PassThru; exit $p.ExitCode";
  try {run(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')]);}
  catch(e){ if(e.status!==3010) throw e; console.log('Windows requests a restart to finish installing the driver.'); }
  if(!hasDriver()) throw Error('Windows did not stage rockusb.inf. Check the UAC dialog and driver signing policy.');
}
async function prepareRuntime(cache, stageOnly) {
  const dll=path.join(system,'vcruntime140.dll');
  if(!stageOnly && await access(dll).then(()=>true,()=>false)) return;
  const exe=await download(vcRuntime,cache);
  const code="$ErrorActionPreference='Stop'; Import-Module ($PSHOME+'\\Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1'); $f=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+Buffer.from(exe).toString('base64')+"')); $s=Get-AuthenticodeSignature -LiteralPath $f; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'CN=Microsoft Corporation,'){throw 'Microsoft runtime signature check failed'}; "
    +(stageOnly ? '' : "$p=Start-Process -FilePath $f -ArgumentList '/install /passive /norestart' -Verb RunAs -Wait -PassThru; if($p.ExitCode -notin 0,3010){exit $p.ExitCode}");
  run(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')]);
  if(!stageOnly) await access(dll);
}
async function findClient(name) {
  const native=name==='codex'
    ? "$p=(Get-Command codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source; if(!$p){$p=(Get-AppxPackage OpenAI.Codex | Select-Object -First 1).InstallLocation; if($p){$p=Join-Path $p 'app/resources/codex.exe'}}; if($p -and (Test-Path -LiteralPath $p)){$p}"
    : "(Get-Command claude.exe -ErrorAction SilentlyContinue | Select-Object -First 1).Source";
  const find=expr=>run(ps,['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); "+expr+"; exit 0"]).trim();
  const exe=find(native);
  if(exe) return {exe,prefix:[]};
  const shim=find('(Get-Command '+name+'.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source');
  if(!shim) return;
  const entry=path.join(path.dirname(shim),'node_modules',name==='codex'?'@openai/codex/bin/codex.js':'@anthropic-ai/claude-code/cli.js');
  if(await access(entry).then(()=>true,()=>false)) return {exe:process.execPath,prefix:[entry]};
}
async function install() {
  if(process.platform!=='win32' || process.arch!=='x64') throw Error('This package requires x64 Windows 10 (1809+) or Windows 11.');
  const {values}=parseArgs({options:{target:{type:'string'},cache:{type:'string'},'stage-only':{type:'boolean'},'firmware-dir':{type:'string'},client:{type:'string',default:'auto'}}});
  if(!['auto','codex','claude'].includes(values.client)) throw Error('Choose --client auto, codex or claude.');
  const release=path.dirname(fileURLToPath(import.meta.url));
  const manifest=JSON.parse(await readFile(path.join(release,'release.json'),'utf8'));
  const archive=path.join(release,'app.tgz');
  if(!await matches(archive,manifest.payload) || !await matches(process.execPath,manifest.runtime)) throw Error('Release integrity check failed. Extract the complete original ZIP.');
  const target=path.resolve(values.target || path.join(process.env.LOCALAPPDATA,'ArmSoM','RockUSB'));
  const cache=path.resolve(values.cache || path.join(target,'downloads'));
  await mkdir(cache,{recursive:true});
  await mkdir(target,{recursive:true});
  const app=path.join(target,'app-'+manifest.payload.slice(0,16)+'-'+manifest.runtime.slice(0,8));
  try {await access(path.join(app,'ready'));}
  catch {
    const stage=await mkdtemp(path.join(target,'install-'));
    run(path.join(system,'tar.exe'),['-xf',archive,'-C',stage]);
    await copyFile(process.execPath,path.join(stage,'node.exe'));
    await copyFile(path.join(release,'NODE-LICENSE.txt'),path.join(stage,'NODE-LICENSE.txt'));
    await writeFile(path.join(stage,'ready'),manifest.payload);
    await rename(stage,app);
  }
  const dirs={};
  for(const [name,spec] of Object.entries(components)) {
    dirs[name]=path.join(target,'tools',name+'-'+spec.hash.slice(0,12));
    await prepareComponent(spec,dirs[name],cache);
  }
  await prepareRuntime(cache,!!values['stage-only']);
  const firmware=path.resolve(values['firmware-dir'] || path.join(homedir(),'Firmware'));
  await mkdir(firmware,{recursive:true});
  const command=path.join(app,'node.exe');
  const args=[path.join(app,'server.mjs'),'--firmware-dir',firmware,'--upgrade-tool',path.join(dirs.usb,usbDir,'upgrade_tool.exe'),'--sd-tool',path.join(dirs.sd,'rockchip_sd_tool.exe'),'--ask-directory','--allow-flash'];
  const config=path.join(target,'mcp-config.json');
  await writeFile(config,JSON.stringify({mcpServers:{rockusb:{command,args}}},null,2)+'\n');
  if(values['stage-only']) {console.log('Staged without driver installation or client registration: '+config);return;}
  if(!hasDriver()) installDriver(path.join(dirs.driver,driverDir,'rockusb.inf'));
  const choices=values.client==='auto'?['codex','claude']:[values.client];
  let registered=false;
  for(const name of choices) {
    const client=await findClient(name);
    if(!client) continue;
    const invoke=argv=>run(client.exe,[...client.prefix,...argv]);
    if(name==='codex') invoke(['mcp','add','rockusb','--',command,...args]);
    else {
      // add-json refuses to overwrite an existing user entry. Keep all other servers intact.
      const json=JSON.stringify({type:'stdio',command,args});
      try {invoke(['mcp','add-json','--scope','user','rockusb',json]);}
      catch(e) {
        if(!/already exists/i.test(String(e.stderr)+String(e.stdout))) throw e;
        invoke(['mcp','remove','--scope','user','rockusb']);
        invoke(['mcp','add-json','--scope','user','rockusb',json]);
      }
    }
    registered=true; console.log('Registered rockusb for '+name+'. Open a new chat.');
  }
  if(!registered) console.log('No supported client executable found. Install Codex or Claude Code and rerun, or use '+config+' in your MCP client.');
  console.log('Installation directory: '+target);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) install().catch(e=>{console.error(e.message);process.exitCode=1;});
