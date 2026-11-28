// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Small helpers shared across the dock.
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.File.prototype, 'delete_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

/**
 * Maps abstract "main axis / cross axis" coordinates to real x/y for a dock
 * glued to one screen edge. The cross axis is measured from the screen edge
 * inwards (0 = touching the edge).
 */
export class EdgeGeometry {
    constructor(position) {
        this.position = position;
        this.vertical = position !== 'bottom';
    }

    /**
     * Rectangle of a child inside a container whose cross thickness is
     * `containerCross`.
     *
     * @returns {number[]} [x, y, width, height]
     */
    rect(containerCross, main, cross, mainSize, crossSize) {
        switch (this.position) {
        case 'left':
            return [cross, main, crossSize, mainSize];
        case 'right':
            return [containerCross - cross - crossSize, main, crossSize, mainSize];
        default:
            return [main, containerCross - cross - crossSize, mainSize, crossSize];
        }
    }

    /** Pivot point that keeps the edge-facing side of an actor fixed. */
    get edgePivot() {
        switch (this.position) {
        case 'left':
            return [0, 0.5];
        case 'right':
            return [1, 0.5];
        default:
            return [0.5, 1];
        }
    }

    /** Translation (tx, ty) moving `v` px away from the screen edge. */
    outward(v) {
        switch (this.position) {
        case 'left':
            return [v, 0];
        case 'right':
            return [-v, 0];
        default:
            return [0, -v];
        }
    }

    /** Main-axis coordinate of a stage point. */
    mainOf(x, y) {
        return this.vertical ? y : x;
    }
}

/** Extracts a Shell.App from a DnD source (dock items or overview icons). */
export function getAppFromSource(source) {
    return source.app instanceof Shell.App ? source.app : null;
}

/** Windows of an app that should be represented in the dock. */
export function getInterestingWindows(app) {
    return app.get_windows().filter(w => !w.skip_taskbar);
}

/** Whether an error is just a cancelled GIO operation. */
export function isCancelled(error) {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

/** Opens a URI with its default application, telling the user on failure. */
export function launchUri(uri) {
    try {
        Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
    } catch (e) {
        Main.notifyError(_('Could not open %s').format(uri), e.message);
    }
}

/**
 * Average color of an icon, weighted toward its saturated pixels, or null
 * when the icon cannot be loaded.
 *
 * @param {Gio.Icon} gicon
 * @returns {number[]|null} [r, g, b]
 */
export function iconColor(gicon) {
    let pixbuf = null;
    try {
        if (gicon instanceof Gio.FileIcon) {
            pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(gicon.get_file().get_path(), 32, 32);
        } else {
            const info = new St.IconTheme().lookup_by_gicon(gicon, 32, St.IconLookupFlags.FORCE_SIZE);
            pixbuf = info?.load_icon() ?? null;
        }
    } catch {
        return null; // missing or unreadable icon file
    }
    if (!pixbuf)
        return null;

    const pixels = pixbuf.get_pixels();
    const channels = pixbuf.get_n_channels();
    const stride = pixbuf.get_rowstride();
    const alpha = pixbuf.get_has_alpha();
    let r = 0, g = 0, b = 0, total = 0;
    for (let y = 0; y < pixbuf.get_height(); y++) {
        for (let x = 0; x < pixbuf.get_width(); x++) {
            const i = y * stride + x * channels;
            const a = alpha ? pixels[i + 3] / 255 : 1;
            if (a < 0.5)
                continue;
            const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
            const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
            const saturation = max ? (max - min) / max : 0;
            const weight = a * (0.02 + saturation * saturation);
            r += pixels[i] * weight;
            g += pixels[i + 1] * weight;
            b += pixels[i + 2] * weight;
            total += weight;
        }
    }
    if (!total)
        return null;
    // Brighten it so the glow reads on dark and light glass alike.
    const color = [r / total, g / total, b / total];
    const boost = 230 / Math.max(1, ...color);
    return color.map(c => Math.round(Math.min(255, c * boost)));
}
