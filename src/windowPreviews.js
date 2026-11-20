// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Live window thumbnails and the window-previews popup shown when clicking
// a focused app that has several windows.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ModalLayer} from './overlay.js';
import {getInterestingWindows} from './utils.js';

const THUMB_MAX_W = 240;
const THUMB_MAX_H = 150;
const MINIMIZED_OPACITY = 150;

/** Windows of an app in a stable order (creation order). */
export function sortedWindows(app) {
    return getInterestingWindows(app)
        .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
}

/**
 * A live thumbnail of a window, cropped to its frame (no client-side shadows
 * or invisible borders). Same idea as the Alt+Tab switcher's clone.
 *
 * @param {Meta.Window} metaWindow
 * @param {number} maxW
 * @param {number} maxH
 * @returns {{actor: St.Widget, width: number, height: number, scale: number}|null}
 */
export function createWindowThumbnail(metaWindow, maxW, maxH) {
    const windowActor = metaWindow.get_compositor_private();
    if (!windowActor)
        return null;

    const frame = metaWindow.get_frame_rect();
    if (frame.width <= 0 || frame.height <= 0)
        return null;
    const scale = Math.min(1, maxW / frame.width, maxH / frame.height);
    const width = Math.max(1, Math.round(frame.width * scale));
    const height = Math.max(1, Math.round(frame.height * scale));

    const container = new St.Widget({width, height, clip_to_allocation: true});
    const [ax, ay] = windowActor.get_position();
    const [aw, ah] = windowActor.get_size();
    const clone = new Clutter.Clone({
        source: windowActor,
        x: Math.round((ax - frame.x) * scale),
        y: Math.round((ay - frame.y) * scale),
        width: Math.round(aw * scale),
        height: Math.round(ah * scale),
    });
    container.add_child(clone);
    return {actor: container, width, height, scale};
}

export class WindowPreviewsPopup {
    constructor(item) {
        this._dock = item._dock;
        this._app = item.app;
        this._vertical = this._dock.geom.vertical;

        this._modal = new ModalLayer(this._dock, {
            onClose: () => this._animateOut(),
            onFinished: () => this._app.disconnectObject(this),
        });
        this._anchor = this._modal.anchorFor(item);

        this._panel = new St.BoxLayout({
            style_class: 'glass-dock-preview-panel',
            orientation: this._vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
        });
        this._modal.actor.add_child(this._panel);

        this._app.connectObject('windows-changed', () => this._rebuild(), this);
        this._rebuild();

        const [px, py] = this._dock.geom.edgePivot;
        this._panel.set_pivot_point(px, py);
        this._panel.opacity = 0;
        this._panel.set_scale(0.92, 0.92);
        this._panel.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    get closed() {
        return this._modal.closed;
    }

    _thumbSize(count) {
        const monitor = this._modal.monitor;
        if (this._vertical) {
            const h = (monitor.height * 0.8) / count - 60;
            return [THUMB_MAX_W, Math.max(60, Math.min(THUMB_MAX_H, h))];
        }
        const w = (monitor.width * 0.9) / count - 30;
        return [Math.max(100, Math.min(THUMB_MAX_W, w)), THUMB_MAX_H];
    }

    _rebuild() {
        if (this.closed)
            return;
        const windows = sortedWindows(this._app);
        if (windows.length === 0) {
            this.close();
            return;
        }

        this._panel.destroy_all_children();
        const [maxW, maxH] = this._thumbSize(windows.length);
        for (const w of windows)
            this._panel.add_child(this._createCard(w, maxW, maxH));

        this._panel.set_size(-1, -1);
        this._modal.positionPanel(this._panel, this._anchor);
    }

    _createCard(metaWindow, maxW, maxH) {
        const card = new St.BoxLayout({
            style_class: 'glass-dock-preview-card',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            track_hover: true,
        });
        if (metaWindow.has_focus())
            card.add_style_pseudo_class('checked');

        const header = new St.BoxLayout({style_class: 'glass-dock-preview-header'});
        const title = new St.Label({
            style_class: 'glass-dock-preview-title',
            text: metaWindow.get_title() || this._app.get_name(),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        title.set_width(maxW - 28);
        header.add_child(title);

        const closeButton = new St.Button({
            style_class: 'glass-dock-preview-close',
            accessible_name: _('Close Window'),
            child: new St.Icon({icon_name: 'window-close-symbolic', icon_size: 12}),
            y_align: Clutter.ActorAlign.CENTER,
        });
        closeButton.connect('clicked', () => {
            metaWindow.delete(global.get_current_time());
        });
        header.add_child(closeButton);
        card.add_child(header);

        const thumbButton = new St.Button({
            style_class: 'glass-dock-preview-thumb',
            accessible_name: title.text,
            width: maxW,
            height: maxH,
        });
        const thumb = createWindowThumbnail(metaWindow, maxW, maxH);
        if (thumb) {
            thumb.actor.x_align = Clutter.ActorAlign.CENTER;
            thumb.actor.y_align = Clutter.ActorAlign.CENTER;
            thumb.actor.x_expand = true;
            thumb.actor.y_expand = true;
            const bin = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
            bin.add_child(thumb.actor);
            thumbButton.set_child(bin);
        } else {
            thumbButton.set_child(this._app.create_icon_texture(64));
        }
        if (metaWindow.minimized)
            thumbButton.opacity = MINIMIZED_OPACITY;
        thumbButton.connect('clicked', () => {
            const time = global.get_current_time();
            this.close();
            Main.activateWindow(metaWindow, time);
        });
        card.add_child(thumbButton);

        metaWindow.connectObject('notify::title', () => {
            title.text = metaWindow.get_title() || this._app.get_name();
        }, card);
        card.connect('destroy', () => metaWindow.disconnectObject(card));
        return card;
    }

    _animateOut() {
        this._panel.ease({
            opacity: 0,
            scale_x: 0.92,
            scale_y: 0.92,
            duration: 140,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
        return 140;
    }

    close() {
        this._modal.close();
    }

    destroyNow() {
        this._app.disconnectObject(this);
        this._modal.destroyNow();
    }
}
