// Supabase project for the dashboard. Both values are meant to be public: the
// publishable key can only do what the database's security rules allow. Those rules
// let anyone read the website content (banner, deals, holiday hours) and nothing else;
// everything else needs the owner's login.
// Never put the secret (service_role) key here.
//
// Leave both empty to use the prototype mode that saves in this browser only.
export const SUPABASE_URL = 'https://uwfqairueldnsiyaouwx.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_NUed_VecV7RQP_9CjkSGYw_u_vLYJXU';

// The one admin login. The sign-in screen only asks for its password. This address never
// receives email, since the dashboard doesn't send any.
export const ADMIN_LOGIN = 'sales@usafuelandmart.com';
