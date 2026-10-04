/**
 * API client. The backend is authoritative for every security decision;
 * this file only attaches the token and normalises responses/errors.
 */
(function () {
  const TOKEN_KEY = 'msds_token';
  const USER_KEY = 'msds_user';

  const Session = {
    get token() { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } },
    get user() { try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
    save(token, user) {
      try { sessionStorage.setItem(TOKEN_KEY, token); sessionStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* storage unavailable */ }
    },
    setUser(user) { try { sessionStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* ignore */ } },
    clear() { try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); } catch { /* ignore */ } },
  };

  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status; this.code = code; this.details = details;
    }
  }

  const SESSION_ERRORS = ['NO_TOKEN', 'INVALID_TOKEN', 'TOKEN_EXPIRED'];

  async function request(method, path, body, { isForm = false, redirectOn401 = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (Session.token) headers.Authorization = `Bearer ${Session.token}`;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetch(`/api${path}`, {
        method, headers, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
      });
    } catch (networkErr) {
      // The request never reached the API (server stopped/restarting, wrong origin, or blocked by an extension).
      const target = `${window.location.origin}/api${path}`;
      console.error(`[api] ${method} ${target} failed before reaching the server:`, networkErr);
      const hint = window.location.protocol === 'file:'
        ? 'This page was opened as a file. Start the backend and open the app at http://localhost:5000/login.'
        : `Cannot reach the API at ${window.location.origin}. Make sure the backend is running and that you opened the app from the backend's address (e.g. http://localhost:5000/login).`;
      throw new ApiError(0, 'NETWORK_ERROR', hint);
    }

    let json = null;
    try { json = await res.json(); } catch { /* non-JSON */ }

    if (!res.ok || !json || json.success === false) {
      const err = (json && json.error) || {};
      const apiErr = new ApiError(res.status, err.code || 'UNKNOWN_ERROR', err.message || 'Something went wrong.', err.details);
      if (res.status === 401 && SESSION_ERRORS.includes(apiErr.code) && redirectOn401) {
        Session.clear();
        const reason = apiErr.code === 'TOKEN_EXPIRED' ? 'expired' : 'login';
        window.location.replace(`/login?reason=${reason}`);
      }
      throw apiErr;
    }
    return json.data;
  }

  window.API = {
    Session,
    ApiError,
    get: (p, o) => request('GET', p, undefined, o),
    post: (p, b, o) => request('POST', p, b, o),
    patch: (p, b, o) => request('PATCH', p, b, o),
    put: (p, b, o) => request('PUT', p, b, o),
    del: (p, o) => request('DELETE', p, undefined, o),
    upload: (p, formData, o) => request('POST', p, formData, { ...o, isForm: true }),
  };
})();
