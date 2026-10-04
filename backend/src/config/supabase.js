'use strict';
/**
 * Server-side Supabase client (Storage only). Uses the secret/service key, which must
 * never be sent to the browser — the backend is the only party that touches storage.
 */
const { createClient } = require('@supabase/supabase-js');
const { env, requireEnv } = require('./env');

let client;

/** Accepts either the project URL or a copied API URL such as https://<ref>.supabase.co/rest/v1/ */
function projectOrigin(url) {
  return new URL(String(url).trim()).origin;
}

function getSupabase() {
  if (!client) {
    requireEnv(['storage']);
    client = createClient(projectOrigin(env.supabaseUrl), env.supabaseServiceRoleKey.trim(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

module.exports = { getSupabase, projectOrigin };
