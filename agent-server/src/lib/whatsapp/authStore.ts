/** Baileys auth state, stored in Supabase instead of on disk.
 *
 *  WHY NOT useMultiFileAuthState. Baileys' own helper writes the login to a folder of JSON
 *  files. This server runs on hosts whose disk is wiped on every deploy or restart (Railway
 *  rebuilds, a future Hugging Face Space, an Oracle container that gets recreated), so a
 *  file-based session would force the tenant to re-scan the QR every single deploy — which for a
 *  WhatsApp account is not a login prompt, it is losing the linked device. The creds and signal
 *  keys therefore live in the `whatsapp_auth` table (migration 028), one row per tenant, and
 *  survive anything that is not an explicit logout.
 *
 *  whatsapp_auth has RLS on and NO policies, so only the service-role client (this server) can
 *  read it. A tenant's WhatsApp login is a full account credential; it must never be reachable
 *  with a user's anon token, and the two-table split in 028 (status is member-visible,
 *  credentials are not) is what enforces that.
 *
 *  Shape follows Baileys' AuthenticationState: `creds` is one object, `keys` is a keyed store
 *  addressed by (type, id). BufferJSON is Baileys' own (de)serialiser for the Buffers inside
 *  both — using it rather than JSON.stringify is what keeps the signal keys byte-exact across a
 *  round trip through jsonb. */
import { proto, initAuthCreds, BufferJSON } from "@whiskeysockets/baileys";
import type { SupabaseClient } from "@supabase/supabase-js";

// Baileys' AuthenticationState is not exported as a type in a stable place across versions, so
// it is described structurally here — just enough for makeWASocket's `auth` field.
type SignalDataTypeMap = Record<string, any>;

export type StoredAuth = {
  state: {
    creds: any;
    keys: {
      get(type: string, ids: string[]): Promise<Record<string, any>>;
      set(data: Record<string, Record<string, any>>): Promise<void>;
    };
  };
  /** Persist the current creds + keys to Supabase. Called after Baileys' `creds.update` fires. */
  saveCreds(): Promise<void>;
};

/** Load a tenant's stored auth (or a fresh one if they have never paired), returning the object
 *  makeWASocket wants plus a saveCreds() to wire onto the `creds.update` event. */
export async function useSupabaseAuthState(supabase: SupabaseClient, tenantId: string): Promise<StoredAuth> {
  const { data, error } = await supabase
    .from("whatsapp_auth")
    .select("creds, keys")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error && !/no rows/i.test(error.message)) {
    throw new Error(`whatsapp_auth read failed: ${error.message}`);
  }

  // Deserialise with BufferJSON so every Buffer that went in as base64 comes back as a Buffer.
  const creds = data?.creds
    ? JSON.parse(JSON.stringify(data.creds), BufferJSON.reviver)
    : initAuthCreds();
  // The keys store is a flat map "type-id" -> value, kept in memory and flushed whole on write.
  // At a few tenants and a handful of contacts each this is small; a bigger deployment would key
  // a table by (tenant, type, id) instead, but that is a scaling change, not a correctness one.
  const keyMap: Record<string, any> = data?.keys
    ? JSON.parse(JSON.stringify(data.keys), BufferJSON.reviver)
    : {};

  const persist = async () => {
    const row = {
      tenant_id: tenantId,
      // Serialise through BufferJSON's replacer so Buffers become the {type:'Buffer',data:...}
      // form jsonb can hold and the reviver above can restore.
      creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      keys: JSON.parse(JSON.stringify(keyMap, BufferJSON.replacer)),
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase.from("whatsapp_auth").upsert(row, { onConflict: "tenant_id" });
    if (upErr) throw new Error(`whatsapp_auth write failed: ${upErr.message}`);
  };

  const state: StoredAuth["state"] = {
    creds,
    keys: {
      async get(type, ids) {
        const out: Record<string, any> = {};
        for (const id of ids) {
          let val = keyMap[`${type}-${id}`];
          // app-state-sync-key values are protobuf messages Baileys wants back as decoded
          // objects, not raw json — the one type that needs this special-casing.
          if (type === "app-state-sync-key" && val) {
            val = proto.Message.AppStateSyncKeyData.fromObject(val);
          }
          if (val !== undefined) out[id] = val;
        }
        return out;
      },
      async set(data) {
        for (const type of Object.keys(data)) {
          for (const id of Object.keys(data[type])) {
            const val = data[type][id];
            const key = `${type}-${id}`;
            if (val === null || val === undefined) delete keyMap[key];
            else keyMap[key] = val;
          }
        }
        await persist();
      },
    },
  };

  return { state, saveCreds: persist };
}

/** Wipe a tenant's stored login. Used when WhatsApp reports the device was logged out from the
 *  phone (DisconnectReason.loggedOut) — keeping a dead session would loop reconnecting forever. */
export async function clearAuthState(supabase: SupabaseClient, tenantId: string): Promise<void> {
  await supabase.from("whatsapp_auth").delete().eq("tenant_id", tenantId);
}
