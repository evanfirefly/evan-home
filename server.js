const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = '3UcvGwXci9Xi73EBwaj6NmVvx8iHVqh5eomuTuLa6QTw';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// Symbol to CoinGecko ID mapping
const symbolToCoinGeckoId = {
    'SOL': 'solana',
    'BTC': 'bitcoin',
    'ETH': 'ethereum'
};

// Calculate Simple Moving Average
function calculateSMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / period;
}

// Calculate RSI (Relative Strength Index)
function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
        changes.push(prices[i] - prices[i - 1]);
    }
    const recentChanges = changes.slice(-period);
    let gains = 0, losses = 0;
    for (const change of recentChanges) {
        if (change > 0) gains += change;
        else losses += Math.abs(change);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// Helper to fetch JSON with timeout
function fetchJson(url, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { timeout }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON')); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

// Helper to POST JSON
function postJson(url, body, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout
        };
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON')); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(JSON.stringify(body));
        req.end();
    });
}

// Get single Binance ticker
async function getBinanceTicker(symbol) {
    try {
        const data = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, 5000);
        return {
            price: parseFloat(data.lastPrice) || 0,
            change: parseFloat(data.priceChangePercent) || 0
        };
    } catch (e) {
        return { price: 0, change: 0 };
    }
}

// Get market prices using Binance API
async function getMarketPrices() {
    try {
        const [btc, eth, sol] = await Promise.all([
            getBinanceTicker('BTCUSDT'),
            getBinanceTicker('ETHUSDT'),
            getBinanceTicker('SOLUSDT')
        ]);
        return { btc, eth, sol };
    } catch (e) {
        console.error('getMarketPrices error:', e.message);
        return { 
            btc: { price: 0, change: 0 },
            eth: { price: 0, change: 0 },
            sol: { price: 0, change: 0 },
            error: e.message 
        };
    }
}

// Get wallet balance
async function getWalletBalance() {
    try {
        // Get SOL balance
        const solRes = await postJson('https://api.mainnet-beta.solana.com', {
            jsonrpc: '2.0', id: 1, method: 'getBalance',
            params: [WALLET_ADDRESS]
        });
        const solBalance = (solRes.result?.value || 0) / 1e9;

        // Get USDT balance
        const usdtRes = await postJson('https://api.mainnet-beta.solana.com', {
            jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner',
            params: [WALLET_ADDRESS, { mint: USDT_MINT }, { encoding: 'jsonParsed' }]
        });
        const usdtAccount = usdtRes.result?.value?.[0];
        const usdtBalance = usdtAccount?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;

        return { sol: solBalance, usdt: usdtBalance };
    } catch (e) {
        console.error('getWalletBalance error:', e.message);
        return { sol: 0, usdt: 0, error: e.message };
    }
}

const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Home page
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) { res.writeHead(500); res.end('Error'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
    }
    // Dashboard page
    else if (req.url === '/dashboard') {
        fs.readFile(path.join(__dirname, 'dashboard.html'), (err, data) => {
            if (err) { res.writeHead(500); res.end('Error'); return; }
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
        });
    }
    // API: Status
    else if (req.url === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            name: 'Evan', status: 'online', emoji: '✨',
            born: '2026-02-01', message: '一束小小的光'
        }));
    }
    // API: Market prices
    else if (req.url === '/api/market') {
        const prices = await getMarketPrices();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: prices, timestamp: new Date().toISOString() }));
    }
    // API: Wallet balance
    else if (req.url === '/api/wallet') {
        const balance = await getWalletBalance();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, address: WALLET_ADDRESS, data: balance, timestamp: new Date().toISOString() }));
    }
    // API: Historical OHLC data
    else if (req.url.startsWith('/api/history/')) {
        const urlParts = new URL(req.url, `http://localhost:${PORT}`);
        const symbol = req.url.split('/api/history/')[1].split('?')[0].toUpperCase();
        const period = urlParts.searchParams.get('period') || '7d';
        const periodToDays = { '1d': 1, '7d': 7, '30d': 30, '90d': 90 };
        const days = periodToDays[period] || 7;
        const coinId = symbolToCoinGeckoId[symbol] || 'solana';
        try {
            const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ symbol, period, data }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
    }
    // API: Technical indicators
    else if (req.url.startsWith('/api/indicators/')) {
        const symbol = req.url.split('/api/indicators/')[1].split('?')[0].toUpperCase();
        const coinId = symbolToCoinGeckoId[symbol] || 'solana';
        try {
            const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=30`);
            const closePrices = data.map(candle => candle[4]);
            const latestPrice = closePrices[closePrices.length - 1];
            const ma7 = calculateSMA(closePrices, 7);
            const ma20 = calculateSMA(closePrices, 20);
            const ma50 = calculateSMA(closePrices, 50);
            const rsi14 = calculateRSI(closePrices, 14);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                symbol, price: latestPrice,
                indicators: {
                    ma: { ma7: ma7?.toFixed(2), ma20: ma20?.toFixed(2), ma50: ma50?.toFixed(2) },
                    rsi: { rsi14: rsi14?.toFixed(2) }
                },
                timestamp: Date.now()
            }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: e.message }));
        }
    }
    // 404
    else {
        res.writeHead(404);
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    console.log(`✨ Evan is online at port ${PORT}`);
    console.log(`📊 Dashboard: /dashboard`);
    console.log(`📡 API: /api/market, /api/wallet`);
});
