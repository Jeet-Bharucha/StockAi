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
  async register(name, email, password) {
    try {
      const r    = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, password })
      });
      const data = await r.json();
      if (!r.ok) return { success: false, error: data.error || 'Registration failed' };
      this._saveSession(data.token, data.user);
      return { success: true, user: data.user };
    } catch(e) {
      return { success: false, error: 'Cannot reach server — make sure it is running.' };
    }
  },

  async login(email, password, remember = true) {
    try {
      const r    = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (!r.ok) return { success: false, error: data.error || 'Login failed' };
      this._saveSession(data.token, data.user, remember);
      localStorage.setItem('stockai_last_email', email);
      return { success: true, user: data.user };
    } catch(e) {
      return { success: false, error: 'Cannot reach server — make sure it is running.' };
    }
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
      const r = await fetch('/api/user/watchlist', { headers: this._authHeader() });
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
