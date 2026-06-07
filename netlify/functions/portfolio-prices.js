// Netlify serverless function — portfolio price fetcher
// Uses Finnhub (primary) + CoinGecko (crypto)
// Set FINNHUB_KEY in: Netlify dashboard → Site → Environment variables

const FINNHUB_KEY = process.env.FINNHUB_KEY;

const CRYPTO_MAP_P = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', ADA:'cardano',
  XRP:'ripple', DOGE:'dogecoin', DOT:'polkadot', AVAX:'avalanche-2',
  MATIC:'matic-network', LINK:'chainlink', LTC:'litecoin',
  BNB:'binancecoin', SHIB:'shiba-inu', UNI:'uniswap', ATOM:'cosmos',
};

async function fetchFinnhubPrice(symbol) {
  if (!FINNHUB_KEY) return { price: null, change24h: null };
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (!data || !data.c || data.c === 0) return { price: null, change24h: null };
    return { price: data.c, change24h: data.dp ?? null, name: symbol };
  } catch {
    return { price: null, change24h: null };
  }
}

// Yahoo Finance as backup (may be blocked on some cloud hosts)
async function fetchYahooPrice(symbol) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return { price: null, change24h: null };
    const price     = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? null;
    const change24h = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
    return { price, change24h, name: meta.longName || meta.shortName || symbol };
  } catch {
    return { price: null, change24h: null };
  }
}

async function fetchStockPrice(symbol) {
  const result = await fetchFinnhubPrice(symbol);
  if (result.price) return result;
  return fetchYahooPrice(symbol);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const symbols = event.queryStringParameters?.symbols;
  if (!symbols) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'symbols required' }) };
  }

  const list = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
  const cryptoSyms = list.filter(s =>  CRYPTO_MAP_P[s]);
  const stockSyms  = list.filter(s => !CRYPTO_MAP_P[s]);
  const prices = {};

  // Crypto → CoinGecko
  if (cryptoSyms.length) {
    try {
      const ids = cryptoSyms.map(s => CRYPTO_MAP_P[s]).join(',');
      const r = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await r.json();
      for (const sym of cryptoSyms) {
        const entry = data[CRYPTO_MAP_P[sym]];
        if (entry) prices[sym] = { price: entry.usd, change24h: entry.usd_24h_change ?? null };
      }
    } catch (e) { console.error('CoinGecko error:', e.message); }
  }

  // Stocks/ETFs → Finnhub + Yahoo fallback
  if (stockSyms.length) {
    const results = await Promise.all(stockSyms.map(s => fetchStockPrice(s)));
    stockSyms.forEach((sym, i) => { prices[sym] = results[i]; });
  }

  return { statusCode: 200, headers, body: JSON.stringify(prices) };
};
