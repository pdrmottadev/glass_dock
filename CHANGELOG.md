# Changelog

## 1.0.4 — 2026-11-21

- README: the install example no longer names a specific version.

## 1.0.3 — 2026-11-21

- The zoom now moves like a spring: it keeps its speed when the pointer
  reverses, follows the pointer with a slight, soft lag, and settles without
  a hard stop. Icons move in sub-pixels and the wave is a little wider.
- All dock animations now work in remote desktop sessions: zoom, launch
  bounce, icons appearing, tooltips, auto-hide, Downloads, window previews and
  App Exposé. GNOME turns animations off there, so they jumped straight to
  the end whatever the settings said. They now follow the user's animation
  preference.
- New *Zoom Animation* preferences, applied right away: time to zoom in and
  out, pointer follow delay, wave width and elasticity, with a button to
  restore the defaults.
- Sharper dock: icons at rest are drawn at their exact size instead of being
  scaled down from the magnified version, which left jagged edges.
- Sharper Downloads fan: it keeps its arc, but entries are no longer tilted,
  which made text and thumbnails jagged.
- New zoom defaults: 90 px maximum size, 400 ms to zoom in and out, 200 ms
  pointer follow delay, wave width of 2.5 icons and elasticity of 5.

## 1.0.2 — 2026-11-21

- The magnification now stays in place while the Downloads stack or the
  window previews are open, and they open from the magnified icon. When they
  close, the zoom follows the pointer or collapses if it left the dock.
- The zoom now eases in and out when entering and leaving the dock, without
  the sudden start it had, and icons no longer wobble by a pixel or two while
  it animates. App Exposé also collapses the zoom smoothly instead of at once.
- The Downloads fan shows fewer items on short screens instead of running
  past the top of the screen.

## 1.0.1 — 2026-11-20

- Apps whose windows GNOME cannot match to their launcher (such as the
  Spotify snap, whose window class differs in case from the .desktop file)
  now show their real icon, get indicator dots on their pinned icon and
  respond to clicks, previews and App Exposé, instead of appearing as an
  extra generic icon. The dock matches the window class without case and,
  failing that, the systemd scope of the process (snap or GNOME launch).

## 1.0 — 2026-11-20

First public release. Supports GNOME Shell 50 and 51.

- Floating glass dock with blur, magnification, tooltips and launch bounce.
- One indicator dot per window.
- Window previews and App Exposé for apps with several windows.
- Clicking a background app raises all of its windows.
- Drag and drop to reorder, pin and unpin.
- Auto-hide, intellihide and fullscreen hiding.
- Recent apps, Downloads stack (fan or grid) and Trash.
- Icons shrink to fit the screen.
- Choice of screen edge and monitor.
- English, Brazilian Portuguese and Spanish.
- Notification when another dock extension is enabled.

Fixes found by the end-to-end tests before release:

- The Downloads grid view never opened (invalid `St.Viewport` property).
- Clicking a background app could focus a stale window after using App Exposé.
- The invisible struts actor covered overview drop targets at the bottom edge.
- A queued relayout could touch destroyed actors while GNOME Shell shut down.
- Icons still animating out could be destroyed twice when the dock was rebuilt.
