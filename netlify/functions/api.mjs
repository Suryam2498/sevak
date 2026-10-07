import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/*" };

const STATUSES = ["open", "inprogress", "completed", "rejected"];
const CATEGORIES = [
  "Pension", "Old Age", "Handicapped", "Dialysis", "Widow", "Single Women", "Drainage", "Sanitation", "Street Lights", "Roads", "Tax", "Govt Subsidies & Schemes", "Others",
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const secret = () => process.env.TOKEN_SECRET || process.env.ADMIN_PASSWORD || "change-me";
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("hex");

function makeToken() {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
const isAdmin = (req) => validToken((req.headers.get("authorization") || "").replace("Bearer ", ""));

function safeEqual(a = "", b = "") {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function sendSms(phone, message) {
  const key = process.env.FAST2SMS_API_KEY;
  if (!key) return { ok: false, info: "SMS not configured" };
  try {
    const r = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: { authorization: key, "content-type": "application/json" },
      body: JSON.stringify({ route: process.env.FAST2SMS_ROUTE || "q", message, numbers: phone }),
    });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok && d.return !== false, info: d.message ? String(d.message) : r.statusText };
  } catch (e) {
    return { ok: false, info: String(e.message || e) };
  }
}

const clean = (s, n = 300) => String(s ?? "").trim().slice(0, n);

export default async (req) => {
  const open = (n) => (globalThis.__DEV_STORE ? globalThis.__DEV_STORE(n) : getStore({ name: n, consistency: "strong" }));
  const store = open("tickets");
  const route = new URL(req.url).pathname.replace(/^\/api\//, "");

  if (route === "login" && req.method === "POST") {
    const { password } = await req.json().catch(() => ({}));
    if (!process.env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD not set on server" }, 500);
    if (!safeEqual(String(password || ""), process.env.ADMIN_PASSWORD)) return json({ error: "Wrong password" }, 401);
    return json({ token: makeToken() });
  }

  if (route === "submit" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const phone = clean(b.phone, 15).replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    const name = clean(b.name, 100);
    const issues = (Array.isArray(b.issues) ? b.issues : []).filter((c) => CATEGORIES.includes(c));
    const other = clean(b.other, 500);
    if (!name) return json({ error: "Name is required" }, 400);
    if (!/^[6-9]\d{9}$/.test(phone)) return json({ error: "Enter a valid 10-digit mobile number" }, 400);
    if (!issues.length) return json({ error: "Select at least one issue" }, 400);
    if (issues.includes("Others") && !other) return json({ error: "Describe the 'Others' issue" }, 400);

    const photos = (Array.isArray(b.photos) ? b.photos : [])
      .filter((x) => typeof x === "string" && x.length < 1_500_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x))
      .slice(0, 5);
    const ward = clean(b.ward, 3).replace(/\D/g, "") || "29";
    const id = "PTP-W" + ward + "-" + Date.now().toString(36).toUpperCase().slice(-5) + crypto.randomBytes(1).toString("hex").toUpperCase();
    const now = new Date().toISOString();
    const rec = {
      id, city: "Pithapuram", ward, coordinator: clean(b.coordinator, 100), name, phone,
      address: clean(b.address, 300), other, createdAt: now, photoCount: photos.length,
      issues: issues.map((category) => ({ category, status: "open", note: "", updatedAt: now })),
      sms: [],
    };
    const sms = await sendSms(phone, `Pithapuram Municipality: Your complaint ${id} (${issues.join(", ")}) is registered. Status: OPEN.`);
    rec.sms.push({ at: now, ok: sms.ok, info: sms.info, kind: "created" });
    if (photos.length) await open("photos").setJSON(id, { photos });
    await store.setJSON(id, rec);
    return json({ id, sms: sms.ok });
  }

  if (!isAdmin(req)) return json({ error: "Unauthorized" }, 401);

  if (route === "tickets" && req.method === "GET") {
    const { blobs } = await store.list();
    const all = (await Promise.all(blobs.map((x) => store.get(x.key, { type: "json" })))).filter(Boolean);
    all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json({ tickets: all, categories: CATEGORIES });
  }

  if (route === "photo" && req.method === "GET") {
    const p = await open("photos").get(new URL(req.url).searchParams.get("id") || "", { type: "json" });
    return p ? json({ photos: p.photos || (p.data ? [p.data] : []) }) : json({ error: "No photo" }, 404);
  }

  if (route === "reset" && req.method === "POST") {
    const { confirm } = await req.json().catch(() => ({}));
    if (confirm !== "DELETE") return json({ error: "Type DELETE to confirm" }, 400);
    let n = 0;
    for (const name of ["tickets", "photos"]) {
      const st = open(name);
      const { blobs } = await st.list();
      await Promise.all(blobs.map((x) => st.delete(x.key)));
      if (name === "tickets") n = blobs.length;
    }
    return json({ deleted: n });
  }

  if (route === "status" && req.method === "POST") {
    const { id, index, status, note } = await req.json().catch(() => ({}));
    if (!STATUSES.includes(status)) return json({ error: "Bad status" }, 400);
    const rec = await store.get(String(id), { type: "json" });
    const it = rec?.issues?.[index];
    if (!it) return json({ error: "Not found" }, 404);
    const changed = it.status !== status;
    it.status = status;
    it.note = clean(note, 300);
    it.updatedAt = new Date().toISOString();
    if (changed) {
      const label = { open: "OPEN", inprogress: "IN PROGRESS", completed: "COMPLETED", rejected: "REJECTED" }[status];
      const sms = await sendSms(rec.phone, `Pithapuram Municipality: Complaint ${rec.id} (${it.category}) status is now ${label}.${it.note ? " Note: " + it.note : ""}`);
      rec.sms.push({ at: it.updatedAt, ok: sms.ok, info: sms.info, kind: status });
    }
    await store.setJSON(rec.id, rec);
    return json({ ticket: rec });
  }

  return json({ error: "Not found" }, 404);
};
