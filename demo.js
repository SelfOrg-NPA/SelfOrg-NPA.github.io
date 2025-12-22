

export function createDemo(divId, demo_type = "growing") {

    const root = document.getElementById(divId);
    const $ = q => root.querySelector(q);
    const $$ = q => root.querySelectorAll(q);

    const canvas = $("#demo-canvas");
    canvas.width = 1024;
    canvas.height = 1024;

    const GLSL = SwissGL(canvas);
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
    let models, modelA, modelB;
    let nca_grid, neighborhood, bbox, inv_rho;
    let sort_phase = 0;
    let step_count = 0;
    let frame_count = 0;

    let eps0 = demo_type == "growing" ? 0.1 : 0.2;
    let sigma0 = demo_type == "growing" ? 0.2 : 1.0;


    const params = {
        modelA: demo_type == "growing" ? 'disguised_face' : 'clouds',
        modelB: demo_type == "growing" ? "ghost" : "bubbly_0101",
        runModel: true,
        step_n: 1,
        speed: -1,
    };
    const uniforms = {
        zoom: 0.0,
        eps: eps0,
        sigma: sigma0,
        seed_mode: demo_type == "growing" ? true : false,
        // sigma: 1.0,
        viewR: 1.25,
        viewC: [0.0, 0.0],
        brush_enabled: true,
        brush_mode: 1,
        brush_size: 1.0,
        particle_radius: 0.04,
        num_particles_log: 12, // 2^12 = 4096
        num_particles: 4096,
        plot_tracer: false,
        bg_color: 0.0,
        state_noise: 0.0,
        position_noise: 0.0,
    }






    uniforms.smoothing_coef = 4.0 / (Math.PI * Math.pow(uniforms.eps, 2));
    uniforms.gradient_coef = 10.0 / (Math.PI * Math.pow(uniforms.eps, 3));


    let currentTarget = null;
    let last_cursor_style = 'default';
    let prevPos = [0, 0];


    function init_event_listeners() {
        document.addEventListener('keydown', e => {
            if (e.key === 'r') {
                reset();
            }
            if (e.key === "Shift") {
                if (canvas.style.cursor != "grabbing") {
                    canvas.style.cursor = "grab";
                    last_cursor_style = canvas.style.cursor;
                }
            }
        });
        document.addEventListener("keyup", e => {
            if (e.key === 'Shift') {
                canvas.style.cursor = "default";
                last_cursor_style = canvas.style.cursor;
            }
        });

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

        $('#trace_particles').addEventListener('change', e => {
            uniforms.plot_tracer = e.target.checked;
            uniforms.particle_radius = e.target.checked ? 0.02 : 0.04;
            uniforms.particle_radius *= Math.sqrt(4096 / uniforms.num_particles);
            $('#particle_radius').value = uniforms.particle_radius;
            $('#particleRadiusLabel').innerText = uniforms.particle_radius.toFixed(3);

        });

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
            reset();
            uniforms.particle_radius = 0.04 * (uniforms.eps / eps0);
            $('#particleRadiusLabel').innerText = uniforms.particle_radius.toFixed(3);
            $('#particle_radius').value = uniforms.particle_radius;
        };

        if (demo_type == "texture") {
            $('#epsilon').max = 0.4;
            $('#epsilon').value = 0.2;
            $('#epsilonLabel').innerText = "0.2";
        } else {
            $('#epsilon').max = 0.2;
            $('#epsilon').value = 0.1;
            $('#epsilonLabel').innerText = "0.1";
        }

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
            let base_radius = uniforms.plot_tracer ? 0.02 : 0.04;
            uniforms.particle_radius = base_radius * Math.sqrt(4096 / uniforms.num_particles);
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
        const response = await fetch(demo_type + '_demo/models.json');
        models = await response.json();
        let gridBox = $('#target-shelf');
        gridBox.innerHTML = '';
        const targets = demo_type == "growing" ? growing_targets : texture_targets;
        for (const name of targets) {
            if (!(name in models)) continue;
            for (const k in models[name]) {
                if (k == 'alpha' || k == "eps0" || k == "N0") continue
                const src = models[name][k];
                src.data = new Float32Array(
                    Uint8Array.from(atob(src.data64), c => c.charCodeAt(0)).buffer);
                delete src.data64;
            }


            let media_path = demo_type + "_demo/target_images/" + name + ".png"

            const target_img = document.createElement('div');
            target_img.style.background = "url('" + media_path + "')";
            target_img.style.backgroundSize = "100%100%";
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
                modelA = load_model(name, "A");
                reset();
            };

            if (name == params.modelA) {
                target_img.style.borderColor = "rgb(245 140 44)";
                gridBox.prepend(target_img);
                currentTarget = target_img;
            } else {
                gridBox.insertBefore(target_img, gridBox.lastElementChild);
            }

        }
        // gui.add(params, 'modelA', Object.keys(models)).onChange(name => {
        //     modelA = load_model(name, "A");
        //     reset();
        // });
        // gui.add(params, 'modelB', Object.keys(models)).onChange(name => {
        //     modelB = load_model(name, "B");
        // });
        modelA = load_model(params.modelA, "A");
        modelB = load_model(params.modelB, "B");
        reset();
        frame();
    }

    init();

    function load_model(name, tag = "A") {
        const src = models[name];
        // init NCA
        const [ch, ci] = src['w1.weight'].shape, co = src['w2.weight.T'].shape[1];
        // console.assert(co == CHN);
        const nca = {
            ["w1" + tag]: glsl({}, {
                size: [ci / 4, ch], format: 'rgba32f',
                data: src['w1.weight'].data, tag: 'w1' + tag
            }),
            ["b1" + tag]: glsl({}, {
                size: [1, ch], format: 'r32f',
                data: src['w1.bias'].data, tag: 'b1' + tag
            }),
            ["w2t" + tag]: glsl({}, {
                size: [co / 4, ch], format: 'rgba32f',
                data: src['w2.weight.T'].data, tag: 'w2t' + tag
            }),
        };
        if (tag == "A") {
            nca['Inc'] = `
            const float alpha = ${src['alpha'].toFixed(4)};
            const float eps0 = ${src['eps0'].toFixed(4)};
            const float N0 = ${src['N0'].toFixed(4)};

            float smoothing_kernel(vec2 r, float eps) {
                float d2 = dot(r, r);
                // float q = eps * eps - d2;
                float q = 1.0 - d2 / (eps * eps);
                if (q > 0.0) return q * q * q;                
                return 0.0;
            }

            vec2 gradient_kernel(vec2 r, float eps) {
                // float d = length(r);
                // if (d == 0.0 || d >= eps) return vec2(0.0);
                // return 3.0 * (eps - d) * (eps - d) * normalize(r);
                float d = length(r) / eps;
                if (d == 0.0 || d >= 1.0) return vec2(0.0);
                return 3.0 * (1.0 - d) * (1.0 - d) * normalize(r);
                
            }
        `
        }
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
        // use the hashgrid to avoid n^2 complexity
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
            inv_rho: inv_rho, ...modelA, ...modelB,
            ...uniforms, seed: Math.random() * 26321,
            neighborhood, bbox, FP: `
        const int C4 = ${C4};
        vec4 perc[C4*4 + 1], upd[C4 + 1];
        mat2 M = mat2(0.0); // Moment matrix for gradient correction
        
        void fragment() {
            // return;

            for (int chn=0; chn<C4; ++chn) perc[chn] = upd[chn] = Src(I,chn);

            FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3]; FOut4 = Src(I,C4);
            if (hash(ivec3(I,seed)).x>0.5) return;

            upd[C4] = vec4(0.0); // position update and particle/model idx
            for (int i=C4; i<C4*4 + 1; ++i) perc[i] = vec4(0.0);

            float coef = eps / eps0; // eps / default_eps
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
                    perc[C4*4].xy += g_ij; // density gradient

                    for (int chn=0; chn<C4; ++chn) {
                        vec4 s_j_c = Src(I_j, chn);
                        perc[C4 + chn] += s_j_c * w_ij * inv_rho_j; // smoothed state
                        vec4 gs_x = (s_j_c - perc[chn]) * g_ij.x * inv_rho_j;
                        vec4 gs_y = (s_j_c - perc[chn]) * g_ij.y * inv_rho_j;
                        perc[C4*2 + chn * 2] += vec4(gs_x.x, gs_y.x, gs_x.y, gs_y.y); // gradient x
                        perc[C4*2 + chn * 2 + 1] += vec4(gs_x.z, gs_y.z, gs_x.w, gs_y.w); // gradient y
                        
                        
                    }
                }
            }

            mat2 M_inv;
            M = M * gradient_coef;
            float det = M[0][0]*M[1][1]-M[0][1]*M[1][0];
            if (abs(det)>1e-3) {
                M_inv = mat2( M[1][1], -M[0][1],
                                -M[1][0],  M[0][0]) / det;
                for (int chn=0; chn<C4; ++chn) {
                    perc[C4*2 + chn * 2].xy = perc[C4*2 + chn * 2].xy * M_inv;
                    perc[C4*2 + chn * 2].zw = perc[C4*2 + chn * 2].zw * M_inv;
                    perc[C4*2 + chn * 2 + 1].xy = perc[C4*2 + chn * 2 + 1].xy * M_inv;
                    perc[C4*2 + chn * 2 + 1].zw = perc[C4*2 + chn * 2 + 1].zw * M_inv;
                }
            }

            for (int chn=0; chn<C4; ++chn) {
                perc[C4 + chn] = perc[C4 + chn] * smoothing_coef;
                perc[C4*2 + chn * 2].xy = log_normalize(perc[C4*2 + chn * 2].xy * gradient_coef * coef);
                perc[C4*2 + chn * 2].zw = log_normalize(perc[C4*2 + chn * 2].zw * gradient_coef * coef);
                perc[C4*2 + chn * 2 + 1].xy = log_normalize(perc[C4*2 + chn * 2 + 1].xy * gradient_coef * coef);
                perc[C4*2 + chn * 2 + 1].zw = log_normalize(perc[C4*2 + chn * 2 + 1].zw * gradient_coef * coef);
            }
            perc[C4*4].xy = log_normalize(perc[C4*4].xy * gradient_coef * coef * coef * coef * 1.0 / float(N));
            
            int ci = w1A_size().x, ch = w1A_size().y;
            bool model_type = floor(Src(I,C4).w + 0.5) == 0.0;
            // float model_weight = 1.0 - FOut4.w;
            for (int h=0; h<ch; ++h) {
                float y = model_type ? b1A(ivec2(0, h)).x : b1B(ivec2(0, h)).x;
                for (int i=0; i<ci; ++i) {y += model_type ? dot(perc[i], w1A(ivec2(i, h))) : dot(perc[i], w1B(ivec2(i, h)));}
                if (y<=0.0) continue;
                for (int i=0; i<C4 + 1; ++i) {upd[i] += model_type ? y*w2tA(ivec2(i, h)) : y*w2tB(ivec2(i, h));}
                // float yA = b1A(ivec2(0, h)).x;
                // float yB = b1B(ivec2(0, h)).x;
                // float y = model_weight * yA + (1.0 - model_weight) * yB;
                // for (int i=0; i<ci; ++i) {
                //     vec4 p = perc[i];
                //     vec4 wA = w1A(ivec2(i, h));
                //     vec4 wB = w1B(ivec2(i, h));
                //     y += model_weight * dot(p, wA) + (1.0 - model_weight) * dot(p, wB);
                // }
                // if (y<=0.0) continue;
                // for (int i=0; i<C4 + 1; ++i) {
                //     vec4 wA = w2tA(ivec2(i, h));
                //     vec4 wB = w2tB(ivec2(i, h));
                //     upd[i] += (model_weight * wA + (1.0 - model_weight) * wB) * y;
                // }
            }
            
            if (state_noise > 0.0) {
                upd[0] += (hash(ivec4(I, 0, seed)) - 0.5) * state_noise;
                upd[1] += (hash(ivec4(I, 1, seed)) - 0.5) * state_noise;
                upd[2] += (hash(ivec4(I, 2, seed)) - 0.5) * state_noise;
                upd[3] += (hash(ivec4(I, 3, seed)) - 0.5) * state_noise;
            }


            FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3];
            // FOut = clamp(upd[0], vec4(-1.0), vec4(1.0)); 
            // FOut1 = clamp(upd[1], vec4(-1.0), vec4(1.0));
            // FOut2 = clamp(upd[2], vec4(-1.0), vec4(1.0));
            // FOut3 = clamp(upd[3], vec4(-1.0), vec4(1.0));
            vec2 dp = upd[C4].xy;
            
            upd[C4].xy = alpha * eps * dp / (1.0 + length(dp));

            if (position_noise > 0.0) {
                upd[C4].xy += (hash(ivec3(I,seed + 12371.0)).yz - 0.5) * position_noise;
            }
            // vec2 pos_change = hash(ivec3(I, seed + 12371.0)).yz * 0.02 - 0.01;
            // FOut4 = Src(I,4);// + vec4(pos_change, 0.0, 0.0); // keep position unchanged
            FOut4 += upd[C4];
        }
    `
        }, nca_grid);

    }



    function step() {
        inv_rho = glsl({
            state: nca_grid[0], ...uniforms, ...modelA, FP: `
        const int C4 = ${C4};
        int N = state_size().x * state_size().y;
        vec2 p_i = state(I, C4).xy;
        float rho_i = 0.0;
        float count = 0.0;
        for (int j = 0; j < N; ++j) {
            ivec2 I_j = ivec2(j % ViewSize.x, j / ViewSize.x);
            vec2 p_j = state(I_j, C4).xy;
            float w_ij = smoothing_kernel(p_j - p_i, eps);
            rho_i += w_ij;
            if (w_ij > 0.0) count += 1.0;
        }
        rho_i = rho_i * smoothing_coef;
        FOut = vec4(1.0 / rho_i, count, 0.0, 0.0);
    `}, { size: nca_grid[0].size, layern: 1, format: 'rgba32f', tag: 'inv_rho' });



        glsl({
            inv_rho: inv_rho, ...modelA, ...uniforms, seed: Math.random() * 5614.765, FP: `
        const int C4 = ${C4};
        vec4 perc[C4*4 + 1], upd[C4 + 1];
        mat2 M = mat2(0.0); // Moment matrix for gradient correction
        
        
        void fragment() {
            // return;

            for (int chn=0; chn<C4; ++chn) perc[chn] = upd[chn] = Src(I,chn);
            FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3]; FOut4 = Src(I,C4);
            if (hash(ivec3(I,seed)).x >= 0.5) return;
            upd[C4] = vec4(0.0);
            for (int i=C4; i<C4*4 + 1; ++i) perc[i] = vec4(0.0);

            float coef = eps / eps0; // eps / default_eps
            vec2 p_i = Src(I,C4).xy;
            int N = ViewSize.x * ViewSize.y;
            for (int j = 0; j < N; ++j) {
                ivec2 I_j = ivec2(j % ViewSize.x, j / ViewSize.x);
                float inv_rho_j = inv_rho(I_j, 0).x;
                vec2 p_j = Src(I_j,C4).xy;
                vec2 r_ij = p_j - p_i;
                float w_ij = smoothing_kernel(r_ij, eps);
                if (w_ij == 0.0) continue;
                vec2 g_ij = gradient_kernel(r_ij, eps);
                M += mat2(r_ij.x * g_ij.x, r_ij.y * g_ij.x,
                    r_ij.x * g_ij.y, r_ij.y * g_ij.y) * inv_rho_j;
                perc[C4*4].xy += g_ij; // density gradient

                for (int chn=0; chn<C4; ++chn) {
                    vec4 s_j_c = Src(I_j, chn);
                    perc[C4 + chn] += s_j_c * w_ij * inv_rho_j; // smoothed state
                    vec4 gs_x = (s_j_c - perc[chn]) * g_ij.x * inv_rho_j;
                    vec4 gs_y = (s_j_c - perc[chn]) * g_ij.y * inv_rho_j;
                    perc[C4*2 + chn * 2] += vec4(gs_x.x, gs_y.x, gs_x.y, gs_y.y);
                    perc[C4*2 + chn * 2 + 1] += vec4(gs_x.z, gs_y.z, gs_x.w, gs_y.w);
                }

            }
            M = M * gradient_coef;
            float det = M[0][0]*M[1][1]-M[0][1]*M[1][0];
            if (abs(det)>1e-3) {
                mat2 M_inv = mat2( M[1][1], -M[1][0],
                                -M[0][1],  M[0][0]) / det;
                for (int chn=0; chn<C4; ++chn) {
                    perc[C4*2 + chn * 2].xy = perc[C4*2 + chn * 2].xy * M_inv;
                    perc[C4*2 + chn * 2].zw = perc[C4*2 + chn * 2].zw * M_inv;
                    perc[C4*2 + chn * 2 + 1].xy = perc[C4*2 + chn * 2 + 1].xy * M_inv;
                    perc[C4*2 + chn * 2 + 1].zw = perc[C4*2 + chn * 2 + 1].zw * M_inv;
                }
            }

            for (int chn=0; chn<C4; ++chn) {
                perc[C4 + chn] = perc[C4 + chn] * smoothing_coef;
                perc[C4*2 + chn * 2].xy = log_normalize(perc[C4*2 + chn * 2].xy * gradient_coef * coef);
                perc[C4*2 + chn * 2].zw = log_normalize(perc[C4*2 + chn * 2].zw * gradient_coef * coef);
                perc[C4*2 + chn * 2 + 1].xy = log_normalize(perc[C4*2 + chn * 2 + 1].xy * gradient_coef * coef);
                perc[C4*2 + chn * 2 + 1].zw = log_normalize(perc[C4*2 + chn * 2 + 1].zw * gradient_coef * coef);
            }
            perc[C4*4].xy = log_normalize(perc[C4*4].xy * gradient_coef * coef * coef * coef / float(N));
            
            int ci = w1A_size().x, ch = w1A_size().y;
            int model_idx = int(Src(I,C4).w);
            for (int h=0; h<ch; ++h) {
                float y = b1A(ivec2(0, h)).x;
                for (int i=0; i<ci; ++i) {y += dot(perc[i], w1A(ivec2(i, h)));}
                if (y<=0.0) continue;
                for (int i=0; i<C4 + 1; ++i) {upd[i] += y*w2t(ivec2(i, h));}
            }
            FOut = upd[0]; FOut1 = upd[1]; FOut2 = upd[2]; FOut3 = upd[3];
            // FOut = clamp(upd[0], vec4(-1.0), vec4(1.0)); 
            // FOut1 = clamp(upd[1], vec4(-1.0), vec4(1.0));
            // FOut2 = clamp(upd[2], vec4(-1.0), vec4(1.0));
            // FOut3 = clamp(upd[3], vec4(-1.0), vec4(1.0));
            vec2 dp = upd[C4].xy;
            
            upd[C4] = alpha * eps * dp / (1.0 + length(dp));
            // vec2 pos_change = hash(ivec3(I, seed + 12371.0)).yz * 0.02 - 0.01;
            // FOut4 = Src(I,4);// + vec4(pos_change, 0.0, 0.0); // keep position unchanged
            FOut4 += upd[C4];
        }
    `
        }, nca_grid);

    }

    function frame(time) {
        GLSL.adjustCanvas();
        time /= 1000.0;
        if (params.runModel) {
            let step_n;
            if (params.speed <= 0) {
                step_n = (frame_count % [1, 2, 4, 8][-params.speed]) == 0 ? 1 : 0;
                frame_count += 1;
            } else {
                step_n = [1, 2, 4, 8][params.speed];
            }
            for (let i = 0; i < step_n; ++i) {
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
        const bg_color = uniforms.bg_color;
        glsl({
            state: nca_grid[0], Grid: nca_grid[0].size, ...uniforms,
            Clear: [bg_color, bg_color, bg_color, 0.0],
            inv_rho, neighborhood, Aspect: 'mean', ...uniforms,
            Blend: 'd*(1-sa)+s',
            // Blend:'d + s', 
            VP: `
            varying vec3 col = vec3(state(ID.xy, 3).yzw) + 0.5;
            col = max(col, vec3(0.0));
            col = min(col, vec3(1.0));
            
            float radius = particle_radius;
            if (plot_tracer)
                if (mod(floor(state(ID.xy, 4).z), 256.0) == 0.0)
                    radius = particle_radius * 6.0;
            vec2 pos = state(ID.xy, 4).xy;
            VPos = vec4(((pos - viewC) + XY * radius) / viewR, 0.0, 1.0);
        `,
            FP: `
            float intensity = exp(-dot(XY, XY) * 10.0);
            FOut = vec4(col * intensity, intensity);
            
        `})


        requestAnimationFrame(frame);
    }


    const texture_targets = [
        "0",
        "bubbly_0101",
        "polka-dotted_0121",
        "clouds",
        "grid_0040",
        "stars",
        "hearts",
        "goo",
        "squares",
        "triangles",
        "slime",
        "droplets",
        "rain",
        "snow",
        "banded_0037",
        "tree",
        "worms",
        "mesh",
        "galaxy",
        "rings",
        "bars",
        "A",
        "E",
        "G",
        "K",
        "S",
        "X",
        "Z",
        "N",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        
    ];

    const growing_targets = [
        "banana",
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
        "deciduous_tree",
        "mushroom",
        "rose",
        "blossom",
        "sun_with_face",
        "fire",
        "ringed_planet",
        "earth_globe_europe_africa",
        "white_sun_behind_cloud_with_rain",
        
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

