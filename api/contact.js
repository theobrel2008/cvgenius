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

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CVGenius <onboarding@resend.dev>',
        to: ['theo.brel@icloud.com'],
        reply_to: email,
        subject: `[CVGenius Contact] ${sujet || 'Message'} — ${nom}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
            <div style="background:#6c47ff;padding:16px 24px;border-radius:10px 10px 0 0;">
              <h2 style="color:#fff;margin:0;font-size:18px;">📬 Nouveau message CVGenius</h2>
            </div>
            <div style="background:#f9f9f9;padding:24px;border-radius:0 0 10px 10px;border:1px solid #eee;">
              <p style="margin:0 0 8px;"><strong>Nom :</strong> ${nom}</p>
              <p style="margin:0 0 8px;"><strong>Email :</strong> <a href="mailto:${email}">${email}</a></p>
              <p style="margin:0 0 16px;"><strong>Sujet :</strong> ${sujet || 'Non précisé'}</p>
              <hr style="border:none;border-top:1px solid #eee;margin-bottom:16px;">
              <p style="margin:0 0 8px;"><strong>Message :</strong></p>
              <p style="background:#fff;padding:16px;border-radius:8px;border:1px solid #eee;line-height:1.7;margin:0;">${message.replace(/\n/g, '<br>')}</p>
            </div>
            <p style="font-size:11px;color:#999;text-align:center;margin-top:16px;">Envoyé depuis cv-genius.com</p>
          </div>
        `
      })
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Erreur envoi email' });
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Contact error:', e);
    return res.status(500).json({ error: e.message });
  }
};

module.exports = handler;
