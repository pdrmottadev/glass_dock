// SPDX-License-Identifier: GPL-2.0-or-later
// Evaluated once inside the test shell: helpers the test scenarios call
// through org.gnome.Shell.Eval as __gd.*.
(() => {
    const Clutter = imports.gi.Clutter;
    const GLib = imports.gi.GLib;
    const Shell = imports.gi.Shell;
    const seat = global.stage.get_context().get_backend().get_default_seat();
    const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    // Virtual device timestamps are in microseconds of the monotonic clock,
    // the same base as real input events.
    const now = () => GLib.get_monotonic_time();
    const KEY_ESC = 1; // evdev keycode

    globalThis.__gd = {
        outer() {
            return Main.layoutManager.uiGroup.get_children().filter(a => a.name === 'glassDockOuter');
        },
        dock() {
            const [outer] = this.outer();
            return outer?.get_children().find(c => c.name === 'glassDock')._delegate ?? null;
        },
        item(key) {
            return this.dock()._itemMap.get(key);
        },
        center(key) {
            const dock = this.dock();
            const [x, y, w, h] = dock.iconRectFor(this.item(key));
            return [Math.round(dock.monitor.x + x + w / 2), Math.round(dock.monitor.y + y + h / 2)];
        },
        app(id) {
            return Shell.AppSystem.get_default().lookup_app(id);
        },
        windows(id) {
            return this.app(id).get_windows().sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        },
        focusSeq() {
            return global.display.focus_window?.get_stable_sequence() ?? -1;
        },
        // Open overlays (a closing one is no longer reactive).
        overlays() {
            return Main.uiGroup.get_children()
                .filter(a => a.has_style_class_name?.('glass-dock-overlay') && a.reactive);
        },
        // Timestamp in the same base as the virtual input events, so that
        // Mutter's focus-stealing prevention accepts test activations.
        time() {
            return Math.floor(now() / 1000);
        },
        activate(window) {
            Main.activateWindow(window, this.time());
            return true;
        },
        launch(id) {
            this.app(id).activate_full(-1, this.time());
            return true;
        },
        openNewWindow(id) {
            this.app(id).open_new_window(-1);
            return true;
        },
        workArea() {
            const r = global.workspace_manager.get_active_workspace().get_work_area_for_monitor(0);
            return [r.x, r.y, r.width, r.height].join(',');
        },
        move(x, y) {
            pointer.notify_absolute_motion(now(), x, y);
            return true;
        },
        press(x, y) {
            this.move(x, y);
            pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
            return true;
        },
        release() {
            pointer.notify_button(now(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
            return true;
        },
        click(x, y, button = 1) {
            this.move(x, y);
            const t = now();
            pointer.notify_button(t, button, Clutter.ButtonState.PRESSED);
            pointer.notify_button(t + 50000, button, Clutter.ButtonState.RELEASED);
            return true;
        },
        relative(dx, dy) {
            pointer.notify_relative_motion(now(), dx, dy);
            return true;
        },
        escape() {
            const t = now();
            keyboard.notify_key(t, KEY_ESC, Clutter.KeyState.PRESSED);
            keyboard.notify_key(t + 1000, KEY_ESC, Clutter.KeyState.RELEASED);
            return true;
        },
        // Whether an actor belongs to the dock extension (used for pick checks).
        isDockActor(actor) {
            const dock = this.dock();
            return this.outer().some(o => o === actor || o.contains(actor)) ||
                (dock?._struts && dock._struts === actor);
        },
    };
    return true;
})();
