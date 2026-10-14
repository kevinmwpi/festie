/*
 * Home page motion (docs/site/index.html): the ragged edge of small squares where one section's colour meets
 * the next, the hero ring and wordmark fading as you scroll, the cards rising into place and leaning toward the
 * pointer. The ring, the wordmark's arrival, the tape and the feature motifs themselves are CSS
 * (docs/legal/home.css). Everything needs the `motion` class on <html>: the inline script in <head> adds it
 * when Reduce Motion is off, and this script follows that setting.
 */
(() => {
  const root = document.documentElement;
  const canvas = document.querySelector('.blocks');
  const hero = document.querySelector('.hero');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // Each pane has a colour. The canvas paints them where the panes are and steps between neighbours along a
  // narrow band of squares, so the change follows the content instead of washing over the whole window.
  const panes = [...document.querySelectorAll('[data-pane]'), document.querySelector('body > footer')];
  const paneColors = ['--sec-hero', '--sec-features', '--sec-privacy', '--sec-help', '--sec-end'];
  // The band, in rows of squares around a pane's top edge: each column's edge sits somewhere in STEP, and some
  // columns throw one square a row ahead of it. Outside BAND every square is plainly one pane or the other.
  // The footer gets a straight edge.
  const STEP = [-1, 0.6];
  const STRAY_SHARE = 0.25;
  const BAND = [STEP[0] - 2, STEP[1]];
  let width = 0, height = 0, cols = 0, rows = 0, fills = [], edges = [], queued = false;

  // A fixed pseudo-random value per column, so an edge looks the same scrolling down and back up.
  const noise = (x, y, z) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  function readColors() {
    const style = getComputedStyle(root);
    fills = paneColors.map((name) => style.getPropertyValue(name).trim());
  }

  function layout() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const cell = width < 600 ? 24 : 32;
    cols = Math.ceil(width / cell);
    rows = Math.ceil(height / cell);
    edges = panes.slice(1).map((pane, k) => Array.from({ length: cols }, (_, c) => (pane.tagName === 'FOOTER'
      ? { step: 0, stray: false }
      : { step: STEP[0] + (STEP[1] - STEP[0]) * noise(c, 0, k + 1), stray: noise(c, 1, k + 1) < STRAY_SHARE })));
  }

  function draw() {
    queued = false;
    if (!root.classList.contains('motion')) return;
    const cellW = width / cols;
    const cellH = height / rows;
    const tops = panes.slice(1).map((pane) => pane.getBoundingClientRect().top);
    for (let r = 0; r < rows; r++) {
      const y = Math.floor(r * cellH);
      const h = Math.ceil(cellH);
      const middle = (r + 0.5) * cellH;
      // The pane this row belongs to away from any edge, and the edges whose band crosses it.
      let pane = 0;
      const near = [];
      tops.forEach((top, k) => {
        const below = (middle - top) / cellH;
        if (below > BAND[1]) pane = k + 1;
        else if (below > BAND[0]) near.push({ k, below });
      });
      if (!near.length) {
        ctx.fillStyle = fills[pane];
        ctx.fillRect(0, y, width, h);
        continue;
      }
      for (let c = 0; c < cols; c++) {
        let fill = pane;
        for (const { k, below } of near) {
          const { step, stray } = edges[k][c];
          if (below > step || (stray && below > step - 2 && below <= step - 1)) fill = k + 1;
        }
        ctx.fillStyle = fills[fill];
        ctx.fillRect(Math.floor(c * cellW), y, Math.ceil(cellW), h);
      }
    }
    const heroProgress = Math.min(1, Math.max(0, -hero.getBoundingClientRect().top / (hero.offsetHeight * 0.55)));
    root.style.setProperty('--hero-p', heroProgress.toFixed(3));
    root.classList.toggle('ring-off', heroProgress > 0.62);
  }

  const queue = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(draw);
    }
  };
  const restyle = () => {
    readColors();
    queue();
  };

  // Cards rise a little as they come into view; they are readable in place before that.
  const rise = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        rise.unobserve(entry.target);
      }
    }
  }, { threshold: 0.15 });
  document.querySelectorAll('.feat, .panel').forEach((el) => rise.observe(el));

  // With a mouse or trackpad, a feature card leans toward the pointer (home.css turns --tx/--ty into the tilt).
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.feat').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--tx', ((event.clientX - box.left) / box.width - 0.5).toFixed(3));
        card.style.setProperty('--ty', ((event.clientY - box.top) / box.height - 0.5).toFixed(3));
      });
      card.addEventListener('pointerleave', () => {
        card.style.removeProperty('--tx');
        card.style.removeProperty('--ty');
      });
    });
  }

  try {
    readColors();
    layout();
    draw();
  } catch (error) {
    root.classList.remove('motion');
    throw error;
  }
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', () => {
    layout();
    queue();
  });
  addEventListener('load', queue);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restyle);
  new MutationObserver(restyle).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  reduce.addEventListener('change', () => {
    root.classList.toggle('motion', !reduce.matches);
    queue();
  });
})();
