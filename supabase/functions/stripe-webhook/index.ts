import Stripe from 'npm:stripe@^22'
import { createClient } from 'npm:@supabase/supabase-js@2'

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
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const stripe = new Stripe(getRequiredSecret('STRIPE_SECRET_KEY'))
  const cryptoProvider = Stripe.createSubtleCryptoProvider()
  const signature = req.headers.get('Stripe-Signature')
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature || '',
      getRequiredSecret('STRIPE_WEBHOOK_SIGNING_SECRET'),
      undefined,
      cryptoProvider,
    )
  } catch (error) {
    console.error('Invalid Stripe signature', error)
    return new Response('Invalid signature', { status: 400 })
  }

  try {
    const supabaseUrl = getRequiredSecret('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SECRET_KEY')
    if (!serviceKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY')
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const syncSubscription = async (subscription: Stripe.Subscription) => {
      const customerId = typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id
      const subscriptionId = subscription.id
      let userId = subscription.metadata?.supabase_user_id || ''

      if (!userId) {
        const { data } = await admin
          .from('profiles')
          .select('id')
          .or(`stripe_subscription_id.eq.${subscriptionId},stripe_customer_id.eq.${customerId}`)
          .maybeSingle()
        userId = data?.id || ''
      }
      if (!userId) throw new Error(`No Supabase user found for Stripe subscription ${subscriptionId}`)

      const { error } = await admin
        .from('profiles')
        .update({
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          subscription_status: subscription.status,
          subscription_current_period_end: getPeriodEnd(subscription),
        })
        .eq('id', userId)
      if (error) throw error
    }

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object as Stripe.Checkout.Session
        const subscriptionId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId)
          await syncSubscription(subscription)
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncSubscription(event.data.object as Stripe.Subscription)
        break
      }
      default:
        break
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Stripe webhook processing failed', error)
    return new Response('Webhook processing failed', { status: 500 })
  }
})
