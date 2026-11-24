import {execFileSync} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from './setup-windows.mjs';

if(process.platform!=='win32' || process.arch!=='x64') throw Error('Build this package with x64 Node on Windows.');
const root=fileURLToPath(new URL('../',import.meta.url));
const out=path.resolve(process.argv[2] || 'dist');
await mkdir(out,{recursive:true});
const dir=await mkdtemp(path.join(out,'bundle-'));
const tar=path.join(process.env.SystemRoot,'System32','tar.exe');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const artifact=path.join(out,pkg.name+'-'+pkg.version+'-windows-x64.zip');
const archive=path.join(dir,'app.tgz');
execFileSync(tar,['-czf',archive,'--exclude','node_modules/.bin','--exclude','*.pdb','--exclude','node_modules/node-pty/prebuilds/darwin-*','--exclude','node_modules/node-pty/prebuilds/win32-arm64','-C',root,
  'server.mjs','rockusb.mjs','jobs.mjs','operations.mjs','sd.mjs','package.json','package-lock.json','README.md','README.zh-CN.md','LICENSE','node_modules']);
await copyFile(process.execPath,path.join(dir,'node.exe'));
if(process.argv[3]) await copyFile(path.resolve(process.argv[3]),path.join(dir,'NODE-LICENSE.txt'));
else execFileSync(path.join(process.env.SystemRoot,'System32','curl.exe'),['-fLsS','--proto','=https','https://raw.githubusercontent.com/nodejs/node/'+process.version+'/LICENSE','-o',path.join(dir,'NODE-LICENSE.txt')]);
await copyFile(path.join(root,'scripts','setup-windows.mjs'),path.join(dir,'setup-windows.mjs'));
await copyFile(path.join(root,'README.md'),path.join(dir,'README.md'));
await copyFile(path.join(root,'README.zh-CN.md'),path.join(dir,'README.zh-CN.md'));
const launcher=[
  '@echo off','setlocal DisableDelayedExpansion',
  '"%~dp0node.exe" "%~dp0setup-windows.mjs" %*','set "result=%errorlevel%"',
  'if "%~1"=="" pause','exit /b %result%',''
].join('\r\n');
await writeFile(path.join(dir,'Install-RockUSB.cmd'),launcher);
await writeFile(path.join(dir,'release.json'),JSON.stringify({version:pkg.version,node:process.version,payload:await digest(archive),runtime:await digest(process.execPath)})+'\n');
execFileSync(tar,['-acf',artifact,'-C',dir,'.']);
const checksum=await digest(artifact);
await writeFile(artifact+'.sha256',checksum+'  '+path.basename(artifact)+'\n');
console.log(artifact+'\nSHA-256 '+checksum);
const source=path.join(out,pkg.name+'-'+pkg.version+'-source.zip');
execFileSync(tar,['-acf',source,'-C',root,'server.mjs','rockusb.mjs','jobs.mjs','operations.mjs','sd.mjs','scripts','tests','package.json','package-lock.json','README.md','README.zh-CN.md','LICENSE','.gitignore']);
await writeFile(source+'.sha256',await digest(source)+'  '+path.basename(source)+'\n');
