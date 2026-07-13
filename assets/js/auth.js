/* 
  Owl Assist - Authentication Handlers
  Handles Sign-up, Sign-in, and OAuth (Google, Apple, LinkedIn, Zoom)
*/

import { supabase } from './supabase.js';

export const authActions = {
  /**
   * SIGN UP with Email & Password
   * Also stores business metadata (name, country)
   */
  async signUp(email, password, businessName, country) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          business_name: businessName,
          country: country
        }
      }
    });

    if (error) throw error;
    return data;
  },

  /**
   * SIGN IN with Email & Password
   */
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
       email,
       password,
    });

    if (error) throw error;
    return data;
  },

  /**
   * OAuth SIGN IN (Third-party providers)
   */
  async signInWithProvider(provider) {
    // provider: 'google' | 'apple' | 'linkedin' | 'zoom'
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider,
      options: {
        redirectTo: window.location.origin + '/dashboard'
      }
    });

    if (error) throw error;
    return data;
  },

  /**
   * SIGN OUT
   */
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.href = '/';
  },

  /**
   * SESSION CHECKER
   * If no session, redirects to login (for use in dashboard)
   */
  async checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      window.location.href = '../auth/login';
      return null;
    }
    return session;
  }
};


