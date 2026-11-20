# SPDX-License-Identifier: GPL-2.0-or-later
# Helpers to drive an isolated headless GNOME Shell for end-to-end tests.
#
# Each shell gets its own XDG dirs, D-Bus session bus and Wayland display, so
# nothing touches the user's real session or settings. A tiny helper
# extension turns on unsafe mode so tests can use org.gnome.Shell.Eval and the
# Screenshot API.

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HERE="$ROOT/tests/headless"
UUID=glass-dock@pdrmottadev.github.io
SCHEMA=org.gnome.shell.extensions.glass-dock

WORK=""
SHELL_PID=""
BUS_PID=""
FAILURES=0
PASSES=0

# ---- Shell lifecycle -------------------------------------------------------

# start_shell [gnome-shell monitor args...]
start_shell() {
    WORK=$(mktemp -d "${TMPDIR:-/tmp}/glass-dock-test.XXXXXX")
    mkdir -p "$WORK"/{config,data/gnome-shell/extensions,cache,state,Downloads}
    ln -s "$ROOT" "$WORK/data/gnome-shell/extensions/$UUID"
    cp -r "$HERE/test-helper@local" "$WORK/data/gnome-shell/extensions/"
    echo "XDG_DOWNLOAD_DIR=\"$WORK/Downloads\"" > "$WORK/config/user-dirs.dirs"
    for f in report.pdf photo.png notes.txt; do echo test > "$WORK/Downloads/$f"; done

    export XDG_CONFIG_HOME="$WORK/config" XDG_DATA_HOME="$WORK/data"
    export XDG_CACHE_HOME="$WORK/cache" XDG_STATE_HOME="$WORK/state"
    export LANGUAGE=en LANG=C.UTF-8
    export DISPLAY_NAME="glass-dock-test-$$"
    unset DISPLAY

    dbus-daemon --session --fork --print-address=1 --print-pid=3 \
        > "$WORK/bus.addr" 3> "$WORK/bus.pid"
    export DBUS_SESSION_BUS_ADDRESS
    DBUS_SESSION_BUS_ADDRESS=$(cat "$WORK/bus.addr")
    BUS_PID=$(cat "$WORK/bus.pid")

    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "['test-helper@local', '$UUID']"
    gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'

    local monitors=("$@")
    [ ${#monitors[@]} -eq 0 ] && monitors=(--virtual-monitor 1600x1000)
    env -u WAYLAND_DISPLAY gnome-shell --headless "${monitors[@]}" --no-x11 \
        --wayland-display="$DISPLAY_NAME" --force-animations \
        > "$WORK/shell.log" 2>&1 &
    SHELL_PID=$!

    local i
    for i in $(seq 1 60); do
        [ "$(ev '1' 2>/dev/null)" = "1" ] && break
        sleep 0.5
    done
    [ "$(ev '1' 2>/dev/null)" = "1" ] || { echo "shell did not start"; cat "$WORK/shell.log"; return 1; }
    sleep 1
    ev "$(cat "$HERE/prelude.js")" > /dev/null
    ev 'Main.overview.hide(); Main.messageTray._bannerBin.hide(); "ok"' > /dev/null
    move 800 500
    sleep 0.5
}

stop_shell() {
    [ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null && wait "$SHELL_PID" 2>/dev/null
    [ -n "$BUS_PID" ] && kill "$BUS_PID" 2>/dev/null
    SHELL_PID="" BUS_PID=""
    if [ -n "$WORK" ] && [[ "$WORK" == */glass-dock-test.* ]]; then
        [ -n "${KEEP_WORK:-}" ] && echo "work dir kept: $WORK" || rm -rf -- "$WORK"
    fi
}

# ---- Talking to the shell ----------------------------------------------------

# ev 'js' -> prints the JSON-decoded result (strings unquoted); exit 1 on error.
ev() {
    local out
    out=$(gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>&1) || { echo "$out" >&2; return 1; }
    python3 -I "$HERE/decode_eval.py" "$out"
}

gset() { gsettings --schemadir "$ROOT/schemas" set "$SCHEMA" "$1" "$2"; sleep 0.6; }

move() { ev "__gd.move($1, $2)" > /dev/null; }

# click X Y [button] — hover first so the target sees the pointer, then click.
click() {
    if [ $# -lt 2 ]; then fail "click: no coordinates"; return 1; fi
    move "$1" "$2"
    sleep 0.3
    ev "__gd.click($1, $2, ${3:-1})" > /dev/null
    sleep 0.4
}
key_escape() { ev "__gd.escape()" > /dev/null; sleep 0.5; }

# click_item KEY [button] — clicks the center of a dock item.
click_item() {
    # Rest the pointer away from the dock first: centers computed while the
    # dock is magnified would not match once the pointer moves.
    move 800 300
    sleep 0.5
    local xy
    xy=$(ev "__gd.center('$1').join(' ')")
    # shellcheck disable=SC2086
    click $xy "${2:-1}"
}

# drag X1 Y1 X2 Y2 — press, move in steps, release.
drag() {
    ev "__gd.press($1, $2)" > /dev/null
    sleep 0.3
    local i
    for i in $(seq 1 12); do
        ev "__gd.move($1 + ($3 - $1) * $i / 12, $2 + ($4 - $2) * $i / 12)" > /dev/null
        sleep 0.05
    done
    sleep 0.4
    ev "__gd.release()" > /dev/null
    sleep 0.8
}

shot() {
    [ -n "${SCREENSHOTS:-}" ] || return 0
    mkdir -p "$SCREENSHOTS"
    gdbus call --session --dest org.gnome.Shell.Screenshot --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.Screenshot false false "$SCREENSHOTS/$1.png" > /dev/null
}

# wait_for 'js boolean expression' [tries]
wait_for() {
    local i
    for i in $(seq 1 "${2:-40}"); do
        [ "$(ev "$1")" = "true" ] && return 0
        sleep 0.25
    done
    return 1
}

# ---- Assertions --------------------------------------------------------------

pass() { PASSES=$((PASSES + 1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
fail() { FAILURES=$((FAILURES + 1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }

# assert_eq DESCRIPTION 'js expression' EXPECTED
assert_eq() {
    local actual
    actual=$(ev "$2" 2>&1)
    if [ "$actual" = "$3" ]; then pass "$1"; else fail "$1 (expected '$3', got '$actual')"; fi
}

# assert_true DESCRIPTION 'js boolean expression'
assert_true() { assert_eq "$1" "$2" "true"; }

assert_no_js_errors() {
    local pattern='JS ERROR|CRITICAL|glass-dock@[^ ]*/src/'
    if grep -qE "$pattern" "$WORK/shell.log"; then
        fail "$1"
        grep -E -A3 "$pattern" "$WORK/shell.log" | head -20 | sed 's/^/       /'
    else
        pass "$1"
    fi
}
