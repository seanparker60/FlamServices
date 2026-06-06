const { Pool } = require('pg');
const jsforce = require('jsforce');
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

async function processQueue() {
    console.log("Checking for pending syncs...");
    
    const result = await db.query('SELECT * FROM sync_queue WHERE status = \'PENDING\' AND attempts < 5');
    const rows = result.rows;

    if (rows.length === 0) return;

    try {
        await conn.login(process.env.SF_USERNAME, process.env.SF_PASSWORD);

        for (let row of rows) {
            try {
                const resultSync = await conn.sobject(row.object_type).create(JSON.parse(row.payload));
                if (resultSync.success) {
                    await db.query('UPDATE sync_queue SET status = \'COMPLETED\' WHERE id = $1', [row.id]);
                    console.log(`[Worker] Fixed record ${row.id}`);
                }
            } catch (e) {
                await db.query('UPDATE sync_queue SET attempts = attempts + 1, last_error = $1 WHERE id = $2', [e.message, row.id]);
            }
        }
    } catch (err) {
        console.error("[Worker] Could not connect to Salesforce. Will try again.");
    }
}

// Run every 60 seconds
setInterval(processQueue, 60000);
processQueue();