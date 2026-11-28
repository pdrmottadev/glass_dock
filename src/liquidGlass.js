// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Liquid glass: what is behind the dock, blurred and bent like a lens near
// the edges, with a light rim and a soft highlight under the pointer.
//
// A shader cannot read the screen behind an actor, so the dock clones the
// windows (and the wallpaper under them) clipped to its own area, blurs that
// clone and runs the shader on it. The mask in the shader also gives the
// glass real rounded corners.
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

const DECLARATIONS = `
uniform vec2 size;      // actor size, px
uniform float inset;    // margin around the glass, px
uniform float radius;   // corner radius, px
uniform float strength; // 0..1
uniform vec2 pointer;   // px from the center; x < -9999 when away
uniform float light;    // rim and highlight brightness

float glassDistance(vec2 p) {
    vec2 halfSize = size * 0.5 - vec2(inset);
    vec2 q = abs(p) - (halfSize - vec2(radius));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
`;

const CODE = `
vec2 uv = cogl_tex_coord_in[0].xy;
vec2 p = uv * size - size * 0.5;
float d = glassDistance(p);
float mask = clamp(0.5 - d, 0.0, 1.0);
float inside = -d;

// Outward normal of the nearest edge.
vec2 n = vec2(glassDistance(p + vec2(1.0, 0.0)) - glassDistance(p - vec2(1.0, 0.0)),
              glassDistance(p + vec2(0.0, 1.0)) - glassDistance(p - vec2(0.0, 1.0)));
n = n / max(length(n), 1e-4);

// Lens: near the edge, sample further in, a little more for blue than red.
float band = max(4.0, (min(size.x, size.y) - 2.0 * inset) * 0.45);
float bend = strength * pow(1.0 - smoothstep(0.0, band, inside), 2.0);
vec2 shift = n * bend * band * 1.6 / size;
vec3 c = vec3(texture2D(cogl_sampler0, uv - shift).r,
              texture2D(cogl_sampler0, uv - shift * 1.12).g,
              texture2D(cogl_sampler0, uv - shift * 1.24).b);

// Light rim on the edges facing up and left.
float rim = (1.0 - smoothstep(0.0, 2.5, inside)) * max(0.0, dot(n, vec2(-0.33, -0.94)));
c += rim * 0.5 * light;

// Soft highlight under the pointer.
if (pointer.x > -9999.0) {
    vec2 r = p - pointer;
    float s = max(size.y - 2.0 * inset, 1.0) * 0.9;
    c += exp(-dot(r, r) / (2.0 * s * s)) * 0.12 * light;
}

cogl_color_out = vec4(clamp(c, 0.0, 1.0) * mask, mask);
`;

/** The shader, or null when this GNOME version cannot run it. */
const LiquidShader = (() => {
    try {
        return GObject.registerClass(class GlassDockLiquidShader extends Clutter.ShaderEffect {
            vfunc_get_static_snippet() {
                const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
                snippet.set_replace(CODE);
                return snippet;
            }
        });
    } catch (e) {
        console.warn(`Glass Dock: liquid glass is not available: ${e.message}`);
        return null;
    }
})();

export const LIQUID_GLASS_SUPPORTED = LiquidShader !== null;

const NO_POINTER = -100000;

export class LiquidGlass {
    /**
     * @param {object} params
     * @param {number} params.blurRadius in px
     * @param {number} params.strength 0..1
     * @param {boolean} params.dark
     */
    constructor({blurRadius, strength, dark}) {
        // A margin around the glass keeps the blur from fading at its edges.
        this._inset = Math.ceil(blurRadius / 2) + 2;
        this.actor = new St.Widget({clip_to_allocation: true, reactive: false});
        this._clone = new Clutter.Clone({source: global.window_group, reactive: false});
        this.actor.add_child(this._clone);
        this.actor.add_effect_with_name('blur', new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: blurRadius,
            brightness: dark ? 0.85 : 1.0,
        }));
        this._shader = new LiquidShader();
        this.actor.add_effect_with_name('liquid', this._shader);
        this._shader.set_uniform_float('inset', 1, [this._inset]);
        this._shader.set_uniform_float('strength', 1, [strength]);
        this._shader.set_uniform_float('light', 1, [dark ? 0.55 : 1.0]);
        this._shader.set_uniform_float('pointer', 2, [NO_POINTER, NO_POINTER]);
        this._size = [0, 0];
    }

    /**
     * Places the glass over a rectangle of its parent and sets its shape.
     * `stageOrigin` is the parent's position on the stage.
     */
    update(x, y, width, height, radius, stageOrigin) {
        const i = this._inset;
        const w = Math.max(1, Math.round(width + 2 * i));
        const h = Math.max(1, Math.round(height + 2 * i));
        this.actor.set_position(Math.round(x - i), Math.round(y - i));
        this.actor.set_size(w, h);
        if (w !== this._size[0] || h !== this._size[1]) {
            this._size = [w, h];
            this._shader.set_uniform_float('size', 2, [w, h]);
        }
        const r = Math.min(radius, (Math.min(width, height)) / 2);
        if (r !== this._radius) {
            this._radius = r;
            this._shader.set_uniform_float('radius', 1, [r]);
        }
        this.syncClone(stageOrigin);
    }

    /** Lines the cloned windows up with the screen behind the glass. */
    syncClone([originX, originY]) {
        this._clone.set_position(-(originX + this.actor.x), -(originY + this.actor.y));
    }

    /** Pointer position in stage coordinates, or null when it is away. */
    setPointer(stagePoint) {
        let point = [NO_POINTER, NO_POINTER];
        if (stagePoint) {
            const [ok, x, y] = this.actor.transform_stage_point(...stagePoint);
            if (ok)
                point = [x - this._size[0] / 2, y - this._size[1] / 2];
        }
        this._shader.set_uniform_float('pointer', 2, point);
        this.actor.queue_redraw();
    }

    destroy() {
        this.actor.destroy();
    }
}
