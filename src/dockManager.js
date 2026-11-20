// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Owns the dock's lifetime: creates it, rebuilds it on settings or monitor
// changes, and hides GNOME's own Dash in the overview while enabled.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AppsModel} from './appsModel.js';
import {Dock} from './dock.js';

const REBUILD_DELAY_MS = 150;

// Keys that don't need the dock to be rebuilt (handled live elsewhere).
const LIVE_KEYS = new Set([
    'recent-apps',
    'show-recent-apps',
    'recent-apps-count',
    'downloads-view',
    'click-action',
    'multi-window-action',
    'bounce-on-launch',
]);

// Other docks that would show up next to ours.
const CONFLICTING_DOCKS = [
    'dash-to-dock@micxgx.gmail.com',
    'ubuntu-dock@ubuntu.com',
    'dash-to-panel@jderose9.github.com',
];

export class DockManager {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._model = new AppsModel(this._settings);
        this._dock = null;
        this._rebuildId = 0;
        this._warnedConflicts = new Set();

        this._settings.connectObject('changed', (s, key) => {
            if (!LIVE_KEYS.has(key))
                this._queueRebuild();
        }, this);
        this._interfaceSettings.connectObject('changed::color-scheme', () => this._queueRebuild(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._queueRebuild(), this);
        Main.extensionManager.connectObject('extension-state-changed',
            () => this._checkConflicts(), this);

        this._hideOverviewDash();

        if (Main.layoutManager._startingUp)
            Main.layoutManager.connectObject('startup-complete', () => this._build(), this);
        else
            this._build();
    }

    get _dark() {
        return this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
    }

    _build() {
        this._dock?.destroy();
        this._dock = new Dock(this._settings, this._model, {dark: this._dark});
        this._syncOverviewDashSpace();
        this._checkConflicts();
    }

    /** Tells the user (once per extension) when another dock is enabled too. */
    _checkConflicts() {
        for (const uuid of CONFLICTING_DOCKS) {
            const extension = Main.extensionManager.lookup(uuid);
            if (extension?.state !== ExtensionState.ACTIVE || this._warnedConflicts.has(uuid))
                continue;
            this._warnedConflicts.add(uuid);
            Main.notify(_('Another dock is enabled'),
                _('%s is enabled too. Disable it to avoid two docks on screen.')
                    .format(extension.metadata.name));
        }
    }

    _queueRebuild() {
        if (this._rebuildId)
            GLib.source_remove(this._rebuildId);
        this._rebuildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REBUILD_DELAY_MS, () => {
            this._rebuildId = 0;
            this._build();
            return GLib.SOURCE_REMOVE;
        });
    }

    _hideOverviewDash() {
        this._dashWasVisible = Main.overview.dash.visible;
        Main.overview.dash.hide();
    }

    // With a bottom dock, keep the overview's dash slot empty so the dock
    // sits there; with a side dock, give that space back to the overview.
    _syncOverviewDashSpace() {
        const bottom = this._settings.get_string('position') === 'bottom';
        Main.overview.dash.set_height(bottom ? -1 : 0);
    }

    _restoreOverviewDash() {
        Main.overview.dash.set_height(-1);
        if (this._dashWasVisible)
            Main.overview.dash.show();
    }

    destroy() {
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }
        this._settings.disconnectObject(this);
        this._interfaceSettings.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        Main.extensionManager.disconnectObject(this);

        this._dock?.destroy();
        this._dock = null;
        this._model.destroy();
        this._model = null;

        this._restoreOverviewDash();
        this._settings = null;
        this._interfaceSettings = null;
        this._warnedConflicts.clear();
    }
}
