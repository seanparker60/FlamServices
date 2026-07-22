const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const app = express();

app.use(express.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_USER_TOKEN = process.env.SLACK_USER_TOKEN; // your admin user's token, needed for DM mode and agent mentions
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;
const AGENTFORCE_BOT_ID = process.env.AGENTFORCE_BOT_ID; // 'U0BJKS8T267'
const SLACK_USE_DM = process.env.SLACK_USE_DM; // boolean flag from env process.env.SLACK_USE_DM === 'true';

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

// 📱 Endpoint A: Mobile App starts a fresh conversation session
app.post('/message', async (req, res) => {
    const { contactSfId, message_text, user_name } = req.body;
    var DYNAMIC_CHANNEL_ID;

    try {
        const result = await db.query(
            `SELECT id, message_text, conversation_id, source, slack_ts, TO_CHAR(created_at, 'HH12:MI AM') as time FROM slack_messages WHERE contact_sf_id = $1 ORDER BY created_at ASC`,
            [contactSfId]
        );

        const isNewSession = result.rows.length === 0;
        DYNAMIC_CHANNEL_ID = !isNewSession ? result.rows[0].conversation_id : null;
        const rootThreadTs = !isNewSession ? result.rows[0].slack_ts : null; // first message's ts becomes the thread root

        if (DYNAMIC_CHANNEL_ID == null) {

            if (SLACK_USE_DM) {
                // =========================================================
                // 🆕 DM MODE: Open a direct message channel with the agent
                // =========================================================
                console.log('💬 SLACK_USE_DM is true — opening DM with agent instead of creating a channel.');

                const openDmResponse = await axios.post('https://slack.com/api/conversations.open', {
                  //  users: AGENTFORCE_BOT_ID
                  users: `${AGENTFORCE_BOT_ID},${MY_OWN_BOT_ID}` // changed: now includes your own bot too, creating a group DM
                }, {
                    headers: {
                        'Authorization': `Bearer ${SLACK_USER_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8'
                    }
                });

                if (!openDmResponse.data.ok) {
                    throw new Error(`Slack DM open failed: ${openDmResponse.data.error}`);
                }

                DYNAMIC_CHANNEL_ID = openDmResponse.data.channel.id; // 'D...'
                console.log(`✅ DM channel opened: ${DYNAMIC_CHANNEL_ID}`);

            } else {
                // =========================================================
                // 🆕 CHANNEL MODE: Dynamically create a new Slack channel
                // =========================================================
                const cleanName = `chat-${(user_name || 'user').toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString().slice(-4)}`;

                const createChannelResponse = await axios.post('https://slack.com/api/conversations.create', {
                    name: cleanName,
                    is_private: false,
                    users: `U0BA17L3N6T,${AGENTFORCE_BOT_ID}`
                }, {
                    headers: {
                        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                        'Content-Type': 'application/json; charset=utf-8'
                    }
                });
                console.log('SLACK NEW CHANNEL POST:contactSfId:cleanName' + cleanName);
                if (!createChannelResponse.data.ok) {
                    throw new Error(`Slack Channel creation failed: ${createChannelResponse.data.error}`);
                }

                DYNAMIC_CHANNEL_ID = createChannelResponse.data.channel.id;

                try {
                    await axios.post('https://slack.com/api/conversations.invite', {
                        channel: DYNAMIC_CHANNEL_ID,
                        users: `U0BA17L3N6T,${AGENTFORCE_BOT_ID}`
                    }, {
                        headers: {
                            'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
                            'Content-Type': 'application/json; charset=utf-8'
                        }
                    });
                    console.log(`👥 Successfully pulled user and agent into channel ${DYNAMIC_CHANNEL_ID}`);
                } catch (inviteError) {
                    console.error('⚠️ Could not auto-invite user/agent:', inviteError.response?.data?.error || inviteError.message);
                }
            }
        }

        // =========================================================
        // POST THE MESSAGE — text, token, and threading differ by mode/session state
        // =========================================================
        const postToken = SLACK_USER_TOKEN;
        const messageText = SLACK_USE_DM
            ? message_text
            : isNewSession
                ? `<@${AGENTFORCE_BOT_ID}> 📱 *New Support Session Started by ${user_name}:*\n${message_text}`
                : `<@${AGENTFORCE_BOT_ID}> ${message_text}`;

        const response = await axios.post('https://slack.com/api/chat.postMessage', {
            channel: DYNAMIC_CHANNEL_ID,
            text: messageText,
            ...(rootThreadTs && { thread_ts: rootThreadTs }) // present only on follow-ups; threads under the first message
        }, {
            headers: {
                'Authorization': `Bearer ${postToken}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        });

        if (!response.data.ok) {
            throw new Error(response.data.error);
        }

        const SLACK_TS = response.data.ts;
        console.log('SLACK NEW CHANNEL POST:contactSfId:SLACK_TS' + SLACK_TS);

        const insertQuery = `
            INSERT INTO slack_messages (contact_sf_id,conversation_id, sender_id, message_text, slack_ts, source, created_at)
            VALUES ($1, $2, $3, $4, $5,$6, NOW());
        `;

        await db.query(insertQuery, [
            contactSfId,
            DYNAMIC_CHANNEL_ID,
            user_name || 'Mobile',
            message_text,
            SLACK_TS,
            'Mobile_App'
        ]);

        res.json({ success: true, conversation_id: DYNAMIC_CHANNEL_ID, ts: SLACK_TS, mode: SLACK_USE_DM ? 'dm' : 'channel' });

    } catch (error) {
        console.error('❌ Failed to process dynamic pipeline step:', error.message);
        res.status(500).json({ error: 'Internal failure processing session creation', details: error.message });
    }
});


app.listen(3019, () => console.log('[SLACK] 💬 Slack Channel Service live on 3019'));
