# Third-party components

RockUSB Flash MCP's server and installer are distributed under the [MIT license](LICENSE).

The Windows ZIP includes the Node.js runtime. Its license and third-party notices are in `NODE-LICENSE.txt`. The application payload includes the npm dependencies listed in `package-lock.json`; their license and notice files are preserved in `node_modules`. The installed application directory contains these files together with the runtime license.

## Components retrieved by Windows setup

The installer downloads the following components to the user's PC and verifies the pinned SHA-256 hashes in [setup-windows.mjs](https://github.com/Mycat-04/rockusb-flash-mcp/blob/main/scripts/setup-windows.mjs). Their upstream terms apply.

| Component | Purpose and upstream information |
| --- | --- |
| Rockchip Upgrade Tool and RockUSB driver | USB operations in Loader or Maskrom mode. [Versioned ArmSoM tools archive](https://github.com/ArmSoM/rockchip-tools/tree/9737320c3a906fc4bcf25edf222258e80fc00c5b/downloads) |
| Android SDK Platform-Tools | The ADB client for switching a running device to Loader. Setup preserves Google's `NOTICE.txt`. [Google downloads and SDK license](https://developer.android.com/tools/releases/platform-tools) |
| Rockchip SD Tool | Creates Rockchip SD cards with a PC reader. [Upstream source and MIT license](https://github.com/TheGammaSqueeze/rockchip_sd_tool/tree/v1.3.1) |
| Microsoft Visual C++ Redistributable | Runtime libraries for the Windows tools. Setup verifies the Microsoft signature and starts the installer when the runtime is required. [Microsoft distribution information](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) |
