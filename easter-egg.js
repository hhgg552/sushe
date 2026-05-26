/**
 * ============================================================
 *  501 宿舍纪念网页 - 底部彩蛋：五指张开发动气球动画
 *  技术栈：HTML5 + CSS3 + MediaPipe Hands（替换 TF.js handpose）
 *  模型仅 ~3MB（原 12MB），加载更快，识别更准
 *  无后端依赖，摄像头仅在滚动到底部后激活
 * ============================================================
 */
(function () {
  'use strict';

  /* ========================================================
     全局状态机
     idle       → 正常浏览，摄像头/模型休眠
     prompting  → 已滚动到底部，显示"五指张开"提示
     loading    → 正在加载 MediaPipe Hands 模型
     detecting  → 摄像头已启动，实时检测手势
     triggered  → 彩蛋已触发，气球动画播放中
     denied     → 摄像头权限被拒绝
     ======================================================== */
  let state = 'idle';
  let videoEl = null;
  let mediaStream = null;
  let handsInstance = null;   // MediaPipe Hands 实例
  let promptOverlay = null;
  let balloonContainer = null;
  let balloonInterval = null;
  let balloonStopTimer = null;
  let textOverlay = null;
  let hasTriggered = false;   // 防重复：一次页面生命周期只触发一次

  /* ========================================================
     1. 滚动检测 —— 仅到底部时触发
     ======================================================== */
  function isNearBottom() {
    const scrollBottom = window.innerHeight + window.scrollY;
    const pageHeight = document.documentElement.scrollHeight;
    return scrollBottom >= pageHeight - 80;
  }

  /* ========================================================
     2. 提示浮层 —— 柔和半透明，pointer-events: none 不阻挡交互
     ======================================================== */
  function createPromptUI() {
    if (promptOverlay) return;
    promptOverlay = document.createElement('div');
    promptOverlay.id = 'easterEggPrompt';
    promptOverlay.textContent = '五指张开 ✋';
    promptOverlay.setAttribute('data-state', 'prompting');
    document.body.appendChild(promptOverlay);
  }

  function showPrompt(text) {
    if (!promptOverlay) createPromptUI();
    promptOverlay.textContent = text;
    promptOverlay.classList.add('visible');
  }

  function hidePrompt() {
    if (promptOverlay) {
      promptOverlay.classList.remove('visible');
    }
  }

  /* ========================================================
     3. 摄像头权限 —— 仅在提示出现后请求，拒绝后不再重试
     ======================================================== */
  async function requestCamera() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 320 },
          height: { ideal: 320 },
          facingMode: 'user',
          frameRate: { ideal: 15 },
        },
        audio: false,
      });

      videoEl = document.createElement('video');
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('muted', '');
      videoEl.srcObject = mediaStream;
      videoEl.width = 320;
      videoEl.height = 320;
      videoEl.style.cssText =
        'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(videoEl);

      await videoEl.play();
      return true;
    } catch (err) {
      console.warn('[彩蛋] 摄像头权限被拒绝或不可用:', err.message);
      return false;
    }
  }

  /* ========================================================
     4. MediaPipe Hands 加载 —— 轻量快速，模型仅 ~3MB
     ======================================================== */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${url}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Script load failed: ' + url));
      document.head.appendChild(s);
    });
  }

  async function loadMediaPipeHands() {
    // 加载 MediaPipe Hands 核心库（约 200KB）
    await loadScript(
      'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js'
    );
    let retries = 0;
    while (!window.Hands && retries < 30) {
      await new Promise((r) => setTimeout(r, 200));
      retries++;
    }
    if (!window.Hands) throw new Error('MediaPipe Hands 加载超时');

    // 创建 Hands 实例，模型文件通过 locateFile 指向 CDN
    handsInstance = new window.Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
    });

    // 配置：单手检测 + Lite 模型（更快更轻）
    handsInstance.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,          // 0 = Lite (~3MB), 1 = Full (~6MB)
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    // 注册回调：每帧检测结果自动触发
    handsInstance.onResults(onHandResults);

    // 预热模型（首次推理初始化 WASM + 下载模型文件）
    await handsInstance.initialize();
    // 等待模型文件和 WASM 完全就绪
    await new Promise((r) => setTimeout(r, 800));

    // 【修复】确保视频已就绪再送首帧
    if (videoEl && videoEl.readyState >= 2) {
      try {
        await handsInstance.send({ image: videoEl });
      } catch (e) {
        console.warn('[彩蛋] 模型预热失败，将在帧循环中重试:', e.message);
      }
    }

    return handsInstance;
  }

  /* ========================================================
     5. 手势识别 —— 判断五指完全伸展且手掌朝向镜头
     MediaPipe 返回 21 个关键点（0=手腕, 1-4=拇指, 5-8=食指,
     9-12=中指, 13-16=无名指, 17-20=小指）
     每点 = {x, y, z} 归一化坐标（0~1），z 越小越靠近镜头
     ======================================================== */

  /** 计算两点欧几里得距离（归一化坐标系） */
  function dist2d(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  /** 判断单根手指是否伸展：指尖比 PIP 关节更远离手腕 */
  function isFingerExtended(tip, pip, wrist) {
    const tipDist = dist2d(tip, wrist);
    const pipDist = dist2d(pip, wrist);
    return tipDist > pipDist * 1.05;
  }

  /** 判断手指是否张开（水平间距足够大） */
  function isSpread(keypoints) {
    const indexTip = keypoints[8];
    const pinkyTip = keypoints[20];
    const middleTip = keypoints[12];
    const ringTip = keypoints[16];

    const totalSpread = Math.abs(indexTip.x - pinkyTip.x);
    const innerSpread = Math.abs(middleTip.x - ringTip.x);
    return totalSpread > innerSpread * 1.8;
  }

  /** 综合判断：五指张开、手掌朝向镜头 */
  function isFiveFingersOpen(landmarks) {
    if (!landmarks || landmarks.length < 21) return false;

    const wrist = landmarks[0];

    // 各手指: [tip, pip]
    const fingers = [
      [landmarks[4], landmarks[2]],   // 拇指
      [landmarks[8], landmarks[6]],   // 食指
      [landmarks[12], landmarks[10]], // 中指
      [landmarks[16], landmarks[14]], // 无名指
      [landmarks[20], landmarks[18]], // 小指
    ];

    // 1. 所有手指都伸展
    const allExtended = fingers.every(([tip, pip]) =>
      isFingerExtended(tip, pip, wrist)
    );
    if (!allExtended) return false;

    // 2. 手指水平展开
    if (!isSpread(landmarks)) return false;

    // 3. 手掌朝向镜头：中指尖 z < 手腕 z
    const middleTip = landmarks[12];
    if (middleTip.z > wrist.z) return false;

    return true;
  }

  /* ========================================================
     6. MediaPipe 检测回调 + 帧推送（10fps 节流）
     ======================================================== */

  /** 节流计时 —— 限制 10fps 降低 GPU 压力，避免 WebGL 上下文丢失 */
  let lastFrameTime = 0;
  const FRAME_INTERVAL = 100; // 10fps = 100ms

  function onHandResults(results) {
    if (state !== 'detecting' || hasTriggered) return;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      if (isFiveFingersOpen(results.multiHandLandmarks[0])) {
        onGestureDetected();
      }
    }
  }

  /** 持续将视频帧送入 MediaPipe（10fps 节流 + 视频就绪检查 + WebGL 容错） */
  function sendFrame() {
    if (state !== 'detecting' || hasTriggered) return;

    const now = performance.now();
    if (now - lastFrameTime < FRAME_INTERVAL) {
      requestAnimationFrame(sendFrame);
      return;
    }
    lastFrameTime = now;

    // 【修复1】视频就绪状态检查：readyState >= 2 且视频宽高 > 0
    if (
      handsInstance &&
      videoEl &&
      videoEl.readyState >= 2 &&
      videoEl.videoWidth > 0 &&
      videoEl.videoHeight > 0
    ) {
      // 【修复2】send() 错误静默吞掉，避免 WebGL 偶发报错弹窗
      handsInstance.send({ image: videoEl }).catch((e) => {
        // WebGL 上下文偶发丢失，静默跳过下一帧自动恢复
        if (e.message && e.message.includes('WebGL')) {
          console.warn('[彩蛋] WebGL 上下文异常，跳过当前帧');
        }
      });
    }

    requestAnimationFrame(sendFrame);
  }

  // 【修复3】监听 WebGL 上下文丢失，页面级别兜底
  function setupWebGLFallback() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      canvas.addEventListener('webglcontextlost', (e) => {
        console.warn('[彩蛋] WebGL 上下文丢失，尝试恢复...');
        e.preventDefault(); // 允许浏览器尝试恢复
        // 暂停一帧让 GPU 恢复
        lastFrameTime = performance.now() + 500;
      });
      canvas.addEventListener('webglcontextrestored', () => {
        console.log('[彩蛋] WebGL 上下文已恢复');
        lastFrameTime = 0;
      });
      // 用完即弃，仅用于注册事件监听
      const loseContext = gl.getExtension('WEBGL_lose_context');
      if (loseContext) { loseContext.loseContext(); }
    }
  }
  setupWebGLFallback();

  function onGestureDetected() {
    if (hasTriggered) return;
    hasTriggered = true;

    releaseResources();
    hidePrompt();
    state = 'triggered';

    requestAnimationFrame(() => {
      showGraduationText();
      startBalloons();
    });
  }

  /* ========================================================
     7. 资源释放 —— 关摄像头、释放 MediaPipe、停帧推送
     ======================================================== */
  function releaseResources() {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (videoEl && videoEl.parentNode) {
      videoEl.parentNode.removeChild(videoEl);
      videoEl = null;
    }
    // MediaPipe Hands 清理
    if (handsInstance) {
      try {
        handsInstance.close();
      } catch (e) { /* ignore */ }
      handsInstance = null;
    }
  }

  /* ========================================================
     8. 气球动画
     ======================================================== */

  const BALLOON_COLORS = [
    '#F9A8D4', '#C4B5FD', '#FDE68A', '#93C5FD',
    '#FDA4AF', '#A5B4FC', '#FCD34D', '#67E8F9',
  ];

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function createBalloon() {
    const size = randomBetween(40, 80);
    const left = randomBetween(2, 94);
    const duration = randomBetween(8, 12);
    const opacity = randomBetween(0.78, 0.92);
    const color = pickRandom(BALLOON_COLORS);
    const stringLen = randomBetween(size * 1.2, size * 2.0);
    const curveX = randomBetween(8, 20) * (Math.random() > 0.5 ? 1 : -1);

    const wrapper = document.createElement('div');
    wrapper.className = 'easter-ballon-wrapper';
    wrapper.style.cssText = `
      position: fixed;
      left: ${left}vw;
      bottom: -${size + stringLen + 20}px;
      pointer-events: none;
      z-index: 9998;
      display: flex;
      flex-direction: column;
      align-items: center;
      animation: balloonRise ${duration}s ease-in forwards,
                 balloonWobble ${randomBetween(3, 5)}s ease-in-out infinite;
    `;

    const balloon = document.createElement('div');
    balloon.className = 'easter-ballon';
    balloon.style.cssText = `
      width: ${size}px;
      height: ${size * 1.3}px;
      background: radial-gradient(
        ellipse at 35% 30%,
        rgba(255,255,255,0.45) 0%,
        ${color} 55%,
        ${color} 100%
      );
      border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%;
      opacity: ${opacity};
      box-shadow:
        inset -4px -6px 12px rgba(0,0,0,0.06),
        0 4px 16px rgba(0,0,0,0.05);
      flex-shrink: 0;
    `;

    const knot = document.createElement('div');
    knot.style.cssText = `
      width: 0; height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 7px solid ${color};
      margin-top: -1px;
    `;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    const svgW = Math.abs(curveX) * 2 + 4;
    svg.setAttribute('width', svgW);
    svg.setAttribute('height', stringLen);
    svg.setAttribute('viewBox', `0 0 ${svgW} ${stringLen}`);
    svg.style.cssText = 'flex-shrink: 0; margin-top: -1px;';

    const path = document.createElementNS(svgNS, 'path');
    const startX = svgW / 2;
    const endX = startX + curveX;
    const cpX = startX + curveX * 0.6;
    const cpY = stringLen * 0.45;
    path.setAttribute('d', `M ${startX} 0 Q ${cpX} ${cpY} ${endX} ${stringLen}`);
    path.setAttribute('stroke', 'rgba(180,160,140,0.45)');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.style.cssText = `
      animation: stringSway ${randomBetween(2, 3.5)}s ease-in-out infinite;
    `;
    svg.appendChild(path);

    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', endX);
    dot.setAttribute('cy', stringLen);
    dot.setAttribute('r', '1.2');
    dot.setAttribute('fill', 'rgba(180,160,140,0.35)');
    svg.appendChild(dot);

    wrapper.appendChild(balloon);
    wrapper.appendChild(knot);
    wrapper.appendChild(svg);

    wrapper.addEventListener('animationend', (e) => {
      if (e.animationName === 'balloonRise') {
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      }
    });

    return wrapper;
  }

  function startBalloons() {
    if (!balloonContainer) {
      balloonContainer = document.createElement('div');
      balloonContainer.id = 'easterBalloonContainer';
      balloonContainer.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9997;';
      document.body.appendChild(balloonContainer);
    }

    balloonInterval = setInterval(() => {
      const count = Math.floor(randomBetween(3, 6));
      for (let i = 0; i < count; i++) {
        setTimeout(() => {
          const b = createBalloon();
          balloonContainer.appendChild(b);
        }, i * randomBetween(50, 180));
      }
    }, 2000);

    balloonStopTimer = setTimeout(() => {
      clearInterval(balloonInterval);
      balloonInterval = null;
    }, 10000);
  }

  /* ========================================================
     8.5 毕业祝福文字动画
     ======================================================== */

  const GRAD_COLORS = [
    '#FF6B8B', '#4A90E2', '#F9D466', '#6BCB77', '#9D65C9', '#FF9F43',
  ];

  function showGraduationText() {
    if (textOverlay) return;

    const textColor = GRAD_COLORS[Math.floor(Math.random() * GRAD_COLORS.length)];

    textOverlay = document.createElement('div');
    textOverlay.id = 'easterGraduationText';
    textOverlay.textContent = '毕业快乐，前程似锦！';
    textOverlay.style.cssText = `
      position: fixed;
      top: 40%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      font-family: 'Ma Shan Zheng', 'Zhi Mang Xing', 'STKaiti', 'KaiTi', 'Noto Serif SC', serif;
      font-size: 56px;
      font-weight: normal;
      color: ${textColor};
      letter-spacing: 10px;
      white-space: nowrap;
      text-shadow:
        0 2px 4px rgba(0, 0, 0, 0.25),
        0 0 60px ${textColor}44,
        0 0 120px ${textColor}22;
      pointer-events: none;
      animation: gradTextFadeIn 1.2s ease-out forwards,
                 gradTextFloat 5s 1.2s ease-in-out forwards,
                 gradTextFadeOut 1.5s 5.5s ease-in forwards;
    `;
    document.body.appendChild(textOverlay);

    setTimeout(() => {
      if (textOverlay && textOverlay.parentNode) {
        textOverlay.parentNode.removeChild(textOverlay);
        textOverlay = null;
      }
    }, 8000);
  }

  /* ========================================================
     9. 主流程 —— 滚动到底部后触发
     ======================================================== */
  let scrollDebounce = null;

  async function handleScroll() {
    if (hasTriggered || state === 'triggered' || state === 'denied') return;
    if (!isNearBottom()) return;

    if (state === 'idle') {
      state = 'prompting';
      showPrompt('五指张开 ✋');
    }

    if (state === 'prompting') {
      state = 'loading';
      showPrompt('正在准备摄像头...');

      const camOk = await requestCamera();
      if (!camOk) {
        state = 'denied';
        showPrompt('请开启摄像头以触发彩蛋');
        setTimeout(() => {
          hidePrompt();
          if (promptOverlay) {
            promptOverlay.parentNode.removeChild(promptOverlay);
            promptOverlay = null;
          }
        }, 5000);
        return;
      }

      showPrompt('加载模型中...');

      try {
        await loadMediaPipeHands();
      } catch (err) {
        console.warn('[彩蛋] 模型加载失败:', err.message);
        state = 'idle';
        hidePrompt();
        releaseResources();
        return;
      }

      state = 'detecting';
      showPrompt('五指张开 ✋');
      sendFrame();  // 开始推送视频帧给 MediaPipe
    }
  }

  window.addEventListener(
    'scroll',
    () => {
      if (scrollDebounce) return;
      scrollDebounce = requestAnimationFrame(() => {
        scrollDebounce = null;
        handleScroll();
      });
    },
    { passive: true }
  );

  /* ========================================================
     10. 页面卸载时清理所有资源
     ======================================================== */
  window.addEventListener('beforeunload', () => {
    releaseResources();
    if (balloonInterval) clearInterval(balloonInterval);
    if (balloonStopTimer) clearTimeout(balloonStopTimer);
  });

  console.log('[彩蛋] 已就绪 — 滚动到页面底部触发五指张开识别（MediaPipe Hands）');
})();
