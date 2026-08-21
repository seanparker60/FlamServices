const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const jwt = require('jsonwebtoken');
const app = express();
const cors = require('cors'); // 1. Import cors
const axios = require('axios');

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
/*
app.post('/webhooks/slack', (req, res) => {
    console.log("📥 GATEWAY DIRECT HIT! Body received:", req.body);
    
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).send(req.body.challenge);
    }
    
    res.sendStatus(200);
});
app.post('/webhooks/slack', (req, res) => {
    console.log("📥 Slack message intercepted at Gateway Edge!");

    // 1. Safety verification handler (just in case Slack re-verifies)
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).send(req.body.challenge);
    }

    // 2. ⚡ KILL THE TIMEOUT: Respond to Postman/Slack instantly
    res.status(200).send({ status: "Received by Gateway" });

    // 3. BACKGROUND HANDOFF: Fire-and-forget to port 3006 (No 'await'!)
    axios.post('http://localhost:3006/slack-listener', req.body, {
        headers: { 'Content-Type': 'application/json' }
    }).then(() => {
        console.log("🚀 Payload background-forwarded to port 3006 successfully!");
    }).catch((error) => {
        console.error("🚨 Background forwarding failed:", error.message);
    });
});
*/
// ==========================================================
// 🔓 PRODUCTION-READY SLACK WEBHOOK ENTRYPOINT
// ==========================================================
app.post('/webhooks/slack', (req, res) => {
    console.log("📥 Slack message intercepted at Gateway Edge!");

    // 1. URL Handshake handler (Always keep this here for safety)
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).send(req.body.challenge);
    }

    // 2. ⚡ DEFUSE THE 502 & TIMEOUT: Answer Postman/Slack instantly
    // Sending a clean status here terminates the external connection happily.
    res.status(200).send({ status: "Accepted by Gateway" });

    // 3. SECURE BACKGROUND HANDOFF (No await, with robust error catching)
    axios.post('http://localhost:3006/slack-listener', req.body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 2000 // If port 3006 takes more than 2s, drop it so it doesn't leak memory
    })
    .then(() => {
        console.log("🚀 Payload background-forwarded to port 3006 successfully!");
    })
    .catch((error) => {
        // 🎯 THE ANTIDOTE TO THE 502: Catching the error here prevents 
        // the gateway from crashing if port 3006 rejects the payload.
        console.error("🚨 Background forwarding failed, but Gateway remains alive:", error.message);
    });
});
app.post('/webhooks/slackAgent', (req, res) => {
    console.log("📥 Slack message intercepted at Gateway Edge!");

    // 1. URL Handshake handler (Always keep this here for safety)
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).send(req.body.challenge);
    }

    // 2. ⚡ DEFUSE THE 502 & TIMEOUT: Answer Postman/Slack instantly
    // Sending a clean status here terminates the external connection happily.
    res.status(200).send({ status: "Accepted by Gateway" });

    // 3. SECURE BACKGROUND HANDOFF (No await, with robust error catching)
    axios.post('http://localhost:3006/agent-response', req.body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 2000 // If port 3006 takes more than 2s, drop it so it doesn't leak memory
    })
    .then(() => {
        console.log("🚀 Payload background-forwarded to port 3006 successfully!");
    })
    .catch((error) => {
        // 🎯 THE ANTIDOTE TO THE 502: Catching the error here prevents 
        // the gateway from crashing if port 3006 rejects the payload.
        console.error("🚨 Background forwarding failed, but Gateway remains alive:", error.message);
    });
});



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