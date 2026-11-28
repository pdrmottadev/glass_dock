// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Media players on the session bus (MPRIS), for the dock's mini player.
// GNOME Shell's own mpris.js has no way to tear it down and changes between
// versions, so the dock keeps this small client of its own.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

const PREFIX = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const ROOT_IFACE = 'org.mpris.MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

/** One player. Emits 'changed' when its track, state or abilities change. */
class Player extends Signals.EventEmitter {
    constructor(busName) {
        super();
        this.busName = busName;
        this.desktopEntry = '';
        this.identity = '';
        this._props = {};
        this._cancellable = new Gio.Cancellable();
        this._init().catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Glass Dock: media player ${busName}: ${e.message}`);
        });
    }

    async _init() {
        const bus = Gio.DBus.session;
        const getAll = async iface => {
            const reply = await bus.call(this.busName, PATH, 'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', [iface]), null, Gio.DBusCallFlags.NONE, -1, this._cancellable);
            return reply.deep_unpack()[0];
        };
        const root = await getAll(ROOT_IFACE);
        this.desktopEntry = root.DesktopEntry?.unpack() ?? '';
        this.identity = root.Identity?.unpack() ?? '';
        this._props = await getAll(PLAYER_IFACE);
        this._changedId = bus.signal_subscribe(this.busName, 'org.freedesktop.DBus.Properties',
            'PropertiesChanged', PATH, PLAYER_IFACE, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [, changed] = params.deep_unpack();
                Object.assign(this._props, changed);
                this.emit('changed');
            });
        this.ready = true;
        this.emit('changed');
    }

    _value(name, fallback) {
        return this._props[name]?.deepUnpack() ?? fallback;
    }

    get status() {
        return this._value('PlaybackStatus', 'Stopped');
    }

    get title() {
        const title = this._value('Metadata', {})['xesam:title']?.deepUnpack();
        return typeof title === 'string' ? title : '';
    }

    get artist() {
        const artists = this._value('Metadata', {})['xesam:artist']?.deepUnpack();
        return Array.isArray(artists) ? artists.filter(a => typeof a === 'string').join(', ') : '';
    }

    get artUrl() {
        const url = this._value('Metadata', {})['mpris:artUrl']?.deepUnpack();
        return typeof url === 'string' ? url : '';
    }

    get canGoNext() {
        return this._value('CanGoNext', false);
    }

    get canGoPrevious() {
        return this._value('CanGoPrevious', false);
    }

    get volume() {
        return this._value('Volume', null);
    }

    /** Whether this player belongs to an app (by its desktop file id). */
    matches(appId) {
        if (!this.desktopEntry)
            return false;
        const id = `${this.desktopEntry}.desktop`.toLowerCase();
        const target = appId.toLowerCase();
        // Snaps prefix the id with the snap name: spotify_spotify.desktop.
        return target === id || target.endsWith(`_${id}`);
    }

    _call(method) {
        Gio.DBus.session.call(this.busName, PATH, PLAYER_IFACE, method, null, null,
            Gio.DBusCallFlags.NONE, -1, null, null);
    }

    playPause() {
        this._call('PlayPause');
    }

    next() {
        this._call('Next');
    }

    previous() {
        this._call('Previous');
    }

    /** Changes the volume by `delta` (0..1 scale), if the player has one. */
    changeVolume(delta) {
        const volume = this.volume;
        if (volume === null)
            return;
        const value = Math.max(0, Math.min(1, volume + delta));
        Gio.DBus.session.call(this.busName, PATH, 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', [PLAYER_IFACE, 'Volume', new GLib.Variant('d', value)]),
            null, Gio.DBusCallFlags.NONE, -1, null, null);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._changedId)
            Gio.DBus.session.signal_unsubscribe(this._changedId);
    }
}

/** All players on the bus. Emits 'changed' when any of them changes. */
export class MediaPlayers extends Signals.EventEmitter {
    constructor() {
        super();
        this._players = new Map();
        this._cancellable = new Gio.Cancellable();
        const bus = Gio.DBus.session;
        this._ownerId = bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (conn, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deep_unpack();
                if (!name.startsWith(PREFIX))
                    return;
                if (oldOwner)
                    this._remove(name);
                if (newOwner)
                    this._add(name);
            });
        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, this._cancellable, (conn, result) => {
                try {
                    const [names] = conn.call_finish(result).deep_unpack();
                    names.filter(n => n.startsWith(PREFIX)).forEach(n => this._add(n));
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Glass Dock: cannot list media players: ${e.message}`);
                }
            });
    }

    _add(busName) {
        if (this._players.has(busName))
            return;
        const player = new Player(busName);
        player.connect('changed', () => this.emit('changed'));
        this._players.set(busName, player);
    }

    _remove(busName) {
        const player = this._players.get(busName);
        if (!player)
            return;
        this._players.delete(busName);
        player.destroy();
        this.emit('changed');
    }

    /** The player of an app, preferring one that is playing. */
    playerFor(appId) {
        const players = [...this._players.values()].filter(p => p.ready && p.matches(appId));
        return players.find(p => p.status === 'Playing') ?? players[0] ?? null;
    }

    destroy() {
        this._cancellable.cancel();
        Gio.DBus.session.signal_unsubscribe(this._ownerId);
        for (const player of this._players.values())
            player.destroy();
        this._players.clear();
    }
}
