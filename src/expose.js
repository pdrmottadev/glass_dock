// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// App Exposé: dims the screen and spreads the windows of one app in a grid.
// Clicking a window focuses it; Escape or a click on empty space cancels.
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ModalLayer} from './overlay.js';
import {createWindowThumbnail, sortedWindows} from './windowPreviews.js';

const ANIMATION_TIME = 320;
const GAP = 28;
const PADDING = 48;
const LABEL_SPACE = 34;
const HOVER_SCALE = 1.03;

/**
 * Picks the column count that lets the windows be shown the largest.
 *
 * @param {Array<{w:number,h:number}>} sizes window frame sizes
 * @param {number} areaW
 * @param {number} areaH
 * @returns {{cols:number, rows:number, cellW:number, cellH:number, scale:number}}
 */
export function chooseGrid(sizes, areaW, areaH) {
    const n = sizes.length;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const cellW = (areaW - (cols - 1) * GAP) / cols;
        const cellH = (areaH - (rows - 1) * GAP) / rows - LABEL_SPACE;
        if (cellW <= 0 || cellH <= 0)
            continue;
        const scale = Math.min(1, ...sizes.map(s => Math.min(cellW / s.w, cellH / s.h)));
        if (!best || scale > best.scale + 1e-6)
            best = {cols, rows, cellW, cellH, scale};
    }
    return best ?? {cols: n, rows: 1, cellW: areaW / n, cellH: areaH, scale: 0.1};
}

export class AppExpose {
    constructor(item) {
        this._dock = item._dock;
        this._item = item;
        this._app = item.app;
        this._chosen = null;
        this._entries = [];

        this._modal = new ModalLayer(this._dock, {
            styleClass: 'glass-dock-expose',
            onClose: () => this._animateOut(),
            onFinished: () => {
                // Use the click's timestamp: activating with time 0 would not
                // update the window's user time (MRU order).
                if (this._chosen)
                    Main.activateWindow(this._chosen, this._chosenTime);
            },
        });
        const layer = this._modal.actor;
        const monitor = this._modal.monitor;

        this._veil = new St.Widget({
            style_class: 'glass-dock-expose-veil',
            width: monitor.width,
            height: monitor.height,
            opacity: 0,
        });
        layer.add_child(this._veil);
        this._veil.ease({opacity: 255, duration: ANIMATION_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});

        this._anchor = this._modal.anchorFor(item);
        this._build();
    }

    get closed() {
        return this._modal.closed;
    }

    /** Free area for the grid, in layer (monitor-local) coordinates. */
    _area() {
        const monitor = this._modal.monitor;
        const work = global.workspace_manager.get_active_workspace()
            .get_work_area_for_monitor(this._dock.monitorIndex);
        const y = work.y - monitor.y;
        let x = work.x - monitor.x;
        let w = work.width, h = work.height;

        // Keep clear of the dock even when it does not reserve space.
        const m = this._dock.metrics;
        const dockDepth = m.margin + m.thickness;
        switch (this._dock.geom.position) {
        case 'left':
            if (x < dockDepth) {
                w -= dockDepth - x;
                x = dockDepth;
            }
            break;
        case 'right':
            w = Math.min(w, monitor.width - dockDepth - x);
            break;
        default:
            h = Math.min(h, monitor.height - dockDepth - y);
        }
        return {x: x + PADDING, y: y + PADDING, w: w - 2 * PADDING, h: h - 2 * PADDING};
    }

    _build() {
        const windows = sortedWindows(this._item.windows());
        if (windows.length === 0) {
            this.close();
            return;
        }
        const monitor = this._modal.monitor;
        const area = this._area();
        const sizes = windows.map(w => {
            const r = w.get_frame_rect();
            return {w: Math.max(1, r.width), h: Math.max(1, r.height)};
        });
        const grid = chooseGrid(sizes, area.w, area.h);
        const activeWs = global.workspace_manager.get_active_workspace();

        // Center the rows: the last row may hold fewer windows.
        windows.forEach((metaWindow, i) => {
            const frame = metaWindow.get_frame_rect();
            const thumb = createWindowThumbnail(metaWindow, frame.width, frame.height);
            if (!thumb)
                return;

            const row = Math.floor(i / grid.cols);
            const inRow = Math.min(grid.cols, windows.length - row * grid.cols);
            const col = i % grid.cols;
            const rowWidth = inRow * grid.cellW + (inRow - 1) * GAP;
            const gridHeight = grid.rows * (grid.cellH + LABEL_SPACE) + (grid.rows - 1) * GAP;
            const cx = area.x + (area.w - rowWidth) / 2 + col * (grid.cellW + GAP) + grid.cellW / 2;
            const cy = area.y + (area.h - gridHeight) / 2 + row * (grid.cellH + LABEL_SPACE + GAP) + grid.cellH / 2;
            const scale = Math.min(1, grid.cellW / frame.width, grid.cellH / frame.height);

            const button = new St.Button({
                style_class: 'glass-dock-expose-window',
                accessible_name: metaWindow.get_title() || this._app.get_name(),
                width: thumb.width,
                height: thumb.height,
                child: thumb.actor,
            });
            button.set_pivot_point(0.5, 0.5);
            this._modal.actor.add_child(button);

            // Start where the window really is (or at the dock icon).
            const onScreen = !metaWindow.minimized && metaWindow.located_on_workspace(activeWs);
            const start = onScreen
                ? {x: frame.x - monitor.x, y: frame.y - monitor.y, scale: 1, opacity: 255}
                : {
                    x: this._anchor.x - frame.width / 2,
                    y: this._anchor.y - frame.height / 2,
                    scale: Math.max(0.02, this._anchor.width / frame.width),
                    opacity: 0,
                };
            const target = {x: cx - frame.width / 2, y: cy - frame.height / 2, scale};
            button.set_position(start.x, start.y);
            button.set_scale(start.scale, start.scale);
            button.opacity = start.opacity;
            button.ease({
                x: target.x,
                y: target.y,
                scale_x: scale,
                scale_y: scale,
                opacity: 255,
                duration: ANIMATION_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            });

            const label = new St.Label({
                style_class: 'glass-dock-expose-title',
                text: metaWindow.get_title() || this._app.get_name(),
                opacity: 0,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._modal.actor.add_child(label);
            const [, natW] = label.get_preferred_width(-1);
            const labelW = Math.min(natW, grid.cellW);
            label.set_width(labelW);
            label.set_position(Math.round(cx - labelW / 2), Math.round(cy + (frame.height * scale) / 2 + 10));
            label.ease({
                opacity: 255,
                delay: ANIMATION_TIME / 2,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });

            button.connect('notify::hover', () => {
                if (this.closed)
                    return;
                const s = button.hover ? scale * HOVER_SCALE : scale;
                button.ease({scale_x: s, scale_y: s, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                if (button.hover)
                    label.add_style_pseudo_class('hover');
                else
                    label.remove_style_pseudo_class('hover');
            });
            button.connect('clicked', () => {
                this._chosen = metaWindow;
                this._chosenTime = global.get_current_time();
                this.close();
            });

            this._entries.push({metaWindow, button, label, start, onScreen});
        });
    }

    _animateOut() {
        this._veil.ease({opacity: 0, duration: ANIMATION_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        const monitor = this._modal.monitor;
        for (const e of this._entries) {
            e.label.ease({opacity: 0, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            const chosen = e.metaWindow === this._chosen;
            // The chosen window (or every visible one on cancel) flies back
            // to its real place; the others fade out.
            if ((chosen && !e.metaWindow.minimized) || (!this._chosen && e.onScreen)) {
                const frame = e.metaWindow.get_frame_rect();
                e.button.ease({
                    x: frame.x - monitor.x,
                    y: frame.y - monitor.y,
                    scale_x: 1,
                    scale_y: 1,
                    duration: ANIMATION_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUINT,
                });
            } else {
                e.button.ease({
                    opacity: 0,
                    duration: ANIMATION_TIME * 0.7,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }
        return ANIMATION_TIME;
    }

    close() {
        this._modal.close();
    }

    destroyNow() {
        this._modal.destroyNow();
    }
}
