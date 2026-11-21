// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 pdrmottadev
//
// Generated with AI for personal use.
// Do NOT upload to extensions.gnome.org (EGO) unless you understand JavaScript
// and can maintain this code.

// Pure math for the "wave" magnification effect.

/**
 * Influence of the pointer on an item, 1 at the pointer, falling smoothly
 * to 0 at `radius` (cos² falloff, like a soft bell curve).
 *
 * @param {number} distance distance from pointer to item center
 * @param {number} radius   distance at which influence reaches 0
 */
export function influence(distance, radius) {
    if (radius <= 0 || distance >= radius)
        return 0;
    const c = Math.cos((Math.PI * distance) / (2 * radius));
    return c * c;
}

/**
 * Advances a damped spring by `dt` seconds. It keeps its velocity when the
 * target changes, so motion never jerks. This is the exact solution, so the
 * result does not depend on the frame rate.
 *
 * @param {{value: number, velocity: number}} spring updated in place
 * @param {number} target value the spring is pulled towards
 * @param {number} rate   stiffness in 1/s; higher settles faster
 * @param {number} dt     time step in seconds
 * @param {number} [damping] 1 settles without overshooting; lower overshoots
 */
export function stepSpring(spring, target, rate, dt, damping = 1) {
    const offset = spring.value - target;
    const velocity = spring.velocity;
    if (damping >= 1) {
        const k = velocity + rate * offset;
        const decay = Math.exp(-rate * dt);
        spring.value = target + (offset + k * dt) * decay;
        spring.velocity = (velocity - k * rate * dt) * decay;
        return;
    }
    const decayRate = damping * rate;
    const frequency = rate * Math.sqrt(1 - damping * damping);
    const b = (velocity + decayRate * offset) / frequency;
    const decay = Math.exp(-decayRate * dt);
    const cos = Math.cos(frequency * dt), sin = Math.sin(frequency * dt);
    spring.value = target + decay * (offset * cos + b * sin);
    spring.velocity = decay * (velocity * cos - (decayRate * b + frequency * offset) * sin);
}

/**
 * Computes magnified sizes and positions for a row of items.
 *
 * Scales are computed against the *unmagnified* layout so the effect does not
 * feed back into itself. The magnified layout is then anchored so the point
 * under the pointer stays under the pointer — the row grows around it.
 *
 * @param {object} p
 * @param {number[]} p.baseSizes   base main-axis size of each item
 * @param {boolean[]} p.magnifiable whether each item reacts to the pointer
 * @param {number} p.iconSize      base icon size
 * @param {number} p.padding       padding at both ends of the row
 * @param {number|null} p.pointer  pointer position relative to unmagnified row start (null = none)
 * @param {number} p.maxScale      scale at the pointer
 * @param {number} p.amount        0..1 animation factor for the whole effect
 * @param {number} p.radius        influence radius in px
 * @returns {{scales:number[], sizes:number[], positions:number[], length:number,
 *            baseLength:number, anchorShift:number}}
 *          positions are relative to the magnified row start; anchorShift is
 *          how far the magnified row start moves relative to the base start.
 */
export function computeLayout(p) {
    const n = p.baseSizes.length;
    const basePositions = new Array(n);
    let cursor = p.padding;
    for (let i = 0; i < n; i++) {
        basePositions[i] = cursor;
        cursor += p.baseSizes[i];
    }
    const baseLength = cursor + p.padding;

    const scales = new Array(n).fill(1);
    const sizes = p.baseSizes.slice();
    const active = p.pointer !== null && p.amount > 0 && p.maxScale > 1;

    if (active) {
        for (let i = 0; i < n; i++) {
            if (!p.magnifiable[i])
                continue;
            const center = basePositions[i] + p.baseSizes[i] / 2;
            const f = influence(Math.abs(p.pointer - center), p.radius);
            scales[i] = 1 + (p.maxScale - 1) * f * p.amount;
            sizes[i] = p.baseSizes[i] + p.iconSize * (scales[i] - 1);
        }
    }

    const positions = new Array(n);
    cursor = p.padding;
    for (let i = 0; i < n; i++) {
        positions[i] = cursor;
        cursor += sizes[i];
    }
    const length = cursor + p.padding;

    // Anchor: map pointer from base layout into magnified layout.
    let anchorShift = (baseLength - length) / 2; // centered by default
    if (active) {
        const q = p.pointer;
        let qMag;
        if (q <= p.padding || n === 0) {
            qMag = q;
        } else if (q >= baseLength - p.padding) {
            qMag = length - (baseLength - q);
        } else {
            qMag = q;
            for (let i = 0; i < n; i++) {
                const start = basePositions[i];
                const end = start + p.baseSizes[i];
                if (q >= start && q <= end) {
                    const t = p.baseSizes[i] > 0 ? (q - start) / p.baseSizes[i] : 0;
                    qMag = positions[i] + t * sizes[i];
                    break;
                }
            }
        }
        const anchored = q - qMag;
        // Blend between centered and anchored so leaving is smooth.
        anchorShift = anchorShift + (anchored - anchorShift) * p.amount;
    }

    return {scales, sizes, positions, length, baseLength, anchorShift};
}
