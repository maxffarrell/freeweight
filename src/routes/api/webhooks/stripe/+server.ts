import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stripe } from '$lib/stripe';
import { pb } from '$lib/server/pocketbase';
import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return json({ error: 'Missing signature' }, { status: 400 });
    }

    const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;

    try {
      event = stripe.instance.webhooks.constructEvent(body, signature, webhookSecret || '');
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Handle the event
    switch (event.type) {
      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return json({ received: true });

  } catch (error: any) {
    console.error('Webhook error:', error);
    return json({ error: 'Webhook handler failed' }, { status: 500 });
  }
};

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = (invoice as any).subscription;
  
  if (!subscriptionId) return;

  try {
    const memberships = await pb.collection('memberships').getList(1, 1, {
      filter: `stripe_subscription_id = "${subscriptionId}"`,
    });

    if (memberships.items.length > 0) {
      const membership = memberships.items[0];
      await pb.collection('memberships').update(membership.id, {
        status: 'active',
        updated: new Date().toISOString(),
      });

      console.log(`Payment succeeded for membership: ${membership.id}`);
    }
  } catch (error) {
    console.error('Error handling payment succeeded:', error);
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = (invoice as any).subscription;
  
  if (!subscriptionId) return;

  try {
    const memberships = await pb.collection('memberships').getList(1, 1, {
      filter: `stripe_subscription_id = "${subscriptionId}"`,
    });

    if (memberships.items.length > 0) {
      const membership = memberships.items[0];
      const attemptCount = invoice.attempt_count || 0;
      
      const newStatus = attemptCount >= 3 ? 'cancelled' : 'paused';
      
      await pb.collection('memberships').update(membership.id, {
        status: newStatus,
        updated: new Date().toISOString(),
      });

      console.log(`Payment failed for membership: ${membership.id}, status: ${newStatus}`);
    }
  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
  try {
    console.log(`Subscription created: ${subscription.id}`);
  } catch (error) {
    console.error('Error handling subscription created:', error);
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  try {
    const memberships = await pb.collection('memberships').getList(1, 1, {
      filter: `stripe_subscription_id = "${subscription.id}"`,
    });

    if (memberships.items.length > 0) {
      const membership = memberships.items[0];
      
      let status = 'active';
      if (subscription.status === 'canceled') status = 'cancelled';
      else if (subscription.status === 'past_due') status = 'paused';
      else if (subscription.status === 'unpaid') status = 'paused';

      await pb.collection('memberships').update(membership.id, {
        status,
        updated: new Date().toISOString(),
      });

      console.log(`Subscription updated: ${subscription.id}, status: ${status}`);
    }
  } catch (error) {
    console.error('Error handling subscription updated:', error);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  try {
    const memberships = await pb.collection('memberships').getList(1, 1, {
      filter: `stripe_subscription_id = "${subscription.id}"`,
    });

    if (memberships.items.length > 0) {
      const membership = memberships.items[0];
      await pb.collection('memberships').update(membership.id, {
        status: 'cancelled',
        end_date: new Date().toISOString().split('T')[0],
        updated: new Date().toISOString(),
      });

      console.log(`Subscription deleted: ${subscription.id}`);
    }
  } catch (error) {
    console.error('Error handling subscription deleted:', error);
  }
}
