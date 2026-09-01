import type { APIRequestContext } from "@playwright/test";

export const E2E_ACCOUNT_PASSWORD = "e2e-account-password";

export async function registerE2eAccount(
  request: APIRequestContext,
  webUrl: string,
  username: string,
): Promise<void> {
  const response = await request.post(`${webUrl}/api/auth/register`, {
    headers: {
      origin: webUrl,
      "content-type": "application/json",
    },
    data: { username, password: E2E_ACCOUNT_PASSWORD },
  });
  if (response.status() !== 201) {
    throw new Error(
      `E2E account registration failed with status ${response.status()}.`,
    );
  }
}

export async function loginE2eAccount(
  request: APIRequestContext,
  webUrl: string,
  username: string,
): Promise<void> {
  const response = await request.post(`${webUrl}/api/auth/login`, {
    headers: {
      origin: webUrl,
      "content-type": "application/json",
    },
    data: { username, password: E2E_ACCOUNT_PASSWORD },
  });
  if (response.status() !== 200) {
    throw new Error(
      `E2E account login failed with status ${response.status()}.`,
    );
  }
}
