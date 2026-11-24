# RockUSB Flash MCP

[中文教程](README.zh-CN.md) · [Download for Windows x64 (ZIP)](https://github.com/Mycat-04/rockusb-flash-mcp/releases/download/v0.2.0/rockusb-flash-mcp-0.2.0-windows-x64.zip)

Give Codex or Claude Code the path to a firmware image on your PC. RockUSB can identify a connected Rockchip board, show the target storage, and flash the image after you approve it. USB flashing to eMMC and booting Debian 12 have been verified on an ArmSoM CM5 (RK3576). Use firmware built for your particular board.

## 1. Get started in Codex Desktop

Use a Windows x64 PC (Windows 10 1809 or later) with Codex Desktop installed. During private testing, sign in to GitHub with an account that can access this repository.

1. **Download the ZIP.** Follow **Download for Windows x64** above and choose **Extract All** in File Explorer.
2. **Double-click the installer.** Open `Install-RockUSB.cmd` in the extracted folder. Setup includes Node.js, downloads the flashing components, and registers RockUSB with Codex. Allow the Windows administrator prompt if a driver or runtime is needed.
3. **Check the connection in Codex.** Open **Settings → MCP servers** and check that `rockusb` is enabled. Start a new local chat and send the prompt below. A directory path and a file list, even an empty list, confirm the connection.

> Use rockusb's list_firmware to list the files in the default firmware directory.

You can run this check without a board. To test USB next, connect the board's flashing port with a data cable, enter Loader or Maskrom mode as described in the board manual, and ask “Use rockusb to identify the connected board and its USB mode.”

<details>
<summary>RockUSB is missing from Codex settings, or I want to add it manually</summary>

If you installed Codex later, double-click the installer again and reopen Codex. You can also add the local configuration in **Settings → MCP servers → Add server**.

Open `%LOCALAPPDATA%\ArmSoM\RockUSB` in File Explorer, open the installer's `mcp-config.json` in Notepad, and find `mcpServers.rockusb`.

| Codex field | Value |
| --- | --- |
| Name / Type | Enter `rockusb` and choose **STDIO**. |
| Launch command | Use the full path to `node.exe` from `command`. |
| Arguments | Use **Add argument** for each value in `args`, in order. A path containing spaces is one argument. |
| Working directory and environment variables | Leave empty. |

When copying JSON strings, omit the surrounding quotes and replace each escaped `\\` in a path with a single `\`. Select **Save**, start a new chat, and try the read-only prompt above. [Codex MCP settings](https://learn.chatgpt.com/docs/developer-settings)

</details>

## 2. Use Claude Code

The same ZIP registers RockUSB with Claude Code when it is installed on the PC. Double-click the installer, start a new Claude Code session, enter `/mcp`, and check that `rockusb` is connected. Try the same read-only prompt. If you installed Claude Code later, double-click the installer again. Writes require a client that supports interactive MCP confirmation. [Claude Code MCP guide](https://code.claude.com/docs/en/mcp)

## 3. Flash and verify a test board

Put the unpacked image in `%USERPROFILE%\Firmware` or give its absolute path in chat. RockUSB asks for read access the first time you select another directory. In Codex, choose an interactive approval mode so the write confirmation can appear. [Codex approval policy](https://developers.openai.com/codex/config-reference/#approval_policy)

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

To verify the ZIP, run `Get-FileHash .\rockusb-flash-mcp-0.2.0-windows-x64.zip` in its folder and compare the hash with the accompanying `.sha256` file. [Release assets](https://github.com/Mycat-04/rockusb-flash-mcp/releases/tag/v0.2.0)

For offline installation, run `Install-RockUSB.cmd --stage-only --cache "E:\RockUSB-cache"` on a connected PC. Copy the ZIP and cache to the offline PC and run `Install-RockUSB.cmd --cache "E:\RockUSB-cache"`. To set another default firmware directory, run `Install-RockUSB.cmd --firmware-dir "D:\firmware"` from the extracted folder.

Setup configures detected Codex and Claude Code installations for the current user. To select one, run `Install-RockUSB.cmd --client codex` or `--client claude`. The permanent program and the stdio settings for other clients are in `%LOCALAPPDATA%\ArmSoM\RockUSB`. Firmware outside the default directory can be selected through an interactive, session-scoped directory grant.

- **Board appears as ADB** — boot the board into its flashing mode and list devices again.
- **Confirmation unavailable** — use a client supporting MCP form elicitation. Each destructive plan needs its own confirmation.
- **Connection interrupted** — inspect the existing job with `flash_status` before retrying. Logs live under `~/.local/state/rockusb-flash-mcp/<job-id>` by default. Allow free space for an extra copy of the firmware.

## Development and license

Install Node.js 22 or later, run `npm ci --ignore-scripts`, then `npm test`. To build the Windows release on x64 Windows, run `npm run build:windows`. Linux USB hosts can run the stdio server with a local Linux `upgrade_tool`, USB permissions and util-linux `flock`.

The MCP server and installer use the MIT license. External drivers, tools and runtime components retain their upstream terms. The installer verifies downloads before use. [Rockchip USB tools maintained by ArmSoM](https://github.com/ArmSoM/rockchip-tools) · [Rockchip SD Tool](https://github.com/TheGammaSqueeze/rockchip_sd_tool)
