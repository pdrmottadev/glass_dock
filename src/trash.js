// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Trash item: shows empty/full state, opens the trash and can empty it.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {DockItem, menuSideFor} from './dockItem.js';
import {isCancelled, launchUri} from './utils.js';

const TRASH_URI = 'trash:///';
const UPDATE_DELAY_MS = 300;

export const TrashItem = GObject.registerClass(
class TrashItem extends DockItem {
    _init(dock) {
        super._init(dock);
        this.itemKey = 'trash';
        this._count = 0;
        this._updateId = 0;
        this._emptyItem = null;
        this._cancellable = new Gio.Cancellable();
        this._trash = Gio.File.new_for_uri(TRASH_URI);

        // Without GVfs there is no trash:// backend to watch.
        try {
            this._monitor = this._trash.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => this._queueUpdate());
        } catch (e) {
            console.warn(`Glass Dock: cannot monitor the trash: ${e.message}`);
            this._monitor = null;
        }
        this._update().catch(logError);
    }

    createIconActor(size) {
        return new St.Icon({icon_name: 'user-trash', icon_size: size, style_class: 'glass-dock-icon'});
    }

    get labelText() {
        return _('Trash');
    }

    _queueUpdate() {
        if (this._updateId)
            return;
        this._updateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_DELAY_MS, () => {
            this._updateId = 0;
            this._update().catch(logError);
            return GLib.SOURCE_REMOVE;
        });
    }

    async _update() {
        let info;
        try {
            info = await this._trash.query_info_async('trash::item-count',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this._cancellable);
        } catch (e) {
            if (!isCancelled(e))
                console.warn(`Glass Dock: cannot read the trash: ${e.message}`);
            return;
        }
        this._count = info.get_attribute_uint32('trash::item-count');
        this._iconActor.icon_name = this._count > 0 ? 'user-trash-full' : 'user-trash';
        this._emptyItem?.setSensitive(this._count > 0);
    }

    /** Asks Files to empty the trash (it shows its own confirmation). */
    _empty() {
        Gio.DBus.session.call(
            'org.gnome.Nautilus',
            '/org/gnome/Nautilus/FileOperations2',
            'org.gnome.Nautilus.FileOperations2',
            'EmptyTrash',
            new GLib.Variant('(ba{sv})', [true, {}]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, result) => {
                try {
                    connection.call_finish(result);
                } catch {
                    // Files is not installed: confirm and empty it ourselves.
                    this._confirmEmpty();
                }
            });
    }

    _confirmEmpty() {
        const dialog = new ModalDialog.ModalDialog();
        dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
            title: _('Empty all items from Trash?'),
            description: _('All items in the Trash will be permanently deleted.'),
        }));
        dialog.addButton({
            label: _('Cancel'),
            action: () => dialog.close(),
            key: Clutter.KEY_Escape,
        });
        dialog.addButton({
            label: _('Empty Trash'),
            action: () => {
                dialog.close();
                this._deleteAll().catch(e => {
                    if (!isCancelled(e))
                        Main.notifyError(_('Could not empty the Trash'), e.message);
                });
            },
        });
        dialog.open();
    }

    async _deleteAll() {
        const enumerator = await this._trash.enumerate_children_async('standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, this._cancellable);
        for (;;) {
            const infos = await enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, this._cancellable);
            if (infos.length === 0)
                break;
            await Promise.all(infos.map(info => this._trash.get_child(info.get_name())
                .delete_async(GLib.PRIORITY_DEFAULT, this._cancellable)));
        }
        await enumerator.close_async(GLib.PRIORITY_DEFAULT, null);
    }

    createMenu() {
        const menu = new PopupMenu.PopupMenu(this, 0.5, menuSideFor(this._dock.geom.position));
        menu.addAction(_('Open'), () => launchUri(TRASH_URI));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._emptyItem = menu.addAction(_('Empty Trash…'), () => this._empty());
        this._emptyItem.setSensitive(this._count > 0);
        return menu;
    }

    vfunc_clicked() {
        this._dock.hideTooltip();
        launchUri(TRASH_URI);
    }

    _onDestroy() {
        this._cancellable.cancel();
        if (this._updateId) {
            GLib.source_remove(this._updateId);
            this._updateId = 0;
        }
        this._monitor?.cancel();
        this._monitor = null;
        this._emptyItem = null;
        super._onDestroy();
    }
});
