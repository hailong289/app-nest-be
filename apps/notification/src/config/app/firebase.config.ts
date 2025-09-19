import { registerAs } from '@nestjs/config';

export default registerAs('firebase', () => ({
  type: process.env.FIREBASE_TYPE || 'service_account',
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  clientId: process.env.FIREBASE_CLIENT_ID,
  authUri: process.env.FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
  tokenUri: process.env.FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
  authProviderX509CertUrl: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
  clientX509CertUrl: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universeDomain: process.env.FIREBASE_UNIVERSE_DOMAIN || 'googleapis.com',
}));