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
      const { code, email } = req.body;
      const validCodes = (process.env.PROMO_CODES || 'PROVIP2026,CVPRO2026,GENIUS2026').split(',');

      if (!validCodes.includes(code?.toUpperCase())) {
        return res.status(400).json({ error: 'Code invalide' });
      }

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

    } else if (action === 'resetPassword') {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${SUPABASE_SECRET}`
        },
        body: JSON.stringify({ email })
      });
      if (!r.ok) {
        const data = await r.json();
        return res.status(400).json({ error: data.msg || data.message || 'Erreur envoi email' });
      }
      return res.status(200).json({ success: true });

    } else if (action === 'updatePassword') {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ error: 'Données manquantes' });
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ password })
      });
      if (!r.ok) {
        const data = await r.json();
        return res.status(400).json({ error: data.msg || data.message || 'Erreur mise à jour' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Action invalide' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
