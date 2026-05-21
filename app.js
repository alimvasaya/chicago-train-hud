/* Chicago Train HUD — Meta Ray-Ban Display web app
 *
 * Real platform facts this is built around (per Meta's docs, May 14 2026):
 *  - Input arrives as standard ArrowUp/Down/Left/Right + Enter key events
 *    (the Neural Band & temple touch strip are translated to these).
 *  - There is NO proprietary "RayBan" SDK to import. Standard web APIs only.
 *  - GPS is the standard navigator.geolocation API (sourced from the phone).
 *  - Permission prompts must be triggered by a user gesture (an Enter press).
 *
 * Data flows through our own /api/trains proxy so that (a) CORS works and
 * (b) the Metra protobuf feed is decoded server-side.
 */

(function () {
  'use strict';

  // --- screens ---
  var screens = {
    start:   document.getElementById('screen-start'),
    status:  document.getElementById('screen-status'),
    results: document.getElementById('screen-results'),
  };
  var statusText = document.getElementById('status-text');
  var btnRetry   = document.getElementById('btn-retry');

  var stations = [];   // nearest stations returned by the API
  var idx = 0;         // which station is currently shown

  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('hidden', k !== name);
    });
    // focus the first focusable element on the newly shown screen
    var first = screens[name].querySelector('.focusable:not(.hidden)');
    if (first) first.focus();
  }

  function setStatus(msg, showRetry) {
    statusText.textContent = msg;
    btnRetry.classList.toggle('hidden', !showRetry);
    show('status');
  }

  // ---------------------------------------------------------------------
  // D-pad focus management (Meta reference pattern)
  // ---------------------------------------------------------------------
  function moveFocus(direction) {
    var focusables = Array.prototype.slice.call(
      document.querySelectorAll('.screen:not(.hidden) .focusable:not([disabled]):not(.hidden)')
    );
    if (!focusables.length) return;
    var i = focusables.indexOf(document.activeElement);
    if (i === -1) { focusables[0].focus(); return; }
    var next = (direction === 'prev')
      ? (i > 0 ? i - 1 : focusables.length - 1)
      : (i < focusables.length - 1 ? i + 1 : 0);
    focusables[next].focus();
  }

  document.addEventListener('keydown', function (e) {
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':  moveFocus('prev'); break;
      case 'ArrowDown':
      case 'ArrowRight': moveFocus('next'); break;
      case 'Enter':
        if (document.activeElement &&
            document.activeElement.classList.contains('focusable')) {
          document.activeElement.click();
        }
        break;
      default: return;
    }
    e.preventDefault();
  });

  // ---------------------------------------------------------------------
  // Location + data
  // ---------------------------------------------------------------------
  function locate() {
    setStatus('Locating you…', false);

    if (!navigator.geolocation) {
      setStatus('This device has no location support.', true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function (pos) {
        fetchTrains(pos.coords.latitude, pos.coords.longitude);
      },
      function (err) {
        var msg = 'Could not get your location.';
        if (err.code === 1) msg = 'Location permission denied.';
        else if (err.code === 2) msg = 'Location unavailable. Is your phone online?';
        else if (err.code === 3) msg = 'Location timed out. Try again.';
        setStatus(msg, true);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }

  function fetchTrains(lat, lon) {
    setStatus('Loading arrivals…', false);
    fetch('/api/trains?lat=' + lat + '&lon=' + lon)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        stations = (data && data.stations) || [];
        if (!stations.length) {
          setStatus('No nearby stations found.', true);
          return;
        }
        idx = 0;
        render();
        show('results');
      })
      .catch(function () {
        setStatus('Could not reach the train service.', true);
      });
  }

  function render() {
    var s = stations[idx];
    if (!s) return;

    document.getElementById('station-name').textContent = s.name;
    var meters = (typeof s.dist_m === 'number') ? '  ·  ' + s.dist_m + ' m' : '';
    document.getElementById('station-meta').textContent =
      s.line + meters + '   (' + (idx + 1) + '/' + stations.length + ')';

    var list = document.getElementById('trains');
    list.innerHTML = '';
    if (!s.trains || !s.trains.length) {
      var li = document.createElement('li');
      li.className = 'train empty';
      li.textContent = 'No upcoming trains';
      list.appendChild(li);
      return;
    }
    s.trains.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'train';
      var eta = (t.eta_min <= 0) ? 'Due' : t.eta_min + ' min';
      li.innerHTML =
        '<span class="dest">' + escapeHtml(t.dest) + '</span>' +
        '<span class="eta">' + eta +
        (t.delayed ? '<span class="delay">DELAY</span>' : '') + '</span>';
      list.appendChild(li);
    });
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function step(delta) {
    if (!stations.length) return;
    idx = (idx + delta + stations.length) % stations.length;
    render();
  }

  // ---------------------------------------------------------------------
  // Wire up buttons
  // ---------------------------------------------------------------------
  document.getElementById('btn-find').addEventListener('click', locate);
  btnRetry.addEventListener('click', locate);
  document.getElementById('btn-refresh').addEventListener('click', locate);
  document.getElementById('btn-prev').addEventListener('click', function () { step(-1); });
  document.getElementById('btn-next').addEventListener('click', function () { step(1); });

  // Start on the first screen with focus ready.
  show('start');
})();
