const express = require('express');
const axios = require('axios');
const { syncToSalesforce } = require('./salesforce-service');
const app = express();

app.use(express.json());
app.use(express.static('public')); // We will put the HTML here

const GATEWAY_URL = 'http://localhost:3000';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4iLCJpYXQiOjE3NzgzNDE0NTgsImV4cCI6MTc3ODM0NTA1OH0.fyRY8A6-kuT50UbwenXx7xDWE_adaOqJlRElWHOFjs4'; // Must be a valid token for the Gateway

// 1. Get Data for the Form
app.get('/setup-data', async (req, res) => {
    try {
        const config = { headers: { Authorization: `Bearer ${JWT_TOKEN}` } };
        
        // Fetch accounts and products via the Gateway
        const [accRes, prodRes] = await Promise.all([
            axios.get(`${GATEWAY_URL}/accounts/accounts`, config),
            axios.get(`${GATEWAY_URL}/products/products`, config)
        ]);

        res.json({ accounts: accRes.data, products: prodRes.data });
        console.log(`✅ Data sent to UI: ${accRes.data.length} accounts, ${prodRes.data.length} products`);
    } catch (err) {
        console.error("❌ Order Service Error:", err.message);
        res.status(500).json({ error: "Failed to fetch setup data", details: err.message });
    }
});

// 2. Create the Order
app.post('/create-order', async (req, res) => {
    const { accountId, productId, quantity, sf_account_id } = req.body;

    try {
        console.log('🛒 Creating Order in Salesforce...');
        
        // In Salesforce, an Order usually needs a PricebookEntry, 
        // but for this factory, we'll sync it to a custom "Order__c" or "Contract"
        const sfId = await syncToSalesforce('Contract', {
            AccountId: sf_account_id, // Link to the SF Account
            StartDate: new Date().toISOString().split('T')[0],
            ContractTerm: 12,
            Status: 'Draft',
            Description: `Product ID: ${productId}, Qty: ${quantity}`
        });

        res.status(201).json({ success: true, sfId: sfId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(3007, () => console.log('📦 Order Service UI on :3007'));