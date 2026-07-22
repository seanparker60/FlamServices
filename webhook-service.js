const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const jwt = require('jsonwebtoken'); // Added for authentication
const app = express();
const http = require('http');
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
   // res.sendStatus(200); 

    const { event } = req.body || {};
    console.log('[SLACK LISTENR: event.text:]***', event.text);
     console.log('[SLACK LISTENR: event.message.text :]***', event.message.text);
    console.log('[SLACK LISTENR: event.type:]***', event.type);
    console.log('[SLACK LISTENR: event.bot_id:]***', event.bot_id);
  //  console.log('[SLACK LISTENER] FULL EVENT:', JSON.stringify(event, null, 2));

    const label = 'SLACK_EVENT';
    const lines = JSON.stringify(event, null, 2).split('\n');
    /*
    console.log(`--- ${label} (${lines.length} lines) ---`);
        lines.forEach((line, i) => console.log(`[${label} ${i}] ${line}`));
    console.log(`--- END ${label} ---`);
    */
    // Ignore bot messages, message edits, or system join events
    if (!event || event.bot_id || event.type !== 'message' || event.subtype) {
        return;
    }

    const incomingText = event.text;
    const SLACK_CHANNEL_ID = event.channel; // e.g., "C0BCTHLPHRN"
    const SLACK_USER_ID = event.user;
    const MESSAGE_TS = event.ts; // Slack's unique timestamp ID for this specific message

    console.log(`📥 Incoming Slack message from user ${SLACK_USER_ID} in channel ${SLACK_CHANNEL_ID}`);


    

    if (event && event.type === 'message' && !event.bot_id) {
        const incomingText = event.text;
       // const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID; // e.g., "C0BCTHLPHRN"

        try {
            // 🎯 STEP 1: Look up the mapping record in your database
            // Search your conversations table for the row where slack_channel_id matches

        const result = await db.query(
            `SELECT id,contact_sf_id, message_text,conversation_id, source, TO_CHAR(created_at, 'HH12:MI AM') as time FROM slack_messages WHERE conversation_id = $1 AND contact_sf_id IS NOT NULL ORDER BY created_at ASC`, 
            [SLACK_CHANNEL_ID]
        );

         
           console.log(`📢 Map Success! before Slack ${SLACK_CHANNEL_ID}`);
           /*io.to(SLACK_CHANNEL_ID).emit('new_agent_comment', {
               // conversation_id: INTERNAL_CONVERSATION_ID, // Mobile app recognizes this!
               conversation_id: SLACK_CHANNEL_ID,
                message_text: incomingText,
                source: 'Slack_Web',
                created_at: new Date()
            });
            */
           const CONTACTID = result.rows.length > 0 ? result.rows[0].contact_sf_id : null;
            const insertQuery = `
            INSERT INTO slack_messages (contact_sf_id,conversation_id, sender_id, message_text, slack_ts, source, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id; `;
            const dbResult = await db.query(insertQuery, [
                CONTACTID,
                SLACK_CHANNEL_ID, 
                SLACK_USER_ID, 
                incomingText, 
                MESSAGE_TS,
                'Slack_Web'
            ]);
        
            console.log(`💾 Saved to slack_messages table. Row Entry ID: ${dbResult.rows[0].id}`);

            await axios.post('http://localhost:3020/api/internal-broadcast', {
            room: SLACK_CHANNEL_ID, // "C0BCTHLPHRN"
            event_name: 'new_agent_comment',
            payload: {
                conversation_id: SLACK_CHANNEL_ID,
                message_text: incomingText,
                source: 'Slack_Web',
                created_at: new Date()
            }
        });

           // return res.sendStatus(200);
            console.log(`📢 Map Success! after Slack ${SLACK_CHANNEL_ID}`);

        } catch (dbError) {
            console.error("🚨 Database lookup failed during Slack routing pipeline:", dbError);
            return res.sendStatus(500);
        }
    }

    res.sendStatus(200);
});


app.listen(3006, () => console.log('🔗 Webhook Listener on :3006'));