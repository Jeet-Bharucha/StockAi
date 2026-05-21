// Auth system using localStorage / sessionStorage
const Auth = {
  _SESSION_KEY: 'stockai_session',
  _REMEMBER_DAYS: 30,

  register(name, email, password) {
    const users = JSON.parse(localStorage.getItem('stockai_users') || '[]');
    if (users.find(u => u.email === email)) {
      return { success: false, error: 'Email already registered' };
    }
    const user = { id: Date.now(), name, email, password: btoa(password), created: Date.now() };
    users.push(user);
    localStorage.setItem('stockai_users', JSON.stringify(users));
    this.setSession(user, true); // always remember on register
    return { success: true, user };
  },

  login(email, password, remember = true) {
    const users = JSON.parse(localStorage.getItem('stockai_users') || '[]');
    const user = users.find(u => u.email === email && u.password === btoa(password));
    if (!user) return { success: false, error: 'Invalid email or password' };
    this.setSession(user, remember);
    // Save last email for prefill
    localStorage.setItem('stockai_last_email', email);
    return { success: true, user };
  },

  logout() {
    localStorage.removeItem(this._SESSION_KEY);
    sessionStorage.removeItem(this._SESSION_KEY);
    window.location.href = 'login.html';
  },

  setSession(user, remember) {
    const session = {
      userId: user.id, name: user.name, email: user.email,
      token: Date.now(),
      expires: remember ? Date.now() + this._REMEMBER_DAYS * 864e5 : null
    };
    const store = remember ? localStorage : sessionStorage;
    store.setItem(this._SESSION_KEY, JSON.stringify(session));
    // Clear from the other store so there's no stale session
    (remember ? sessionStorage : localStorage).removeItem(this._SESSION_KEY);
  },

  getSession() {
    const raw = localStorage.getItem(this._SESSION_KEY) || sessionStorage.getItem(this._SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    // Expire check (null expires = session-only, already gone if tab closed)
    if (session.expires && Date.now() > session.expires) {
      localStorage.removeItem(this._SESSION_KEY);
      return null;
    }
    return session;
  },

  requireAuth() {
    if (!this.getSession()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  loginAsGuest() {
    const session = {
      userId: 'guest', name: 'Guest Trader', email: 'guest',
      token: Date.now(), expires: Date.now() + 24 * 3600000, isGuest: true
    };
    sessionStorage.setItem(this._SESSION_KEY, JSON.stringify(session));
    localStorage.removeItem(this._SESSION_KEY);
  },

  isGuest() {
    return this.getSession()?.isGuest === true;
  },

  isAdmin() {
    const s = this.getSession();
    return s && ['admin@stockai.com'].includes(s.email);
  },

  getWatchlist() {
    const s = this.getSession();
    if (!s) return [];
    if (s.isGuest) return [];
    return JSON.parse(localStorage.getItem(`watchlist_${s.userId}`) || '["AAPL","GOOGL","MSFT","TSLA","AMZN"]');
  },

  addToWatchlist(symbol) {
    const s = this.getSession();
    if (!s) return;
    const list = this.getWatchlist();
    if (!list.includes(symbol)) {
      list.push(symbol);
      localStorage.setItem(`watchlist_${s.userId}`, JSON.stringify(list));
    }
  },

  removeFromWatchlist(symbol) {
    const s = this.getSession();
    if (!s) return;
    const list = this.getWatchlist().filter(s => s !== symbol);
    localStorage.setItem(`watchlist_${s.userId}`, JSON.stringify(list));
  }
};
