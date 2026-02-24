import { writable } from 'svelte/store';
import PocketBase from 'pocketbase';
import type { User } from '$lib/pocketbase';
import { goto } from '$app/navigation';

// Create client-side pocketbase instance (uses public env)
const pb = new PocketBase(import.meta.env.VITE_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090');

interface AuthState {
  user: User | null;
  loading: boolean;
}

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>({
    user: null,
    loading: true
  });

  return {
    subscribe,
    
    async init() {
      if (pb.authStore.isValid) {
        await this.refreshUser();
      }
      update(state => ({ ...state, loading: false }));
      
      // Listen for auth changes
      pb.authStore.onChange(() => {
        if (pb.authStore.isValid) {
          this.refreshUser();
        } else {
          update(state => ({ ...state, user: null }));
        }
      });
    },

    async refreshUser() {
      if (!pb.authStore.isValid) return null;
      
      try {
        const user = await pb.collection('users').getOne(pb.authStore.model?.id);
        
        // Use email-based role assignment
        if (user.email === 'owner@freeweight.demo') {
          user.role = 'owner';
        } else if (user.email === 'trainer@freeweight.demo') {
          user.role = 'trainer';
        } else {
          user.role = 'member';
        }
        
        // Try to get gym_id from gyms collection
        try {
          const gyms = await pb.collection('gyms').getFullList();
          if (gyms.length > 0) {
            user.gym_id = gyms[0].id;
          }
        } catch (gymError) {
          console.warn('Could not fetch gym info');
        }
        
        const fullUser = user as User;
        update(state => ({ ...state, user: fullUser }));
        return fullUser;
      } catch (error) {
        console.error('Error getting current user:', error);
        return null;
      }
    },

    async login(email: string, password: string): Promise<User> {
      const authData = await pb.collection('users').authWithPassword(email, password);
      const fullUser = await pb.collection('users').getOne(authData.record.id);
      
      // Use email-based role assignment
      if (email === 'owner@freeweight.demo') {
        fullUser.role = 'owner';
      } else if (email === 'trainer@freeweight.demo') {
        fullUser.role = 'trainer';
      } else {
        fullUser.role = 'member';
      }
      
      // Try to get gym_id
      try {
        const gyms = await pb.collection('gyms').getFullList();
        if (gyms.length > 0) {
          fullUser.gym_id = gyms[0].id;
        }
      } catch (gymError) {
        console.warn('Could not fetch gym info');
      }
      
      const user = fullUser as User;
      update(state => ({ ...state, user }));
      return user;
    },

    async register(
      email: string,
      password: string,
      passwordConfirm: string,
      name: string,
      role: 'owner' | 'member'
    ): Promise<User> {
      const userData = {
        email,
        password,
        passwordConfirm,
        name,
        role,
      };

      const user = await pb.collection('users').create(userData);
      
      // Auto-login after registration
      await this.login(email, password);
      
      return user as User;
    },

    logout() {
      pb.authStore.clear();
      update(state => ({ ...state, user: null }));
    },

    redirectAfterLogin(user: User) {
      if (user.role === 'owner') {
        goto('/dashboard/owner');
      } else if (user.role === 'trainer') {
        goto('/dashboard/trainer');
      } else {
        goto('/dashboard/member');
      }
    }
  };
}

export const auth = createAuthStore();
