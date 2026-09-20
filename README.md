# Dockman

A Linux desktop app for controlling a local Docker Engine. It talks to `/var/run/docker.sock` — it does not install or replace the engine.

## Prerequisites

- Node.js 22+
- pnpm 11.15.0
- Rust (stable)
- Docker Engine, with your user in the `docker` group
- Tauri Linux deps, including `webkit2gtk-4.1`

On Arch, install (or later remove) the Tauri/build deps as one metapackage:

```bash
cd devel
makepkg -si
```

That is the same set as `webkit2gtk-4.1`, `base-devel`, `curl`, `wget`, `file`, `openssl`, `appmenu-gtk-module`, `libappindicator-gtk3`, `librsvg`, and `xdotool`. Run `sudo pacman -Syu` first if you want a full upgrade.

```bash
sudo pacman -Rns dockman-devel
```

Add your user to the `docker` group and log out and back in:

```bash
sudo usermod -aG docker "$USER"
```

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Install (Arch)

Builds a `pacman` package from this checkout and installs it. `makepkg` pulls `webkit2gtk-4.1` and the other runtime deps from the repos:

```bash
pnpm tauri:build
```

Same as `cd devel && DOCKMAN_PKG=app makepkg -si`. The package is `dockman`. Runtime WebKit/GTK come from the repos (and from `dockman-devel` if you already installed that).

```bash
sudo pacman -Rns dockman
```

## Features (v1)

- Dashboard with engine status and resource counts
- Containers: run, start, stop, pause, restart, rename, recreate, remove, logs, inspect, browse files, open a terminal (host app or in Dockman)
- Container overview: env, ports, mounts, networks; in-app terminal can restart
- Run options: command (from image CMD), mounts, network, restart policy, ports, env
- Images: pull, run as a container, inspect, remove, dangling marker
- Volumes and networks: create, inspect, remove
- Prune unused containers, images, and volumes; bulk delete from lists
- Usage hints for images, volumes, and networks
- Live search (`/`), `j`/`k` row movement, `Enter` to inspect
- Logs: timestamps, filter, copy
- Settings: text size, preferred terminal app, open in host app or Dockman

## Out of scope

Compose, image build, image layer history, resource charts, Kubernetes.
