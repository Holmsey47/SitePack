// Fails the build when a client Supabase key is not publishable and not role=anon.
import { clientKeyMessage } from './anonKey.mjs';

const message = clientKeyMessage(process.env);
if (message) {
  console.error(message);
  process.exit(1);
}
