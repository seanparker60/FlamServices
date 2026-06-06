const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const csv = require('csv-parser');
const mysql = require('mysql2/promise');
const { syncToSalesforceSales } = require('./salesforce-service');

const db = mysql.createPool({ host: 'localhost', user: 'root', password: '', database: 'integration_factory' });

// The "FTP" folder to watch
const watchFolder = path.join(__dirname, 'ftp_dropzoneImportOrders');
if (!fs.existsSync(watchFolder)) fs.mkdirSync(watchFolder);

console.log(`🚀 FTP Watcher active on: ${watchFolder}`);

// Watch for new files
/*
chokidar.watch(watchFolder).on('add', (filePath) => {
    if (filePath.endsWith('.csv')) {
        console.log(`📄 New CSV detected: ${path.basename(filePath)}`);
        processCSV(filePath);
    }
});
*/
chokidar.watch(watchFolder, {
    ignored: [
        '**/processed/**', // Ignore anything inside the processed folder
        '**/.*'            // Good practice: ignore hidden files like .DS_Store
    ],
    persistent: true
}).on('add', (filePath) => {
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
                    

                   
                        console.log(`🛒 Creating Order for ${row.ExternalOrderId}...`);
                           
                   
                        // 2. Sync to Salesforce
                        var Header = false;
                        if(Header == true){

                            console.log(`🛒 Creating Order for Header:row.OperatingCompany ${row.OperatingCompany}`);
                            await syncToSalesforceSales('ImportOrder__c', {
                                customerNo__c: row.customerNo,
                                orderRef__c: row.orderRef,
                                ExternalOrderId__c: row.ExternalOrderId,
                                orderDate__c: row.orderDate,
                                Source__c: row.Source,
                                LineCount__c: row.LineCount,
                                OperatingCompany__c: row.OperatingCompany                            

                            });
                        }
                        else{

                            console.log(`🛒 Creating Order for Item`);
                            await syncToSalesforceSales('ImportOrder__c', {
                                customerNo__c: row.customerNo,
                                ExternalOrderId__c: row.ExternalOrderId,
                                ProductId__c: row.ProductId,
                                Quantity__c: row.Quantity,
                                TriggerBusinessLogic__c: row.TriggerBusinessLogic

                            });
                        } 
                             
                        console.log(`✅ Success for ${row.ExternalOrderId}`);
                    
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