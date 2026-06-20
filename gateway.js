const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');
const app = express();
const cors = require('cors'); // 1. Import cors

// 2. Enable CORS for all origins
app.use(cors());
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        // Apply your CORS handling logic right here
        return cors()(req, res, next);
    }
    next();
});

const SECRET_KEY = "factory_secret_key_2026";

app.use(express.json());

const authenticate = (req, res, next) => {
    if (req.path === '/login' || req.path.startsWith('/dashboard')) return next();
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "No Token" });

    jwt.verify(token, SECRET_KEY, (err) => {
        if (err) return res.status(403).json({ error: "Invalid Token" });
        console.log("✅ Gateway: JWT Verified. Handing to Proxy...");
        next();
    });
};

// NEW SYNTAX: Using the 'on' property for event listeners
const proxyOptions = {
    target: 'http://localhost:3001',
    changeOrigin: true,
    on: {
        proxyReq: (proxyReq, req, res) => {
            if (req.body) {
                console.log("--- Gateway: Re-filling the pipe for:", req.path);
                const bodyData = JSON.stringify(req.body);
                proxyReq.setHeader('Content-Type', 'application/json');
                proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
                proxyReq.write(bodyData);
            }
        },
        proxyRes: (proxyRes, req, res) => {
            console.log("--- Gateway: Received Response from Service!");
        },
        error: (err, req, res) => {
            console.log("❌ Gateway: Proxy Error!", err.message);
            res.status(500).send("Proxy Error");
        }
    }
};

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'factory123') {
        const token = jwt.sign({ user: 'admin' }, SECRET_KEY, { expiresIn: '1h' });
        return res.json({ token });
    }
    res.status(401).json({ error: "Invalid Credentials" });
});

// Update these to use the new proxyOptions
app.use('/accounts', authenticate, createProxyMiddleware({ ...proxyOptions, target: 'http://localhost:3001' }));
app.use('/contacts', authenticate, createProxyMiddleware({ ...proxyOptions, target: 'http://localhost:3011' }));
//app.use('/orders',   authenticate, createProxyMiddleware({ ...proxyOptions, target: 'http://localhost:3002' }));
//app.use('/messages', authenticate, createProxyMiddleware({ ...proxyOptions, target: 'http://localhost:3012' }));

app.use('/messages', authenticate, createProxyMiddleware({ ...proxyOptions, target: 'http://localhost:3018' }));
app.use('/cases', authenticate, createProxyMiddleware({ ...proxyOptions, target: 'http://localhost:3013'}));
app.use('/orders', authenticate, createProxyMiddleware({ 
    target: 'http://localhost:3007', 
    pathRewrite: { '^/orders': '' },
    ...proxyOptions 
}));

app.use('/products', authenticate, createProxyMiddleware({ ...proxyOptions, target: 'http://localhost:3003' }));


app.use('/dashboard', createProxyMiddleware({ target: 'http://localhost:3005', changeOrigin: true }));
app.post('/webhooks/slack', (req, res) => {
    console.log("📥 GATEWAY DIRECT HIT! Body received:", req.body);
    
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).send(req.body.challenge);
    }
    
    res.sendStatus(200);
});
/*
app.use('/webhooks/slack', createProxyMiddleware({ 
    target: 'http://localhost:3006', // Points directly to the listener microservice host
    changeOrigin: true,
    pathRewrite: { '^/webhooks/slack': '/slack-listener' }, // Formats path from /webhooks/slack to /slack
    onProxyReq: (proxyReq, req, res) => {
        // 🎯 THE FIX: Reconstruct the swallowed JSON stream if parsed at the gateway level
        if (req.body && Object.keys(req.body).length) {
            const bodyData = JSON.stringify(req.body);
            proxyReq.setHeader('Content-Type', 'application/json');
            proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
            proxyReq.write(bodyData);
        }
    }
}));
*/
app.use('/webhooks', authenticate, createProxyMiddleware({ 
    ...proxyOptions, 
    target: 'http://localhost:3006',
    pathRewrite: { '^/webhooks': '' } // This removes "/webhooks" from the URL
}));

// 🎯 SLACK CHANNEL INTEGRATION
// Route standard Slack channel payloads to the new internal service process
app.use('/slack', authenticate, createProxyMiddleware({ 
    ...proxyOptions, 
    target: 'http://localhost:3019' 
}));

//app.use('/webhooks', createProxyMiddleware({...proxyOptions, target: 'http://localhost:3006' }));
app.use('/socket.io', createProxyMiddleware({
    target: 'http://localhost:3020',
    changeOrigin: true,
    ws: true, // ⚡ CRITICAL: This is the magic switch that enables WebSocket protocol upgrades!
    on: {
        error: (err, req, res) => {
            console.log("❌ Gateway WebSocket Proxy Error!", err.message);
            // Don't crash the server if a socket drops
            if (res.writeHead && !res.headersSent) {
                res.writeHead(500);
                res.end("WS Proxy Error");
            }
        }
    }
}));

app.listen(3000, () => console.log('🚀 Gateway: http://localhost:3000'));