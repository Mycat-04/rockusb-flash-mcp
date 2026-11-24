import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const ps = path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const encoded = code => Buffer.from(code,'utf16le').toString('base64');
const expectedBinary = '404b7cba94275d001468312bc6b90547b515b22b4b83924d55c88fcacd702715';

// Reuse this exact enumeration after UAC before launching the external writer.
const cardInventory = `
$ErrorActionPreference='Stop'
$systemDisk=(Get-Partition -DriveLetter $env:SystemDrive[0] | Get-Disk).Number
$media=@(Get-CimInstance Win32_DiskDrive)
$cards=@(foreach($d in Get-Disk) {
  $w=$media | Where-Object Index -eq $d.Number | Select-Object -First 1
  if($d.IsSystem -or $d.IsBoot -or $d.Number -eq $systemDisk -or $d.IsOffline -or $d.IsReadOnly -or $d.Size -le 0){continue}
  if($d.BusType -ne 'SD' -and !($d.BusType -eq 'USB' -and ($w.MediaType -match 'removable' -or ($w.Capabilities -contains 7)))){continue}
  if(!$w.PNPDeviceID -or !$d.UniqueId){continue}
  [pscustomobject]@{number=[int]$d.Number;model=[string]$d.FriendlyName;bytes=[long]$d.Size;id=[string]$d.UniqueId;pnp=[string]$w.PNPDeviceID;serial=[string]$d.SerialNumber}
})
`;
export async function listCards() {
  if (process.platform !== 'win32') throw Error('Host card readers currently require Windows.');
  const {stdout} = await exec(ps,['-NoProfile','-NonInteractive','-EncodedCommand',encoded(cardInventory + '\n[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); ConvertTo-Json -Compress -InputObject $cards')],{windowsHide:true,timeout:30000});
  return JSON.parse(stdout.trim());
}

export function checkCardSize(mode, imageBytes, cardBytes) {
  if (mode === 'upgrade' && imageBytes >= 2 ** 32) throw Error('This update-card backend uses FAT32. The firmware must be smaller than 4 GiB; use a compatible recovery image or use USB flashing.');
  if (imageBytes >= cardBytes) throw Error('Select a larger card. The backend also checks the complete partition layout.');
}

export async function writeCard(plan, file) {
  if (process.platform !== 'win32') throw Error('Windows reader required.');
  // Encode data separately: no firmware path, disk name or USB identifier becomes shell code.
  const data = Buffer.from(JSON.stringify({card:plan.card, file, hash:plan.image.sha256,
    tool:plan.sdTool, mode:plan.cardMode}),'utf8').toString('base64');
  const job = `
$ErrorActionPreference='Stop'
$a=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('` + data + `')) | ConvertFrom-Json
$trusted=[IO.Directory]::CreateDirectory([IO.Path]::Combine([Environment]::GetFolderPath('ProgramFiles'),'rockusb-sd-'+[guid]::NewGuid())).FullName
$tool=[IO.Path]::Combine($trusted,'rockchip_sd_tool.exe')
$img=[IO.File]::Open($a.file,'Open','Read','Read')
try {
  [IO.File]::Copy($a.tool,$tool,$false)
  if((Get-FileHash -LiteralPath $tool).Hash -ne '` + expectedBinary + `'){exit 82}
  if((Get-FileHash -InputStream $img).Hash -ne $a.hash){exit 83}
  ` + cardInventory + `
  $selected=@($cards | Where-Object { $_.number -eq $a.card.number -and $_.id -ceq $a.card.id -and $_.pnp -ceq $a.card.pnp -and $_.serial -ceq $a.card.serial -and $_.bytes -eq $a.card.bytes })
  if($selected.Count -ne 1){exit 81}
  $disk='\\\\.\\PhysicalDrive'+[int]$selected[0].number
  $options=@('write',$a.file,'--to',$disk,'--yes')
  if($a.mode -eq 'upgrade'){$options+='--update-card'}elseif($a.mode -ne 'boot'){exit 84}
  Set-Location -LiteralPath ([Environment]::SystemDirectory)
  & $tool @options | Out-Null
  exit $LASTEXITCODE
} finally { $img.Dispose();[IO.File]::Delete($tool);[IO.Directory]::Delete($trusted) }
`;
  const run = "$ErrorActionPreference='Stop'; $p=Start-Process -FilePath ([Environment]::SystemDirectory+'\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand','" + encoded(job) + "') -Wait -PassThru; exit $p.ExitCode";
  try {
    await exec(ps,['-NoProfile','-NonInteractive','-EncodedCommand',encoded(run)],{windowsHide:true});
  } catch(error) {
    const problems={81:'Card removed or identity changed.',82:'Card writer checksum changed.',83:'Approved firmware checksum changed.',84:'Unrecognized card mode.'};
    throw Error(problems[error.code] || 'Windows authorization or SD write/verification failed (code '+error.code+'). Check the card and reader before retrying.');
  }
}
