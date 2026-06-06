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
        port: 3030 // Custom port preserved
    }
);

// --- GET CONTACTS ---
app.get('/contacts', async (req, res) => {
    try {
        // Adjusted column names to match your exact Postgres schema (first_name, last_name)
        const result = await db.query('SELECT id, sf_id, first_name, last_name, email FROM contacts');
        res.json(result.rows); 
    } catch (err) {
        console.error("Database Error:", err.message);
        res.status(500).json({ error: "Could not fetch contacts" });
    }
});

// --- POST NEW CONTACT ---
app.post('/', async (req, res) => {
    console.log('--- 👤 Contact Service: POST Received ---');
    const { firstname, lastname, email } = req.body;

    try {
        // Sync to Salesforce
        console.log('☁️ Syncing Contact to Salesforce...');
        const sfId = await syncToSalesforce('Contact', {
            firstName: firstname,
            LastName: lastname,
            Email: email
        });

        // Save locally to PostgreSQL
        try {
            console.log('🗄️ Saving to PostgreSQL...');
            
            // Substituted variables with positional parameters ($1, $2, etc.) and appended RETURNING id
            const sql = 'INSERT INTO contacts (first_name, last_name, email, sf_id) VALUES ($1, $2, $3, $4) RETURNING id';
            
            const result = await db.query(sql, [firstname, lastname, email, sfId]);
            const newLocalId = result.rows[0].id;
  
            console.log('✅ Contact Sync Success!');
            res.status(201).json({ 
                message: "Contact Sync Success", 
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

app.listen(3011, () => console.log('👤 Contact Service on 3011'));