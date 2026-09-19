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

Remove them together (unused deps only):

```bash
sudo pacman -Rns dockman-devel
```

Then add your user to the `docker` group and log out and back in:

```bash
sudo usermod -aG docker "$USER"
```

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Features (v1)

- Dashboard with engine status and resource counts
- Containers: run, start, stop, restart, remove, logs, inspect, browse files
- Images: pull, run as a container, inspect, remove
- Volumes and networks: create, inspect, remove
- Usage hints for images, volumes, and networks
- Live search (`/`), `j`/`k` row movement, `Enter` to inspect
- Settings: text size (compact / default / comfortable)

## Out of scope

Compose, exec/terminal, image build, image layer history, resource charts, Kubernetes.
