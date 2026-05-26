/**
 * ============================================================
 *  501 宿舍纪念网页 - 底部彩蛋：滚动到底部自动触发气球动画
 *  无摄像头依赖，拉到底即触发
 * ============================================================
 */
(function () {
  'use strict';

  let hasTriggered = false;
  let balloonContainer = null;
  let balloonInterval = null;
  let balloonStopTimer = null;
  let textOverlay = null;

  /* ========================================================
     1. 滚动检测
     ======================================================== */
  function isNearBottom() {
    const scrollBottom = window.innerHeight + window.scrollY;
    const pageHeight = document.documentElement.scrollHeight;
    return scrollBottom >= pageHeight - 80;
  }

  /* ========================================================
     2. 气球动画
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
    path.style.cssText = `animation: stringSway ${randomBetween(2, 3.5)}s ease-in-out infinite;`;
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
     3. 毕业祝福文字动画
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
     4. 触发逻辑：滚到底部直接触发
     ======================================================== */
  function triggerEasterEgg() {
    if (hasTriggered) return;
    hasTriggered = true;

    requestAnimationFrame(() => {
      showGraduationText();
      startBalloons();
    });
  }

  let scrollDebounce = null;

  window.addEventListener(
    'scroll',
    () => {
      if (hasTriggered) return;
      if (scrollDebounce) return;
      scrollDebounce = requestAnimationFrame(() => {
        scrollDebounce = null;
        if (isNearBottom()) {
          triggerEasterEgg();
        }
      });
    },
    { passive: true }
  );

  /* ========================================================
     5. 页面卸载时清理
     ======================================================== */
  window.addEventListener('beforeunload', () => {
    if (balloonInterval) clearInterval(balloonInterval);
    if (balloonStopTimer) clearTimeout(balloonStopTimer);
  });

  console.log('[彩蛋] 已就绪 — 滚动到页面底部自动触发毕业祝福');
})();
