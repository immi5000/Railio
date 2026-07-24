(function () {
  // ── Nav: full-width at top, compact pill after scroll ──
  var navEl = document.querySelector('.fig-nav');
  if (navEl) {
    var navTicking = false;

    function setNavScrolled() {
      navEl.classList.toggle('is-scrolled', window.scrollY > 12);
      navTicking = false;
    }

    function requestNavUpdate() {
      if (navTicking) return;
      navTicking = true;
      requestAnimationFrame(setNavScrolled);
    }

    window.addEventListener('scroll', requestNavUpdate, { passive: true });
    setNavScrolled();
  }

  // ── Nav: highlight active section (dashboard-style dot prefix) ──
  var navLinks = document.querySelectorAll('.fig-nav-link[href^="#"]');
  if (navLinks.length) {
    var sections = [];
    navLinks.forEach(function (link) {
      var id = link.getAttribute('href').slice(1);
      var el = document.getElementById(id);
      if (el) sections.push({ id: id, el: el, link: link });
    });

    function setActive(id) {
      // The dot lives in the markup and is shown/hidden via CSS, and the label
      // reserves its bold width with a ghost pseudo — so toggling the class
      // changes weight + dot visibility without reflowing the nav row.
      navLinks.forEach(function (link) {
        var active = link.getAttribute('href') === '#' + id;
        link.classList.toggle('is-active', active);
      });
    }

    function onScroll() {
      var y = window.scrollY + 120;
      var current = '';
      sections.forEach(function (s) {
        if (s.el.offsetTop <= y) current = s.id;
      });
      setActive(current);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── Hero phone: show the demo video ONLY once it's genuinely playing,
  // otherwise keep the animated transcript fallback. Switching on 'loadeddata'
  // (or relying on the autoplay attribute) caused an intermittent black phone
  // screen on mobile: the fallback got hidden the moment the element had a
  // frame buffered, but autoplay was blocked/delayed (or the source 404s), so a
  // black <video> showed with nothing playing. Gate the swap on 'playing', and
  // actively kick autoplay via play() so a rejected promise falls back cleanly.
  var mockEl = document.querySelector('.iphone-mock');
  var videoEl = document.querySelector('.iphone-video');
  if (mockEl && videoEl) {
    var showFallback = function () { mockEl.classList.remove('has-video'); };
    // Only the video actually rendering frames flips us to video mode.
    videoEl.addEventListener('playing', function () {
      mockEl.classList.add('has-video');
    });
    // Any failure to play keeps/returns to the transcript fallback.
    videoEl.addEventListener('error', showFallback);
    videoEl.addEventListener('stalled', showFallback);
    videoEl.addEventListener('emptied', showFallback);
    // Try to start it; if autoplay is blocked or the source is missing, stay on
    // the fallback rather than showing a black frame.
    var tryPlay = function () {
      var p = videoEl.play();
      if (p && typeof p.catch === 'function') p.catch(showFallback);
    };
    videoEl.addEventListener('canplay', tryPlay);
    videoEl.load();
    tryPlay();
  }

  var TRANSCRIPT = [
    { who: 'tech', html: "Brake pipe pressure dropping on car six. Won't hold above 75 PSI." },
    { who: 'ai',   html: "Pulling Unit 4423 — last B-end inspection 14 days ago. <b>Most likely cause: a leaking angle-cock gasket on car 6.</b>"
                       + '<div class="cites">Cited <span class="cite-link">49 CFR Sec. 232.103</span> · <span class="cite-link">Senior-tech note — Yard 7</span></div>' },
    { who: 'tech', html: "Where's the part?" },
    { who: 'ai',   html: "Gasket <b>P/N 9120-44A</b> — two in stock at Yard 7, I reserved one. Want me to walk you through the swap?"
                       + '<div class="cites">Cited <span class="cite-link">Parts inventory — Yard 7</span></div>' },
  ];
  var transcriptEl = document.getElementById('ph-transcript');
  var step = 0;

  function renderTranscript() {
    var html = '';
    var shown = Math.min(step, TRANSCRIPT.length);
    for (var i = 0; i < shown; i++) {
      var m = TRANSCRIPT[i];
      var who = m.who === 'ai' ? 'Railio' : 'Tech';
      html += '<div class="ph-msg ' + m.who + '">'
            +   '<div class="bub">'
            +     '<div class="role">' + who + '</div>'
            +     '<div>' + m.html + '</div>'
            +   '</div>'
            + '</div>';
    }
    if (step < TRANSCRIPT.length && TRANSCRIPT[step].who === 'ai') {
      html += '<div class="ph-msg ai"><div class="bub">'
            +   '<div class="role">Railio</div>'
            +   '<div class="tool-note">Checking the manual… <span class="typing"><i></i><i></i><i></i></span></div>'
            + '</div></div>';
    }
    transcriptEl.innerHTML = html;
    requestAnimationFrame(function () {
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    });
  }
  renderTranscript();
  setInterval(function () {
    step = (step + 1) % (TRANSCRIPT.length + 2);
    renderTranscript();
  }, 2400);

  // ── How it works: vertical step list + dossier panel ──────────────────────
  var STEPS = [
    {
      num: '01', k: 'Diagnose',
      title: 'Tell Railio what you see.',
      sub: 'Describe the symptom. Railio cross-references unit history, OEM manuals, and 90 days of similar faults across the fleet.',
      panel: { kind: 'kv', left: 'DIAGNOSIS', right: '92% confidence', rows: [
        ['Symptom',      'Brake pipe < 75 PSI'],
        ['Likely cause', 'Angle cock gasket, B-end'],
        ['Manual ref',   'AAR Sec. 4.2.7 · pg 412'],
        ['Part',         'P/N 9120-44A · Yard 7']
      ]}
    },
    {
      num: '02', k: 'Guide',
      title: 'Walk through the repair, hands-free.',
      sub: 'Step by step from the actual maintenance manual. Move at the tech\'s pace; torque values appear when needed.',
      panel: { kind: 'checks', left: 'PROCEDURE', right: 'AAR Sec. 4.2.7', items: [
        { done: true,  label: 'Isolate angle cocks, both ends' },
        { done: true,  label: 'Bleed reservoir to 0 PSI' },
        { done: true,  label: 'Remove old gasket P/N 9120-44A' },
        { done: false, now: true, label: 'Install new gasket — torque 18 ft-lb' },
        { done: false, label: 'Pressure-test 90 PSI · hold 60s' }
      ]}
    },
    {
      num: '03', k: 'Capture',
      title: 'Capture what you learn.',
      sub: 'Tech logs the trick that worked. Railio writes it to tribal notes — searchable and cite-able for the next tech who hits the same fault.',
      panel: { kind: 'kv', left: 'TRIBAL NOTE', right: 'SAVED', rows: [
        ['Lesson',       'Check fuel rail transducer voltage before swapping injectors on ES44DC'],
        ['From',         'Tech JM · 32 yrs on the floor'],
        ['Saved to',     'Tribal notes · ES44DC family'],
        ['Surfaces on',  'Next similar fault']
      ]}
    },
  ];

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  function renderDossier(p) {
    var inner = '';
    if (p.kind === 'kv') {
      inner += '<div class="kv">';
      p.rows.forEach(function (r) {
        inner += '<div class="row"><span class="k">' + escHtml(r[0]) + '</span><span>' + escHtml(r[1]) + '</span></div>';
      });
      inner += '</div>';
    } else if (p.kind === 'checks') {
      inner += '<div class="checks">';
      p.items.forEach(function (c) {
        var cls = 'c' + (c.done ? ' done' : '') + (c.now ? ' now' : '');
        inner += '<div class="' + cls + '"><span class="b"></span><span class="lbl">' + escHtml(c.label) + '</span>'
              + (c.now ? '<span class="now-tag">Now</span>' : '') + '</div>';
      });
      inner += '</div>';
    }
    return '<div class="dossier">'
         +   '<div class="doss-hd"><span class="l">' + escHtml(p.left) + '</span><span class="r">' + escHtml(p.right) + '</span></div>'
         +   inner
         + '</div>';
  }

  var stepsEl = document.getElementById('how-steps');
  var dossierEl = document.getElementById('how-dossier');
  var active = 0;

  STEPS.forEach(function (st, i) {
    var b = document.createElement('button');
    b.className = 'how-step';
    b.setAttribute('role', 'tab');
    b.innerHTML =
        '<div class="row1">'
      +   '<span class="num">STEP ' + st.num + ' — ' + escHtml(st.k.toUpperCase()) + '</span>'
      +   '<span class="arr arrow" aria-hidden="true"></span>'
      + '</div>'
      + '<div class="ttl">' + escHtml(st.title) + '</div>'
      // subwrap/subinner form the 0fr→1fr grid collapse (styles.css) so the
      // sub-copy animates open on the selected step instead of jumping.
      + '<div class="subwrap"><div class="subinner"><p class="sub">' + escHtml(st.sub) + '</p></div></div>';
    // Guard the no-op click: without this, clicking the already-selected step
    // rebuilds #how-dossier via innerHTML and replays dossier-in for nothing.
    b.addEventListener('click', function () {
      if (i === active) return;
      active = i;
      renderHow();
    });
    stepsEl.appendChild(b);
  });

  function renderHow() {
    [].forEach.call(stepsEl.children, function (t, i) {
      t.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    dossierEl.innerHTML = renderDossier(STEPS[active].panel);
  }
  renderHow();

  // ── Scroll reveals ──
  // Runs after the JS-built sections above so every [data-reveal] target
  // exists. The .reveal-ready gate means a JS failure never hides content.
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealEls = [].slice.call(document.querySelectorAll('[data-reveal]'));

  if (revealEls.length) {
    document.documentElement.classList.add('reveal-ready');

    // Stagger index within each sibling group (e.g. the six metric cards),
    // capped so long groups don't drift apart.
    revealEls.forEach(function (el) {
      var i = 0;
      var sib = el;
      while ((sib = sib.previousElementSibling)) {
        if (sib.hasAttribute('data-reveal')) i++;
      }
      el.style.setProperty('--reveal-i', String(Math.min(i, 7)));
    });

    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('is-revealed'); });
    } else {
      var revealIo = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-revealed');
            revealIo.unobserve(entry.target);
          });
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.15 }
      );
      revealEls.forEach(function (el) { revealIo.observe(el); });
    }
  }

  // ── Metric count-up ──
  // Parses the hardcoded stat text ("$2.4", "1,200", "−38" — note U+2212) and
  // counts the first text node up on first view; the .u suffix span never
  // moves. Any parse failure leaves the hardcoded text untouched.
  var impactEl = document.getElementById('impact');
  if (impactEl && !reduceMotion && 'IntersectionObserver' in window) {
    var countUp = function (numEl) {
      var textNode = numEl.firstChild;
      if (!textNode || textNode.nodeType !== 3) return;
      var raw = textNode.textContent;
      var m = raw.match(/^([^0-9]*)([0-9.,]+)$/);
      if (!m) return;
      var prefix = m[1];
      var target = parseFloat(m[2].replace(/,/g, ''));
      if (!isFinite(target)) return;
      var decimals = (m[2].split('.')[1] || '').length;
      var grouping = m[2].indexOf(',') !== -1;
      var start = null;
      function frame(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / 900);
        var eased = t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
        textNode.textContent =
          prefix +
          (target * eased).toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
            useGrouping: grouping,
          });
        if (t < 1) requestAnimationFrame(frame);
        else textNode.textContent = raw; // land on the exact authored text
      }
      requestAnimationFrame(frame);
    };
    var countIo = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          countIo.disconnect();
          [].forEach.call(impactEl.querySelectorAll('.m .num'), countUp);
        });
      },
      { threshold: 0.35 }
    );
    countIo.observe(impactEl);
  }
})();
