import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Part = {
  id: string;
  name: string;
  model: string;
  category: string;
  tags: string[];
  quantity: number;
  location: string;
  specifications: string;
  supplier: string;
  datasheetUrl: string;
  imagePath: string | null;
  imageUrl: string | null;
  updatedAt: string;
};

export type Draft = Pick<Part, "name" | "model" | "category" | "tags" | "quantity" | "location" | "specifications" | "supplier" | "datasheetUrl">;
export type Config = { url: string; key: string };

type PartRow = {
  id: string;
  name: string;
  model: string;
  category: string;
  tags: string[];
  quantity: number;
  location: string;
  specifications: string;
  supplier: string;
  datasheet_url: string;
  image_path: string | null;
  updated_at: string;
};

const bucket = "part-images";
const configKey = "partbase-supabase-config";

export function getConfig(): Config {
  const fromBuild = {
    url: import.meta.env.VITE_SUPABASE_URL || "",
    key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(configKey) || "{}") as Partial<Config>;
    if (saved.url && saved.key) return { url: saved.url, key: saved.key };
  } catch {
    // Fall back to repository variables embedded at build time.
  }
  return fromBuild;
}

export function saveConfig(config: Config) {
  const url = new URL(config.url.trim());
  if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co") || !config.key.trim().startsWith("sb_publishable_")) {
    throw new Error("Supabase URL と publishable key を確認してください。secret key は入力しないでください。");
  }
  localStorage.setItem(configKey, JSON.stringify({ url: url.origin, key: config.key.trim() }));
  return { url: url.origin, key: config.key.trim() };
}

export function clearConfig() {
  localStorage.removeItem(configKey);
}

export function makeClient(config: Config) {
  return createClient(config.url, config.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

function payload(draft: Draft) {
  const name = draft.name.trim();
  if (!name) throw new Error("部品名を入力してください。");
  if (!Number.isSafeInteger(draft.quantity) || draft.quantity < 0 || draft.quantity > 1_000_000_000) {
    throw new Error("数量は0以上の整数で入力してください。");
  }
  const datasheetUrl = draft.datasheetUrl.trim();
  if (datasheetUrl) {
    try {
      const url = new URL(datasheetUrl);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      throw new Error("データシートURLを確認してください。");
    }
  }
  return {
    name: name.slice(0, 160),
    model: draft.model.trim().slice(0, 160),
    category: draft.category.trim().slice(0, 80),
    tags: [...new Set(draft.tags.map(tag => tag.trim().slice(0, 40)).filter(Boolean))].slice(0, 12),
    quantity: draft.quantity,
    location: draft.location.trim().slice(0, 160),
    specifications: draft.specifications.trim().slice(0, 4000),
    supplier: draft.supplier.trim().slice(0, 160),
    datasheet_url: datasheetUrl.slice(0, 1000),
    updated_at: new Date().toISOString(),
  };
}

async function imageUrl(client: SupabaseClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 12 * 60 * 60);
  if (error) {
    console.error(error);
    return null;
  }
  return data.signedUrl;
}

async function toPart(client: SupabaseClient, row: PartRow): Promise<Part> {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    category: row.category,
    tags: row.tags,
    quantity: row.quantity,
    location: row.location,
    specifications: row.specifications,
    supplier: row.supplier,
    datasheetUrl: row.datasheet_url,
    imagePath: row.image_path,
    imageUrl: await imageUrl(client, row.image_path),
    updatedAt: row.updated_at,
  };
}

export async function listParts(client: SupabaseClient): Promise<Part[]> {
  const all: PartRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.from("parts").select("*").order("updated_at", { ascending: false }).range(offset, offset + 999);
    if (error) throw error;
    const rows = (data || []) as PartRow[];
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return Promise.all(all.map(row => toPart(client, row)));
}

export async function createPart(client: SupabaseClient, draft: Draft) {
  const { data, error } = await client.from("parts").insert(payload(draft)).select("*").single();
  if (error) throw error;
  return toPart(client, data as PartRow);
}

export async function updatePart(client: SupabaseClient, id: string, draft: Draft) {
  const { data, error } = await client.from("parts").update(payload(draft)).eq("id", id).select("*").single();
  if (error) throw error;
  return toPart(client, data as PartRow);
}

export async function adjustQuantity(client: SupabaseClient, id: string, delta: 1 | -1) {
  const { data, error } = await client.rpc("adjust_part_quantity", { p_id: id, p_delta: delta });
  if (error) throw error;
  const row = (data as PartRow[] | null)?.[0];
  if (!row) throw new Error("数量を変更できませんでした。最新の在庫を確認してください。");
  return toPart(client, row);
}

export async function uploadImage(client: SupabaseClient, userId: string, part: Part, file: File) {
  if (file.size === 0 || file.size > 5_000_000 || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
    throw new Error("画像はJPEG・PNG・WebP・GIF形式、5MB以下にしてください。");
  }
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[file.type];
  const path = `${userId}/${part.id}/${crypto.randomUUID()}.${extension}`;
  const storage = client.storage.from(bucket);
  const uploaded = await storage.upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) throw uploaded.error;
  const { data, error } = await client.from("parts").update({ image_path: path, updated_at: new Date().toISOString() }).eq("id", part.id).select("*").single();
  if (error) {
    await storage.remove([path]);
    throw error;
  }
  if (part.imagePath) await storage.remove([part.imagePath]);
  return toPart(client, data as PartRow);
}

export async function removeImage(client: SupabaseClient, part: Part) {
  if (!part.imagePath) return part;
  const { data, error } = await client.from("parts").update({ image_path: null, updated_at: new Date().toISOString() }).eq("id", part.id).select("*").single();
  if (error) throw error;
  await client.storage.from(bucket).remove([part.imagePath]);
  return toPart(client, data as PartRow);
}

export async function deletePart(client: SupabaseClient, part: Part) {
  const { error } = await client.from("parts").delete().eq("id", part.id);
  if (error) throw error;
  if (part.imagePath) await client.storage.from(bucket).remove([part.imagePath]);
}
