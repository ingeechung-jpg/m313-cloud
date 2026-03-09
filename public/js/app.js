  var APP_CONFIG = window.__APP_CONFIG__ || {};

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    }).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function callBackend(method, args, onSuccess, onFailure) {
    if (window.google && google.script && google.script.run) {
      var runner = google.script.run.withSuccessHandler(onSuccess || function() {});
      if (onFailure) runner = runner.withFailureHandler(onFailure);
      runner[method].apply(runner, args || []);
      return;
    }

    if (!APP_CONFIG.apiBase) {
      if (onFailure) onFailure(new Error('Cloud API base is not configured.'));
      return;
    }

    var payload = { method: method, args: args || [] };
    postJson(APP_CONFIG.apiBase, payload)
      .then(function(data) { if (onSuccess) onSuccess(data); })
      .catch(function(err) { if (onFailure) onFailure(err); });
  }

  /* ── UTILS ── */
  function esc(str) {
    if (str == null) return '';
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(String(str)));
    return d.innerHTML;
  }

  function encodeFootnoteId(rawId) {
    var raw = String(rawId == null ? '' : rawId).trim();
    return raw ? encodeURIComponent(raw) : '';
  }

  function decodeFootnoteId(encodedId) {
    try { return decodeURIComponent(String(encodedId || '')); } catch (_) { return String(encodedId || ''); }
  }

  var _relayoutRafId = 0;
  var _noteImageObserver = null;
  function scheduleRelayoutOpenNoteFootnotes() {
    if (_relayoutRafId) return;
    _relayoutRafId = window.requestAnimationFrame(function() {
      _relayoutRafId = 0;
      relayoutOpenNoteFootnotes();
    });
  }

  function getNoteImageObserver() {
    if (_noteImageObserver) return _noteImageObserver;
    if (!('IntersectionObserver' in window)) return null;
    _noteImageObserver = new IntersectionObserver(function(entries) {
      var grouped = {};
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        var img = entry.target;
        if (!img || img.getAttribute('data-loaded') === '1' || img.getAttribute('data-loading') === '1') return;
        var itemKey = img.getAttribute('data-note-item-key') || '';
        var password = img.getAttribute('data-note-password') || '';
        var idx = parseInt(img.getAttribute('data-note-img-index'), 10);
        if (!itemKey || !idx) return;
        var groupKey = itemKey + '::' + password;
        if (!grouped[groupKey]) grouped[groupKey] = { itemKey: itemKey, password: password, indexes: [], byIndex: {} };
        if (grouped[groupKey].indexes.indexOf(idx) === -1) grouped[groupKey].indexes.push(idx);
        if (!grouped[groupKey].byIndex[idx]) grouped[groupKey].byIndex[idx] = [];
        grouped[groupKey].byIndex[idx].push(img);
      });

      Object.keys(grouped).forEach(function(key) {
        var g = grouped[key];
        g.indexes.forEach(function(idx) {
          (g.byIndex[idx] || []).forEach(function(img) { img.setAttribute('data-loading', '1'); });
        });

        callBackend('getProtectedNoteInlineImages', [g.itemKey, g.indexes, g.password || ''], function(res) {
            var sources = (res && res.ok && res.sources) ? res.sources : {};
            g.indexes.forEach(function(idx) {
              var src = sources[String(idx)] || sources[idx];
              var list = g.byIndex[idx] || [];
              list.forEach(function(img) {
                if (src) {
                  img.addEventListener('load', function(e) {
                    var el = e && e.target;
                    if (el) {
                      el.classList.remove('is-loading');
                      el.setAttribute('data-loaded', '1');
                      el.removeAttribute('data-loading');
                    }
                    scheduleRelayoutOpenNoteFootnotes();
                  }, { once: true });
                  img.src = src;
                } else {
                  img.removeAttribute('data-loading');
                }
              });
            });
            scheduleRelayoutOpenNoteFootnotes();
          }, function() {
            g.indexes.forEach(function(idx) {
              (g.byIndex[idx] || []).forEach(function(img) { img.removeAttribute('data-loading'); });
            });
          });
      });
    }, { root: null, rootMargin: '240px 0px', threshold: 0.01 });
    return _noteImageObserver;
  }

  function initWebGLBackground() {
    var canvas = document.getElementById('gradient-canvas');
    if (!canvas) return;
    var gl = canvas.getContext('webgl', {
      alpha: true, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'
    }) || canvas.getContext('experimental-webgl');
    if (!gl) return;

    function compileShader(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(shader)); return null; }
      return shader;
    }

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width  = Math.floor(window.innerWidth  * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    window.addEventListener('resize', resize, { passive: true });
    resize();

    var vertexSource = [
      'attribute vec2 a_pos;',
      'void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }'
    ].join('\n');

    var fragmentSource = [
      'precision highp float;',
      'uniform float u_time; uniform vec2 u_res; uniform float u_speed;',
      'uniform int u_src; uniform float u_rings; uniform float u_spread;',
      'uniform int u_palCount; uniform vec3 u_pal[8];',
      'vec3 paletteSample(float t) {',
      '  t = clamp(t,0.0,1.0); float n=float(u_palCount-1); float idx=t*n; int i0=int(idx); float f=idx-float(i0);',
      '  vec3 a=u_pal[0]; vec3 b=u_pal[1];',
      '  if(i0==1){a=u_pal[1];b=u_pal[2];} if(i0==2){a=u_pal[2];b=u_pal[3];}',
      '  if(i0==3){a=u_pal[3];b=u_pal[4];} if(i0==4){a=u_pal[4];b=u_pal[5];}',
      '  if(i0==5){a=u_pal[5];b=u_pal[6];} if(i0==6){a=u_pal[6];b=u_pal[7];}',
      '  return mix(a,b,f);',
      '}',
      'vec3 ripple(float d, float tOff) {',
      '  float t=u_time*u_speed+tOff;',
      '  float wave=sin(d*u_rings*3.14159-t*3.0)*0.5+0.5;',
      '  float shimmer=sin(d*u_rings*3.14159*1.7-t*2.1+tOff)*0.5+0.5;',
      '  return paletteSample((wave*0.68+shimmer*0.32)*exp(-d*1.8*u_spread));',
      '}',
      'void main(){',
      '  vec2 uv=gl_FragCoord.xy/u_res.xy; vec2 asp=vec2(u_res.x/u_res.y,1.0);',
      '  vec3 col=vec3(0.0); float totalW=0.0;',
      '  for(int i=0;i<8;i++){',
      '    if(i>=u_src) break;',
      '    float fi=float(i); float n=float(u_src);',
      '    float ang=(fi/n)*6.28318+u_time*u_speed*(0.12+fi*0.07);',
      '    float orb=(u_src==1)?0.0:(0.28+0.12*sin(u_time*u_speed*0.3+fi*1.3));',
      '    vec2 center=clamp(vec2(0.5)+vec2(cos(ang),sin(ang))*orb/asp,0.0,1.0);',
      '    float dist=length((uv-center)*asp);',
      '    float tOff=fi*2.39996;',
      '    float w=exp(-dist*1.2*u_spread);',
      '    col+=ripple(dist,tOff)*w; totalW+=w;',
      '  }',
      '  gl_FragColor=vec4(col/max(totalW,0.001),1.0);',
      '}'
    ].join('\n');

    var vert = compileShader(gl.VERTEX_SHADER, vertexSource);
    var frag = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vert || !frag) return;

    var program = gl.createProgram();
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,-1,1,1,-1,1]), gl.STATIC_DRAW);
    var posLoc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    var uTime=gl.getUniformLocation(program,'u_time'), uRes=gl.getUniformLocation(program,'u_res'),
        uSpeed=gl.getUniformLocation(program,'u_speed'), uSrc=gl.getUniformLocation(program,'u_src'),
        uRings=gl.getUniformLocation(program,'u_rings'), uSpread=gl.getUniformLocation(program,'u_spread'),
        uPalCount=gl.getUniformLocation(program,'u_palCount'), uPal=gl.getUniformLocation(program,'u_pal');

    function hexToRgb01(hex) {
      var v = parseInt(hex.slice(1), 16);
      return [((v>>16)&255)/255, ((v>>8)&255)/255, (v&255)/255];
    }
    var palette = ['#c8c8c8','#fcfcfc'];
    var flat = [];
    for (var i = 0; i < 8; i++) {
      var rgb = hexToRgb01(palette[Math.min(i, palette.length-1)]);
      flat.push(rgb[0], rgb[1], rgb[2]);
    }
    gl.uniform1i(uPalCount, palette.length);
    gl.uniform3fv(uPal, new Float32Array(flat));
    gl.uniform1f(uSpeed, 0.5);
    gl.uniform1i(uSrc, 1);
    gl.uniform1f(uRings, 7.0);
    gl.uniform1f(uSpread, 0.5);

    var rafId = 0;
    function frame(ts) {
      gl.uniform1f(uTime, ts*0.001);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafId = requestAnimationFrame(frame);
    }
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) { if (rafId) cancelAnimationFrame(rafId); rafId=0; return; }
      if (!rafId) rafId = requestAnimationFrame(frame);
    });
    canvas.addEventListener('webglcontextlost', function(e) {
      e.preventDefault(); if (rafId) cancelAnimationFrame(rafId); rafId=0;
    });
    rafId = requestAnimationFrame(frame);
  }

  function initCalendarPopupToggle() {
    var scheduleBtn=null, initialized=false, rafSyncId=0;

    function requestSync() {
      if (rafSyncId) return;
      rafSyncId = requestAnimationFrame(function() {
        rafSyncId = 0;
        if (!scheduleBtn || !document.body.contains(scheduleBtn)) { initialized=false; scheduleBtn=null; }
        bindScheduleButton(); syncLabel();
      });
    }

    function keepButtonTopLayer() {
      if (!scheduleBtn) return;
      if (scheduleBtn.parentNode !== document.body) document.body.appendChild(scheduleBtn);
      scheduleBtn.style.zIndex = '2147483647';
    }

    function isOpen() { return !!document.querySelector('.hur54b'); }

    function closePopup() {
      var closeBtn = document.querySelector('.Xfsokf');
      if (closeBtn) { closeBtn.click(); return; }
      var backdrop = document.querySelector('.hur54b');
      if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function syncLabel() {
      if (!scheduleBtn) return;
      keepButtonTopLayer();
      if (!scheduleBtn.dataset.originalLabel) {
        scheduleBtn.dataset.originalLabel = (scheduleBtn.textContent || '일정 예약').trim() || '일정 예약';
      }
      var opened = isOpen();
      scheduleBtn.textContent = opened ? '닫기' : scheduleBtn.dataset.originalLabel;
      scheduleBtn.classList.toggle('is-close', opened);
    }

    function bindScheduleButton() {
      if (initialized) return;
      scheduleBtn = document.querySelector('.qxCTlb');
      if (!scheduleBtn) return;
      keepButtonTopLayer();
      scheduleBtn.addEventListener('click', function(e) {
        if (!isOpen()) return;
        e.preventDefault(); e.stopPropagation(); closePopup();
      }, true);
      initialized = true;
      syncLabel();
    }

    var observer = new MutationObserver(function() { requestSync(); });
    observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
    requestSync();
  }

  /* ── STATE ── */
  var _sections = {
    courses:     { active:[], all:[], showingAll:false, listId:'course-list',      buttonId:'view-all-btn',             emptyText:'No courses found.' },
    exhibitions: { active:[], all:[], showingAll:false, listId:'exhibitions-list', buttonId:'view-all-exhibitions-btn', emptyText:'No exhibitions found.' },
    projects:    { active:[], all:[], showingAll:false, listId:'projects-list',    buttonId:'view-all-projects-btn',    emptyText:'No projects found.' },
    notes:       { active:[], all:[], showingAll:false, listId:'notes-list',       buttonId:'view-all-notes-btn',       emptyText:'No notes found.' }
  };
  var _driveModalState = { sectionKey:'', itemKey:'', title:'', requiresPassword:true };
  var _filters = { query:'', year:'all', section:'all' };

  /* ── PROFILE ── */
  function renderProfile(data) {
    var n = document.getElementById('p-name');
    n.textContent = data.profile.name;
    n.classList.add('loaded');

    var e = document.getElementById('p-email');
    e.classList.remove('meta-loading');
    e.innerHTML = data.profile.email
      ? '<a href="mailto:' + esc(data.profile.email) + '">' + esc(data.profile.email) + '</a>'
      : '—';

    if (data.profile.instagram) {
      var ig = data.profile.instagram;
      var handle = ig.startsWith('@') ? ig : '@' + ig;
      var igUrl = ig.startsWith('http') ? ig : 'https://instagram.com/' + ig.replace('@','');
      document.getElementById('p-instagram').innerHTML =
        '<a href="' + esc(igUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(handle) + '</a>';
      document.getElementById('meta-instagram').style.display = 'grid';
    }

    if (data.profile.website) {
      var url  = data.profile.website;
      var disp = url.replace(/^https?:\/\//,'').replace(/\/$/,'');
      var href = url.startsWith('http') ? url : 'https://' + url;
      document.getElementById('p-website').innerHTML =
        '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(disp) + '</a>';
      document.getElementById('meta-website').style.display = 'grid';
    }
  }

  /* ── MARKDOWN ── */
  function markdownToHtml(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var footnotes = {};
    var bodyLines = [];
    var autoFootnoteSeq = 0;
    function parseFootnoteDef(line) {
      var s = String(line || '');
      var m = s.match(/^\s*\[\^([^\]]+)\]\s*[:：]\s*(.*)$/);
      if (!m) m = s.match(/^\s*\[([0-9]+)\]\s*[:：]\s*(.*)$/);
      if (!m) m = s.match(/^\s*\[([0-9]+)\]\s*(.+)$/);
      if (!m) m = s.match(/^\s*［\^?([^\]］]+)］\s*[:：]\s*(.*)$/);   /* full-width [] + colon */
      if (!m) m = s.match(/^\s*［([0-9]+)］\s*(.+)$/);               /* full-width [] without colon */
      if (!m) return null;
      var id = encodeFootnoteId(m[1]);
      if (!id) {
        autoFootnoteSeq += 1;
        id = 'fn-' + autoFootnoteSeq;
      }
      return { id: id, text: m[2] || '' };
    }
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var def = parseFootnoteDef(line);
      if (!def) { bodyLines.push(line); continue; }
      var fid = def.id;
      var defParts = [def.text];
      while (li + 1 < lines.length && (/^\s{2,}\S/.test(lines[li + 1]) || /^\t+\S/.test(lines[li + 1]))) {
        li++;
        defParts.push(lines[li].replace(/^\s+/, ''));
      }
      footnotes[fid] = defParts.join(' ').trim();
    }
    lines = bodyLines;
    var html = '';
    var inList = false, listTag = '';
    var paraLines = [];

    function flushPara() {
      if (!paraLines.length) return;
      var text = paraLines.join(' ').trim();
      paraLines = [];
      if (!text) return;
      html += '<p>' + inlineFormat(text) + '</p>\n';
    }

    function flushList() {
      if (!inList) return;
      html += '</' + listTag + '>\n';
      inList = false; listTag = '';
    }

    function inlineFormat(text) {
      var t = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      t = t.replace(/!\[([^\]]*)\]\(noteimg:\/\/(\d+)(?:\?ar=([0-9.]+))?\)/g, function(_, alt, idx, ar) {
        var ratio = parseFloat(ar);
        var arStyle = (isFinite(ratio) && ratio > 0) ? (' style="--ar:' + ratio + ';"') : '';
        return '<figure><img class="note-inline-img is-loading" data-note-img-index="' + idx + '" alt="' + alt + '" loading="lazy" decoding="async"' + arStyle + '><figcaption>' + alt + '</figcaption></figure>';
      });
      t = t.replace(/!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/[a-zA-Z0-9.+-]+;base64,)[^\s)]+)\)/g,
        '<figure><img src="$2" alt="$1" loading="lazy" decoding="async"><figcaption>$1</figcaption></figure>');
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      t = t.replace(/\[\^([^\]]+)\]/g, function(_, id) {
        var safeId = encodeFootnoteId(id);
        if (!safeId) return '';
        var viewId = decodeFootnoteId(safeId);
        return '<sup class="note-fn-ref" data-fn-id="' + safeId + '">[' + esc(viewId) + ']</sup>';
      });
      t = t.replace(/［\^?([^\]］]+)］/g, function(_, id) {
        var safeId = encodeFootnoteId(id);
        if (!safeId) return '';
        var viewId = decodeFootnoteId(safeId);
        return '<sup class="note-fn-ref" data-fn-id="' + safeId + '">[' + esc(viewId) + ']</sup>';
      });
      t = t.replace(/\[([0-9]+)\](?!\()/g, function(_, id) {
        var safeId = encodeFootnoteId(id);
        if (!safeId) return '';
        return '<sup class="note-fn-ref" data-fn-id="' + safeId + '">[' + esc(id) + ']</sup>';
      });
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/__([^_]+)__/g,     '<strong>$1</strong>');
      t = t.replace(/\*([^*]+)\*/g,     '<em>$1</em>');
      t = t.replace(/_([^_]+)_/g,       '<em>$1</em>');
      return t;
    }

    function renderGallery(mode, galleryLines) {
      var figures = [];
      for (var gi = 0; gi < galleryLines.length; gi++) {
        var line = (galleryLines[gi] || '').trim();
        if (!line) continue;
        var m = line.match(/^!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/[a-zA-Z0-9.+-]+;base64,)[^\s)]+)\)$/);
        if (!m) continue;
        figures.push('<figure><img src="' + m[2] + '" alt="' + esc(m[1]) + '"><figcaption>' + esc(m[1]) + '</figcaption></figure>');
      }
      if (!figures.length) return '';
      return '<div class="note-gallery note-gallery--' + mode + '">' + figures.join('') + '</div>\n';
    }

    var galleryMode = '';
    var galleryLines = [];

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].trimEnd();
      var rawTrim = raw.trim();

      // gallery block start/end
      if (!galleryMode) {
        var gs = rawTrim.match(/^:::(one|two)$/i);
        if (gs) {
          flushPara(); flushList();
          galleryMode = gs[1].toLowerCase();
          galleryLines = [];
          continue;
        }
      } else {
        if (/^:::$/.test(rawTrim)) {
          html += renderGallery(galleryMode, galleryLines);
          galleryMode = '';
          galleryLines = [];
          continue;
        }
        if (rawTrim === '' || /^!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/[a-zA-Z0-9.+-]+;base64,)[^\s)]+)\)$/.test(rawTrim)) {
          galleryLines.push(raw);
          continue;
        }
        // implicit close: non-image content starts, close gallery first and keep parsing this line normally
        html += renderGallery(galleryMode, galleryLines);
        galleryMode = '';
        galleryLines = [];
      }

      // heading
      var hMatch = raw.match(/^(#{1,3})\s+(.+)/);
      if (hMatch) {
        flushPara(); flushList();
        var level = hMatch[1].length;
        html += '<h' + level + '>' + inlineFormat(hMatch[2]) + '</h' + level + '>\n';
        continue;
      }

      // hr
      if (/^(-{3,}|\*{3,})$/.test(raw.trim())) {
        flushPara(); flushList();
        html += '<hr>\n';
        continue;
      }

      // unordered list
      var ulMatch = raw.match(/^[-*+]\s+(.*)/);
      if (ulMatch) {
        flushPara();
        if (!inList || listTag !== 'ul') { flushList(); html += '<ul>\n'; inList=true; listTag='ul'; }
        html += '<li>' + inlineFormat(ulMatch[1]) + '</li>\n';
        continue;
      }

      // ordered list
      var olMatch = raw.match(/^\d+\.\s+(.*)/);
      if (olMatch) {
        flushPara();
        if (!inList || listTag !== 'ol') { flushList(); html += '<ol>\n'; inList=true; listTag='ol'; }
        html += '<li>' + inlineFormat(olMatch[1]) + '</li>\n';
        continue;
      }

      // blank line
      if (raw.trim() === '') { flushPara(); flushList(); continue; }

      // standalone image line
      if (/^!\[([^\]]*)\]\(((?:https?:\/\/|data:image\/[a-zA-Z0-9.+-]+;base64,)[^\s)]+)\)$/.test(rawTrim)) {
        flushPara(); flushList();
        html += inlineFormat(rawTrim) + '\n';
        continue;
      }

      // normal text
      flushList();
      paraLines.push(raw);
    }

    if (galleryMode) html += renderGallery(galleryMode, galleryLines);
    flushPara(); flushList();
    return { html: html, footnotes: footnotes };
  }

  function layoutNoteFootnotes(targetEl, footnotes) {
    if (!targetEl) return;
    var detail = targetEl.closest('.note-detail');
    if (!detail) return;
    var label = detail.querySelector('.note-detail__label');
    var prose = targetEl.querySelector('.note-prose');
    if (!label || !prose) return;
    var isMobile = window.matchMedia('(max-width: 800px)').matches;
    var oldBottom = targetEl.querySelector('.note-footnotes-bottom');
    if (oldBottom) oldBottom.remove();

    var refs = prose.querySelectorAll('.note-fn-ref[data-fn-id], .note-fn-anchor[data-fn-id]');
    var figures = prose.querySelectorAll('figure');
    label.innerHTML = '';
    if ((!refs.length || !footnotes) && !figures.length) return;

    var firstRefById = {};
    var anchors = [];
    for (var i = 0; i < refs.length; i++) {
      var id = refs[i].getAttribute('data-fn-id');
      if (!id || !footnotes[id]) continue;
      if (!firstRefById[id]) {
        firstRefById[id] = refs[i];
        anchors.push({
          id: id,
          kind: 'footnote',
          text: footnotes[id],
          refEl: refs[i],
          sourceOrder: i
        });
      }
    }
    if (footnotes) {
      Object.keys(footnotes).forEach(function(fid) {
        if (firstRefById[fid]) return;
        if (!footnotes[fid]) return;
        anchors.push({
          id: fid,
          kind: 'footnote',
          text: footnotes[fid],
          refEl: prose,
          sourceOrder: 9000
        });
      });
    }

    for (var fi = 0; fi < figures.length; fi++) {
      var cap = figures[fi].querySelector('figcaption');
      if (!cap) continue;
      var captionText = (cap.textContent || '').trim();
      if (!captionText) continue;
      anchors.push({
        id: 'img' + (fi + 1),
        kind: 'caption',
        text: captionText,
        refEl: figures[fi],
        sourceOrder: 1000 + fi
      });
    }
    if (!anchors.length) return;

    if (isMobile) {
      var footnoteItems = anchors.filter(function(a) { return a.kind === 'footnote'; });
      if (!footnoteItems.length) return;
      var bottom = document.createElement('div');
      bottom.className = 'note-footnotes-bottom';
      var seenMobile = {};
      footnoteItems.forEach(function(a) {
        if (seenMobile[a.id]) return;
        seenMobile[a.id] = true;
        var item = document.createElement('div');
        item.className = 'note-footnotes-bottom__item';
        var viewLabel = decodeFootnoteId(a.id);
        item.innerHTML = '<span class="note-footnotes-bottom__num">[' + esc(viewLabel) + ']</span><span class="note-footnotes-bottom__text">' + esc(a.text) + '</span>';
        bottom.appendChild(item);
      });
      if (bottom.childElementCount) targetEl.appendChild(bottom);
      return;
    }

    var side = document.createElement('div');
    side.className = 'note-sidenotes';
    label.appendChild(side);

    var proseRect = prose.getBoundingClientRect();
    for (var ai = 0; ai < anchors.length; ai++) {
      var rect = anchors[ai].refEl.getBoundingClientRect();
      anchors[ai].desiredTop = anchors[ai].kind === 'caption'
        ? Math.max(0, rect.top - proseRect.top)
        : Math.max(0, rect.top - proseRect.top - 2);
    }
    anchors.sort(function(a, b) {
      if (Math.abs(a.desiredTop - b.desiredTop) > 1) return a.desiredTop - b.desiredTop;
      if (a.kind !== b.kind) return a.kind === 'footnote' ? -1 : 1;
      return a.sourceOrder - b.sourceOrder;
    });

    var items = [];
    for (var j = 0; j < anchors.length; j++) {
      var anchor = anchors[j];
      var item = document.createElement('div');
      item.className = 'note-sidenote' + (anchor.kind === 'caption' ? ' note-sidenote--caption' : '');
      var viewLabel = anchor.kind === 'caption' ? anchor.id : decodeFootnoteId(anchor.id);
      item.innerHTML = '<span class="note-sidenote__num">[' + esc(viewLabel) + ']</span><span class="note-sidenote__text">' + esc(anchor.text) + '</span>';
      side.appendChild(item);
      items.push({ kind: anchor.kind, desiredTop: anchor.desiredTop, el: item });
    }

    var cursor = 0;
    for (var k = 0; k < items.length; k++) {
      var desiredTop = items[k].desiredTop;
      var top = Math.max(desiredTop, cursor);
      items[k].el.style.top = top + 'px';
      cursor = top + items[k].el.offsetHeight + 8;
    }
    side.style.minHeight = cursor + 'px';
  }

  function bindNoteMediaRelayout(targetEl) {
    if (!targetEl) return;
    var imgs = targetEl.querySelectorAll('.note-prose img');
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].complete) continue;
      imgs[i].addEventListener('load', function(e) {
        var el = e && e.target;
        if (el) el.classList.remove('is-loading');
        scheduleRelayoutOpenNoteFootnotes();
      }, { once: true });
      imgs[i].addEventListener('error', scheduleRelayoutOpenNoteFootnotes, { once: true });
    }
  }

  function hydrateInlineNoteImages(targetEl, itemKey, password) {
    if (!targetEl) return;
    var imgs = targetEl.querySelectorAll('img.note-inline-img[data-note-img-index]');
    var observer = getNoteImageObserver();
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      if (img.getAttribute('data-loaded') === '1' || img.getAttribute('data-loading') === '1') continue;
      img.setAttribute('data-note-item-key', itemKey || '');
      img.setAttribute('data-note-password', password || '');
      if (observer) observer.observe(img);
    }
    if (!observer) {
      // Fallback (no IntersectionObserver): load only first 2 images first.
      var eager = [];
      for (var j = 0; j < imgs.length; j++) {
        var idx = parseInt(imgs[j].getAttribute('data-note-img-index'), 10);
        if (idx && eager.indexOf(idx) === -1) eager.push(idx);
        if (eager.length >= 2) break;
      }
      if (!eager.length) return;
      callBackend('getProtectedNoteInlineImages', [itemKey, eager, password || ''], function(res) {
          var sources = (res && res.ok && res.sources) ? res.sources : {};
          for (var k = 0; k < imgs.length; k++) {
            var n = parseInt(imgs[k].getAttribute('data-note-img-index'), 10);
            if (!n || eager.indexOf(n) === -1) continue;
            var src = sources[String(n)] || sources[n];
            if (!src) continue;
            imgs[k].addEventListener('load', function(e) {
              var el = e && e.target;
              if (el) el.classList.remove('is-loading');
              scheduleRelayoutOpenNoteFootnotes();
            }, { once: true });
            imgs[k].src = src;
            imgs[k].setAttribute('data-loaded', '1');
          }
        });
    }
  }

  function relayoutOpenNoteFootnotes() {
    var targets = document.querySelectorAll('.note-detail:not([hidden]) [data-note-content][data-note-footnotes]');
    for (var i = 0; i < targets.length; i++) {
      var json = targets[i].getAttribute('data-note-footnotes');
      if (!json) continue;
      try { layoutNoteFootnotes(targets[i], JSON.parse(json)); } catch (_) {}
    }
  }

  function loadNoteContent(itemKey, password, targetEl) {
    callBackend('getProtectedNoteContent', [itemKey, password || ''], function(res) {
        if (!res || !res.ok || !res.markdown) {
          targetEl.innerHTML = '<span style="color:var(--muted)">' + esc((res && res.message) || '본문을 불러오지 못했습니다.') + '</span>';
          return;
        }
        var rendered = markdownToHtml(res.markdown);
        targetEl.innerHTML = '<div class="note-prose">' + rendered.html + '</div>';
        targetEl.setAttribute('data-note-footnotes', JSON.stringify(rendered.footnotes || {}));
        hydrateInlineNoteImages(targetEl, itemKey, password || '');
        layoutNoteFootnotes(targetEl, rendered.footnotes || {});
        bindNoteMediaRelayout(targetEl);
      }, function(err) {
        targetEl.innerHTML = '<span style="color:#c00">' + esc('오류: ' + (err && err.message ? err.message : String(err))) + '</span>';
      });
  }

  /* ── NOTE ROW CLICKS (아코디언: 하나 열면 나머지 닫힘) ── */
  function closeAllNotes(exceptItemKey) {
    var openDetails = document.querySelectorAll('.note-detail:not([hidden])');
    for (var i = 0; i < openDetails.length; i++) {
      var detail = openDetails[i];
      var id = detail.id.replace('note-detail-', '');
      if (id === exceptItemKey) continue;
      detail.setAttribute('hidden', 'hidden');
      var row = document.querySelector('.note-row[data-item-key="' + id + '"]');
      if (row) row.classList.remove('is-open');
    }
  }

  function initNoteRowClicks() {
    document.addEventListener('click', function(e) {
      var row = e.target.closest('.note-row');
      if (!row) return;

      var itemKey          = row.getAttribute('data-item-key');
      var requiresPassword = row.getAttribute('data-requires-password') === '1';
      var detail           = document.getElementById('note-detail-' + itemKey);
      if (!detail) return;

      var isOpen = !detail.hasAttribute('hidden');

      // 이미 열려있으면 닫기
      if (isOpen) {
        detail.setAttribute('hidden', 'hidden');
        row.classList.remove('is-open');
        return;
      }

      // 다른 열린 노트 닫기
      closeAllNotes(itemKey);

      // 현재 노트 열기
      detail.removeAttribute('hidden');
      row.classList.add('is-open');

      var contentEl = detail.querySelector('[data-note-content="' + itemKey + '"]');
      if (!contentEl) return;
      if (contentEl.getAttribute('data-loaded') === '1') {
        scheduleRelayoutOpenNoteFootnotes();
        return;
      }

      var password = '';
      if (requiresPassword) {
        password = window.prompt('비밀번호를 입력하세요.') || '';
        if (!password) {
          contentEl.innerHTML = '<span style="color:var(--muted)">비밀번호를 입력해야 본문을 볼 수 있습니다.</span>';
          return;
        }
      }
      contentEl.innerHTML = '<span style="color:var(--muted)">불러오는 중...</span>';
      loadNoteContent(itemKey, password, contentEl);
      contentEl.setAttribute('data-loaded', '1');
    });
  }

  /* ── LIST RENDER ── */
  function renderNotesSection(list, emptyTextOverride) {
    var el = document.getElementById(_sections.notes.listId);
    if (!el) return;

    if (!list || list.length === 0) {
      el.innerHTML = '<p class="state-msg">' + esc(emptyTextOverride || _sections.notes.emptyText) + '</p>';
      return;
    }

    el.innerHTML = list.map(function(item) {
      var passBadge = item.requiresPassword ? '<span class="note-row__lock">Locked</span>' : '';
      return (
        '<div class="note-item" data-item-key="' + esc(item.itemKey) + '">' +
          '<button class="note-row" type="button" data-item-key="' + esc(item.itemKey) + '" data-requires-password="' + (item.requiresPassword ? '1' : '0') + '">' +
            '<span class="note-row__year">' + esc(item.year || '—') + '</span>' +
            '<span class="note-row__title">' + esc(item.title) + passBadge + '</span>' +
          '</button>' +
          '<div class="note-detail" id="note-detail-' + esc(item.itemKey) + '" hidden>' +
            '<div class="note-detail__row">' +
              '<span class="note-detail__label"></span>' +
              '<div data-note-content="' + esc(item.itemKey) + '"></div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderSection(sectionKey, list, emptyTextOverride) {
    if (sectionKey === 'notes') { renderNotesSection(list, emptyTextOverride); return; }
    var section = _sections[sectionKey];
    if (!section) return;
    var el = document.getElementById(section.listId);
    if (!el) return;

    if (!list || list.length === 0) {
      el.innerHTML = '<p class="state-msg">' + esc(emptyTextOverride || section.emptyText) + '</p>';
      return;
    }

    el.innerHTML = list.map(function(item) {
      var lnk = item.hasDrive
        ? '<button class="course-row__link-btn" type="button" data-title="' + esc(item.title) + '" data-section="' + esc(sectionKey) + '" data-item-key="' + esc(item.itemKey) + '" data-requires-password="' + (item.requiresPassword ? '1' : '0') + '" onclick="openDriveModal(this)">↗ Drive</button>'
        : '<span class="course-row__nolink">—</span>';
      return (
        '<div class="course-row">' +
          '<div class="course-row__year-title">' +
            '<span class="course-row__year">' + esc(item.year || '—') + '</span>' +
            '<span class="course-row__title">' + esc(item.title) + '</span>' +
          '</div>' +
          '<div class="course-row__main">' +
            '<span class="course-row__code"' + (!item.code ? ' style="color:#ccc"' : '') + '>' + esc(item.code || '—') + '</span>' +
            '<span class="course-row__location"' + (!item.location ? ' style="color:#ccc"' : '') + '>' + esc(item.location || '—') + '</span>' +
          '</div>' +
          '<span class="course-row__action">' + lnk + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function toggleSection(sectionKey) {
    var section = _sections[sectionKey];
    if (!section) return;
    section.showingAll = !section.showingAll;
    applyFiltersAndRenderAll();
    var btn = document.getElementById(section.buttonId);
    if (btn) btn.textContent = section.showingAll ? 'Close' : 'View All';
  }

  function toggleViewAll() { toggleSection('courses'); }

  function applySectionOrder(sectionOrder) {
    var container = document.getElementById('dynamic-sections');
    if (!container || !sectionOrder || !sectionOrder.length) return;
    var sectionIdByKey = { courses:'section-courses', exhibitions:'section-exhibitions', projects:'section-projects', notes:'section-notes' };
    sectionOrder.forEach(function(key) {
      var node = document.getElementById(sectionIdByKey[key]);
      if (node) container.appendChild(node);
    });
  }

  function getBaseList(sectionKey) {
    var s = _sections[sectionKey];
    return s ? (s.showingAll ? s.all : s.active) : [];
  }

  function matchesFilter(item, sectionKey) {
    if (_filters.section !== 'all' && _filters.section !== sectionKey) return false;
    if (_filters.year !== 'all' && String(item.year || '') !== _filters.year) return false;
    if (!_filters.query) return true;
    return [item.title||'', item.code||'', item.location||'', item.year||''].join(' ').toLowerCase().indexOf(_filters.query) !== -1;
  }

  function applyFiltersAndRenderAll() {
    ['courses','exhibitions','projects','notes'].forEach(function(key) {
      var filtered = getBaseList(key).filter(function(item) { return matchesFilter(item, key); });
      var hasFilter = _filters.query || _filters.year !== 'all' || _filters.section !== 'all';
      renderSection(key, filtered, hasFilter ? 'No results found.' : null);
    });
  }

  function buildYearFilterOptions(data) {
    var yearSelect = document.getElementById('filter-year');
    if (!yearSelect) return;
    var seen = {};
    [].concat(data.allCourses||[], data.allExhibitions||[], data.allProjects||[], data.allNotes||[]).forEach(function(item) {
      var y = String(item.year||'').trim(); if (y) seen[y] = true;
    });
    var years = Object.keys(seen).sort(function(a,b) { return b.localeCompare(a, undefined, {numeric:true, sensitivity:'base'}); });
    yearSelect.innerHTML = '<option value="all">All Years</option>' +
      years.map(function(y) { return '<option value="' + esc(y) + '">' + esc(y) + '</option>'; }).join('');
  }

  function initFilters() {
    var qi = document.getElementById('filter-query');
    var ys = document.getElementById('filter-year');
    var ss = document.getElementById('filter-section');
    var rb = document.getElementById('filter-reset');
    if (!qi || !ys || !ss || !rb) return;

    qi.addEventListener('input', function() { _filters.query = (qi.value||'').trim().toLowerCase(); applyFiltersAndRenderAll(); });
    ys.addEventListener('change', function() { _filters.year = ys.value||'all'; applyFiltersAndRenderAll(); });
    ss.addEventListener('change', function() { _filters.section = ss.value||'all'; applyFiltersAndRenderAll(); });
    rb.addEventListener('click', function() {
      _filters = {query:'', year:'all', section:'all'};
      qi.value=''; ys.value='all'; ss.value='all';
      applyFiltersAndRenderAll();
    });
  }

  function showDashboardError(msg) {
    var n = document.getElementById('p-name');
    n.textContent = 'ERROR'; n.style.color = '#c00'; n.classList.add('loaded');
    var e = document.getElementById('p-email');
    e.textContent = msg; e.style.color = '#c00'; e.classList.remove('meta-loading');
    Object.keys(_sections).forEach(function(key) {
      var el = document.getElementById(_sections[key].listId);
      if (el) el.innerHTML = '<p class="state-msg state-msg--error">' + esc(msg) + '</p>';
    });
  }

  /* ── DRIVE MODAL ── */
  function openDriveModal(el) {
    var title            = el.getAttribute('data-title') || '';
    var sectionKey       = el.getAttribute('data-section') || '';
    var itemKey          = el.getAttribute('data-item-key') || '';
    var requiresPassword = el.getAttribute('data-requires-password') === '1';
    _driveModalState = { sectionKey:sectionKey, itemKey:itemKey, title:title, requiresPassword:requiresPassword };

    var descEl=document.getElementById('drive-modal-desc'),
        pwEl=document.getElementById('drive-modal-password'),
        subEl=document.getElementById('drive-modal-submit');
    document.getElementById('drive-modal-title').textContent = title;
    document.getElementById('drive-modal-error').textContent = '';
    pwEl.value = ''; subEl.disabled = false;

    if (requiresPassword) {
      descEl.textContent = '비밀번호를 입력하면 Google Drive 링크로 이동합니다.';
      pwEl.style.display = '';
    } else {
      descEl.textContent = '바로 Google Drive 링크를 엽니다.';
      pwEl.style.display = 'none';
    }
    subEl.style.display = ''; subEl.textContent = '↗ Open in Drive';
    document.getElementById('drive-modal-backdrop').classList.add('open');
    if (requiresPassword) pwEl.focus();
  }

  function openNoLinkModal(title) {
    _driveModalState = { sectionKey:'', itemKey:'', title:title||'', requiresPassword:false };
    document.getElementById('drive-modal-title').textContent = title || '안내';
    document.getElementById('drive-modal-error').textContent = '';
    document.getElementById('drive-modal-desc').textContent = '유효한 링크가 없습니다.';
    document.getElementById('drive-modal-password').style.display = 'none';
    document.getElementById('drive-modal-submit').style.display = 'none';
    document.getElementById('drive-modal-backdrop').classList.add('open');
  }

  function closeDriveModal() {
    document.getElementById('drive-modal-backdrop').classList.remove('open');
    document.getElementById('drive-modal-submit').style.display = '';
    _driveModalState = { sectionKey:'', itemKey:'', title:'', requiresPassword:true };
  }

  function onDriveBackdropClick(e) {
    if (e.target === document.getElementById('drive-modal-backdrop')) closeDriveModal();
  }

  function onDrivePasswordKeydown(e) {
    if (_driveModalState.requiresPassword && e.key === 'Enter') { e.preventDefault(); submitDrivePassword(); }
  }

  function submitDrivePassword() {
    if (!_driveModalState.sectionKey || !_driveModalState.itemKey) return;
    var pwEl  = document.getElementById('drive-modal-password');
    var subEl = document.getElementById('drive-modal-submit');
    var errEl = document.getElementById('drive-modal-error');
    var pw    = (pwEl.value || '').trim();

    if (_driveModalState.requiresPassword && !pw) { errEl.textContent = '비밀번호를 입력하세요.'; pwEl.focus(); return; }

    subEl.disabled = true;
    errEl.textContent = '확인 중...';

    callBackend('getProtectedDriveLink', [_driveModalState.sectionKey, _driveModalState.itemKey, pw], function(res) {
        subEl.disabled = false;
        if (!res || !res.ok || !res.url) {
          errEl.textContent = (res && res.message) ? res.message : '접근할 수 없습니다.';
          if (_driveModalState.requiresPassword) pwEl.focus();
          return;
        }
        window.open(res.url, '_blank', 'noopener,noreferrer');
        closeDriveModal();
      }, function(err) {
        subEl.disabled = false;
        errEl.textContent = '오류: ' + (err && err.message ? err.message : String(err));
        if (_driveModalState.requiresPassword) pwEl.focus();
      });
  }

  function hydrateDashboard(data) {
    if (!data || data.error) { showDashboardError(data ? data.error : 'Error'); return; }
    renderProfile(data);
    _sections.courses.active     = data.courses        || [];
    _sections.courses.all        = data.allCourses     || [];
    _sections.exhibitions.active = data.exhibitions    || [];
    _sections.exhibitions.all    = data.allExhibitions || [];
    _sections.projects.active    = data.projects       || [];
    _sections.projects.all       = data.allProjects    || [];
    _sections.notes.active       = data.notes          || [];
    _sections.notes.all          = data.allNotes       || [];
    applySectionOrder(data.sectionOrder || ['courses','exhibitions','projects','notes']);
    buildYearFilterOptions(data);
    applyFiltersAndRenderAll();
    ['view-all-btn','view-all-exhibitions-btn','view-all-projects-btn','view-all-notes-btn'].forEach(function(id) {
      var btn = document.getElementById(id); if (btn) btn.textContent = 'View All';
    });
  }

  /* ── COURSE ROW CLICK ── */
  function initCourseRowClicks() {
    document.addEventListener('click', function(e) {
      if (e.target.closest('.course-row__link-btn')) return;
      var row = e.target.closest('.course-row');
      if (!row) return;
      var linkBtn = row.querySelector('.course-row__link-btn');
      if (linkBtn) {
        openDriveModal(linkBtn);
      } else {
        var titleEl = row.querySelector('.course-row__title');
        openNoLinkModal(titleEl ? titleEl.textContent.trim() : '안내');
      }
    });
  }

  /* ── MAIN ── */
  window.addEventListener('load', function() {
    initWebGLBackground();
    initCalendarPopupToggle();
    initCourseRowClicks();
    initNoteRowClicks();
    initFilters();

    var initialData = window.__INITIAL_DASHBOARD_DATA__;
    if (initialData) { hydrateDashboard(initialData); return; }

    callBackend('getDashboardData', [], hydrateDashboard, function(err) {
      var msg = APP_CONFIG.apiBase
        ? 'API Error: ' + (err && err.message ? err.message : String(err))
        : 'Cloud API not configured yet.';
      showDashboardError(msg);
    });
  });

  window.addEventListener('resize', function() {
    scheduleRelayoutOpenNoteFootnotes();
  }, { passive: true });
