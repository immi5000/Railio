import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const STORAGE_BUCKET = "railio-uploads";
export const STORAGE_URL_PREFIX = "/api/uploads";

let _client: SupabaseClient | null = null;

export function getStorage(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

// Upload a buffer to the bucket and return a stable backend-relative path
// (e.g. "/api/uploads/42/123-uuid.png") that the frontend resolves via apiUrl.
// The /api/uploads/[...key] route signs and 302-redirects on read.
export async function uploadToBucket(
  storageKey: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<string> {
  const { error } = await getStorage()
    .storage.from(STORAGE_BUCKET)
    .upload(storageKey, body, { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return `${STORAGE_URL_PREFIX}/${storageKey}`;
}

export async function signStorageKey(storageKey: string, expiresIn = 60 * 60): Promise<string> {
  const { data, error } = await getStorage()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(storageKey, expiresIn);
  if (error || !data) throw new Error(`storage sign failed: ${error?.message}`);
  return data.signedUrl;
}
