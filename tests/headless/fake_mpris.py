#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""A media player on the session bus (MPRIS), for the tests.

Usage: fake_mpris.py DESKTOP_ENTRY LOG_FILE
Claims org.mpris.MediaPlayer2.glasstest, says it belongs to DESKTOP_ENTRY,
plays "Test Song" by "Tester" and appends every call it gets to LOG_FILE
(PlayPause, Next, Previous, Volume=<value>). Runs until killed.
"""
import sys

from gi.repository import Gio, GLib

XML = """
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
  </interface>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
  </interface>
</node>
"""

entry, log_path = sys.argv[1], sys.argv[2]
state = {'status': 'Playing', 'volume': 0.5}
connection = None


def log(text):
    with open(log_path, 'a') as f:
        f.write(text + '\n')


def props(iface):
    if iface == 'org.mpris.MediaPlayer2':
        return {'Identity': GLib.Variant('s', 'Glass Test Player'),
                'DesktopEntry': GLib.Variant('s', entry),
                'CanRaise': GLib.Variant('b', False)}
    return {'PlaybackStatus': GLib.Variant('s', state['status']),
            'Metadata': GLib.Variant('a{sv}', {
                'xesam:title': GLib.Variant('s', 'Test Song'),
                'xesam:artist': GLib.Variant('as', ['Tester'])}),
            'CanPlay': GLib.Variant('b', True),
            'CanGoNext': GLib.Variant('b', True),
            'CanGoPrevious': GLib.Variant('b', True),
            'Volume': GLib.Variant('d', state['volume'])}


def changed(names):
    player = props('org.mpris.MediaPlayer2.Player')
    connection.emit_signal(None, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
                           'PropertiesChanged', GLib.Variant('(sa{sv}as)', (
                               'org.mpris.MediaPlayer2.Player', {n: player[n] for n in names}, [])))


def method_call(conn, sender, path, iface, method, params, invocation):
    log(method)
    if method == 'PlayPause':
        state['status'] = 'Paused' if state['status'] == 'Playing' else 'Playing'
        changed(['PlaybackStatus'])
    invocation.return_value(None)


def get_property(conn, sender, path, iface, name):
    return props(iface)[name]


def set_property(conn, sender, path, iface, name, value):
    if name == 'Volume':
        state['volume'] = value.unpack()
        log(f"Volume={state['volume']:.2f}")
        changed(['Volume'])
    return True


def on_bus(conn, name):
    global connection
    connection = conn
    info = Gio.DBusNodeInfo.new_for_xml(XML)
    for iface in info.interfaces:
        conn.register_object('/org/mpris/MediaPlayer2', iface, method_call, get_property, set_property)


Gio.bus_own_name(Gio.BusType.SESSION, 'org.mpris.MediaPlayer2.glasstest', Gio.BusNameOwnerFlags.NONE,
                 on_bus, lambda *a: log('ready'), lambda *a: sys.exit(1))
GLib.MainLoop().run()
