# Connecting the dashboard to Supabase

About 15 minutes in the Supabase website. You only do this once.

## 1. Create the project

1. Sign in to [supabase.com](https://supabase.com) with the account you want to use.
2. **New project**. Name it something like `usa-fuel`, pick the free plan and the **East US** region. Save the database password in your password manager; you won't need to share it with anyone.

## 2. Create the tables

1. Open **SQL Editor** → **New query**.
2. Paste everything from `supabase-setup.sql` and click **Run**. It should say "Success. No rows returned."

The script is safe to run again. Run it again whenever it changes (new dashboard features add tables to it).

## 3. Lock down sign-in

The dashboard asks only for an admin password. It never sends email. Behind the scenes it signs in as the login named in `ADMIN_LOGIN` in `config.js` (`sales@usafuelandmart.com`). The dashboard never emails it.

1. **Authentication → Sign In / Providers**: make sure **Email** is on, and turn **off** "Allow new users to sign up". Nobody can create an account on their own after this.
2. **Authentication → Users → Add user → Create new user**. Email: `sales@usafuelandmart.com`. Password: the admin password you want (at least 10 characters). Tick **Auto Confirm User**.

Forgot the password? Delete that user in **Authentication → Users**, create it again with a new password, then repeat step 4 below. Once you're signed in, you can change it any time under Settings → Change password.

## 4. Put yourself on the owner list

Back in **SQL Editor**, run:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'sales@usafuelandmart.com'
on conflict do nothing;
```

It should say "Success. 1 row affected." 0 rows means the email doesn't match the user from step 3.

## 5. Connect the dashboard

From **Project Settings → API Keys**, copy:

- the **Project URL** (`https://xxxx.supabase.co`)
- the **Publishable key** (starts with `sb_publishable_`). On older projects use the `anon` public key.

Put them in `config.js`, or send them to Claude. Both are safe to share.

**Never share the `secret` / `service_role` key or the database password.** The dashboard doesn't need them.

## Moving data in

If you entered real days in prototype mode, download a backup in prototype mode first (Settings → Download backup). After connecting, use Settings → Restore backup. Sample days are skipped automatically.
