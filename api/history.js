const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.method === 'GET' ? req.query : req.body;

  try {
    if (req.method === 'GET' || action === 'list') {
      // Récupère l'historique d'un utilisateur
      const email = req.query.email || req.body?.email;
      if (!email) return res.status(400).json({ error: 'Email requis' });

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/cv_history?user_email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=20`,
        {
          headers: {
            'apikey': SUPABASE_SECRET,
            'Authorization': `Bearer ${SUPABASE_SECRET}`
          }
        }
      );
      const data = await r.json();
      return res.status(200).json({ history: data || [] });

    } else if (action === 'save') {
      // Sauvegarde un CV dans l'historique
      const { email, type, name, jobTitle, content } = req.body;
      if (!email || !content) return res.status(400).json({ error: 'Données manquantes' });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/cv_history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET,
          'Authorization': `Bearer ${SUPABASE_SECRET}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          user_email: email,
          type: type || 'cv',
          name: name || 'Sans nom',
          job_title: jobTitle || '',
          content,
          created_at: new Date().toISOString()
        })
      });

      if (!r.ok) return res.status(400).json({ error: 'Erreur sauvegarde' });
      return res.status(200).json({ success: true });

    } else if (action === 'delete') {
      // Supprime un CV de l'historique
      const { id, email } = req.body;
      if (!id || !email) return res.status(400).json({ error: 'Données manquantes' });

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/cv_history?id=eq.${id}&user_email=eq.${encodeURIComponent(email)}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_SECRET,
            'Authorization': `Bearer ${SUPABASE_SECRET}`
          }
        }
      );

      if (!r.ok) return res.status(400).json({ error: 'Erreur suppression' });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Action invalide' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

module.exports = handler;
