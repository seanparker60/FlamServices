const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken'); // Added for authentication
const app = express();
app.use(express.json());

const SECRET_KEY = "factory_secret_key_2026"; // Must match Gateway key
const db = new Pool(
    process.env.DATABASE_URL ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    } : {
        host: 'localhost',
        user: 'postgres',
        password: 'flam123',
        database: 'integration_factory',
        port: 3030
    }
);

// Authentication Middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "No Token" });

    jwt.verify(token, SECRET_KEY, (err) => {
        if (err) return res.status(403).json({ error: "Invalid Token" });
        next();
    });
};

// Salesforce hits this endpoint when a record changes
app.post('/salesforce-update', authenticate, async (req, res) => {
    const { sf_id, name, email } = req.body;
    
    console.log(`[WEBHOOK] Incoming update for SF_ID: ${sf_id}`);

    try {
        const sql = 'UPDATE accounts SET name = $1, email = $2 WHERE sf_id = $3';
        const result = await db.query(sql, [name, email, sf_id]);
        
        if (result.rowCount > 0) {
            console.log('--- Local Database Synced with Salesforce ---');
            res.status(200).send('Sync Success');
        } else {
            res.status(404).send('Record not found locally');
        }
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Inside your Webhook Listener Service
app.post('/slack', async (req, res) => {
    // 1. Slack URL Verification Challenge (Required by Slack when first setting up)
    if (req.body.type === 'url_verification') {
        return res.send(req.body.challenge);
    }

    const { event } = req.body;

    // 2. Ignore bot messages (stops infinite echo loops when your own service posts)
    if (event && event.bot_id) {
        return res.sendStatus(200);
    }

    // 3. Extract message text and broadcast it via WebSocket
    if (event && event.type === 'message') {
        const incomingText = event.text;
        
        console.log(`📢 [SLACK WEBHOOK] New reply from internal team: ${incomingText}`);

        // Broadcast to your mobile app client instantly over the open socket room
        // Mirroring your exact data shape so your UI renders it effortlessly!
        io.to("slack_channel_room").emit('new_agent_comment', {
            conversation_id: "slack_channel_room",
            message_text: incomingText,
            source: 'Slack_Web',
            created_at: new Date()
        });
    }

    res.sendStatus(200);
});

app.listen(3006, () => console.log('🔗 Webhook Listener on :3006'));