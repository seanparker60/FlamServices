const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; 
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID; // The target channel (e.g., #customer-support)

// 📱 Endpoint A: Mobile App sends a message TO Slack
app.post('/message', async (req, res) => {
    const { message_text, user_name } = req.body;

    try {
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

        if (!response.data.ok) {
            throw new Error(response.data.error);
        }

        const SLACK_TS = response.data.ts; // 'ts' is Slack's unique timestamp ID

        // =========================================================
        // 💾 DATABASE LOGIC ONLY: SAVE OUTBOUND TO SLACK_MESSAGES
        // =========================================================
        const insertQuery = `
            INSERT INTO slack_messages (conversation_id, sender_id, message_text, slack_ts, source, created_at)
            VALUES ($1, $2, $3, $4, $5, NOW());
        `;
        
        await dbPool.query(insertQuery, [
            SLACK_CHANNEL_ID,       // conversation_id
            user_name || 'Mobile',  // sender_id identity tracking
            message_text,           // original message clean text
            SLACK_TS,               // slack unique ts token
            'Mobile_App'            // source tracking string
        ]);

        res.json({ success: true, ts: response.data.ts }); // 'ts' is Slack's timestamp ID
    } catch (error) {
        console.error('❌ Failed to push message to Slack:', error.message);
        res.status(500).json({ error: 'Slack transmission failed' });
    }
});

app.listen(3019, () => console.log('[SLACK] 💬 Slack Channel Service live on 3019'));