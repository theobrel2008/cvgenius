const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Vérifie la signature Stripe manuellement (sans SDK)
async function verifyStripeSignature(body, signature, secret) {
  const parts = signature.split(',');
  let timestamp = '';
  let v1 = '';
  for (const part of parts) {
    if (part.startsWith('t=')) timestamp = part.slice(2);
    if (part.startsWith('v1=')) v1 = part.slice(3);
  }
  if (!timestamp || !v1) return false;

  const payload = `${timestamp}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature_bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = Array.from(new Uint8Array(signature_bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === v1;
}

const handler = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['stripe-signature'];
  if (!signature) return res.status(400).json({ error: 'No signature' });

  // Récupère le body raw
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  // Vérifie la signature
  const valid = await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.error('Invalid Stripe signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody);
  console.log('Stripe webhook event:', event.type);

  // Paiement réussi
  if (event.type === 'checkout.session.completed' || event.type === 'payment_intent.succeeded') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.receipt_email || null;

    if (email) {
      try {
        // Vérifie si l'utilisateur existe dans Supabase
        const checkR = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=email,is_pro`, {
          headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
        });
        const users = await checkR.json();

        if (users && users.length > 0) {
          // Met à jour l'utilisateur existant en Pro
          await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SECRET,
              'Authorization': `Bearer ${SUPABASE_SECRET}`,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ is_pro: true, pro_since: new Date().toISOString() })
          });
          console.log(`User ${email} upgraded to Pro`);
        } else {
          // Crée l'entrée dans users si elle n'existe pas encore
          await fetch(`${SUPABASE_URL}/rest/v1/users`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_SECRET,
              'Authorization': `Bearer ${SUPABASE_SECRET}`,
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ email, is_pro: true, pro_since: new Date().toISOString() })
          });
          console.log(`Created Pro user ${email}`);
        }

        // Log le paiement
        await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SECRET,
            'Authorization': `Bearer ${SUPABASE_SECRET}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            email,
            amount: session.amount_total ? session.amount_total / 100 : 4.99,
            currency: session.currency || 'eur',
            stripe_id: session.id,
            paid_at: new Date().toISOString()
          })
        }).catch(e => console.log('Payment log failed (table may not exist):', e.message));

      } catch (e) {
        console.error('Supabase update error:', e);
      }
    }
  }

  return res.status(200).json({ received: true });
};

// Désactive le body parser de Vercel pour avoir le raw body
export const config = { api: { bodyParser: false } };

module.exports = handler;
