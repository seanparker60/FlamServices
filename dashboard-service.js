const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');
//const mysql = require('mysql2/promise'); // Kept from original script
// Kept from original script: Database Connection Pool
/*
const db = mysql.createPool({ 
    host: 'localhost', 
    user: 'root', 
    password: '', 
    database: 'integration_factory' 
});
*/
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
        port: 3030
    }
);


const app = express();
const server = http.createServer(app);
const io = new Server(server);


app.use(express.static(path.join(__dirname, 'public')));

// Configuration map for all your microservices
const servicesConfig = {
    gateway: { name: "API Gateway", port: 3000, script: "gateway.js", process: null },
    accounts: { name: "Accounts Service", port: 3001, script: "accounts-service.js", process: null },
    products: { name: "Products Service", port: 3003, script: "products-service.js", process: null },
    webhook: { name: "Webhook Listener", port: 3006, script: "webhook-service.js", process: null },
    orders: { name: "Order UI Service", port: 3007, script: "orders-service.js", process: null },
    messages: { name: "Messages UI Service", port: 3018, script: "messagesession-service.js", process: null },
    worker: { name: "Background Worker", port: "N/A", script: "worker.js", process: null },
    cases: { name: "Cases UI Service", port: 3013, script: "case-service.js", process: null },
    contacts: { name: "Contacts UI Service", port: 3011, script: "contacts-service.js", process: null },
    ftpImport: { name: "FTP Order Importer", port: "N/A", script: "ftp-service-ImportOrders.js", process: null },
    worker: { name: "Background Worker", port: "N/A", script: "worker.js", process: null }  
};

// Main layout endpoint (Loads your new carousel)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'carousel.html'));
});

// --- OLD FEATURE KEPT: API to get current database statistics ---
app.get('/stats', async (req, res) => {
    try {
        const [counts] = await db.query(`
            SELECT status, COUNT(*) as count 
            FROM sync_queue 
            GROUP BY status
        `);
        
        const [recent] = await db.query('SELECT * FROM sync_queue ORDER BY created_at DESC LIMIT 5');
        
        // Return your original database stats
        res.json({ counts, recent });
    } catch (err) {
        console.error("Stats Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Helper function to launch a microservice and pipe logs to WebSocket
function startService(id) {
    const service = servicesConfig[id];
    if (service.process) return; // Already running

    console.log(`🚀 Spawning ${service.name} on port ${service.port}...`);
    
    service.process = spawn('node', [service.script]);

    service.process.stdout.on('data', (data) => {
        io.emit('log', { id, text: data.toString().trim() });
    });

    service.process.stderr.on('data', (data) => {
        io.emit('log', { id, text: `⚠️ ERROR: ${data.toString().trim()}` });
    });

    service.process.on('close', (code) => {
        service.process = null;
        io.emit('status-change', { id, status: 'Offline' });
    });

    io.emit('status-change', { id, status: 'Online' });
}

// Helper function to kill a running microservice safely
function stopService(id) {
    const service = servicesConfig[id];
    if (service.process) {
        service.process.kill();
        service.process = null;
        io.emit('status-change', { id, status: 'Offline' });
    }
}

// WebSocket connection management
io.on('connection', (socket) => {
    const states = {};
    Object.keys(servicesConfig).forEach(id => {
        states[id] = {
            name: servicesConfig[id].name,
            port: servicesConfig[id].port,
            status: servicesConfig[id].process ? 'Online' : 'Offline'
        };
    });
    socket.emit('init', states);

    socket.on('toggle-service', ({ id, action }) => {
        if (action === 'start') startService(id);
        if (action === 'stop') stopService(id);
    });
});

// Start Master Dashboard Control Panel
server.listen(3005, () => console.log('🖥️ Master Control Panel running at http://localhost:3005'));