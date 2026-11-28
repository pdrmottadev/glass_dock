// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Badges and progress published by apps through the LauncherEntry D-Bus API
// (com.canonical.Unity.LauncherEntry), used by Telegram, Thunderbird,
// Firefox, apt and others.
import Gio from 'gi://Gio';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

const IFACE = 'com.canonical.Unity.LauncherEntry';

/** Desktop file id from an "application://x.desktop" URI. */
function appIdFromUri(uri) {
    const id = uri.replace(/^application:\/\//, '');
    return id.endsWith('.desktop') ? id : `${id}.desktop`;
}

/**
 * Collects the latest state each app published. Emits 'changed' with the
 * app id whenever an entry changes or goes away.
 */
export class LauncherEntries extends Signals.EventEmitter {
    constructor() {
        super();
        this._entries = new Map();
        const bus = Gio.DBus.session;
        this._updateId = bus.signal_subscribe(null, IFACE, 'Update', null, null,
            Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => this._onUpdate(sender, params));
        // An app that quits (or crashes) never clears its badge itself.
        this._ownerId = bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [, oldOwner, newOwner] = params.deep_unpack();
                if (oldOwner && !newOwner)
                    this._removeSender(oldOwner);
            });
    }

    /**
     * @param {string} appId desktop file id
     * @returns {{count: number, countVisible: boolean, progress: number,
     *            progressVisible: boolean, urgent: boolean}|null}
     */
    get(appId) {
        return this._entries.get(appId) ?? null;
    }

    _onUpdate(sender, params) {
        const [uri, props] = params.deep_unpack();
        const appId = appIdFromUri(uri);
        const entry = this._entries.get(appId) ?? {
            count: 0, countVisible: false, progress: 0, progressVisible: false, urgent: false,
        };
        entry.sender = sender;
        for (const [key, variant] of Object.entries(props)) {
            const value = variant.unpack();
            switch (key) {
            case 'count':
                entry.count = Number(value);
                break;
            case 'count-visible':
                entry.countVisible = Boolean(value);
                break;
            case 'progress':
                entry.progress = Math.max(0, Math.min(1, Number(value)));
                break;
            case 'progress-visible':
                entry.progressVisible = Boolean(value);
                break;
            case 'urgent':
                entry.urgent = Boolean(value);
                break;
            }
        }
        this._entries.set(appId, entry);
        this.emit('changed', appId);
    }

    _removeSender(sender) {
        for (const [appId, entry] of this._entries) {
            if (entry.sender !== sender)
                continue;
            this._entries.delete(appId);
            this.emit('changed', appId);
        }
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._updateId);
        Gio.DBus.session.signal_unsubscribe(this._ownerId);
        this._entries.clear();
    }
}
