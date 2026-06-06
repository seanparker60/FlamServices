const express = require('express');
const { Pool } = require('pg');
const { syncToSalesforce } = require('./salesforce-service');
const app = express();
app.use(express.json());

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

app.get('/products', async (req, res) => {
    try {
        const result = await db.query('SELECT id, name, price FROM products');
        res.json(result.rows);
    } catch (err) {
        console.error("Database Error:", err.message);
        res.status(500).json({ error: "Could not fetch products" });
    }
});

app.post('/', async (req, res) => {
    const { name, description, price } = req.body;

    try {
        // 1. Sync to Salesforce Product2 Object
        const sfId = await syncToSalesforce('Product2', {
            Name: name,
            Description: description,
            IsActive: true
        });

        // 2. Save locally
        const sql = 'INSERT INTO products (name, description, price, sf_id) VALUES ($1, $2, $3, $4) RETURNING id';
        const result = await db.query(sql, [name, description, price, sfId]);
        
        res.status(201).json({ 
            message: "Product Sync Success", 
            localId: result.rows[0].id, 
            sfId: sfId 
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.listen(3003, () => console.log('🏷️  Product Service on 3003'));