import PocketBase from 'pocketbase';

// Types based on our PocketBase schema
export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  role: 'owner' | 'trainer' | 'member';
  phone?: string;
  gym_id?: string;
  emergency_contact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  created: string;
  updated: string;
}

export interface Gym {
  id: string;
  name: string;
  owner_id: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  phone?: string;
  settings?: {
    operating_hours: {
      [key: string]: { open: string; close: string; closed?: boolean };
    };
    membership_tiers: {
      [key: string]: {
        name: string;
        price: number;
        features: string[];
      };
    };
  };
  theme?: {
    primary_color: string;
    secondary_color: string;
    accent_color: string;
    style: 'neobrutalism' | 'mixed';
  };
  created: string;
  updated: string;
}

export interface Membership {
  id: string;
  user_id: string;
  gym_id: string;
  tier: 'basic' | 'premium' | 'vip';
  status: 'active' | 'paused' | 'cancelled' | 'expired';
  start_date: string;
  end_date?: string;
  stripe_subscription_id?: string;
  monthly_price: number;
  created: string;
  updated: string;
}

export interface Class {
  id: string;
  name: string;
  gym_id: string;
  trainer_id: string;
  description?: string;
  datetime: string;
  duration: number;
  capacity: number;
  price?: number;
  created: string;
  updated: string;
}

export interface ClassBooking {
  id: string;
  class_id: string;
  user_id: string;
  status: 'booked' | 'attended' | 'no_show' | 'cancelled';
  payment_status?: 'pending' | 'paid' | 'refunded';
  created: string;
  updated: string;
}

export interface GymAccess {
  id: string;
  user_id: string;
  gym_id: string;
  timestamp: string;
  method: 'qr_code' | 'manual' | 'keyfob';
  created: string;
  updated: string;
}

export interface Streak {
  id: string;
  user_id: string;
  gym_id: string;
  current_streak: number;
  longest_streak: number;
  last_visit?: string;
  rewards_earned?: number;
  created: string;
  updated: string;
}

export interface Friend {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created: string;
  updated: string;
}

export interface LiabilityForm {
  id: string;
  user_id: string;
  gym_id: string;
  signed_date: string;
  signature_url: string;
  form_data: {
    full_name: string;
    date_of_birth: string;
    address: {
      street: string;
      city: string;
      state: string;
      zip: string;
    };
    emergency_contact: {
      name: string;
      phone: string;
      relationship: string;
    };
    medical_conditions?: string;
    medications?: string;
    agreed_to_terms: boolean;
  };
  created: string;
  updated: string;
}

// Helper function
export function getFileUrl(record: any, filename: string, pbInstance?: PocketBase): string {
  const pocketbase = pbInstance;
  if (!pocketbase) return '';
  return pocketbase.files.getUrl(record, filename);
}
