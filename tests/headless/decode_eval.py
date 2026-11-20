# SPDX-License-Identifier: GPL-2.0-or-later
"""Decodes `gdbus call ... org.gnome.Shell.Eval` output.

gdbus prints a GVariant tuple such as (true, '"text"'). The second member is
the JSON-encoded result of the evaluated JavaScript. Strings are printed
unquoted; other values as compact JSON. Exits with 1 when Eval failed.
"""
import ast
import json
import sys

raw = sys.argv[1].strip()
ok = raw.startswith('(true')
payload = ast.literal_eval(raw[raw.index(', ') + 2:-1])
if not ok:
    print(payload, file=sys.stderr)
    sys.exit(1)
try:
    value = json.loads(payload)
except json.JSONDecodeError:
    value = payload
if isinstance(value, str):
    print(value)
elif isinstance(value, bool):
    print('true' if value else 'false')
else:
    print(json.dumps(value, separators=(',', ':')))
