// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Auto-hide and intellihide for the dock.
//
//  never       – always visible (the dock reserves screen space)
//  autohide    – hidden unless the pointer is on it or pushes the screen edge
//  intellihide – hidden only while a window of the focused app overlaps it
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PRESSURE_THRESHOLD = 100; // px
const PRESSURE_TIMEOUT = 1000; // ms
const CHECK_DELAY_MS = 60;
const REVEAL_GRACE_MS = 1500;

const OVERLAP_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
    Meta.WindowType.TOOLBAR,
];

export class AutoHide {
    constructor(dock) {
        this._dock = dock;
        this._mode = dock.settings.get_string('autohide-mode');
        this._hideDelay = dock.settings.get_int('autohide-delay');
        this._revealed = false;
        this._hideTimeoutId = 0;
        this._checkId = 0;
        this._revealTimeoutId = 0;
        this._focusWindow = null;
        this._hoverLeft = false;

        if (this._mode === 'never')
            return;

        this._setupEdgeTrigger();

        Main.overview.connectObject(
            'showing', () => this.update(),
            'hidden', () => this.update(),
            this);

        if (this._mode === 'intellihide') {
            global.display.connectObject(
                'notify::focus-window', () => this._onFocusChanged(),
                'restacked', () => this._queueCheck(),
                'window-entered-monitor', () => this._queueCheck(),
                'window-left-monitor', () => this._queueCheck(),
                this);
            global.workspace_manager.connectObject(
                'active-workspace-changed', () => this._queueCheck(), this);
            this._onFocusChanged();
        }

        this.update(false);
    }

    get enabled() {
        return this._mode !== 'never';
    }

    // ---- Edge trigger ----------------------------------------------------

    _setupEdgeTrigger() {
        const m = this._dock.monitor;
        const pos = this._dock.geom.position;
        const canBarrier = (global.backend.capabilities & Meta.BackendCapabilities.BARRIERS) !== 0;

        if (canBarrier) {
            let params;
            switch (pos) {
            case 'left':
                params = {x1: m.x, x2: m.x, y1: m.y, y2: m.y + m.height,
                    directions: Meta.BarrierDirection.POSITIVE_X};
                break;
            case 'right':
                params = {x1: m.x + m.width, x2: m.x + m.width, y1: m.y, y2: m.y + m.height,
                    directions: Meta.BarrierDirection.NEGATIVE_X};
                break;
            default:
                params = {x1: m.x, x2: m.x + m.width, y1: m.y + m.height, y2: m.y + m.height,
                    directions: Meta.BarrierDirection.NEGATIVE_Y};
            }
            this._pressure = new Layout.PressureBarrier(PRESSURE_THRESHOLD, PRESSURE_TIMEOUT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
            this._pressure.connect('trigger', () => this._reveal());
            this._barrier = new Meta.Barrier({backend: global.backend, ...params});
            this._pressure.addBarrier(this._barrier);
        } else {
            // Fallback: a 1px hot strip along the edge.
            let x = m.x, y = m.y, w = m.width, h = m.height;
            if (pos === 'left')
                w = 1;
            else if (pos === 'right')
                [x, w] = [m.x + m.width - 1, 1];
            else
                [y, h] = [m.y + m.height - 1, 1];
            this._hotStrip = new St.Widget({reactive: true, track_hover: true, x, y, width: w, height: h});
            this._hotStrip.connect('notify::hover', () => {
                if (this._hotStrip.hover)
                    this._reveal();
            });
            Main.layoutManager.addChrome(this._hotStrip, {trackFullscreen: true});
        }
    }

    _reveal() {
        this._revealed = true;
        if (this._revealTimeoutId)
            GLib.source_remove(this._revealTimeoutId);
        // If the pointer never reaches the dock, hide again after a while.
        this._revealTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REVEAL_GRACE_MS, () => {
            this._revealTimeoutId = 0;
            if (!this._dock.hovered) {
                this._revealed = false;
                this.update();
            }
            return GLib.SOURCE_REMOVE;
        });
        this.update();
    }

    /** Called by the dock when hover changes. */
    onHoverChanged(hovered) {
        if (!hovered) {
            this._revealed = false;
            this._hoverLeft = true;
        }
        this.update();
    }

    // ---- Intellihide -----------------------------------------------------

    _onFocusChanged() {
        this._focusWindow?.disconnectObject(this);
        this._focusWindow = global.display.focus_window;
        this._focusWindow?.connectObject(
            'position-changed', () => this._queueCheck(),
            'size-changed', () => this._queueCheck(),
            'notify::minimized', () => this._queueCheck(),
            'unmanaged', () => {
                this._focusWindow?.disconnectObject(this);
                this._focusWindow = null;
            },
            this);
        this._queueCheck();
    }

    _queueCheck() {
        if (this._checkId)
            return;
        this._checkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CHECK_DELAY_MS, () => {
            this._checkId = 0;
            this.update();
            return GLib.SOURCE_REMOVE;
        });
    }

    _windowsOverlap() {
        const rect = this._dock.getHideRect();
        if (!rect)
            return false;
        const focusApp = Shell.WindowTracker.get_default().focus_app;
        const focusWin = global.display.focus_window;
        const workspace = global.workspace_manager.get_active_workspace();

        return workspace.list_windows().some(w => {
            if (w.minimized || !w.showing_on_its_workspace())
                return false;
            if (w.get_monitor() !== this._dock.monitorIndex)
                return false;
            if (!OVERLAP_TYPES.includes(w.get_window_type()))
                return false;
            const app = Shell.WindowTracker.get_default().get_window_app(w);
            const belongsToFocus = w === focusWin || (focusApp && app === focusApp);
            if (!belongsToFocus)
                return false;
            return w.get_frame_rect().overlap(rect);
        });
    }

    // ---- Decision --------------------------------------------------------

    _shouldShow() {
        if (Main.overview.visible || this._dock.requiresVisibility || this._dock.hovered || this._revealed)
            return true;
        if (this._mode === 'autohide')
            return false;
        return !this._windowsOverlap();
    }

    update(animate = true) {
        if (this._mode === 'never') {
            this._dock.slideIn(animate);
            return;
        }

        const fromHover = this._hoverLeft;
        this._hoverLeft = false;

        if (this._shouldShow()) {
            this._cancelHide();
            this._dock.slideIn(animate);
            return;
        }

        if (!animate) {
            this._cancelHide();
            this._dock.slideOut(false);
            return;
        }
        if (this._hideTimeoutId)
            return;

        // Leaving the dock waits for the configured delay; a window moving
        // over it hides it right away.
        const delay = this._mode === 'autohide' || fromHover ? this._hideDelay : 0;
        this._hideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(delay, 1), () => {
            this._hideTimeoutId = 0;
            if (!this._shouldShow())
                this._dock.slideOut(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelHide() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
    }

    destroy() {
        this._cancelHide();
        for (const id of [this._checkId, this._revealTimeoutId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._checkId = this._revealTimeoutId = 0;

        Main.overview.disconnectObject(this);
        global.display.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        this._focusWindow?.disconnectObject(this);
        this._focusWindow = null;

        if (this._pressure) {
            this._pressure.destroy();
            this._pressure = null;
        }
        if (this._barrier) {
            this._barrier.destroy();
            this._barrier = null;
        }
        this._hotStrip?.destroy();
        this._hotStrip = null;
    }
}
