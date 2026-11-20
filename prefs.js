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

function switchRow(settings, key, title, subtitle = '') {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, lower, upper, step) {
    const row = new Adw.SpinRow({
        title,
        subtitle,
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

export default class GlassDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 720);

        // ---- Appearance ----
        const look = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'applications-graphics-symbolic',
        });

        const layout = new Adw.PreferencesGroup({title: _('Position and Size')});
        layout.add(choiceRow(settings, 'position', _('Screen edge'), [
            ['bottom', _('Bottom')],
            ['left', _('Left')],
            ['right', _('Right')],
        ]));
        layout.add(choiceRow(settings, 'monitor-connector', _('Monitor'), monitorChoices(settings)));
        layout.add(spinRow(settings, 'icon-size', _('Icon size'),
            _('In pixels; icons shrink automatically when they do not fit'), 32, 96, 2));
        look.add(layout);

        const mag = new Adw.PreferencesGroup({title: _('Magnification')});
        mag.add(switchRow(settings, 'magnification-enabled', _('Magnify icons on hover')));
        const magSize = spinRow(settings, 'magnification-size', _('Maximum size'), _('In pixels'), 32, 160, 2);
        settings.bind('magnification-enabled', magSize, 'sensitive', Gio.SettingsBindFlags.GET);
        mag.add(magSize);
        look.add(mag);

        const glass = new Adw.PreferencesGroup({title: _('Glass')});
        glass.add(switchRow(settings, 'blur-enabled', _('Blur the background')));
        glass.add(scaleRow(settings, 'glass-opacity', _('Opacity'), 0, 1, 2));
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

        const icons = new Adw.PreferencesGroup({title: _('Icons')});
        icons.add(switchRow(settings, 'bounce-on-launch', _('Bounce when launching an app')));
        icons.add(switchRow(settings, 'show-apps-button', _('Show Applications button')));
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
        places.add(switchRow(settings, 'show-trash', _('Show Trash')));
        right.add(places);

        window.add(right);
    }
}
