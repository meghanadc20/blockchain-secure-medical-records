/**
 * Builds the dashboard shell (sidebar + top bar) for the page's role.
 * Route guarding here is for user experience only — every API enforces auth/role on the server.
 *
 * Usage in a page:  <body data-role="PATIENT" data-page="dashboard" data-title="Dashboard">
 *                   <template id="page-content"> ...page HTML... </template>
 *                   Layout.ready.then(({ user }) => { ...page logic... })
 */
(function () {
  const ICONS = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-6"/>',
    stethoscope: '<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    hourglass: '<path d="M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  };

  const NAV = {
    PATIENT: [
      ['dashboard', 'Dashboard', '/patient/dashboard', 'home'],
      ['profile', 'Profile', '/patient/profile', 'user'],
      ['records', 'Medical Records', '/patient/records', 'file'],
      ['history', 'Medical History', '/patient/history', 'clock'],
      ['access-requests', 'Access Requests', '/patient/access-requests', 'key'],
      ['audit', 'Audit Trail', '/patient/audit', 'list'],
    ],
    DOCTOR: [
      ['dashboard', 'Dashboard', '/doctor/dashboard', 'home'],
      ['profile', 'Profile', '/doctor/profile', 'user'],
      ['patients', 'My Patients', '/doctor/patients', 'users'],
      ['access-requests', 'Access Requests', '/doctor/access-requests', 'key'],
      ['records', 'Authorized Records', '/doctor/records', 'file'],
      ['consultations', 'Consultations', '/doctor/consultations', 'stethoscope'],
    ],
    ADMIN: [
      ['dashboard', 'Dashboard', '/admin/dashboard', 'home'],
      ['pending', 'Pending Doctors', '/admin/doctors/pending', 'hourglass'],
      ['approved', 'Approved Doctors', '/admin/doctors/approved', 'check'],
      ['rejected', 'Rejected Doctors', '/admin/doctors/rejected', 'x'],
    ],
  };

  const icon = (name) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const ROLE_LABEL = { PATIENT: 'Patient', DOCTOR: 'Doctor', ADMIN: 'Administrator' };

  function render(user) {
    const { role, page, title } = document.body.dataset;
    const content = document.getElementById('page-content');
    const nav = NAV[role].map(([key, label, href, ic]) =>
      `<li><a href="${href}" ${key === page ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a></li>`).join('');

    const app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = `
      <aside class="sidebar" id="sidebar" aria-label="Sidebar">
        <a class="brand" href="${NAV[role][0][2]}"><span class="brand-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v6M9 11h6"/></svg></span>Secure Medical Data</a>
        <div class="sidebar-label">${ROLE_LABEL[role]}</div>
        <nav aria-label="${ROLE_LABEL[role]} navigation"><ul class="side-nav">${nav}</ul></nav>
      </aside>
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <div class="app-main">
        <header class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="menu-btn" id="menu-btn" aria-controls="sidebar" aria-expanded="false" aria-label="Open menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
            <p class="topbar-title">${UI.esc(title || '')}</p>
          </div>
          <div class="topbar-user">
            <div class="user-meta"><div class="name">${UI.esc(user.name)}</div><div class="role">${ROLE_LABEL[user.role]}</div></div>
            <div class="avatar" aria-hidden="true">${UI.esc(initials(user.name))}</div>
            <button class="btn btn-outline btn-sm" id="logout-btn">${icon('logout')}<span>Log out</span></button>
          </div>
        </header>
        <main class="content" id="main"></main>
      </div>`;
    app.querySelector('#main').appendChild(content.content.cloneNode(true));
    document.getElementById('app-root').replaceChildren(app);

    const sidebar = app.querySelector('#sidebar');
    const backdrop = app.querySelector('#sidebar-backdrop');
    const menuBtn = app.querySelector('#menu-btn');
    const toggle = (open) => {
      sidebar.classList.toggle('open', open); backdrop.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    };
    menuBtn.addEventListener('click', () => toggle(!sidebar.classList.contains('open')));
    backdrop.addEventListener('click', () => toggle(false));

    app.querySelector('#logout-btn').addEventListener('click', async () => {
      try { await API.post('/auth/logout', undefined, { redirectOn401: false }); } catch { /* token may already be invalid */ }
      API.Session.clear();
      window.location.replace('/login?reason=logout');
    });
  }

  async function init() {
    const expectedRole = document.body.dataset.role;
    if (!API.Session.token) {
      window.location.replace('/login?reason=login');
      return new Promise(() => {});
    }
    const data = await API.get('/auth/me'); // 401 → api.js redirects to login
    if (data.user.role !== expectedRole) {
      window.location.replace(data.redirectTo); // wrong area — send to own dashboard
      return new Promise(() => {});
    }
    API.Session.setUser(data.user);
    render(data.user);
    return { user: data.user };
  }

  window.Layout = { ready: new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(init()))) };
})();
