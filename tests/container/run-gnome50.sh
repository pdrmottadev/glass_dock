#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Runs the headless end-to-end tests against GNOME Shell 50 in a Fedora 44
# container (podman, rootless). Extra arguments select scenarios, as in
# tests/headless/run.sh. The translations scenario is skipped: it writes into
# the source tree and does not depend on the GNOME version.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
IMAGE=localhost/glass-dock-gnome50
NAME=glass-dock-gnome50-$$

glib-compile-schemas --strict "$ROOT/schemas"  # the source tree is mounted read-only
podman build -q -t "$IMAGE" -f "$ROOT/tests/container/Containerfile.gnome50" "$ROOT/tests/container" > /dev/null
podman run -d --name "$NAME" --systemd=always --security-opt label=disable \
    --device /dev/dri -v "$ROOT":/src:ro "$IMAGE" > /dev/null
trap 'podman rm -f "$NAME" > /dev/null' EXIT

# Wait for systemd, then give the test user a runtime dir.
for _ in $(seq 1 30); do
    podman exec "$NAME" systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded' && break
    sleep 1
done
podman exec "$NAME" bash -c 'mkdir -p /run/user/1000 && chown tester: /run/user/1000 && chmod 700 /run/user/1000'

SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -eq 0 ] && SCENARIOS=(lifecycle basics multiwindow dnd autohide stacks zoom zoomconfig remote fit prefs styles multiwindow_styles monitors scale unmatched)

echo "GNOME Shell: $(podman exec "$NAME" gnome-shell --version)"
podman exec -u tester -e XDG_RUNTIME_DIR=/run/user/1000 -e HOME=/home/tester -w /src "$NAME" \
    tests/headless/run.sh "${SCENARIOS[@]}"
