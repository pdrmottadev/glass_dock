// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Dock items: base class, app icons, the Apps button and separators.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {AppMenu} from 'resource:///org/gnome/shell/ui/appMenu.js';


const BOUNCE_TIME = 220;
const PRESENCE_TIME = 260;
const SCROLL_COOLDOWN_MS = 250;
const MAX_DOTS = 4;
const HOVER_FADE_TIME = 160;
const INDICATOR_TIME = 220;
const HALO_PULSE_TIME = 1400;
const PRESS_SCALE = 0.85;
const REFLECTION_OPACITY = 0.3;

// GNOME 51 renamed ONE/TWO to PRIMARY/MIDDLE (and warns on the old names);
// GNOME 50 only has the old ones.
const BUTTON_MASK = (St.ButtonMask.PRIMARY ?? St.ButtonMask.ONE) |
    (St.ButtonMask.MIDDLE ?? St.ButtonMask.TWO);

/** Popup arrow side for a given dock position. */
export function menuSideFor(position) {
    switch (position) {
    case 'left':
        return St.Side.LEFT;
    case 'right':
        return St.Side.RIGHT;
    default:
        return St.Side.BOTTOM;
    }
}

/** Inline style of a round glow in one color that fades out to its edge. */
function radialGlow([r, g, b], alpha) {
    return 'background-gradient-direction: radial;' +
        `background-gradient-start: rgba(${r},${g},${b},${alpha});` +
        `background-gradient-end: rgba(${r},${g},${b},0);`;
}

function setClass(actor, name, on) {
    if (on)
        actor.add_style_class_name(name);
    else
        actor.remove_style_class_name(name);
}

/**
 * Base class for anything shown as an icon in the dock.
 * The dock positions items itself and calls applyLayout() every frame the
 * layout changes.
 */
export const DockItem = GObject.registerClass(
class DockItem extends St.Button {
    _init(dock, params = {}) {
        super._init({
            style_class: 'glass-dock-item',
            reactive: true,
            can_focus: false,
            track_hover: true,
            button_mask: BUTTON_MASK,
            ...params,
        });

        this._dock = dock;
        this._delegate = this;
        this.accessible_name = this.labelText;
        this.magnifiable = true;
        this._destroyed = false;
        this._bouncing = false;

        // Animated 0..1 "how present" factor used for add/remove animations.
        this.presence = new St.Adjustment({actor: this, lower: 0, upper: 1, value: 0});
        this.presence.connect('notify::value', () => this._dock.queueRelayout());

        this._content = new St.Widget({x_expand: true, y_expand: true});
        this.set_child(this._content);

        const style = dock.style;
        this._style = style;
        this._focused = false;

        // Behind the icon: the plate marks open (or focused) apps in some
        // styles, and the hover layer lights up under the pointer.
        this._plate = new St.Widget({style_class: 'glass-dock-plate', visible: false});
        this._content.add_child(this._plate);
        this._plateRadius = -1;
        if (style.hover) {
            this._hoverLayer = new St.Widget({
                style_class: `glass-dock-hover glass-dock-hover-${style.hover}`,
                opacity: 0,
                clip_to_allocation: style.hover === 'tint',
            });
            this._content.add_child(this._hoverLayer);
            this._hoverRadius = -1;
        }
        if (style.hover === 'halo')
            this._hoverLayer.style = radialGlow(dock.accentColor, 1);
        if (style.hover === 'tint') {
            this._glow = new St.Widget({style: radialGlow(dock.accentColor, 0.9)});
            this._hoverLayer.add_child(this._glow);
            this._glowMain = null;
            this.connect('motion-event', (actor, event) => {
                this._moveGlow(...event.get_coords());
                return Clutter.EVENT_PROPAGATE;
            });
        }

        this._renderSize = dock.metrics.magSize;
        this._iconActor = this.createIconActor(this._renderSize);
        this._content.add_child(this._iconActor);

        // Mirror image of the icon on the shelf.
        if (style.shelf && dock.geom.position === 'bottom') {
            this._reflectionClip = new St.Widget({clip_to_allocation: true});
            this._reflection = new Clutter.Clone({source: this._iconActor});
            this._reflectionClip.add_child(this._reflection);
            this._content.insert_child_below(this._reflectionClip, this._iconActor);
            this._iconActor.connect('notify::translation-y', icon => {
                this._reflection.translation_y = -icon.translation_y;
            });
        }

        // Running indicator: one dot per window (up to MAX_DOTS), or a line
        // or pill whose length shows whether the app is focused.
        this._dotCount = 0;
        this._dots = [];
        if (style.indicator === 'dots' || style.indicator === 'glow') {
            for (let i = 0; i < MAX_DOTS; i++) {
                const dot = new St.Widget({style_class: 'glass-dock-dot', visible: false});
                this._content.add_child(dot);
                this._dots.push(dot);
            }
        }
        if (style.indicator === 'line' || style.indicator === 'pill') {
            this._bar = new St.Widget({
                style_class: `glass-dock-bar glass-dock-bar-${style.indicator}`,
                visible: false,
            });
            this._content.add_child(this._bar);
            this._barExtra = new St.Widget({
                style_class: `glass-dock-bar glass-dock-bar-${style.indicator} glass-dock-bar-extra`,
                visible: false,
            });
            this._content.add_child(this._barExtra);
            this._focusAmount = new St.Adjustment({actor: this, lower: 0, upper: 1, value: 0});
            this._focusAmount.connect('notify::value', () => this._dock.queueRelayout());
        }

        if (style.press) {
            this._press = new St.Adjustment({actor: this, lower: 0, upper: 1, value: 0});
            this._press.connect('notify::value', () => this._dock.queueRelayout());
            this.connect('notify::pressed', () => this._onPressed());
        }

        this._menu = null;
        this._menuManager = new PopupMenu.PopupMenuManager(this);

        const longPress = new Clutter.LongPressGesture();
        longPress.connect('recognize', () => this.popupMenu());
        this.add_action(longPress);

        const rightClick = new Clutter.ClickGesture({
            required_button: Clutter.BUTTON_SECONDARY,
            recognize_on_press: true,
        });
        rightClick.connect('recognize', () => this.popupMenu());
        this.add_action(rightClick);

        this.connect('notify::hover', () => {
            this._dock.onItemHover(this, this.hover);
            this._syncHover();
        });
        this.connect('destroy', () => this._onDestroy());
    }

    /** Override: returns an actor of size `size` used as the icon. */
    createIconActor(size) {
        return new St.Icon({icon_name: 'application-x-executable', icon_size: size});
    }

    /** Override: text shown in the tooltip. */
    get labelText() {
        return '';
    }

    /** Override: returns a PopupMenu or null. */
    createMenu() {
        return null;
    }

    get iconActor() {
        return this._iconActor;
    }

    /** Redraws the icon for this size in pixels. */
    renderIconAt(size) {
        this._iconActor.icon_size = size;
    }

    getBaseMainSize(m) {
        return m.iconSize + m.spacing;
    }

    /**
     * Positions the icon and dot inside the item.
     *
     * @param {EdgeGeometry} geom
     * @param {number} center    icon center along the dock, in item coordinates
     * @param {number} crossSize item thickness (bar + magnification zone)
     * @param {number} scale     current magnification scale
     * @param {object} m         dock metrics
     * @param {boolean} snap     at rest: draw the icon at its exact size, on whole pixels
     */
    applyLayout(geom, center, crossSize, scale, m, snap) {
        // At rest the icon is drawn at its exact size, pixel for pixel; scaling
        // the large version down would leave jagged edges. It only switches
        // to the large version while zooming.
        const size = snap ? m.iconSize : m.magSize;
        if (size !== this._renderSize) {
            this._renderSize = size;
            this.renderIconAt(size);
        }
        const [ix, iy] = geom.rect(crossSize, center - size / 2, m.pad, size, size);
        this._iconActor.set_position(snap ? Math.round(ix) : ix, snap ? Math.round(iy) : iy);
        this._iconActor.set_size(size, size);
        const [px, py] = geom.edgePivot;
        this._iconActor.set_pivot_point(px, py);
        const pressed = this._press ? 1 - (1 - PRESS_SCALE) * this._press.value : 1;
        const k = (m.iconSize * scale * this.presence.value * pressed) / size;
        this._iconActor.set_scale(k, k);
        this._iconActor.opacity = Math.round(255 * this.presence.value);

        if (this._reflection) {
            const cellMain = geom.vertical ? this.height : this.width;
            this._reflectionClip.set_position(0, Math.round(crossSize - m.pad));
            this._reflectionClip.set_size(cellMain, m.pad);
            // Flipped around its top edge, so the icon's bottom touches the clip's top.
            this._reflection.set_size(size, size);
            this._reflection.set_pivot_point(0.5, 0);
            this._reflection.set_scale(k, -k);
            this._reflection.set_position(this._iconActor.x, size * k);
            this._reflection.opacity = Math.round(255 * REFLECTION_OPACITY * this.presence.value);
        }

        this._layoutBackdrop(geom, center, crossSize, scale, m);
        this._layoutBar(geom, center, crossSize, scale, m);

        const D = m.dotSize;
        const gap = Math.max(2, Math.round(D * 0.8));
        const n = this._dotCount;
        const total = n * D + Math.max(0, n - 1) * gap;
        const cross = Math.max(1, (m.pad - D) / 2);
        this._dots.forEach((dot, i) => {
            if (i >= n)
                return;
            const main = center - total / 2 + i * (D + gap);
            const [dx, dy] = geom.rect(crossSize, main, cross, D, D);
            dot.set_position(Math.round(dx), Math.round(dy));
            dot.set_size(D, D);
        });
    }

    /**
     * Plate behind the icon and the hover layer. Both cover the item's cell,
     * or a rounded square around the icon.
     */
    _layoutBackdrop(geom, center, crossSize, scale, m) {
        const cellMain = geom.vertical ? this.height : this.width;
        const inset = Math.max(2, Math.round(m.pad * 0.3));
        const cell = geom.rect(crossSize, 1, inset, Math.max(0, cellMain - 2), m.thickness - 2 * inset);
        const s = m.iconSize * scale * this.presence.value;
        const grow = Math.round(m.pad * 0.6);
        const square = geom.rect(crossSize, center - s / 2 - grow, m.pad - grow, s + 2 * grow, s + 2 * grow);
        const place = (actor, [x, y, w, h]) => {
            actor.set_position(Math.round(x), Math.round(y));
            actor.set_size(Math.max(0, Math.round(w)), Math.max(0, Math.round(h)));
        };
        const radius = Math.round((s + 2 * grow) * 0.22);

        if (this._plate.visible) {
            const rounded = this._style.indicator === 'pill';
            place(this._plate, rounded ? square : cell);
            this._plate.opacity = Math.round(255 * this.presence.value);
            if (rounded && radius !== this._plateRadius) {
                this._plateRadius = radius;
                this._plate.style = `border-radius: ${radius}px;`;
            }
        }

        if (!this._hoverLayer)
            return;
        switch (this._style.hover) {
        case 'rounded':
            place(this._hoverLayer, square);
            if (radius !== this._hoverRadius) {
                this._hoverRadius = radius;
                this._hoverLayer.style = `border-radius: ${radius}px;`;
            }
            break;
        case 'halo': {
            const d = s * 2;
            const crossCenter = m.pad + s / 2;
            place(this._hoverLayer, geom.rect(crossSize, center - d / 2, crossCenter - d / 2, d, d));
            break;
        }
        default:
            place(this._hoverLayer, cell);
        }
        if (this._glow)
            this._placeGlow();
    }

    /** The line or pill under an open app; longer when it is focused. */
    _layoutBar(geom, center, crossSize, scale, m) {
        if (!this._bar?.visible)
            return;
        const cellMain = geom.vertical ? this.height : this.width;
        const s = m.iconSize * scale;
        const f = this._focusAmount.value;
        let length, thickness, cross;
        if (this._style.indicator === 'line') {
            thickness = Math.max(2, Math.round(m.iconSize / 16));
            length = s * 0.5 + (cellMain - 2 - s * 0.5) * f;
            cross = 0;
        } else {
            thickness = 3;
            const short = Math.max(6, s * 0.16);
            length = short + (s * 0.45 - short) * f;
            cross = Math.max(1, Math.round((m.pad - thickness) / 2));
        }

        // Several windows: a short extra mark next to the main one. The line
        // keeps its total length; the pill gets a dot after it.
        const multi = this._barExtra.visible;
        const gap = 3;
        const extra = this._style.indicator === 'line' ? Math.max(4, Math.round(s * 0.12)) : thickness;
        const total = multi && this._style.indicator === 'pill' ? length + gap + extra : length;
        const start = center - total / 2;
        const main = multi && this._style.indicator === 'line' ? length - gap - extra : length;
        const place = (actor, from, size) => {
            const [x, y, w, h] = geom.rect(crossSize, from, cross, size, thickness);
            actor.set_position(Math.round(x), Math.round(y));
            actor.set_size(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
            actor.opacity = Math.round(255 * this.presence.value);
        };
        place(this._bar, start, main);
        if (multi)
            place(this._barExtra, start + total - extra, extra);
    }

    /** Override: icon whose color tints the hover glow, or null. */
    get tintIcon() {
        return null;
    }

    _moveGlow(stageX, stageY) {
        const [ok, x, y] = this._hoverLayer.transform_stage_point(stageX, stageY);
        if (!ok)
            return;
        this._glowMain = this._dock.geom.vertical ? y : x;
        this._placeGlow();
    }

    /** Centers the glow on the pointer, at the bar's screen edge. */
    _placeGlow() {
        const geom = this._dock.geom;
        const layer = this._hoverLayer;
        const layerMain = geom.vertical ? layer.height : layer.width;
        const layerCross = geom.vertical ? layer.width : layer.height;
        const d = Math.round(layerCross * 2.2);
        const main = this._glowMain ?? layerMain / 2;
        const [x, y, w, h] = geom.rect(layerCross, main - d / 2, -d / 2, d, d);
        this._glow.set_position(Math.round(x), Math.round(y));
        this._glow.set_size(w, h);
    }

    _fade(actor, opacity, duration = HOVER_FADE_TIME) {
        actor.remove_all_transitions();
        if (this._style.instant) {
            actor.opacity = opacity;
            return;
        }
        this._dock.ease(actor, {opacity, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    _syncHover() {
        if (!this._hoverLayer)
            return;
        const hover = this.hover && !this._dock.dragging;
        if (this._style.hover === 'halo') {
            this._syncHalo();
            return;
        }
        if (hover && this._glow && !this._glowColored) {
            // Computed on first hover, once per app.
            this._glowColored = true;
            const color = this._dock.iconColor(this.tintIcon);
            if (color)
                this._glow.style = radialGlow(color, 0.9);
        }
        if (!hover)
            this._glowMain = null;
        this._fade(this._hoverLayer, hover ? 255 : 0);
    }

    /** Neon halo: bright on hover, pulsing slowly while the app is focused. */
    _syncHalo() {
        const halo = this._hoverLayer;
        if (this.hover && !this._dock.dragging) {
            this._fade(halo, 255);
        } else if (this._focused && this._dock.canAnimate) {
            halo.remove_all_transitions();
            this._dock.ease(halo, {
                opacity: 200,
                duration: HOVER_FADE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._dock.ease(halo, {
                        opacity: 70,
                        duration: HALO_PULSE_TIME,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                        autoReverse: true,
                        repeatCount: -1,
                    });
                },
            });
        } else {
            this._fade(halo, this._focused ? 160 : 0);
        }
    }

    _onPressed() {
        this._press.remove_transition('value');
        if (this.pressed) {
            this._dock.easeValue(this._press, 1, {duration: 90, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._dock.easeValue(this._press, 0, {
                duration: 320,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
        }
    }

    /** Which part marks an open app: the plate, the bar or the dots. */
    _syncIndicator() {
        const running = this._dotCount > 0;
        switch (this._style.indicator) {
        case 'plate':
        case 'bevel':
            this._plate.visible = running;
            break;
        case 'line':
        case 'pill':
            this._plate.visible = running && this._focused;
            this._bar.visible = running;
            this._barExtra.visible = this._dotCount > 1;
            break;
        }
        setClass(this._plate, 'glass-dock-plate-multi', this._dotCount > 1);
        this._dock.queueRelayout();
    }

    /** Shows `count` indicator dots (0 hides them). */
    setDotCount(count) {
        if (!this._dock.settings.get_boolean('show-running-indicators'))
            count = 0;
        count = Math.max(0, Math.min(MAX_DOTS, count));
        this._dots.forEach((dot, i) => {
            dot.visible = i < count;
        });
        if (count !== this._dotCount) {
            this._dotCount = count;
            this._syncIndicator();
        }
    }

    setDotsActive(active) {
        for (const dot of this._dots)
            setClass(dot, 'glass-dock-dot-active', active);
        for (const actor of [this._plate, this._bar, this._barExtra].filter(Boolean))
            setClass(actor, 'glass-dock-focused', active);
        if (active === this._focused)
            return;
        this._focused = active;
        this._syncIndicator();
        if (this._focusAmount) {
            this._focusAmount.remove_transition('value');
            if (this._style.instant) {
                this._focusAmount.value = active ? 1 : 0;
            } else {
                this._dock.easeValue(this._focusAmount, active ? 1 : 0, {
                    duration: INDICATOR_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }
        if (this._style.hover === 'halo')
            this._syncHalo();
    }

    setRunning(running) {
        this.setDotCount(running ? 1 : 0);
    }

    appear(animate = true) {
        if (this._vanishing)
            return;
        if (!animate) {
            this.presence.value = 1;
            return;
        }
        this.presence.remove_transition('value');
        this._dock.easeValue(this.presence, 1, {duration: PRESENCE_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    vanish(onDone) {
        this.reactive = false;
        this.presence.remove_transition('value');
        this._dock.easeValue(this.presence, 0, {
            duration: PRESENCE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: onDone,
        });
    }

    /**
     * Bounces the icon away from the screen edge.
     *
     * @param {number} times    maximum number of bounces
     * @param {Function} [stopWhen] stops early once this returns true
     */
    bounce(times = 1, stopWhen = () => false) {
        if (this._bouncing || this._destroyed)
            return;
        this._bouncing = true;
        let count = 0;
        const icon = this._iconActor;

        const step = () => {
            if (this._destroyed)
                return;
            if (count >= times || (count > 0 && stopWhen())) {
                this._bouncing = false;
                return;
            }
            count++;
            const [tx, ty] = this._dock.geom.outward(this._dock.metrics.iconSize * 0.45);
            this._dock.ease(icon, {
                translation_x: tx,
                translation_y: ty,
                duration: BOUNCE_TIME,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._dock.ease(icon, {
                        translation_x: 0,
                        translation_y: 0,
                        duration: BOUNCE_TIME,
                        mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        onComplete: step,
                        onStopped: finished => {
                            if (!finished)
                                this._bouncing = false;
                        },
                    });
                },
                onStopped: finished => {
                    if (!finished)
                        this._bouncing = false;
                },
            });
        };
        step();
    }

    popupMenu() {
        if (this._dock.dragging)
            return;
        if (!this._menu) {
            this._menu = this.createMenu();
            if (!this._menu)
                return;
            this._menu.connect('open-state-changed', (menu, open) => {
                this._dock.setMenuOpen(this, open);
            });
            Main.uiGroup.add_child(this._menu.actor);
            this._menuManager.addMenu(this._menu);
        }
        this._dock.prepareMenu();
        this._menu.open(true);
    }

    get menuOpen() {
        return this._menu?.isOpen ?? false;
    }

    _onDestroy() {
        this._destroyed = true;
        this._menu?.destroy();
        this._menu = null;
    }
});

/** An application icon (pinned, running or recent). */
export const DockAppIcon = GObject.registerClass(
class DockAppIcon extends DockItem {
    _init(dock, app) {
        this.app = app;
        super._init(dock);
        this.itemKey = `app:${app.get_id()}`;
        this._lastScroll = 0;
        this._iconGeometry = null;

        this.app.connectObject(
            'notify::state', () => this._syncState(),
            'windows-changed', () => {
                this._syncState();
                this._applyIconGeometry();
            },
            this);
        Shell.WindowTracker.get_default().connectObject(
            'notify::focus-app', () => this._syncFocus(), this);
        // Windows GNOME did not match to this app come and go through the model.
        this._dock.model.connectObject('changed', () => {
            this._syncState();
            this._syncFocus();
            this._applyIconGeometry();
        }, this);
        this._syncState();
        this._syncFocus();

        this._draggable = DND.makeDraggable(this, {timeoutThreshold: 200});
        this._draggable.connectObject(
            'drag-begin', () => this._dock.onItemDragBegin(this),
            'drag-cancelled', () => this._dock.onItemDragEnd(this),
            'drag-end', () => this._dock.onItemDragEnd(this),
            this);
    }

    createIconActor(size) {
        const icon = this.app.create_icon_texture(size);
        icon.add_style_class_name('glass-dock-icon');
        return icon;
    }

    get labelText() {
        return this.app.get_name();
    }

    get tintIcon() {
        return this.app.get_icon();
    }

    /** This app's windows, including ones GNOME did not match to it. */
    windows() {
        return this._dock.model.windowsFor(this.app);
    }

    get running() {
        return this._dock.model.isRunning(this.app);
    }

    _syncState() {
        this.setDotCount(this.running ? Math.max(1, this.windows().length) : 0);
    }

    _syncFocus() {
        this.setDotsActive(this._dock.model.isFocused(this.app));
    }

    createMenu() {
        const menu = new AppMenu(this, menuSideFor(this._dock.geom.position), {
            favoritesSection: true,
            showSingleWindows: true,
        });
        menu.setApp(this.app);

        // Extra entry on top: App Exposé, only useful with 2+ windows.
        const exposeItem = new PopupMenu.PopupMenuItem(_('Show All Windows'));
        exposeItem.connect('activate', () => this._dock.openExpose(this));
        menu.addMenuItem(exposeItem, 0);
        menu.connect('open-state-changed', (m, open) => {
            if (open)
                exposeItem.visible = this.windows().length > 1;
        });
        return menu;
    }

    // Called by AppMenu when it launches the app.
    animateLaunch() {
        if (this._dock.settings.get_boolean('bounce-on-launch'))
            this.bounce(10, () => this.running);
    }

    vfunc_clicked(button) {
        this._dock.hideTooltip();
        this.activate(button);
    }

    activate(button) {
        const app = this.app;
        const event = Clutter.get_current_event();
        const modifiers = event ? event.get_state() : 0;
        const isMiddle = button === Clutter.BUTTON_MIDDLE;
        const isCtrl = (modifiers & Clutter.ModifierType.CONTROL_MASK) !== 0;

        if ((isMiddle || isCtrl) && app.state === Shell.AppState.RUNNING &&
            app.can_open_new_window()) {
            this.animateLaunch();
            app.open_new_window(-1);
            Main.overview.hide();
            return;
        }

        if (!this.running) {
            this.animateLaunch();
            app.activate();
            Main.overview.hide();
            return;
        }

        const windows = this.windows();
        const isFocused = this._dock.model.isFocused(app) && !Main.overview.visible;

        if (windows.length === 0) {
            app.activate();
            Main.overview.hide();
            return;
        }
        if (!isFocused) {
            this._raiseAll(windows);
            Main.overview.hide();
            return;
        }

        const settings = this._dock.settings;
        if (windows.length > 1) {
            switch (settings.get_string('multi-window-action')) {
            case 'previews':
                this._dock.openWindowPreviews(this);
                return;
            case 'expose':
                this._dock.openExpose(this);
                return;
            case 'cycle-windows':
                this._cycleWindows(1);
                return;
            default:
                this._minimizeAll(windows);
                return;
            }
        }

        switch (settings.get_string('click-action')) {
        case 'focus-or-minimize':
            this._minimizeAll(windows);
            break;
        case 'cycle-windows':
            this._cycleWindows(1);
            break;
        default:
            this._raiseAll(windows);
        }
    }

    /**
     * Brings all of the app's windows on this workspace to the front and
     * focuses the one used most recently. Mutter's focus history is used
     * instead of Shell.App.activate(), whose "most recent" can be stale.
     */
    _raiseAll(windows) {
        const time = global.get_current_time();
        const recent = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(w => windows.includes(w));
        const target = recent[0] ?? windows[0];
        const workspace = global.workspace_manager.get_active_workspace();
        // Least recent first, so the most recent ends up on top.
        for (const w of [...recent].reverse()) {
            if (w !== target && !w.minimized && w.located_on_workspace(workspace))
                w.raise();
        }
        Main.activateWindow(target, time);
    }

    _minimizeAll(windows) {
        windows.forEach(w => {
            if (w.can_minimize() && !w.minimized)
                w.minimize();
        });
    }

    _cycleWindows(direction) {
        const windows = this.windows()
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        if (windows.length === 0)
            return;
        const current = windows.indexOf(global.display.focus_window);
        const n = windows.length;
        const next = current === -1 ? 0 : (current + direction + n) % n;
        Main.activateWindow(windows[next]);
    }

    vfunc_scroll_event(event) {
        if (!this.running)
            return Clutter.EVENT_PROPAGATE;
        const now = GLib.get_monotonic_time() / 1000;
        if (now - this._lastScroll < SCROLL_COOLDOWN_MS)
            return Clutter.EVENT_STOP;

        let dir = 0;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            dir = -1;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            dir = 1;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            const d = Math.abs(dy) > Math.abs(dx) ? dy : dx;
            if (Math.abs(d) < 0.3)
                return Clutter.EVENT_STOP;
            dir = d > 0 ? 1 : -1;
            break;
        }
        }
        if (dir !== 0) {
            this._lastScroll = now;
            this._cycleWindows(dir);
        }
        return Clutter.EVENT_STOP;
    }

    // --- DnD source -------------------------------------------------------

    getDragActor() {
        return this.app.create_icon_texture(this._dock.metrics.iconSize);
    }

    getDragActorSource() {
        return this._iconActor;
    }

    // --- Minimize target ----------------------------------------------------

    /** @param {Mtk.Rectangle|null} rect stage rectangle of the icon */
    setIconGeometry(rect) {
        this._iconGeometry = rect;
        this._applyIconGeometry();
    }

    _applyIconGeometry() {
        for (const w of this.windows())
            w.set_icon_geometry(this._iconGeometry);
    }

    _onDestroy() {
        if (this._iconGeometry) {
            for (const w of this.windows())
                w.set_icon_geometry(null);
        }
        this.app.disconnectObject(this);
        Shell.WindowTracker.get_default().disconnectObject(this);
        this._dock.model.disconnectObject(this);
        super._onDestroy();
    }
});

/** The "Apps" button (opens the app grid). */
export const DockAppsButton = GObject.registerClass(
class DockAppsButton extends DockItem {
    _init(dock) {
        super._init(dock);
        this.itemKey = 'apps-button';
        // The orb and the labeled button have a fixed shape.
        if (this._mode === 'orb' || this._mode === 'labeled')
            this.magnifiable = false;
        this._shapeKey = '';
    }

    /** 'tile', 'square', 'orb' or 'labeled' (horizontal docks only). */
    get _mode() {
        const mode = this._dock.style.appsButton;
        return mode === 'labeled' && this._dock.geom.vertical ? 'square' : mode;
    }

    createIconActor(size) {
        const mode = this._mode;
        this._tileIcon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: Math.round(size * (mode === 'square' ? 0.62 : 0.52)),
            style_class: 'glass-dock-apps-tile-icon',
        });
        switch (mode) {
        case 'square':
            return new St.Bin({style_class: 'glass-dock-apps-plain', child: this._tileIcon});
        case 'orb':
            return new St.Bin({style_class: 'glass-dock-apps-tile glass-dock-apps-orb', child: this._tileIcon});
        case 'labeled': {
            this._label = new St.Label({text: _('Apps'), y_align: Clutter.ActorAlign.CENTER});
            this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            const box = new St.BoxLayout({
                style_class: 'glass-dock-apps-tile glass-dock-apps-labeled',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });
            // Its width depends on the font, known once the style applies.
            box.connect('style-changed', () => this._dock.queueRelayout());
            this._tileIcon.y_align = Clutter.ActorAlign.CENTER;
            box.add_child(this._tileIcon);
            box.add_child(this._label);
            // The dock sizes the holder; the box inside is only measured, so
            // its natural width never picks up the size set on the holder.
            this._labeledBox = box;
            return new St.Bin({child: box});
        }
        default:
            return new St.Bin({
                style_class: 'glass-dock-apps-tile',
                style: `border-radius: ${Math.round(size * 0.24)}px;`,
                child: this._tileIcon,
            });
        }
    }

    renderIconAt(size) {
        switch (this._mode) {
        case 'square':
            this._tileIcon.icon_size = Math.round(size * 0.62);
            break;
        case 'tile':
            this._iconActor.style = `border-radius: ${Math.round(size * 0.24)}px;`;
            this._tileIcon.icon_size = Math.round(size * 0.52);
            break;
        }
    }

    _orbSize(m) {
        return Math.round(m.thickness * 1.12);
    }

    /** Sizes the orb or the labeled button for these metrics. */
    _shape(m) {
        const key = `${m.iconSize}/${m.thickness}`;
        if (key === this._shapeKey)
            return;
        this._shapeKey = key;
        if (this._mode === 'orb') {
            const d = this._orbSize(m);
            this._iconActor.style = `border-radius: ${Math.ceil(d / 2)}px;`;
            this._tileIcon.icon_size = Math.round(d * 0.5);
        } else {
            const h = m.thickness - 2 * Math.max(2, Math.round(m.pad * 0.3));
            const radius = this._dock.style.indicator === 'bevel' ? 0 : Math.round(h * 0.3);
            this._labeledBox.style = `border-radius: ${radius}px;` +
                `padding: 0 ${Math.round(m.iconSize * 0.4)}px;` +
                `spacing: ${Math.round(m.iconSize * 0.2)}px;` +
                `font-size: ${Math.round(m.iconSize * 0.42)}px;`;
            this._tileIcon.icon_size = Math.round(m.iconSize * 0.62);
        }
    }

    /** Natural width of the labeled button. */
    _labeledWidth(m) {
        this._shape(m);
        return Math.ceil(this._labeledBox.get_preferred_width(-1)[1]);
    }

    getBaseMainSize(m) {
        switch (this._mode) {
        case 'orb':
            return this._orbSize(m) + m.spacing;
        case 'labeled':
            return this._labeledWidth(m) + m.spacing;
        default:
            return super.getBaseMainSize(m);
        }
    }

    applyLayout(geom, center, crossSize, scale, m, snap) {
        const mode = this._mode;
        if (mode !== 'orb' && mode !== 'labeled') {
            super.applyLayout(geom, center, crossSize, scale, m, snap);
            return;
        }
        this._shape(m);
        let rect;
        if (mode === 'orb') {
            // Sits on the screen edge and rises above the bar.
            const d = this._orbSize(m);
            rect = geom.rect(crossSize, center - d / 2, 1, d, d);
        } else {
            const inset = Math.max(2, Math.round(m.pad * 0.3));
            const width = this._labeledWidth(m);
            rect = geom.rect(crossSize, center - width / 2, inset, width, m.thickness - 2 * inset);
        }
        const [x, y, w, h] = rect;
        this._iconActor.set_position(Math.round(x), Math.round(y));
        this._iconActor.set_size(Math.round(w), Math.round(h));
        this._iconActor.set_pivot_point(0.5, 0.5);
        this._iconActor.set_scale(this.presence.value, this.presence.value);
        this._iconActor.opacity = Math.round(255 * this.presence.value);
        this._hoverLayer?.hide();
    }

    get labelText() {
        return _('Applications');
    }

    vfunc_clicked() {
        this._dock.hideTooltip();
        if (Main.overview.visible && Main.overview.dash.showAppsButton.checked)
            Main.overview.hide();
        else
            Main.overview.showApps();
    }
});

/** Thin vertical/horizontal divider between sections. */
export const DockSeparator = GObject.registerClass(
class DockSeparator extends St.Widget {
    _init(dock, key) {
        super._init({reactive: false});
        this._dock = dock;
        this.itemKey = key;
        this.magnifiable = false;
        this.presence = new St.Adjustment({actor: this, lower: 0, upper: 1, value: 0});
        this.presence.connect('notify::value', () => this._dock.queueRelayout());

        this._line = new St.Widget({style_class: 'glass-dock-separator'});
        this.add_child(this._line);
    }

    getBaseMainSize(m) {
        return m.separatorSize;
    }

    applyLayout(geom, center, crossSize, _scale, m) {
        const thickness = 1;
        const length = m.iconSize * 0.7;
        const crossOffset = m.pad + (m.iconSize - length) / 2;
        const [x, y, w, h] = geom.rect(crossSize, center - thickness / 2,
            crossOffset, thickness, length);
        this._line.set_position(Math.round(x), Math.round(y));
        this._line.set_size(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
        this._line.opacity = Math.round(255 * this.presence.value);
    }

    appear(animate = true) {
        if (this._vanishing)
            return;
        if (!animate) {
            this.presence.value = 1;
            return;
        }
        this._dock.easeValue(this.presence, 1, {duration: PRESENCE_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    vanish(onDone) {
        this.presence.remove_transition('value');
        this._dock.easeValue(this.presence, 0, {
            duration: PRESENCE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: onDone,
        });
    }
});
