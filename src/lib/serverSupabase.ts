import { createClient } from "@supabase/supabase-js";

let serviceClient: ReturnType<typeof createClient> | null = null;

export const getServiceSupabaseClient = () => {
  if (serviceClient) return serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing Supabase configuration. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
    );
  }

  serviceClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
  });

  return serviceClient;
};


