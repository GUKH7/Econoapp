import * as SecureStore from 'expo-secure-store';
import type { AuthTokensResponse } from '../api/types';

const SESSION_KEY = 'din.secure-session.v1';

export async function loadStoredSession(): Promise<AuthTokensResponse | null> {
  const value = await SecureStore.getItemAsync(SESSION_KEY);
  if (!value) return null;
  try {
    const tokens = JSON.parse(value) as AuthTokensResponse;
    return tokens.accessToken && tokens.refreshToken ? tokens : null;
  } catch {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    return null;
  }
}

export async function saveStoredSession(tokens: AuthTokensResponse): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(tokens));
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
