import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "media";

/** Deletes a stored picture by its public URL (the file itself, not a row). Never throws: a file
 *  that is already gone is exactly the state we want. Runs as the service role because the
 *  bucket is written by the agent server, not by the signed-in user. */
export async function removeMediaFile(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return;
  const path = decodeURIComponent(url.slice(i + marker.length).split("?")[0]!);
  const { error } = await createAdminClient().storage.from(BUCKET).remove([path]);
  if (error) console.error(`[media] could not remove ${path}: ${error.message}`);
}
