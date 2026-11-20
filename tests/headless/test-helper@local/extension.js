// SPDX-License-Identifier: GPL-2.0-or-later
// Test-only: unsafe mode lets the tests call org.gnome.Shell.Eval/Screenshot.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class TestHelper extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
