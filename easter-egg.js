/**
 * ============================================================
 *  501 宿舍纪念网页 - 底部彩蛋：五指张开发动气球动画
 *  技术栈：HTML5 + CSS3 + TensorFlow.js handpose
 *  无后端依赖，摄像头仅在滚动到底部后激活
 * ============================================================
 */
(function () {
  'use strict';

  /* ========================================================
     全局状态机
     idle       → 正常浏览，摄像头/模型休眠
     prompting  → 已滚动到底部，显示"五指张开"提示
     loading    → 正在加载 TF.js + handpose 模型
     detecting  → 摄像头已启动，实时检测手势
     triggered  → 彩蛋已触发，气球动画播放中
     denied     → 摄像头权限被拒绝
     ======================================================== */
  let state = 'idle';
  let videoEl = null;
  let mediaStream = null;
  let handModel = null;
  let detectRafId = null;
  let promptOverlay = null;
  let balloonContainer = null;
  let balloonInterval = null;
  let balloonStopTimer = null;
  let textOverlay = null;
  let hasTriggered = false; // 防重复：一次页面生命周期只触发一次

  /* ========================================================
     1. 滚动检测 —— 仅到底部时触发
     ======================================================== */
  function isNearBottom() {
    const scrollBottom = window.innerHeight + window.scrollY;
    const pageHeight = document.documentElement.scrollHeight;
    return scrollBottom >= pageHeight - 80; // 距底部 80px 内
  }

  /* ========================================================
     2. 提示浮层 —— 柔和半透明，pointer-events: none 不阻挡交互
     ======================================================== */
  function createPromptUI() {
    if (promptOverlay) return;

    promptOverlay = document.createElement('div');
    promptOverlay.id = 'easterEggPrompt';
    promptOverlay.textContent = '五指张开 ✋';
    // 样式通过下方 CSS 注入，此处仅设基础属性
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
      // 视频元素隐藏在 body 中用于推理，对用户不可见
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
     4. 动态加载 TF.js + handpose —— 仅触发时才下载
     ======================================================== */
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      // 避免重复加载
      if (document.querySelector(`script[src="${url}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Script load failed: ' + url));
      document.head.appendChild(s);
    });
  }

  async function loadHandposeModel() {
    // 按顺序加载体量较大的 TF.js CDN 资源
    await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
    // 等待 tf 全局变量可用
    let retries = 0;
    while (!window.tf && retries < 30) {
      await new Promise((r) => setTimeout(r, 200));
      retries++;
    }
    if (!window.tf) throw new Error('TensorFlow.js 加载超时');

    await window.tf.ready();
    // 使用 WebGL 后端加速推理
    try {
      await window.tf.setBackend('webgl');
    } catch (e) {
      console.warn('[彩蛋] WebGL 不可用，降级为 CPU:', e.message);
    }

    await loadScript(
      'https://cdn.jsdelivr.net/npm/@tensorflow-models/handpose@0.0.7/dist/handpose.min.js'
    );
    retries = 0;
    while (!window.handpose && retries < 30) {
      await new Promise((r) => setTimeout(r, 200));
      retries++;
    }
    if (!window.handpose) throw new Error('handpose 模型加载超时');

    // 加载预训练权重（首次从 TF Hub 下载 ≈ 12MB）
    handModel = await window.handpose.load({
      maxContinuousChecks: 5,
      detectionConfidence: 0.8,
      iouThreshold: 0.3,
      scoreThreshold: 0.75,
    });
    return handModel;
  }

  /* ========================================================
     5. 手势识别 —— 判断五指完全伸展且手掌朝向镜头
     ========================================================
     handpose 返回 21 个关键点（0=手腕, 1-4=拇指, 5-8=食指,
     9-12=中指, 13-16=无名指, 17-20=小指）每点 = [x, y, z]
     ======================================================== */

  /** 计算两点欧几里得距离 */
  function dist2d(a, b) {
    return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);
  }

  /** 判断单根手指是否伸展：
   *  指尖比 PIP 关节更远离手腕即为伸展 */
  function isFingerExtended(tip, pip, wrist) {
    const tipDist = dist2d(tip, wrist);
    const pipDist = dist2d(pip, wrist);
    return tipDist > pipDist * 1.05; // 5% 阈值防止抖动
  }

  /** 判断手指是否张开（水平间距足够大） */
  function isSpread(keypoints) {
    // 食指(8) ↔ 小指(20) 的水平距离应 > 无名指到中指距离的 2 倍
    const indexTip = keypoints[8];
    const pinkyTip = keypoints[20];
    const middleTip = keypoints[12];
    const ringTip = keypoints[16];

    const totalSpread = Math.abs(indexTip[0] - pinkyTip[0]);
    const innerSpread = Math.abs(middleTip[0] - ringTip[0]);
    return totalSpread > innerSpread * 1.8;
  }

  /** 综合判断：五指张开、手掌朝向镜头 */
  function isFiveFingersOpen(predictions) {
    if (!predictions || predictions.length === 0) return false;

    const keypoints = predictions[0].landmarks;
    if (!keypoints || keypoints.length < 21) return false;

    const wrist = keypoints[0];

    // 各手指: [tip, pip]
    const fingers = [
      [keypoints[4], keypoints[2]],   // 拇指
      [keypoints[8], keypoints[6]],   // 食指
      [keypoints[12], keypoints[10]], // 中指
      [keypoints[16], keypoints[14]], // 无名指
      [keypoints[20], keypoints[18]], // 小指
    ];

    // 1. 所有手指都伸展
    const allExtended = fingers.every(([tip, pip]) =>
      isFingerExtended(tip, pip, wrist)
    );
    if (!allExtended) return false;

    // 2. 手指水平展开
    if (!isSpread(keypoints)) return false;

    // 3. 手掌朝向镜头：中指尖 z < 手腕 z（指尖比手腕更靠近镜头）
    const middleTip = keypoints[12];
    if (middleTip[2] > wrist[2]) return false;

    return true;
  }

  /* ========================================================
     6. 检测循环 —— requestAnimationFrame 驱动
     ======================================================== */
  async function detectionLoop() {
    if (state !== 'detecting') return;

    try {
      const predictions = await handModel.estimateHands(videoEl);
      if (isFiveFingersOpen(predictions)) {
        onGestureDetected();
        return;
      }
    } catch (e) {
      // 模型推理偶发错误，静默吞掉继续下一帧
    }

    detectRafId = requestAnimationFrame(detectionLoop);
  }

  function onGestureDetected() {
    // 防重复触发：已触发过则直接忽略后续识别结果
    if (hasTriggered) return;
    hasTriggered = true;

    // 立刻释放摄像头与模型资源
    releaseResources();
    hidePrompt();
    state = 'triggered';

    // 文字动画与气球同步开始
    showGraduationText();
    startBalloons();
  }

  /* ========================================================
     7. 资源释放 —— 关摄像头、停模型、释放内存
     ======================================================== */
  function releaseResources() {
    // 停止摄像头
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    // 移除隐藏 video
    if (videoEl && videoEl.parentNode) {
      videoEl.parentNode.removeChild(videoEl);
      videoEl = null;
    }
    // 停检测循环
    if (detectRafId) {
      cancelAnimationFrame(detectRafId);
      detectRafId = null;
    }
    // 释放 TF 模型内存
    if (handModel) {
      try { handModel.dispose(); } catch (e) { /* ignore */ }
      handModel = null;
    }
  }

  /* ========================================================
     8. 气球动画
     ======================================================== */

  /** 气球柔和配色 */
  const BALLOON_COLORS = [
    '#F9A8D4', // 粉
    '#C4B5FD', // 紫
    '#FDE68A', // 黄
    '#93C5FD', // 浅蓝
    '#FDA4AF', // 柔和红
    '#A5B4FC', // 薰衣草
    '#FCD34D', // 金
    '#67E8F9', // 天蓝
  ];

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /** 创建单个气球 DOM —— 含气球主体 + 绳结 + 自然弯曲的绳子 */
  function createBalloon() {
    const size = randomBetween(40, 80);
    const left = randomBetween(2, 94);
    const duration = randomBetween(8, 12);
    const opacity = randomBetween(0.78, 0.92);
    const color = pickRandom(BALLOON_COLORS);
    // 绳子垂直长度 60~140px，随气球大小变化
    const stringLen = randomBetween(size * 1.2, size * 2.0);
    // 绳子弯曲幅度 8~20px，让每根绳子弯得不一样
    const curveX = randomBetween(8, 20) * (Math.random() > 0.5 ? 1 : -1);

    // 外层容器：承载上升 + 摇摆动画
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

    // 气球主体
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

    // 绳结（气球底部小三角）
    const knot = document.createElement('div');
    knot.style.cssText = `
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 7px solid ${color};
      margin-top: -1px;
    `;

    // SVG 曲线绳子 —— 用二次贝塞尔画出自然下垂的弧线
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    const svgW = Math.abs(curveX) * 2 + 4;
    svg.setAttribute('width', svgW);
    svg.setAttribute('height', stringLen);
    svg.setAttribute('viewBox', `0 0 ${svgW} ${stringLen}`);
    svg.style.cssText = `
      flex-shrink: 0;
      margin-top: -1px;
    `;

    const path = document.createElementNS(svgNS, 'path');
    const startX = svgW / 2;           // 起点：顶部居中（绳结下方）
    const endX = startX + curveX;       // 终点：弯曲偏移
    const cpX = startX + curveX * 0.6; // 控制点：60% 弯曲
    const cpY = stringLen * 0.45;
    path.setAttribute('d',
      `M ${startX} 0 Q ${cpX} ${cpY} ${endX} ${stringLen}`
    );
    path.setAttribute('stroke', 'rgba(180,160,140,0.45)');
    path.setAttribute('stroke-width', '1.2');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.style.cssText = `
      animation: stringSway ${randomBetween(2, 3.5)}s ease-in-out infinite;
    `;
    svg.appendChild(path);
    // 末尾加一个小点模拟绳尾
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', endX);
    dot.setAttribute('cy', stringLen);
    dot.setAttribute('r', '1.2');
    dot.setAttribute('fill', 'rgba(180,160,140,0.35)');
    svg.appendChild(dot);

    wrapper.appendChild(balloon);
    wrapper.appendChild(knot);
    wrapper.appendChild(svg);

    // 飞出视口后自动销毁整个 wrapper
    wrapper.addEventListener('animationend', (e) => {
      if (e.animationName === 'balloonRise') {
        if (wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      }
    });

    return wrapper;
  }

  /** 创建容器并开始生成气球 */
  function startBalloons() {
    if (!balloonContainer) {
      balloonContainer = document.createElement('div');
      balloonContainer.id = 'easterBalloonContainer';
      balloonContainer.style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9997;';
      document.body.appendChild(balloonContainer);
    }

    // 每 2 秒生成 3~5 个
    balloonInterval = setInterval(() => {
      const count = Math.floor(randomBetween(3, 6)); // 3~5 个
      for (let i = 0; i < count; i++) {
        // 错开 100ms 让气球不堆叠
        setTimeout(() => {
          const b = createBalloon();
          balloonContainer.appendChild(b);
        }, i * randomBetween(50, 180));
      }
    }, 2000);

    // 10 秒后停止生成
    balloonStopTimer = setTimeout(() => {
      clearInterval(balloonInterval);
      balloonInterval = null;
    }, 10000);
  }

  /* ========================================================
     8.5 毕业祝福文字动画 —— 与气球同步，渐显 → 上浮 → 渐隐
     毛笔书法字体 + 随机毕业配色，飘逸醒目不遮挡交互
     ======================================================== */

  /** 毕业主题配色 —— 每次随机选一种，动画全程不变 */
  const GRAD_COLORS = [
    '#FF6B8B', // 浅粉
    '#4A90E2', // 浅蓝
    '#F9D466', // 鹅黄
    '#6BCB77', // 薄荷绿
    '#9D65C9', // 浅紫
    '#FF9F43', // 浅橙
  ];

  function showGraduationText() {
    if (textOverlay) return;

    // 从配色列表中随机选一个，动画全程使用同一颜色
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
      /* 毛笔书法字体：Ma Shan Zheng 飞白笔锋，Zhi Mang Xing 飘逸行书，回退到衬线 */
      font-family: 'Ma Shan Zheng', 'Zhi Mang Xing', 'STKaiti', 'KaiTi', 'Noto Serif SC', serif;
      font-size: 56px;
      font-weight: normal;
      color: ${textColor};
      letter-spacing: 10px;
      white-space: nowrap;
      /* 柔光描边 + 彩色光晕，增强中式浪漫氛围 */
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

    // 动画结束后清理 DOM（总时长 ≈ 1.2 + 5 + 1.5 ≈ 7.7s）
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

    // 进入提示状态
    if (state === 'idle') {
      state = 'prompting';
      showPrompt('五指张开 ✋');
    }

    // 提示状态下请求摄像头
    if (state === 'prompting') {
      state = 'loading';
      showPrompt('正在准备摄像头...');

      const camOk = await requestCamera();
      if (!camOk) {
        state = 'denied';
        showPrompt('请开启摄像头以触发彩蛋');
        // 5 秒后自动隐藏提示
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
        await loadHandposeModel();
      } catch (err) {
        console.warn('[彩蛋] 模型加载失败:', err.message);
        state = 'idle';
        hidePrompt();
        releaseResources();
        return;
      }

      state = 'detecting';
      showPrompt('五指张开 ✋');
      detectionLoop();
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

  console.log('[彩蛋] 已就绪 — 滚动到页面底部触发五指张开识别');
})();
