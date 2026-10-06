# Ward Issue Tracker (Pithapuram)

Static site (`public/`) + one Netlify Function (`netlify/functions/api.mjs`) + Netlify Blobs storage.

## Deploy
1. Push this folder to GitHub (or `npm i -g netlify-cli && netlify deploy --prod`).
2. Netlify → Add new site → import repo (build settings are read from `netlify.toml`).
3. Site settings → Environment variables:

| Name | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Admin login (required) |
| `TOKEN_SECRET` | Any long random string (optional) |
| `FAST2SMS_API_KEY` | Enables SMS (optional; without it tickets still work, SMS is skipped) |
| `FAST2SMS_ROUTE` | Default `q`. For DLT-registered templates change per Fast2SMS docs |

4. Redeploy. Entry form: `/`  ·  Admin: `/admin.html`

## Notes
- One submission = one citizen, each ticked issue gets its own status (Open / In Progress / Completed / Rejected).
- SMS goes out on ticket creation and on every status change.
- Indian SMS needs DLT-approved templates for reliable delivery; swap `sendSms()` for MSG91/Twilio if preferred.
