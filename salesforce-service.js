const jsforce = require('jsforce');
const { Pool } = require('pg'); // Changed from mysql2/promise to pg Pool
require('dotenv').config();

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
const conn = new jsforce.Connection({ loginUrl: process.env.SF_LOGIN_URL });
const connSales = new jsforce.Connection({ loginUrl: process.env.SFSales_LOGIN_URL });

async function syncToSalesforce(objectName, data) {
    try {
        await conn.login(process.env.SF_USERNAME, process.env.SF_PASSWORD);
        const result = await conn.sobject(objectName).create(data);
        
        if (result.success) {
            console.log(`[ERP] Success: ${objectName} created.`);
            return result.id;
        }
    } catch (err) {
        console.error(`[ERP ERROR] Salesforce Service down. Queueing ${objectName}...`);
        
        // Save to the Queue for later (Changed placeholders from ? to $1, $2, $3)
        await db.query(
            'INSERT INTO sync_queue (object_type, payload, last_error) VALUES ($1, $2, $3)',
            [objectName, JSON.stringify(data), err.message]
        );
        return null; // Return null so local service knows it's pending
    }
}

async function syncToSalesforceSales(objectName, data) {
    try {
        await connSales.login(process.env.SFSales_USERNAME, process.env.SFSales_PASSWORD);
        const result = await connSales.sobject(objectName).create(data);
        
        if (result.success) {
            console.log(`[ERP] Success: ${objectName} created.`);
            return result.id;
        }
    } catch (err) {
        console.error(`[ERP ERROR] Salesforce Sales down. Queueing ${objectName}...`);
        console.error(`[ERP ERROR] Salesforce Sales down. Queueing ${err}...`);
        
        // Save to the Queue for later (Changed placeholders from ? to $1, $2, $3)
        await db.query(
            'INSERT INTO sync_queue (object_type, payload, last_error) VALUES ($1, $2, $3)',
            [objectName, JSON.stringify(data), err.message]
        );
        return null; // Return null so local service knows it's pending
    }
}

// Fixed exports block to export both functions together properly
module.exports = { 
    syncToSalesforce, 
    syncToSalesforceSales 
};