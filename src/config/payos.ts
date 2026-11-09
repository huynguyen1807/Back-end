import { PayOS } from '@payos/node';

// Lazy configuration keeps existing RevenueCat/startup paths independent of payOS.
export function getPayOS() {
  const clientId = process.env.PAYOS_CLIENT_ID?.trim();
  const apiKey = process.env.PAYOS_API_KEY?.trim();
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY?.trim();
  if (!clientId || !apiKey || !checksumKey) throw new Error('payOS is not configured');
  return new PayOS({ clientId, apiKey, checksumKey, timeout: 15_000, maxRetries: 0, logLevel: 'off' });
}

export function getPayOSReturnUrls(orderCode: number) {
  function configuredUrl(name: string) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error('payOS checkout URLs are not configured');
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
      throw new Error('payOS checkout URLs must use HTTPS or local development HTTP');
    }
    url.searchParams.set('orderCode', String(orderCode));
    return url.toString();
  }
  return { returnUrl: configuredUrl('PAYOS_RETURN_URL'), cancelUrl: configuredUrl('PAYOS_CANCEL_URL') };
}
