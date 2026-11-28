// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Dock styles: every style keeps the glass look and changes how the dock
// behaves: its shape, where icons sit, how open windows show, the Apps button
// and the hover and click effects. Imported by the shell and by prefs, so it
// must not import anything from either.

/** Marks a string for translation; the caller translates it. */
const N_ = s => s;

const BASE = {
    // Bar glued to the screen edge across the whole monitor, or floating.
    panel: false,
    // 'center' or 'start' (from the left or top end).
    align: 'center',
    // Fractions of the icon size.
    padFactor: 0.15,
    spacingFactor: 0.12,
    // Fraction of the bar thickness (floating styles only).
    radiusFactor: 0.38,
    // 'dots', 'glow' (dots that glow), 'plate', 'bevel', 'line' or 'pill'.
    indicator: 'dots',
    // 'tile', 'square' (just the symbol), 'orb' or 'labeled'.
    appsButton: 'tile',
    appsAtEnd: false,
    // null, 'cell' (lights the item's cell), 'rounded' (rounded square
    // around the icon), 'tint' (glow in the icon's color that follows the
    // pointer) or 'halo' (accent-colored halo around the icon).
    hover: null,
    // Icons shrink a little while pressed and spring back.
    press: false,
    // No fades on hover and indicators.
    instant: false,
    // Glass shelf in perspective with icon reflections (bottom edge only).
    shelf: false,
    // Values the preferences apply when the style is picked.
    preset: {'icon-size': 52, 'magnification-enabled': true, 'hover-previews': false},
};

const PANEL_PRESET = {'icon-size': 32, 'magnification-enabled': false, 'hover-previews': true};

export const STYLES = [
    {
        id: 'glass',
        name: N_('Glass'),
        description: N_('Floating dock with zoom'),
    },
    {
        id: 'strip',
        name: N_('Strip'),
        description: N_('Inspired by Windows XP: full-width bar, labeled Apps button, open apps on raised plates'),
        panel: true,
        align: 'start',
        padFactor: 0.2,
        spacingFactor: 0.45,
        indicator: 'plate',
        appsButton: 'labeled',
        hover: 'cell',
        preset: PANEL_PRESET,
    },
    {
        id: 'orb',
        name: N_('Orb'),
        description: N_('Inspired by Windows Vista: round Apps button that rises above the bar, soft glow on hover'),
        panel: true,
        align: 'start',
        padFactor: 0.2,
        spacingFactor: 0.45,
        indicator: 'plate',
        appsButton: 'orb',
        hover: 'cell',
        preset: PANEL_PRESET,
    },
    {
        id: 'glow',
        name: N_('Glow'),
        description: N_('Inspired by Windows 7: large icons, hover glow in the color of the icon that follows the pointer'),
        panel: true,
        align: 'start',
        padFactor: 0.15,
        spacingFactor: 0.4,
        indicator: 'plate',
        appsButton: 'orb',
        hover: 'tint',
        preset: {'icon-size': 40, 'magnification-enabled': false, 'hover-previews': true},
    },
    {
        id: 'line',
        name: N_('Line'),
        description: N_('Inspired by Windows 10: flat full-width bar, a line under open apps'),
        panel: true,
        align: 'start',
        padFactor: 0.25,
        spacingFactor: 0.5,
        indicator: 'line',
        appsButton: 'square',
        hover: 'cell',
        preset: PANEL_PRESET,
    },
    {
        id: 'center',
        name: N_('Center'),
        description: N_('Inspired by Windows 11: centered icons, a pill that grows on the focused app, icons that press in'),
        panel: true,
        align: 'center',
        padFactor: 0.25,
        spacingFactor: 0.4,
        indicator: 'pill',
        appsButton: 'square',
        hover: 'rounded',
        press: true,
        preset: PANEL_PRESET,
    },
    {
        id: 'bevel',
        name: N_('Bevel'),
        description: N_('Inspired by Windows 95 and 98: raised buttons that sink when focused, no fades'),
        panel: true,
        align: 'start',
        padFactor: 0.2,
        spacingFactor: 0.45,
        indicator: 'bevel',
        appsButton: 'labeled',
        instant: true,
        preset: PANEL_PRESET,
    },
    {
        id: 'shelf',
        name: N_('Shelf'),
        description: N_('Inspired by Mac OS X Leopard: icons stand on a glass shelf, with reflections'),
        padFactor: 0.28,
        indicator: 'glow',
        shelf: true,
    },
    {
        id: 'neon',
        name: N_('Neon'),
        description: N_('Glowing edge and a halo in the accent color that pulses on the focused app'),
        indicator: 'glow',
        hover: 'halo',
    },
    {
        id: 'dash',
        name: N_('Dash'),
        description: N_('Inspired by the GNOME dash: no zoom, rounded highlight, Apps button at the end'),
        radiusFactor: 0.3,
        appsAtEnd: true,
        hover: 'rounded',
        preset: {'icon-size': 48, 'magnification-enabled': false, 'hover-previews': false},
    },
].map(style => Object.freeze({...BASE, ...style}));

/** The style with this id, or the default one. */
export function styleFor(id) {
    return STYLES.find(style => style.id === id) ?? STYLES[0];
}
