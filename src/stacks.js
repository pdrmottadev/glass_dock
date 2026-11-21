// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Downloads stack: a dock item that pops up the most recent files as a
// fan (arc going up from the dock) or a grid panel.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {DockItem, menuSideFor} from './dockItem.js';
import {ModalLayer} from './overlay.js';
import {isCancelled, launchUri} from './utils.js';

const FILE_ATTRS = [
    'standard::name',
    'standard::display-name',
    'standard::content-type',
    'standard::icon',
    'standard::is-hidden',
    'standard::is-backup',
    'time::modified',
    'thumbnail::path',
    'thumbnail::is-valid',
].join(',');

const FAN_MAX_ITEMS = 10;
const FAN_TOP_MARGIN = 48; // keeps the fan clear of the top panel
const GRID_MAX_ITEMS = 40;
const GRID_COLUMNS = 5;

function fileIcon(info) {
    const thumb = info.get_attribute_byte_string('thumbnail::path');
    if (thumb && info.get_attribute_boolean('thumbnail::is-valid'))
        return Gio.FileIcon.new(Gio.File.new_for_path(thumb));
    return info.get_icon() ?? Gio.ThemedIcon.new('text-x-generic');
}

function downloadsDir() {
    const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD) ??
        GLib.build_filenamev([GLib.get_home_dir(), 'Downloads']);
    return Gio.File.new_for_path(path);
}

/** The Downloads stack contents, shown inside a ModalLayer. */
class StackPopup {
    constructor(item, dir, files, mode) {
        this._item = item;
        this._dock = item._dock;
        this._dir = dir;
        this._files = files;
        this._mode = this._dock.geom.position === 'bottom' ? mode : 'grid';
        this._entries = [];

        this._modal = new ModalLayer(this._dock, {
            onClose: () => this._animateOut(),
        });
        this._layer = this._modal.actor;
        this._anchor = this._modal.anchorFor(item);

        if (this._mode === 'fan')
            this._buildFan();
        else
            this._buildGrid();
    }

    get closed() {
        return this._modal.closed;
    }

    _openFile(info) {
        this.close();
        launchUri(this._dir.get_child(info.get_name()).get_uri());
    }

    _openFolder() {
        this.close();
        launchUri(this._dir.get_uri());
    }

    // ---- Fan -------------------------------------------------------------

    _fanEntry(labelText, gicon, onClick, iconSize) {
        const button = new St.Button({style_class: 'glass-dock-fan-entry', reactive: true});
        const box = new St.BoxLayout({style_class: 'glass-dock-fan-box'});
        const label = new St.Label({
            style_class: 'glass-dock-fan-label',
            text: labelText,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        const icon = new St.Icon({gicon, icon_size: iconSize, style_class: 'glass-dock-fan-icon'});
        box.add_child(label);
        box.add_child(icon);
        button.set_child(box);
        button.connect('clicked', onClick);
        return [button, iconSize];
    }

    _buildFan() {
        const iconSize = 48;
        const step = iconSize + 10;
        // The fan starts above the (possibly magnified) icon: fit it on screen.
        const room = Math.floor((this._anchor.top - 12 - FAN_TOP_MARGIN) / step) - 1;
        const files = this._files.slice(0, Math.max(1, Math.min(FAN_MAX_ITEMS, room)));
        const entries = files.map(info =>
            this._fanEntry(info.get_display_name(), fileIcon(info), () => this._openFile(info), iconSize));
        entries.push(this._fanEntry(_('Open in Files'),
            Gio.ThemedIcon.new('folder-open'), () => this._openFolder(), 32));

        entries.forEach(([actor, size], i) => {
            this._layer.add_child(actor);
            const [, natW] = actor.get_preferred_width(-1);
            const [, natH] = actor.get_preferred_height(natW);
            // Arc: bends to the right and tilts as it goes up.
            const bend = i * i * 1.3;
            const iconCenterX = this._anchor.x + bend;
            const y = this._anchor.top - 12 - (i + 1) * step + (step - natH) / 2;
            const x = iconCenterX + size / 2 + 6 - natW; // icon column aligned
            actor.set_position(Math.round(x), Math.round(y));
            actor.set_pivot_point(1 - (size / 2 + 6) / natW, 0.5);
            const angle = -i * 1.2;

            actor.opacity = 0;
            actor.translation_y = this._anchor.y - y;
            actor.set_scale(0.4, 0.4);
            actor.rotation_angle_z = 0;
            actor.ease({
                opacity: 255,
                translation_y: 0,
                scale_x: 1,
                scale_y: 1,
                rotation_angle_z: angle,
                delay: i * 14,
                duration: 260,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
            this._entries.push(actor);
        });
    }

    // ---- Grid ------------------------------------------------------------

    _buildGrid() {
        const panel = new St.BoxLayout({
            style_class: 'glass-dock-stack-panel',
            orientation: Clutter.Orientation.VERTICAL,
        });

        const header = new St.Label({style_class: 'glass-dock-stack-title', text: this._dir.get_basename()});
        panel.add_child(header);

        const grid = new Clutter.GridLayout({
            column_homogeneous: true,
            column_spacing: 6,
            row_spacing: 6,
        });
        const gridActor = new St.Widget({layout_manager: grid});
        const files = this._files.slice(0, GRID_MAX_ITEMS);
        if (files.length === 0) 
            panel.add_child(new St.Label({style_class: 'glass-dock-stack-empty', text: _('No files')}));
        
        files.forEach((info, i) => {
            const cell = new St.Button({style_class: 'glass-dock-grid-cell', reactive: true});
            const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
            box.add_child(new St.Icon({gicon: fileIcon(info), icon_size: 56, x_align: Clutter.ActorAlign.CENTER}));
            const label = new St.Label({style_class: 'glass-dock-grid-label', text: info.get_display_name()});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            box.add_child(label);
            cell.set_child(box);
            cell.connect('clicked', () => this._openFile(info));
            grid.attach(cell, i % GRID_COLUMNS, Math.floor(i / GRID_COLUMNS), 1, 1);
        });

        const scroll = new St.ScrollView({
            style_class: 'glass-dock-stack-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        const viewport = new St.Viewport({layout_manager: new Clutter.BinLayout()});
        viewport.add_child(gridActor);
        scroll.set_child(viewport);
        if (files.length)
            panel.add_child(scroll);

        const footer = new St.Button({style_class: 'glass-dock-stack-footer', label: _('Open in Files')});
        footer.connect('clicked', () => this._openFolder());
        panel.add_child(footer);

        this._layer.add_child(panel);
        this._modal.positionPanel(panel, this._anchor);

        panel.opacity = 0;
        panel.set_pivot_point(0.5, 1);
        panel.set_scale(0.9, 0.9);
        panel.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._entries.push(panel);
    }

    _animateOut() {
        this._item.onPopupClosed(this);
        for (const actor of this._entries) {
            actor.ease({
                opacity: 0,
                scale_x: 0.6,
                scale_y: 0.6,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
            });
        }
        return 150;
    }

    close() {
        this._modal.close();
    }

    destroyNow() {
        this._modal.destroyNow();
    }
}

export const DownloadsStack = GObject.registerClass(
class DownloadsStack extends DockItem {
    _init(dock) {
        this._dir = downloadsDir(); // before super._init(): labelText needs it
        super._init(dock);
        this.itemKey = 'downloads';
        this._popup = null;
        this._cancellable = null;
        this.setRunning(false);
    }

    createIconActor(size) {
        return new St.Icon({icon_name: 'folder-download', icon_size: size, style_class: 'glass-dock-icon'});
    }

    get labelText() {
        return this._dir.get_basename();
    }

    createMenu() {
        const menu = new PopupMenu.PopupMenu(this, 0.5, menuSideFor(this._dock.geom.position));
        menu.addAction(_('Open Folder'), () => launchUri(this._dir.get_uri()));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('View as')));
        const fan = menu.addAction(_('Fan'), () => this._dock.settings.set_string('downloads-view', 'fan'));
        const grid = menu.addAction(_('Grid'), () => this._dock.settings.set_string('downloads-view', 'grid'));
        const sync = () => {
            const view = this._dock.settings.get_string('downloads-view');
            fan.setOrnament(view === 'fan' ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            grid.setOrnament(view === 'grid' ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        };
        sync();
        menu.connect('open-state-changed', (m, open) => open && sync());
        return menu;
    }

    vfunc_clicked() {
        this._dock.hideTooltip();
        if (this._popup && !this._popup.closed) {
            this._popup.close();
            return;
        }
        this._openPopup().catch(logError);
    }

    async _openPopup() {
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        const files = await this._listFiles(cancellable);
        if (cancellable.is_cancelled() || this._destroyed || (this._popup && !this._popup.closed))
            return;
        this._dock.prepareOverlay({keepMagnification: true});
        this._popup = new StackPopup(this, this._dir, files,
            this._dock.settings.get_string('downloads-view'));
    }

    async _listFiles(cancellable) {
        const infos = [];
        let enumerator;
        try {
            enumerator = await this._dir.enumerate_children_async(FILE_ATTRS,
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable);
            for (;;) {
                const batch = await enumerator.next_files_async(100, GLib.PRIORITY_DEFAULT, cancellable);
                if (batch.length === 0)
                    break;
                infos.push(...batch);
            }
            await enumerator.close_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            if (!isCancelled(e))
                console.warn(`Glass Dock: cannot list ${this._dir.get_path()}: ${e.message}`);
            return [];
        }

        const mtime = info => info.get_modification_date_time()?.to_unix() ?? 0;
        return infos
            .filter(i => !i.get_is_hidden() && !i.get_is_backup())
            .sort((a, b) => mtime(b) - mtime(a));
    }

    onPopupClosed(popup) {
        if (this._popup === popup)
            this._popup = null;
    }

    _onDestroy() {
        this._cancellable?.cancel();
        this._popup?.destroyNow();
        this._popup = null;
        super._onDestroy();
    }
});
