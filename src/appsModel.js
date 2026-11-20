// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Keeps track of which apps the dock shows: pinned, running and recent.
import Shell from 'gi://Shell';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

export class AppsModel extends Signals.EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._appSystem = Shell.AppSystem.get_default();
        this._favorites = AppFavorites.getAppFavorites();

        // Running apps keep their launch order (new ones go to the end).
        this._runningOrder = this._appSystem.get_running().map(a => a.get_id());

        this._appSystem.connectObject(
            'app-state-changed', this._onAppStateChanged.bind(this),
            'installed-changed', () => this.emit('changed'),
            this);
        this._favorites.connectObject('changed', () => this.emit('changed'), this);
        this._settings.connectObject(
            'changed::show-recent-apps', () => this.emit('changed'),
            'changed::recent-apps-count', () => this.emit('changed'),
            this);
    }

    _onAppStateChanged(appSystem, app) {
        const id = app.get_id();
        const idx = this._runningOrder.indexOf(id);

        if (app.state === Shell.AppState.STOPPED) {
            if (idx !== -1)
                this._runningOrder.splice(idx, 1);
            this._pushRecent(app);
        } else if (idx === -1) {
            this._runningOrder.push(id);
        }
        this.emit('changed');
    }

    _pushRecent(app) {
        if (app.is_window_backed() || this._favorites.isFavorite(app.get_id()))
            return;
        const id = app.get_id();
        const list = this._settings.get_strv('recent-apps').filter(r => r !== id);
        list.unshift(id);
        this._settings.set_strv('recent-apps', list.slice(0, 10));
    }

    /** Pinned apps in favorites order. */
    getPinned() {
        return this._favorites.getFavorites();
    }

    isPinned(app) {
        return this._favorites.isFavorite(app.get_id());
    }

    /** Running apps that are not pinned, in launch order. */
    getRunningUnpinned() {
        const running = new Map(this._appSystem.get_running().map(a => [a.get_id(), a]));
        // Keep any running app we may have missed (e.g. state changed before init).
        for (const id of running.keys()) {
            if (!this._runningOrder.includes(id))
                this._runningOrder.push(id);
        }
        return this._runningOrder
            .map(id => running.get(id))
            .filter(app => app && !this._favorites.isFavorite(app.get_id()));
    }

    /** Recently closed apps, excluding pinned and running ones. */
    getRecent() {
        if (!this._settings.get_boolean('show-recent-apps'))
            return [];
        const count = this._settings.get_int('recent-apps-count');
        const result = [];
        for (const id of this._settings.get_strv('recent-apps')) {
            if (result.length >= count)
                break;
            const app = this._appSystem.lookup_app(id);
            if (!app || app.state !== Shell.AppState.STOPPED || this._favorites.isFavorite(id))
                continue;
            result.push(app);
        }
        return result;
    }

    removeRecent(app) {
        const id = app.get_id();
        this._settings.set_strv('recent-apps',
            this._settings.get_strv('recent-apps').filter(r => r !== id));
        this.emit('changed');
    }

    destroy() {
        this._appSystem.disconnectObject(this);
        this._favorites.disconnectObject(this);
        this._settings.disconnectObject(this);
    }
}
