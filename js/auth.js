// Auth — API-backed (MongoDB) with localStorage session cache
const Auth = {
  _TOKEN_KEY:   'stockai_jwt',
  _SESSION_KEY: 'stockai_session',
  _REMEMBER_DAYS: 30,
  _watchlistCache: null,

  // ── Helpers ────────────────────────────────────────────────────────────
  _authHeader() {
    const token = localStorage.getItem(this._TOKEN_KEY);
    return { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
  },

  _saveSession(token, user, remember = true) {
    localStorage.setItem(this._TOKEN_KEY, token);
    const session = {
      userId:  user.id,
      name:    user.name,
      email:   user.email,
      expires: remember ? Date.now() + this._REMEMBER_DAYS * 864e5 : null
    };
    localStorage.setItem(this._SESSION_KEY, JSON.stringify(session));
    sessionStorage.removeItem(this._SESSION_KEY); // clear any leftover guest session
  },

  // ── Register / Login ───────────────────────────────────────────────────
  // An HTML error page from a static host/proxy is NOT an authentication error.
  // Classify it separately so users can tell a dead backend from bad credentials.
  async _postAuth(route, payload, remember = true) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000); // allow Render cold starts
    try {
      const res = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
      const raw = await res.text();
      let data;
      try { data = JSON.parse(raw); } catch (_) { data = null; }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        if ([502, 503, 504].includes(res.status)) {
          return { success: false, error: 'The StockAI backend is unavailable (HTTP ' + res.status + '). Check the Render service and try again.' };
        }
        return { success: false, error: 'The login API returned a webpage instead of JSON. The site\'s /api proxy may not be reaching the StockAI backend.' };
      }
      if (!res.ok) {
        if (res.status === 503 && /database/i.test(data.error || '')) {
          return { success: false, error: 'The server is online, but MongoDB is disconnected. Check MONGO_URI and MongoDB Atlas network access in Render.' };
        }
        if ([502, 503, 504].includes(res.status)) {
          return { success: false, error: data.error || 'The backend is unavailable (HTTP ' + res.status + '). Check Render.' };
        }
        if (res.status === 404) {
          return { success: false, error: 'Login API not found. Check the /api proxy configuration and backend deployment.' };
        }
        if (data.code === 'PRIVATE_ACCESS_ONLY') {
          return { success: false, error: 'This is the private StockAI instance; only the owner can sign in. Public users need the public website.' };
        }
        if (res.status === 401 && route.endsWith('/login')) {
          return { success: false, error: 'Email or password was not recognized in MongoDB. If you registered before StockAI switched databases, create an account again using the same email. If you already registered in MongoDB, use Forgot password.' };
        }
        return { success: false, error: data.error || 'Authentication failed (HTTP ' + res.status + ').' };
      }
      if (!data.token || !data.user || !data.user.id) {
        return { success: false, error: 'The login server returned an incomplete response. Please try again.' };
      }
      this._saveSession(data.token, data.user, remember);
      return { success: true, user: data.user };
    } catch (e) {
      if (e.name === 'AbortError') {
        return { success: false, error: 'The server did not respond within 55 seconds. It may be asleep or offline. Check your Render deployment.' };
      }
      return { success: false, error: 'Cannot reach the StockAI server. Check the Render deployment and the site\'s /api proxy.' };
    } finally {
      clearTimeout(timer);
    }
  },

  async register(name, email, password) {
    return this._postAuth('/api/auth/register', { name, email, password });
  },

  async login(email, password, remember = true) {
    const result = await this._postAuth('/api/auth/login', { email, password }, remember);
    if (result.success) localStorage.setItem('stockai_last_email', email);
    return result;
  },

  // Readiness probe: checks the API AND MongoDB, not merely a cached website.
  async checkServer() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch('/api/health', {
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: ctrl.signal
      });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        return { state: 'offline', text: 'Login service unavailable. The site\'s /api proxy may not be connected.' };
      }
      const data = await res.json();
      if (data.service !== 'stockai') {
        return { state: 'offline', text: 'Unexpected server response. Check your API proxy.' };
      }
      if (data.database !== 'connected') {
        return { state: 'database', text: 'Server online, but MongoDB is disconnected. Login is temporarily unavailable.' };
      }
      return { state: 'online', text: 'Server and database connected — ready to sign in.' };
    } catch (e) {
      return { state: 'offline', text: e.name === 'AbortError'
        ? 'Server is slow to start or unavailable. You can retry.'
        : 'Cannot reach the login service. Check the Render deployment.' };
    } finally {
      clearTimeout(timer);
    }
  },

  // The public and private deployments can share UI but must have their own
  // correctly configured API backend. No browser-only flag grants access.
  async getSiteConfig() {
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 10000);
      try {
        const r = await fetch('/api/auth/config', { cache: 'no-store', signal: ctrl.signal });
        if (r.ok && (r.headers.get('content-type') || '').includes('application/json')) {
          const data = await r.json();
          if (data.mode === 'public' || data.mode === 'private') return data;
        }
      } finally { clearTimeout(timeout); }
    } catch (_) {}
    return null;
  },

  async requestPasswordReset(email) {
    try {
      const r = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const d = await r.json();
      return { success: r.ok, message: d.message || '', error: r.ok ? null : (d.error || 'Password recovery unavailable') };
    } catch (_) { return { success: false, error: 'Cannot contact the server.' }; }
  },

  async resetPassword(token, password) {
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const d = await r.json();
      return { success: r.ok, message: d.message, error: d.error };
    } catch (_) { return { success: false, error: 'Cannot contact the server.' }; }
  },

  logout() {
    localStorage.removeItem(this._TOKEN_KEY);
    localStorage.removeItem(this._SESSION_KEY);
    sessionStorage.removeItem(this._SESSION_KEY);
    this._watchlistCache = null;
    window.location.href = 'login.html';
  },

  // ── Session (sync — reads from localStorage cache) ─────────────────────
  getSession() {
    // Guest session lives in sessionStorage
    const guestRaw = sessionStorage.getItem(this._SESSION_KEY);
    if (guestRaw) {
      try {
        const g = JSON.parse(guestRaw);
        if (g.isGuest) {
          if (g.expires && Date.now() > g.expires) { sessionStorage.removeItem(this._SESSION_KEY); return null; }
          return g;
        }
      } catch(_) {}
    }
    // Real session lives in localStorage
    const raw = localStorage.getItem(this._SESSION_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      if (session.expires && Date.now() > session.expires) {
        localStorage.removeItem(this._SESSION_KEY);
        localStorage.removeItem(this._TOKEN_KEY);
        return null;
      }
      return session;
    } catch(_) { return null; }
  },

  requireAuth() {
    if (!this.getSession()) { window.location.href = 'login.html'; return false; }
    return true;
  },

  // ── Guest ──────────────────────────────────────────────────────────────
  loginAsGuest() {
    const session = {
      userId: 'guest', name: 'Guest Trader', email: 'guest',
      expires: Date.now() + 24 * 3600000, isGuest: true
    };
    sessionStorage.setItem(this._SESSION_KEY, JSON.stringify(session));
    localStorage.removeItem(this._SESSION_KEY);
  },

  isGuest()  { return this.getSession()?.isGuest === true; },
  isAdmin()  { const s = this.getSession(); return s && ['admin@stockai.com'].includes(s.email); },

  // ── Watchlist — API-backed, in-memory cache ────────────────────────────
  getWatchlist() {
    if (this.isGuest()) return [];
    // Return in-memory cache if loaded, else show a default starter list
    return this._watchlistCache ?? ['AAPL','GOOGL','MSFT','TSLA','AMZN'];
  },

  async loadWatchlist() {
    if (this.isGuest()) { this._watchlistCache = []; return []; }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      let r;
      try { r = await fetch('/api/user/watchlist', { headers: this._authHeader(), signal: ctrl.signal }); }
      finally { clearTimeout(timer); }
      if (r.ok) {
        const data = await r.json();
        this._watchlistCache = data.watchlist || [];
        return this._watchlistCache;
      }
    } catch(e) { console.warn('loadWatchlist failed:', e.message); }
    return this.getWatchlist();
  },

  async addToWatchlist(symbol) {
    if (this.isGuest()) return;
    const list = [...this.getWatchlist()];
    if (list.includes(symbol)) return;
    list.push(symbol);
    this._watchlistCache = list;
    try {
      await fetch('/api/user/watchlist', {
        method: 'PUT', headers: this._authHeader(),
        body:   JSON.stringify({ watchlist: list })
      });
    } catch(e) { console.warn('addToWatchlist failed:', e.message); }
  },

  async removeFromWatchlist(symbol) {
    if (this.isGuest()) return;
    const list = this.getWatchlist().filter(s => s !== symbol);
    this._watchlistCache = list;
    try {
      await fetch('/api/user/watchlist', {
        method: 'PUT', headers: this._authHeader(),
        body:   JSON.stringify({ watchlist: list })
      });
    } catch(e) { console.warn('removeFromWatchlist failed:', e.message); }
  }
};
