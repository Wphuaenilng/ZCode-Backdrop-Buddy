# Third-Party Notices

BackdropBuddy 1.1.0 bundles or embeds the following third-party components.
Full license texts are shipped in the `licenses/` directory and, for source
components, in the referenced packages.

## Runtime components

### Node.js 22.22.2

- Copyright Node.js contributors. All rights reserved.
- License: MIT-style Node.js license, including third-party notices.
- Full text: `licenses/Node-LICENSE.txt`
- Used as the bundled kernel runtime (`runtime/node/node.exe`).

### Microsoft Edge WebView2 SDK 1.0.2903.40

- Copyright (C) Microsoft Corporation. All rights reserved.
- License: BSD-style Microsoft WebView2 SDK license.
- Full text: `licenses/WebView2-LICENSE.txt`
- Additional notices: `licenses/WebView2-NOTICE.txt`
- Shipped files: `Microsoft.Web.WebView2.Core.dll`,
  `Microsoft.Web.WebView2.Wpf.dll`, `WebView2Loader.dll`.
- The WebView2 Runtime itself is a separate Microsoft component and is not
  redistributed; the installer checks for it and points to Microsoft's
  download page when missing.

### .NET Framework 4.8 / WPF

- Part of the Windows/.NET Framework platform; not redistributed with this
  package. The application targets net48 and runs on the user's installed
  .NET Framework 4.8.

## Build-time components

The following packages are used to build the single-file UI. Their code is
embedded in `ui/dist/index.html` only to the extent emitted by the bundler.

### React 18.3.1 / React DOM 18.3.1

- Copyright (c) Facebook, Inc. and its affiliates.
- License: MIT
- Full text: `licenses/React-LICENSE.txt`

### Vite 5.4.21

- Copyright (c) 2019-present, VoidZero Inc. and Vite contributors.
- License: MIT (bundled dependencies under their own licenses).
- Full text: `licenses/Vite-LICENSE.md`

### @vitejs/plugin-react 4.3.4

- License: MIT
- Full text: `licenses/@vitejs-plugin-react-LICENSE.txt`

### vite-plugin-singlefile 2.0.3

- License: MIT
- Full text: `licenses/vite-plugin-singlefile-LICENSE.txt`

### Inno Setup 6.7.3

- Copyright (C) 1997-2026 Jordan Russell; portions Copyright (C) 2000-2026
  Martijn Laan.
- Inno Setup is free software used to produce `BackdropBuddy-Setup-1.1.0.exe`.
- License information: https://jrsoftware.org/islicense.php
- Inno Setup itself is not redistributed as a standalone product.

### ChineseSimplified.isl (Inno Setup translation)

- Maintainer: Zhenghan Yang (Kira), https://github.com/kira-96/Inno-Setup-Chinese-Simplified-Translation
- Copyright (c) 2019-2020 kirakira
- License: MIT
- Full text: `licenses/ChineseSimplified.isl-LICENSE.txt`
- Used only to localize the installer wizard.

## Optional external tools (not bundled)

### FFmpeg / FFprobe

BackdropBuddy can use a locally installed `ffmpeg` and `ffprobe` for video
thumbnails and image compression. They are **not** included in this package.
If the user installs them separately, their own licenses (the common Windows
builds are GPL builds) apply.

## Assets

The three sample themes (`assets/original.jpg`, `assets/original.mp4`,
`assets/测试233.jpg`) are provided by the project owner for use with
BackdropBuddy and are not third-party open-source assets.

## Host application

ZCode is a separate third-party product. BackdropBuddy does not include,
modify, or redistribute ZCode; it only interacts with a running ZCode renderer
through the Chrome DevTools Protocol at the user's direction.
