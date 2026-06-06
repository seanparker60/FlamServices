const express = require('express');
const axios = require('axios');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg'); 

const app = express();
const PORT = 3020;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ══════════════════════════════════════════════════════════════
// 🔴 ENTER YOUR EXACT SALESFORCE APP CREDENTIALS HERE
// ══════════════════════════════════════════════════════════════
const SF_DOMAIN =process.env.MES_SF_DOMAIN; //'https://orgfarm-a37c23459e-dev-ed.develop.my.salesforce.com'; // 🔴 Replace with your domain
const CLIENT_ID =process.env.MES_CLIENT_ID; 
const CLIENT_SECRET =process.env.MES_CLIENT_SECRET; 

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

const activeTrackers = new Map(); 
const lastProcessedIdMap = new Map();

app.use(express.json());

// Fetch a valid API access token
async function getSalesforceToken() {
    try {
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET
        });
        const response = await axios.post(`${SF_DOMAIN}/services/oauth2/token`, params);
        return response.data.access_token;
    } catch (error) {
        console.error('❌ OAuth Token Generation Failed:', error.response?.data || error.message);
        return null;
    }
}

// The exact API request logic from your successful Apex script
async function pollEnhancedConnectAPI(conversationIdentifier) {
    const token = await getSalesforceToken();
    if (!token) return;

    try {
        // 🎯 EXACT SAME URL PATH THAT WORKED IN YOUR APEX CODES
    //     const url = `${SF_DOMAIN}/services/data/v61.0/connect/conversation/${conversationIdentifier}/entries`;

        const conversationIdentifier = '7c6ca740-51dc-4f3b-b437-fd0b64642aef';
        const url = `${SF_DOMAIN}/services/data/v61.0/connect/conversation/${conversationIdentifier}/entries`;
        const response = await axios.get(url, {
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // Connect API structured array
        const entries = response.data.conversationEntries || [];
        if (entries.length === 0) return;

        // Sort or locate the latest message
        // Connect entries usually return sequentially; let's check the most recent element


        // 1. Fixed SQL string to use a placeholder ($1) for the variable
        const checkSql = `
            SELECT conversation_id, accesstoken, contact_sf_id, full_name, message_text, message_id
            FROM messages 
            WHERE conversation_id = $1 AND message_id IS NOT NULL
            ORDER BY created_at DESC 
        `;

        // 2. Execute check query passing the conversationIdentifier
        const resultCheck = await db.query(checkSql, [conversationIdentifier]);
        const existingSessions = resultCheck.rows;
        const existingConversationsSet = new Set();

        let index = 0;
         while (index < existingSessions.length) {
            console.log(`existingSessions[index].message_id: ${existingSessions[index].message_id} `);
            console.log(`existingSessions[index].message_id: ${existingSessions[index].message_text} `);
                existingConversationsSet.add(existingSessions[index].message_id);
                index++;
        }
        
        index = 0;
       
        while (index < entries.length) {
        const currentEntry = entries[index];
        
        // 4. Only insert if the conversation ID is NOT in our existing list
        if (!existingConversationsSet.has(currentEntry.identifier)) {
            console.log(`currentEntry.identifier: ${currentEntry.identifier} `);
            const queryParams = [
            existingSessions[0].contact_sf_id, 
            existingSessions[0].full_name, 
            currentEntry.messageText, 
            existingSessions[0].contact_sf_id, 
            conversationIdentifier, 
            currentEntry.identifier, 
            existingSessions[0].accesstoken, 
            'Active', 
            'SF_Web'
            ];

            try {
            const sql = 'INSERT INTO messages (contact_sf_id, full_name, message_text, sf_id, conversation_id, message_id, accesstoken, conversation_status, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';              
            await db.query(sql, queryParams);
            console.log(`Inserted row at index ${index}`);
            
            // Add to set to prevent further inserts in this loop execution
            existingConversationsSet.add(currentEntry.identifier);
            } catch (error) {
            console.error(`Failed to insert row at index ${index}:`, error);
            }
        } else {
            console.log(`Skipped: Conversation ID ${currentEntry.identifier} already exists in DB.`);
        }

        index++;
        }

        
        const latestEntry = entries[entries.length - 1];
        const entryId = latestEntry.id; 
        const messageText = latestEntry.messageText;
        console.log(`pulling Connect entries for messageText:`, entries.length);
        
        // Deduplicate: check if this message is new
        if (messageText && lastProcessedIdMap.get(conversationIdentifier) !== entryId) {
            lastProcessedIdMap.set(conversationIdentifier, entryId);
            
            console.log(`[LIVE CHAT MESSAGE] ID ${conversationIdentifier}: "${messageText}"`);
            
            // Broadcast the text straight to your frontend room
            io.to(conversationIdentifier).emit('new_agent_comment', {
                conversationIdentifier,
                message: messageText,
                sender: latestEntry.sender?.role || 'Unknown',
                timestamp: latestEntry.clientTimestamp || new Date()
            });
        }
         
    } catch (error) {
        console.error(`❌ Error pulling Connect entries for ${conversationIdentifier}:`, error.response?.data || error.message);
    }
}

// ══════════════════════════════════════════════════════════════
// SOCKET ORCHESTRATION
// ══════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
    
    // Frontend sends the working conversationIdentifier string instead of an object ID
    socket.on('watch_session', (conversationIdentifier) => {
        if (!conversationIdentifier || conversationIdentifier.startsWith('YOUR_')) {
            console.log('⚠️ Ignored: Invalid conversation identifier provided.');
            return;
        }

        socket.join(conversationIdentifier);
        console.log(`⏱️ Polling initialized for Conversation UUID: ${conversationIdentifier}`);

        if (!activeTrackers.has(conversationIdentifier)) {
            // Check the working Connect URL endpoint every 3 seconds
            const intervalId = setInterval(() => pollEnhancedConnectAPI(conversationIdentifier), 3000);
            activeTrackers.set(conversationIdentifier, { intervalId, listeners: 1 });
            
            // Fire once immediately on stream load
            pollEnhancedConnectAPI(conversationIdentifier);
        } else {
            activeTrackers.get(conversationIdentifier).listeners += 1;
        }
    });

    socket.on('disconnecting', () => {
        for (const conversationIdentifier of socket.rooms) {
            if (activeTrackers.has(conversationIdentifier)) {
                const tracker = activeTrackers.get(conversationIdentifier);
                tracker.listeners -= 1;
                
                if (tracker.listeners <= 0) {
                    clearInterval(tracker.intervalId);
                    activeTrackers.delete(conversationIdentifier);
                    lastProcessedIdMap.delete(conversationIdentifier);
                    console.log(`🛑 Polling cleared for UUID: ${conversationIdentifier}`);
                }
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`🚀 Node.js Connection Server listening on port ${PORT}`);
});