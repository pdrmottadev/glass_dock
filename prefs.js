// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Preferences window for Glass Dock.
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {STYLES} from './src/styles.js';

/** Combo row bound to a string key with a fixed set of choices. */
function choiceRow(settings, key, title, choices, subtitle = '') {
    const model = new Gtk.StringList();
    choices.forEach(([, label]) => model.append(label));
    const row = new Adw.ComboRow({title, subtitle, model});

    const sync = () => {
        const idx = choices.findIndex(([value]) => value === settings.get_string(key));
        row.selected = Math.max(0, idx);
    };
    sync();
    row.connect('notify::selected', () => {
        const [value] = choices[row.selected];
        if (value !== settings.get_string(key))
            settings.set_string(key, value);
    });
    const id = settings.connect(`changed::${key}`, sync);
    row.connect('destroy', () => settings.disconnect(id));
    return row;
}

/**
 * Style picker. Picking a style also applies its recommended icon size and
 * zoom, which can be changed afterwards.
 */
function styleRow(settings) {
    const model = new Gtk.StringList();
    STYLES.forEach(style => model.append(_(style.name)));
    const row = new Adw.ComboRow({title: _('Style'), model});

    const sync = () => {
        const idx = Math.max(0, STYLES.findIndex(style => style.id === settings.get_string('dock-style')));
        row.selected = idx;
        row.subtitle = _(STYLES[idx].description);
    };
    sync();
    row.connect('notify::selected', () => {
        const style = STYLES[row.selected];
        if (style.id === settings.get_string('dock-style'))
            return;
        settings.delay();
        settings.set_string('dock-style', style.id);
        for (const [key, value] of Object.entries(style.preset)) {
            if (typeof value === 'boolean')
                settings.set_boolean(key, value);
            else
                settings.set_int(key, value);
        }
        settings.apply();
    });
    const id = settings.connect('changed::dock-style', sync);
    row.connect('destroy', () => settings.disconnect(id));
    return row;
}

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, lower, upper, step, digits = 0) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
        digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 4}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function scaleRow(settings, key, title, lower, upper, digits) {
    const row = new Adw.ActionRow({title});
    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: 0.01}),
        digits,
        draw_value: true,
        hexpand: true,
        width_request: 220,
        valign: Gtk.Align.CENTER,
    });
    settings.bind(key, scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(scale);
    return row;
}

/** Choices for the monitor row: primary + connected monitors (by connector). */
function monitorChoices(settings) {
    const choices = [['', _('Primary monitor')]];
    const monitors = Gdk.Display.get_default().get_monitors();
    for (let i = 0; i < monitors.get_n_items(); i++) {
        const monitor = monitors.get_item(i);
        const connector = monitor.get_connector();
        if (!connector)
            continue;
        const name = monitor.get_description() || monitor.get_model() || connector;
        choices.push([connector, `${name} (${connector})`]);
    }
    // Keep a saved monitor selectable while it is unplugged.
    const saved = settings.get_string('monitor-connector');
    if (saved && !choices.some(([value]) => value === saved))
        choices.push([saved, _('%s (disconnected)').format(saved)]);
    return choices;
}

/** Extra folders shown as stacks: a row per folder and an Add button. */
function stacksGroup(settings, window) {
    const group = new Adw.PreferencesGroup({
        title: _('Folder Stacks'),
        description: _('Any folder can sit next to Downloads and open as a fan or a grid.'),
    });
    const add = new Gtk.Button({
        label: _('Add Folder…'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    add.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({title: _('Choose a Folder'), modal: true});
        dialog.select_folder(window, null, (d, result) => {
            let folder;
            try {
                folder = d.select_folder_finish(result);
            } catch {
                return; // dismissed
            }
            const uris = settings.get_strv('extra-stacks');
            if (!uris.includes(folder.get_uri()))
                settings.set_strv('extra-stacks', [...uris, folder.get_uri()]);
        });
    });
    group.set_header_suffix(add);

    let rows = [];
    const sync = () => {
        rows.forEach(row => group.remove(row));
        rows = settings.get_strv('extra-stacks').map(uri => {
            const file = Gio.File.new_for_uri(uri);
            const row = new Adw.ActionRow({
                title: file.get_basename() ?? uri,
                subtitle: file.get_path() ?? uri,
            });
            const remove = new Gtk.Button({
                icon_name: 'list-remove-symbolic',
                tooltip_text: _('Remove'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            remove.connect('clicked', () => settings.set_strv('extra-stacks',
                settings.get_strv('extra-stacks').filter(u => u !== uri)));
            row.add_suffix(remove);
            group.add(row);
            return row;
        });
    };
    sync();
    const id = settings.connect('changed::extra-stacks', sync);
    group.connect('destroy', () => settings.disconnect(id));
    return group;
}

export default class GlassDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 720);

        // ---- Appearance ----
        const look = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'applications-graphics-symbolic',
        });

        const styleGroup = new Adw.PreferencesGroup({
            title: _('Style'),
            description: _('Every style keeps the glass look and changes the shape, indicators and effects. ' +
                'Picking one also sets its recommended icon size and zoom.'),
        });
        styleGroup.add(styleRow(settings));
        look.add(styleGroup);

        const layout = new Adw.PreferencesGroup({title: _('Position and Size')});
        layout.add(choiceRow(settings, 'position', _('Screen edge'), [
            ['bottom', _('Bottom')],
            ['left', _('Left')],
            ['right', _('Right')],
        ]));
        const monitorRow = choiceRow(settings, 'monitor-connector', _('Monitor'), monitorChoices(settings));
        layout.add(monitorRow);
        layout.add(switchRow(settings, 'multi-monitor', _('Dock on every monitor')));
        settings.bind('multi-monitor', monitorRow, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
        const isolateMonitors = switchRow(settings, 'isolate-monitors', _('Each dock shows its own windows'),
            _('Indicators, previews and open apps only count windows on that monitor'));
        settings.bind('multi-monitor', isolateMonitors, 'sensitive', Gio.SettingsBindFlags.GET);
        layout.add(isolateMonitors);
        layout.add(spinRow(settings, 'icon-size', _('Icon size'),
            _('In pixels; icons shrink automatically when they do not fit'), 32, 96, 2));
        look.add(layout);

        const mag = new Adw.PreferencesGroup({title: _('Magnification')});
        mag.add(switchRow(settings, 'magnification-enabled', _('Magnify icons on hover')));
        const magSize = spinRow(settings, 'magnification-size', _('Maximum size'), _('In pixels'), 32, 160, 2);
        settings.bind('magnification-enabled', magSize, 'sensitive', Gio.SettingsBindFlags.GET);
        mag.add(magSize);
        look.add(mag);

        const motion = new Adw.PreferencesGroup({
            title: _('Zoom Animation'),
            description: _('Changes apply right away: move the pointer over the dock to try them.'),
        });
        const motionKeys = [
            'magnification-in-time',
            'magnification-out-time',
            'magnification-follow-time',
            'magnification-spread',
            'magnification-elasticity',
        ];
        const resetButton = new Gtk.Button({
            label: _('Restore Defaults'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        resetButton.connect('clicked', () => motionKeys.forEach(key => settings.reset(key)));
        motion.set_header_suffix(resetButton);
        motion.add(spinRow(settings, 'magnification-in-time', _('Time to zoom in'),
            _('In milliseconds'), 50, 5000, 10));
        motion.add(spinRow(settings, 'magnification-out-time', _('Time to zoom out'),
            _('In milliseconds'), 50, 5000, 10));
        motion.add(spinRow(settings, 'magnification-follow-time', _('Pointer follow delay'),
            _('In milliseconds; 0 follows the pointer exactly'), 0, 3000, 10));
        motion.add(spinRow(settings, 'magnification-spread', _('Wave width'),
            _('How many icons to each side grow'), 1.5, 6, 0.5, 1));
        motion.add(spinRow(settings, 'magnification-elasticity', _('Elasticity'),
            _('0 stops smoothly; higher values overshoot a little'), 0, 100, 5));
        settings.bind('magnification-enabled', motion, 'sensitive', Gio.SettingsBindFlags.GET);
        look.add(motion);

        const glass = new Adw.PreferencesGroup({title: _('Glass')});
        glass.add(switchRow(settings, 'blur-enabled', _('Blur the background')));
        glass.add(scaleRow(settings, 'glass-opacity', _('Opacity'), 0, 1, 2));
        const liquid = switchRow(settings, 'liquid-glass', _('Liquid glass (experimental)'),
            _('Bends the background near the edges, with a light rim and a highlight under the pointer. ' +
              'Needs graphics acceleration.'));
        settings.bind('blur-enabled', liquid, 'sensitive', Gio.SettingsBindFlags.GET);
        glass.add(liquid);
        const strength = spinRow(settings, 'liquid-glass-strength', _('Liquid glass strength'),
            _('From 0 to 100'), 0, 100, 5);
        settings.bind('liquid-glass', strength, 'sensitive', Gio.SettingsBindFlags.GET);
        glass.add(strength);
        glass.add(switchRow(settings, 'show-running-indicators', _('Running indicators'),
            _('One dot per open window')));
        look.add(glass);

        window.add(look);

        // ---- Behavior ----
        const behavior = new Adw.PreferencesPage({
            title: _('Behavior'),
            icon_name: 'preferences-system-symbolic',
        });

        const hide = new Adw.PreferencesGroup({title: _('Auto-hide')});
        hide.add(choiceRow(settings, 'autohide-mode', _('Mode'), [
            ['never', _('Never hide')],
            ['autohide', _('Always hide (show at screen edge)')],
            ['intellihide', _('Hide when a window overlaps')],
        ]));
        const delay = spinRow(settings, 'autohide-delay', _('Hide delay'), _('In milliseconds'), 0, 3000, 50);
        hide.add(delay);
        const syncDelay = () => {
            delay.sensitive = settings.get_string('autohide-mode') !== 'never';
        };
        syncDelay();
        const delayId = settings.connect('changed::autohide-mode', syncDelay);
        delay.connect('destroy', () => settings.disconnect(delayId));
        behavior.add(hide);

        const focused = new Adw.PreferencesGroup({
            title: _('Clicking an Already Focused App'),
            description: _('Clicking an app in the background brings all of its windows to the front.'),
        });
        focused.add(choiceRow(settings, 'click-action', _('With one window'), [
            ['focus-or-minimize', _('Minimize')],
            ['focus', _('Do nothing')],
        ]));
        focused.add(choiceRow(settings, 'multi-window-action', _('With several windows'), [
            ['previews', _('Window previews')],
            ['expose', _('App Exposé')],
            ['cycle-windows', _('Cycle through windows')],
            ['minimize-all', _('Minimize all')],
        ]));
        behavior.add(focused);

        const hover = new Adw.PreferencesGroup({
            title: _('Resting the Pointer on an App'),
            description: _('A popup appears next to the icon; the rest of the desktop keeps working.'),
        });
        hover.add(switchRow(settings, 'hover-previews', _('Window previews'),
            _('Live thumbnails of the app\'s windows')));
        hover.add(switchRow(settings, 'media-controls', _('Mini player'),
            _('Cover, play/pause and track buttons for music and video players; scroll on it for volume')));
        hover.add(spinRow(settings, 'hover-delay', _('Delay'), _('In milliseconds'), 0, 2000, 50));
        behavior.add(hover);

        const workspaces = new Adw.PreferencesGroup({title: _('Workspaces')});
        workspaces.add(switchRow(settings, 'isolate-workspaces', _('Only windows on the current workspace'),
            _('Indicators, previews and open apps only count windows on the workspace you are on')));
        behavior.add(workspaces);

        const icons = new Adw.PreferencesGroup({title: _('Icons')});
        icons.add(switchRow(settings, 'bounce-on-launch', _('Bounce when launching an app')));
        icons.add(switchRow(settings, 'show-apps-button', _('Show Applications button')));
        icons.add(switchRow(settings, 'show-badges', _('Counters on icons'),
            _('Unread messages and other counts published by apps')));
        icons.add(switchRow(settings, 'show-progress', _('Progress on icons'),
            _('Downloads, updates and other progress published by apps')));
        behavior.add(icons);

        window.add(behavior);

        // ---- Right section ----
        const right = new Adw.PreferencesPage({
            title: _('Right Section'),
            icon_name: 'folder-symbolic',
        });

        const recents = new Adw.PreferencesGroup({title: _('Recent Apps')});
        recents.add(switchRow(settings, 'show-recent-apps', _('Show recently used apps')));
        const count = spinRow(settings, 'recent-apps-count', _('How many'), '', 1, 10, 1);
        settings.bind('show-recent-apps', count, 'sensitive', Gio.SettingsBindFlags.GET);
        recents.add(count);
        right.add(recents);

        const places = new Adw.PreferencesGroup({title: _('Folders')});
        places.add(switchRow(settings, 'show-downloads', _('Show Downloads stack')));
        places.add(choiceRow(settings, 'downloads-view', _('Show Downloads as'), [
            ['fan', _('Fan')],
            ['grid', _('Grid')],
        ]));
        places.add(switchRow(settings, 'stack-preview-icon', _('Newest file on the icon'),
            _('Shows the most recent file on top of the folder')));
        places.add(switchRow(settings, 'show-trash', _('Show Trash')));
        right.add(places);
        right.add(stacksGroup(settings, window));

        window.add(right);
    }
}
