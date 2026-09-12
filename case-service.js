require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
// const nodemailer = require('nodemailer'); // replaced by SendGrid HTTPS API below
const axios = require('axios');
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
/*
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'seanparker60@gmail.com',
        pass: 'kuxf wsgj bmfv jrlj' // Not your login password, a Gmail App Password
    }
});
*/
// SMTP transporter (Gmail) — worked locally, but hung until timeout when deployed on
// Render because outbound SMTP (587/465) got silently dropped after the Gmail account
// was compromised/flagged. Replaced with SendGrid's HTTPS API (port 443) below.
/*
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // STARTTLS instead of implicit TLS on 465
    family: 4, // force IPv4, skips any flaky IPv6 path
    auth: {
        user: process.env.Case_Email_User,
        pass: process.env.Case_Email_Code // Not your login password, a Gmail App Password
    },
    logger: true, // prints each SMTP step to the console
    debug: true // shows the raw protocol exchange
});
*/

// 2b. SendGrid (HTTPS API on port 443 — avoids the SMTP ports Render was blocking)
const CASE_EMAIL_SENDGRID_API_KEY = process.env.CASE_EMAIL_SENDGRID_API_KEY;
const CASE_FROM_EMAIL = process.env.Case_Email_User; // must be a Verified Sender in SendGrid



app.post('/', async (req, res) => {
    console.log('--- 📁 Case Service: POST Received ---');
    const { contactSfId, subject, description, email } = req.body;

    // REPLACE THIS with your actual Salesforce Email-to-Case address
 //   const SF_CASE_EMAIL = 'seanparker60@y-1bd2c77bc7q0nvspkda5qnff3dz2zvggl1cpyx6pd8uy2ag7e3.g-cmjfma0.na225.case.salesforce.com';

    const SF_CASE_EMAIL = process.env.Case_EmailtoCase;
    try {
        console.log('📧 Sending Email to Salesforce Email-to-Case via SendGrid...');

        // --- old nodemailer/Gmail send path (kept for reference, no longer used) ---
        /*
        console.log('🗄️ Case Case_Email_User...'+process.env.Case_Email_User);
        console.log('🗄️ Case Case_Email_Code...'+process.env.Case_Email_Code);
        console.log('🗄️ Case SF_CASE_EMAILL...'+SF_CASE_EMAIL);
        const mailOptions = {
            from: process.env.Case_Email_User,
            to: SF_CASE_EMAIL,
            subject: subject,
            text: `ContactID: ${contactSfId}\nOrigin: Web\nStatus: New\n\nDescription:\n${description}`,
            replyTo: email // So Salesforce can map it back to the user
        };

        await transporter.sendMail(mailOptions);
        */

        await axios.post('https://api.sendgrid.com/v3/mail/send', {
            personalizations: [{
                to: [{ email: SF_CASE_EMAIL }]
            }],
            from: { email: CASE_FROM_EMAIL },
            ...(email && { reply_to: { email } }), // So Salesforce can map it back to the user
            subject: subject,
            content: [{
                type: 'text/plain',
                value: `ContactID: ${contactSfId}\nOrigin: Web\nStatus: New\n\nDescription:\n${description}`
            }]
        }, {
            headers: {
                Authorization: `Bearer ${CASE_EMAIL_SENDGRID_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        // 3. Save locally to MySQL for tracking
        console.log('🗄️ Saving Case Log to MySQL...');
        const sql = 'INSERT INTO cases (contact_sf_id, subject, description, status) VALUES (?, ?, ?, ?)';
        await db.query(sql, [contactSfId, subject, description, 'New']);

        res.status(201).json({ message: "Case Email Sent Successfully" });

    } catch (error) {
        const details = error.response?.data || error.message;
        console.error('🔥 Case Error:', details);
        res.status(500).json({ error: "Failed to process case", details });
    }
});

app.listen(3013, () => console.log('📁 Case Service on 3013'));
