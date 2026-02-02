const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

const PORT = process.env.PORT || 3000;
const WALLET_ADDRESS = '3UcvGwXci9Xi73EBwaj6NmVvx8iHVqh5eomuTuLa6QTw';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

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

// Get market prices using DexScreener (more reliable)
async function getMarketPrices() {
    try {
        // Get SOL price from DexScreener
        const solData = await fetchJson('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
        
        // Find SOL/USDT pair on Raydium (most liquid)
        const solPair = solData.pairs?.find(p => 
            p.chainId === 'solana' && 
            p.quoteToken?.symbol === 'USDT' &&
            p.dexId === 'raydium'
        ) || solData.pairs?.[0];
        
        const solPrice = parseFloat(solPair?.priceUsd) || 0;
        const solChange = solPair?.priceChange?.h24 || 0;

        // Try CoinGecko for BTC/ETH with fallback
        let btcPrice = 0, btcChange = 0, ethPrice = 0, ethChange = 0;
        try {
            const cgData = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true', 5000);
            btcPrice = cgData.bitcoin?.usd || 0;
            btcChange = cgData.bitcoin?.usd_24h_change || 0;
            ethPrice = cgData.ethereum?.usd || 0;
            ethChange = cgData.ethereum?.usd_24h_change || 0;
        } catch (e) {
            // Fallback: use CoinCap
            try {
                const btcData = await fetchJson('https://api.coincap.io/v2/assets/bitcoin', 5000);
                const ethData = await fetchJson('https://api.coincap.io/v2/assets/ethereum', 5000);
                btcPrice = parseFloat(btcData.data?.priceUsd) || 0;
                btcChange = parseFloat(btcData.data?.changePercent24Hr) || 0;
                ethPrice = parseFloat(ethData.data?.priceUsd) || 0;
                ethChange = parseFloat(ethData.data?.changePercent24Hr) || 0;
            } catch (e2) {
                console.log('Price API fallback also failed');
            }
        }

        return {
            btc: { price: btcPrice, change: btcChange },
            eth: { price: ethPrice, change: ethChange },
            sol: { price: solPrice, change: solChange }
        };
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
