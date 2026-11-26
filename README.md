# RockUSB Flash MCP

[中文](README.zh-CN.md) · [Download for Windows x64](https://github.com/Mycat-04/rockusb-flash-mcp/releases/latest)

Flash Rockchip boards from a local Codex or Claude Code chat. For example, say **“Flash `D:\Firmware\update.img` to the eMMC on my board.”** RockUSB identifies the device and target storage, prepares the image, and asks you to confirm before writing. If more than one board or image matches, the assistant asks you to choose.

**Hardware-tested workflows include writing firmware to eMMC and making an SD boot card.** The maintainer has tested ArmSoM-CM5, ArmSoM-CM7S, ArmSoM-SIGE7S and ArmSoM-AIM5.

## Quick start on Windows

Use a Windows x64 PC with Codex Desktop or Claude Code installed. The ZIP includes Node.js. Setup downloads and checks the Rockchip driver, the command-line flashing tool and other required components. You can start on a PC with no Rockchip tools installed.

1. In [Releases](https://github.com/Mycat-04/rockusb-flash-mcp/releases/latest), download the asset ending in **`-windows-x64.zip`**. In File Explorer, select **Extract All**, then double-click **`Install-RockUSB.cmd`**. First-time installation requires internet access. Windows may ask for administrator permission to install the driver or runtime.
2. Open your local client. In **Codex Desktop**, check **Settings → MCP servers** for `rockusb`, then open a new chat. In **Claude Code**, open a new interactive session and enter **`/mcp`** to check the connection. If you install a client later, run the installer again. [Codex MCP guide](https://developers.openai.com/codex/mcp/) · [Claude Code MCP guide](https://code.claude.com/docs/en/mcp)
3. Ask **“Which images are in my default firmware folder?”** A directory path and file list, even an empty list, confirm the connection. This check works without a board.

### First USB flash

1. Extract the **board-specific Rockchip update image** and place it in `%USERPROFILE%\Firmware`, or give its absolute path on the PC. The tool can request session-scoped read access to another directory. Allow room for a temporary copy of the image.
2. Connect the board’s **OTG flashing port** to the PC with a USB data cable and power the board as specified by its manufacturer. Ask **“Show the plan for writing update.img to eMMC.”** If the board is running Linux, ask **“Put my board in Loader mode”** or simply request the flash. The assistant can obtain approval for the reboot and continue with the same firmware.
3. Say **“Flash update.img to eMMC.”** Check the USB location or serial, storage, file path and SHA-256 in the confirmation form. Approve the write only for the intended board. It overwrites the partitions in the image. Keep power and USB connected until the job finishes.
4. Ask **“How is the flash progressing?”** After `backend_succeeded`, boot the board and log in via HDMI or serial. On Linux, check the running OS and root device:

   ```sh
   cat /etc/os-release
   findmnt -n -o SOURCE /
   ```

### Getting a running board into Loader

| Connection | What to do |
| --- | --- |
| The board already appears in Loader | Keep it connected. The assistant can read the active storage immediately. |
| USB ADB | Keep the OTG cable on the same USB port. The device must expose Rockchip USB ADB and permit `reboot loader`. For an `unauthorized` device, accept the board's ADB prompt if available. |
| A USB debug adapter such as CH340 and an OTG data cable | Log in to an idle Linux **root** shell on the serial console and release the port. The board must use systemd and support `systemctl reboot loader`. The default baud rate is `1500000`. Specify another in chat if needed. The assistant asks before rebooting and checks the new Loader against the board identity. |
| No working software route | Use the board manufacturer's recovery procedure. If only Maskrom appears, a whole-firmware write uses the medium selected by the firmware. A request for a specific medium, such as eMMC, requires a Loader that can report the active storage. |

### Make an SD boot card on a PC

1. Insert the card into a Windows card reader. Ask **“List the removable cards and show their capacities.”** Choose a card you can overwrite. The board can stay disconnected.
2. Ask **“Make an SD boot card from my update.img.”** Review the disk number, card identity, capacity and firmware in the confirmation form. Confirm the write and approve the Windows administrator prompt.
3. Wait for the job to finish before ejecting the card. Insert it into the powered-off board and follow the board’s SD boot procedure. After booting Linux, check the root device with `findmnt -n -o SOURCE /`.

## Other operations

| Ask the assistant | Input and result |
| --- | --- |
| “List connected boards and show this board's storage and partitions.” | Lists devices and modes. A running Loader provides its storage menu and partition table. |
| “Switch this Loader to eMMC.” | Selects a target offered by that Loader, requests confirmation, then reads back the active medium. |
| “Back up the boot partition.” / “Write this raw image to boot.” | Uses the exact partition name and size reported by the device. A backup is saved as `partition.img` in the job directory. |
| “Download this RAM Loader.” / “Erase this device.” | The RAM Loader and whole-device erase operations require Maskrom and a board-matched Loader `.bin` or unified firmware, respectively. Other operations include programming the Loader, rebooting, and entering Maskrom from Loader. |
| “Make an SD boot card.” / “Make an SD upgrade card.” | Select an eligible removable card in a **Windows PC card reader**. Either operation overwrites the entire card. A boot card requires board and firmware support for SD boot. An upgrade card requires firmware smaller than 4 GiB and board recovery that supports SD updates. |

Whole-firmware USB flashing and both SD modes accept unpacked **RKFW** firmware containing an **RKAF** package. Raw disk images and compressed downloads require a different workflow. Choose firmware for the exact board and storage configuration.

For a **partition backup**, allow free space on the PC for the entire partition. RockUSB checks the saved file length against the device's partition table. For a **raw partition write**, allow roughly twice the input image size in the job directory for staging and sector-aligned readback. RockUSB reads back the written range and compares the SHA-256 over the original image length before reporting success.

## Hardware results

The maintainer tested the four boards below. The workflows tested include flashing firmware to eMMC and creating an SD boot card with a host card reader.

| Board | Hardware test record |
| --- | --- |
| ArmSoM-CM5 | On a CM5 IO (RK3576), a Windows x64 host wrote a 5,143,798,403-byte Debian 12 XFCE image to eMMC over USB Loader. After reboot, the board ran kernel `6.1.118-rk3576` with `/dev/mmcblk0p3` as its root filesystem. |
| ArmSoM-CM7S | Tested on hardware by the maintainer. |
| ArmSoM-SIGE7S | The maintainer ran `systemctl reboot loader` from the Linux serial console. After the board restarted, Windows detected it in USB Loader mode. |
| ArmSoM-AIM5 | Tested on hardware by the maintainer. |

Recovery-based SD upgrade cards, storage switching, erase and partition writes still need end-to-end results. To report yours, include the board, SoC, host OS, image source and checksum, target medium, job result and boot result. Remove personal paths and device serials before posting. [ArmSoM CM5](https://docs.armsom.org/armsom-cm5) · [ArmSoM image flashing guide](https://docs.armsom.org/getting-start/flash-img)

## Setup and troubleshooting

<details>
<summary>Register RockUSB manually in Codex Desktop</summary>

Open `%LOCALAPPDATA%\ArmSoM\RockUSB\mcp-config.json` and find `mcpServers.rockusb`. In **Settings → MCP servers → Add server**, set the name to `rockusb`, select **STDIO**, and copy the executable from `command`. Add each item from `args` as a separate argument, in order. When copying a JSON path into a field, omit the surrounding quotes and use one backslash for each escaped pair. Leave the working directory and environment empty. Save and open a new chat.

</details>

<details>
<summary>The confirmation form did not appear</summary>

Ask **“Run `server_status` and show whether RockUSB is configured to write and whether this client advertises confirmation forms.”** This read-only check also reports the server version. Check the chat's selected approval mode in the client itself.

RockUSB requires a client that supports interactive MCP forms. In Codex Desktop, select **Ask for approval** for the flashing chat. With a custom permission profile, enable `approval_policy.granular.mcp_elicitations`. Codex's **Full access** preset uses the `never` approval policy. In Claude Code use an interactive session. [Codex permission modes](https://learn.chatgpt.com/docs/permission-modes) · [Codex configuration reference](https://developers.openai.com/codex/config-reference/) · [Claude Code elicitation](https://code.claude.com/docs/en/mcp#respond-to-mcp-elicitation-requests)

A `cancelled` result creates no job. Its reason distinguishes a client cancellation (`client_cancelled`), a decline (`client_declined`), or an unchecked authorization box (`authorization_unchecked`). After correcting the client setting, ask to continue with the same image. If you already have a job ID, check `flash_status` before retrying. Job files are under `~/.local/state/rockusb-flash-mcp/<job-id>` by default.

</details>

<details>
<summary>Check the ZIP, choose a firmware folder, or install offline</summary>

Compare the SHA-256 from PowerShell's `Get-FileHash` with the matching `.zip.sha256` release asset. Run these optional commands from the extracted folder. Substitute the paths on your PC.

| Task | PowerShell command |
| --- | --- |
| Set a default firmware folder | `.\Install-RockUSB.cmd --firmware-dir "D:\Firmware"` |
| Register one client | `.\Install-RockUSB.cmd --client codex` or `.\Install-RockUSB.cmd --client claude` |
| Fill an offline cache on an online PC | `.\Install-RockUSB.cmd --stage-only --cache "E:\RockUSB-cache"` |
| Install on an offline PC | Copy the release ZIP and the full cache. Extract the ZIP, then run `.\Install-RockUSB.cmd --cache "E:\RockUSB-cache"`. |

</details>

## Development and Linux hosts

From the repository root, use Node.js 22 or later. The automated suite runs without a board.

```sh
npm ci
npm test
```

To build the release ZIP and checksum on Windows, use x64 Node.js and run `npm run build:windows`. On Linux, provide the distribution's USB permissions, util-linux `flock`, the Rockchip Linux `upgrade_tool` with its `config.ini`, and `adb` if needed. Storage switching uses the native `node-pty` module, which may need a C++ toolchain, Python and make at install time. For example, to register the local checkout with Codex on a Linux USB host:

```sh
mkdir -p "$HOME/Firmware"
codex mcp add rockusb -- node "$PWD/server.mjs" --firmware-dir "$HOME/Firmware" --upgrade-tool /opt/rockchip/upgrade_tool --ask-directory --allow-flash
```

Omit `--allow-flash` for read-only use. Firmware paths are interpreted on the host where the MCP server runs. The MCP server and installer use the MIT license. External tools, drivers and runtime components retain their respective licenses. [MIT license](LICENSE) · [Third-party components and sources](THIRD-PARTY.md)
