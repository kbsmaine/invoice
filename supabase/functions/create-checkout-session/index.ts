import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function getRequiredSecret(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required secret: ${name}`)
  return value
}

function getPeriodEnd(subscription: Stripe.Subscription) {
  const timestamps = subscription.items.data
    .map((item) => Number(item.current_period_end || 0))
    .filter((value) => value > 0)
  if (!timestamps.length) return null
  return new Date(Math.max(...timestamps) * 1000).toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: 'Not authenticated' }, 401)

    const supabaseUrl = getRequiredSecret('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY')
    if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY')

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Invalid login session' }, 401)
    const user = userData.user

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('is_admin, subscription_status, stripe_customer_id')
      .eq('id', user.id)
      .single()
    if (profileError) throw profileError
    if (profile.is_admin) return json({ error: 'Owner accounts do not require payment.' }, 409)
    if (['active', 'trialing'].includes(profile.subscription_status)) {
      return json({ error: 'This account already has an active subscription. Refresh access or manage billing.' }, 409)
    }

    const stripe = new Stripe(getRequiredSecret('STRIPE_SECRET_KEY'))
    let customerId = profile.stripe_customer_id as string | null

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email || undefined,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
      const { error } = await admin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id)
      if (error) throw error
    }

    const appUrl = getRequiredSecret('APP_URL').replace(/\/+$/, '')
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: getRequiredSecret('STRIPE_PRICE_ID'), quantity: 1 }],
      success_url: `${appUrl}?checkout=success`,
      cancel_url: `${appUrl}?checkout=cancelled`,
      allow_promotion_codes: true,
      metadata: { supabase_user_id: user.id },
      subscription_data: { metadata: { supabase_user_id: user.id } },
    })

    if (!session.url) throw new Error('Stripe did not return a Checkout URL.')
    return json({ url: session.url })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Could not start checkout' }, 500)
  }
})
