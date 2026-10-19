# FreeLib

A book reading and collection tracker.

---

## Overview

Add a book by scanning its barcode and the details are filled in automatically, as far as the plugins can find them. Anything they miss you fill in by hand.

- Reading status and history per book
- Authors, tags, series, categories, and shelves
- Notes per book
- Search, filters, and sorting 
- Covers stored locally
- Backup and restore
- Import your library from Goodreads (CSV export)
- Light and dark themes

Built with Tauri, React and Rust. Focused on mobile but works on desktop too.

## Download

Get the latest version from the [Releases page](https://github.com/Julius-IX/FreeLib/releases/latest).

| Platform | Download     |
| -------- | ------------ |
| Android  | `.apk`       |
| Windows  | `-setup.exe` |
| Linux    | `.AppImage`  |

macOS and iOS aren't distributed as a download. You can build them yourself, see [Building](#building).

FreeLib isn't on the Play Store or F-Droid. Downloads come from the Releases page only.

## Install

**Android:**

1. Download the `.apk` on your phone and open it. Android will ask you to allow installs from this source the first time.
2. Google Play Protect may warn that the app is unrecognized, or block the install, because FreeLib isn't distributed through the Play Store. Tap *More details → Install anyway*.
3. If there's no *Install anyway* option, turn off *Scan apps with Play Protect* temporarily (Play Store → your profile icon → Play Protect → settings), install the app, then turn it back on. Menu names vary a little between devices.

**Windows:** Run the installer. If SmartScreen warns about an unknown publisher, choose *More info → Run anyway*.

**Linux:** Make the AppImage executable and run it:

```sh
chmod +x FreeLib*.AppImage
./FreeLib*.AppImage
```

If it won't start on Ubuntu, install FUSE 2 (`sudo apt install libfuse2`, or `libfuse2t64` on Ubuntu 24.04) or build the package yourself, see [Building](#building).

To scan barcodes with a webcam on Linux you also need a few GStreamer packages, see [Linux: camera requirements](#linux-camera-requirements).

### Updates

The app checks GitHub for a newer version when it starts and shows a notice if there is one. You can turn this off, or check manually, under *Settings → Updates*.
To update, download the new version from the Releases page and install it over the old one (on Linux, replace the old AppImage). Your library is kept.

## Plugins

Book details come from lookup plugins. Every enabled plugin runs on a scan and their results are merged. When two plugins fill the same field, the earlier one wins. Lists like authors and tags are combined.

| Plugin       | Notes                                      |
| ------------ | ------------------------------------------ |
| Open Library | No setup needed                            |
| Google Books | Needs your own API key, see below          |

Plugins can fill title, publish date, page count, authors, tags, series, blurb and cover. Turn them on and off in the Plugins tab.

Google Books shares an anonymous quota that is usually used up, so add a free API key from the [Google Cloud console](https://console.cloud.google.com). In the Plugins tab, open the settings next to Google Books and set:

```json
{ "apiKey": "your-key" }
```

You can also bake it in at build time with `GOOGLE_BOOKS_API_KEY=your-key`. The saved setting wins.

## Writing a Plugin

A plugin is a single `.js` file that runs in a sandboxed JS engine. It has no network or file access except `http.get`, and only to the hosts listed in its manifest.

```js
const manifest = {
  id: "example",
  name: "Example",
  version: "1.0.0",
  permissions: { http: ["example.com"] },
};

plugin.register(({ isbn }, http) => {
  const res = http.get(`https://example.com/books/${isbn}`);
  return { title: JSON.parse(res.body).title };
});
```

Install it with the + button in the Plugins tab. The file is copied into the app's data directory and loaded right away.
Plugins you installed can be removed from the same tab. A plugin with a built-in's id replaces it, and removing it brings the built-in back.
See [`src-tauri/plugins/openlibrary.js`](src-tauri/plugins/openlibrary.js) for a full example.

## Building

Requires Node.js 24 or newer, Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```sh
npm install
npm run tauri dev
```

Release build:

```sh
npm run tauri build
```

For more detailed instructions see [Tauri docs](https://v2.tauri.app/distribute/).

## Linux: camera requirements

On Linux, the desktop barcode scanner uses the webcam through WebKitGTK, which relies on
GStreamer for camera capture. Most distros don't install the needed GStreamer plugins by
default, so they must be installed manually. Without them the scanner can't start the camera.

Install the packages for your distro, then restart the app:

**Debian / Ubuntu**

```sh
sudo apt install gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-libav \
  gstreamer1.0-pulseaudio gstreamer1.0-pipewire
```

**Fedora**

```sh
sudo dnf install gstreamer1-plugins-base gstreamer1-plugins-good \
  gstreamer1-plugins-bad-free gstreamer1-plugin-libav
```

**Arch**

```sh
sudo pacman -S gst-plugins-base gst-plugins-good gst-plugins-bad \
  gst-libav gst-plugin-pipewire
```

If the camera still can't be opened, make sure it appears under `/dev/video*` and that your
user is in the `video` group.

In a Wayland session the app runs through XWayland by default, because
WebKitGTK's native Wayland backend can freeze the whole UI while the camera opens. To run
natively anyway, turn off *Settings → Linux → Use X11 on Wayland* and restart the app. If
`GDK_BACKEND` is set in your environment, it wins over this setting.
