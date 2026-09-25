/*
 * Strange attractors — 3D chaotic flows integrated with fourth-order
 * Runge–Kutta and drawn as one continuous line, rotated and projected to the
 * page. A short transient is skipped so the line starts on the attractor.
 * Each system carries its classic parameters, a step size, a length that
 * reads as a drawing rather than a solid blob, and a flattering view. The
 * default looks down the (1,1,1) axis of Halvorsen's cyclically symmetric flow.
 */
(function () {
    'use strict';
    const { geo, TAU } = PG;

    // f(x, y, z) -> [dx, dy, dz]; view: [screen x axis, screen up axis, depth axis]
    const SYSTEMS = {
        lorenz: {
            name: 'Lorenz', dt: 0.005, steps: 11000, start: [0.1, 0, 20], view: [0, 2, 1],
            f: (x, y, z) => [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z],
        },
        aizawa: {
            name: 'Aizawa', dt: 0.01, steps: 16000, start: [0.1, 0, 0], view: [0, 2, 1],
            f: (x, y, z) => {
                const a = 0.95, b = 0.7, c = 0.6, d = 3.5, e = 0.25, f = 0.1;
                return [(z - b) * x - d * y, d * x + (z - b) * y,
                    c + a * z - (z * z * z) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x * x * x];
            },
        },
        thomas: {
            name: 'Thomas', dt: 0.04, steps: 20000, start: [0.1, 0, 0], view: [0, 1, 2],
            f: (x, y, z) => { const b = 0.208186; return [Math.sin(y) - b * x, Math.sin(z) - b * y, Math.sin(x) - b * z]; },
        },
        halvorsen: {
            name: 'Halvorsen', dt: 0.005, steps: 14000, start: [-1.48, -1.51, 2.04], view: [0, 1, 2],
            f: (x, y, z) => {
                const a = 1.4;
                return [-a * x - 4 * y - 4 * z - y * y, -a * y - 4 * z - 4 * x - z * z, -a * z - 4 * x - 4 * y - x * x];
            },
        },
        rossler: {
            name: 'Rössler', dt: 0.02, steps: 14000, start: [1, 1, 0], view: [0, 1, 2],
            f: (x, y, z) => [-y - z, x + 0.2 * y, 0.2 + z * (x - 5.7)],
        },
        dadras: {
            name: 'Dadras', dt: 0.005, steps: 40000, start: [1.1, 2.1, -2], view: [0, 1, 2],
            f: (x, y, z) => [y - 3 * x + 2.7 * y * z, 1.7 * y - x * z + z, 2 * x * y - 9 * z],
        },
        chen: {
            name: 'Chen', dt: 0.002, steps: 16000, start: [-10, 0, 37], view: [0, 2, 1],
            f: (x, y, z) => [35 * (y - x), -7 * x - x * z + 28 * y, x * y - 3 * z],
        },
        sprott: {
            name: 'Sprott', dt: 0.01, steps: 28000, start: [0.63, 0.47, -0.54], view: [0, 1, 2],
            f: (x, y, z) => { const a = 2.07, b = 1.79; return [y + a * x * y + x * z, 1 - b * x * x + y * z, x - x * x - y * y]; },
        },
        fourwing: {
            name: 'Four-wing', dt: 0.02, steps: 50000, start: [1.3, -0.18, 0.01], view: [0, 1, 2],
            f: (x, y, z) => [0.2 * x + y * z, 0.01 * x - 0.4 * y - x * z, -z - x * y],
        },
    };
    // Rotations (degrees about X, Y, Z) that show each system off.
    const VIEWS = {
        lorenz: [[0, 0, 0], [0, 35, 0], [-20, 20, 0], [-15, 60, 0]],                 // turning the other way shows the wings edge-on
        aizawa: [[-15, 0, 0], [-25, 20, 0], [-50, 20, 0], [15, 30, 0]],               // tilted to show the tube through the sphere
        thomas: [[45, -35, 0], [45, -35, 0], [0, 0, 0], [-45, 35, 0]],                 // (1,1,1) is its 3-fold axis
        halvorsen: [[45, -35, 0], [45, -35, 0], [0, 0, 0]],
        rossler: [[0, 0, 0], [-60, 0, 0], [-35, 20, 0], [-75, 30, 0]],
        dadras: [[0, 0, 0], [30, 30, 0], [-30, 20, 0]],
        chen: [[0, 0, 0], [0, 35, 0], [-20, 0, 0]],
        sprott: [[0, 0, 0], [-30, 0, 0], [-60, 20, 0]],
        fourwing: [[0, 0, 0], [-30, 0, 0], [0, 40, 0]],                             // steeper tilts show a wing edge-on as a spike
    };

    function integrate(sys, steps, dt, transient, jitter) {
        const f = sys.f;
        let x = sys.start[0] + jitter[0], y = sys.start[1] + jitter[1], z = sys.start[2] + jitter[2];
        const step = () => {
            const k1 = f(x, y, z);
            const k2 = f(x + (dt / 2) * k1[0], y + (dt / 2) * k1[1], z + (dt / 2) * k1[2]);
            const k3 = f(x + (dt / 2) * k2[0], y + (dt / 2) * k2[1], z + (dt / 2) * k2[2]);
            const k4 = f(x + dt * k3[0], y + dt * k3[1], z + dt * k3[2]);
            x += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
            y += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
            z += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
            return isFinite(x) && isFinite(y) && isFinite(z) && Math.abs(x) + Math.abs(y) + Math.abs(z) < 1e5;
        };
        for (let i = 0; i < transient; i++) if (!step()) return [];
        // each point also keeps its velocity, for smooth in-between points later
        const pts = [[x, y, z, ...f(x, y, z)]];
        for (let i = 0; i < steps; i++) {
            if (!step()) break;
            pts.push([x, y, z, ...f(x, y, z)]);
        }
        return pts;
    }

    PG.register({
        id: 'attractor',
        name: 'Strange Attractor',
        category: 'Curves',
        description: 'A chaotic 3D flow (Lorenz, Aizawa, Thomas…) drawn as one continuous line.',
        fit: true,
        params: [
            { type: 'section', label: 'System' },
            { id: 'system', label: 'System', type: 'select', value: 'halvorsen',
                options: Object.keys(SYSTEMS).map(k => [k, SYSTEMS[k].name]) },
            { id: 'length', label: 'Length', type: 'range', min: 0.1, max: 4, step: 0.05, value: 1, random: [0.6, 1.4],
                hint: 'Multiplies the number of integration steps the system starts with' },
            { id: 'dtScale', label: 'Step size ×', type: 'range', min: 0.25, max: 2, step: 0.05, value: 1, random: false,
                hint: 'Smaller steps give a smoother, more exact line; the length drawn stays the same' },
            { type: 'section', label: 'View' },
            { id: 'rotX', label: 'Rotate X°', type: 'range', min: -180, max: 180, step: 1, value: 45 },
            { id: 'rotY', label: 'Rotate Y°', type: 'range', min: -180, max: 180, step: 1, value: -35 },
            { id: 'rotZ', label: 'Rotate Z°', type: 'range', min: -180, max: 180, step: 1, value: 0 },
            { id: 'persp', label: 'Perspective', type: 'range', min: 0, max: 1, step: 0.01, value: 0.25, random: [0, 0.5] },
            { type: 'section', label: 'Pens' },
            { id: 'pens', label: 'Pens', type: 'range', min: 1, max: 4, step: 1, value: 1, random: false },
            { id: 'penMode', label: 'Split pens by', type: 'select', value: 'time', show: p => p.pens > 1,
                options: [['time', 'Time (consecutive bands)'], ['depth', 'Depth (near to far)']] },
        ],

        randomize(rng) {
            const system = rng.pick(Object.keys(SYSTEMS));
            const v = rng.pick(VIEWS[system]);
            const j = () => Math.round(rng.range(-10, 10));
            return { system, rotX: v[0] + j(), rotY: v[1] + j(), rotZ: v[2] + rng.int(-30, 30) };
        },

        generate(p, ctx) {
            const sys = SYSTEMS[p.system] || SYSTEMS.lorenz;
            const want = Math.max(100, Math.round(sys.steps * p.length / p.dtScale));
            const steps = Math.min(200000, want);
            const dt = sys.dt * p.dtScale * (want / steps); // past the step cap, take longer steps rather than a shorter line
            const transient = Math.round((sys.steps * 0.08 * sys.dt) / dt); // a fixed stretch of time, whatever the length
            const jitter = [ctx.rng.gauss(0, 1e-3), ctx.rng.gauss(0, 1e-3), ctx.rng.gauss(0, 1e-3)];
            const raw = integrate(sys, steps, dt, transient, jitter);
            if (raw.length < 2) return [];

            // classic view axes, centred on the bounding box and scaled to unit size
            const [ax, ay, az] = sys.view;
            let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
            for (const q of raw) for (let i = 0; i < 3; i++) { if (q[i] < lo[i]) lo[i] = q[i]; if (q[i] > hi[i]) hi[i] = q[i]; }
            const c = [0, 1, 2].map(i => (lo[i] + hi[i]) / 2);
            const s = 2 / Math.max(1e-9, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);

            // Fast stretches take long steps. Fill them in with cubic Hermite points
            // (position and velocity at both ends of the step), so the line stays
            // smooth to ~0.012 unit (≈1 mm on A4) without changing the trajectory.
            const seg = 0.012 / s;
            const path = [raw[0]];
            for (let i = 1; i < raw.length; i++) {
                const a = raw[i - 1], b = raw[i];
                const n = Math.min(8, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / seg));
                for (let j = 1; j < n; j++) {
                    const t = j / n, t2 = t * t, t3 = t2 * t;
                    const h00 = 2 * t3 - 3 * t2 + 1, h10 = (t3 - 2 * t2 + t) * dt, h01 = 3 * t2 - 2 * t3, h11 = (t3 - t2) * dt;
                    path.push([0, 1, 2].map(k => h00 * a[k] + h10 * a[k + 3] + h01 * b[k] + h11 * b[k + 3]));
                }
                path.push(b);
            }

            const rx = geo.rad(p.rotX), ry = geo.rad(p.rotY), rz = geo.rad(p.rotZ);
            const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
            // camera distance in unit radii, kept outside the √3 sphere the rotated points can reach
            const cam = Math.max(2.5, 1.5 + 8 * (1 - p.persp) * (1 - p.persp));
            const pts = new Array(path.length), depth = new Float64Array(path.length);
            for (let i = 0; i < path.length; i++) {
                const q = path[i];
                let x = (q[ax] - c[ax]) * s, y = (q[ay] - c[ay]) * s, z = (q[az] - c[az]) * s;
                let t = y * cx - z * sx; z = y * sx + z * cx; y = t;   // about X
                t = x * cy + z * sy; z = -x * sy + z * cy; x = t;      // about Y
                t = x * cz - y * sz; y = x * sz + y * cz; x = t;       // about Z
                const k = p.persp > 0 ? cam / (cam - z) : 1;
                pts[i] = [x * k, -y * k];
                depth[i] = z;
            }

            const pens = Math.max(1, Math.round(p.pens));
            if (pens === 1) return [pts];
            if (p.penMode !== 'depth') return { layers: geo.splitPath(pts, pens).map(piece => [piece]) };

            // depth bands with equal shares of the line; pieces share their end points
            const sorted = Array.from(depth).sort((a, b) => a - b);
            const cuts = [];
            for (let i = 1; i < pens; i++) cuts.push(sorted[Math.floor((sorted.length * i) / pens)]);
            const band = z => { let b = 0; while (b < cuts.length && z > cuts[b]) b++; return pens - 1 - b; }; // near = pen 1
            const layers = Array.from({ length: pens }, () => []);
            let cur = [pts[0]], cb = band(depth[0]);
            for (let i = 1; i < pts.length; i++) {
                cur.push(pts[i]);
                const b = band(depth[i]);
                if (b !== cb) { layers[cb].push(cur); cur = [pts[i]]; cb = b; }
            }
            layers[cb].push(cur);
            return { layers };
        },
    });
})();
