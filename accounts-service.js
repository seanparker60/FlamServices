const express = require('express');
const { syncToSalesforce } = require('./salesforce-service'); // Uses your existing helper
const app = express();
app.use(express.json());

const { Pool } = require('pg');
const db = new Pool(
    process.env.DATABASE_URL ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    } : {
        host: 'localhost',
        user: 'postgres',
        password: 'flam123',
        database: 'integration_factory',
        port: 3030 // Changed from 3030 to default Postgres port 5432
    }
);

// --- GET ACCOUNTS ---
app.get('/accounts', async (req, res) => {
    try {
        // Postgres returns a result object. Rows live inside result.rows
        const result = await db.query('SELECT id, sf_id, name, email FROM accounts');
        res.json(result.rows); 
    } catch (err) {
        console.error("Database Error:", err.message);
        res.status(500).json({ error: "Could not fetch accounts" });
    }
});

// --- POST NEW ACCOUNT ---
app.post('/', async (req, res) => {
    console.log('--- 👤 Accounts Service: POST Received ---');
    const { name, email } = req.body;

    try {
        // Sync to Salesforce
        console.log('☁️ Syncing Account to Salesforce...');
        const sfId = await syncToSalesforce('Account', {
            Name: name,
            Phone: email // Or whatever field you mapped
        });

        // Save locally to PostgreSQL
        try {
            console.log('🗄️ Saving to PostgreSQL...');
            
            // Added "RETURNING id" to get the auto-generated SERIAL ID back from Postgres
            const sql = 'INSERT INTO accounts (name, email, sf_id) VALUES ($1, $2, $3) RETURNING id';
            
            const result = await db.query(sql, [name, email, sfId]);
            const newLocalId = result.rows[0].id; // Extract the ID returned by the database
            
            console.log('✅ Account Sync Success!');
            res.status(201).json({ 
                message: "Account Sync Success", 
                localId: newLocalId, 
                sfId: sfId 
            });
        } catch (err) {
            console.error('❌ PostgreSQL Error:', err.message);
            res.status(500).json({ error: err.message });
        }
        
    } catch (error) {
        console.error('🔥 Salesforce Error:', error.message);
        res.status(500).json({ error: "Salesforce Sync Failed", details: error.message });
    }
});

app.listen(3001, () => console.log('👤 Account Service on 3001'));