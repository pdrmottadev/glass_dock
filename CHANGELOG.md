# Changelog

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
