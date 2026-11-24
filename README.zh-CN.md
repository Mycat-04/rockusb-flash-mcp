# RockUSB Flash MCP

[English](README.md) · [下载 Windows x64 测试包（ZIP）](https://github.com/Mycat-04/rockusb-flash-mcp/releases/download/v0.2.0/rockusb-flash-mcp-0.2.0-windows-x64.zip)

在 Codex 或 Claude Code 里告诉助手固件放在哪里，就可以查看连接的 Rockchip 开发板、核对目标存储并烧录。已在 ArmSoM CM5（RK3576）验证 Windows 经 USB 写入 eMMC 并启动 Debian 12。使用其他板型时，请选用该板厂提供的匹配固件。

## 1. 在 Codex 桌面版开始使用

准备一台已安装 Codex 桌面版的 Windows x64 电脑（Windows 10 1809 或更新版本）。测试期间，请用有仓库访问权限的账号登录 GitHub。

1. **下载安装包。** 点击上方的 **下载 Windows x64 测试包**，在资源管理器中选择 **全部解压**。
2. **双击安装。** 在解压目录双击 `Install-RockUSB.cmd`。安装器自带 Node.js，会下载烧录组件并注册到 Codex。首次安装驱动或运行库时，按 Windows 提示授权。
3. **在 Codex 中验证。** 打开 **设置 → MCP 服务器**，确认 `rockusb` 已启用。新建一个本地聊天，发送下面这句话。返回目录路径和文件列表就表示接入成功，目录为空也算成功。

> 用 rockusb 的 list_firmware 列出默认固件目录里的文件。

这一步可以先不接板子。准备测试硬件时，用 USB 数据线连接开发板的烧录口，按板卡手册进入 Loader 或 Maskrom 模式，再问：“用 rockusb 查看现在连接的开发板和 USB 模式。”

<details>
<summary>Codex 设置里找不到 rockusb，或想手动添加</summary>

如果 Codex 是后安装的，先重新双击安装器，再重新打开 Codex。也可以直接在 **设置 → MCP 服务器 → 添加服务器** 中填写本机配置。

在资源管理器地址栏打开 `%LOCALAPPDATA%\ArmSoM\RockUSB`，用记事本打开安装器生成的 `mcp-config.json`，找到 `mcpServers.rockusb`，按下表填写。

| Codex 字段 | 填写内容 |
| --- | --- |
| 名称 / 类型 | 名称填 `rockusb`，类型选 **STDIO**。 |
| 启动命令 | 填 `command` 中的 `node.exe` 完整路径。 |
| 参数 | 用 **添加参数** 将 `args` 数组中的值依次各填一项。含空格的路径也是一项。 |
| 工作目录、环境变量 | 留空。 |

复制 JSON 字符串时去掉两端引号，把路径中的 `\\` 写成单个 `\`。点击 **保存** 后新建聊天，用上面的只读请求验证。[Codex MCP 设置](https://learn.chatgpt.com/docs/developer-settings)

</details>

## 2. 在 Claude Code 中使用

已安装 Claude Code 的电脑可以使用同一个 ZIP。双击安装器后，打开新的 Claude Code 会话，输入 `/mcp`，确认 `rockusb` 已连接，再发送上面的只读请求。若先装了 RockUSB，装好 Claude Code 后再双击一次安装器即可。烧录需要客户端支持 MCP 交互确认。[Claude Code MCP 指南](https://code.claude.com/docs/en/mcp)

## 3. 从预检到开机验收

镜像可以放入安装器创建的 `%USERPROFILE%\Firmware`，也可以在对话中给出完整路径。首次访问其他目录时会弹出读取授权。Codex 烧录时请使用允许**请求批准**的模式，以便看到写入确认框。[Codex 审批策略](https://developers.openai.com/codex/config-reference/#approval_policy)

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

如需校验下载，在 ZIP 所在目录运行 `Get-FileHash .\rockusb-flash-mcp-0.2.0-windows-x64.zip`，与测试版附件中的 `.sha256` 对照。[测试版附件](https://github.com/Mycat-04/rockusb-flash-mcp/releases/tag/v0.2.0)

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
