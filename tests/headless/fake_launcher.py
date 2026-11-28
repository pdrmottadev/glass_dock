#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Publishes LauncherEntry updates like an app would, for the tests.

Usage: fake_launcher.py APP_ID
Reads one JSON object per line from stdin, e.g.
  {"count": 3, "count-visible": true, "progress": 0.4, "progress-visible": true}
and emits it as com.canonical.Unity.LauncherEntry.Update. Stays connected to
the session bus until stdin closes, like a running app.
"""
import json
import sys

from gi.repository import Gio, GLib

TYPES = {'count': 'x', 'count-visible': 'b', 'progress': 'd', 'progress-visible': 'b', 'urgent': 'b'}

bus = Gio.bus_get_sync(Gio.BusType.SESSION)
uri = f'application://{sys.argv[1]}'
print('ready', flush=True)
for line in sys.stdin:
    props = {key: GLib.Variant(TYPES[key], value) for key, value in json.loads(line).items()}
    bus.emit_signal(None, '/com/glassdock/test', 'com.canonical.Unity.LauncherEntry', 'Update',
                    GLib.Variant('(sa{sv})', (uri, props)))
    bus.flush_sync()
    print('sent', flush=True)
