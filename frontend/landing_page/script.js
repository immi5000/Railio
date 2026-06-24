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
      navLinks.forEach(function (link) {
        var active = link.getAttribute('href') === '#' + id;
        link.classList.toggle('is-active', active);
        var dot = link.querySelector('.fig-nav-dot');
        if (active && !dot) {
          dot = document.createElement('span');
          dot.className = 'fig-nav-dot';
          dot.setAttribute('aria-hidden', 'true');
          link.insertBefore(dot, link.firstChild);
        } else if (!active && dot) {
          dot.remove();
        }
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

  // ── Hero phone: show demo video when available, else animated transcript ──
  var mockEl = document.querySelector('.iphone-mock');
  var videoEl = document.querySelector('.iphone-video');
  if (mockEl && videoEl) {
    videoEl.addEventListener('loadeddata', function () {
      mockEl.classList.add('has-video');
    });
    videoEl.addEventListener('error', function () {
      mockEl.classList.remove('has-video');
    });
    videoEl.load();
  }

  var TRANSCRIPT = [
    { who: 'tech', html: "Brake pipe pressure dropping on car six. Won't hold above 75 PSI." },
    { who: 'ai',   html: "Pulling Unit 4423 — last B-end inspection 14 days ago. <b>Most likely cause: a leaking angle-cock gasket on car 6.</b>"
                       + '<div class="cites">Cited <span class="cite-link">49 CFR §232.103</span> · <span class="cite-link">Senior-tech note — Yard 7</span></div>' },
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
            +   '<div class="tool-note">🔧 Checking the manual… <span class="typing"><i></i><i></i><i></i></span></div>'
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
        ['Manual ref',   'AAR §4.2.7 · pg 412'],
        ['Part',         'P/N 9120-44A · Yard 7']
      ]}
    },
    {
      num: '02', k: 'Guide',
      title: 'Walk through the repair, hands-free.',
      sub: 'Step by step from the actual maintenance manual. Move at the tech\'s pace; torque values appear when needed.',
      panel: { kind: 'checks', left: 'PROCEDURE', right: 'AAR §4.2.7', items: [
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
      panel: { kind: 'kv', left: 'TRIBAL NOTE', right: 'SAVED ✓', rows: [
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
      + '<p class="sub">' + escHtml(st.sub) + '</p>';
    b.addEventListener('click', function () { active = i; renderHow(); });
    stepsEl.appendChild(b);
  });

  function renderHow() {
    [].forEach.call(stepsEl.children, function (t, i) {
      t.setAttribute('aria-selected', i === active ? 'true' : 'false');
    });
    dossierEl.innerHTML = renderDossier(STEPS[active].panel);
  }
  renderHow();
})();
