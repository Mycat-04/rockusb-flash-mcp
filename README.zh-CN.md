# RockUSB Flash MCP

在 Codex 或 Claude Code 中指定 Windows 本机的固件路径，通过 USB 给 Rockchip 开发板烧录。主机端支持不同厂商的板卡，固件和 Loader 仍需与具体板型匹配。已在 ArmSoM CM5（RK3576）上验证从 Windows 写入 5.14 GB 的 Debian 12 统一固件，随后从 eMMC 启动。

## 1. 下载和安装（Windows x64）

1. 在 Windows 10 1809 或更新版本的 x64 电脑上安装并登录 **Codex 桌面版、Codex CLI 或 Claude Code**，任选一个即可。私有测试期间，请先用已获得仓库访问权限的 GitHub 账号登录。
2. 打开 [v0.2.0 测试版下载页](https://github.com/Mycat-04/rockusb-flash-mcp/releases/tag/v0.2.0)，展开 **Assets**，下载 `rockusb-flash-mcp-0.2.0-windows-x64.zip` 并完整解压。要核对下载完整性，可将 PowerShell 命令 `Get-FileHash .\rockusb-flash-mcp-0.2.0-windows-x64.zip` 的结果与同页的 `.sha256` 对照。
3. 双击 **Install-RockUSB.cmd**。安装器自带 Node.js，自动获取并校验烧录工具。新电脑若需要安装 Rockusb 驱动或微软运行库，请允许 Windows 的管理员权限提示。安装成功后可以删除解压目录。
4. 将板型匹配的、已解压的统一固件 `.img` 放入 `%USERPROFILE%\Firmware`。在资源管理器地址栏粘贴这个路径即可打开默认固件目录。

## 2. 接入 Codex 或 Claude Code

### Codex 桌面版和 CLI

安装窗口显示 `Registered rockusb for codex` 后，在 Codex **新建聊天**。桌面版可直接验证，无需在 PowerShell 找到 `codex` 命令。CLI 用户还可以运行 `codex mcp get rockusb` 查看注册信息。如果先装了 MCP、后装 Codex，在解压目录打开 PowerShell，运行 `.\Install-RockUSB.cmd --client codex` 即可补注册。

在新聊天中发送下面这句。即使尚未连接板子，也可以用它验证 MCP 是否接入。

> 用 rockusb 的 list_firmware 列出默认固件目录里的文件，只列文件。

烧录时选择允许**请求批准**的权限模式，以便接收写入确认框。如果当前聊天的审批策略是 `never`，查询和预检仍可用，写入确认可能直接返回 `cancelled`。[Codex MCP 配置](https://developers.openai.com/codex/mcp/) · [审批策略](https://developers.openai.com/codex/config-reference/#approval_policy)

### Claude Code

安装窗口显示 `Registered rockusb for claude` 后，打开新的 PowerShell，运行以下命令。若安装时未检测到 Claude Code，先在解压目录执行 `.\Install-RockUSB.cmd --client claude`。

```powershell
claude mcp get rockusb
claude
```

在 Claude Code 会话里输入 `/mcp`，确认列表中有已连接的 `rockusb`，再发送上面同一句只读请求。安装器使用用户级注册，在其他项目目录也可以使用。进行写入需要当前客户端支持并显示 MCP 确认表单。[Claude Code MCP 指南](https://code.claude.com/docs/en/mcp)

## 3. 从预检到开机验收

1. **识别设备。** 用 USB 数据线把开发板的 OTG 烧录口接到这台电脑，按板卡手册进入 Loader 或 Maskrom 模式。发送“用 rockusb 的 list_devices 查看烧录设备”。连接一块测试板；如果结果是 ADB，先按该板的操作步骤进入烧录模式。
2. **生成计划。** 下面以 CM5 为例，请把文件名换成自己的。在计划中核对设备模式、目标存储、固件绝对路径和 SHA-256。Loader 模式可读回当前存储；Maskrom 模式下还需根据板卡和固件确认启动介质。

   > 用 rockusb 为默认固件目录里的 debian12_xfce_20261111.img 准备整包烧录计划。请先显示目标设备、存储和固件校验值，等我确认。

3. **确认并跟踪任务。** 写入会覆盖目标介质上的数据。核对计划后让助手执行，在客户端表单勾选写入授权并确认。成功启动会返回新的 `job_id`。发送“用 flash_status 跟踪这个任务到结束”。同一计划仅可使用一次，有效期十分钟。
4. **验证开机。** 等任务达到 `backend_succeeded`，再从 HDMI 或串口登录板子。在板端运行以下命令，核对根分区和 Debian 版本。CM5 已实测根分区为 `/dev/mmcblk0p3`，系统为 Debian 12。

   ```sh
   findmnt -n -o SOURCE /
   cat /etc/os-release
   ```

如果返回 `cancelled` 且没有 `job_id`，本次写入尚未开始。检查客户端能否显示表单；在 Codex 切换为允许审批的模式后重新生成计划。排查时只跟踪当前任务 ID，避免把上一次的 100% 当作本次进度。

## 4. 可选安装方式

安装器将程序和 `mcp-config.json` 放在 `%LOCALAPPDATA%\ArmSoM\RockUSB`。若希望固件留在其他磁盘，可在解压目录运行 `.\Install-RockUSB.cmd --firmware-dir "D:\firmware"` 更新默认目录。对话中也可指定其他绝对路径，首次访问会请求读取授权。

离线安装时，先在联网电脑运行 `Install-RockUSB.cmd --stage-only --cache "E:\RockUSB-cache"`，再将发布包和该缓存一起带到目标电脑，运行 `Install-RockUSB.cmd --cache "E:\RockUSB-cache"`。两种安装方式使用相同的文件校验。

## 5. 烧录、维护和 SD 卡

| 操作 | 对话示例 | 输入与结果 |
| --- | --- | --- |
| USB 整包烧录 | “把这个 update.img 写入当前板子，再查进度。” | 识别 RKFW/RKAF 统一固件；Loader 模式核对当前介质，Maskrom 模式显示由固件选择启动介质。 |
| 读取与切换存储 | “列出 Loader 的存储，先告诉我哪一项带星号。” | 读取芯片信息、分区表、当前存储。切换操作单独确认，并回读核对结果。具体介质由 Loader 支持。 |
| 擦除与 Loader | “使用这份板厂固件准备整盘擦除。” | 整盘擦除使用 Maskrom；另支持下载匹配的 Loader 到 RAM、写入 Loader、重启或从 Loader 切换到 Maskrom。 |
| 分区操作 | “先备份 boot 分区，告诉我输出路径。” | 以设备分区表为准。备份保存在任务目录的 `partition.img`。可将大小匹配的原始分区镜像写入指定分区。 |
| SD 启动卡 | “列出电脑读卡器里的卡，把这个固件制作成启动卡。” | 选择可移动卡的编号和标识，确认后写入并校验。板卡及固件需要支持从 SD 启动。 |
| SD 升级卡 | “用这份固件制作供设备自行升级的 SD 卡。” | 固件须小于 4 GiB，并配有支持 SD 升级的板端 recovery。CM5 本次使用的 5.14 GB 固件超过该模式的上限。 |

执行前会重新计算暂存副本的哈希并核对目标。SD 制卡会覆盖选中的整张卡，Windows 会单独请求直接访问磁盘的权限。写入期间保持供电、线缆和读卡器连接。

后台任务保存在 `%USERPROFILE%\.local\state\rockusb-flash-mcp\<任务ID>`，设置 `XDG_STATE_HOME` 时使用该目录。USB 整包烧录需额外预留一份镜像大小的磁盘空间。任务完成后查看板卡是否启动到预期系统。Windows USB 整包烧录已有 CM5 真机记录；不同芯片、存储切换、擦除、分区写入和两种 SD 制卡仍需按板型做实物验收。

## 6. 从源码开发

在项目根目录用 Node.js 22 或更新版本执行以下命令。Windows x64 的打包命令会把当前 Node 运行时及对应许可证放入发布包。

```sh
npm ci --ignore-scripts
npm test
node scripts/build-windows.mjs
```

验证安装包时可用 `Install-RockUSB.cmd --stage-only --target "C:\Temp\RockUSB-test" --firmware-dir "C:\Temp\Firmware"`。该模式从零准备程序和下载项，生成 MCP 配置，跳过系统驱动安装和客户端注册。

Linux USB 主机可沿用命令行接入，准备 Node.js、util-linux 的 `flock`、具备 USB 访问权限的用户，以及带 `config.ini` 的厂商 Linux 烧录工具。路径均相对于连接 USB 的主机，删除 `--allow-flash` 可启用只读模式。

```sh
codex mcp add rockusb -- node "$PWD/server.mjs" --firmware-dir "$HOME/firmware" --upgrade-tool /opt/rockchip/upgrade_tool --ask-directory --allow-flash
```

本项目的 MCP 和安装脚本使用 MIT 许可证。Node.js 和各依赖保留各自许可证。安装程序按固定版本从上游获取烧录程序及驱动。硬件操作与适配条件见上游资料。[瑞芯微烧录命令](https://github.com/ArmSoM/rockchip-tools/blob/main/guides/en/upgrade-tool.md) · [SD 制卡方式](https://github.com/TheGammaSqueeze/rockchip_sd_tool)
