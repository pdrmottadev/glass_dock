// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Dock items: base class, app icons, the Apps button and separators.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';


const BOUNCE_TIME = 220;
const PRESENCE_TIME = 260;
const SCROLL_COOLDOWN_MS = 250;
const MAX_DOTS = 4;

// GNOME 51 renamed ONE/TWO to PRIMARY/MIDDLE (and warns on the old names);
// GNOME 50 only has the old ones.
const BUTTON_MASK = (St.ButtonMask.PRIMARY ?? St.ButtonMask.ONE) |
    (St.ButtonMask.MIDDLE ?? St.ButtonMask.TWO);

/** Popup arrow side for a given dock position. */
export function menuSideFor(position) {
    switch (position) {
    case 'left':
        return St.Side.LEFT;
    case 'right':
        return St.Side.RIGHT;
    default:
        return St.Side.BOTTOM;
    }
}

/**
 * Base class for anything shown as an icon in the dock.
 * The dock positions items itself and calls applyLayout() every frame the
 * layout changes.
 */
export const DockItem = GObject.registerClass(
class DockItem extends St.Button {
    _init(dock, params = {}) {
        super._init({
            style_class: 'glass-dock-item',
            reactive: true,
            can_focus: false,
            track_hover: true,
            button_mask: BUTTON_MASK,
            ...params,
        });

        this._dock = dock;
        this._delegate = this;
        this.accessible_name = this.labelText;
        this.magnifiable = true;
        this._destroyed = false;
        this._bouncing = false;

        // Animated 0..1 "how present" factor used for add/remove animations.
        this.presence = new St.Adjustment({actor: this, lower: 0, upper: 1, value: 0});
        this.presence.connect('notify::value', () => this._dock.queueRelayout());

        this._content = new St.Widget({x_expand: true, y_expand: true});
        this.set_child(this._content);

        this._iconActor = this.createIconActor(dock.metrics.magSize);
        this._content.add_child(this._iconActor);

        // Running indicator: one dot per window (up to MAX_DOTS).
        this._dotCount = 0;
        this._dots = [];
        for (let i = 0; i < MAX_DOTS; i++) {
            const dot = new St.Widget({style_class: 'glass-dock-dot', visible: false});
            this._content.add_child(dot);
            this._dots.push(dot);
        }

        this._menu = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this);

        const longPress = new Clutter.LongPressGesture();
        longPress.connect('recognize', () => this.popupMenu());
        this.add_action(longPress);

        const rightClick = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        rightClick.connect('recognize', () => this.popupMenu());
        this.add_action(rightClick);

        this.connect('notify::hover', () => this._dock.onItemHover(this, this.hover));
        this.connect('destroy', () => this._onDestroy());
    }

    /** Override: returns an actor of size `size` used as the icon. */
    createIconActor(size) {
        return new St.Icon({icon_name: 'application-x-executable', icon_size: size});
    }

    /** Override: text shown in the tooltip. */
    get labelText() {
        return '';
    }

    /** Override: returns a PopupMenu or null. */
    createMenu() {
        return null;
    }

    get iconActor() {
        return this._iconActor;
    }

    getBaseMainSize(m) {
        return m.iconSize + m.spacing;
    }

    /**
     * Positions the icon and dot inside the item.
     *
     * @param {EdgeGeometry} geom
     * @param {number} mainSize  item size along the dock
     * @param {number} crossSize item thickness (bar + magnification zone)
     * @param {number} scale     current magnification scale
     * @param {object} m         dock metrics
     */
    applyLayout(geom, mainSize, crossSize, scale, m) {
        const M = m.magSize;
        const [ix, iy] = geom.rect(crossSize, (mainSize - M) / 2, m.pad, M, M);
        this._iconActor.set_position(Math.round(ix), Math.round(iy));
        this._iconActor.set_size(M, M);
        const [px, py] = geom.edgePivot;
        this._iconActor.set_pivot_point(px, py);
        const k = (m.iconSize * scale * this.presence.value) / M;
        this._iconActor.set_scale(k, k);
        this._iconActor.opacity = Math.round(255 * this.presence.value);

        const D = m.dotSize;
        const gap = Math.max(2, Math.round(D * 0.8));
        const n = this._dotCount;
        const total = n * D + Math.max(0, n - 1) * gap;
        const cross = Math.max(1, (m.pad - D) / 2);
        this._dots.forEach((dot, i) => {
            if (i >= n)
                return;
            const main = (mainSize - total) / 2 + i * (D + gap);
            const [dx, dy] = geom.rect(crossSize, main, cross, D, D);
            dot.set_position(Math.round(dx), Math.round(dy));
            dot.set_size(D, D);
        });
    }

    /** Shows `count` indicator dots (0 hides them). */
    setDotCount(count) {
        if (!this._dock.settings.get_boolean('show-running-indicators'))
            count = 0;
        count = Math.max(0, Math.min(MAX_DOTS, count));
        this._dots.forEach((dot, i) => {
            dot.visible = i < count;
        });
        if (count !== this._dotCount) {
            this._dotCount = count;
            this._dock.queueRelayout();
        }
    }

    setDotsActive(active) {
        for (const dot of this._dots) {
            if (active)
                dot.add_style_class_name('glass-dock-dot-active');
            else
                dot.remove_style_class_name('glass-dock-dot-active');
        }
    }

    setRunning(running) {
        this.setDotCount(running ? 1 : 0);
    }

    appear(animate = true) {
        if (this._vanishing)
            return;
        if (!animate) {
            this.presence.value = 1;
            return;
        }
        this.presence.remove_transition('value');
        this.presence.ease(1, {duration: PRESENCE_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    vanish(onDone) {
        this.reactive = false;
        this.presence.remove_transition('value');
        this.presence.ease(0, {
            duration: PRESENCE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: onDone,
        });
    }

    /**
     * Bounces the icon away from the screen edge.
     *
     * @param {number} times    maximum number of bounces
     * @param {Function} [stopWhen] stops early once this returns true
     */
    bounce(times = 1, stopWhen = () => false) {
        if (this._bouncing || this._destroyed)
            return;
        this._bouncing = true;
        let count = 0;
        const icon = this._iconActor;

        const step = () => {
            if (this._destroyed)
                return;
            if (count >= times || (count > 0 && stopWhen())) {
                this._bouncing = false;
                return;
            }
            count++;
            const [tx, ty] = this._dock.geom.outward(this._dock.metrics.iconSize * 0.45);
            icon.ease({
                translation_x: tx,
                translation_y: ty,
                duration: BOUNCE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    icon.ease({
                        translation_x: 0,
                        translation_y: 0,
                        duration: BOUNCE_TIME,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: step,
                        onStopped: finished => {
                            if (!finished)
                                this._bouncing = false;
                        },
                    });
                },
                onStopped: finished => {
                    if (!finished)
                        this._bouncing = false;
                },
            });
        };
        step();
    }

    popupMenu() {
        if (this._dock.dragging)
            return;
        if (!this._menu) {
            this._menu = this.createMenu();
            if (!this._menu)
                return;
            this._menu.connect('open-state-changed', (menu, open) => {
                this._dock.setMenuOpen(this, open);
            });
            Main.uiGroup.add_child(this._menu.actor);
            this._menuManager.addMenu(this._menu);
        }
        this._dock.prepareMenu();
        this._menu.open(true);
    }

    get menuOpen() {
        return this._menu?.isOpen ?? false;
    }

    _onDestroy() {
        this._destroyed = true;
        this._menu?.destroy();
        this._menu = null;
    }
});

/** An application icon (pinned, running or recent). */
export const DockAppIcon = GObject.registerClass(
class DockAppIcon extends DockItem {
    _init(dock, app) {
        this.app = app;
        super._init(dock);
        this.itemKey = `app:${app.get_id()}`;
        this._lastScroll = 0;
        this._iconGeometry = null;

        this.app.connectObject(
            'notify::state', () => this._syncState(),
            'windows-changed', () => {
                this._syncState();
                this._applyIconGeometry();
            },
            this);
        Shell.WindowTracker.get_default().connectObject(
            'notify::focus-app', () => this._syncFocus(), this);
        // Windows GNOME did not match to this app come and go through the model.
        this._dock.model.connectObject('changed', () => {
            this._syncState();
            this._syncFocus();
            this._applyIconGeometry();
        }, this);
        this._syncState();
        this._syncFocus();

        this._draggable = DND.makeDraggable(this, {timeoutThreshold: 200});
        this._draggable.connectObject(
            'drag-begin', () => this._dock.onItemDragBegin(this),
            'drag-cancelled', () => this._dock.onItemDragEnd(this),
            'drag-end', () => this._dock.onItemDragEnd(this),
            this);
    }

    createIconActor(size) {
        const icon = this.app.create_icon_texture(size);
        icon.add_style_class_name('glass-dock-icon');
        return icon;
    }

    get labelText() {
        return this.app.get_name();
    }

    /** This app's windows, including ones GNOME did not match to it. */
    windows() {
        return this._dock.model.windowsFor(this.app);
    }

    get running() {
        return this._dock.model.isRunning(this.app);
    }

    _syncState() {
        this.setDotCount(this.running ? Math.max(1, this.windows().length) : 0);
    }

    _syncFocus() {
        this.setDotsActive(this._dock.model.isFocused(this.app));
    }

    createMenu() {
        const menu = new AppMenu(this, menuSideFor(this._dock.geom.position), {
            favoritesSection: true,
            showSingleWindows: true,
        });
        menu.setApp(this.app);

        // Extra entry on top: App Exposé, only useful with 2+ windows.
        const exposeItem = new PopupMenu.PopupMenuItem(_('Show All Windows'));
        exposeItem.connect('activate', () => this._dock.openExpose(this));
        menu.addMenuItem(exposeItem, 0);
        menu.connect('open-state-changed', (m, open) => {
            if (open)
                exposeItem.visible = this.windows().length > 1;
        });
        return menu;
    }

    // Called by AppMenu when it launches the app.
    animateLaunch() {
        if (this._dock.settings.get_boolean('bounce-on-launch'))
            this.bounce(10, () => this.running);
    }

    vfunc_clicked(button) {
        this._dock.hideTooltip();
        this.activate(button);
    }

    activate(button) {
        const app = this.app;
        const event = Clutter.get_current_event();
        const modifiers = event ? event.get_state() : 0;
        const isMiddle = button === Clutter.BUTTON_MIDDLE;
        const isCtrl = (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if ((isMiddle || isCtrl) && app.state === Shell.AppState.RUNNING &&
            app.can_open_new_window()) {
            this.animateLaunch();
            app.open_new_window(-1);
            Main.overview.hide();
            return;
        }

        if (!this.running) {
            this.animateLaunch();
            app.activate();
            Main.overview.hide();
            return;
        }

        const windows = this.windows();
        const isFocused = this._dock.model.isFocused(app) && !Main.overview.visible;

        if (windows.length === 0) {
            app.activate();
            Main.overview.hide();
            return;
        }
        if (!isFocused) {
            this._raiseAll(windows);
            Main.overview.hide();
            return;
        }

        const settings = this._dock.settings;
        if (windows.length > 1) {
            switch (settings.get_string('multi-window-action')) {
            case 'previews':
                this._dock.openWindowPreviews(this);
                return;
            case 'expose':
                this._dock.openExpose(this);
                return;
            case 'cycle-windows':
                this._cycleWindows(1);
                return;
            default:
                this._minimizeAll(windows);
                return;
            }
        }

        switch (settings.get_string('click-action')) {
        case 'focus-or-minimize':
            this._minimizeAll(windows);
            break;
        case 'cycle-windows':
            this._cycleWindows(1);
            break;
        default:
            this._raiseAll(windows);
        }
    }

    /**
     * Brings all of the app's windows on this workspace to the front and
     * focuses the one used most recently. Mutter's focus history is used
     * instead of Shell.App.activate(), whose "most recent" can be stale.
     */
    _raiseAll(windows) {
        const time = global.get_current_time();
        const recent = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(w => windows.includes(w));
        const target = recent[0] ?? windows[0];
        const workspace = global.workspace_manager.get_active_workspace();
        // Least recent first, so the most recent ends up on top.
        for (const w of [...recent].reverse()) {
            if (w !== target && !w.minimized && w.located_on_workspace(workspace))
                w.raise();
        }
        Main.activateWindow(target, time);
    }

    _minimizeAll(windows) {
        windows.forEach(w => {
            if (w.can_minimize() && !w.minimized)
                w.minimize();
        });
    }

    _cycleWindows(direction) {
        const windows = this.windows()
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        if (windows.length === 0)
            return;
        const current = windows.indexOf(global.display.focus_window);
        const n = windows.length;
        const next = current === -1 ? 0 : (current + direction + n) % n;
        Main.activateWindow(windows[next]);
    }

    vfunc_scroll_event(event) {
        if (!this.running)
            return Clutter.EVENT_PROPAGATE;
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastScroll < SCROLL_COOLDOWN_MS)
            return Clutter.EVENT_STOP;

        let dir = 0;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            dir = -1;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            dir = 1;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            const d = Math.abs(dy) > Math.abs(dx) ? dy : dx;
            if (Math.abs(d) < 0.3)
                return Clutter.EVENT_STOP;
            dir = d > 0 ? 1 : -1;
            break;
        }
        }
        if (dir !== 0) {
            this._lastScroll = now;
            this._cycleWindows(dir);
        }
        return Clutter.EVENT_STOP;
    }

    // --- DnD source -------------------------------------------------------

    getDragActor() {
        return this.app.create_icon_texture(this._dock.metrics.iconSize);
    }

    getDragActorSource() {
        return this._iconActor;
    }

    // --- Minimize target ----------------------------------------------------

    /** @param {Mtk.Rectangle|null} rect stage rectangle of the icon */
    setIconGeometry(rect) {
        this._iconGeometry = rect;
        this._applyIconGeometry();
    }

    _applyIconGeometry() {
        for (const w of this.windows())
            w.set_icon_geometry(this._iconGeometry);
    }

    _onDestroy() {
        if (this._iconGeometry) {
            for (const w of this.windows())
                w.set_icon_geometry(null);
        }
        this.app.disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        this._dock.model.disconnectObject(this);
        super._onDestroy();
    }
});

/** The "Apps" button (opens the app grid). */
export const DockAppsButton = GObject.registerClass(
class DockAppsButton extends DockItem {
    _init(dock) {
        super._init(dock);
        this.itemKey = 'apps-button';
    }

    createIconActor(size) {
        const tile = new St.Bin({
            style_class: 'glass-dock-apps-tile',
            style: `border-radius: ${Math.round(size * 0.24)}px;`,
            child: new St.Icon({
                icon_name: 'view-app-grid-symbolic',
                icon_size: Math.round(size * 0.52),
                style_class: 'glass-dock-apps-tile-icon',
            }),
        });
        return tile;
    }

    get labelText() {
        return _('Applications');
    }

    vfunc_clicked() {
        this._dock.hideTooltip();
        if (Main.overview.visible && Main.overview.dash.showAppsButton.checked)
            Main.overview.hide();
        else
            Main.overview.showApps();
    }
});

/** Thin vertical/horizontal divider between sections. */
export const DockSeparator = GObject.registerClass(
class DockSeparator extends St.Widget {
    _init(dock, key) {
        super._init({reactive: false});
        this._dock = dock;
        this.itemKey = key;
        this.magnifiable = false;
        this.presence = new St.Adjustment({actor: this, lower: 0, upper: 1, value: 0});
        this.presence.connect('notify::value', () => this._dock.queueRelayout());

        this._line = new St.Widget({style_class: 'glass-dock-separator'});
        this.add_child(this._line);
    }

    getBaseMainSize(m) {
        return m.separatorSize;
    }

    applyLayout(geom, mainSize, crossSize, _scale, m) {
        const thickness = 1;
        const length = m.iconSize * 0.7;
        const crossOffset = m.pad + (m.iconSize - length) / 2;
        const [x, y, w, h] = geom.rect(crossSize, (mainSize - thickness) / 2,
            crossOffset, thickness, length);
        this._line.set_position(Math.round(x), Math.round(y));
        this._line.set_size(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        this._line.opacity = Math.round(255 * this.presence.value);
    }

    appear(animate = true) {
        if (this._vanishing)
            return;
        if (!animate) {
            this.presence.value = 1;
            return;
        }
        this.presence.ease(1, {duration: PRESENCE_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    vanish(onDone) {
        this.presence.remove_transition('value');
        this.presence.ease(0, {
            duration: PRESENCE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: onDone,
        });
    }
});
