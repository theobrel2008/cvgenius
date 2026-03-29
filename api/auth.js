const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password } = req.body;

  try {
    if (action === 'register') {
      // Register user
      const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${SUPABASE_SECRET}`
        },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.msg || data.message || 'Erreur inscription' });
      return res.status(200).json({ success: true, message: 'Compte créé ! Vérifiez votre email.' });

    } else if (action === 'login') {
      // Login user
      const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${SUPABASE_SECRET}`
        },
        body: JSON.stringify({ email, password })
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: 'Email ou mot de passe incorrect' });

      // Check if user is pro
      const userR = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=is_pro`, {
        headers: {
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${SUPABASE_SECRET}`
        }
      });
      const users = await userR.json();
      const isPro = users?.[0]?.is_pro || false;

      return res.status(200).json({
        success: true,
        token: data.access_token,
        isPro,
        email
      });

    } else if (action === 'activate') {
      // Activate pro with code
      const { code, email } = req.body;
      const validCodes = (process.env.PROMO_CODES || 'PROVIP2026,CVPRO2026,GENIUS2026').split(',');

      if (!validCodes.includes(code?.toUpperCase())) {
        return res.status(400).json({ error: 'Code invalide' });
      }

      // Update user to pro in DB
      const r = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${SUPABASE_SECRET}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ is_pro: true, promo_code: code })
      });

      if (r.ok) {
        // Mark code as used (add to used_codes table)
        await fetch(`${SUPABASE_URL}/rest/v1/used_codes`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SECRET,
            'Authorization': `Bearer ${SUPABASE_SECRET}`
          },
          body: JSON.stringify({ code: code.toUpperCase(), email, used_at: new Date().toISOString() })
        });
        return res.status(200).json({ success: true });
      } else {
        return res.status(400).json({ error: 'Erreur activation' });
      }
    }

    return res.status(400).json({ error: 'Action invalide' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
