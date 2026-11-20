# SPDX-License-Identifier: GPL-2.0-or-later
"""A plain X11 window with a given WM_CLASS, for the tests.

Usage: python3 fake_x11_app.py INSTANCE CLASS
Mimics apps such as the Spotify snap, whose WM_CLASS only matches their
.desktop file's StartupWMClass when compared without case.
"""
import sys

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk  # noqa: E402

instance, wm_class = sys.argv[1], sys.argv[2]
window = Gtk.Window(title='Fake Player')
window.set_default_size(500, 350)
window.set_wmclass(instance, wm_class)
window.connect('destroy', Gtk.main_quit)
window.show_all()
Gtk.main()
