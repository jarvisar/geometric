/*
 * WebGL2 line renderer for the live preview. Canvas2D takes tens of ms to stroke a big scene,
 * about as long as generating it, which made panning and per-frame morphs choppy.
 *
 * Each segment is a quad shaded as a capsule, so caps and joins come out round. Every pen is
 * drawn into a coverage texture with max blending and then composited in its color, which
 * matches one Canvas2D stroke per pen: segments overlapping at a join don't darken it.
 * Morphs blend two point buffers in the vertex shader. Exports and thumbnails still use Canvas2D.
 */
(function () {
    'use strict';
    const PG = (globalThis.PG = globalThis.PG || {});

    const LINE_VS = `#version 300 es
in vec2 corner;
in vec2 a, b, a2, b2;
in float brk;
uniform float t, hw;
uniform vec3 xf;
uniform vec2 size;
out vec2 local;
out float len;
void main() {
    // the last point of a path doesn't start a segment
    if (brk > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec2 p0 = mix(a, a2, t) * xf.x + xf.yz, p1 = mix(b, b2, t) * xf.x + xf.yz;
    vec2 d = p1 - p0;
    len = length(d);
    vec2 u = len > 1e-6 ? d / len : vec2(1.0, 0.0), n = vec2(-u.y, u.x);
    float r = hw + 1.0;
    local = vec2(corner.x * (len + 2.0 * r) - r, corner.y * r);
    vec2 p = p0 + u * local.x + n * local.y;
    gl_Position = vec4(p.x / size.x * 2.0 - 1.0, 1.0 - p.y / size.y * 2.0, 0.0, 1.0);
}`;
    const LINE_FS = `#version 300 es
precision highp float;
in vec2 local;
in float len;
uniform float hw;
out vec4 o;
void main() {
    float d = length(local - vec2(clamp(local.x, 0.0, len), 0.0));
    o = vec4(clamp(hw + 0.5 - d, 0.0, 1.0));
}`;
    const COMP_VS = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0); }`;
    const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D cov;
uniform vec4 color;
out vec4 o;
void main() { o = color * texelFetch(cov, ivec2(gl_FragCoord.xy), 0).r; }`;

    function program(gl, vs, fs) {
        const p = gl.createProgram();
        for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            gl.attachShader(p, s);
        }
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const loc = {};
        for (let i = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i--;) { const n = gl.getActiveAttrib(p, i).name; loc[n] = gl.getAttribLocation(p, n); }
        for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i--;) { const n = gl.getActiveUniform(p, i).name; loc[n] = gl.getUniformLocation(p, n); }
        return { p, loc };
    }

    // Any CSS color as premultiplied-ready [r, g, b, a] in 0..1, using the 2D canvas parser
    const parser = document.createElement('canvas').getContext('2d');
    const colors = new Map();
    function rgba(css) {
        let c = colors.get(css);
        if (c) return c;
        parser.fillStyle = '#111';
        parser.fillStyle = css;
        const s = parser.fillStyle;
        if (s[0] === '#') c = [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255).concat(1);
        else { const v = s.match(/[\d.]+/g).map(Number); c = [v[0] / 255, v[1] / 255, v[2] / 255, v[3] ?? 1]; }
        colors.set(css, c);
        return c;
    }

    // Uploaded buffers for the last few geometries, so a fade or morph doesn't upload every frame
    const KEEP = 6;

    PG.GLLines = class {
        // null when WebGL2 isn't available
        static create(canvas) {
            const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, depth: false, stencil: false });
            if (!gl) return null;
            try { return new PG.GLLines(canvas, gl); } catch (err) {
                console.warn('WebGL preview unavailable:', err.message);
                return null;
            }
        }

        constructor(canvas, gl) {
            this.canvas = canvas;
            this.gl = gl;
            this.lost = false;
            // The app falls back to Canvas2D for the rest of the session rather than rebuilding everything
            canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
            this.line = program(gl, LINE_VS, LINE_FS);
            this.comp = program(gl, COMP_VS, COMP_FS);
            const quad = (data, prog) => {
                const vao = gl.createVertexArray();
                gl.bindVertexArray(vao);
                gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
                gl.enableVertexAttribArray(prog.loc.corner);
                gl.vertexAttribPointer(prog.loc.corner, 2, gl.FLOAT, false, 0, 0);
                return vao;
            };
            this.lineVao = quad([0, -1, 1, -1, 0, 1, 1, 1], this.line);
            for (const n of ['a', 'b', 'a2', 'b2', 'brk']) {
                gl.enableVertexAttribArray(this.line.loc[n]);
                gl.vertexAttribDivisor(this.line.loc[n], 1);
            }
            this.compVao = quad([0, 0, 1, 0, 0, 1, 1, 1], this.comp);
            gl.bindVertexArray(null);
            this.points = new Map();
            this.breaks = new Map();
            this.w = this.h = 0;
        }

        get ok() { return !this.lost && !this.gl.isContextLost(); }

        resize(w, h) {
            const gl = this.gl;
            this.canvas.width = this.w = w;
            this.canvas.height = this.h = h;
            if (this.tex) { gl.deleteTexture(this.tex); gl.deleteFramebuffer(this.fbo); }
            this.tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.tex);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, Math.max(1, w), Math.max(1, h));
            this.fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }

        cached(map, key, make) {
            let buf = map.get(key);
            if (buf) { map.delete(key); map.set(key, buf); return buf; }
            const gl = this.gl;
            buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, make(), gl.STATIC_DRAW);
            map.set(key, buf);
            if (map.size > KEEP) { const [k, old] = map.entries().next().value; gl.deleteBuffer(old); map.delete(k); }
            return buf;
        }
        pointBuffer(xy) { return this.cached(this.points, xy, () => new Float32Array(xy)); }
        breakBuffer(geo) {
            return this.cached(this.breaks, geo.ends, () => {
                const n = geo.ends.length ? geo.ends[geo.ends.length - 1] : 0, flags = new Uint8Array(n);
                for (const e of geo.ends) flags[e - 1] = 1;
                return flags;
            });
        }

        // items: [{ geo (pens, layerEnds, ends), xy, xy2 and t for morphs, transform { scale, ox, oy } in px, opacity }]
        // opts: { pens, hidden, minLinePx, hairline, clip: { x, y, w, h } in px }
        draw(items, opts) {
            const gl = this.gl, L = this.line, C = this.comp;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.w, this.h);
            gl.disable(gl.SCISSOR_TEST);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (!items.length) return;
            // Only the paper needs clearing and compositing for each pen
            const c = opts.clip, pad = 4;
            const sx = Math.max(0, Math.floor(c.x - pad)), sy = Math.max(0, Math.floor(this.h - c.y - c.h - pad));
            gl.enable(gl.SCISSOR_TEST);
            gl.scissor(sx, sy, Math.max(0, Math.min(this.w, Math.ceil(c.x + c.w + pad)) - sx), Math.max(0, Math.min(this.h, Math.ceil(this.h - c.y + pad)) - sy));
            gl.enable(gl.BLEND);
            for (const it of items) {
                if (!(it.opacity > 0)) continue;
                const geo = it.geo, pos = this.pointBuffer(it.xy), pos2 = it.xy2 ? this.pointBuffer(it.xy2) : pos;
                const brk = this.breakBuffer(geo), tf = it.transform;
                let path = 0;
                for (let i = 0; i < geo.pens.length; i++) {
                    const p0 = path ? geo.ends[path - 1] : 0;
                    path = geo.layerEnds[i];
                    const p1 = path ? geo.ends[path - 1] : 0;
                    const pen = geo.pens[i];
                    if (p1 - p0 < 2 || (opts.hidden && opts.hidden.has(pen))) continue;
                    const style = opts.pens[pen] || { color: '#111', width: 0.3 };
                    const width = Math.max(opts.minLinePx, opts.hairline ? 0 : style.width * tf.scale);

                    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                    gl.blendEquation(gl.MAX);
                    gl.blendFunc(gl.ONE, gl.ONE);
                    gl.useProgram(L.p);
                    gl.bindVertexArray(this.lineVao);
                    gl.uniform1f(L.loc.t, it.xy2 ? it.t : 0);
                    gl.uniform1f(L.loc.hw, width / 2);
                    gl.uniform3f(L.loc.xf, tf.scale, tf.ox, tf.oy);
                    gl.uniform2f(L.loc.size, this.w, this.h);
                    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
                    gl.vertexAttribPointer(L.loc.a, 2, gl.FLOAT, false, 8, p0 * 8);
                    gl.vertexAttribPointer(L.loc.b, 2, gl.FLOAT, false, 8, (p0 + 1) * 8);
                    gl.bindBuffer(gl.ARRAY_BUFFER, pos2);
                    gl.vertexAttribPointer(L.loc.a2, 2, gl.FLOAT, false, 8, p0 * 8);
                    gl.vertexAttribPointer(L.loc.b2, 2, gl.FLOAT, false, 8, (p0 + 1) * 8);
                    gl.bindBuffer(gl.ARRAY_BUFFER, brk);
                    gl.vertexAttribPointer(L.loc.brk, 1, gl.UNSIGNED_BYTE, false, 1, p0);
                    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p1 - p0 - 1);

                    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                    gl.blendEquation(gl.FUNC_ADD);
                    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                    gl.useProgram(C.p);
                    gl.bindVertexArray(this.compVao);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, this.tex);
                    gl.uniform1i(C.loc.cov, 0);
                    const [r, g, b, a] = rgba(style.color), k = a * it.opacity;
                    gl.uniform4f(C.loc.color, r * k, g * k, b * k, k);
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                }
            }
            gl.bindVertexArray(null);
        }
    };
})();
