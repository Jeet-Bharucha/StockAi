'use strict';

// Free-tier upstream market sockets cannot safely accept unbounded symbols
// or unlimited anonymous browser clients.
const MAX_BROWSER_WS_CLIENTS = 100;
const MAX_BROWSER_WS_SYMBOLS = 12;
const MAX_UPSTREAM_WS_SYMBOLS = 60;
const MAX_WS_MESSAGE_BYTES = 2048;

function normalizeMarketSymbol(value) {
  // Ignore surrounding ordinary spaces, but never accept embedded control
  // characters such as newlines, tabs or NUL in an upstream symbol.
  if (typeof value !== 'string' || /[\x00-\x1F\x7F]/.test(value)) return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.\-^:=]{0,23}$/.test(symbol) ? symbol : null;
}

function parseWsMessage(raw) {
  if (!raw || raw.length > MAX_WS_MESSAGE_BYTES) return null;
  let data;
  try { data = JSON.parse(String(raw)); }
  catch (_) { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (!['subscribe','unsubscribe'].includes(data.type)) return null;
  const symbol = normalizeMarketSymbol(data.symbol);
  return symbol ? {type:data.type,symbol} : null;
}

function canSubscribe(mySymbols,globalSymbols,symbol) {
  if (mySymbols.has(symbol)) return true;
  if (mySymbols.size >= MAX_BROWSER_WS_SYMBOLS) return false;
  if (!globalSymbols.has(symbol) && globalSymbols.size >= MAX_UPSTREAM_WS_SYMBOLS) return false;
  return true;
}

module.exports={
  MAX_BROWSER_WS_CLIENTS,MAX_BROWSER_WS_SYMBOLS,MAX_UPSTREAM_WS_SYMBOLS,
  MAX_WS_MESSAGE_BYTES,normalizeMarketSymbol,parseWsMessage,canSubscribe
};
