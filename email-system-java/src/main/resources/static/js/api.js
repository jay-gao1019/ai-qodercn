const API_BASE = '';

const api = {
  async request(method, path, body, isFile) {
    const headers = {};
    if (!isFile) headers['Content-Type'] = 'application/json';
    const opts = { method, headers };
    if (body) opts.body = isFile ? body : JSON.stringify(body);
    const res = await fetch(`${API_BASE}${path}`, opts);
    if (path.endsWith('/export')) return res;
    return await res.json();
  },
  get(path) { return this.request('GET', path); },
  post(path, body, isFile) { return this.request('POST', path, body, isFile); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
};
