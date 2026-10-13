/*
 * Home page motion (docs/site/index.html): the squares that swap one section's colour for the next behind
 * the page, the hero ring and wordmark fading as you scroll, the cards rising into place and leaning toward the
 * pointer. The ring, the wordmark's arrival, the tape and the feature motifs themselves are CSS (docs/legal/home.css). Everything needs the `motion` class on <html>:
 * the inline script in <head> adds it when Reduce Motion is off, and this script follows that setting.
 */
(() => {
  const root = document.documentElement;
  const canvas = document.querySelector('.blocks');
  const hero = document.querySelector('.hero');
  if (!canvas || !hero) return;
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // Each pane has a colour; the canvas paints it and swaps to the next pane's colour square by square.
  const panes = [...document.querySelectorAll('[data-pane]'), document.querySelector('body > footer')];
  const paneColors = ['--sec-hero', '--sec-features', '--sec-privacy', '--sec-help', '--sec-end'];
  const sparkColors = ['--spark-blue', '--spark-mint', '--spark-peach', '--spark-pink', '--spark-lilac'];
  let width = 0, height = 0, cols = 0, rows = 0, fills = [], sparks = [], ink = '', grids = [], queued = false;

  // A fixed pseudo-random value per square, so a transition looks the same scrolling down and back up.
  const noise = (x, y, z) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  function readColors() {
    const style = getComputedStyle(root);
    fills = paneColors.map((name) => style.getPropertyValue(name).trim());
    sparks = sparkColors.map((name) => style.getPropertyValue(name).trim());
    // The ink squares are see-through, so text that sits over one stays readable.
    const hex = style.getPropertyValue('--text').trim().replace('#', '');
    const n = parseInt(hex.length === 3 ? hex.replace(/./g, '$&$&') : hex, 16);
    ink = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.3)`;
  }

  function layout() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const cell = width < 600 ? 40 : 64;
    cols = Math.ceil(width / cell);
    rows = Math.ceil(height / cell);
    // For each transition: when every square flips (bottom rows first, scattered) and which spark it shows.
    grids = panes.slice(1).map((_, k) => {
      const at = new Float32Array(cols * rows);
      const spark = new Float32Array(cols * rows);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          at[r * cols + c] = 0.72 * (1 - (r + 0.5) / rows) + 0.28 * noise(c, r, k + 1);
          spark[r * cols + c] = noise(c, r, k + 101);
        }
      }
      return { at, spark };
    });
  }

  function draw() {
    queued = false;
    if (!root.classList.contains('motion')) return;
    const view = window.innerHeight;
    // 0 while the next pane's top is below the window, 1 once it has risen to a quarter of the way down.
    const progress = panes.slice(1).map((pane) => Math.min(1, Math.max(0, (view - pane.getBoundingClientRect().top) / (view * 0.75))));
    if (progress.every((p) => p === 0 || p === 1)) {
      ctx.fillStyle = fills[progress.filter((p) => p === 1).length];
      ctx.fillRect(0, 0, width, height);
    } else {
      const cellW = width / cols;
      const cellH = height / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          let fill = fills[0];
          let inked = false;
          for (let k = 0; k < progress.length; k++) {
            const p = progress[k];
            const { at, spark } = grids[k];
            if (p <= at[i]) continue;
            // Squares that have only just flipped show a deeper pastel, or now and then a wash of ink.
            const edge = p < 1 && p - at[i] < 0.07;
            inked = edge && spark[i] < 0.1;
            fill = edge && !inked ? sparks[Math.floor(spark[i] * 50) % sparks.length] : fills[k + 1];
          }
          const x = Math.floor(c * cellW), y = Math.floor(r * cellH), w = Math.ceil(cellW), h = Math.ceil(cellH);
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, w, h);
          if (inked) {
            ctx.fillStyle = ink;
            ctx.fillRect(x, y, w, h);
          }
        }
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
