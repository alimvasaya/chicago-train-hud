/* Chicago Train HUD — Meta Ray-Ban Display web app
 *
 * Platform facts (per Meta docs):
 *  - Neural Band / temple swipes arrive as ArrowLeft/Right/Up/Down + Enter.
 *  - GPS is standard navigator.geolocation (from the paired phone).
 *  - Permission must be requested from a user gesture (the first Enter press).
 *
 * UX: one press to start, then it auto-locates and auto-refreshes. The nearest
 * station shows by default; ◀ / ▶ cycle to other nearby stations; ⏎ refreshes.
 */
(function () {
  'use strict';

  var screens = {
    start:   document.getElementById('screen-start'),
    status:  document.getElementById('screen-status'),
    results: document.getElementById('screen-results'),
  };
  var statusText = document.getElementById('status-text');
  var btnRetry   = document.getElementById('btn-retry');

  var stations = [];
  var idx = 0;
  var lastCoords = null;
  var refreshTimer = null;
  var current = 'start';

  var REFRESH_MS = 30000;

  function show(name) {
    current = name;
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('hidden', k !== name);
    });
    var f = screens[name].querySelector('.focusable:not(.hidden)');
    if (f) f.focus();
  }

  function setStatus(msg, retry) {
    statusText.textContent = msg;
    btnRetry.classList.toggle('hidden', !retry);
    show('status');
  }

  // ---- input: global D-pad handling (simple + glanceable) ----
  document.addEventListener('keydown', function (e) {
    if (current === 'results') {
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowUp':    step(-1); e.preventDefault(); return;
        case 'ArrowRight':
        case 'ArrowDown':  step(1);  e.preventDefault(); return;
        case 'Enter':      refresh(); e.preventDefault(); return;
      }
    } else if (e.key === 'Enter') {
      var f = screens[current].querySelector('.focusable:not(.hidden)');
      if (f) { f.click(); e.preventDefault(); }
    }
  });

  // ---- location + data ----
  function locate() {
    setStatus('Locating you…', false);
    if (!navigator.geolocation) { setStatus('No location support on this device.', true); return; }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        lastCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        fetchTrains();
      },
      function (err) {
        var m = 'Could not get your location.';
        if (err.code === 1) m = 'Location permission denied.';
        else if (err.code === 2) m = 'Location unavailable. Is your phone online?';
        else if (err.code === 3) m = 'Location timed out.';
        setStatus(m, true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  }

  // Refresh re-reads GPS (so it follows you down the platform), then reloads data.
  function refresh() {
    if (!navigator.geolocation) { fetchTrains(); return; }
    navigator.geolocation.getCurrentPosition(
      function (pos) { lastCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude }; fetchTrains(); },
      function () { fetchTrains(); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  }

  function fetchTrains() {
    if (!lastCoords) return;
    fetch('/api/trains?lat=' + lastCoords.lat + '&lon=' + lastCoords.lon)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var next = (data && data.stations) || [];
        if (!next.length) { setStatus('No nearby stations found.', true); return; }
        // keep the station the user was viewing if it still exists
        var keepName = stations[idx] && stations[idx].name;
        stations = next;
        idx = 0;
        if (keepName) {
          for (var i = 0; i < stations.length; i++) {
            if (stations[i].name === keepName) { idx = i; break; }
          }
        }
        render();
        show('results');
        scheduleRefresh();
      })
      .catch(function () { setStatus('Could not reach the train service.', true); });
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () { if (current === 'results') refresh(); }, REFRESH_MS);
  }

  function render() {
    var s = stations[idx];
    if (!s) return;

    document.getElementById('station-name').textContent = s.name;

    var chips = document.getElementById('line-chips');
    chips.innerHTML = '';
    if (s.kind) {
      var k = document.createElement('span');
      k.className = 'chip kind';
      k.textContent = s.kind;
      chips.appendChild(k);
    }
    (s.lines || []).forEach(function (l) {
      var c = document.createElement('span');
      c.className = 'chip';
      c.textContent = l.label;
      c.style.background = l.color;
      // yellow needs dark text to stay legible
      c.style.color = (l.color.toLowerCase() === '#f9e300') ? '#1a1400' : '#fff';
      chips.appendChild(c);
    });

    document.getElementById('station-dist').textContent =
      (typeof s.dist_m === 'number' ? s.dist_m + ' m away' : '');
    document.getElementById('pager').textContent = (idx + 1) + ' / ' + stations.length;

    var list = document.getElementById('trains');
    list.innerHTML = '';
    if (!s.trains || !s.trains.length) {
      var li = document.createElement('li');
      li.className = 'train empty';
      li.textContent = (s.system === 'bus')
        ? 'No buses soon'
        : (s.system === 'metra' ? 'No scheduled trains' : 'No upcoming trains');
      list.appendChild(li);
      return;
    }
    s.trains.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'train';
      var due = t.approaching || t.eta_min <= 0;
      var etaHtml = due ? 'Due' : (t.eta_min + '<small> min</small>');
      var delay = t.delayed ? '<span class="delay">DELAYED</span>' : '';
      li.innerHTML =
        '<span class="dot" style="background:' + t.color + ';color:' + t.color + '"></span>' +
        '<span class="body">' +
          '<span class="dest">' + esc(t.dest) + '</span>' +
          '<span class="line" style="color:' + t.color + '">' + esc(t.line) + '</span>' +
        '</span>' +
        '<span class="eta">' + etaHtml + delay + '</span>';
      list.appendChild(li);
    });
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function step(d) {
    if (!stations.length) return;
    idx = (idx + d + stations.length) % stations.length;
    render();
  }

  document.getElementById('btn-find').addEventListener('click', locate);
  btnRetry.addEventListener('click', locate);

  show('start');
})();
