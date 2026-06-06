const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const csv = require('csv-parser');
const mysql = require('mysql2/promise');
const { syncToSalesforce } = require('./salesforce-service');

const db = mysql.createPool({ host: 'localhost', user: 'root', password: '', database: 'integration_factory' });

// The "FTP" folder to watch
const watchFolder = path.join(__dirname, 'ftp_dropzoneOrders');
if (!fs.existsSync(watchFolder)) fs.mkdirSync(watchFolder);

console.log(`🚀 FTP Watcher active on: ${watchFolder}`);

// Watch for new files
chokidar.watch(watchFolder).on('add', (filePath) => {
    if (filePath.endsWith('.csv')) {
        console.log(`📄 New CSV detected: ${path.basename(filePath)}`);
        processCSV(filePath);
    }
});

async function processCSV(filePath) {
    const results = [];
    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            for (const row of results) {
                try {
                    // 1. Lookup local IDs and Salesforce IDs based on Names in CSV
                    const [acc] = await db.query('SELECT sf_id FROM accounts WHERE name = ?', [row.account_name]);
                    const [prod] = await db.query('SELECT id FROM products WHERE name = ?', [row.product_name]);

                    if (acc.length > 0) {
                        console.log(`🛒 Creating Order for ${row.account_name}...`);
                        
                        // 2. Sync to Salesforce
                        await syncToSalesforce('Contract', {
                            AccountId: acc[0].sf_id,
                            StartDate: new Date().toISOString().split('T')[0],
                            ContractTerm: row.months || 12,
                            Status: 'Draft',
                            Description: `FTP Import: ${row.product_name} x ${row.quantity}`
                        });
                        console.log(`✅ Success for ${row.account_name}`);
                    } else {
                        console.error(`❌ Account ${row.account_name} not found in local DB.`);
                    }
                } catch (err) {
                    console.error(`❌ Row Error: ${err.message}`);
                }
            }
            // Move file to "processed" folder so it doesn't loop
            const processedDir = path.join(watchFolder, 'processed');
            if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir);
            fs.renameSync(filePath, path.join(processedDir, path.basename(filePath)));
        });
}