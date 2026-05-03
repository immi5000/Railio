(function () {
  // ── Hero phone: animated wave bars ─────────────────────────────────────────
  var wave = document.getElementById('ph-wave');
  for (var i = 0; i < 14; i++) {
    var bar = document.createElement('i');
    bar.style.animationDelay = (i * 0.05) + 's';
    wave.appendChild(bar);
  }

  // ── Hero phone: looping live-diagnosis transcript ─────────────────────────
  var TRANSCRIPT = [
    { who: 'tech', t: '00:02', html: "Brake pipe pressure dropping on car six. Won't hold above 75 PSI." },
    { who: 'ai',   t: '00:04', html: "Pulling Unit 4423. Last B-end inspection 14 days ago. <b>Most likely cause: leaking angle cock gasket on car 6.</b>" },
    { who: 'tech', t: '00:18', html: "Where's the part?" },
    { who: 'ai',   t: '00:20', html: "Gasket <b>P/N 9120-44A</b>. Two in stock at Yard 7. Reserved one — want me to walk you through the swap?" },
  ];
  var transcriptEl = document.getElementById('ph-transcript');
  var step = 0;

  function renderTranscript() {
    var html = '';
    var shown = Math.min(step, TRANSCRIPT.length);
    for (var i = 0; i < shown; i++) {
      var m = TRANSCRIPT[i];
      var who = m.who === 'ai' ? 'Railio' : 'Tech JM';
      var avTxt = m.who === 'ai' ? 'R' : 'JM';
      html += '<div class="ph-msg ' + m.who + '">'
            +   '<span class="av">' + avTxt + '</span>'
            +   '<div class="bub"><div>' + m.html + '</div>'
            +     '<span class="ts">' + who + ' · ' + m.t + '</span>'
            +   '</div>'
            + '</div>';
    }
    if (step < TRANSCRIPT.length) {
      html += '<div class="ph-msg ai"><span class="av">R</span>'
            + '<div class="bub"><span class="typing"><i></i><i></i><i></i></span></div></div>';
    }
    transcriptEl.innerHTML = html;
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
      sub: 'Voice in. Railio cross-references unit history, OEM manuals, and 90 days of similar faults across the fleet.',
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
      sub: 'Step by step from the actual maintenance manual. Tech says "next" or "back". Torque values appear when needed.',
      panel: { kind: 'checks', left: 'PROCEDURE', right: 'AAR §4.2.7', items: [
        { done: true,  label: 'Isolate angle cocks, both ends' },
        { done: true,  label: 'Bleed reservoir to 0 PSI' },
        { done: true,  label: 'Remove old gasket P/N 9120-44A' },
        { done: false, now: true, label: 'Install new gasket — torque 18 ft-lb' },
        { done: false, label: 'Pressure-test 90 PSI · hold 60s' }
      ]}
    },
    {
      num: '03', k: 'Document',
      title: 'The paperwork files itself.',
      sub: 'FRA F6180.49A and your CMMS work order drafted from the voice transcript and steps actually completed. Sign off in 30 seconds.',
      panel: { kind: 'form', left: 'FRA F6180.49A', right: 'DRAFT — READY', rows: [
        ['Unit',    '4423'],
        ['Defect',  'Air brake — gasket leak, car 6 B-end'],
        ['Repair',  'Replaced gasket P/N 9120-44A'],
        ['Tested',  '90 PSI · 60s · pass'],
        ['Filed',   '02:24 — auto from session']
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
    } else if (p.kind === 'form') {
      inner += '<div class="formdoc">';
      p.rows.forEach(function (r) {
        inner += '<div class="frow"><span class="k">' + escHtml(r[0]) + '</span><span>' + escHtml(r[1]) + '</span></div>';
      });
      inner += '<div class="stamp"><span style="color:#6B6B6B">Signed · Tech JM · 02:24</span><span class="ok">Filed ✓</span></div>';
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
      +   '<span class="arrow">→</span>'
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
