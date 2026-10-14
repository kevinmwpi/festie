/*
 * Home page motion (docs/site/index.html): the band of small squares, in shades between two sections' colours,
 * where one section meets the next; the hero ring and wordmark fading as you scroll; the cards rising into place
 * and leaning toward the pointer. The ring, the wordmark's arrival, the tape and the feature motifs themselves
 * are CSS (docs/legal/home.css). Everything needs the `motion` class on <html>: the inline script in <head> adds
 * it when Reduce Motion is off, and this script follows that setting.
 */
(() => {
  const root = document.documentElement;
  const canvas = document.querySelector('.blocks');
  const hero = document.querySelector('.hero');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // Each pane has a colour. The canvas paints them where the panes are and blends neighbours along a narrow band
  // of squares, so the change follows the content instead of washing over the whole window.
  const panes = [...document.querySelectorAll('[data-pane]'), document.querySelector('body > footer')];
  const paneColors = ['--sec-hero', '--sec-features', '--sec-privacy', '--sec-help', '--sec-end'];
  // The band, in rows of squares around a pane's top edge (BAND), where the colour changes. Each square takes
  // one of a few shades between the two panes' colours (SHADES steps), set by how far into the band it sits plus
  // its own random nudge (NUDGE). The nudges belong to the squares of the window, not to the page, so the mix
  // keeps reshuffling as an edge moves through them. The footer gets a straight edge.
  const BAND = [-2.2, 1.8];
  const SHADES = 5;
  const NUDGE = 0.8;
  let width = 0, height = 0, cols = 0, rows = 0, fills = [], shades = [], nudges = [], queued = false;

  // A fixed pseudo-random value per square of the window.
  const noise = (x, y, z) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const rgb = (hex) => {
    const n = parseInt(hex.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  function readColors() {
    const style = getComputedStyle(root);
    fills = paneColors.map((name) => style.getPropertyValue(name).trim());
    // For each edge, SHADES + 1 colours from this pane's to the next pane's, both ends included.
    shades = fills.slice(1).map((next, k) => {
      const [from, to] = [rgb(fills[k]), rgb(next)];
      return Array.from({ length: SHADES + 1 }, (_, step) => {
        const t = step / SHADES;
        return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * t)).join(', ')})`;
      });
    });
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
    nudges = panes.slice(1).map((_, k) => Float32Array.from({ length: cols * rows }, (_, i) => noise(i % cols, Math.floor(i / cols), k + 1) - 0.5));
  }

  function draw() {
    queued = false;
    if (!root.classList.contains('motion')) return;
    const cellW = width / cols;
    const cellH = height / rows;
    const tops = panes.slice(1).map((pane) => pane.getBoundingClientRect().top);
    const straight = panes.slice(1).map((pane) => pane.tagName === 'FOOTER');
    for (let r = 0; r < rows; r++) {
      const y = Math.floor(r * cellH);
      const h = Math.ceil(cellH);
      const middle = (r + 0.5) * cellH;
      // The pane this row belongs to away from any edge, and the edges whose band crosses it.
      let pane = 0;
      const near = [];
      tops.forEach((top, k) => {
        const below = (middle - top) / cellH;
        if (straight[k] ? below > 0 : below > BAND[1]) pane = k + 1;
        else if (!straight[k] && below > BAND[0]) near.push({ k, into: (below - BAND[0]) / (BAND[1] - BAND[0]) });
      });
      if (!near.length) {
        ctx.fillStyle = fills[pane];
        ctx.fillRect(0, y, width, h);
        continue;
      }
      for (let c = 0; c < cols; c++) {
        let fill = fills[pane];
        for (const { k, into } of near) {
          const step = Math.round((into + nudges[k][r * cols + c] * NUDGE) * SHADES);
          fill = shades[k][Math.min(SHADES, Math.max(0, step))];
        }
        ctx.fillStyle = fill;
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
