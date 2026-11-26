# RockUSB Flash MCP

[English](README.md) · [下载 Windows x64 安装包](https://github.com/Mycat-04/rockusb-flash-mcp/releases/latest)

RockUSB 让你在本地 Codex 或 Claude Code 对话中烧录 Rockchip 开发板。例如，直接说 **“帮我把 `D:\Firmware\update.img` 烧到板子的 eMMC”**。助手会识别开发板、核对目标存储和固件，请你确认后再写入。遇到多块板子或多个同名文件时，会先列出候选项供你选择。

**已在真机验证向 eMMC 烧录固件和制作 SD 启动卡。** 维护者测试过的板型包括 ArmSoM-CM5、ArmSoM-CM7S、ArmSoM-SIGE7S 和 ArmSoM-AIM5。

## 在 Windows 上接入 RockUSB

在连接开发板或读卡器的 Windows x64 电脑上，从以下方式中任选一种。首次安装需要联网。

### 一条命令安装

已安装 x64 版 Node.js 22 或更新版本及 npm 的用户，在 PowerShell 执行以下命令。安装器会准备烧录工具、检查 USB 驱动和运行库，并自动注册到检测到的客户端。首次安装驱动或运行库时，按 Windows 提示授权。

```powershell
npx.cmd --yes https://github.com/Mycat-04/rockusb-flash-mcp/releases/download/v0.5.0/rockusb-flash-mcp.tgz install
```

**电脑上还没有 Node.js？** 下载并双击 [RockUSB-Setup.exe](https://github.com/Mycat-04/rockusb-flash-mcp/releases/download/v0.5.0/RockUSB-Setup.exe) 即可，安装器自带 Node.js。如果只想注册一个客户端，可在安装命令末尾加 `--client codex` 或 `--client claude`。

### 在客户端内直接配置

如果希望由客户端管理 RockUSB，先安装 x64 版 Node.js 22 或更新版本及 npm，再按下表选择客户端。RockUSB 在这台电脑上运行，可访问本机的 USB 接口和读卡器。

| 客户端 | 配置方法 |
| --- | --- |
| **Codex 桌面版** | 打开 **设置 → MCP 服务器 → 添加服务器**，类型选 **STDIO**，名称填 `rockusb`，启动命令填 `npx`。依次添加三个参数，**每项单独一行**：`--yes`、`https://github.com/Mycat-04/rockusb-flash-mcp/releases/download/v0.5.0/rockusb-flash-mcp.tgz`、`serve`。保存后新建聊天。 |
| **Claude Code** | 在 2.1.275 或更新版本的交互会话中执行 `/plugin install rockusb --marketplace Mycat-04/rockusb-flash-mcp`。新开会话，输入 `/mcp` 查看连接。支持插件的旧版本可依次执行 `/plugin marketplace add Mycat-04/rockusb-flash-mcp` 和 `/plugin install rockusb@rockusb-tools`。 |

客户端首次启动时会下载指定版本的 MCP。在 Windows 上，首次执行硬件操作时才下载并校验对应工具。如果新电脑缺少 USB 驱动或 Visual C++ 运行库，在上方安装命令末尾加 `--client none` 执行一次，即可保留现有客户端配置并补齐组件。[Codex MCP 指南](https://developers.openai.com/codex/mcp/) · [Claude Code 插件指南](https://code.claude.com/docs/en/discover-plugins)

**验证是否接入成功。** 在新会话中发送 **“用 `server_status` 查看 RockUSB 版本，再列出默认固件目录里的镜像。”** 返回版本 `0.5.0` 和文件列表即表示连接成功。空目录也能验证，这一步无需接板。

### 第一次通过 USB 烧录

1. 将**与板型匹配的 Rockchip 升级固件**解压到 `%USERPROFILE%\Firmware`，也可以在聊天时指定电脑上的完整路径。访问其他目录时，可以按提示授权本次会话读取该目录。电脑需留出至少一份固件副本的空间。
2. 用 USB 数据线将板子的 **OTG 烧录口**接到电脑，按板卡手册供电。可以先问 **“给我看把 update.img 烧到 eMMC 的计划。”** 如果板子还在运行 Linux，可以说 **“帮我进入 Loader 模式”**，也可以直接要求烧录。助手会在需要时请求重启授权，并接着使用同一份固件。
3. 发送 **“帮我把 update.img 烧到 eMMC。”** 在确认框中核对 USB 位置或序列号、目标存储、文件路径和 SHA-256。勾选并确认后，会覆盖固件包含的分区。任务结束前保持供电和 USB 连接。
4. 发送 **“查看烧录进度。”** 任务显示 `backend_succeeded` 后，启动开发板，通过 HDMI 或串口登录。Linux 系统可用以下命令核对系统版本和根分区。

   ```sh
   cat /etc/os-release
   findmnt -n -o SOURCE /
   ```

### 运行中的开发板如何进入 Loader

| 当前连接 | 操作 |
| --- | --- |
| 已识别为 Loader | 保持连接，助手可直接读取当前目标存储。 |
| USB ADB | OTG 数据线保持在电脑的同一个 USB 口。板端需启用 Rockchip USB ADB，并允许执行 `reboot loader`。状态为 `unauthorized` 时，按板端提示授权。 |
| CH340 等 USB 调试串口，另接 OTG 数据线 | 在串口登录 Linux **root**，保持命令提示符空闲，再断开终端以释放串口。镜像需使用 systemd 并支持 `systemctl reboot loader`。默认波特率是 `1500000`，其他波特率可直接告诉助手。助手会先请求重启授权，再核对新出现的 Loader 是否属于原来的板子。 |
| 没有可用的软件切换方式 | 按板卡手册通过按键或引脚进入烧录模式。如果只检测到 Maskrom，整包写入的启动介质由固件选择。要核对 eMMC 等指定介质，需先进入能报告当前存储的 Loader。 |

### 在电脑读卡器上制作 SD 启动卡

1. 将卡插入 Windows 电脑的读卡器，发送 **“列出可移动卡和容量。”** 选择一张可以覆盖的卡。这一步无需连接开发板。
2. 发送 **“用我的 update.img 制作 SD 启动卡。”** 在确认框中核对磁盘号、卡的标识、容量和固件。确认写入后，按 Windows 提示授予管理员权限。
3. 等制卡任务完成后再弹出 SD 卡。开发板断电时插入卡，按板卡手册从 SD 启动。进入 Linux 后，用 `findmnt -n -o SOURCE /` 检查根分区。

## 其他操作

| 可以这样说 | 输入与结果 |
| --- | --- |
| “列出连接的板子，再看看这块板子的存储和分区。” | 列出设备及模式。运行中的 Loader 可报告存储选项和分区表。 |
| “把这块板子的目标存储切到 eMMC。” | 从 Loader 支持的介质中选择，单独确认切换后回读当前介质。 |
| “备份 boot 分区。”／“把这个原始镜像写到 boot 分区。” | 按设备实际分区名和容量处理。备份文件为任务目录中的 `partition.img`。 |
| “下载这个 Loader 到内存。”／“擦除这块板子。” | 在 Maskrom 下，下载到内存需要匹配的 Loader `.bin`，整盘擦除需要匹配的统一固件。还支持写入 Loader、重启和从 Loader 进入 Maskrom。 |
| “制作 SD 启动卡。”／“制作 SD 升级卡。” | 在 **Windows 电脑的读卡器**里选择可移动卡，确认后会覆盖整张卡。启动卡要求板卡和固件支持 SD 启动。升级卡要求固件小于 4 GiB，并且板端 recovery 支持 SD 升级。 |

USB 整包烧录和两种 SD 制卡都使用解压后的 **RKFW** 固件，其中应包含 **RKAF** 分区包。原始整盘镜像和压缩包需要使用相应的写盘或解压流程。选择固件时，请核对完整板型和目标存储配置。

**备份分区**时，请在电脑上为整个分区预留空间。RockUSB 会按分区表核对备份文件长度。**写入原始分区镜像**时，请在任务目录所在磁盘预留约两倍镜像大小的空间，分别用于暂存镜像和按扇区回读。工具会读回写入范围，按原始镜像长度比较 SHA-256，核对成功后再报告写入完成。

## 硬件实测记录

维护者在以下四款开发板上做过真机测试，测试项目包括向 eMMC 烧录固件和使用电脑读卡器制作 SD 启动卡。

| 开发板 | 实测记录 |
| --- | --- |
| ArmSoM-CM5 | 在 CM5 IO（RK3576）上，用 Windows x64 经 USB Loader 向 eMMC 写入 5,143,798,403 字节的 Debian 12 XFCE 固件。重启后运行内核 `6.1.118-rk3576`，根分区为 `/dev/mmcblk0p3`。 |
| ArmSoM-CM7S | 维护者已完成真机测试。 |
| ArmSoM-SIGE7S | 在运行中的 Linux 系统上通过调试串口执行 `systemctl reboot loader`，重启后 Windows 主机识别到 USB Loader。 |
| ArmSoM-AIM5 | 维护者已完成真机测试。 |

依赖 recovery 的 SD 升级卡、切换存储、擦除和分区写入仍待补充端到端实测记录。欢迎提交板型、SoC、电脑系统、固件来源及校验值、目标介质、任务结果和启动结果。公开反馈前请隐去个人路径和设备序列号。[ArmSoM CM5 产品文档](https://docs.armsom.org/zh/armsom-cm5) · [ArmSoM 系统镜像烧录指南](https://docs.armsom.org/zh/getting-start/flash-img)

## 设置与排查

如果客户端首次连接时因下载耗时而超时，将上方一条命令安装示例末尾的 `install` 换成 `--version`，在 PowerShell 中运行。看到版本号后再回到客户端连接即可。Codex 插件已将启动等待时间设为 180 秒。

<details>
<summary>通过 Codex 插件市场安装</summary>

执行 `codex plugin marketplace add Mycat-04/rockusb-flash-mcp`，在客户端的插件页面安装 **RockUSB**，也可以执行 `codex plugin add rockusb@rockusb-tools`。新建聊天即可使用。[Codex 插件市场说明](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)

</details>

<details>
<summary>没有看到确认框，怎么办？</summary>

先问 **“用 `server_status` 查看 RockUSB 是否配置为允许写入，以及客户端是否声明支持确认表单。”** 这项只读检查也会返回服务端版本。当前聊天实际选用的审批模式需在客户端中查看。

烧录需要客户端支持 MCP 交互表单。Codex 桌面版可在当前聊天的权限菜单选 **请求批准（Ask for approval）**。如需沿用自定义权限，可启用 `approval_policy.granular.mcp_elicitations`，再选择自定义配置。桌面版的 **完全访问** 预设采用 `never` 审批策略。Claude Code 请使用交互会话。[Codex 权限模式](https://learn.chatgpt.com/docs/permission-modes) · [Codex 配置参考](https://developers.openai.com/codex/config-reference/) · [Claude Code 交互表单](https://code.claude.com/docs/en/mcp#respond-to-mcp-elicitation-requests)

返回 `cancelled` 表示没有创建任务。`reason` 可区分客户端取消（`client_cancelled`）、拒绝（`client_declined`）和未勾选授权（`authorization_unchecked`）。调整设置后，说“继续烧录刚才的固件”即可重新生成计划。如果已经拿到任务 ID，先通过 `flash_status` 查原任务。任务文件默认位于 `~/.local/state/rockusb-flash-mcp/<任务ID>`。

</details>

<details>
<summary>校验安装包、更换固件目录或离线安装</summary>

使用 PowerShell 的 `Get-FileHash` 计算 ZIP 的 SHA-256，与同一发布版本的 `.zip.sha256` 附件核对。以下可选命令均在解压目录的 PowerShell 中执行，路径按实际情况替换。

| 目的 | PowerShell 命令 |
| --- | --- |
| 指定默认固件目录 | `.\Install-RockUSB.cmd --firmware-dir "D:\Firmware"` |
| 只注册一个客户端 | `.\Install-RockUSB.cmd --client codex` 或 `.\Install-RockUSB.cmd --client claude` |
| 在联网电脑上准备离线缓存 | `.\Install-RockUSB.cmd --stage-only --cache "E:\RockUSB-cache"` |
| 在离线电脑上安装 | 复制发布包和完整缓存，解压发布包后执行 `.\Install-RockUSB.cmd --cache "E:\RockUSB-cache"`。 |

</details>

## 源码开发与 Linux 主机

在仓库根目录使用 Node.js 22 或更新版本执行以下命令。自动化测试无需连接开发板。

```sh
npm ci
npm test
```

在 Windows x64 上使用 x64 Node.js 运行 `npm run build:windows` 可生成发布 ZIP 和校验文件。在 Linux 主机上使用时，需配置 USB 访问权限，准备 util-linux 的 `flock`、Rockchip Linux 版 `upgrade_tool` 及其 `config.ini`，需要 ADB 时另行安装 `adb`。存储切换使用原生模块 `node-pty`，Linux 安装依赖时可能需要 C++ 工具链、Python 和 make。例如，可在连接 USB 的 Linux 主机上将当前源码注册到 Codex。

```sh
mkdir -p "$HOME/Firmware"
codex mcp add rockusb -- node "$PWD/server.mjs" --firmware-dir "$HOME/Firmware" --upgrade-tool /opt/rockchip/upgrade_tool --ask-directory --allow-flash
```

如需只读模式，省略 `--allow-flash`。固件路径以运行 MCP 的主机为准。MCP 服务和安装脚本采用 MIT 许可证，外部工具、驱动和运行时沿用各自许可证。[MIT 许可证](LICENSE) · [第三方组件与来源](THIRD-PARTY.md)
