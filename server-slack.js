const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const app = express();

app.use(express.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; 
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID; // The target channel (e.g., #customer-support)

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

// GET: Mobile App Feed Reader
app.get('/feed/:contactSfId', async (req, res) => {
    const { contactSfId } = req.params;
    try {
        const result = await db.query(
            `SELECT id, message_text,conversation_id, source, TO_CHAR(created_at, 'HH12:MI AM') as time FROM slack_messages WHERE contact_sf_id = $1 ORDER BY created_at ASC`, 
            [contactSfId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Failed to fetch messages:", error);
        res.status(500).json({ error: "Failed to retrieve message feed" });
    }
});

// 📱 Endpoint A: Mobile App sends a message TO Slack
/*
app.post('/message', async (req, res) => {
    const {contactSfId, message_text, user_name } = req.body;
console.log('SLACK POST:contactSfId:'+contactSfId);
    try {
console.log('Server-slack: Before post');

        const response = await axios.post('https://slack.com/api/chat.postMessage', {
            channel: SLACK_CHANNEL_ID,
            // Format it nicely so your team knows it came from the mobile app
            text: `📱 *New Message from ${user_name}:*\n${message_text}`
        }, {
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        });
        console.log('After Insert to Slack:'+response.data.error);
        if (!response.data.ok) {
            throw new Error(response.data.error);
        }

        const SLACK_TS = response.data.ts; // 'ts' is Slack's unique timestamp ID

        // =========================================================
        // 💾 DATABASE LOGIC ONLY: SAVE OUTBOUND TO SLACK_MESSAGES
        // =========================================================
        const insertQuery = `
            INSERT INTO slack_messages (contact_sf_id,conversation_id, sender_id, message_text, slack_ts, source, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW());
        `;
        console.log('Server-slack: Before insert to Postgress:');
       const dbResult = await db.query(insertQuery, [
            contactSfId,
            SLACK_CHANNEL_ID,       // conversation_id
            user_name || 'Mobile',  // sender_id identity tracking
            message_text,           // original message clean text
            SLACK_TS,               // slack unique ts token
            'Mobile_App'            // source tracking string
        ]);
        console.log(`Server-slack: 💾 Saved to slack_messages table. Row Entry ID: ${dbResult.rows[0].id}`);
        console.log('Server-slack: After insert to Postgress:');

        res.json({ success: true, ts: response.data.ts }); // 'ts' is Slack's timestamp ID
    } catch (error) {
        console.error('❌ Failed to push message to Slack:', error.message);
        res.status(500).json({ error: 'Slack transmission failed' });
    }
});
*/

// 📱 Endpoint A: Mobile App starts a fresh conversation session
app.post('/message', async (req, res) => {
    const { contactSfId,message_text, user_name } = req.body;

    try {
        // =========================================================
        // 🆕 STEP 1: DYNAMICALLY CREATE A NEW SLACK CHANNEL
        // =========================================================
        // Slack channel names must be lowercase, max 80 chars, alphanumeric/hyphens only
        const cleanName = `chat-${(user_name || 'user').toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`;

        const createChannelResponse = await axios.post('https://slack.com/api/conversations.create', {
            name: cleanName, 
            is_private: false, // Change to true if you want private triage rooms
            users: 'U0BA17L3N6T'
        }, {
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        });
console.log('SLACK NEW CHANNEL POST:contactSfId:cleanName'+cleanName);
        if (!createChannelResponse.data.ok) {
            throw new Error(`Slack Channel creation failed: ${createChannelResponse.data.error}`);
        }

        // 🎯 This is the dynamic 'C0...' ID generated on the fly by Slack!
        const DYNAMIC_CHANNEL_ID = createChannelResponse.data.channel.id; 

        // =========================================================
        // STEP 2: POST THE INTERACTION TO THE NEWLY CREATED ROOM
        // =========================================================
        const response = await axios.post('https://slack.com/api/chat.postMessage', {
            channel: DYNAMIC_CHANNEL_ID, // ⚡ Sent to the new channel
            text: `📱 *New Support Session Started by ${user_name}:*\n${message_text}`
        }, {
            headers: {
                'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        });

        if (!response.data.ok) {
            throw new Error(response.data.error);
        }

        const SLACK_TS = response.data.ts; 
console.log('SLACK NEW CHANNEL POST:contactSfId:SLACK_TS'+SLACK_TS);
        // =========================================================
        // STEP 3: LOG THE DYNAMIC ID INTO POSTGRES
        // =========================================================
        const insertQuery = `
            INSERT INTO slack_messages (contact_sf_id,conversation_id, sender_id, message_text, slack_ts, source, created_at)
            VALUES ($1, $2, $3, $4, $5,$6, NOW());
        `;
        
        await db.query(insertQuery, [
            contactSfId,
            DYNAMIC_CHANNEL_ID, // Saved dynamically now! (Ensure column type is altered to VARCHAR)
            user_name || 'Mobile',  
            message_text,           
            SLACK_TS,               
            'Mobile_App'            
        ]);

        // Return the dynamic target ID back to the mobile client 
        res.json({ success: true, conversation_id: DYNAMIC_CHANNEL_ID, ts: SLACK_TS }); 

    } catch (error) {
        console.error('❌ Failed to process dynamic pipeline step:', error.message);
        res.status(500).json({ error: 'Internal failure processing session creation', details: error.message });
    }
});

app.listen(3019, () => console.log('[SLACK] 💬 Slack Channel Service live on 3019'));