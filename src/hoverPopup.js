// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// The popup that appears when the pointer rests on an app: live thumbnails of
// its windows and, for media players, a mini player. Unlike the click popups
// it takes no grab, so the rest of the desktop keeps working while it shows.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {anchorFromRect, positionNextTo} from './overlay.js';
import {createPreviewCard, sortedWindows} from './windowPreviews.js';

const CLOSE_DELAY_MS = 250;
const FADE_TIME = 120;
const GAP = 8;
const THUMB_MAX_W = 200;
const THUMB_MAX_H = 125;
const COVER_SIZE = 56;
const VOLUME_STEP = 0.05;

function coverIcon(player, app) {
    const url = player.artUrl;
    if (/^(file|https?):\/\//.test(url))
        return Gio.FileIcon.new(Gio.File.new_for_uri(url));
    return app.get_icon() ?? Gio.ThemedIcon.new('audio-x-generic');
}

function mediaButton(iconName, accessibleName, onClick) {
    const button = new St.Button({
        style_class: 'glass-dock-media-button',
        accessible_name: accessibleName,
        child: new St.Icon({icon_name: iconName, icon_size: 16}),
    });
    button.connect('clicked', onClick);
    return button;
}

export class HoverPopup {
    /** @param {Dock} dock */
    constructor(dock) {
        this._dock = dock;
        this._item = null;
        this._panel = null;
        this._media = null;
        this._openId = 0;
        this._closeId = 0;
        dock.media.connectObject('changed', () => this._onMediaChanged(), this);
    }

    get isOpen() {
        return this._panel !== null;
    }

    get item() {
        return this._item;
    }

    _player(item) {
        if (!this._dock.settings.get_boolean('media-controls'))
            return null;
        return this._dock.media.playerFor(item.app.get_id());
    }

    _windows(item) {
        if (!this._dock.settings.get_boolean('hover-previews'))
            return [];
        return sortedWindows(item.windows());
    }

    _hasContent(item) {
        return !!item?.app && (this._windows(item).length > 0 || !!this._player(item));
    }

    /** Called by the dock whenever an item gains or loses the pointer. */
    onItemHover(item, hover) {
        const dock = this._dock;
        if (hover && item.app && !dock.dragging && !dock.menuOrOverlayOpen) {
            this._cancelClose();
            if (this.isOpen) {
                if (item !== this._item)
                    this._show(item);
                return;
            }
            this._cancelOpen();
            this._openId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
                dock.settings.get_int('hover-delay'), () => {
                    this._openId = 0;
                    if (item.hover && !dock.menuOrOverlayOpen)
                        this._show(item);
                    return GLib.SOURCE_REMOVE;
                });
        } else if (!hover) {
            if (item !== this._item)
                this._cancelOpen();
            if (this.isOpen && item === this._item)
                this._scheduleClose();
        }
    }

    _cancelOpen() {
        if (this._openId)
            GLib.source_remove(this._openId);
        this._openId = 0;
    }

    _cancelClose() {
        if (this._closeId)
            GLib.source_remove(this._closeId);
        this._closeId = 0;
    }

    _scheduleClose() {
        this._cancelClose();
        this._closeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLOSE_DELAY_MS, () => {
            this._closeId = 0;
            if (!this._panel?.hover && !this._item?.hover)
                this.close();
            return GLib.SOURCE_REMOVE;
        });
    }

    _show(item) {
        if (!this._hasContent(item)) {
            this.close();
            return;
        }
        if (this._item !== item) {
            this._item?.app.disconnectObject(this);
            this._item = item;
            item.app.connectObject('windows-changed', () => this._rebuild(), this);
        }
        if (!this._panel) {
            this._panel = new St.BoxLayout({
                style_class: 'glass-dock-preview-panel glass-dock-hover-popup',
                orientation: Clutter.Orientation.VERTICAL,
                reactive: true,
                track_hover: true,
            });
            this._panel.connect('notify::hover', panel => {
                if (panel.hover)
                    this._cancelClose();
                else
                    this._scheduleClose();
            });
            this._dock.addHoverPopupActor(this._panel);
            this._panel.opacity = 0;
            this._dock.ease(this._panel, {
                opacity: 255,
                duration: FADE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            this._dock.onHoverPopupOpened();
        }
        this._rebuild();
    }

    _rebuild() {
        const panel = this._panel;
        const item = this._item;
        if (!panel || !item)
            return;
        if (!this._hasContent(item)) {
            this.close();
            return;
        }
        panel.destroy_all_children();
        this._media = null;

        const player = this._player(item);
        if (player)
            panel.add_child(this._mediaSection(player, item.app));

        const windows = this._windows(item);
        if (windows.length) {
            const vertical = this._dock.geom.vertical;
            const row = new St.BoxLayout({
                style_class: 'glass-dock-hover-previews',
                orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL,
            });
            const monitor = this._dock.monitor;
            const maxW = vertical ? THUMB_MAX_W
                : Math.max(100, Math.min(THUMB_MAX_W, (monitor.width * 0.9) / windows.length - 30));
            const maxH = vertical
                ? Math.max(60, Math.min(THUMB_MAX_H, (monitor.height * 0.8) / windows.length - 60))
                : THUMB_MAX_H;
            for (const w of windows)
                row.add_child(createPreviewCard(w, item.app, maxW, maxH, () => this.close(true)));
            panel.add_child(row);
        }
        panel.set_size(-1, -1);
        this._measured = false;
        this.reposition();
    }

    _mediaSection(player, app) {
        const box = new St.BoxLayout({style_class: 'glass-dock-media', reactive: true});
        const cover = new St.Icon({style_class: 'glass-dock-media-cover', icon_size: COVER_SIZE});
        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const title = new St.Label({style_class: 'glass-dock-media-title'});
        const artist = new St.Label({style_class: 'glass-dock-media-artist'});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const controls = new St.BoxLayout({style_class: 'glass-dock-media-controls'});
        const previous = mediaButton('media-skip-backward-symbolic', _('Previous'), () => player.previous());
        const play = mediaButton('media-playback-start-symbolic', _('Play or Pause'), () => player.playPause());
        const next = mediaButton('media-skip-forward-symbolic', _('Next'), () => player.next());
        controls.add_child(previous);
        controls.add_child(play);
        controls.add_child(next);
        text.add_child(title);
        text.add_child(artist);
        text.add_child(controls);
        box.add_child(cover);
        box.add_child(text);

        // Scrolling over the player changes its volume; on the icon it
        // still cycles windows.
        box.connect('scroll-event', (actor, event) => {
            let delta = 0;
            switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP:
                delta = VOLUME_STEP;
                break;
            case Clutter.ScrollDirection.DOWN:
                delta = -VOLUME_STEP;
                break;
            case Clutter.ScrollDirection.SMOOTH: {
                const [, dy] = event.get_scroll_delta();
                delta = -dy * VOLUME_STEP;
                break;
            }
            }
            if (delta)
                player.changeVolume(delta);
            return Clutter.EVENT_STOP;
        });

        this._media = {player, app, cover, title, artist, previous, play, next};
        this._syncMedia();
        return box;
    }

    _syncMedia() {
        const {player, app, cover, title, artist, previous, play, next} = this._media;
        cover.gicon = coverIcon(player, app);
        title.text = player.title || player.identity || app.get_name();
        artist.text = player.artist;
        artist.visible = !!player.artist;
        play.child.icon_name = player.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        previous.reactive = player.canGoPrevious;
        next.reactive = player.canGoNext;
        previous.opacity = player.canGoPrevious ? 255 : 100;
        next.opacity = player.canGoNext ? 255 : 100;
    }

    _onMediaChanged() {
        if (!this._panel || !this._item)
            return;
        const player = this._player(this._item);
        if (player && this._media?.player === player)
            this._syncMedia();
        else
            this._rebuild();
    }

    /** Keeps the popup next to its icon; the dock calls this on every relayout. */
    reposition() {
        if (!this._panel)
            return;
        const rect = this._dock.iconRectFor(this._item);
        if (!rect) {
            this.close(true);
            return;
        }
        const anchor = anchorFromRect(rect);
        if (!this._measured) {
            positionNextTo(this._dock, this._panel, anchor, GAP);
            this._measured = true;
            this._size = [this._panel.width, this._panel.height];
            return;
        }
        // Same size as last time: only move it (measuring a sized actor
        // would just return that size).
        const [w, h] = this._size;
        const monitor = this._dock.monitor;
        let x, y;
        switch (this._dock.geom.position) {
        case 'left':
            [x, y] = [anchor.right + GAP, anchor.y - h / 2];
            break;
        case 'right':
            [x, y] = [anchor.left - GAP - w, anchor.y - h / 2];
            break;
        default:
            [x, y] = [anchor.x - w / 2, anchor.top - GAP - h];
        }
        x = Math.max(12, Math.min(x, monitor.width - w - 12));
        y = Math.max(12, Math.min(y, monitor.height - h - 12));
        this._panel.set_position(Math.round(x), Math.round(y));
    }

    /** @param {boolean} [immediate] skip the fade out */
    close(immediate = false) {
        this._cancelOpen();
        this._cancelClose();
        const panel = this._panel;
        if (!panel)
            return;
        this._panel = null;
        this._media = null;
        this._item?.app.disconnectObject(this);
        this._item = null;
        if (immediate) {
            panel.destroy();
        } else {
            panel.reactive = false;
            this._dock.ease(panel, {
                opacity: 0,
                duration: FADE_TIME,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => panel.destroy(),
            });
        }
        this._dock.onHoverPopupClosed();
    }

    destroy() {
        this._dock.media.disconnectObject(this);
        this._cancelOpen();
        this._cancelClose();
        this._item?.app.disconnectObject(this);
        this._item = null;
        this._panel?.destroy();
        this._panel = null;
    }
}
