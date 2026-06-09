const express = require('express');
const { Pool } = require('pg');
const crypto = require('crypto'); // Built-in Node.js module to generate UUIDs
const axios = require('axios');
const { syncToSalesforce } = require('./salesforce-service'); 

const app = express();
app.use(express.json());

// --- Salesforce MIAW Configuration Constants ---
// Replace these placeholders with your actual Salesforce Org configuration data
const SCRT_BASE_URL = 'https://orgfarm-a37c23459e-dev-ed.develop.my.salesforce-scrt.com'; 
const ORG_ID = '00DgK00000Fsiuf'; 
const DEVELOPER_NAME = 'Flamingo_Mobile_Chat'; 

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
            `SELECT id, message_text,conversation_id, source, TO_CHAR(created_at, 'HH12:MI AM') as time FROM messages WHERE contact_sf_id = $1 ORDER BY created_at ASC`, 
            [contactSfId]
        );
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Failed to fetch messages:", error);
        res.status(500).json({ error: "Failed to retrieve message feed" });
    }
});

app.post('/', async (req, res) => {
    console.log('--- 📩 Message Service: POST Received ---');
    const { contactSfId, fullName, messageText } = req.body;
    var accessToken;
    try {
        // =========================================================================
        // STEP 1: AUTHENTICATE & FETCH ACCESS TOKEN
        // =========================================================================
        console.log('🔑 Fetching Salesforce MIAW Access Token...');
        const tokenResponse = await axios.post(`${SCRT_BASE_URL}/iamessage/api/v2/authorization/unauthenticated/access-token`, {
            orgId: ORG_ID,
            esDeveloperName: DEVELOPER_NAME,
            capabilitiesVersion: '1',
            platform: 'Web'
            

           // capabilities: ["InAppMessaging"]
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        accessToken = tokenResponse.data.accessToken;
        console.log('✅ Access Token Retrieved Successfully.');

        // =========================================================================
        // STEP 2: CREATE THE CONVERSATION SESSION
        // =========================================================================
        console.log('🚀 Initializing MIAW Conversation Session...');

        var conversationId = crypto.randomUUID(); // '550e8400-e29b-41d4-a716-446655446611'

        console.log(`🔍 Checking PostgreSQL for active sessions matching Contact: ${contactSfId}...`);
        
        const checkSql = `
            SELECT conversation_id, accesstoken
            FROM messages 
            WHERE contact_sf_id = $1 AND conversation_status != 'Closed' AND conversation_id IS NOT NULL
            ORDER BY created_at DESC LIMIT 1
        `;
        // Note: Replace 'created_at' if your table tracking timestamp field uses a different name
        
        const resultCheck = await db.query(checkSql, [contactSfId]);

        if (resultCheck.rows.length > 0) {
            // Found an open session! Reuse the ID and skip Step 2 entirely
            conversationId = resultCheck.rows[0].conversation_id;
            accessToken = resultCheck.rows[0].accesstoken;

            console.log(`♻️ Found active session! Reusing Conversation ID: ${conversationId}`);
        } else {

            const conversationResponse = await axios.post(`${SCRT_BASE_URL}/iamessage/api/v2/conversation`, {
                esDeveloperName: DEVELOPER_NAME,
                conversationId: conversationId,
            // isNewMessagingSession: true,
                routingAttributes: {
                    X_Conversation_ID: conversationId
                }
            }, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
        }    
        //const conversationId = conversationResponse.data.conversationId;
        console.log(`✅ Session Created. Conversation ID: ${conversationId}`);

        // =========================================================================
        // STEP 3: POST THE MESSAGE PAYLOAD
        // =========================================================================
        console.log('📤 Sending Message Payload to Salesforce Chat Routing...');
        
        // This natively replaces the Postman '{{$guid}}' behavior securely
        const uniqueMessageId = crypto.randomUUID(); 

        await axios.post(`${SCRT_BASE_URL}/iamessage/api/v2/conversation/${conversationId}/message`, {
            message: {
                id: uniqueMessageId,
                messageType: "StaticContentMessage",
                staticContent: {
                    formatType: "Text",
                    text: messageText // The dynamic incoming message string
                }
            },
            esDeveloperName: DEVELOPER_NAME
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Message accepted by Salesforce Routing Engine.');

        // =========================================================================
        // EXISTING BACKEND STORAGE LOGIC
        // =========================================================================
        /*
        console.log('☁️ Syncing Custom Message__c Record to Salesforce Core...');
        const sfId = await syncToSalesforce('Message__c', {
            Contact__c: contactSfId,      
            Name__c: fullName,            
            Message_Text__c: messageText  
        });
        */
        try {
            console.log('🗄️ Saving Transaction Record to Local PostgreSQL...');
            const sql = 'INSERT INTO messages (contact_sf_id, full_name, message_text, sf_id, conversation_id, message_id, accesstoken, conversation_status, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id';
            const resultInsert = await db.query(sql, [contactSfId, fullName, messageText, '11111111', conversationId, uniqueMessageId, accessToken, 'Waiting', 'Mobile']);
            
            res.status(201).json({ 
                status: "Success",
                message: "MIAW Handshake Complete & Logged Successfully", 
                conversationId: conversationId,
                localId: resultInsert.rows[0].id 
             //   sfId: sfId 
            });
        } catch (err) {
            console.error('❌ PostgreSQL Error:', err.message);
            res.status(500).json({ error: err.message });
        }
      
    } catch (error) {
        console.error('🔥 MIAW/Salesforce Gateway Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ 
            error: "Salesforce Handshake Failed", 
            details: error.response ? error.response.data : error.message 
        });
    }
});

app.listen(3018, () => console.log('📩 Message Service on 3018'));