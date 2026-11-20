// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// The dock itself: actors, layout, magnification, tooltips and DnD.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AutoHide} from './autohide.js';
import {DockAppIcon, DockAppsButton, DockSeparator} from './dockItem.js';
import {AppExpose} from './expose.js';
import {computeLayout} from './magnifier.js';
import {DownloadsStack} from './stacks.js';
import {TrashItem} from './trash.js';
import {EdgeGeometry, getAppFromSource} from './utils.js';
import {WindowPreviewsPopup} from './windowPreviews.js';

const EDGE_MARGIN = 8;
const MAGNIFY_IN_TIME = 140;
const MAGNIFY_OUT_TIME = 220;
const SLIDE_TIME = 240;
const TOOLTIP_GAP = 10;
const MIN_ICON_SIZE = 24;

/** Index of the monitor chosen in settings (by connector), or the primary one. */
function resolveMonitorIndex(connector) {
    const layout = Main.layoutManager;
    if (!connector)
        return layout.primaryIndex;
    const index = global.backend.get_monitor_manager().get_monitor_for_connector(connector);
    return index >= 0 && index < layout.monitors.length ? index : layout.primaryIndex;
}

export class Dock {
    constructor(settings, model, {dark}) {
        this.settings = settings;
        this._model = model;
        this._dark = dark;

        this.monitorIndex = resolveMonitorIndex(settings.get_string('monitor-connector'));
        this.monitor = Main.layoutManager.monitors[this.monitorIndex];
        this.geom = new EdgeGeometry(settings.get_string('position'));
        this.metrics = this._computeMetrics(settings.get_int('icon-size'));

        this.dragging = false;
        this._draggedItem = null;
        this._placeholderIndex = null;
        this._menuOpenCount = 0;
        this._menuPending = false;
        this._popupOpen = false;
        this._shown = true;
        this._pointer = null; // [x, y] stage coords
        this._relayoutId = 0;
        this._dropLaterId = 0;
        this._lastLayout = null;
        this._iconGeometryKey = '';
        this._tooltipItem = null;
        this._items = [];
        this._itemMap = new Map();

        this._buildActors();

        this._model.connectObject('changed', () => this._rebuildItems(true), this);
        global.display.connectObject(
            'window-demands-attention', (d, w) => this._onUrgent(w),
            'window-marked-urgent', (d, w) => this._onUrgent(w),
            this);

        this._dragMonitor = {dragMotion: this._onDragMotion.bind(this)};
        DND.addDragMonitor(this._dragMonitor);

        this._rebuildItems(false);
        this._autohide = new AutoHide(this);
        this._relayout();
    }

    // ---- Setup -----------------------------------------------------------

    /**
     * Sizes derived from an icon size. Icons are always rendered at magSize
     * (from settings) and scaled down, so magSize does not follow iconSize.
     */
    _computeMetrics(iconSize) {
        const configured = this.settings.get_int('icon-size');
        const magEnabled = this.settings.get_boolean('magnification-enabled');
        const magSize = magEnabled
            ? Math.max(configured, this.settings.get_int('magnification-size'))
            : configured;
        const pad = Math.round(Math.max(7, iconSize * 0.15));
        const spacing = Math.round(Math.max(4, iconSize * 0.12));
        const thickness = iconSize + 2 * pad;
        return {
            iconSize,
            magSize,
            magEnabled: magEnabled && magSize > iconSize,
            pad,
            spacing,
            endPad: Math.round(pad * 0.75),
            dotSize: Math.max(4, Math.round(iconSize / 12)),
            separatorSize: Math.round(Math.max(12, iconSize * 0.36)),
            thickness,
            zone: magEnabled ? magSize - iconSize : 0,
            radius: Math.round(thickness * 0.38),
            influence: (iconSize + spacing) * 2.6,
            margin: EDGE_MARGIN,
        };
    }

    _buildActors() {
        const mon = this.monitor;

        // Non-reactive holder anchored at the monitor origin; children use
        // monitor-local coordinates. It is only 1x1 px on purpose: DnD picks
        // with PickMode.ALL, so a monitor-sized actor would swallow every drop
        // target underneath it. trackFullscreen hides it in fullscreen.
        this._outer = new St.Widget({
            name: 'glassDockOuter',
            style_class: this._dark ? 'glass-dock-root glass-dock-dark' : 'glass-dock-root',
            reactive: false,
            x: mon.x,
            y: mon.y,
            width: 1,
            height: 1,
        });
        Main.layoutManager.addChrome(this._outer, {trackFullscreen: true});
        // The Shell may destroy its chrome on shutdown before disable() runs.
        this._outer.connect('destroy', () => {
            this._destroyed = true;
        });

        // The reactive dock (bar + magnification zone).
        this._actor = new St.Widget({
            name: 'glassDock',
            style_class: `glass-dock glass-dock-${this.geom.position}`,
            reactive: true,
            track_hover: true,
        });
        this._actor._delegate = this; // DnD drop target
        this._outer.add_child(this._actor);

        // Blurred backdrop, inset a bit so its square corners stay hidden
        // behind the rounded glass.
        this._blur = new St.Widget({style_class: 'glass-dock-blur'});
        if (this.settings.get_boolean('blur-enabled')) {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            this._blur.add_effect_with_name('blur', new Shell.BlurEffect({
                mode: Shell.BlurMode.BACKGROUND,
                radius: 28 * scale,
                brightness: this._dark ? 0.85 : 1.0,
            }));
        } else {
            this._blur.hide();
        }
        this._actor.add_child(this._blur);

        this._background = new St.Widget({
            style_class: 'glass-dock-background',
            style: this._glassStyle(),
        });
        this._actor.add_child(this._background);

        this._itemsLayer = new St.Widget();
        this._actor.add_child(this._itemsLayer);

        this._tooltip = new St.Label({style_class: 'glass-dock-tooltip', visible: false, opacity: 0});
        this._outer.add_child(this._tooltip);

        this._magAmount = new St.Adjustment({actor: this._actor, lower: 0, upper: 1, value: 0});
        this._magAmount.connect('notify::value', () => this.queueRelayout());

        this._actor.connect('motion-event', (actor, event) => {
            this._pointer = event.get_coords();
            if (this.metrics.magEnabled && !this.dragging)
                this.queueRelayout();
            return Clutter.EVENT_PROPAGATE;
        });
        this._actor.connect('notify::hover', () => this._onHoverChanged());

        // Reserve screen space when the dock never hides.
        if (this.settings.get_string('autohide-mode') === 'never') {
            this._struts = new St.Widget({reactive: false});
            Main.layoutManager.addChrome(this._struts, {affectsStruts: true, trackFullscreen: true});
            // DnD picks with PickMode.ALL, so keep this invisible actor below
            // the windows and the overview, where it can never cover a drop target.
            Main.layoutManager.uiGroup.set_child_below_sibling(this._struts, global.window_group);
            this._updateStruts();
        }
    }

    _updateStruts() {
        if (!this._struts)
            return;
        const mon = this.monitor;
        const depth = this.metrics.margin + this.metrics.thickness;
        let x = mon.x, y = mon.y, w = mon.width, h = mon.height;
        switch (this.geom.position) {
        case 'left':
            w = depth;
            break;
        case 'right':
            x = mon.x + mon.width - depth;
            w = depth;
            break;
        default:
            y = mon.y + mon.height - depth;
            h = depth;
        }
        this._struts.set_position(x, y);
        this._struts.set_size(w, h);
    }

    /**
     * Shrinks the icons when the configured size would not fit on the
     * monitor; grows them back when there is room again.
     */
    _fitMetrics() {
        const configured = this.settings.get_int('icon-size');
        const mon = this.monitor;
        const monMain = this.geom.vertical ? mon.height : mon.width;
        const items = this._items.filter(item => !item._vanishing);

        let metrics = this._computeMetrics(configured);
        for (let i = 0; i < 3; i++) {
            const needed = items.reduce((sum, item) => sum + item.getBaseMainSize(metrics), 0) +
                2 * metrics.endPad;
            const available = monMain - 2 * metrics.margin;
            if (needed <= available || metrics.iconSize <= MIN_ICON_SIZE)
                break;
            const iconSize = Math.max(MIN_ICON_SIZE, Math.floor(metrics.iconSize * available / needed));
            metrics = this._computeMetrics(iconSize);
        }

        if (metrics.iconSize === this.metrics.iconSize)
            return;
        this.metrics = metrics;
        this._background.style = this._glassStyle();
        this._updateStruts();
        this._iconGeometryKey = '';
    }

    _glassStyle() {
        const op = this.settings.get_double('glass-opacity');
        const r = this.metrics.radius;
        const clamp = v => Math.max(0, Math.min(1, v)).toFixed(3);
        const [cr, cg, cb] = this._dark ? [28, 28, 32] : [250, 250, 252];
        const top = clamp(op + 0.08);
        const bottom = clamp(op - 0.04);
        return `border-radius: ${r}px;` +
            'background-gradient-direction: vertical;' +
            `background-gradient-start: rgba(${cr},${cg},${cb},${top});` +
            `background-gradient-end: rgba(${cr},${cg},${cb},${bottom});`;
    }

    // ---- Items -----------------------------------------------------------

    _desiredItems() {
        const s = this.settings;
        const list = [];
        if (s.get_boolean('show-apps-button'))
            list.push({key: 'apps-button', create: () => new DockAppsButton(this)});

        for (const app of this._model.getPinned())
            list.push({key: `app:${app.get_id()}`, create: () => new DockAppIcon(this, app)});
        for (const app of this._model.getRunningUnpinned())
            list.push({key: `app:${app.get_id()}`, create: () => new DockAppIcon(this, app)});

        const recent = this._model.getRecent();
        if (recent.length) {
            list.push({key: 'sep:recent', create: () => new DockSeparator(this, 'sep:recent')});
            for (const app of recent)
                list.push({key: `recent:${app.get_id()}`, create: () => new DockAppIcon(this, app)});
        }

        const showDownloads = s.get_boolean('show-downloads');
        const showTrash = s.get_boolean('show-trash');
        if (showDownloads || showTrash) {
            list.push({key: 'sep:places', create: () => new DockSeparator(this, 'sep:places')});
            if (showDownloads)
                list.push({key: 'downloads', create: () => new DownloadsStack(this)});
            if (showTrash)
                list.push({key: 'trash', create: () => new TrashItem(this)});
        }
        return list;
    }

    _rebuildItems(animate) {
        const desired = this._desiredItems();
        const wanted = new Set(desired.map(d => d.key));

        for (const item of this._items) {
            if (item._vanishing || wanted.has(item.itemKey))
                continue;
            item._vanishing = true;
            this._itemMap.delete(item.itemKey);
            if (this._tooltipItem === item)
                this.hideTooltip();
            // Also runs when the animation is cut short because the dock
            // itself is being destroyed; the item is gone from the list then.
            const done = () => {
                const idx = this._items.indexOf(item);
                if (idx === -1)
                    return;
                this._items.splice(idx, 1);
                item.destroy();
                this.queueRelayout();
            };
            if (animate)
                item.vanish(done);
            else
                done();
        }

        const next = desired.map(d => {
            let item = this._itemMap.get(d.key);
            if (!item) {
                item = d.create();
                item.itemKey = d.key;
                this._itemMap.set(d.key, item);
                this._itemsLayer.add_child(item);
                item.appear(animate);
            }
            return item;
        });

        // Keep vanishing items roughly where they were while they shrink.
        this._items.forEach((item, idx) => {
            if (item._vanishing)
                next.splice(Math.min(idx, next.length), 0, item);
        });
        this._items = next;
        this._fitMetrics();
        this.queueRelayout();
    }

    // ---- Layout ----------------------------------------------------------

    queueRelayout() {
        if (this._relayoutId || this._destroyed)
            return;
        const laters = global.compositor.get_laters();
        this._relayoutId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._relayoutId = 0;
            this._relayout();
            return GLib.SOURCE_REMOVE;
        });
    }

    _relayout() {
        if (this._destroyed)
            return;
        const m = this.metrics;
        const geom = this.geom;
        const mon = this.monitor;
        const monMain = geom.vertical ? mon.height : mon.width;
        const monCross = geom.vertical ? mon.width : mon.height;
        const monMainOrigin = geom.vertical ? mon.y : mon.x;

        // Entries: items plus an optional DnD placeholder gap.
        const entries = this._items.map(item => ({
            item,
            base: item.getBaseMainSize(m) * item.presence.value,
            magnifiable: item.magnifiable && !item._vanishing,
        }));
        if (this._placeholderIndex !== null) {
            const idx = Math.max(0, Math.min(this._placeholderIndex, entries.length));
            entries.splice(idx, 0, {item: null, base: m.iconSize + m.spacing, magnifiable: false});
        }

        const baseLength = entries.reduce((a, e) => a + e.base, 0) + 2 * m.endPad;
        const baseStart = (monMain - baseLength) / 2;

        const amount = m.magEnabled ? this._magAmount.value : 0;
        let pointer = null;
        if (this._pointer && amount > 0)
            pointer = geom.mainOf(...this._pointer) - monMainOrigin - baseStart;

        const layout = computeLayout({
            baseSizes: entries.map(e => e.base),
            magnifiable: entries.map(e => e.magnifiable),
            iconSize: m.iconSize,
            padding: m.endPad,
            pointer,
            maxScale: m.magSize / m.iconSize,
            amount,
            radius: m.influence,
        });

        let start = baseStart + layout.anchorShift;
        start = Math.max(m.margin, Math.min(start, monMain - layout.length - m.margin));
        if (layout.length > monMain - 2 * m.margin)
            start = (monMain - layout.length) / 2;

        const zoneWanted = amount > 0 ||
            (this._actor.hover && !this.dragging && !this._menuPending &&
             this._menuOpenCount === 0 && !this._popupOpen);
        const zone = zoneWanted ? m.zone : 0;
        const crossTotal = m.thickness + zone;

        const [ax, ay, aw, ah] = geom.rect(monCross, start, m.margin, layout.length, crossTotal);
        this._actor.set_position(Math.round(ax), Math.round(ay));
        this._actor.set_size(Math.round(aw), Math.round(ah));

        const [bx, by, bw, bh] = geom.rect(crossTotal, 0, 0, layout.length, m.thickness);
        this._background.set_position(Math.round(bx), Math.round(by));
        this._background.set_size(Math.round(bw), Math.round(bh));

        const inset = Math.ceil(m.radius * 0.3);
        this._blur.set_position(Math.round(bx + inset), Math.round(by + inset));
        this._blur.set_size(Math.max(0, Math.round(bw - 2 * inset)), Math.max(0, Math.round(bh - 2 * inset)));

        this._itemsLayer.set_position(0, 0);
        this._itemsLayer.set_size(Math.round(aw), Math.round(ah));

        const placed = [];
        entries.forEach((e, i) => {
            const pos = layout.positions[i];
            const size = layout.sizes[i];
            placed.push({item: e.item, pos, size, base: e.base, scale: layout.scales[i]});
            if (!e.item)
                return;
            const [x, y, w, h] = geom.rect(crossTotal, pos, 0, size, crossTotal);
            e.item.set_position(Math.round(x), Math.round(y));
            e.item.set_size(Math.max(0, Math.round(w)), Math.max(0, Math.round(h)));
            e.item.applyLayout(geom, size, crossTotal, layout.scales[i], m);
        });

        this._lastLayout = {placed, start, crossTotal, ax, ay, baseStart, baseLength, monMainOrigin};

        if (this._tooltipItem)
            this._positionTooltip();

        if (amount === 0 && !this.dragging)
            this._updateIconGeometries();
    }

    /** Visual rect of an item's icon in outer (monitor-local) coordinates. */
    iconRectFor(item) {
        const L = this._lastLayout;
        if (!L)
            return null;
        const p = L.placed.find(e => e.item === item);
        if (!p)
            return null;
        const m = this.metrics;
        const s = m.iconSize * p.scale;
        const [x, y, w, h] = this.geom.rect(L.crossTotal, p.pos + (p.size - s) / 2, m.pad, s, s);
        return [L.ax + x, L.ay + y, w, h];
    }

    _updateIconGeometries() {
        const L = this._lastLayout;
        const m = this.metrics;
        const mon = this.monitor;
        const monCross = this.geom.vertical ? mon.width : mon.height;
        const rects = [];
        for (const p of L.placed) {
            if (!(p.item instanceof DockAppIcon) || p.item._vanishing)
                continue;
            const main = L.start + p.pos + (p.size - m.iconSize) / 2;
            const [x, y, w, h] = this.geom.rect(monCross, main, m.margin + m.pad, m.iconSize, m.iconSize);
            rects.push([p.item, Math.round(mon.x + x), Math.round(mon.y + y), Math.round(w), Math.round(h)]);
        }
        const key = rects.map(r => r.slice(1).join(',') + r[0].itemKey).join('|');
        if (key === this._iconGeometryKey)
            return;
        this._iconGeometryKey = key;
        for (const [item, x, y, width, height] of rects)
            item.setIconGeometry(new Mtk.Rectangle({x, y, width, height}));
    }

    /** Stage rectangle used by intellihide (unmagnified bar + edge margin). */
    getHideRect() {
        const L = this._lastLayout;
        if (!L)
            return null;
        const m = this.metrics;
        const mon = this.monitor;
        const monCross = this.geom.vertical ? mon.width : mon.height;
        const [x, y, w, h] = this.geom.rect(monCross, L.baseStart, 0, L.baseLength, m.margin + m.thickness);
        return new Mtk.Rectangle({
            x: Math.round(mon.x + x), y: Math.round(mon.y + y),
            width: Math.round(w), height: Math.round(h),
        });
    }

    get dark() {
        return this._dark;
    }

    get model() {
        return this._model;
    }

    // ---- Hover / magnification -------------------------------------------

    get hovered() {
        return this._actor.hover;
    }

    get requiresVisibility() {
        return this.dragging || this._menuOpenCount > 0 || this._popupOpen;
    }

    _onHoverChanged() {
        const hovered = this._actor.hover;
        if (hovered) {
            const [x, y] = global.get_pointer();
            this._pointer = [x, y];
        }
        if (this.metrics.magEnabled) {
            this._magAmount.remove_transition('value');
            const target = hovered && !this.dragging && !this._menuPending &&
                this._menuOpenCount === 0 && !this._popupOpen ? 1 : 0;
            this._magAmount.ease(target, {
                duration: target ? MAGNIFY_IN_TIME : MAGNIFY_OUT_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
        if (!hovered)
            this.hideTooltip();
        this.queueRelayout();
        this._autohide?.onHoverChanged(hovered);
    }

    // ---- Tooltip ---------------------------------------------------------

    onItemHover(item, hover) {
        if (hover && !this.dragging && this._menuOpenCount === 0 && !this._popupOpen && item.labelText) {
            this._tooltipItem = item;
            this._tooltip.text = item.labelText;
            this._tooltip.show();
            this._tooltip.remove_transition('opacity');
            this._tooltip.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            this._positionTooltip();
        } else if (this._tooltipItem === item) {
            this.hideTooltip();
        }
    }

    _positionTooltip() {
        const rect = this.iconRectFor(this._tooltipItem);
        if (!rect)
            return;
        const [ix, iy, iw, ih] = rect;
        const [, tw] = this._tooltip.get_preferred_width(-1);
        const [, th] = this._tooltip.get_preferred_height(tw);
        let x, y;
        switch (this.geom.position) {
        case 'left':
            x = ix + iw + TOOLTIP_GAP;
            y = iy + ih / 2 - th / 2;
            break;
        case 'right':
            x = ix - tw - TOOLTIP_GAP;
            y = iy + ih / 2 - th / 2;
            break;
        default:
            x = ix + iw / 2 - tw / 2;
            y = iy - th - TOOLTIP_GAP;
        }
        const mon = this.monitor;
        x = Math.max(4, Math.min(x, mon.width - tw - 4));
        y = Math.max(4, Math.min(y, mon.height - th - 4));
        this._tooltip.set_position(Math.round(x), Math.round(y));
    }

    hideTooltip() {
        this._tooltipItem = null;
        this._tooltip.remove_transition('opacity');
        this._tooltip.ease({
            opacity: 0,
            duration: 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => {
                if (!this._tooltipItem)
                    this._tooltip.hide();
            },
        });
    }

    // ---- Menus / popups --------------------------------------------------

    /** Collapses magnification right before a menu opens so it anchors to the bar. */
    prepareMenu() {
        this._menuPending = true;
        this.hideTooltip();
        this._magAmount.remove_transition('value');
        this._magAmount.value = 0;
        this._relayout();
    }

    setMenuOpen(item, open) {
        this._menuOpenCount = Math.max(0, this._menuOpenCount + (open ? 1 : -1));
        if (!open)
            this._menuPending = false;
        if (open)
            this.hideTooltip();
        this._onHoverChanged();
    }

    setPopupOpen(open) {
        this._popupOpen = open;
        if (open)
            this.hideTooltip();
        else
            this._onHoverChanged();
        this._autohide?.update();
    }

    // ---- Overlays (Downloads stack, window previews, App Exposé) ---------

    /** Collapses magnification so overlays anchor to the resting icon. */
    prepareOverlay() {
        this.hideTooltip();
        this._magAmount.remove_transition('value');
        this._magAmount.value = 0;
        this._popupOpen = true; // keeps the magnification zone collapsed
        this._relayout();
    }

    /** Only one overlay at a time: opening one closes the previous. */
    registerOverlay(overlay) {
        if (this._overlay && this._overlay !== overlay)
            this._overlay.close();
        this._overlay = overlay;
    }

    unregisterOverlay(overlay) {
        if (this._overlay === overlay)
            this._overlay = null;
    }

    openWindowPreviews(item) {
        this.prepareOverlay();
        new WindowPreviewsPopup(item);
    }

    openExpose(item) {
        this.prepareOverlay();
        new AppExpose(item);
    }

    // ---- Show / hide -----------------------------------------------------

    slideIn(animate = true) {
        if (this._shown)
            return;
        this._shown = true;
        this._actor.show();
        this._actor.remove_all_transitions();
        if (!animate) {
            this._actor.set({translation_x: 0, translation_y: 0, opacity: 255});
            return;
        }
        this._actor.ease({
            translation_x: 0,
            translation_y: 0,
            opacity: 255,
            duration: SLIDE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    slideOut(animate = true) {
        if (!this._shown)
            return;
        this._shown = false;
        this.hideTooltip();
        const m = this.metrics;
        const [tx, ty] = this.geom.outward(-(m.margin + m.thickness + 6));
        this._actor.remove_all_transitions();
        if (!animate) {
            this._actor.set({translation_x: tx, translation_y: ty, opacity: 0});
            this._actor.hide();
            return;
        }
        this._actor.ease({
            translation_x: tx,
            translation_y: ty,
            opacity: 0,
            duration: SLIDE_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (!this._shown)
                    this._actor.hide();
            },
        });
    }

    // ---- Attention -------------------------------------------------------

    _onUrgent(window) {
        if (!window || window.has_focus())
            return;
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        if (!app)
            return;
        const item = this._itemMap.get(`app:${this._model.resolve(app).get_id()}`);
        item?.bounce(3, () => window.has_focus());
    }

    // ---- Drag and drop ---------------------------------------------------

    onItemDragBegin(item) {
        this.dragging = true;
        this._draggedItem = item;
        this.hideTooltip();
        this._magAmount.remove_transition('value');
        this._magAmount.value = 0;
        item.presence.remove_transition('value');
        item.presence.ease(0, {duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});

        if (item.app && this._model.isPinned(item.app) && !Main.overview.visible)
            this._addRemoveCatcher(item);
        this._autohide?.update();
    }

    onItemDragEnd(item) {
        if (!this.dragging)
            return;
        this.dragging = false;
        this._draggedItem = null;
        this._clearPlaceholder();
        this._removeCatcher();
        item.appear(true);
        this._iconGeometryKey = '';
        this.queueRelayout();
        this._autohide?.update();
    }

    _addRemoveCatcher(item) {
        const mon = this.monitor;
        const catcher = new St.Widget({
            reactive: true,
            x: mon.x,
            y: mon.y,
            width: mon.width,
            height: mon.height,
        });
        catcher._delegate = {
            handleDragOver: source => {
                if (source !== this._draggedItem)
                    return DND.DragMotionResult.NO_DROP;
                this._clearPlaceholder();
                return DND.DragMotionResult.MOVE_DROP;
            },
            acceptDrop: (source, actor) => {
                if (source !== item)
                    return false;
                this._poof(actor);
                AppFavorites.getAppFavorites().removeFavorite(item.app.get_id());
                return true;
            },
        };
        Main.layoutManager.uiGroup.insert_child_below(catcher, this._outer);
        this._catcher = catcher;
    }

    _removeCatcher() {
        this._catcher?.destroy();
        this._catcher = null;
    }

    _poof(dragActor) {
        if (!dragActor)
            return;
        const [x, y] = dragActor.get_transformed_position();
        const [w, h] = dragActor.get_transformed_size();
        const clone = new Clutter.Clone({source: dragActor, x, y, width: w, height: h, reactive: false});
        clone.set_pivot_point(0.5, 0.5);
        Main.uiGroup.add_child(clone);
        clone.ease({
            scale_x: 1.8,
            scale_y: 1.8,
            opacity: 0,
            duration: 280,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => clone.destroy(),
        });
    }

    _onDragMotion(dragEvent) {
        if (this._placeholderIndex !== null &&
            (!dragEvent.targetActor || !this._actor.contains(dragEvent.targetActor))) 
            this._clearPlaceholder();
        
        return DND.DragMotionResult.CONTINUE;
    }

    _clearPlaceholder() {
        if (this._placeholderIndex === null)
            return;
        this._placeholderIndex = null;
        this._dropFavPos = null;
        this.queueRelayout();
    }

    _pinnedSlots() {
        // [itemsIndex, item] for pinned app icons, excluding the dragged one.
        const slots = [];
        this._items.forEach((item, idx) => {
            if (item instanceof DockAppIcon && item.itemKey.startsWith('app:') &&
                !item._vanishing && item !== this._draggedItem && this._model.isPinned(item.app))
                slots.push([idx, item]);
        });
        return slots;
    }

    // DnD target interface (this._actor._delegate === this)
    handleDragOver(source, actor, x, y) {
        const app = getAppFromSource(source);
        if (!app || app.is_window_backed() || !global.settings.is_writable('favorite-apps'))
            return DND.DragMotionResult.NO_DROP;
        if (!this._lastLayout)
            return DND.DragMotionResult.NO_DROP;

        const local = this.geom.vertical ? y : x;
        const slots = this._pinnedSlots();
        const slotItems = new Set(slots.map(s => s[1]));

        // Walk the layout ignoring the placeholder gap to avoid flicker.
        let cursor = this.metrics.endPad;
        let favPos = 0;
        for (const p of this._lastLayout.placed) {
            if (!p.item)
                continue;
            if (slotItems.has(p.item) && cursor + p.size / 2 < local)
                favPos++;
            cursor += p.size;
        }

        let index;
        if (favPos < slots.length) 
            index = slots[favPos][0];
        else if (slots.length) 
            index = slots[slots.length - 1][0] + 1;
        else 
            index = this._items.findIndex(it => it instanceof DockAppsButton) + 1;
        

        if (index !== this._placeholderIndex) {
            this._placeholderIndex = index;
            this.queueRelayout();
        }
        this._dropFavPos = favPos;
        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source) {
        const app = getAppFromSource(source);
        if (!app || app.is_window_backed() || !global.settings.is_writable('favorite-apps'))
            return false;
        const favPos = this._dropFavPos ?? 0;
        this._clearPlaceholder();

        const id = app.get_id();
        const favorites = AppFavorites.getAppFavorites();
        const isFavorite = favorites.isFavorite(id);
        // Change favorites after the drop finishes, like the GNOME Dash does.
        const laters = global.compositor.get_laters();
        if (this._dropLaterId)
            laters.remove(this._dropLaterId);
        this._dropLaterId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._dropLaterId = 0;
            if (isFavorite)
                favorites.moveFavoriteToPos(id, favPos);
            else
                favorites.addFavoriteAtPos(id, favPos);
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    // ---- Teardown --------------------------------------------------------

    destroy() {
        this._destroyed = true;
        const laters = global.compositor.get_laters();
        for (const id of [this._relayoutId, this._dropLaterId]) {
            if (id)
                laters.remove(id);
        }
        this._relayoutId = this._dropLaterId = 0;
        DND.removeDragMonitor(this._dragMonitor);
        this._autohide?.destroy();
        this._autohide = null;
        this._model.disconnectObject(this);
        global.display.disconnectObject(this);
        this._removeCatcher();
        this._overlay?.destroyNow();
        this._overlay = null;

        const items = this._items;
        this._items = [];
        this._itemMap.clear();
        for (const item of items)
            item.destroy();

        this._struts?.destroy();
        this._struts = null;
        this._outer.destroy();
    }
}
