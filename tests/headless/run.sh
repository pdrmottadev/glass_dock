#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# End-to-end tests for Glass Dock in isolated headless GNOME Shells.
#
#   tests/headless/run.sh                 # all scenarios
#   tests/headless/run.sh dnd stacks      # only some scenarios
#   SCREENSHOTS=docs/screenshots tests/headless/run.sh   # also save screenshots
#   KEEP_WORK=1 tests/headless/run.sh     # keep the temporary dirs (logs)
#   REMOTE=1 tests/headless/run.sh        # with animations inhibited, as in remote desktop
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
    multiwindow_checks
}

# Runs the same checks with full-width bars: on the left edge with icons from
# the top, and centered at the bottom.
scenario_multiwindow_styles() {
    local style position
    for pair in strip:left center:bottom; do
        style=${pair%:*} position=${pair#*:}
        section "Several windows: $style style, $position edge"
        gset position "'$position'"
        gset dock-style "'$style'"
        wait_for "__gd.dock()?.style.id === '$style' && __gd.dock().geom.position === '$position'" 40
        apply_preset
        multiwindow_checks
    done
    greset position
    greset dock-style
    greset icon-size
    greset magnification-enabled
    wait_for "__gd.dock()?.style.id === 'glass' && __gd.dock().geom.position === 'bottom'" 40
}

multiwindow_checks() {
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
    assert_true "the previews sit next to the dock, inside the screen" \
        "(() => { const [x, y] = $panel.get_transformed_position(); const [w, h] = $panel.get_transformed_size();
            const d = __gd.dock(), mon = d.monitor, depth = d.metrics.margin + d.metrics.thickness;
            const inside = x >= mon.x && y >= mon.y && x + w <= mon.x + mon.width && y + h <= mon.y + mon.height;
            const clear = d.geom.position === 'left' ? x >= mon.x + depth : y + h <= mon.y + mon.height - depth;
            return inside && clear; })()"
    assert_eq "the zoom stays while previews are open (if zoom is on)" \
        '__gd.dock()._magAmount.value' "$(ev '__gd.dock().metrics.magEnabled ? 1 : 0')"
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
    sleep 0.5
    assert_eq "the zoom stays while the fan is open" '__gd.dock()._magAmount.value' 1
    assert_true "the fan stays upright, so text and thumbnails stay sharp" \
        '__gd.overlays()[0].get_children().every(a => a.rotation_angle_z === 0)'
    assert_true "the fan is anchored to the magnified icon" \
        "__gd.dock().iconRectFor(__gd.item('downloads'))[2] > __gd.dock().metrics.iconSize"
    local frozen
    frozen=$(ev '__gd.dock()._pointer[0]')
    move 900 500
    sleep 0.3
    assert_eq "moving the pointer does not disturb the held zoom" '__gd.dock()._pointer[0]' "$frozen"
    click 300 300
    sleep 0.4
    assert_eq "clicking outside closes the fan" '__gd.overlays().length' 0
    wait_for '__gd.dock()._magAmount.value === 0'
    assert_eq "and the zoom collapses, as the pointer left the dock" '__gd.dock()._magAmount.value' 0

    click_item downloads
    wait_for '__gd.overlays().length === 1'
    sleep 0.3
    key_escape
    sleep 0.5
    assert_eq "closing with the pointer on the dock keeps the zoom" '__gd.dock()._magAmount.value' 1
    move 800 300
    wait_for '__gd.dock()._magAmount.value === 0'
    assert_eq "and leaving the dock afterwards collapses it" '__gd.dock()._magAmount.value' 0

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

scenario_zoom() {
    section "Smooth zoom when entering and leaving the dock"
    set_favorites "['$CALC', '$TE', '$FILES']"
    move 800 300
    sleep 0.6
    local x y stats
    read -r x y <<< "$(ev "__gd.center('app:$TE').join(' ')")"
    ev "__gd.recordZoom('app:$TE')" > /dev/null
    move "$x" "$((y + 25))"
    sleep 0.6
    ev "globalThis._zoom = __gd.zoomStats(); true" > /dev/null
    stats=$(ev 'JSON.stringify(_zoom)')
    assert_eq "zooming uses the large icon" "__gd.item('app:$TE').iconActor.icon_size" \
        "$(ev '__gd.dock().metrics.magSize')"
    assert_true "entering takes at least 200 ms ($stats)" '_zoom.duration >= 200'
    assert_true "entering has no sudden jump" '_zoom.peak < 0.0105'
    assert_true "entering only grows" '_zoom.monotonic'
    assert_true "the icon under the pointer does not wobble" '_zoom.wobble <= 1'

    move 800 300
    sleep 0.7
    ev "globalThis._zoom = __gd.zoomStats(); true" > /dev/null
    stats=$(ev 'JSON.stringify(_zoom)')
    assert_true "leaving takes at least 280 ms ($stats)" '_zoom.duration >= 280'
    assert_true "leaving has no sudden jump" '_zoom.peak < 0.008'
    assert_true "leaving only shrinks" '_zoom.monotonic'
    assert_true "the icon does not wobble on the way out" '_zoom.wobble <= 1'
    assert_true "at rest icons are drawn at their exact size" "(() => { const d = __gd.dock();
        return d._items.filter(i => i.iconActor instanceof imports.gi.St.Icon).every(i =>
            i.iconActor.icon_size === d.metrics.iconSize && i.iconActor.scale_x === 1 &&
            Number.isInteger(i.iconActor.x) && Number.isInteger(i.iconActor.y)); })()"
    assert_true "the Applications tile too" "(() => { const a = __gd.item('apps-button').iconActor;
        return a.width === __gd.dock().metrics.iconSize && a.scale_x === 1; })()"

    move "$x" "$((y + 25))"
    sleep 0.12
    move 800 300
    wait_for '__gd.dock()._magAmount.value === 0'
    assert_eq "reversing halfway settles at rest" '__gd.dock()._magAmount.value' 0
    sleep 0.1
    ev "globalThis._zoom = __gd.zoomStats(); true" > /dev/null
    assert_true "reversing halfway has no sudden jump" '_zoom.peak < 0.0105'
    ev '__gd.stopRecordingZoom()' > /dev/null
}

scenario_zoomconfig() {
    section "Configurable zoom"
    set_favorites "['$CALC', '$TE', '$FILES']"
    move 800 300
    wait_for '__gd.dock()._magAmount.value === 0'
    local x y
    read -r x y <<< "$(ev "__gd.center('app:$TE').join(' ')")"
    ev "globalThis._d = __gd.dock(); __gd.recordZoom('app:$TE')" > /dev/null

    # GNOME inhibits animations like this during remote desktop sessions.
    ev 'imports.gi.St.Settings.get().inhibit_animations(); true' > /dev/null
    assert_eq "(GNOME animations are inhibited, as in a remote session)" \
        'imports.gi.St.Settings.get().enable_animations' false
    move "$x" "$((y + 25))"
    sleep 0.6
    ev "globalThis._zoom = __gd.zoomStats(); true" > /dev/null
    assert_true "the zoom still animates in a remote session" '_zoom.duration >= 200 && _zoom.peak < 0.0105'
    move 800 300
    wait_for '__gd.dock()._magAmount.value === 0'
    sleep 0.1
    ev "__gd.zoomStats(); imports.gi.St.Settings.get().uninhibit_animations(); true" > /dev/null

    gsettings set org.gnome.desktop.interface enable-animations false
    sleep 0.2
    move "$x" "$((y + 25))"
    sleep 0.15
    assert_eq "turning animations off in GNOME makes the zoom instant" '__gd.dock()._magAmount.value' 1
    move 800 300
    sleep 0.15
    assert_eq "in both directions" '__gd.dock()._magAmount.value' 0
    gsettings reset org.gnome.desktop.interface enable-animations
    sleep 0.2
    ev '__gd._zoomLog.length = 0; true' > /dev/null

    gset magnification-in-time 5000
    assert_eq "times up to 5 seconds are accepted" '__gd.dock().settings.get_int("magnification-in-time")' 5000
    greset magnification-in-time

    gset magnification-in-time 800
    gset magnification-out-time 120
    assert_true "changing the values does not rebuild the dock" '__gd.dock() === _d'
    move "$x" "$((y + 25))"
    sleep 1.1
    ev "globalThis._zoom = __gd.zoomStats(); true" > /dev/null
    assert_true "a longer zoom-in time takes longer" '_zoom.duration >= 600'
    move 800 300
    sleep 0.5
    ev "globalThis._zoom = __gd.zoomStats(); true" > /dev/null
    assert_true "a shorter zoom-out time is quicker" '_zoom.duration <= 260'

    greset magnification-in-time
    greset magnification-out-time
    gset magnification-elasticity 70
    move "$x" "$((y + 25))"
    sleep 1.2
    ev "globalThis._zoom = __gd.zoomStats(); true" > /dev/null
    assert_true "elasticity overshoots" '_zoom.max > 1.05 && _zoom.max < 1.25'
    assert_eq "and settles at full zoom" '__gd.dock()._magAmount.value' 1
    move 800 300
    wait_for '__gd.dock()._magAmount.value === 0'
    assert_eq "and never goes below rest" '__gd.dock()._magAmount.value' 0
    greset magnification-elasticity

    gset magnification-spread 5
    assert_true "the wave width applies right away" \
        '__gd.dock().metrics.influence === (__gd.dock().metrics.iconSize + __gd.dock().metrics.spacing) * 5'
    greset magnification-spread

    gset magnification-follow-time 0
    move "$x" "$((y + 25))"
    sleep 0.1
    move "$((x + 40))" "$((y + 25))"
    sleep 0.1
    assert_true "a follow delay of 0 tracks the pointer exactly" \
        '__gd.dock()._focus.value === __gd.dock()._focus.target'
    greset magnification-follow-time
    move 800 300
    wait_for '__gd.dock()._magAmount.value === 0'
    ev '__gd.stopRecordingZoom()' > /dev/null
}

scenario_remote() {
    section "Dock animations in a remote session"
    set_favorites "['$CALC', '$TE', '$FILES']"
    gset multi-window-action "'previews'"
    gset downloads-view "'fan'"
    move 800 300
    wait_for '__gd.dock()._magAmount.value === 0'
    ev 'imports.gi.St.Settings.get().inhibit_animations(); __gd.watchEase()' > /dev/null
    assert_eq "(GNOME animations are inhibited, as in a remote session)" \
        'imports.gi.St.Settings.get().enable_animations' false

    assert_true "auto-hide slides" "(() => { const d = __gd.dock(); d.slideOut(true);
        const on = d._actor.get_transition('translation-y') !== null; d.slideIn(false); return on; })()"
    assert_true "the launch bounce animates" "(() => { const i = __gd.item('app:$TE'); i.bounce(1);
        return i.iconActor.get_transition('translation-y') !== null; })()"
    sleep 0.6
    assert_true "icons animate in" "(() => { const i = __gd.item('app:$TE'); i.presence.value = 0; i.appear(true);
        return i.presence.get_transition('value') !== null; })()"
    sleep 0.4
    assert_true "the tooltip fades" "(() => { const d = __gd.dock(); d.onItemHover(__gd.item('app:$TE'), true);
        const on = d._tooltip.get_transition('opacity') !== null; d.hideTooltip(); return on; })()"

    ev '__gd.resetEaseStats()' > /dev/null
    click_item downloads
    wait_for '__gd.overlays().length === 1'
    sleep 0.3
    assert_true "the Downloads fan animates" '__gd._easeStats.animated >= 4'
    key_escape
    sleep 0.3

    open_windows "$TE" 2
    ev '__gd.resetEaseStats()' > /dev/null
    click_item "app:$TE"
    wait_for '__gd.overlays().length === 1'
    sleep 0.3
    assert_true "window previews animate" '__gd._easeStats.animated >= 1'
    key_escape
    sleep 0.3

    gset multi-window-action "'expose'"
    ev '__gd.resetEaseStats()' > /dev/null
    click_item "app:$TE"
    wait_for '__gd.overlays().length === 1'
    sleep 0.2
    assert_true "App Exposé animates" '__gd._easeStats.animated >= 3'
    key_escape
    sleep 0.6
    gset multi-window-action "'previews'"
    close_windows "$TE"
    wait_for "__gd.windows('$TE').length === 0" 60

    gsettings set org.gnome.desktop.interface enable-animations false
    sleep 0.2
    assert_true "turning animations off in GNOME is still respected" "(() => { const d = __gd.dock(); d.slideOut(true);
        const off = d._actor.get_transition('translation-y') === null; d.slideIn(false); return off; })()"
    gsettings reset org.gnome.desktop.interface enable-animations
    sleep 0.2
    ev '__gd.stopWatchingEase(); imports.gi.St.Settings.get().uninhibit_animations(); true' > /dev/null
    assert_no_js_errors "no JS errors with animations in a remote session"
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

# style_shots ID — screenshots of the current style, at rest and with the
# pointer on the Text Editor icon.
style_shots() {
    [ -n "${SCREENSHOTS:-}" ] || return 0
    move 800 300
    sleep 0.6
    shot "styles/$1"
    local xy
    xy=$(ev "__gd.center('app:$TE').join(' ')")
    # shellcheck disable=SC2086
    move $xy
    sleep 0.8
    shot "styles/$1-hover"
    move 800 300
}

# Applies the current style's recommended icon size and zoom, like the
# preferences do when a style is picked.
apply_preset() {
    local size zoom
    size=$(ev "__gd.dock().style.preset['icon-size']")
    zoom=$(ev "__gd.dock().style.preset['magnification-enabled']")
    gset icon-size "$size"
    gset magnification-enabled "$zoom"
    wait_for "__gd.dock()?.metrics.iconSize === $size && __gd.dock()._lastLayout !== null" 40
    sleep 0.3
}

scenario_styles() {
    section "Styles"
    set_favorites "['$CALC', '$TE', '$FILES']"
    open_windows "$CALC" 1
    open_windows "$TE" 2
    local style
    for style in glass strip orb glow line center bevel shelf neon dash; do
        gset dock-style "'$style'"
        wait_for "__gd.dock()?.style.id === '$style' && __gd.dock()._lastLayout !== null" 40
        sleep 0.4
        assert_eq "$style: dock is built" "__gd.dock().style.id" "$style"
        apply_preset
        style_shots "$style"
        if [ -n "${SCREENSHOTS:-}" ]; then
            gsettings set org.gnome.desktop.interface color-scheme prefer-dark
            sleep 1
            style_shots "$style-dark"
            gsettings set org.gnome.desktop.interface color-scheme default
            sleep 1
        fi
    done

    local panel='__gd.dock()'
    for style in strip line center; do
        gset dock-style "'$style'"
        wait_for "__gd.dock()?.style.id === '$style'" 40
        sleep 0.4
        assert_true "$style: the bar spans the whole monitor" \
            "$panel._background.width === $panel.monitor.width && $panel._actor.x === 0"
        assert_true "$style: the bar touches the screen edge and reserves its thickness" \
            "$panel._actor.y + $panel.metrics.thickness === $panel.monitor.height &&
             $panel._struts.height === $panel.metrics.thickness"
        assert_true "$style: open apps are marked without dots" \
            "(it => it._plate.visible || it._bar?.visible)(__gd.item('app:$CALC')) &&
             __gd.item('app:$CALC')._dots.length === 0"
    done
    for style in line center; do
        gset dock-style "'$style'"
        wait_for "__gd.dock()?.style.id === '$style'" 40
        sleep 0.4
        assert_true "$style: an extra mark shows several windows, and only then" \
            "__gd.item('app:$TE')._barExtra.visible && !__gd.item('app:$CALC')._barExtra.visible &&
             __gd.item('app:$TE')._barExtra.width > 0"
    done
    for style in strip bevel; do
        gset dock-style "'$style'"
        wait_for "__gd.dock()?.style.id === '$style'" 40
        assert_true "$style: the plate shows several windows, and only then" \
            "__gd.item('app:$TE')._plate.has_style_class_name('glass-dock-plate-multi') &&
             !__gd.item('app:$CALC')._plate.has_style_class_name('glass-dock-plate-multi')"
    done
    gset dock-style "'shelf'"
    wait_for "__gd.dock()?.style.id === 'shelf'" 40
    assert_eq "shelf: one light per window" "__gd.item('app:$TE')._dots.filter(d => d.visible).length" 2
    gset dock-style "'line'"
    wait_for "__gd.dock()?.style.id === 'line'" 40
    assert_true "line: icons start at the left end" "__gd.dock()._items[0].x < 20"
    gset dock-style "'center'"
    wait_for "__gd.dock()?.style.id === 'center'" 40
    sleep 0.4
    assert_true "center: icons are centered" \
        "(d => { const a = d._items[0], b = d._items.at(-1);
            return Math.abs((a.x + b.x + b.width) / 2 - d.monitor.width / 2) <= 2; })(__gd.dock())"
    click_item "app:$CALC"
    wait_for "imports.gi.Shell.WindowTracker.get_default().focus_app?.get_id() === '$CALC'"
    assert_eq "center: clicking a background app focuses it" \
        "imports.gi.Shell.WindowTracker.get_default().focus_app?.get_id()" "$CALC"
    wait_for "__gd.item('app:$CALC')._focusAmount.value === 1"
    assert_true "center: the pill grows on the focused app" \
        "__gd.item('app:$CALC')._bar.width > __gd.item('app:$TE')._bar.width"
    click_item "app:$CALC"
    wait_for "__gd.windows('$CALC')[0].minimized"
    assert_eq "center: clicking it again minimizes it" "__gd.windows('$CALC')[0].minimized" true
    move 800 300
    sleep 0.5
    local from to
    from=$(ev "__gd.center('app:$CALC').join(' ')")
    to=$(ev "(([x, y]) => [x - 8, y].join(' '))(__gd.center('app:$TE'))")
    # shellcheck disable=SC2086
    drag $from $to
    assert_eq "center: dragging reorders pinned apps" \
        "global.settings.get_strv('favorite-apps').join(',')" "$TE,$CALC,$FILES"
    set_favorites "['$CALC', '$TE', '$FILES']"

    gset dock-style "'strip'"
    wait_for "__gd.dock()?.style.id === 'strip'" 40
    sleep 0.4
    assert_true "strip: the labeled Apps button is wider than an icon and does not zoom" \
        "(it => !it.magnifiable && it.width > __gd.dock().metrics.iconSize * 1.5)(__gd.item('apps-button'))"
    for style in strip bevel; do
        gset dock-style "'$style'"
        wait_for "__gd.dock()?.style.id === '$style'" 40
        sleep 0.4
        local before after
        before=$(ev "__gd.item('apps-button').width")
        # Hovering and clicking relayout the dock each time.
        for _ in 1 2 3; do
            xy=$(ev "__gd.center('app:$FILES').join(' ')")
            # shellcheck disable=SC2086
            move $xy
            sleep 0.3
            move 800 300
            sleep 0.3
            ev "__gd.dock()._relayout(); true" > /dev/null
        done
        after=$(ev "__gd.item('apps-button').width")
        if [ "$before" = "$after" ]; then pass "$style: the Apps button keeps its width ($after px)"
        else fail "$style: the Apps button grew from $before to $after px"; fi
        assert_true "$style: the Apps label is not cut" \
            "(l => l.width >= l.get_preferred_width(-1)[1] - 0.5)(__gd.item('apps-button')._label)"
    done
    gset dock-style "'glow'"
    wait_for "__gd.dock()?.style.id === 'glow'" 40
    sleep 0.4
    local xy
    xy=$(ev "__gd.center('app:$TE').join(' ')")
    # shellcheck disable=SC2086
    move $xy
    sleep 0.6
    assert_true "glow: the hover glow takes the color of the icon" \
        "__gd.item('app:$TE')._glow.style?.includes('rgba') ?? false"
    move 800 300
    gset dock-style "'dash'"
    wait_for "__gd.dock()?.style.id === 'dash'" 40
    assert_true "dash: the Apps button comes after the pinned apps" \
        "(d => d._items.indexOf(d._itemMap.get('apps-button')) > d._items.indexOf(d._itemMap.get('app:$FILES')))(__gd.dock())"
    gset dock-style "'shelf'"
    wait_for "__gd.dock()?.style.id === 'shelf'" 40
    assert_true "shelf: drawn as a shelf, with reflections" \
        "__gd.dock()._background instanceof imports.gi.St.DrawingArea && !!__gd.item('app:$TE')._reflection"

    gset position "'left'"
    gset dock-style "'line'"
    wait_for "__gd.dock()?.style.id === 'line' && __gd.dock().geom.position === 'left'" 40
    sleep 0.4
    assert_true "line on the left: the bar spans the monitor height" \
        "__gd.dock()._background.height === __gd.dock().monitor.height && __gd.dock()._actor.x === 0"
    [ -n "${SCREENSHOTS:-}" ] && { move 800 300; sleep 0.5; shot styles/line-left; }
    greset position
    greset dock-style
    greset icon-size
    greset magnification-enabled
    wait_for "__gd.dock()?.style.id === 'glass' && __gd.dock().geom.position === 'bottom'" 40
    close_windows "$CALC"
    close_windows "$TE"
    wait_for "__gd.windows('$TE').length === 0 && __gd.windows('$CALC').length === 0" 40
}

scenario_badges() {
    section "Badges and progress (LauncherEntry)"
    set_favorites "['$CALC', '$TE', '$FILES']"
    local item="__gd.item('app:$TE')"
    coproc LAUNCHER { python3 -I "$HERE/fake_launcher.py" "$TE"; }
    read -r _ <&"${LAUNCHER[0]}"
    echo '{"count": 3, "count-visible": true, "progress": 0.4, "progress-visible": true}' >&"${LAUNCHER[1]}"
    read -r _ <&"${LAUNCHER[0]}"
    wait_for "$item._badge.visible" 20
    assert_eq "a count shows as a badge" "$item._badge.visible && $item._badge.text" 3
    assert_true "progress shows as a bar, 40% full" \
        "$item._progress.visible && Math.abs($item._progressFill.width / $item._progress.width - 0.4) < 0.05"
    assert_true "the badge sits on the icon's corner" \
        "(() => { const [bx, by] = $item._badge.get_transformed_position();
            const [ix, iy] = $item._iconActor.get_transformed_position();
            const s = $item._iconActor.width * $item._iconActor.scale_x;
            return bx > ix + s * 0.5 && by < iy + s * 0.5; })()"
    shot badges
    echo '{"count": 120}' >&"${LAUNCHER[1]}"
    read -r _ <&"${LAUNCHER[0]}"
    wait_for "$item._badge.text === '99+'" 20
    assert_eq "large counts show as 99+" "$item._badge.text" "99+"
    echo '{"count-visible": false, "progress-visible": false}' >&"${LAUNCHER[1]}"
    read -r _ <&"${LAUNCHER[0]}"
    wait_for "!$item._badge.visible && !$item._progress.visible" 20
    assert_true "hiding the count and progress removes them" "!$item._badge.visible && !$item._progress.visible"
    echo '{"count": 5, "count-visible": true}' >&"${LAUNCHER[1]}"
    read -r _ <&"${LAUNCHER[0]}"
    wait_for "$item._badge.visible" 20
    exec {LAUNCHER[1]}>&-
    wait "$LAUNCHER_PID" 2>/dev/null
    wait_for "!$item._badge.visible" 20
    assert_true "the badge goes away when the app quits" "!$item._badge.visible"
    gset show-badges false
    sleep 1
    assert_true "badges can be turned off" "!__gd.item('app:$TE')._badge || !__gd.item('app:$TE')._badge.visible"
    greset show-badges
}

scenario_folders() {
    section "Folder stacks"
    local dir="$WORK/Projects"
    mkdir -p "$dir"
    echo a > "$dir/plan.txt"
    touch -d '2026-01-01' "$dir/plan.txt"
    local uri="file://$dir"
    local item="__gd.item('stack:$uri')"
    gset extra-stacks "['$uri']"
    wait_for "!!$item" 40
    assert_true "an added folder shows up as a stack after Downloads" \
        "(d => d._items.indexOf($item) === d._items.indexOf(__gd.item('downloads')) + 1)(__gd.dock())"
    assert_eq "it is named after the folder" "$item.labelText" Projects
    wait_for "$item._newestIcon.visible" 20
    assert_true "its icon shows the newest file" "$item._newestIcon.visible"
    local before
    before=$(ev "$item._newestIcon.gicon.to_string()")
    echo b > "$dir/photo.png"
    wait_for "$item._newestIcon.gicon.to_string() !== '$before'" 40
    assert_true "a new file updates the icon" "$item._newestIcon.gicon.to_string() !== '$before'"
    # A browser download: an empty placeholder plus the partial file.
    touch "$dir/movie.mp4"
    echo c > "$dir/movie.mp4.part"
    sleep 1
    gset downloads-view "'fan'"
    click_item "stack:$uri"
    wait_for '__gd.overlays().length === 1'
    local labels="__gd.overlays()[0].get_children().map(a => a.get_child()?.get_child_at_index(0)?.text ?? '')"
    assert_true "a partial download shows as downloading, once" \
        "$labels.filter(t => t.includes('movie')).length === 1 && $labels.some(t => t === 'Downloading movie.mp4…')"
    assert_true "the fan lists the folder's files" "$labels.includes('plan.txt') && $labels.includes('photo.png')"
    shot folder-stack
    key_escape
    assert_true "the partial file is not taken as the newest" \
        "!$item._newestIcon.gicon.to_string().includes('movie')"
    gset extra-stacks "[]"
    wait_for "!$item" 40
    assert_true "removing the folder removes the stack" "!$item"
}

scenario_hover() {
    section "Hover popup: live previews and mini player"
    set_favorites "['$CALC', '$TE', '$FILES']"
    gset hover-previews true
    gset hover-delay 300
    open_windows "$TE" 2
    local popup="__gd.dock()._hoverPopup"
    local panel="$popup._panel"
    local xy
    move 800 300
    sleep 0.5
    xy=$(ev "__gd.center('app:$TE').join(' ')")
    # shellcheck disable=SC2086
    move $xy
    wait_for "$popup.isOpen" 20
    assert_true "resting on an app opens its hover popup" "$popup.isOpen"
    assert_eq "it shows one live preview per window" \
        "$panel.get_children().find(a => a.has_style_class_name('glass-dock-hover-previews')).get_n_children()" 2
    assert_eq "it takes no grab" 'Main.modalCount' 0
    # The tooltip fades out (100 ms) when the popup opens.
    wait_for "!__gd.dock()._tooltip.visible || __gd.dock()._tooltip.opacity === 0" 20
    assert_true "the tooltip makes way for it" "!__gd.dock()._tooltip.visible || __gd.dock()._tooltip.opacity === 0"
    shot hover-previews

    # Into the popup: it stays, and so does the zoom.
    # shellcheck disable=SC2046
    move $(overlay_point "$panel")
    sleep 0.8
    assert_true "the popup stays open with the pointer on it" "$popup.isOpen"
    assert_eq "the zoom holds still meanwhile" '__gd.dock()._magAmount.value' 1
    local target
    target=$(ev "__gd.windows('$TE')[0].get_stable_sequence()")
    # shellcheck disable=SC2046
    click $(overlay_point "$panel.get_children().find(a => a.has_style_class_name('glass-dock-hover-previews'))
        .get_child_at_index(0).get_child_at_index(1)")
    sleep 0.6
    assert_eq "clicking a preview focuses that window" '__gd.focusSeq()' "$target"
    assert_true "and closes the popup" "!$popup.isOpen"

    # shellcheck disable=SC2086
    move $xy
    wait_for "$popup.isOpen" 20
    move 800 300
    wait_for "!$popup.isOpen" 20
    assert_true "leaving the icon closes it" "!$popup.isOpen"
    wait_for '__gd.dock()._magAmount.value === 0'
    assert_eq "and the zoom collapses" '__gd.dock()._magAmount.value' 0

    xy=$(ev "__gd.center('app:$CALC').join(' ')")
    # shellcheck disable=SC2086
    move $xy
    sleep 0.8
    assert_true "an app without windows or player gets no popup" "!$popup.isOpen"
    move 800 300

    # Mini player
    local log="$WORK/mpris.log"
    : > "$log"
    python3 -I "$HERE/fake_mpris.py" org.gnome.TextEditor "$log" &
    local player_pid=$!
    wait_for "!!__gd.dock().media.playerFor('$TE')" 40
    assert_true "the player is matched to its app" "!!__gd.dock().media.playerFor('$TE')"
    sleep 0.3
    xy=$(ev "__gd.center('app:$TE').join(' ')")
    # shellcheck disable=SC2086
    move $xy
    wait_for "$popup.isOpen && !!$popup._media" 20
    assert_eq "the mini player shows the track" "$popup._media.title.text" "Test Song"
    assert_eq "and the artist" "$popup._media.artist.text" "Tester"
    shot hover-media
    # shellcheck disable=SC2046
    move $(overlay_point "$popup._media.play")
    sleep 0.3
    # shellcheck disable=SC2046
    click $(overlay_point "$popup._media.play")
    wait_for "$popup._media?.play.child.icon_name === 'media-playback-start-symbolic'" 20
    if grep -q PlayPause "$log"; then pass "the player got PlayPause"; else fail "the player got PlayPause"; fi
    assert_eq "the button follows the new state" "$popup._media.play.child.icon_name" media-playback-start-symbolic
    # shellcheck disable=SC2046
    move $(overlay_point "$popup._media.title")
    sleep 0.2
    ev "__gd.scroll(true)" > /dev/null
    sleep 0.8
    if grep -q "Volume=0.55" "$log"; then pass "scrolling on the player raises its volume"
    else fail "scrolling on the player raises its volume ($(tr '\n' ' ' < "$log"))"; fi
    kill "$player_pid" 2>/dev/null
    wait "$player_pid" 2>/dev/null
    wait_for "!$popup._media" 20
    assert_true "the mini player goes away with the player" "!$popup._media"
    move 800 300
    wait_for "!$popup.isOpen" 20

    close_windows "$TE"
    wait_for "__gd.windows('$TE').length === 0" 40
    greset hover-previews
    greset hover-delay
}

scenario_liquid() {
    section "Liquid glass"
    gset liquid-glass true
    wait_for "__gd.dock()?.settings.get_boolean('liquid-glass') && __gd.dock()._lastLayout !== null" 40
    sleep 0.5
    if [ "$(ev '!!__gd.dock()._liquid')" != "true" ]; then
        assert_true "without shader support it falls back to the normal blur" \
            "!__gd.dock()._liquid && __gd.dock()._blur.visible"
        greset liquid-glass
        return
    fi
    local liquid="__gd.dock()._liquid"
    assert_true "the glass replaces the normal blur" "!__gd.dock()._blur.visible && $liquid.actor.visible"
    assert_true "it covers the bar, with a margin for the blur" \
        "(d => { const a = d._liquid.actor, b = d._background;
            return a.x < b.x && a.y < b.y && a.x + a.width > b.x + b.width; })(__gd.dock())"
    assert_true "the cloned windows line up with the screen behind it" \
        "(d => { const [ox, oy] = d._stageOrigin(); const c = d._liquid._clone, a = d._liquid.actor;
            return c.x === -(ox + a.x) && c.y === -(oy + a.y); })(__gd.dock())"
    local xy
    xy=$(ev "__gd.center('downloads').join(' ')")
    # shellcheck disable=SC2086
    move $xy
    sleep 0.6
    shot liquid-glass
    move 800 300
    sleep 0.4
    gset autohide-mode "'autohide'"
    wait_for "__gd.dock()?._liquid && !__gd.dock()._shown" 40
    assert_true "the clone stays lined up while the dock is hidden" \
        "(d => { const [ox, oy] = d._stageOrigin(); const c = d._liquid._clone, a = d._liquid.actor;
            return c.x === -(ox + a.x) && c.y === -(oy + a.y); })(__gd.dock())"
    greset autohide-mode
    wait_for "__gd.dock()?._liquid && __gd.dock()._shown" 40
    ev "Main.overview.show(); true" > /dev/null
    sleep 1.2
    shot liquid-overview
    ev "Main.overview.hide(); true" > /dev/null
    wait_for "!Main.overview.visible" 40
    gset liquid-glass false
    wait_for "!__gd.dock()?._liquid && __gd.dock()?._blur.visible" 40
    assert_true "turning it off brings the normal blur back" "!__gd.dock()._liquid && __gd.dock()._blur.visible"
    greset liquid-glass
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

    section "A dock on every monitor"
    greset monitor-connector
    set_favorites "['$CALC']"
    gset multi-monitor true
    wait_for "__gd.outer().length === 2" 40
    assert_true "there is one dock per monitor" \
        "__gd.docks().map(d => d.monitorIndex).join() === '0,1' &&
         __gd.docks().every(d => __gd.outer().some(o => o.x === d.monitor.x && o.y === d.monitor.y))"
    open_windows "$TE" 1
    local here="__gd.windows('$TE')[0].get_monitor()"
    local there="(1 - $here)"
    wait_for "__gd.docks()[$here]._itemMap.has('app:$TE')" 40
    assert_true "an open app shows on the dock of its window's monitor only" \
        "__gd.docks()[$here]._itemMap.has('app:$TE') && !__gd.docks()[$there]._itemMap.has('app:$TE')"
    local before
    before=$(ev "$here")
    ev "__gd.windows('$TE')[0].move_to_monitor(1 - $before); true" > /dev/null
    wait_for "__gd.docks()[1 - $before]._itemMap.has('app:$TE') && !__gd.docks()[$before]._itemMap.has('app:$TE')" 40
    assert_true "moving the window to the other monitor moves the app with it" \
        "__gd.docks()[1 - $before]._itemMap.has('app:$TE') && !__gd.docks()[$before]._itemMap.has('app:$TE')"
    assert_true "only the dock on the window's monitor is its minimize target" \
        "(() => { const w = __gd.windows('$TE')[0]; const [, r] = w.get_icon_geometry();
            const m = Main.layoutManager.monitors[w.get_monitor()];
            return r.x >= m.x && r.x < m.x + m.width; })()"
    gset isolate-monitors false
    wait_for "__gd.outer().length === 2 && __gd.docks().every(d => d._itemMap.has('app:$TE'))" 40
    assert_true "without isolation both docks show every window" \
        "__gd.docks().every(d => d._itemMap.has('app:$TE'))"
    greset isolate-monitors
    greset multi-monitor
    wait_for "__gd.outer().length === 1" 40
    assert_eq "turning it off leaves a single dock" "__gd.outer().length" 1

    section "Only the current workspace"
    # Windows on other monitors are on every workspace (GNOME's default).
    ev "__gd.windows('$TE')[0].move_to_monitor(Main.layoutManager.primaryIndex); true" > /dev/null
    gset isolate-workspaces true
    wait_for "__gd.dock()?._isolateWorkspace === true" 40
    sleep 0.5
    assert_true "the open app shows on its workspace" "__gd.dock()._itemMap.has('app:$TE')"
    ev "__gd.windows('$TE')[0].change_workspace_by_index(1, false); true" > /dev/null
    wait_for "!__gd.dock()._itemMap.has('app:$TE')" 40
    assert_true "moving its window to another workspace hides it here" "!__gd.dock()._itemMap.has('app:$TE')"
    ev "global.workspace_manager.get_workspace_by_index(1).activate(__gd.time()); true" > /dev/null
    wait_for "__gd.dock()._itemMap.has('app:$TE')" 40
    assert_true "switching to that workspace shows it again" "__gd.dock()._itemMap.has('app:$TE')"
    greset isolate-workspaces
    close_windows "$TE"
    wait_for "__gd.windows('$TE').length === 0" 40
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

scenario_unmatched() {
    section "Windows GNOME does not match to their app (e.g. Spotify snap)"
    stop_shell
    WITH_X11=1 start_shell
    mkdir -p "$XDG_DATA_HOME/applications"
    cat > "$XDG_DATA_HOME/applications/glassdock-fake.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Fake Player
Icon=multimedia-player
Exec=python3 -I $HERE/fake_x11_app.py glassdockfake GlassDockFake
StartupWMClass=glassdockfake
DESKTOP
    wait_for "__gd.app('glassdock-fake.desktop') !== null" 60
    set_favorites "['glassdock-fake.desktop', '$TE']"

    local display xauth fake
    display=$(ev 'imports.gi.GLib.getenv("DISPLAY") ?? ""')
    xauth=$(ev 'imports.gi.GLib.getenv("XAUTHORITY") ?? ""')
    GDK_BACKEND=x11 DISPLAY="$display" XAUTHORITY="$xauth" WAYLAND_DISPLAY= \
        python3 -I "$HERE/fake_x11_app.py" glassdockfake GlassDockFake > /dev/null 2>&1 &
    fake=$!
    wait_for "global.display.list_all_windows().some(w => w.get_wm_class() === 'GlassDockFake')" 60
    sleep 1
    assert_eq "the pinned app shows the window's dot" "__gd.item('app:glassdock-fake.desktop')._dotCount" 1
    assert_eq "no extra generic icon for the window" \
        "[...__gd.dock()._itemMap.keys()].filter(k => k.startsWith('app:window:')).length" 0
    ev "__gd.activate(global.display.list_all_windows().find(w => w.get_wm_class() === 'GlassDockFake'))" > /dev/null
    sleep 0.5
    click_item "app:glassdock-fake.desktop"
    wait_for "global.display.list_all_windows().find(w => w.get_wm_class() === 'GlassDockFake').minimized"
    assert_eq "clicking the icon acts on that window" \
        "global.display.list_all_windows().find(w => w.get_wm_class() === 'GlassDockFake').minimized" true
    kill "$fake" 2>/dev/null
    wait_for "!global.display.list_all_windows().some(w => w.get_wm_class() === 'GlassDockFake')" 40
    assert_eq "the dot goes away when the window closes" "__gd.item('app:glassdock-fake.desktop')._dotCount" 0
    assert_no_js_errors "no JS errors with unmatched windows"
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

MAIN=(lifecycle basics multiwindow dnd autohide stacks zoom zoomconfig remote fit prefs dark styles multiwindow_styles badges folders hover liquid)
SEPARATE=(monitors scale unmatched)
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
