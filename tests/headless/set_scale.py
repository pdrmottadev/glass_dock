# SPDX-License-Identifier: GPL-2.0-or-later
"""Sets the scale of the first monitor of the (test) session via Mutter's
DisplayConfig D-Bus API. Usage: python3 set_scale.py 2.0
Exits 2 when the requested scale is not supported.
"""
import sys

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib  # noqa: E402

scale = float(sys.argv[1])
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def call(method, args, reply):
    return bus.call_sync('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
                         'org.gnome.Mutter.DisplayConfig', method, args,
                         GLib.VariantType(reply) if reply else None,
                         Gio.DBusCallFlags.NONE, -1, None)


state = call('GetCurrentState', None,
             '(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})').unpack()
serial, monitors = state[0], state[1]
(connector, _vendor, _product, _serial), modes, _props = monitors[0]
current = next(m for m in modes if m[6].get('is-current'))
if not any(abs(s - scale) < 1e-3 for s in current[5]):
    print(f'scale {scale} not supported: {current[5]}')
    sys.exit(2)

logical = [(0, 0, scale, 0, True, [(connector, current[0], {})])]
call('ApplyMonitorsConfig',
     GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', (serial, 1, logical, {})), None)
print(f'{connector} scale set to {scale}')
