const express = require('express');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const app = express();
app.use(express.json());

// 1. Database Connection
const db = mysql.createPool({ 
    host: 'localhost', 
    user: 'root', 
    password: '', 
    database: 'integration_factory',
    waitForConnections: true,
    connectionLimit: 10
});

// 2. Email Transporter (Using Gmail as an example - use your SMTP)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'seanparker60@gmail.com',
        pass: 'kuxf wsgj bmfv jrlj' // Not your login password, a Gmail App Password
    }
});

app.post('/', async (req, res) => {
    console.log('--- 📁 Case Service: POST Received ---');
    const { contactSfId, subject, description, email } = req.body;
    
    // REPLACE THIS with your actual Salesforce Email-to-Case address
    const SF_CASE_EMAIL = 'seanparker60@y-1bd2c77bc7q0nvspkda5qnff3dz2zvggl1cpyx6pd8uy2ag7e3.g-cmjfma0.na225.case.salesforce.com';

    try {
        console.log('📧 Sending Email to Salesforce Email-to-Case...');
        
        const mailOptions = {
            from: 'seanparker60@gmail.com',
            to: SF_CASE_EMAIL,
            subject: subject,
            text: `ContactID: ${contactSfId}\nOrigin: Web\nStatus: New\n\nDescription:\n${description}`,
            replyTo: email // So Salesforce can map it back to the user
        };

        await transporter.sendMail(mailOptions);

        // 3. Save locally to MySQL for tracking
        console.log('🗄️ Saving Case Log to MySQL...');
        const sql = 'INSERT INTO cases (contact_sf_id, subject, description, status) VALUES (?, ?, ?, ?)';
        await db.query(sql, [contactSfId, subject, description, 'New']);

        res.status(201).json({ message: "Case Email Sent Successfully" });

    } catch (error) {
        console.error('🔥 Case Error:', error.message);
        res.status(500).json({ error: "Failed to process case", details: error.message });
    }
});

app.listen(3013, () => console.log('📁 Case Service on 3013'));