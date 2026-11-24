# RockUSB Flash MCP

[中文安装与烧录教程](README.zh-CN.md) · [Download the Windows test release](https://github.com/Mycat-04/rockusb-flash-mcp/releases/tag/v0.2.0)

Flash a Rockchip board from Codex or Claude Code using a local firmware path and a USB cable. The MCP server runs on the PC connected to the board. It identifies the device, hashes the firmware, presents a plan for your approval, and reports the backend result. The Windows installer includes Node.js and obtains the pinned flashing components automatically.

## 1. Install on Windows x64

1. Install and sign in to Codex Desktop, Codex CLI, or Claude Code on Windows 10 (1809+) or Windows 11 x64. During private testing, sign in to GitHub with an account that can access this repository.
2. In the release **Assets**, download and extract `rockusb-flash-mcp-0.2.0-windows-x64.zip`. To verify the download, compare `Get-FileHash .\rockusb-flash-mcp-0.2.0-windows-x64.zip` in PowerShell with the accompanying `.sha256` file.
3. Double-click **Install-RockUSB.cmd**. Setup includes Node.js, verifies the flashing components and registers detected clients. Approve the Windows administrator prompt if asked to install the Rockusb driver or Microsoft runtime.
4. Put a board-matched, unpacked firmware image in `%USERPROFILE%\Firmware`. You can also set a different default directory by running `.\Install-RockUSB.cmd --firmware-dir "D:\firmware"` from the extracted folder.

For an offline setup, run `Install-RockUSB.cmd --stage-only --cache "E:\RockUSB-cache"` on a connected PC first. Copy the ZIP and cache to the other PC and run `Install-RockUSB.cmd --cache "E:\RockUSB-cache"`. Setup validates the same hashes in either case.

## 2. Connect your client

### Codex Desktop or CLI

Look for `Registered rockusb for codex` in the installer output, then open a **new chat**. Desktop users can go straight to the read-only prompt below. CLI users can also run `codex mcp get rockusb`. If you installed Codex after the MCP, open PowerShell in the extracted folder and run `.\Install-RockUSB.cmd --client codex`.

> Use rockusb's list_firmware to list the files in the default firmware directory. Only list files.

This check also works with the board disconnected. For writes, choose an interactive approval mode. In a Codex session running with `approval_policy = "never"`, inspection can work while the write confirmation returns `cancelled`. [Codex MCP](https://developers.openai.com/codex/mcp/) · [Approval policy](https://developers.openai.com/codex/config-reference/#approval_policy)

### Claude Code

Look for `Registered rockusb for claude`. If setup ran before Claude Code was installed, run `.\Install-RockUSB.cmd --client claude` from the extracted folder. Open a fresh PowerShell and run:

```powershell
claude mcp get rockusb
claude
```

In the Claude Code session, enter `/mcp` and check that `rockusb` is connected. Then try the same read-only prompt above. Setup registers the service at user scope, so you can use it across projects. Writes require support for interactive MCP form elicitation. [Claude Code MCP](https://code.claude.com/docs/en/mcp)

## 3. Flash and verify a test board

1. Connect one board's USB flashing port to this PC with a data cable. Enter Loader or Maskrom per the board manual. Ask **“Use rockusb's list_devices to identify my board.”** An ADB device has already booted its OS and needs to be switched to flashing mode.
2. Ask **“Prepare to flash debian12_xfce_20261111.img from the default directory. Show the USB device, target storage, firmware path and SHA-256. Wait for my confirmation.”** Substitute your own filename. In Loader mode the plan reports the active storage. In Maskrom confirm the boot medium against the board and firmware.
3. Check the plan, request execution, then authorize the write in the client form. This replaces data on the target. Keep USB and power connected. Ask the assistant to track the new `job_id` with `flash_status`. A cancelled call without a job ID has started no write. After changing approval settings, generate a fresh plan.
4. After `backend_succeeded`, log in via HDMI or serial and run `findmnt -n -o SOURCE /` and `cat /etc/os-release`. Compare the root device and OS with the expected image.

## What can I flash?

| Task | Requirement |
| --- | --- |
| Whole-device USB upgrade | A board-matched, unpacked RKFW image containing an RKAF partition package. An `.img` extension alone does not establish compatibility. |
| Device maintenance | Inspect the active Loader storage and partition table, select a storage target, back up or write a named partition, download a matching RAM Loader, program the Loader, erase the medium, or reboot. Available actions depend on device mode and Loader capabilities. |
| SD boot card | An eligible removable card in a Windows host reader and firmware supporting SD boot. The card is overwritten. |
| Firmware update card | An RKFW image smaller than 4 GiB and a board recovery supporting SD firmware updates. The CM5 image listed below exceeds this limit. |

### Hardware validation

| Board | Verified path | Result |
| --- | --- | --- |
| ArmSoM CM5 IO, RK3576 | Windows x64 → USB Loader → eMMC. Debian 12 XFCE image, 5,143,798,403 bytes. | The backend reported success. After reboot, the board identified as CM5 IO, ran Debian 12 with kernel `6.1.118-rk3576`, and mounted `/dev/mmcblk0p3` as root. |

The CM5 trial covers whole-firmware USB flashing. SD cards, storage switching, erasure and partition writes still need hardware validation. To contribute a board result, include board and SoC, host OS, USB mode, storage, firmware source/checksum, the backend result, and what booted afterward. Omit USB serial numbers. [ArmSoM CM5 hardware](https://docs.armsom.org/armsom-cm5) · [ArmSoM flashing guide](https://docs.armsom.org/getting-start/flash-img)

## Client registration and diagnostics

Setup configures detected Codex and Claude Code installations for the current user. To select one, run `Install-RockUSB.cmd --client codex` or `--client claude`. The permanent program and the stdio settings for other clients are in `%LOCALAPPDATA%\ArmSoM\RockUSB`. Firmware outside the default directory can be selected through an interactive, session-scoped directory grant.

- **Board appears as ADB** — boot the board into its flashing mode and list devices again.
- **Confirmation unavailable** — use a client supporting MCP form elicitation. Each destructive plan needs its own confirmation.
- **Connection interrupted** — inspect the existing job with `flash_status` before retrying. Logs live under `~/.local/state/rockusb-flash-mcp/<job-id>` by default. Allow free space for an extra copy of the firmware.

## Development and license

Install Node.js 22 or later, run `npm ci --ignore-scripts`, then `npm test`. To build the Windows release on x64 Windows, run `npm run build:windows`. Linux USB hosts can run the stdio server with a local Linux `upgrade_tool`, USB permissions and util-linux `flock`.

The MCP server and installer use the MIT license. External drivers, tools and runtime components retain their upstream terms. The installer verifies downloads before use. [Rockchip USB tools maintained by ArmSoM](https://github.com/ArmSoM/rockchip-tools) · [Rockchip SD Tool](https://github.com/TheGammaSqueeze/rockchip_sd_tool)
