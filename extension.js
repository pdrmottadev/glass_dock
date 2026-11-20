// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Glass Dock — a floating, translucent dock for GNOME Shell.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {DockManager} from './src/dockManager.js';

export default class GlassDockExtension extends Extension {
    enable() {
        this._manager = new DockManager(this);
    }

    disable() {
        this._manager?.destroy();
        this._manager = null;
    }
}
