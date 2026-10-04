'use strict';
/**
 * Creates (or corrects) the PRIVATE Supabase Storage bucket for encrypted medical files.
 *   npm run storage:setup
 * Objects are AES-256-GCM ciphertext, so the only allowed content type is application/octet-stream.
 */
const { env } = require('../src/config/env');
const { getSupabase } = require('../src/config/supabase');

const OPTIONS = { public: false, fileSizeLimit: 11 * 1024 * 1024, allowedMimeTypes: ['application/octet-stream'] };

async function ensureBucket(name = env.supabaseBucket) {
  const sb = getSupabase();
  const { data: existing, error: getErr } = await sb.storage.getBucket(name);
  if (getErr && !/not.?found/i.test(getErr.message)) throw getErr;
  if (!existing) {
    const { error } = await sb.storage.createBucket(name, OPTIONS);
    if (error) throw error;
    return `created private bucket "${name}"`;
  }
  const { error } = await sb.storage.updateBucket(name, OPTIONS);
  if (error) throw error;
  return `bucket "${name}" exists — enforced private, 11 MB limit, octet-stream only`;
}

if (require.main === module) {
  ensureBucket().then((m) => console.log(m)).catch((e) => { console.error('Storage setup failed:', e.message); process.exit(1); });
}

module.exports = { ensureBucket, OPTIONS };
