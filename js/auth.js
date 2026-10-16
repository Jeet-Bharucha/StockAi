// Auth — API-backed (MongoDB) with localStorage session cache
const Auth = {
  _TOKEN_KEY:   'stockai_jwt',
  _SESSION_KEY: 'stockai_session',
  _REMEMBER_DAYS: 30,
  _watchlistCache: null,

  // ── Helpers ────────────────────────────────────────────────────────────
  _authHeader() {
    const token = localStorage.getItem(this._TOKEN_KEY) || sessionStorage.getItem(this._TOKEN_KEY);
    return { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };
  },

  _saveSession(token, user, remember = true) {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    const prefs = (() => {
      try { return JSON.parse(localStorage.getItem('stockai_prefs') || '{}'); }
      catch (_) { return {}; }
    })();
    const days = prefs.sessionDays === '7' ? 7 : 30; // JWTs expire in 30d on server.
    store.setItem(this._TOKEN_KEY, token);
    store.setItem(this._SESSION_KEY, JSON.stringify({
      userId: user.id, name: user.name, email: user.email,
      role: user.role === 'owner' ? 'owner' : 'user',
      expires: remember ? Date.now() + days * 864e5 : null
    }));
    other.removeItem(this._TOKEN_KEY);
    other.removeItem(this._SESSION_KEY);
  },

  // ── Register / Login ───────────────────────────────────────────────────
  // An HTML error page from a static host/proxy is NOT an authentication error.
  // Classify it separately so users can tell a dead backend from bad credentials.
  async _postAuth(route, payload, remember = true, extraHeaders = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 55000); // allow Render cold starts
    try {
      const res = await fetch(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...extraHeaders },
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
        if (data.code === 'EMAIL_NOT_VERIFIED') {
          return { success:false, verificationRequired:true, error:'Please verify your email before signing in. Check your inbox or request another link on the verification page.' };
        }
        if (data.code === 'PUBLIC_REGISTRATION_CLOSED') {
          return { success:false, error:'Public registration is not enabled yet. The site owner must configure verified email delivery and activate public signups.' };
        }
        if (data.code === 'OWNER_SETUP_REQUIRED') {
          return { success: false, error: 'Private owner registration requires OWNER_SETUP_KEY in Render and the same value in the Owner Setup Key field. Use a long random key; remove it from Render after creating the account.' };
        }
        if (data.code === 'PRIVATE_ACCESS_ONLY') {
          return { success: false, error: 'This is the private StockAI instance; only the owner can sign in. Public users need the public website.' };
        }
        if (res.status === 401 && route.endsWith('/login')) {
          return { success: false, error: 'Email or password was not recognized in MongoDB. On private StockAI, use Restore Owner Access to set a new password without deleting your existing portfolio. Public users should use the public website. This can also happen when an older account was never moved to MongoDB.' };
        }
        return { success: false, error: data.error || 'Authentication failed (HTTP ' + res.status + ').' };
      }
      if (res.status === 202 && data.pendingVerification) {
        return { success:false,pendingVerification:true,message:data.message ||
          'Check your email for the verification link.' };
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

  async register(name, email, password, ownerSetupKey = '') {
    return this._postAuth('/api/auth/register', { name, email, password }, true,
      ownerSetupKey ? { 'X-StockAI-Owner-Setup-Key': ownerSetupKey } : {});
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
    sessionStorage.removeItem(this._TOKEN_KEY);
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
    const store = localStorage.getItem(this._SESSION_KEY) ? localStorage : sessionStorage;
    const raw = store.getItem(this._SESSION_KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw);
      if (session.expires && Date.now() > session.expires) {
        store.removeItem(this._SESSION_KEY);
        store.removeItem(this._TOKEN_KEY);
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
    localStorage.removeItem(this._TOKEN_KEY);
  },

  isGuest()  { return this.getSession()?.isGuest === true; },
  isAdmin()  { return this.getSession()?.role === 'owner'; },

  // ── Watchlist — API-backed, in-memory cache ────────────────────────────
  getWatchlist() {
    if (this.isGuest()) return [];
    // No fabricated starter holdings: the MongoDB watchlist is authoritative.
    return this._watchlistCache ?? [];
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

  async _mutateWatchlist(transform) {
    if (this.isGuest()) throw new Error('Sign in to save a watchlist.');
    // Serialize writes so rapid add/remove clicks cannot overwrite each other.
    const previous = this._watchlistWrite || Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      // Never replace an existing saved watchlist with an empty local view if
      // the initial account read failed while Render was sleeping.
      if (this._watchlistCache === null) await this.loadWatchlist();
      if (this._watchlistCache === null)
        throw new Error('Saved watchlist is not loaded. Retry after the server connects.');
      const current = this.getWatchlist();
      const next = transform([...current]);
      if (next.length>100) throw new Error('Watchlist is limited to 100 symbols.');
      if (JSON.stringify(next)===JSON.stringify(current)) return current;
      const response=await fetch('/api/user/watchlist',{
        method:'PUT',headers:this._authHeader(),body:JSON.stringify({watchlist:next})
      });
      if(!response.ok) {
        const info=await response.json().catch(()=>({}));
        throw new Error(info.error||'Watchlist could not be saved (HTTP '+response.status+').');
      }
      // Only report an item as saved after MongoDB accepts the update.
      this._watchlistCache=next;
      return next;
    });
    this._watchlistWrite=operation.catch(()=>{});
    return operation;
  },

  async addToWatchlist(symbol) {
    const normalized=typeof symbol==='string'?symbol.trim().toUpperCase():'';
    if(!/^[A-Z0-9.\\^:-]{1,24}$/.test(normalized))
      throw new Error('Enter a valid stock or ETF ticker symbol.');
    return this._mutateWatchlist(list=>
      list.includes(normalized)?list:[...list,normalized]);
  },

  async removeFromWatchlist(symbol) {
    const normalized=typeof symbol==='string'?symbol.trim().toUpperCase():'';
    return this._mutateWatchlist(list=>list.filter(s=>s!==normalized));
  }
};
