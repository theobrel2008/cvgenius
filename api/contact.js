const nodemailer = require('nodemailer');

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { nom, email, sujet, message } = req.body;
  if (!nom || !email || !message) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  const transporter = nodemailer.createTransporter({
    service: 'gmail',
    auth: {
      user: process.env.CONTACT_EMAIL,
      pass: process.env.CONTACT_PASSWORD
    }
  });

  try {
    await transporter.sendMail({
      from: process.env.CONTACT_EMAIL,
      to: 'theo.brel@icloud.com',
      replyTo: email,
      subject: `[CVGenius Contact] ${sujet || 'Message'} — ${nom}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
          <h2 style="color:#6c47ff;">Nouveau message CVGenius</h2>
          <p><strong>Nom :</strong> ${nom}</p>
          <p><strong>Email :</strong> <a href="mailto:${email}">${email}</a></p>
          <p><strong>Sujet :</strong> ${sujet || 'Non précisé'}</p>
          <hr style="border:1px solid #eee;margin:16px 0;">
          <p><strong>Message :</strong></p>
          <p style="background:#f9f9f9;padding:16px;border-radius:8px;line-height:1.6;">${message.replace(/\n/g, '<br>')}</p>
          <hr style="border:1px solid #eee;margin:16px 0;">
          <p style="font-size:12px;color:#999;">Message envoyé depuis cv-genius.com</p>
        </div>
      `
    });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Email error:', e);
    return res.status(500).json({ error: 'Erreur envoi email: ' + e.message });
  }
};

module.exports = handler;
