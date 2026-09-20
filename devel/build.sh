#!/bin/sh
set -eu
cd "$(dirname "$0")"
export DOCKMAN_PKG=app
exec makepkg -si "$@"
