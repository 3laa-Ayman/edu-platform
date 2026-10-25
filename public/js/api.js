/* Thin fetch wrapper around the backend API (same origin). */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

const API = {
  token: store.get('token'),

  setToken(t) {
    this.token = t;
    store.set('token', t);
  },

  async req(method, url, body, { form, raw } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`/api${url}`, { method, headers, body: payload });
    if (raw && res.ok) return res;

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      if (res.status === 401 && this.token && !url.startsWith('/auth/login')) {
        this.setToken(null);
        State.user = null;
        location.hash = '#/login';
      }
      const err = new Error(data?.error?.message || `خطأ (${res.status})`);
      err.status = res.status;
      err.code = data?.error?.code;
      err.details = data?.error?.details;
      throw err;
    }
    return data;
  },

  get(u) { return this.req('GET', u); },
  post(u, b = {}) { return this.req('POST', u, b); },
  patch(u, b = {}) { return this.req('PATCH', u, b); },
  put(u, b = {}) { return this.req('PUT', u, b); },
  del(u) { return this.req('DELETE', u); },
  upload(u, form) { return this.req('POST', u, undefined, { form }); },
  blob(u) { return this.req('GET', u, undefined, { raw: true }).then((r) => r.blob()); },
};

/** Shared app state. */
const State = {
  user: null,
  subscription: null,
  async refresh() {
    const me = await API.get('/auth/me');
    this.user = me.user;
    this.subscription = me.subscription;
    return me;
  },
};
