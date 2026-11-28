# Changelog

## 1.2.0 — 2026-11-28

- **Badges and progress.** Unread counts and progress bars published by apps
  (Telegram, Thunderbird, Firefox downloads, software updates and others,
  through the LauncherEntry API) show on their icons, in every style and at
  any zoom. Urgent apps bounce. Both can be turned off.
- **Folder stacks.** Any folder can sit next to Downloads and open as a fan or
  a grid (*Right Section → Folder Stacks*). A stack's icon shows its newest
  file, and downloads in progress show as "Downloading…" instead of an empty
  file plus a partial one.
- **Hover popup.** Resting the pointer on an app opens a popup next to its
  icon, without taking over the keyboard or the desktop:
  - **live window previews**: click one to focus it, × to close it (on by
    default in the full-width styles);
  - **mini player** for music and video players (MPRIS): cover, track,
    artist, previous, play/pause and next; scrolling on it changes the
    player's volume.
- **Several monitors.** A dock on every monitor, each showing the windows on
  its own monitor (optional). Optionally, show only the windows on the
  current workspace.
- **Liquid glass (experimental).** The glass bends what is behind it near the
  edges, with a light rim, a highlight under the pointer and blur with real
  rounded corners. Off by default; needs graphics acceleration.

## 1.1.0 — 2026-11-27

- New dock styles, picked in *Appearance → Style*. All of them keep the glass
  look and change how the dock behaves:
  - **Glass**: the floating dock with zoom (default, unchanged).
  - **Strip**: full-width bar with a labeled Apps button. Open apps sit on
    raised plates, and the focused one looks pressed.
  - **Orb**: full-width bar with a round Apps button that rises above it.
  - **Glow**: larger icons. On hover, a glow in the icon's own color follows
    the pointer.
  - **Line**: flat full-width bar. A line marks open apps and spans the whole
    cell on the focused one.
  - **Center**: centered icons. A pill under open apps grows on the focused
    one, and icons press in when clicked.
  - **Bevel**: raised buttons that sink when focused, with no fades.
  - **Shelf**: icons stand on a glass shelf in perspective, with reflections.
  - **Neon**: glowing edge and an accent-colored halo that pulses on the
    focused app.
  - **Dash**: no zoom, a rounded highlight and the Apps button at the end.
- Every style shows when an app has several windows: a dot per window (Glass,
  Shelf, Neon, Dash), a second plate behind (Strip, Orb, Glow), a short
  extra mark next to the line or pill (Line, Center) or a double border
  (Bevel). Clicking, previews and App Exposé work the same in all styles.
- Picking a style also applies its recommended icon size and zoom setting,
  which can be changed afterwards.
- Accent-colored details follow the accent color chosen in GNOME Settings.

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
