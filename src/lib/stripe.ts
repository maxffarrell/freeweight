import Stripe from 'stripe';
import { env } from '$env/dynamic/private';

// Server-side Stripe instance (lazy initialization)
function getStripe() {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set');
  }
  return new Stripe(key, {
    apiVersion: '2024-06-20',
  });
}

// Client-side Stripe promise
import { loadStripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripePromise() {
  if (typeof window === 'undefined') return null;
  
  if (!stripePromise) {
    const publishableKey = import.meta.env.VITE_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (publishableKey) {
      stripePromise = loadStripe(publishableKey);
    }
  }
  return stripePromise;
}

// Membership tier pricing
export const MEMBERSHIP_TIERS = {
  basic: {
    name: 'Basic',
    price: 2999,
    features: ['Gym Access', 'Locker Room', 'Basic Equipment'],
    stripePriceId: 'price_basic_monthly',
  },
  premium: {
    name: 'Premium', 
    price: 4999,
    features: ['All Basic Features', 'Group Classes', 'Cardio Equipment', 'Free WiFi'],
    stripePriceId: 'price_premium_monthly',
  },
  vip: {
    name: 'VIP',
    price: 7999,  
    features: ['All Premium Features', '24/7 Access', 'Personal Training Session', 'Guest Passes', 'Nutrition Consultation'],
    stripePriceId: 'price_vip_monthly',
  },
} as const;

export type MembershipTier = keyof typeof MEMBERSHIP_TIERS;

// Create a subscription for a member
export async function createSubscription(
  customerId: string,
  priceId: string,
  gymId: string,
  userId: string
) {
  try {
    const subscription = await getStripe().subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: {
        gym_id: gymId,
        user_id: userId,
      },
    });

    return subscription;
  } catch (error) {
    console.error('Error creating subscription:', error);
    throw error;
  }
}

// Create a customer in Stripe
export async function createCustomer(
  email: string,
  name: string,
  metadata: Record<string, string> = {}
) {
  try {
    const customer = await getStripe().customers.create({
      email,
      name,
      metadata,
    });

    return customer;
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
}

// Create a setup intent for saving payment method
export async function createSetupIntent(customerId: string) {
  try {
    const setupIntent = await getStripe().setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });

    return setupIntent;
  } catch (error) {
    console.error('Error creating setup intent:', error);
    throw error;
  }
}

// Update subscription
export async function updateSubscription(
  subscriptionId: string,
  priceId: string
) {
  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    
    const updatedSubscription = await getStripe().subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: priceId,
      }],
      proration_behavior: 'create_prorations',
    });

    return updatedSubscription;
  } catch (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }
}

// Cancel subscription
export async function cancelSubscription(subscriptionId: string, immediately = false) {
  try {
    if (immediately) {
      const subscription = await getStripe().subscriptions.cancel(subscriptionId);
      return subscription;
    } else {
      const subscription = await getStripe().subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      return subscription;
    }
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw error;
  }
}

// Get subscription details
export async function getSubscription(subscriptionId: string) {
  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice', 'customer', 'items.data.price'],
    });
    return subscription;
  } catch (error) {
    console.error('Error retrieving subscription:', error);
    throw error;
  }
}

// Create portal session for customer self-service
export async function createPortalSession(customerId: string, returnUrl: string) {
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session;
  } catch (error) {
    console.error('Error creating portal session:', error);
    throw error;
  }
}

// Export stripe for webhook handling
export const stripe = {
  get instance() {
    return getStripe();
  }
};
