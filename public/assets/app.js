(function () {
  const $ = (sel) => document.querySelector(sel);
  let token = localStorage.getItem('wg_token') || null;
  let refreshTimer = null;

  const views = {
    login: $('#view-login'),
    dashboard: $('#view-dashboard'),
    download: $('#view-download')
  };

  async function api(path, opts = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api' + path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') {
      logout();
      throw new Error('Session berakhir, silakan login ulang');
    }
    if (!res.ok) throw new Error(data.error || 'Gagal (' + res.status + ')');
    return data;
  }

  function show(viewName) {
    Object.keys(views).forEach((k) => { views[k].hidden = k !== viewName; });
    document.querySelectorAll('.topnav a[data-nav]').forEach((a) => {
      a.classList.toggle('active', a.dataset.nav === viewName);
    });
    if (viewName !== 'dashboard') stopRefresh();
    if (viewName === 'dashboard' && token) startRefresh();
    window.scrollTo(0, 0);
  }

  function route() {
    const hash = (location.hash || '#dashboard').replace('#', '');
    if (hash === 'download') { show('download'); return; }
    if (!token) { show('login'); return; }
    show('dashboard');
    loadDevices();
  }

  function logout() {
    token = null;
    localStorage.removeItem('wg_token');
    $('#logout-btn').hidden = true;
    stopRefresh();
    show('login');
  }

  function startRefresh() {
    stopRefresh();
    refreshTimer = setInterval(() => {
      if (!views.dashboard.hidden && token) loadDevices(true);
    }, 10000);
  }

  function stopRefresh() {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  function relativeTime(ts) {
    if (!ts) return 'belum pernah terhubung';
    const diff = Math.max(0, Date.now() - ts);
    const s = Math.floor(diff / 1000);
    if (s < 5) return 'baru saja';
    if (s < 60) return s + ' dtk lalu';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' mnt lalu';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' jam lalu';
    return Math.floor(h / 24) + ' hari lalu';
  }

  function statusInfo(dev) {
    switch (dev.hotspot) {
      case 'ON': return { cls: 'on', label: 'AKTIF' };
      case 'OFF': return { cls: 'off', label: 'MATI' };
      case 'ERROR': return { cls: 'err', label: 'ERROR' };
      default: return { cls: 'unknown', label: 'BELUM LAPOR' };
    }
  }

  function renderDevices(devices) {
    const grid = $('#device-grid');
    const empty = $('#empty-state');
    grid.innerHTML = '';
    if (!devices.length) { empty.hidden = false; return; }
    empty.hidden = true;
    devices.forEach((dev) => grid.appendChild(deviceCard(dev)));
  }

  function deviceCard(dev) {
    const card = document.createElement('div');
    card.className = 'device-card';

    const info = statusInfo(dev);
    const online = dev.last_seen && Date.now() - dev.last_seen < 45000;
    const pending = !!dev.pending;
    const waiting = pending ? ' · menunggu PC…' : '';
    const meta = (online ? '● online · ' : '○ offline · ') + relativeTime(dev.last_seen) + waiting;

    card.innerHTML =
      '<div class="device-top">' +
        '<div><div class="device-name"></div><div class="device-id"></div></div>' +
        '<span class="badge ' + info.cls + '"><span class="dot"></span>' + info.label + '</span>' +
      '</div>' +
      (dev.error ? '<div class="device-err">' + escapeHtml(dev.error) + '</div>' : '') +
      '<div class="device-meta"><span class="conn"></span></div>' +
      '<button type="button" class="btn toggle"></button>';

    card.querySelector('.device-name').textContent = dev.name;
    card.querySelector('.device-id').textContent = dev.id;
    card.querySelector('.conn').textContent = meta;
    const btn = card.querySelector('.btn.toggle');
    const isOn = dev.hotspot === 'ON';
    btn.textContent = pending ? 'Menunggu PC…' : (isOn ? 'Matikan Hotspot' : 'Nyalakan Hotspot');
    btn.classList.add(isOn ? 'on' : 'off');
    btn.disabled = pending;
    btn.addEventListener('click', async () => {
      const action = isOn ? 'OFF' : 'ON';
      btn.disabled = true;
      btn.textContent = 'Mengirim…';
      try {
        await api('/command', { method: 'POST', body: JSON.stringify({ device_id: dev.id, action }) });
        btn.textContent = 'Menunggu PC…';
        setTimeout(() => loadDevices(true), 1500);
        setTimeout(() => loadDevices(true), 5000);
      } catch (e) {
        btn.disabled = false;
        btn.textContent = isOn ? 'Matikan Hotspot' : 'Nyalakan Hotspot';
        alert('Gagal mengirim perintah: ' + e.message);
      }
    });
    return card;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function loadDevices(silent) {
    try {
      const data = await api('/devices');
      renderDevices(data.devices || []);
      const online = (data.devices || []).filter((d) => d.last_seen && Date.now() - d.last_seen < 45000).length;
      $('#dash-sub').textContent =
        (data.devices || []).length + ' PC terdaftar · ' + online + ' online · diperbarui ' +
        new Date().toLocaleTimeString('id-ID');
    } catch (e) {
      if (!silent && token) $('#dash-sub').textContent = 'Gagal memuat: ' + e.message;
    }
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#login-error');
    const btn = $('#login-btn');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Memproses…';
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ user: $('#login-user').value.trim(), pw: $('#login-pw').value })
      });
      token = data.token;
      localStorage.setItem('wg_token', token);
      $('#logout-btn').hidden = false;
      $('#login-pw').value = '';
      show('dashboard');
      loadDevices();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Masuk';
    }
  });

  $('#refresh-btn').addEventListener('click', () => loadDevices());
  $('#logout-btn').addEventListener('click', logout);
  window.addEventListener('hashchange', route);

  if (token) {
    $('#logout-btn').hidden = false;
  }
  route();
})();
