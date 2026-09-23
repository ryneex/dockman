# Dockman

A Linux desktop app for controlling a local Docker Engine. It talks to `/var/run/docker.sock` — it does not install or replace the engine.

## Prerequisites

- Node.js 22+
- pnpm 11.15.0
- Rust (stable)
- Docker Engine, with your user in the `docker` group
- `docker compose` (or `docker-compose`) to start and stop compose files
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

- Dashboard with engine status, resource counts, disk usage (size + reclaimable), and a recent events strip
- Containers: run, start, stop, pause, restart, rename, recreate, remove, logs, inspect, browse files, open a terminal (host app or in Dockman)
- Running containers show live CPU, memory, and network I/O on the list and the detail header
- Container overview: health, exit code, start/finish times, env, ports (open published TCP), mounts, networks with IPs; in-app terminal can restart
- Run options: command (from image CMD), mounts, network, restart policy, ports (TCP/UDP), env; Advanced: entrypoint, user, working dir, memory
- Images: pull, run as a container, inspect drawer (summary + JSON), tag, save/load from a path, remove, dangling marker
- Image layer viewer at `/images/:id`: Dockerfile-ordered stages, current filesystem tree, file preview (256 KiB cap)
- Compose: in-app compose library (`compose.yml` is the source of truth; visual subset + YAML), start/stop projects with `docker compose -p`
- Volumes and networks: create, inspect, remove; connect or disconnect a container on a network
- Prune unused containers, images, volumes, and networks; bulk delete from lists
- Usage hints for images, volumes, and networks; click through to the container
- Live search (`/`), `j`/`k` row movement, `Enter` to inspect
- Inspect JSON copy; logs: timestamp toggle, filter, copy
- Settings: text size, preferred terminal app, open in host app or Dockman

## Out of scope

Compose build/profiles/includes, image build, Kubernetes, Swarm, plugins, secrets, registry auth/push, resource charts.
