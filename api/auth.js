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

    // ======================================================
    // INSCRIPTION
    // ======================================================
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

    // ======================================================
    // CONNEXION
    // ======================================================
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

      // Récupère les infos utilisateur avec le statut abonnement
      const userR = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=is_pro,plan,subscription_id,subscription_cancelled_at,pro_since`, {
        headers: {
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${SUPABASE_SECRET}`
        }
      });
      const users = await userR.json();
      const user = users?.[0];

      // Vérifie si l'abonnement est toujours actif
      let isPro = false;
      let plan = null;

      if (user?.is_pro) {
        // Si l'abonnement a été annulé, on vérifie la date
        if (user.subscription_cancelled_at) {
          // L'abonnement est annulé — plus Pro
          isPro = false;
        } else {
          isPro = true;
          plan = user.plan || 'monthly';
        }
      }

      return res.status(200).json({
        success: true,
        token: data.access_token,
        isPro,
        plan,
        email
      });

    // ======================================================
    // VÉRIFIER STATUT ABONNEMENT (appelé au chargement de la page)
    // ======================================================
    } else if (action === 'checkSubscription') {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token manquant' });

      // Vérifie le token Supabase
      const authR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${token}`
        }
      });

      if (!authR.ok) return res.status(401).json({ error: 'Token invalide' });
      const authUser = await authR.json();

      // Récupère le statut depuis la table users
      const userR = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(authUser.email)}&select=is_pro,plan,subscription_cancelled_at`, {
        headers: {
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${SUPABASE_SECRET}`
        }
      });
      const users = await userR.json();
      const user = users?.[0];

      const isPro = user?.is_pro && !user?.subscription_cancelled_at;

      return res.status(200).json({
        success: true,
        isPro: isPro || false,
        plan: user?.plan || null,
        email: authUser.email
      });

    // ======================================================
    // ANNULER L'ABONNEMENT
    // ======================================================
    } else if (action === 'cancelSubscription') {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Token manquant' });

      // Vérifie le token
      const authR = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${token}`
        }
      });
      if (!authR.ok) return res.status(401).json({ error: 'Token invalide' });
      const authUser = await authR.json();

      // Récupère le subscription_id
      const userR = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(authUser.email)}&select=subscription_id`, {
        headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
      });
      const users = await userR.json();
      const subscriptionId = users?.[0]?.subscription_id;

      if (!subscriptionId) {
        // Pas de subscription_id — on annule directement dans Supabase
        await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(authUser.email)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SECRET,
            'Authorization': `Bearer ${SUPABASE_SECRET}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            is_pro: false,
            subscription_cancelled_at: new Date().toISOString()
          })
        });
        return res.status(200).json({ success: true, message: 'Abonnement annulé.' });
      }

      // Annule via Stripe API
      const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
      const stripeR = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (stripeR.ok) {
        // Stripe confirmera via webhook customer.subscription.deleted
        // Mais on marque aussi directement pour plus de réactivité
        await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(authUser.email)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SECRET,
            'Authorization': `Bearer ${SUPABASE_SECRET}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            is_pro: false,
            subscription_cancelled_at: new Date().toISOString(),
            subscription_id: null
          })
        });
        return res.status(200).json({ success: true, message: 'Abonnement annulé avec succès.' });
      } else {
        const errData = await stripeR.json();
        return res.status(400).json({ error: errData.error?.message || 'Erreur annulation Stripe' });
      }

    // ======================================================
    // CODE PROMO
    // ======================================================
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
        body: JSON.stringify({
          is_pro: true,
          promo_code: code,
          plan: 'promo',
          pro_since: new Date().toISOString()
        })
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

    // ======================================================
    // MOT DE PASSE OUBLIÉ
    // ======================================================
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

    // ======================================================
    // MISE À JOUR MOT DE PASSE
    // ======================================================
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
    console.error('Auth error:', err);
    return res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
