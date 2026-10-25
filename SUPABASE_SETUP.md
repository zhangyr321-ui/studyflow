# StudyFlow Supabase setup

This branch adds email/password authentication and per-user cloud sync.

## 1. Configure the browser key

Open Supabase Dashboard for project `cgetjgabqlbtqmnmujam`, then go to **Project Settings → API Keys**. Copy the **Publishable key** (preferred) or the legacy **anon** key. Do not use a `service_role` key or any secret key.

Edit `supabase-config.js` on this branch and replace `PASTE_YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE` with that public key. This key is designed to be exposed in browser code; database access must remain protected by RLS.

## 2. Authentication redirect URLs

In Supabase, open **Authentication → URL Configuration**. Add the URL where you will test StudyFlow to the allowed Redirect URLs. For the current local preview, this may be `http://127.0.0.1:4174/**`. Add your real deployed site URL later as well.

## 3. Database

Run `supabase/schema.sql` once in the Supabase SQL Editor. It creates `public.studyflow_user_data`, enables Row Level Security, and restricts rows to the authenticated owner.

## 4. First login and migration

- If the account has no cloud data and this browser has existing StudyFlow data, the app asks before migrating it.
- If both local and cloud data exist, you can merge them; unique records are retained and cloud values win when the same record ID conflicts.
- Data changes are saved locally first, then synchronized to the cloud.
- The app checks for cloud updates periodically. Avoid editing the same record on two devices at the same time; this MVP does not provide field-by-field conflict resolution.
- If email confirmation is enabled, confirm the registration email before logging in.

## Security notes

The frontend only uses the publishable/anon key. Never add the database password or `service_role` key to frontend files. Keep RLS enabled on the data table.
