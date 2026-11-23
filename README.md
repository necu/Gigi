# Gigi

Gigi is a desktop app for browsing, streaming and downloading movies, TV series and anime. It is built with Electron, React and SQLite, with a local library, playlists, downloads, watch history and a built-in player.

Gigi is a rebranded distribution based on [Streambert](https://github.com/truelockmc/streambert) by truelockmc, and remains licensed under the GNU GPL v3.0.

## Features

- Stream movies, TV series and anime from third-party sources.
- Download streams and manage the download queue.
- Keep a local library with watch history, progress, ratings and playlists.
- Discover trending titles and personalized recommendations.
- Search with a command palette and smart library filters.
- Download and manage subtitles.
- Customize themes, accents, home layout and playback settings.
- Ad and tracker blocking built into the player.

## Requirements

- [Node.js](https://nodejs.org/) 22.12.0 or newer when building from source.
- A free TMDB API Read Access Token. Follow the [TMDB guide](tmdb-tutorial.md).
- For downloads: `ffmpeg` and [vid-dl-cli-only](https://github.com/truelockmc/vid-dl-cli-only/releases/latest).

## Getting started

On first launch, paste your TMDB Read Access Token into the setup screen. It is stored locally and is only needed once.

### Windows

Download `Gigi Setup *.exe` from the [releases page](https://github.com/necu/Gigi/releases/latest).

### Linux

Build or download the `.deb`, `.rpm`, `.pacman` or `.AppImage` package from the [releases page](https://github.com/necu/Gigi/releases/latest).

```bash
# Debian / Ubuntu
sudo dpkg -i gigi_*.deb

# Arch Linux
sudo pacman -U gigi-*.pacman

# AppImage
chmod +x Gigi-x64.AppImage && ./Gigi-x64.AppImage
```

### macOS

Download the latest `.dmg` from the [releases page](https://github.com/necu/Gigi/releases/latest), open it and drag Gigi into Applications.

## Building from source

```bash
npm install
npm run dist:win      # Windows installer
npm run dist:linux    # Linux packages
npm run dist:mac      # macOS package
```

For development, use `npm start` to build the renderer and launch Electron.

## Data compatibility

Gigi keeps the existing `streambert_` local-storage namespace, SQLite database names and application data directory. Updating from Streambert therefore preserves the library, playlists, settings, downloads and watch history.

## Credits and license

Gigi is based on Streambert, originally created by [truelockmc](https://github.com/truelockmc). The original project and this distribution are free software under the [GNU General Public License v3.0](LICENSE). Modified versions must remain open source under the same license.

## Privacy disclaimer

Gigi does not operate a centralized service and does not intentionally collect analytics. Third-party metadata, stream and download providers may still collect data according to their own policies.

## Legal disclaimer

This application is provided for educational and personal use only.

- Gigi does not host, store or distribute copyrighted content.
- Content is sourced from third-party providers.
- Users are responsible for complying with the laws in their jurisdiction and for having the rights to access any content.
- The developers do not endorse or encourage copyright infringement.
