const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken'); // Added for authentication
const app = express();
const { Server } = require('socket.io');
app.use(express.json());
const server = http.createServer(app);

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
const io = new Server(server, {
    cors: { origin: "*" }
});
// Authentication Middleware
const authenticate = (req, res, next) => {

    console.log(`[WEBHOOK] authenticate`);
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

app.post('/slack-listener', async (req, res) => {
    const { event } = req.body || {};

    console.log('[SLACK LISTENR: event.text:]***', event.text);
    console.log('[SLACK LISTENR: event.type:]***', event.type);
    console.log('[SLACK LISTENR: event.bot_id:]***', event.bot_id);

    if (event && event.type === 'message' && !event.bot_id) {
        const incomingText = event.text;
        const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID; // e.g., "C0BCTHLPHRN"

        try {
            // 🎯 STEP 1: Look up the mapping record in your database
            // Search your conversations table for the row where slack_channel_id matches
           /*
            const conversation = await db.conversations.findOne({ 
                where: { slack_channel_id: SLACK_CHANNEL_ID } 
            });

            // If no mapping exists, log it safely without crashing the whole server
            if (!conversation) {
                console.error(`⚠️ Missing internal mapping link for Slack Channel: ${SLACK_CHANNEL_ID}`);
                return res.sendStatus(200); // Acknowledge Slack so it stops retrying
            }

            // 🎯 STEP 2: Extract your actual native internal ID string
            const INTERNAL_CONVERSATION_ID = conversation.id; // e.g., "7f9b1c2d-..." or 1482

            console.log(`📢 Map Success! Slack ${SLACK_CHANNEL_ID} -> Internal ID ${INTERNAL_CONVERSATION_ID}`);
            */


            // 🎯 STEP 3: Broadcast using your system's native ID room
           // io.to(INTERNAL_CONVERSATION_ID).emit('new_agent_comment', {
           io.to(SLACK_CHANNEL_ID).emit('new_agent_comment', {
                conversation_id: INTERNAL_CONVERSATION_ID, // Mobile app recognizes this!
                message_text: incomingText,
                source: 'Slack_Web',
                created_at: new Date()
            });

        } catch (dbError) {
            console.error("🚨 Database lookup failed during Slack routing pipeline:", dbError);
        }
    }

    res.sendStatus(200);
});


app.listen(3006, () => console.log('🔗 Webhook Listener on :3006'));