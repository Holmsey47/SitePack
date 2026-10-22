# Join codes — production smoke

Run this on a scratch company after the join-code migration and functions are deployed. Do not use a customer company. Public signups stay off. Leaked-password protection stays on.

Auth IP Address Forwarding must be on, and the functions must be deployed with an `sb_secret_` key (`SUPABASE_SECRET_KEYS` `default`), or this smoke does not prove the forwarding.

## Cross-IP sign-in (MF-3)

1. From one phone or network, sign in to a real username with the wrong password about 15 times.
2. From a second phone on a different network (mobile data if the first was office Wi-Fi, or the other way round), sign in to a different username with the correct password.
3. The second sign-in must succeed. The first account may be locked for its own username. The second network must not be blocked because of the first.

## Password reset

1. As the owner, issue a reset code for an operative who signs in with a username.
2. On that operative's phone, open the reset link, set a new password that has letters and digits, and submit.
3. Sign in with the username and the new password. That must succeed.
4. Sign out and try the old password. That must fail.
5. Submit the same reset code again. It must be refused.
