/**
 * ============================================================
 *  501 宿舍 — 3D回忆碎片球体组件
 *  js/photo-sphere.js
 *  依赖: lib/three.min.js
 * ============================================================
 */
(function () {
  'use strict';

  /* ==================== 参数配置 ==================== */
  const S = {
    R: 3.2, N: 30, fragSize: 0.6,
    minZ: 2.2, maxZ: 7.5, defZ: 5.8, zSmooth: 0.12,
    damp: 0.958, autoSpd: 0.05,
    sensitivity: 0.0075,
    momentum: 0.72,
    entranceT: 1.5,                         // 更长的入场，更有仪式感
    // 粒子（星尘）
    P: { n: 180, size: 0.045, spdMin: 0.5, spdMax: 2.2, life: 1.6,
      cols: ['#F5D5A0','#E8C97A','#C9A86C','#A8C8E8','#8BB8D8','#FFF0DD',
             '#FFE8CC','#D4C080','#C0D8E8','#F0E0C0','#E8D8C0','#B8C8E0'] },
    // 背景星场
    stars: { count: 400, size: 0.018, opacity: 0.55 },
    // 辉光
    glow: { size: 8.0, opacity: 0.06, color: 0x8899cc },
  };

  /* ==================== 图片数组 ==================== */
  const POOL = [
    'images/member1.jpg','images/member2.jpg','images/member3.jpg',
    'images/member4.jpg','images/member5.jpg','images/member6.jpg',
    'images/cartoon1.jpg','images/cartoon2.jpg','images/cartoon3.jpg',
    'images/cartoon4.jpg','images/cartoon5.jpg','images/cartoon6.jpg',
    'images/gallery1.jpg','images/gallery2.jpg','images/gallery3.jpg',
    'images/gallery4.jpg','images/gallery5.jpg','images/gallery6.jpg',
    'images/gallery7.jpg','images/gallery8.jpg','images/gallery9.jpg',
    'images/gallery10.jpg','images/gallery11.jpg','images/gallery12.jpg',
    'images/gallery13.jpg','images/gallery14.jpg','images/gallery15.jpg',
    'images/gallery16.jpg','images/gallery17.jpg','images/gallery18.jpg',
    'images/gallery19.jpg','images/gallery20.jpg','images/gallery21.jpg',
    'images/gallery22.jpg','images/gallery23.jpg','images/gallery24.jpg',
    'images/gallery25.jpg','images/gallery26.jpg','images/gallery27.jpg',
    'images/gallery28.jpg','images/gallery29.jpg','images/gallery30.jpg',
    'images/gallery31.jpg','images/gallery32.jpg','images/gallery33.jpg',
    'images/gallery34.jpg','images/gallery35.jpg','images/gallery36.jpg',
    'images/gallery37.jpg','images/gallery38.jpg','images/gallery39.jpg',
    'images/gallery40.jpg','images/gallery41.jpg','images/gallery42.jpg',
    'images/gallery43.jpg','images/gallery44.jpg','images/gallery45.jpg',
    'images/gallery46.jpg','images/gallery47.jpg','images/gallery48.jpg',
    'images/gallery49.jpg','images/gallery50.jpg','images/gallery51.jpg',
    'images/gallery52.jpg','images/gallery53.jpg','images/gallery54.jpg',
    'images/gallery55.jpg','images/gallery56.jpg','images/gallery57.jpg',
    'images/gallery58.jpg','images/gallery59.jpg','images/gallery60.jpg',
  ];

  function pick(n) {
    var a = POOL.slice(), r = [];
    for (var i = 0; i < n && a.length > 0; i++) {
      var j = Math.floor(Math.random() * a.length);
      r.push(a[j]); a.splice(j, 1);
    }
    return r;
  }

  /* ==================== Three.js 变量 ==================== */
  var overlay, canvasCt, toast, hint, rotateBtn;
  var scene, camera, renderer, group, wire, stars, glowSprite;
  var sprites = [], sel = null;
  var ps, pd = [];
  var aid = 0, clock;
  var rvx = 0, rvy = 0;            // 惯性角速度（弧度/秒）
  var tZoom = S.defZ, cZoom = S.defZ;
  var th = 0, ph = 0.15;
  var eDone = true, eT0 = 0;

  /* ==================== 图片加载 ==================== */
  function imgToTex(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var max = 256, w = img.width, h = img.height;
          if (w > max || h > max) { var r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
          var c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          var t = new THREE.CanvasTexture(c);
          t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
          resolve({ ok: true, tex: t, url: url });
        } catch (e) {
          console.warn('纹理创建失败: ' + url, e);
          resolve({ ok: false, url: url });
        }
      };
      img.onerror = function () { console.warn('图片加载失败: ' + url); resolve({ ok: false, url: url }); };
      img.src = url;
    });
  }

  function fallbackTex(name) {
    var c = document.createElement('canvas'); c.width = 128; c.height = 128;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#2a2a3a'; ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(200,170,110,0.4)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, 112, 112);
    ctx.fillStyle = '#D4B87A'; ctx.font = 'bold 15px "Microsoft YaHei",sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('加载失败', 64, 52); ctx.fillText(name || '', 64, 78);
    var t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
  }

  function makeSprites() {
    sprites.forEach(function (s) {
      if (s.material) { if (s.material.map) s.material.map.dispose(); s.material.dispose(); }
      group.remove(s);
    });
    sprites = [];

    var urls = pick(S.N);
    var count = urls.length;
    var phi = Math.PI * (3 - Math.sqrt(5));

    console.log('加载 ' + count + ' 张图片...');

    for (var i = 0; i < count; i++) {
      var y = 1 - (i / Math.max(count - 1, 1)) * 2;
      var rad = Math.sqrt(1 - y * y);
      var theta = phi * i;
      var x = Math.cos(theta) * rad;
      var z = Math.sin(theta) * rad;

      var pTex = (function () {
        var c = document.createElement('canvas'); c.width = 64; c.height = 64;
        c.getContext('2d').fillStyle = '#3a3a4a'; c.getContext('2d').fillRect(0, 0, 64, 64);
        var t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
      })();

      var mat = new THREE.SpriteMaterial({
        map: pTex, color: 0xffffff, transparent: true,
        opacity: 1, depthWrite: true, depthTest: true,
      });
      var sprite = new THREE.Sprite(mat);
      sprite.position.set(x * S.R, y * S.R, z * S.R);
      sprite.scale.set(S.fragSize, S.fragSize, 1);
      sprite.userData = {
        bp: { x: x * S.R, y: y * S.R, z: z * S.R }, tOpacity: 1, idx: i, url: urls[i],
      };
      group.add(sprite);
      sprites.push(sprite);

      (function (sp, url) {
        imgToTex(url).then(function (r) {
          if (r.ok && r.tex) {
            if (sp.material && sp.material.map) sp.material.map.dispose();
            sp.material.map = r.tex; sp.material.needsUpdate = true;
          } else {
            var name = url.replace(/^images\//, '').replace(/\.(jpg|png|webp|jpeg)$/, '').substring(0, 20);
            if (sp.material && sp.material.map) sp.material.map.dispose();
            sp.material.map = fallbackTex(name); sp.material.needsUpdate = true;
          }
        });
      })(sprite, urls[i]);
    }
  }

  /* ==================== 粒子系统 ==================== */
  function initPS() {
    var n = S.P.n;
    var g = new THREE.BufferGeometry();
    var pa = new Float32Array(n * 3), ca = new Float32Array(n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    var cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
    var ctx = cv.getContext('2d');
    var gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.15, 'rgba(255,245,220,0.9)');
    gr.addColorStop(0.4, 'rgba(255,220,170,0.4)');
    gr.addColorStop(0.75, 'rgba(200,160,120,0.05)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 32, 32);
    ps = new THREE.Points(g, new THREE.PointsMaterial({
      size: S.P.size, map: new THREE.CanvasTexture(cv),
      vertexColors: true, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.8,
    }));
    ps.visible = false;
    scene.add(ps);
    pd = [];
    for (var i = 0; i < n; i++) pd.push({ o: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, maxL: 0, on: false });
  }

  function emit(wp) {
    if (!ps) return;
    var g = ps.geometry, pa = g.attributes.position.array, ca = g.attributes.color.array;
    for (var i = 0; i < pd.length; i++) {
      var d = pd[i]; d.o.copy(wp); d.life = 0; d.maxL = S.P.life + Math.random() * 0.4; d.on = true;
      var dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      var rad = wp.clone().normalize(); if (rad.length() < 0.01) rad.set(0, 0, 1);
      dir.add(rad).normalize();
      d.v.copy(dir).multiplyScalar(S.P.spdMin + Math.random() * (S.P.spdMax - S.P.spdMin));
      var hex = S.P.cols[Math.floor(Math.random() * S.P.cols.length)];
      ca[i * 3] = parseInt(hex.slice(1, 3), 16) / 255;
      ca[i * 3 + 1] = parseInt(hex.slice(3, 5), 16) / 255;
      ca[i * 3 + 2] = parseInt(hex.slice(5, 7), 16) / 255;
      pa[i * 3] = wp.x; pa[i * 3 + 1] = wp.y; pa[i * 3 + 2] = wp.z;
    }
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    ps.visible = true;
  }
  function clearP() { if (!ps) return; for (var i = 0; i < pd.length; i++) pd[i].on = false; ps.visible = false; }
  function upP(dt) {
    if (!ps || !ps.visible) return;
    var pa = ps.geometry.attributes.position.array, any = false;
    for (var i = 0; i < pd.length; i++) {
      var d = pd[i]; if (!d.on) continue;
      d.life += dt; if (d.life >= d.maxL) { d.on = false; continue; }
      any = true;
      pa[i * 3] = d.o.x + d.v.x * d.life;
      pa[i * 3 + 1] = d.o.y + d.v.y * d.life - 0.25 * d.life * d.life;
      pa[i * 3 + 2] = d.o.z + d.v.z * d.life;
    }
    pa.needsUpdate = true; if (!any) ps.visible = false;
  }

  /* ==================== 选中逻辑 ==================== */
  function selSprite(sp) {
    if (sel === sp) { desel(); return; }
    if (sel) { sel.userData.tOpacity = 1; if (sel.userData._p) sel.position.copy(sel.userData._p); if (sel.userData._s) sel.scale.copy(sel.userData._s); }
    sel = sp;
    sp.userData._p = sp.position.clone(); sp.userData._s = sp.scale.clone();
    sp.userData.tOpacity = 1;
    var wp = new THREE.Vector3(); sp.getWorldPosition(wp);
    sprites.forEach(function (s) { if (s !== sp) s.userData.tOpacity = 0.22; });
    emit(wp);
    if (rotateBtn) rotateBtn.classList.add('visible');
  }
  function desel() {
    if (sel) {
      if (sel.userData._p) sel.position.copy(sel.userData._p);
      if (sel.userData._s) sel.scale.copy(sel.userData._s);
      sel.userData.tOpacity = 1;
      sel.material.rotation = 0;
      sel = null;
    }
    sprites.forEach(function (s) { s.userData.tOpacity = 1; });
    clearP();
    if (rotateBtn) rotateBtn.classList.remove('visible');
  }

  function rotateSelected() {
    if (!sel) return;
    sel.material.rotation = (sel.material.rotation || 0) + Math.PI / 2;
  }

  function toast(msg) { if (!toast) return; toast.textContent = msg; toast.classList.add('show'); setTimeout(function () { if (toast) toast.classList.remove('show'); }, 3000); }

  /* ==================== 事件系统（Pointer Events） ==================== */
  var _down = false, _id = null;
  var _px = 0, _py = 0;
  var _dist = 0;
  var _lastTm = 0;
  var _lastDx = 0, _lastDy = 0;  // 最近一帧的位移（用于松手惯性）

  function ev() {
    var el = canvasCt;

    el.addEventListener('pointerdown', function (e) {
      if (_down) return;
      _down = true; _id = e.pointerId;
      _px = e.clientX; _py = e.clientY;
      _dist = 0; _lastTm = performance.now();
      _lastDx = 0; _lastDy = 0;
      rvx = 0; rvy = 0;  // 手指按住立即停惯
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', function (e) {
      if (!_down || e.pointerId !== _id) return;
      var dx = e.clientX - _px;
      var dy = e.clientY - _py;
      if (dx === 0 && dy === 0) return;
      _dist += Math.abs(dx) + Math.abs(dy);
      // 直接驱动旋转（零滤波，零延迟）
      th += dx * S.sensitivity;
      ph += dy * S.sensitivity;
      ph = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, ph));
      // 记录最近一帧位移（松手时转为惯性速度）
      _lastDx = dx; _lastDy = dy;
      _px = e.clientX; _py = e.clientY;
    });

    el.addEventListener('pointerup', function (e) {
      if (e.pointerId !== _id) return;
      _down = false; _id = null;
      el.releasePointerCapture(e.pointerId);
      // 瞬时速度 → 惯性角速度（弧度/秒）
      // 速度 = 最近一帧位移 / 帧时间，乘以动量系数
      var dt = Math.max(performance.now() - _lastTm, 1 / 120) / 1000; // 秒
      rvx = (_lastDx / dt) * S.sensitivity * S.momentum;
      rvy = (_lastDy / dt) * S.sensitivity * S.momentum;
      // 点击检测
      if (_dist < 8 && sprites.length > 0) {
        var rect = canvasCt.getBoundingClientRect();
        var mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        var my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        var rc = new THREE.Raycaster();
        rc.setFromCamera(new THREE.Vector2(mx, my), camera);
        var hits = rc.intersectObjects(sprites);
        if (hits.length > 0) selSprite(hits[0].object);
        else if (sel) desel();
      }
    });

    el.addEventListener('pointercancel', function () { _down = false; _id = null; });

    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      tZoom += e.deltaY * 0.005;
      tZoom = Math.max(S.minZ, Math.min(S.maxZ, tZoom));
    }, { passive: false });

    el.addEventListener('click', function (e) { /* 点击已在 pointerup 处理 */ });
  }

  function onResize() {
    if (!canvasCt || !camera || !renderer) return;
    var w = canvasCt.clientWidth, h = canvasCt.clientHeight;
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  /* ==================== 渲染循环 ==================== */
  function anim() {
    aid = requestAnimationFrame(anim);
    if (!scene || !camera || !group) return;
    var dt = Math.min(clock.getDelta(), 0.1), now = performance.now() / 1000;

    // 入场动画（spring 缓动 + 轻微光晕扩散）
    if (!eDone) {
      var t = Math.min((now - eT0) / S.entranceT, 1);
      // 自定义 spring 曲线：先快后慢，末端微弹
      var c1 = 1.70158, c3 = c1 + 1;
      var spring = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      var sc = spring, ts = S.fragSize;
      sprites.forEach(function (s) { s.scale.set(ts * sc, ts * sc, 1); s.material.opacity = Math.min(1, t * 3.5); });
      wire.material.opacity = 0.07 * sc;
      // 辉光随入场扩散
      if (glowSprite) glowSprite.material.uniforms.uOpacity.value = S.glow.opacity * sc;
      if (t >= 1) eDone = true;
    }

    // 惯性旋转（松手后）
    if (!_down) {
      th += rvx * dt;  // 角速度 × 时间 = 角度增量
      ph += rvy * dt;
      rvx *= S.damp; rvy *= S.damp;
      // 惯性极低时切换为自动旋转
      if (Math.abs(rvx) < 0.005 && Math.abs(rvy) < 0.005 && !sel && eDone) {
        th += S.autoSpd * dt;
      }
    }
    ph = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, ph));

    // 缩放
    cZoom += (tZoom - cZoom) * S.zSmooth;

    // 相机
    var r = cZoom;
    camera.position.set(r * Math.cos(ph) * Math.sin(th), r * Math.sin(ph), r * Math.cos(ph) * Math.cos(th));
    camera.lookAt(0, 0, 0);

    // 选中碎片动画（放大到 2.5x 并移到前方居中）
    if (sel) {
      sel.position.lerp(new THREE.Vector3(0, 0, S.R + 1.0), 0.08);
      var sz = S.fragSize * 2.5;
      sel.scale.lerp(new THREE.Vector3(sz, sz, 1), 0.08);
    }

    // 透明度平滑
    sprites.forEach(function (s) { var tg = s.userData.tOpacity; s.material.opacity += (tg - s.material.opacity) * 0.12; });

    // 空间漂浮（多频合成，模拟零重力漂移）
    if (!sel && eDone) {
      var fy = Math.sin(now * 0.5) * 0.1 + Math.sin(now * 1.3) * 0.05 + Math.cos(now * 0.7) * 0.04;
      group.position.y = fy;
      // 辉光呼吸
      if (glowSprite) {
        glowSprite.material.uniforms.uTime.value = now;
        glowSprite.material.uniforms.uOpacity.value = S.glow.opacity * (1 + Math.sin(now * 0.8) * 0.3);
      }
    }
    if (stars) { stars.rotation.y += dt * 0.015; stars.rotation.x += dt * 0.005; }
    upP(dt);
    renderer.render(scene, camera);
  }

  /* ==================== 弹窗开/关 ==================== */
  async function openOverlay() {
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    if (hint) hint.style.opacity = '1';

    if (!scene) {
      var w = canvasCt.clientWidth, h = canvasCt.clientHeight;
      if (w < 10 || h < 10) { console.warn('容器尺寸异常'); return; }
      clock = new THREE.Clock();
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 25);
      camera.position.set(0, 0, S.defZ); camera.lookAt(0, 0, 0);
      cZoom = S.defZ; tZoom = S.defZ;
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      canvasCt.appendChild(renderer.domElement);

      group = new THREE.Group(); scene.add(group);
      scene.add(new THREE.AmbientLight(0xffffff, 1.0));

      // 球体后方柔光辉光（Vision Pro 空间光感）
      var glowGeom = new THREE.SphereGeometry(S.R * 1.4, 32, 32);
      var glowMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(S.glow.color) }, uOpacity: { value: S.glow.opacity } },
        vertexShader: 'varying vec3 vNormal; varying vec3 vPosition; void main() { vNormal = normalize(normalMatrix * normal); vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying vec3 vNormal; varying vec3 vPosition; uniform float uTime; uniform vec3 uColor; uniform float uOpacity; void main() { float fresnel = 1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))); float glow = pow(fresnel, 3.5) * 0.5 + pow(fresnel, 8.0) * 0.5; gl_FragColor = vec4(uColor, glow * uOpacity); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      glowSprite = new THREE.Mesh(glowGeom, glowMat);
      group.add(glowSprite);

      // 背景星场（更多、更小、更柔和）
      var sg = new THREE.BufferGeometry(), sp = new Float32Array(S.stars.count * 3);
      for (var i = 0; i < S.stars.count; i++) {
        // 球形分布，营造包裹感
        var sr = 6 + Math.random() * 8;
        var st = Math.random() * Math.PI * 2;
        var sphi = Math.acos(2 * Math.random() - 1);
        sp[i * 3] = Math.cos(st) * Math.sin(sphi) * sr;
        sp[i * 3 + 1] = Math.sin(st) * Math.sin(sphi) * sr * 0.6;
        sp[i * 3 + 2] = Math.cos(sphi) * sr;
      }
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      stars = new THREE.Points(sg, new THREE.PointsMaterial({
        size: S.stars.size, color: 0xc0c8e0, transparent: true,
        opacity: S.stars.opacity, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      scene.add(stars);

      // 骨架线框（极细、极淡）
      wire = new THREE.Mesh(
        new THREE.SphereGeometry(S.R * 1.02, 28, 20),
        new THREE.MeshBasicMaterial({ color: 0x8899cc, wireframe: true, transparent: true, opacity: 0.07, depthWrite: false })
      );
      group.add(wire);

      initPS();
      ev();
      window.addEventListener('resize', onResize);
      console.log('3D场景初始化完成');
    }

    makeSprites();

    clock.start(); clock.getDelta();
    cancelAnimationFrame(aid); anim();

    eDone = false; eT0 = performance.now() / 1000;
    sprites.forEach(function (s) { s.scale.set(0.02, 0.02, 1); s.material.opacity = 0; });
  }

  function closeOverlay() {
    overlay.classList.remove('active');
    document.body.style.overflow = '';
    desel();
    cancelAnimationFrame(aid); aid = 0;
    if (clock) clock.stop();
  }

  /* ==================== 入口 ==================== */
  function init() {
    if (location.protocol === 'file:') {
      console.warn('file:// 协议，图片无法加载。请运行 python app.py 后访问 http://localhost:5000');
    }

    var entry = document.createElement('div');
    entry.className = 'sphere-entry-section';
    entry.innerHTML = '<div class="sphere-entry-card" id="sphereEntryBtn"><div class="sphere-entry-card-inner"><span class="sphere-entry-icon">✦</span><div class="sphere-entry-title">3D 回忆碎片</div><div class="sphere-entry-divider"></div><div class="sphere-entry-sub">旋转球体 · 点击拾取回忆</div><div class="sphere-entry-hint">点击进入</div></div></div>';

    overlay = document.createElement('div');
    overlay.className = 'sphere-overlay'; overlay.id = 'sphereOverlay';
    overlay.innerHTML = '<div class="sphere-controls"><button class="sphere-rotate-btn" id="sphereRotateBtn" title="旋转照片">↻</button><button class="sphere-close-btn" id="sphereCloseBtn">✕</button></div><div id="sphere-canvas-container"></div><div class="sphere-hint" id="sphereHint">拖拽旋转 · 滚轮缩放 · 点击拾取回忆</div><div class="sphere-toast" id="sphereToast"></div>';

    var wrapper = document.querySelector('.page-wrapper');
    var footer = wrapper ? wrapper.querySelector('.footer') : null;
    if (footer) footer.after(entry); else if (wrapper) wrapper.appendChild(entry);
    else document.body.appendChild(entry);
    (wrapper || document.body).after(overlay);

    canvasCt = document.getElementById('sphere-canvas-container');
    toast = document.getElementById('sphereToast');
    hint = document.getElementById('sphereHint');
    rotateBtn = document.getElementById('sphereRotateBtn');

    document.getElementById('sphereEntryBtn').addEventListener('click', openOverlay);
    document.getElementById('sphereCloseBtn').addEventListener('click', closeOverlay);
    rotateBtn.addEventListener('click', function (e) { e.stopPropagation(); rotateSelected(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeOverlay(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && overlay.classList.contains('active')) closeOverlay(); });
    console.log('3D回忆碎片就绪');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
