// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Keeps track of which apps the dock shows: pinned, running and recent.
//
// GNOME sometimes cannot match a window to its .desktop file and represents
// it as a separate "window-backed" app with a generic icon (e.g. the Spotify
// snap: its WM_CLASS instance is not exposed and the class differs in case
// from StartupWMClass). For those windows the model finds the real app itself
// and treats the window as belonging to it ("aliases").
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import {getInterestingWindows} from './utils.js';

const UUID_RE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// snap.<snap>.<app>-<uuid>.scope, created by snapd for every snap app.
const SNAP_SCOPE = new RegExp(`/snap\\.([^./]+)\\.([^/]+)-${UUID_RE}\\.scope`);
// app-<launcher>-<escaped desktop id>-<pid>.scope, created by GNOME when it launches an app.
const APP_SCOPE = /\/app-[^-/]+-([^/]+)-\d+\.scope/;

function unescapeSystemd(name) {
    return name.replace(/\\x([0-9a-f]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Desktop ids suggested by the systemd scope a process runs in. */
function desktopIdsFromCgroup(pid) {
    if (!(pid > 0))
        return [];
    let contents;
    try {
        [, contents] = GLib.file_get_contents(`/proc/${pid}/cgroup`);
    } catch {
        return []; // the process is gone or not ours
    }
    const text = new TextDecoder().decode(contents);
    const ids = [];
    const snap = text.match(SNAP_SCOPE);
    if (snap)
        ids.push(`${snap[1]}_${snap[2]}.desktop`);
    const app = text.match(APP_SCOPE);
    if (app)
        ids.push(`${unescapeSystemd(app[1])}.desktop`);
    return ids;
}

export class AppsModel extends Signals.EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._appSystem = Shell.AppSystem.get_default();
        this._favorites = AppFavorites.getAppFavorites();
        this._aliases = new Map(); // window-backed app -> real app
        this._pidCache = new Map(); // pid -> real app id ('' when unknown)

        // Running apps keep their launch order (new ones go to the end).
        this._runningOrder = this._appSystem.get_running().map(a => a.get_id());
        this._updateAliases();

        this._appSystem.connectObject(
            'app-state-changed', this._onAppStateChanged.bind(this),
            'installed-changed', () => {
                this._pidCache.clear();
                this._updateAliases();
                this.emit('changed');
            },
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
        this._updateAliases();
        this.emit('changed');
    }

    // ---- Window-backed apps ---------------------------------------------

    /** Finds the installed app a window-backed app really belongs to. */
    _resolve(windowApp) {
        const [window] = windowApp.get_windows();
        if (!window)
            return null;

        // Same lookups GNOME does, but ignoring case.
        for (const name of [window.get_wm_class_instance(), window.get_wm_class()]) {
            if (!name)
                continue;
            const lower = name.toLowerCase();
            const app = this._appSystem.lookup_startup_wmclass(lower) ??
                this._appSystem.lookup_desktop_wmclass(lower);
            if (app)
                return app;
        }

        const pid = window.get_pid();
        if (!this._pidCache.has(pid)) {
            const app = desktopIdsFromCgroup(pid)
                .map(id => this._appSystem.lookup_app(id))
                .find(Boolean);
            this._pidCache.set(pid, app?.get_id() ?? '');
        }
        const id = this._pidCache.get(pid);
        return id ? this._appSystem.lookup_app(id) : null;
    }

    _updateAliases() {
        this._aliases.clear();
        const running = this._appSystem.get_running();
        for (const app of running) {
            if (!app.is_window_backed())
                continue;
            const real = this._resolve(app);
            if (real && !real.is_window_backed())
                this._aliases.set(app, real);
        }
        // Forget processes that are gone.
        const pids = new Set(running.flatMap(app => app.get_windows().map(w => w.get_pid())));
        for (const pid of this._pidCache.keys()) {
            if (!pids.has(pid))
                this._pidCache.delete(pid);
        }
    }

    /** The app the dock shows for `app` (resolves window-backed apps). */
    resolve(app) {
        return this._aliases.get(app) ?? app;
    }

    /** Windows shown for an app, including windows GNOME did not match to it. */
    windowsFor(app) {
        const windows = getInterestingWindows(app);
        for (const [windowApp, real] of this._aliases) {
            if (real === app)
                windows.push(...getInterestingWindows(windowApp));
        }
        return windows;
    }

    /** Apps whose windows count as this app's (the app itself + aliases). */
    appsFor(app) {
        return [app, ...[...this._aliases].filter(([, real]) => real === app).map(([w]) => w)];
    }

    isRunning(app) {
        return app.state !== Shell.AppState.STOPPED ||
            [...this._aliases.values()].includes(app);
    }

    isFocused(app) {
        const focusApp = Shell.WindowTracker.get_default().focus_app;
        return focusApp !== null && this.resolve(focusApp) === app;
    }

    // ---- Lists -------------------------------------------------------------

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
        const result = [];
        for (const id of this._runningOrder) {
            const app = running.get(id);
            if (!app)
                continue;
            const shown = this.resolve(app);
            if (!this._favorites.isFavorite(shown.get_id()) && !result.includes(shown))
                result.push(shown);
        }
        return result;
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
            if (!app || this.isRunning(app) || this._favorites.isFavorite(id))
                continue;
            result.push(app);
        }
        return result;
    }

    destroy() {
        this._appSystem.disconnectObject(this);
        this._favorites.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._aliases.clear();
        this._pidCache.clear();
    }
}
