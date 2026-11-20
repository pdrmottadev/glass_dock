# Changelog

## 1.0 — 2026-11-20

First public release.

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

- The Downloads grid view never opened (invalid `St.Viewport` property on GNOME 51).
- Clicking a background app could focus a stale window after using App Exposé.
- The invisible struts actor covered overview drop targets at the bottom edge.
- A queued relayout could touch destroyed actors while GNOME Shell shut down.
