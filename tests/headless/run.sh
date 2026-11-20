#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# End-to-end tests for Glass Dock in isolated headless GNOME Shells.
#
#   tests/headless/run.sh                 # all scenarios
#   tests/headless/run.sh dnd stacks      # only some scenarios
#   SCREENSHOTS=docs/screenshots tests/headless/run.sh   # also save screenshots
#   KEEP_WORK=1 tests/headless/run.sh     # keep the temporary dirs (logs)
#
# Needs: gnome-shell (headless), dbus-daemon, gdbus, python3 (+ gi),
# gnome-text-editor and gnome-calculator for the window scenarios.
set -uo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
trap stop_shell EXIT

TE=org.gnome.TextEditor.desktop
CALC=org.gnome.Calculator.desktop
FILES=org.gnome.Nautilus.desktop

section() { printf '\n\033[1m%s\033[0m\n' "$1"; }

set_favorites() { ev "global.settings.set_strv('favorite-apps', $1); true" > /dev/null; sleep 0.8; }

close_windows() { ev "__gd.windows('$1').forEach(w => w.delete(global.get_current_time())); true" > /dev/null; }

open_windows() { # APP COUNT
    ev "__gd.launch('$1')" > /dev/null
    wait_for "__gd.windows('$1').length >= 1" 60
    local i
    for i in $(seq 2 "$2"); do
        ev "__gd.openNewWindow('$1')" > /dev/null
        wait_for "__gd.windows('$1').length >= $i" 60
    done
    sleep 0.8
}

# Center of a child actor inside the open overlay, found by a JS expression.
overlay_point() {
    ev "(() => { const a = $1; const [x, y] = a.get_transformed_position();
        const [w, h] = a.get_transformed_size(); return [Math.round(x + w / 2), Math.round(y + h / 2)].join(' '); })()"
}

# ---- Scenarios ---------------------------------------------------------------

scenario_lifecycle() {
    section "Lifecycle: enable/disable 50 times"
    assert_eq "one dock actor exists" '__gd.outer().length' 1
    local with_dock without_dock
    with_dock=$(ev '__gd.workArea()')
    gnome-extensions disable "$UUID"
    wait_for '__gd.outer().length === 0'
    without_dock=$(ev '__gd.workArea()')
    assert_true "dock reserves screen space when it never hides" \
        "'$with_dock'.split(',')[3] < '$without_dock'.split(',')[3]"

    local i
    for i in $(seq 1 50); do
        gnome-extensions enable "$UUID"
        gnome-extensions disable "$UUID"
    done
    wait_for '__gd.outer().length === 0'
    assert_eq "no dock actor left after disable" '__gd.outer().length' 0
    assert_eq "overview Dash restored" 'Main.overview.dash.visible' true
    assert_eq "work area restored" '__gd.workArea()' "$without_dock"
    assert_eq "no modal grab left" 'Main.modalCount' 0

    gnome-extensions enable "$UUID"
    wait_for '__gd.outer().length === 1 && __gd.dock() !== null'
    sleep 1
    assert_eq "exactly one dock after re-enable" '__gd.outer().length' 1
    assert_eq "work area reserved again" '__gd.workArea()' "$with_dock"
    assert_eq "overview Dash hidden" 'Main.overview.dash.visible' false
    assert_no_js_errors "no JS errors during enable/disable cycles"
}

scenario_basics() {
    section "Basics: launch, indicator, minimize"
    set_favorites "['$CALC', '$TE', '$FILES']"
    assert_true "Applications, Downloads and Trash items exist" \
        "['apps-button', 'downloads', 'trash'].every(k => __gd.dock()._itemMap.has(k))"
    shot dock-light

    click_item "app:$CALC"
    wait_for "__gd.windows('$CALC').length === 1" 60
    assert_eq "clicking a pinned app launches it" "__gd.windows('$CALC').length" 1
    wait_for "__gd.item('app:$CALC')._dotCount === 1"
    assert_eq "running app shows one dot" "__gd.item('app:$CALC')._dotCount" 1
    sleep 0.5
    click_item "app:$CALC"
    wait_for "__gd.windows('$CALC')[0].minimized"
    assert_eq "clicking the focused single-window app minimizes it" "__gd.windows('$CALC')[0].minimized" true
    assert_true "minimize animates to the dock icon" "__gd.windows('$CALC')[0].get_icon_geometry()[0]"
    close_windows "$CALC"
    wait_for "__gd.windows('$CALC').length === 0"
}

scenario_multiwindow() {
    section "Several windows: dots, previews, Exposé, raise"
    set_favorites "['$CALC', '$TE', '$FILES']"
    gset multi-window-action "'previews'"
    open_windows "$TE" 3
    ev "const ws = __gd.windows('$TE'); ws[0].move_resize_frame(true, 80, 80, 700, 500);
        ws[1].move_resize_frame(true, 820, 120, 680, 460); ws[2].move_resize_frame(true, 420, 360, 760, 480);
        __gd.activate(ws[2])" > /dev/null
    sleep 0.8
    assert_eq "three windows show three dots" "__gd.item('app:$TE')._dotCount" 3

    click_item "app:$TE"
    wait_for '__gd.overlays().length === 1'
    local panel="__gd.overlays()[0].get_children().find(a => a.has_style_class_name('glass-dock-preview-panel'))"
    assert_eq "previews show one card per window" "$panel.get_n_children()" 3
    shot previews
    local target
    target=$(ev "__gd.windows('$TE')[0].get_stable_sequence()")
    # shellcheck disable=SC2046
    click $(overlay_point "$panel.get_child_at_index(0).get_child_at_index(1)")
    sleep 0.6
    assert_eq "clicking a preview focuses that window" '__gd.focusSeq()' "$target"
    assert_eq "previews closed after choosing" '__gd.overlays().length' 0
    assert_eq "no modal grab left" 'Main.modalCount' 0

    click_item "app:$TE"
    wait_for '__gd.overlays().length === 1'
    # shellcheck disable=SC2046
    click $(overlay_point "$panel.get_child_at_index(1).get_child_at_index(0).get_child_at_index(1)")
    wait_for "__gd.windows('$TE').length === 2" 40
    assert_eq "the close button closes that window" "__gd.windows('$TE').length" 2
    sleep 0.5
    assert_eq "previews refresh to the remaining windows" "$panel.get_n_children()" 2
    key_escape
    assert_eq "Escape closes the previews" '__gd.overlays().length' 0

    ev "__gd.openNewWindow('$TE')" > /dev/null
    wait_for "__gd.windows('$TE').length === 3" 60
    sleep 0.8
    ev "const ws = __gd.windows('$TE'); ws[2].move_resize_frame(true, 900, 300, 600, 420);
        ws[0].minimize(); __gd.activate(ws[1])" > /dev/null
    sleep 0.6
    gset multi-window-action "'expose'"
    click_item "app:$TE"
    wait_for '__gd.overlays().length === 1'
    assert_true "App Exposé opens" "__gd.overlays()[0].has_style_class_name('glass-dock-expose')"
    sleep 0.6
    shot expose
    key_escape
    sleep 0.4
    assert_eq "Escape closes App Exposé" '__gd.overlays().length' 0
    assert_eq "no modal grab left" 'Main.modalCount' 0

    click_item "app:$TE"
    wait_for '__gd.overlays().length === 1'
    sleep 0.6
    target=$(ev "__gd.windows('$TE')[0].get_stable_sequence()")
    local first="__gd.overlays()[0].get_children().filter(a => a.has_style_class_name?.('glass-dock-expose-window'))[0]"
    # shellcheck disable=SC2046
    click $(overlay_point "$first")
    sleep 0.9
    assert_eq "choosing a minimized window in Exposé restores and focuses it" '__gd.focusSeq()' "$target"
    assert_eq "it is no longer minimized" "__gd.windows('$TE')[0].minimized" false

    open_windows "$CALC" 1
    sleep 0.5
    click_item "app:$TE"
    sleep 0.8
    assert_true "clicking a background app raises all of its windows" \
        "(() => { const st = global.display.sort_windows_by_stacking(global.display.list_all_windows());
          const calc = st.indexOf(__gd.windows('$CALC')[0]);
          return __gd.windows('$TE').every(w => st.indexOf(w) > calc); })()"
    assert_eq "…and focuses the most recently used one" '__gd.focusSeq()' "$target"

    close_windows "$TE"
    close_windows "$CALC"
    wait_for "__gd.windows('$TE').length === 0 && __gd.windows('$CALC').length === 0" 60
    gset multi-window-action "'previews'"
}

scenario_dnd() {
    section "Drag and drop"
    set_favorites "['$CALC', '$TE', '$FILES']"
    move 800 500
    sleep 0.6
    local from to
    from=$(ev "__gd.center('app:$CALC').join(' ')")
    # The dragged icon leaves its slot and the others close the gap, so the
    # old center of the next icon ends up between it and the one after.
    to=$(ev "__gd.center('app:$TE').join(' ')")
    # shellcheck disable=SC2086
    drag $from $to
    assert_eq "dragging reorders pinned apps" "global.settings.get_strv('favorite-apps').join(',')" "$TE,$CALC,$FILES"

    move 800 500
    sleep 0.6
    from=$(ev "__gd.center('app:$FILES').join(' ')")
    # shellcheck disable=SC2086
    drag $from 800 450
    assert_eq "dragging out of the dock unpins" "global.settings.get_strv('favorite-apps').join(',')" "$TE,$CALC"

    ev 'Main.overview.show(); true' > /dev/null
    wait_for 'Main.overview.visible && !Main.overview.animationInProgress'
    sleep 0.5
    assert_true "dock actors do not cover overview drop targets" \
        "[[800, 400], [200, 300], [1400, 700], [50, 990]].every(([x, y]) =>
            !__gd.isDockActor(global.stage.get_actor_at_pos(imports.gi.Clutter.PickMode.ALL, x, y)))"
    ev 'Main.overview.hide(); true' > /dev/null
    wait_for '!Main.overview.visible'
    assert_true "outside the overview too" \
        "[[800, 400], [200, 300], [1400, 700]].every(([x, y]) =>
            !__gd.isDockActor(global.stage.get_actor_at_pos(imports.gi.Clutter.PickMode.ALL, x, y)))"
}

scenario_autohide() {
    section "Auto-hide, intellihide, fullscreen"
    set_favorites "['$CALC', '$TE', '$FILES']"
    local reserved
    reserved=$(ev '__gd.workArea()')
    move 800 500
    gset autohide-mode "'autohide'"
    wait_for '__gd.dock() && !__gd.dock()._actor.visible'
    assert_eq "auto-hide hides the dock" '__gd.dock()._actor.visible' false
    assert_true "and frees the reserved space" "__gd.workArea() !== '$reserved'"
    move 800 999
    local i
    for i in $(seq 1 15); do ev '__gd.relative(0, 20)' > /dev/null; sleep 0.03; done
    wait_for '__gd.dock()._actor.visible'
    assert_eq "pushing the screen edge reveals it" '__gd.dock()._actor.visible' true
    move 800 500
    wait_for '!__gd.dock()._actor.visible'
    assert_eq "leaving hides it again" '__gd.dock()._actor.visible' false

    gset autohide-mode "'intellihide'"
    open_windows "$CALC" 1
    ev "__gd.windows('$CALC')[0].move_frame(true, 700, 150); true" > /dev/null
    wait_for '__gd.dock()._actor.visible'
    assert_eq "intellihide shows the dock when nothing overlaps" '__gd.dock()._actor.visible' true
    ev "__gd.windows('$CALC')[0].move_frame(true, 700, 600); true" > /dev/null
    wait_for '!__gd.dock()._actor.visible'
    assert_eq "intellihide hides it when the focused window overlaps" '__gd.dock()._actor.visible' false
    ev "__gd.windows('$CALC')[0].move_frame(true, 700, 150); true" > /dev/null
    wait_for '__gd.dock()._actor.visible'

    gset autohide-mode "'never'"
    sleep 0.5
    ev "__gd.windows('$CALC')[0].make_fullscreen(); true" > /dev/null
    wait_for '!__gd.outer()[0].visible'
    assert_eq "fullscreen windows hide the dock" '__gd.outer()[0].visible' false
    ev "__gd.windows('$CALC')[0].unmake_fullscreen(); true" > /dev/null
    wait_for '__gd.outer()[0].visible'
    assert_eq "and it comes back afterwards" '__gd.outer()[0].visible' true
    assert_eq "space is reserved again" '__gd.workArea()' "$reserved"
    close_windows "$CALC"
}

scenario_stacks() {
    section "Downloads stack and Trash"
    gset downloads-view "'fan'"
    click_item downloads
    wait_for '__gd.overlays().length === 1'
    assert_true "fan shows the files plus 'Open in Files'" '__gd.overlays()[0].get_n_children() >= 4'
    shot downloads-fan
    click 300 300
    sleep 0.4
    assert_eq "clicking outside closes the fan" '__gd.overlays().length' 0

    gset downloads-view "'grid'"
    click_item downloads
    wait_for '__gd.overlays().length === 1'
    assert_true "grid panel opens" \
        "__gd.overlays()[0].get_children().some(a => a.has_style_class_name('glass-dock-stack-panel'))"
    sleep 0.3
    shot downloads-grid
    key_escape
    assert_eq "Escape closes the grid" '__gd.overlays().length' 0
    gset downloads-view "'fan'"

    mkdir -p "$XDG_DATA_HOME/Trash/files" "$XDG_DATA_HOME/Trash/info"
    echo x > "$XDG_DATA_HOME/Trash/files/old.txt"
    printf '[Trash Info]\nPath=%s/old.txt\nDeletionDate=2026-01-01T00:00:00\n' "$WORK" \
        > "$XDG_DATA_HOME/Trash/info/old.txt.trashinfo"
    wait_for "__gd.item('trash').iconActor.icon_name === 'user-trash-full'"
    assert_eq "trash shows as full" "__gd.item('trash').iconActor.icon_name" user-trash-full
    rm -f "$XDG_DATA_HOME/Trash/files/old.txt" "$XDG_DATA_HOME/Trash/info/old.txt.trashinfo"
    wait_for "__gd.item('trash').iconActor.icon_name === 'user-trash'"
    assert_eq "and empty again" "__gd.item('trash').iconActor.icon_name" user-trash
}

scenario_fit() {
    section "Fit to screen"
    move 800 300
    sleep 0.5
    ev "global.settings.set_strv('favorite-apps', imports.gi.Gio.AppInfo.get_all()
        .filter(a => a.should_show()).map(a => a.get_id()).slice(0, 40)); true" > /dev/null
    sleep 1.5
    local count
    count=$(ev "global.settings.get_strv('favorite-apps').length")
    assert_true "many pinned apps ($count) still fit on the monitor" \
        "__gd.dock()._actor.width <= __gd.dock().monitor.width - 2 * __gd.dock().metrics.margin"
    if [ "$count" -ge 30 ]; then
        assert_true "icons shrank to fit" "__gd.dock().metrics.iconSize < 52 && __gd.dock().metrics.iconSize >= 24"
    fi
    set_favorites "['$CALC', '$TE', '$FILES']"
    sleep 0.5
    assert_eq "icons grow back when there is room" '__gd.dock().metrics.iconSize' 52
}

scenario_prefs() {
    section "Preferences window"
    gnome-extensions prefs "$UUID"
    wait_for "global.display.list_all_windows().some(w => w.get_title() === 'Glass Dock')" 60
    assert_true "preferences window opens" \
        "global.display.list_all_windows().some(w => w.get_title() === 'Glass Dock')"
    ev "global.display.list_all_windows().filter(w => w.get_title() === 'Glass Dock')
        .forEach(w => w.delete(global.get_current_time())); true" > /dev/null
}

scenario_dark() {
    [ -n "${SCREENSHOTS:-}" ] || return 0
    section "Dark style screenshot"
    gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    sleep 1
    local xy
    xy=$(ev "__gd.center('app:$TE').join(' ')")
    # shellcheck disable=SC2086
    move $xy
    sleep 0.6
    shot dock-dark-magnified
    move 800 500
    gsettings set org.gnome.desktop.interface color-scheme default
    sleep 1
}

# Separate shells -------------------------------------------------------------

scenario_monitors() {
    section "Monitor choice (two monitors)"
    stop_shell
    start_shell --virtual-monitor 1600x1000 --virtual-monitor 1280x800
    local second
    second=$(ev "global.backend.get_monitor_manager().get_monitors()
        .map(m => m.get_connector()).find((c, i, all) => i === all.length - 1)")
    gset monitor-connector "'$second'"
    wait_for "__gd.dock() && __gd.dock().monitorIndex !== Main.layoutManager.primaryIndex" 40
    assert_true "dock moves to the chosen monitor ($second)" \
        "__gd.outer()[0].x === Main.layoutManager.monitors[__gd.dock().monitorIndex].x &&
         __gd.dock().monitorIndex !== Main.layoutManager.primaryIndex"
    gset monitor-connector "'NOT-CONNECTED-1'"
    wait_for "__gd.dock() && __gd.dock().monitorIndex === Main.layoutManager.primaryIndex" 40
    assert_eq "unknown monitor falls back to the primary" \
        '__gd.dock().monitorIndex === Main.layoutManager.primaryIndex' true
    assert_no_js_errors "no JS errors with two monitors"
}

scenario_scale() {
    section "HiDPI (scale 2)"
    stop_shell
    start_shell --virtual-monitor 1600x1000
    local out
    out=$(python3 -I "$HERE/set_scale.py" 2 2>&1)
    if [ $? -eq 2 ] || [[ "$out" == *Error* ]]; then
        echo "  skip scale 2 not available here: $out"
        return 0
    fi
    sleep 2
    wait_for '__gd.dock() !== null'
    assert_eq "monitor scale is 2" 'global.display.get_monitor_scale(0)' 2
    assert_true "dock fits inside the scaled monitor" \
        "(() => { const d = __gd.dock(), m = d.monitor, a = d._actor;
          return a.x >= 0 && a.x + a.width <= m.width && a.y + a.height <= m.height; })()"
    assert_no_js_errors "no JS errors at scale 2"
}

scenario_i18n() {
    section "Translations"
    make -s -C "$ROOT" locale
    local lang expected got
    for pair in "pt_BR:Lixeira" "es:Papelera"; do
        lang=${pair%%:*} expected=${pair#*:}
        got=$(LANG=en_US.UTF-8 LC_ALL= LANGUAGE=$lang gjs -c "const G = imports.gettext;
            G.bindtextdomain('glass-dock', '$ROOT/locale');
            print(G.domain('glass-dock').gettext('Trash'))")
        if [ "$got" = "$expected" ]; then pass "$lang translation loads"; else fail "$lang translation (got '$got')"; fi
    done
}

# ---- Main --------------------------------------------------------------------

MAIN=(lifecycle basics multiwindow dnd autohide stacks fit prefs dark)
SEPARATE=(monitors scale)
SELECTED=("$@")
[ ${#SELECTED[@]} -eq 0 ] && SELECTED=("${MAIN[@]}" i18n "${SEPARATE[@]}")

wants() { local s; for s in "${SELECTED[@]}"; do [ "$s" = "$1" ] && return 0; done; return 1; }

needs_main=0
for s in "${MAIN[@]}"; do wants "$s" && needs_main=1; done
if [ $needs_main -eq 1 ]; then
    start_shell || exit 1
    for s in "${MAIN[@]}"; do wants "$s" && "scenario_$s"; done
    section "Main session"
    assert_no_js_errors "no JS errors in the main session"
fi
wants i18n && scenario_i18n
for s in "${SEPARATE[@]}"; do wants "$s" && "scenario_$s"; done

printf '\n%d passed, %d failed\n' "$PASSES" "$FAILURES"
[ "$FAILURES" -eq 0 ]
