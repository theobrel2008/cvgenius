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

// Met à jour le statut Pro d'un utilisateur dans Supabase
async function setUserPro(email, isPro, extraData = {}) {
  if (!email) return;

  // Vérifie si l'utilisateur existe
  const checkR = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=email,is_pro`, {
    headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
  });
  const users = await checkR.json();

  const updateData = {
    is_pro: isPro,
    ...extraData
  };

  if (users && users.length > 0) {
    // Met à jour l'utilisateur existant
    await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SECRET,
        'Authorization': `Bearer ${SUPABASE_SECRET}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updateData)
    });
    console.log(`User ${email} updated: is_pro=${isPro}`);
  } else {
    // Crée l'utilisateur s'il n'existe pas encore
    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SECRET,
        'Authorization': `Bearer ${SUPABASE_SECRET}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ email, ...updateData })
    });
    console.log(`Created user ${email}: is_pro=${isPro}`);
  }
}

// Log un paiement dans Supabase
async function logPayment(email, amount, currency, stripeId, type) {
  try {
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
        amount,
        currency,
        stripe_id: stripeId,
        type,
        paid_at: new Date().toISOString()
      })
    });
  } catch (e) {
    console.log('Payment log failed:', e.message);
  }
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

  try {
    // ======================================================
    // ABONNEMENT CRÉÉ OU PAIEMENT INITIAL RÉUSSI
    // ======================================================
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email = session.customer_details?.email || session.receipt_email || null;
      const mode = session.mode; // 'subscription' ou 'payment'
      const amount = session.amount_total ? session.amount_total / 100 : 0;

      if (email) {
        await setUserPro(email, true, {
          pro_since: new Date().toISOString(),
          subscription_id: session.subscription || null,
          plan: mode === 'subscription' ? (amount > 10 ? 'annual' : 'monthly') : 'lifetime'
        });

        await logPayment(email, amount, session.currency || 'eur', session.id, mode);
      }
    }

    // ======================================================
    // RENOUVELLEMENT MENSUEL / ANNUEL RÉUSSI
    // ======================================================
    else if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const email = invoice.customer_email;
      const amount = invoice.amount_paid ? invoice.amount_paid / 100 : 0;

      if (email && invoice.billing_reason === 'subscription_cycle') {
        // Renouvellement — on s'assure que le Pro est bien actif
        await setUserPro(email, true, {
          pro_renewed_at: new Date().toISOString()
        });

        await logPayment(email, amount, invoice.currency || 'eur', invoice.id, 'renewal');
        console.log(`Subscription renewed for ${email} — ${amount}€`);
      }
    }

    // ======================================================
    // PAIEMENT D'ABONNEMENT ÉCHOUÉ
    // ======================================================
    else if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object;
      const email = invoice.customer_email;

      if (email) {
        console.log(`Payment failed for ${email} — will retry automatically`);
        // On ne désactive pas immédiatement — Stripe va réessayer
        // On désactive seulement si l'abonnement est définitivement annulé
      }
    }

    // ======================================================
    // ABONNEMENT ANNULÉ (par le client ou après échec paiement)
    // ======================================================
    else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      // Récupérer l'email depuis l'ID Stripe customer
      // Note: tu devras stocker le customer_id dans Supabase pour retrouver l'email
      // Pour l'instant on log l'événement
      console.log(`Subscription cancelled for customer ${customerId}`);

      // Si tu stockes le stripe_customer_id dans Supabase:
      const userR = await fetch(`${SUPABASE_URL}/rest/v1/users?stripe_customer_id=eq.${customerId}&select=email`, {
        headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
      });
      const users = await userR.json();

      if (users && users.length > 0) {
        const email = users[0].email;
        await setUserPro(email, false, {
          subscription_cancelled_at: new Date().toISOString(),
          subscription_id: null
        });
        console.log(`Pro cancelled for ${email}`);
      }
    }

    // ======================================================
    // ABONNEMENT MIS À JOUR (upgrade/downgrade)
    // ======================================================
    else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const status = subscription.status;
      const customerId = subscription.customer;

      console.log(`Subscription updated for ${customerId}: status=${status}`);

      // Si l'abonnement est suspendu pour non-paiement
      if (status === 'past_due' || status === 'unpaid') {
        const userR = await fetch(`${SUPABASE_URL}/rest/v1/users?stripe_customer_id=eq.${customerId}&select=email`, {
          headers: { 'apikey': SUPABASE_SECRET, 'Authorization': `Bearer ${SUPABASE_SECRET}` }
        });
        const users = await userR.json();
        if (users && users.length > 0) {
          console.log(`Subscription past_due for ${users[0].email}`);
          // On laisse Stripe réessayer avant de désactiver
        }
      }
    }

  } catch (e) {
    console.error('Webhook processing error:', e);
    // On retourne 200 quand même pour éviter que Stripe ne réessaie en boucle
  }

  return res.status(200).json({ received: true });
};

// Désactive le body parser de Vercel pour avoir le raw body
export const config = { api: { bodyParser: false } };

module.exports = handler;
