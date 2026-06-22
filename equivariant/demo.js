

export function createDemo(GLSL, divId, demo_type = "growing") {

    const root = document.getElementById(divId);
    const $ = q => root.querySelector(q);
    const $$ = q => root.querySelectorAll(q);
    const modelsUrl = new URL('growing_demo/models.json', import.meta.url);
    const targetImagesBaseUrl = new URL('../growing_demo/target_images/', import.meta.url);

    const canvas = $("#demo-canvas");
    const canvasRecorder = createCanvasRecorderController(canvas, {
        glsl: GLSL,
        filenamePrefix: `npa-${demo_type}-equivariant`,
    });

    const glsl = (param, target) => GLSL({
        ...param, Inc: [`
        #define FOR2(V,A,B) for(ivec2 V=ivec2(A);V.y<(B).y;++V.y) for(V.x=ivec2(A).x;V.x<(B).x;++V.x)
        bool box_intersects(vec4 a, vec4 b) {return a.x<b.z && a.y<b.w && b.x<a.z && b.y<a.w;}
        vec2 log_normalize(vec2 v) {
            float l = length(v);
            if (l > 0.0) return log(l + 1.0) * normalize(v);

            return vec2(0.0);
        }
        float cross2d(vec2 a, vec2 b) {
            return a.x * b.y - a.y * b.x;
        }


    `].concat(param.Inc || [])
    }, target);

    const CHN = 16, C4 = CHN / 4;
    let models, modelA;
    let modelAName;
    let nca_grid, neighborhood, bbox, inv_rho;
    let sort_phase = 0;
    let step_count = 0;
    let frame_count = 0;

    const eps0 = 0.1;
    const sigma0 = 0.2;


    const params = {
        modelA: 'lizard',
        runModel: true,
        step_n: 1,
        speed: -1,
    };
    const uniforms = {
        zoom: 0.0,
        dt: 1.0,
        eps: eps0,
        sigma: sigma0,
        seed_mode: true,
        // sigma: 1.0,
        // viewR: 1.25,
        viewR: 1.25,
        viewC: [0.0, 0.0],
        brush_enabled: true,
        brush_mode: 1,
        brush_size: 1.0,
        particle_radius: 0.03,
        num_particles_log: 12, // 2^12 = 4096
        num_particles: 4096,
        plot_tracer: false,
        bg_color: 0.0,
        state_noise: 0.0,
        position_noise: 0.0,
        channel_idx: 3,
        draw_as_circle: false,
    }

    uniforms.smoothing_coef = 4.0 / (Math.PI * Math.pow(uniforms.eps, 2));
    uniforms.gradient_coef = 10.0 / (Math.PI * Math.pow(uniforms.eps, 3));


    let currentTarget = null;
    let last_cursor_style = 'default';
    let prevPos = [0, 0];

    function update_ui() {
        if ($('#draw_mode').checked != uniforms.draw_as_circle) {
            $('#draw_mode').checked = uniforms.draw_as_circle;
        }

        $('#trace').classList.toggle('enabled', uniforms.plot_tracer);

        if (params.runModel) {
            $('#play').style.display = "none";
            $('#pause').style.display = "inline";
        } else {
            $('#play').style.display = "inline";
            $('#pause').style.display = "none";
        }

        if (params.speed != $('#speed').value) {
            $('#speed').value = params.speed;
            $('#speedLabel').innerHTML = ['1/8x', '1/4x', '1/2x', '1x', '2x', '4x', '8x'][params.speed + 3];
        }

        if (uniforms.particle_radius != parseFloat($('#particle_radius').value)) {
            $('#particle_radius').value = uniforms.particle_radius;
            $('#particleRadiusLabel').innerText = uniforms.particle_radius.toFixed(3);
        }

        if (uniforms.num_particles_log != parseInt($('#particle_count').value)) {
            $('#particle_count').value = uniforms.num_particles_log;
            $('#particleCountLabel').innerText = (uniforms.num_particles).toString();
        }

        $$('#brush_size input').forEach((sel, i) => {
            if (uniforms.brush_size == 0.5 && i == 0) {
                sel.checked = true;
            } else if (uniforms.brush_size == 1.0 && i == 1) {
                sel.checked = true;
            } else if (uniforms.brush_size == 2.0 && i == 2) {
                sel.checked = true;
            }
        });

        $$('#brush_mode input').forEach((sel, i) => {
            if (!uniforms.brush_enabled && i == 3) {
                sel.checked = true;
            } else if (uniforms.brush_enabled && uniforms.brush_mode == i) {
                sel.checked = true;
            }
        });
    }

    update_ui();

    function safeFilenamePart(s) {
        return String(s ?? '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9_\-\.]/g, '_')
            .slice(0, 120) || 'modelA';
    }

    function downloadCanvasPNG(filename) {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    function render() {
        const bg_color = uniforms.bg_color;
        let grid_size = [nca_grid.size[0], nca_grid.size[1], 2];
        glsl({
            state: nca_grid[0], Grid: grid_size, ...uniforms,
            Clear: [bg_color, bg_color, bg_color, canvasRecorder.isRecording() ? 1.0 : 0.0],
            inv_rho, neighborhood, Aspect: 'mean', ...uniforms,
            Blend: 'd*(1-sa)+s',
            VP: `
            varying vec3 col;
            varying float outer;
            if (channel_idx < 0.5) {
                col = vec3(state(ID.xy, 0).xyz);
            } else if (channel_idx < 1.5) {
                col = vec3(state(ID.xy, 0).w, state(ID.xy, 1).xy);
            } else if (channel_idx < 2.5) {
                col = vec3(state(ID.xy, 1).zw, state(ID.xy, 2).x);
            } else if (channel_idx < 3.5) {
                col = vec3(state(ID.xy, 2).w, state(ID.xy, 3).xy);
            } else {
                col = vec3(state(ID.xy, 3).yzw);
            }
            col += 0.5;
            //  = vec3(state(ID.xy, 3).yzw) + 0.5;
            col = max(col, vec3(0.0));
            col = min(col, vec3(1.0));
            
            float radius;
            if (ID.z == 0)
                radius = particle_radius;
            else
                radius = 0.0;
            outer = 0.0;
            if (plot_tracer)
                if (mod(floor(state(ID.xy, 4).z), 256.0) == 0.0)
                    if (ID.z == 0)
                        radius = particle_radius * 6.0;
                    else {
                        radius = eps * 2.0;
                        col = vec3(1.0, 0.0, 0.0);
                        outer = 1.0;
                    }
                        
            vec2 pos = state(ID.xy, 4).xy;
            VPos = vec4(((pos - viewC) + XY * radius) / viewR, 0.0, 1.0);
        `,
            FP: `
            float intensity;
            if (outer < 0.5)
                intensity = exp(-dot(XY, XY) * 10.0);
            else // ring like structure
                intensity = exp(-pow((length(XY) - 0.5) * eps * 400.0, 2.0));
                
            if (draw_as_circle) {
                intensity = intensity < 0.5 ? 0.0 : 1.0;    
            }
            FOut = vec4(col * intensity, intensity);
            
        `
        })
    }

    async function runStepsAndSaveSnapshots(totalSteps = 2048) {
        // Pause the live stepping loop while we do a deterministic batch.
        const wasRunning = params.runModel;
        params.runModel = false;
        update_ui();

        const checkpoints = new Set();
        for (let s = 0; s <= totalSteps; s = (s === 0 ? 1 : s * 2)) checkpoints.add(s);

        const namePart = safeFilenamePart(modelAName ?? params.modelA);
        const save = async (stepIdx) => {
            // Ensure we draw the most recent state before capturing.
            render();
            await new Promise(requestAnimationFrame);
            downloadCanvasPNG(`${namePart}_step${stepIdx}.png`);
            // Wait 20 ms to ensure the download has started before continuing.
            await new Promise(resolve => setTimeout(resolve, 40));
        };

        if (checkpoints.has(0)) await save(0);

        for (let i = 1; i <= totalSteps; ++i) {
            update_index();
            step_fast();
            step_count++;
            if (checkpoints.has(i)) await save(i);
            
        }

        params.runModel = wasRunning;
        update_ui();
    }


    function init_event_listeners() {
        document.onkeydown = async e => {
            // Don't steal key presses from form controls.
            const tag = e.target?.tagName?.toLowerCase?.();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            if (e.key === 'r') {
                reset();
            }
            if (false && e.key === 's') {
                canvasRecorder.start();
            }
            if (false && e.key === 'p') {
                canvasRecorder.stop();
            }
            if (e.key === "Shift") {
                if (canvas.style.cursor != "grabbing") {
                    canvas.style.cursor = "grab";
                    last_cursor_style = canvas.style.cursor;
                }
            }
            if (true && e.key === "n") { // disabled for now
                // Run a fixed batch and export snapshots at powers of two.
                await runStepsAndSaveSnapshots(1024);
            }
            if (e.key === "c") {
                uniforms.channel_idx = (uniforms.channel_idx + 1) % 5;
            }
        };
        document.onkeyup = e => {
            if (e.key === 'Shift') {
                canvas.style.cursor = "default";
                last_cursor_style = canvas.style.cursor;
            }
        };

        // Remove all event listeners first
        canvas.onmousedown = null;
        canvas.onmousemove = null;
        canvas.onmouseup = null;
        canvas.onwheel = null;
        canvas.ontouchstart = null;
        canvas.ontouchmove = null;

        canvas.onmousedown = e => {
            e.preventDefault();
            // left click
            if (e.buttons == 1) {
                if (e.shiftKey) {
                    canvas.style.cursor = "grabbing";
                } else {
                    canvas.style.cursor = 'pointer';
                }
                click(getMousePos(e), e, true);
            }
        }
        canvas.onmousemove = e => {
            e.preventDefault();
            if (e.buttons == 1) {
                click(getMousePos(e), e, false);
            }
        }
        canvas.onmouseup = e => {
            e.preventDefault();
            canvas.style.cursor = last_cursor_style;
        }

        // Zoom with mouse wheel
        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const zoomFactor = Math.exp(e.deltaY * 0.001);
            const oldR = uniforms.viewR;
            const newR = Math.min(10.0, Math.max(0.1, oldR * zoomFactor));
            uniforms.viewR = newR;
        }, { passive: false });

        canvas.addEventListener("touchstart", e => {
            e.preventDefault();
            click(getTouchPos(e.changedTouches[0]), e, true);
        });
        canvas.addEventListener("touchmove", e => {
            e.preventDefault();
            for (const t of e.touches) {
                click(getTouchPos(t), e, false);
            }
        });

        $('#draw_mode').onchange = e => {
            uniforms.draw_as_circle = e.target.checked;

        };

        $('#play-pause').onclick = () => {
            params.runModel = !params.runModel;
            $('#play').style.display = !params.runModel ? "inline" : "none";
            $('#pause').style.display = params.runModel ? "inline" : "none";
            // updateUI();
        };

        $('#reset').onclick = () => {
            reset();
        }

        $('#zoomIn').onclick = () => {
            uniforms.viewR = Math.max(0.1, uniforms.viewR * 0.8);
        }

        $('#zoomOut').onclick = () => {
            uniforms.viewR = Math.min(10.0, uniforms.viewR * 1.25);
        }

        $('#trace').onclick = () => {
            uniforms.plot_tracer = !uniforms.plot_tracer;
            $('#trace').classList.toggle('enabled', uniforms.plot_tracer);
            uniforms.particle_radius = uniforms.plot_tracer ? 0.015 : 0.03;
            uniforms.particle_radius *= Math.sqrt(4096 / uniforms.num_particles);
            $('#particle_radius').value = uniforms.particle_radius;
            $('#particleRadiusLabel').innerText = uniforms.particle_radius.toFixed(3);
        };

        $$('#brush_size input').forEach((sel, i) => {
            sel.onchange = () => {
                if (i == 0) {
                    uniforms.brush_size = 0.5;
                } else {
                    if (i == 1) {
                        uniforms.brush_size = 1.0;
                    } else {
                        uniforms.brush_size = 2.0;
                    }
                }
            }

        });


        $$('#brush_mode input').forEach((sel, i) => {
            sel.onchange = () => {
                if (i == 3) {
                    uniforms.brush_enabled = false;
                } else {
                    uniforms.brush_enabled = true;
                    uniforms.brush_mode = i;
                }
            }
        });

        $('#epsilon').oninput = e => {
            const val = parseFloat(e.target.value);
            uniforms.eps = val;
            uniforms.smoothing_coef = 4.0 / (Math.PI * Math.pow(uniforms.eps, 2));
            uniforms.gradient_coef = 10.0 / (Math.PI * Math.pow(uniforms.eps, 3));
            $('#epsilonLabel').innerText = val.toFixed(3);
            // reset();
            uniforms.particle_radius = 0.04 * (uniforms.eps / eps0);
            $('#particleRadiusLabel').innerText = uniforms.particle_radius.toFixed(3);
            $('#particle_radius').value = uniforms.particle_radius;
        };

        $('#epsilon').max = 0.2;
        $('#epsilon').value = 0.1;
        $('#epsilonLabel').innerText = "0.1";

        $('#speed').oninput = e => {
            const speed = parseInt(e.target.value);
            params.speed = speed;
            $('#speedLabel').innerHTML = ['1/8x', '1/4x', '1/2x', '1x', '2x', '4x', '8x'][speed + 3];
            // $('#speedLabel').innerText = params.step_n + "x";
        };

        $('#particle_radius').oninput = e => {
            const val = parseFloat(e.target.value);
            uniforms.particle_radius = val;
            $('#particleRadiusLabel').innerText = val.toFixed(3);
        };

        $('#particleRadiusLabel').innerText = uniforms.particle_radius.toFixed(3);

        $('#particle_count').oninput = e => {
            const pow = parseInt(e.target.value);
            uniforms.num_particles_log = pow;
            uniforms.num_particles = 1 << pow;
            $('#particleCountLabel').innerText = (uniforms.num_particles).toString();
            let base_radius = uniforms.plot_tracer ? 0.015 : 0.03;
            uniforms.particle_radius = base_radius * Math.sqrt(4096 / uniforms.num_particles);
            // uniforms.particle_radius = base_radius * Math.sqrt(4096 / uniforms.num_particles) * 0.5;
            $('#particle_radius').value = uniforms.particle_radius;
            $('#particleRadiusLabel').innerText = uniforms.particle_radius.toFixed(3);
            reset();
        }




    }

    function getMousePos(e) {
        const gridX = e.offsetX / canvas.clientWidth;
        const gridY = e.offsetY / canvas.clientHeight;
        return [gridX, gridY];
    }

    function getTouchPos(touch) {
        const rect = canvas.getBoundingClientRect();
        const gridX = (touch.clientX - rect.left) / canvas.clientWidth;
        const gridY = (touch.clientY - rect.top) / canvas.clientHeight;
        return [gridX, gridY];
    }

    function click(pos, e, first_touch = false) {
        const [x, y] = pos;
        const [px, py] = prevPos;
        prevPos = pos;


        // Adjust with the aspect ratio
        const c = 0.5 * (canvas.clientWidth + canvas.clientHeight);

        const x1 = (x * 2.0 - 1.0) * (canvas.clientWidth / c);
        const y1 = -(y * 2.0 - 1.0) * (canvas.clientHeight / c);
        const x0 = (px * 2.0 - 1.0) * (canvas.clientWidth / c);
        const y0 = -(py * 2.0 - 1.0) * (canvas.clientHeight / c);

        // If Shift is held OR brush disabled, use drag to pan the view
        if (e.shiftKey || !uniforms.brush_enabled) {
            if (!first_touch) {
                const dx = x1 - x0;
                const dy = y1 - y0;
                uniforms.viewC[0] -= dx * uniforms.viewR;
                uniforms.viewC[1] -= dy * uniforms.viewR;
            }
            return;
        }

        let brush_mode = uniforms.brush_mode;

        if (brush_mode == 1 && first_touch) {
            // In cut mode, do not apply brush on first touch
            return;
        }

        brush(x0, y0, x1, y1, brush_mode);




    }

    init_event_listeners();


    async function init() {
        const response = await fetch(modelsUrl);
        models = await response.json();
        let gridBox = $('#target-shelf');
        gridBox.innerHTML = '';
        $('#origtex').innerHTML = '';
        $('#origtex').style = '';
        $('#texhinttext').innerHTML = '';

        const targets = growing_targets;
        for (const name of targets) {
            if (!(name in models)) continue;
            for (const k in models[name]) {
                if (k == 'alpha' || k == "eps0" || k == "N0") continue
                const src = models[name][k];
                src.data = new Float32Array(
                    Uint8Array.from(atob(src.data64), c => c.charCodeAt(0)).buffer);
                delete src.data64;
            }


            let media_path = new URL(name + ".png", targetImagesBaseUrl).href

            const target_img = document.createElement('div');
            target_img.style.background = "url('" + media_path + "')";
            target_img.style.backgroundSize = "100% 100%";
            // target_img.style.backgroundSize = "100px100px";
            target_img.id = name; //html5 support arbitrary id:s
            target_img.className = 'target-square';
            target_img.onclick = () => {
                // removeOverlayIcon();
                currentTarget.style.borderColor = "black";
                currentTarget = target_img;
                target_img.style.borderColor = "rgb(245 140 44)";
                if (!window.matchMedia('(min-width: 500px)').matches && navigator.userAgent.includes("Chrome")) {
                    target_img.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
                }
                params.modelA = name;
                modelAName = name;
                modelA = load_model(name);
                reset();
                $("#origtex").style.background = "url('" + media_path + "')";
                $("#origtex").style.width = "224px";
                $("#origtex").style.height = "224px";
                $("#origtex").style.backgroundSize = "100% 100%";
                let desc = document.createElement('p')
                desc.innerHTML = "Target Image: " + name;
                // desc.href = "https://www.robots.ox.ac.uk/~vgg/data/dtd/"
                $("#texhinttext").innerHTML = '';
                $("#texhinttext").appendChild(desc);
            };



            gridBox.appendChild(target_img);

            if (name == params.modelA) {
                target_img.style.borderColor = "rgb(245 140 44)";
                currentTarget = target_img;
                target_img.click();
            }

        }
        modelAName = params.modelA;
        modelA = load_model(params.modelA);
        reset();
        frame();
    }

    init();

    function load_model(name) {
        const src = models[name];
        const [ch, ci] = src['w1.weight'].shape;
        const [co, _] = src['w2.weight'].shape;
        const k_in = src['W_hidden'].shape[0];
        const k_hidden = src['W_hidden'].shape[1] / 4;
        const k_out = src['W_out'].shape[1] / 4;
        const nca = {
            WhA: glsl({}, {
                size: [src['W_hidden'].shape[1] / 4, src['W_hidden'].shape[0]], format: 'rgba32f',
                data: src['W_hidden'].data, tag: 'WhA'
            }),
            WoA: glsl({}, {
                size: [src['W_out'].shape[1] / 4, src['W_out'].shape[0]], format: 'rgba32f',
                data: src['W_out'].data, tag: 'WoA'
            }),
            w1A: glsl({}, {
                size: [ci / 4, ch], format: 'rgba32f',
                data: src['w1.weight'].data, tag: 'w1A'
            }),
            b1A: glsl({}, {
                size: [1, ch], format: 'r32f',
                data: src['w1.bias'].data, tag: 'b1A'
            }),
            w2A: glsl({}, {
                size: [ch / 4, co], format: 'rgba32f',
                data: src['w2.weight'].data, tag: 'w2A'
            }),
            b2A: glsl({}, {
                size: [1, co], format: 'r32f',
                data: src['w2.bias'].data, tag: 'b2A'
            }),
        };
        nca.Inc = `
            const float alpha = ${src['alpha'].toFixed(4)};
            const float eps0 = ${src['eps0'].toFixed(4)};
            const float N0 = ${src['N0'].toFixed(4)};
            const int K_IN = ${k_in};
            const int K_HIDDEN = ${k_hidden};
            const int K_OUT = ${k_out};
            const int MLP_HIDDEN = ${ch};
            const int MLP_OUT = ${co};
            const int CHN = ${CHN};

            float smoothing_kernel(vec2 r, float eps) {
                float d2 = dot(r, r);
                float q = 1.0 - d2 / (eps * eps);
                if (q > 0.0) return q * q * q;
                return 0.0;
            }

            vec2 gradient_kernel(vec2 r, float eps) {
                float d = length(r) / eps;
                if (d == 0.0 || d >= 1.0) return vec2(0.0);
                return 3.0 * (1.0 - d) * (1.0 - d) * normalize(r);
            }
        `;
        return nca;
    }

    function reset() {
        const m = Math.ceil(uniforms.num_particles_log / 2);
        const n = Math.ceil(uniforms.num_particles_log - m);
        const H = 1 << m;
        const W = 1 << n;

        nca_grid = glsl({
            seed: Math.random() * 213.512, ...uniforms, ...modelA, FP: `
        vec2 uniform_seed(vec3 u) {
            return (u.xy - 0.5) * 2.0;
        }

        vec2 gaussian_seed(vec3 u) {
            vec2 q = clamp(u.xy, 1e-7, 1.0 - 1e-7);
            float r = sqrt(-2.0 * log(q.x));
            float theta = 2.0 * PI * q.y;
            return r * vec2(cos(theta), sin(theta));
        }

        vec2 circular_seed(vec3 u) {
            float r = sqrt(u.x);
            float theta = 2.0 * PI * u.y;
            return r * vec2(cos(theta), sin(theta));
        }
        

        void fragment() 
        {
            FOut = FOut1 = FOut2 = FOut3 = vec4(0);
            // vec2 pos = circular_seed(hash(ivec3(I, seed))) * sigma * eps / eps0;
            vec2 pos;
            if (seed_mode) {
                pos = circular_seed(hash(ivec3(I, seed))) * sigma * eps / eps0;
            } else {
                pos = uniform_seed(hash(ivec3(I, seed))) * sigma * eps / eps0;
            }
            float particle_idx = float(I.x + I.y * ViewSize.x) + 0.5;
            float model_idx = 0.0;
            // if (I.y < 64) {
            //     pos += vec2(0.5, 0.0);
            //     model_idx = 0.0;
            // } else {
            //     pos += vec2(-0.5, 0.0);
            //     model_idx = 1.0;
            // }
            FOut4 = vec4(pos, particle_idx, model_idx);
        }
        
    `
        }, { size: [H, W], layern: C4 + 1, format: 'rgba32f', story: 2, tag: 'grid' });
        let sort_steps = nca_grid.size[0] * nca_grid.size[1];
        sort_steps = 4 * Math.log2(sort_steps) ** 2;
        for (let i = 0; i < sort_steps; ++i) {
            sort_index();
        }
        update_index();
    }

    function brush(x0, y0, x1, y1, brush_mode) {
        if (brush_mode == 1) {
            glsl({
                x0, y0, x1, y1, ...uniforms, seed: Math.random() * 4123, FP: `
            FOut = Src(I,0); FOut1 = Src(I,1); FOut2 = Src(I,2); FOut3 = Src(I,3); FOut4 = Src(I,4);
            vec2 x = Src(I,4).xy;
            // Account for view center/scale: mouse in world coords
            vec2 p0 = vec2(x0, y0) * viewR + viewC;
            vec2 p1 = vec2(x1, y1) * viewR + viewC;
            vec2 mouse_path = p1 - p0;
            float path_length = length(mouse_path);
            if (path_length > 1e-3) {
                vec2 n = normalize(vec2(-mouse_path.y, mouse_path.x));
                vec2 r = x - p0;
                float side = cross2d(mouse_path, r);
                float distance_to_path = abs(dot(n, r));
                bool cut = distance_to_path < brush_size * 0.04;
                // Check to see if the projection of x onto mouse_path is within the segment
                float proj = dot(mouse_path, r) / path_length;
                cut = cut && proj >= 0.0 && proj <= path_length;

                if (cut) {
                    float wiggle =  hash(ivec3(I, seed)).x;
                    x += n * brush_size * 0.04 * wiggle * sign(side);
                }
            }
            FOut4.xy = x;
        `
            }, nca_grid);

        } else if (brush_mode == 0) {
            glsl({
                ...uniforms, x_pos: x1, y_pos: y1, FP: `
            FOut = Src(I,0); FOut1 = Src(I,1); FOut2 = Src(I,2); FOut3 = Src(I,3); FOut4 = Src(I,4);
            // Click position in world coordinates
            vec2 click_pos = vec2(x_pos, y_pos) * viewR + viewC;
            vec2 pos = Src(I,4).xy;
            float dist = length(pos - click_pos);
            if (dist < brush_size * 0.08) {
                FOut = FOut1 = FOut2 = FOut3 = vec4(0.0);
            }
        `
            }, nca_grid);
        } else if (brush_mode == 2) {
            // Pull brush: attract particles toward click_pos with noise and falloff
            glsl({
                ...uniforms, x_pos: x1, y_pos: y1, seed: Math.random() * 4123, FP: `
            FOut = Src(I,0); FOut1 = Src(I,1); FOut2 = Src(I,2); FOut3 = Src(I,3); FOut4 = Src(I,4);
            // Click position in world coordinates
            vec2 click_pos = vec2(x_pos, y_pos) * viewR + viewC;
            vec2 pos = Src(I,4).xy;
            vec2 dir = click_pos - pos;
            float dist = length(dir);
            if (dist > 0.0) {
                vec2 ndir = dir / dist;
                float falloff = exp(-(dist / brush_size) * 30.0); // stronger near the click
                float strength = 0.05 * falloff;    // small step to avoid collapse
                // Add directional jitter perpendicular and along direction
                vec2 rnd = hash(ivec3(I, seed)).yz * 2.0 - 1.0;
                vec2 jitter = (vec2(-ndir.y, ndir.x) * rnd.x + ndir * rnd.y) * 0.2 * falloff;
                pos += ndir * strength + jitter * 0.0;
                FOut4.xy = pos;
            }
        `
            }, nca_grid);
        } else if (brush_mode == 3) {
            // Set index brush: set model index (stored in FOut4.z) to 1 within radius
            glsl({
                ...uniforms, x_pos: x1, y_pos: y1, FP: `
                FOut = Src(I,0); FOut1 = Src(I,1); FOut2 = Src(I,2); FOut3 = Src(I,3); FOut4 = Src(I,4);
                vec2 click_pos = vec2(x_pos, y_pos) * viewR + viewC;
                vec2 pos = Src(I,4).xy;
                float dist = length(pos - click_pos);
                if (dist < 0.05) {
                    // FOut4.w = min(FOut4.w + 0.01, 1.0);
                    FOut4.w = 1.0;
                }
            `
            }, nca_grid);
        }
    }

    // Adapted from Large Lenia Implementation in Swissgl
    function sort_index() {
        glsl({
            rc: sort_phase & 1, eo: (sort_phase >> 1) & 1, FP: `
    uniform int rc, eo;
    void fragment() {
        ivec2 I = ivec2(gl_FragCoord.xy);
        int i0 = (rc==1)?I.x:I.y;
        int i1 = i0 + ((i0+eo)&1)*2-1;
        ivec2 I1 = (rc==1)?ivec2(i1, I.y):ivec2(I.x, i1);
        I1 = clamp(I1, ivec2(0), ViewSize-1);
        vec4 v0=Src(I, 4), v1=Src(I1, 4);
        bool less = (rc==1) ? v0.x<v1.x : v0.y<v1.y;
        if (i0 < i1 == less) {
        FOut = Src(I, 0);
        FOut1 = Src(I, 1);
        FOut2 = Src(I, 2);
        FOut3 = Src(I, 3);
        FOut4 = v0;
        } else {
        FOut = Src(I1, 0);
        FOut1 = Src(I1, 1);
        FOut2 = Src(I1, 2);
        FOut3 = Src(I1, 3);
        FOut4 = v1;
        }
    }`}, nca_grid);
        sort_phase = (sort_phase + 1) % 4;
    }

    function update_index() {
        for (let i = 0; i < 1; ++i) sort_index();
        bbox = glsl({
            state: nca_grid[0], FP: `
        const int C4 = ${C4};
        FOut = vec4(1000, 1000, -1000, -1000);
        int D = state_size()[0]/ViewSize[0];
        ivec2 base = I * D;
        FOR2(i, 0, ivec2(D)) {
            vec2 p = state(base+i, C4).xy;
            FOut.xy = min(FOut.xy, p);
            FOut.zw = max(FOut.zw, p);
        }`}, { size: nca_grid[0].size, scale: 1 / 4, format: 'rgba32f', tag: 'bbox' });

        neighborhood = glsl({
            bbox, ...uniforms, FP: `
        float r = eps * 1.1;
        vec4 query = bbox(I)+vec4(-r,-r,r,r);
        FOut = vec4(I,I);
        FOR2(i, 0, ViewSize) {
            if (box_intersects(bbox(i), query)) {
                vec2 fi = vec2(i);
                FOut.xy = min(FOut.xy, fi);
                FOut.zw = max(FOut.zw, fi);
            }
        }`}, { size: bbox.size, format: 'rgba32f', tag: 'neighborhood' });

    }



    function step_fast() {
        // Use the hashgrid to avoid n^2 complexity.
        inv_rho = glsl({
            state: nca_grid[0], neighborhood, bbox,
            ...uniforms, ...modelA, FP: `
            const int C4 = ${C4};
            vec2 p_i = state(I, C4).xy;
            float r = eps * 1.1;
            vec4 query_box = vec4(p_i - r, p_i + r);
            int D = ViewSize.x/neighborhood_size().x;
            ivec4 nbh = ivec4(neighborhood(I/D));
            float rho_i = 0.0;
            float count = 0.0;
            FOR2(k, nbh.xy, nbh.zw + 1) {
                if (!box_intersects(bbox(k), query_box)) continue;
                FOR2(d, 0, ivec2(D)) {
                    vec2 p_j = state(d + k * D, C4).xy;
                    float w_ij = smoothing_kernel(p_j - p_i, eps);
                    rho_i += w_ij;
                    if (w_ij > 0.0) count += 1.0;
                }
            }
            rho_i = rho_i * smoothing_coef;
            FOut = vec4(1.0 / rho_i, count, 0.0, 0.0);
        `}, { size: nca_grid[0].size, layern: 1, format: 'rgba32f', tag: 'inv_rho' });

        glsl({
            inv_rho: inv_rho, ...modelA,
            ...uniforms, seed: Math.random() * 26321,
            neighborhood, bbox, FP: `
            const int C4 = ${C4};
            // Perception arrays: scalar [s, blur_s] and vectors [grad_s(C), grad_rho(1)]
            vec4 s_scalar[C4*2];
            vec2 v_in[C4*4 + 1];
            mat2 M = mat2(0.0);
            
            void fragment() {
                vec4 state_i[C4];
                for (int c=0; c<C4; ++c) state_i[c] = Src(I,c);

                FOut = state_i[0]; FOut1 = state_i[1]; FOut2 = state_i[2]; FOut3 = state_i[3]; FOut4 = Src(I,C4);
                if (hash(ivec3(I,seed)).x>0.5) return;

                for (int c=0; c<C4; ++c) { s_scalar[c] = state_i[c]; s_scalar[C4+c] = vec4(0.0); }
                for (int i=0; i<C4*4+1; ++i) v_in[i] = vec2(0.0);

                float coef = eps / eps0;
                vec2 p_i = Src(I,C4).xy;
                float r = eps * 1.1;
                vec4 query_box = vec4(p_i - r, p_i + r);
                int D = ViewSize.x/neighborhood_size().x;
                ivec4 nbh = ivec4(neighborhood(I/D));
                int N = ViewSize.x * ViewSize.y;

                FOR2(k, nbh.xy, nbh.zw + 1) {
                    if (!box_intersects(bbox(k), query_box)) continue;
                    FOR2(d, 0, ivec2(D)) {
                        ivec2 I_j = d + k * D;
                        float inv_rho_j = inv_rho(I_j, 0).x;
                        vec2 p_j = Src(I_j,C4).xy;
                        vec2 r_ij = p_j - p_i;
                        float w_ij = smoothing_kernel(r_ij, eps);
                        if (w_ij == 0.0) continue;
                        vec2 g_ij = gradient_kernel(r_ij, eps);
                        M += mat2(r_ij.x * g_ij.x, r_ij.x * g_ij.y,
                                  r_ij.y * g_ij.x, r_ij.y * g_ij.y) * inv_rho_j;
                        v_in[C4*4] += g_ij;

                        for (int chn=0; chn<C4; ++chn) {
                            vec4 s_j = Src(I_j, chn);
                            s_scalar[C4 + chn] += s_j * w_ij * inv_rho_j;
                            vec4 ds = (s_j - state_i[chn]) * inv_rho_j;
                            int base = chn * 4;
                            v_in[base] += ds.x * g_ij;
                            v_in[base+1] += ds.y * g_ij;
                            v_in[base+2] += ds.z * g_ij;
                            v_in[base+3] += ds.w * g_ij;
                        }
                    }
                }

                M = M * gradient_coef;
                float det = M[0][0]*M[1][1]-M[0][1]*M[1][0];
                if (abs(det)>1e-3) {
                    mat2 M_inv = mat2(M[1][1], -M[0][1], -M[1][0], M[0][0]) / det;
                    for (int i=0; i<C4*4; ++i) v_in[i] = M_inv * v_in[i];
                }

                for (int c=0; c<C4; ++c) s_scalar[C4+c] *= smoothing_coef;
                for (int i=0; i<C4*4; ++i) v_in[i] = log_normalize(v_in[i] * gradient_coef * coef);
                v_in[C4*4] = log_normalize(v_in[C4*4] * gradient_coef * coef * coef * coef / float(N));

                vec2 v_hidden[K_HIDDEN];
                for (int kk=0; kk<K_HIDDEN; ++kk) {
                    v_hidden[kk] = vec2(0.0);
                    for (int i=0; i<K_IN; ++i) {
                        v_hidden[kk] += v_in[i] * WhA(ivec2(kk, i)).x;
                    }
                }

                int n_dots = K_HIDDEN*(K_HIDDEN+1)/2;
                int n_dot4 = (n_dots + 3) / 4;
                float dots[K_HIDDEN*(K_HIDDEN+1)/2];
                int di = 0;
                for (int a=0; a<K_HIDDEN; ++a)
                    for (int b=a; b<K_HIDDEN; ++b)
                        dots[di++] = dot(v_hidden[a], v_hidden[b]);

                float mlp_out[MLP_OUT];
                for (int o=0; o<MLP_OUT; ++o) mlp_out[o] = b2A(ivec2(0, o)).x;

                for (int h=0; h<MLP_HIDDEN; ++h) {
                    float y = b1A(ivec2(0, h)).x;
                    for (int i=0; i<C4*2; ++i) y += dot(s_scalar[i], w1A(ivec2(i, h)));
                    for (int i=0; i<n_dot4; ++i) {
                        vec4 dv = vec4(0.0);
                        for (int j=0; j<4; ++j) {
                            int idx=i*4+j;
                            if (idx<n_dots) dv[j]=dots[idx];
                        }
                        y += dot(dv, w1A(ivec2(C4*2+i, h)));
                    }
                    if (y <= 0.0) continue;
                    int hg = h/4;
                    int hc = h - hg*4;
                    for (int o=0; o<MLP_OUT; ++o)
                        mlp_out[o] += y * w2A(ivec2(hg, o))[hc];
                }

                vec4 ds[C4];
                for (int c=0; c<C4; ++c)
                    ds[c] = vec4(mlp_out[c*4], mlp_out[c*4+1], mlp_out[c*4+2], mlp_out[c*4+3]);

                if (state_noise > 0.0) {
                    ds[0] += (hash(ivec4(I, 0, seed)) - 0.5) * state_noise;
                    ds[1] += (hash(ivec4(I, 1, seed)) - 0.5) * state_noise;
                    ds[2] += (hash(ivec4(I, 2, seed)) - 0.5) * state_noise;
                    ds[3] += (hash(ivec4(I, 3, seed)) - 0.5) * state_noise;
                }

                vec2 dx = vec2(0.0);
                for (int kk=0; kk<K_HIDDEN; ++kk) {
                    float g = max(mlp_out[CHN + kk], 0.0);
                    dx += v_hidden[kk] * g * WoA(ivec2(0, kk)).x;
                }

                FOut = state_i[0] + dt * ds[0];
                FOut1 = state_i[1] + dt * ds[1];
                FOut2 = state_i[2] + dt * ds[2];
                FOut3 = state_i[3] + dt * ds[3];
                FOut4 = Src(I,C4) + vec4(dt * alpha * eps * dx / (1.0 + length(dx)), 0.0, 0.0);
            }
        `
        }, nca_grid);
    }

    function step() {
        step_fast();
    }

    function frame(time) {
        GLSL.adjustCanvas();
        time /= 1000.0;
        if (params.runModel) {
            if (params.speed <= 0) {
                params.step_n = (frame_count % [1, 2, 4, 8][-params.speed]) == 0 ? 1 : 0;
                frame_count += 1;
            } else {
                params.step_n = [1, 2, 4, 8][params.speed];
            }
            for (let i = 0; i < params.step_n; ++i) {
                // step();
                step_count++;
                if (i % 1 == 0)
                    update_index();
                step_fast();
                // if (step_count % 1000 == 0) {
                //     console.log(`Step count: ${step_count}`);
                // }
            }

        }
        render();
        canvasRecorder.captureFrame();


        GLSL.animation_id = requestAnimationFrame(frame);
    }


    const growing_targets = [
        "lizard",
        "ghost",
        "lady_beetle",
        "octopus",
        "crab",
        "parrot",
        "monkey",
        "chicken",
        "frog_face",
        "fox_face",
        "dog_face",
        "hamster_face",
        "monkey_face",
        "elephant",
        "giraffe_face",
        "tropical_fish",
        "spouting_whale",
        "blowfish",
        "turtle",
        "beetle",
        "butterfly",
        "bug",
        "owl",
        "duck",
        "orangutan",
        "chipmunk",

        "shocked_face_with_exploding_head",
        "disguised_face",
        "smiling_face_with_open_mouth_and_smiling_eyes",
        "grinning_face_with_smiling_eyes",
        "smiling_face_with_heart_shaped_eyes",
        "smiling_face_with_sunglasses",
        "overheated_face",
        "thumbs_up_sign",
        "eye",
        "clown_face",
        "freezing_face",
        "grinning_face_with_one_large_and_one_small_eye",
        "eyes",
        "deciduous_tree",
        "mushroom",
        "rose",
        "blossom",
        "sun_with_face",
        "fire",
        "ringed_planet",
        "earth_globe_europe_africa",
        "white_sun_behind_cloud_with_rain",
        "banana",
        "red_apple",
        "cherries",
        "avocado",
        "aubergine",
        "lemon",
        "broccoli",
        "cucumber",
        "hot_pepper",
        "garlic",
        "carrot",
        "ear_of_maize",


        // "flamingo",
    ];

}
