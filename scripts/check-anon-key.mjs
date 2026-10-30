// Fails the build unless EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY starts with sb_publishable_.
import { clientKeyMessage } from './anonKey.mjs';

const message = clientKeyMessage(process.env);
if (message) {
  console.error(message);
  process.exit(1);
}
