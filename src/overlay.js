// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Shared modal overlay used by the Downloads stack, window previews and
// App Exposé: a monitor-sized reactive layer that grabs input and closes on
// Escape or a click on empty space.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DEFAULT_CLOSE_TIME = 170;

export class ModalLayer {
    /**
     * @param {Dock} dock
     * @param {object} params
     * @param {string} [params.styleClass] extra style class for the layer
     * @param {Function} [params.onClose] runs exit animations; returns their duration in ms
     * @param {Function} [params.onFinished] called after the layer is destroyed
     */
    constructor(dock, {styleClass = '', onClose = () => DEFAULT_CLOSE_TIME, onFinished = () => {}} = {}) {
        this._dock = dock;
        this._onClose = onClose;
        this._onFinished = onFinished;
        this.closed = false;

        const monitor = dock.monitor;
        const classes = ['glass-dock-overlay', styleClass];
        if (dock.dark)
            classes.push('glass-dock-dark');
        this.actor = new St.Widget({
            style_class: classes.filter(Boolean).join(' '),
            reactive: true,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
        });
        // Clutter 51 only emits the generic 'event' signal for buttons/keys.
        this.actor.connect('event', (actor, event) => {
            const type = event.type();
            if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) {
                if (global.stage.get_event_actor(event) === this.actor) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
            } else if (type === Clutter.EventType.KEY_PRESS &&
                       event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        dock.registerOverlay(this);
        Main.uiGroup.add_child(this.actor);
        this._grab = Main.pushModal(this.actor, {actionMode: Shell.ActionMode.POPUP});
        this.actor.grab_key_focus();
        dock.setPopupOpen(true);
    }

    get monitor() {
        return this._dock.monitor;
    }

    /**
     * Anchor points of a dock item's icon, in layer coordinates.
     */
    anchorFor(item) {
        const [x, y, w, h] = this._dock.settledIconRect(item) ?? [0, 0, 0, 0];
        return {
            x: x + w / 2,
            y: y + h / 2,
            top: y,
            bottom: y + h,
            left: x,
            right: x + w,
            width: w,
            height: h,
        };
    }

    /**
     * Places a panel next to the anchor, on the side facing away from the
     * screen edge, clamped to the monitor.
     */
    positionPanel(panel, anchor, gap = 16) {
        const monitor = this.monitor;
        const maxH = Math.round(monitor.height * 0.6);
        const [, natW] = panel.get_preferred_width(-1);
        const [, natH] = panel.get_preferred_height(natW);
        const w = Math.min(natW, monitor.width - 40);
        const h = Math.min(natH, maxH);
        panel.set_size(w, h);

        let x, y;
        switch (this._dock.geom.position) {
        case 'left':
            x = anchor.right + gap;
            y = anchor.y - h / 2;
            break;
        case 'right':
            x = anchor.left - gap - w;
            y = anchor.y - h / 2;
            break;
        default:
            x = anchor.x - w / 2;
            y = anchor.top - gap - h;
        }
        x = Math.max(12, Math.min(x, monitor.width - w - 12));
        y = Math.max(12, Math.min(y, monitor.height - h - 12));
        panel.set_position(Math.round(x), Math.round(y));
    }

    close() {
        if (this.closed)
            return;
        this.closed = true;
        this._releaseGrab();
        this._dock.unregisterOverlay(this);
        this._dock.setPopupOpen(false);
        this.actor.reactive = false;

        const duration = this._onClose();
        this._closeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration + 20, () => {
            this._closeId = 0;
            this._finish();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Immediate teardown without animations (dock/extension going away). */
    destroyNow() {
        if (this._closeId) {
            GLib.source_remove(this._closeId);
            this._closeId = 0;
        }
        if (!this.closed) {
            this.closed = true;
            this._releaseGrab();
            this._dock.unregisterOverlay(this);
        }
        this._finish(false);
    }

    _releaseGrab() {
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
    }

    _finish(notify = true) {
        if (this._finished)
            return;
        this._finished = true;
        this.actor.destroy();
        if (notify)
            this._onFinished();
    }
}
