import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenantId } from "@/lib/supabase/tenant";

/** The signed-in user's Supabase client and tenant, resolved ONCE per server render. The shell
 *  layout and the page inside it both need them; React's cache() makes the second caller reuse
 *  the first one's answer instead of paying another login check and tenant lookup. */
export const getRequestContext = cache(async () => {
  const supabase = await createClient();
  const tenantId = await getCurrentTenantId(supabase);
  return { supabase, tenantId };
});
