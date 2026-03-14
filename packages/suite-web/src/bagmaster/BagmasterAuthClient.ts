import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";

type BagmasterTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  refresh_expires_in?: number;
};

type BagmasterStoredTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshExpiresAt?: number;
};

export type BagmasterAuthState = {
  initialized: boolean;
  authenticated: boolean;
  loading: boolean;
  tokens?: BagmasterStoredTokens;
};

const STORAGE_PREFIX = "bagmaster.visualizer.auth";
const TOKENS_KEY = `${STORAGE_PREFIX}.tokens`;
const PKCE_STATE_KEY = `${STORAGE_PREFIX}.pkce.state`;
const PKCE_VERIFIER_KEY = `${STORAGE_PREFIX}.pkce.verifier`;

function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64UrlEncode(digest);
}

function decodeJwtClaims(token: string): Record<string, unknown> {
  try {
    const [, payload = ""] = token.split(".");
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = atob(`${normalized}${padding}`);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getStoredTokens(): BagmasterStoredTokens | undefined {
  const raw = sessionStorage.getItem(TOKENS_KEY);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as BagmasterStoredTokens;
  } catch {
    sessionStorage.removeItem(TOKENS_KEY);
    return undefined;
  }
}

function setStoredTokens(tokens: BagmasterStoredTokens | undefined): void {
  if (!tokens) {
    sessionStorage.removeItem(TOKENS_KEY);
    return;
  }
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

function clearPkceState(): void {
  sessionStorage.removeItem(PKCE_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
}

function isTokenUsable(tokens: BagmasterStoredTokens | undefined): boolean {
  return Boolean(tokens && tokens.expiresAt - Date.now() > 30_000);
}

function isRefreshUsable(tokens: BagmasterStoredTokens | undefined): boolean {
  return Boolean(tokens?.refreshToken && (tokens.refreshExpiresAt ?? 0) - Date.now() > 30_000);
}

function getRedirectUri(): string {
  const current = new URL(window.location.href);
  current.searchParams.delete("code");
  current.searchParams.delete("state");
  current.searchParams.delete("session_state");
  current.searchParams.delete("iss");
  return current.toString();
}

function buildIssuer(): string {
  return `${APP_CONFIG.bagmasterKeycloakUrl}/realms/${APP_CONFIG.bagmasterKeycloakRealm}`;
}

function buildTokenEndpoint(): string {
  return `${buildIssuer()}/protocol/openid-connect/token`;
}

function buildAuthorizationEndpoint(): string {
  return `${buildIssuer()}/protocol/openid-connect/auth`;
}

function buildLogoutEndpoint(): string {
  return `${buildIssuer()}/protocol/openid-connect/logout`;
}

function parseTokenResponse(response: BagmasterTokenResponse): BagmasterStoredTokens {
  const now = Date.now();
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: now + response.expires_in * 1000,
    refreshExpiresAt: response.refresh_expires_in
      ? now + response.refresh_expires_in * 1000
      : undefined,
  };
}

export class BagmasterAuthClient {
  private state: BagmasterAuthState = {
    initialized: false,
    authenticated: false,
    loading: false,
    tokens: undefined,
  };
  private readonly listeners = new Set<() => void>();
  private initializePromise?: Promise<void>;
  private refreshPromise?: Promise<BagmasterStoredTokens | undefined>;

  public constructor() {
    const storedTokens = getStoredTokens();
    this.state = {
      initialized: false,
      authenticated: isTokenUsable(storedTokens),
      loading: false,
      tokens: storedTokens,
    };
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): BagmasterAuthState {
    return this.state;
  }

  public getClaims(): Record<string, unknown> {
    if (!this.state.tokens?.accessToken) {
      return {};
    }
    return decodeJwtClaims(this.state.tokens.accessToken);
  }

  public async initialize(interactive: boolean): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.bootstrap(interactive).finally(() => {
        this.initializePromise = undefined;
      });
    }
    await this.initializePromise;
  }

  public async ensureAuthenticated(interactive: boolean): Promise<string | undefined> {
    await this.initialize(interactive);

    if (isTokenUsable(this.state.tokens)) {
      return this.state.tokens?.accessToken;
    }

    const refreshed = await this.refreshTokens();
    if (refreshed) {
      return refreshed.accessToken;
    }

    this.updateState({
      initialized: true,
      authenticated: false,
      loading: false,
      tokens: undefined,
    });

    if (interactive) {
      await this.startSignIn();
    }

    return undefined;
  }

  public async fetchJson<T>(
    path: string,
    init: RequestInit = {},
    options: { interactive?: boolean; retryOnUnauthorized?: boolean } = {},
  ): Promise<T> {
    const { interactive = true, retryOnUnauthorized = true } = options;
    const token = await this.ensureAuthenticated(interactive);
    if (!token) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(`${APP_CONFIG.apiUrl}${path}`, {
      ...init,
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string>),
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 && retryOnUnauthorized) {
      const refreshed = await this.refreshTokens();
      if (refreshed) {
        return await this.fetchJson<T>(path, init, {
          interactive,
          retryOnUnauthorized: false,
        });
      }

      if (interactive) {
        await this.startSignIn();
      }
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new Error(detail || `Request failed with status ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  public async signOut(): Promise<void> {
    setStoredTokens(undefined);
    clearPkceState();
    this.updateState({
      initialized: true,
      authenticated: false,
      loading: false,
      tokens: undefined,
    });

    const logoutUrl = new URL(buildLogoutEndpoint());
    logoutUrl.searchParams.set("client_id", APP_CONFIG.bagmasterKeycloakClientId);
    logoutUrl.searchParams.set("post_logout_redirect_uri", getRedirectUri());
    window.location.assign(logoutUrl.toString());
  }

  public async startSignIn(): Promise<void> {
    const state = randomString();
    const verifier = randomString(64);
    const challenge = await createCodeChallenge(verifier);
    sessionStorage.setItem(PKCE_STATE_KEY, state);
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);

    const authorizationUrl = new URL(buildAuthorizationEndpoint());
    authorizationUrl.searchParams.set("client_id", APP_CONFIG.bagmasterKeycloakClientId);
    authorizationUrl.searchParams.set("redirect_uri", getRedirectUri());
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "openid profile email offline_access");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    window.location.assign(authorizationUrl.toString());
  }

  private async bootstrap(interactive: boolean): Promise<void> {
    this.updateState({
      initialized: false,
      authenticated: false,
      loading: true,
      tokens: this.state.tokens,
    });

    const handledCallback = await this.handleAuthCallback();
    const storedTokens = getStoredTokens();
    if (handledCallback || isTokenUsable(storedTokens)) {
      this.updateState({
        initialized: true,
        authenticated: isTokenUsable(storedTokens),
        loading: false,
        tokens: storedTokens,
      });
      return;
    }

    const refreshed = await this.refreshTokens();
    if (refreshed) {
      return;
    }

    this.updateState({
      initialized: true,
      authenticated: false,
      loading: false,
      tokens: undefined,
    });

    if (interactive) {
      await this.startSignIn();
    }
  }

  private updateState(nextState: BagmasterAuthState): void {
    this.state = nextState;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async handleAuthCallback(): Promise<boolean> {
    const currentUrl = new URL(window.location.href);
    const code = currentUrl.searchParams.get("code");
    const state = currentUrl.searchParams.get("state");
    if (!code || !state) {
      return false;
    }

    const expectedState = sessionStorage.getItem(PKCE_STATE_KEY);
    const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
    clearPkceState();

    currentUrl.searchParams.delete("code");
    currentUrl.searchParams.delete("state");
    currentUrl.searchParams.delete("session_state");
    currentUrl.searchParams.delete("iss");
    window.history.replaceState({}, document.title, currentUrl.toString());

    if (!expectedState || !verifier || expectedState !== state) {
      throw new Error("Authentication state mismatch");
    }

    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("client_id", APP_CONFIG.bagmasterKeycloakClientId);
    form.set("code", code);
    form.set("redirect_uri", getRedirectUri());
    form.set("code_verifier", verifier);

    const response = await fetch(buildTokenEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!response.ok) {
      throw new Error("Failed to exchange authorization code");
    }

    const tokens = parseTokenResponse((await response.json()) as BagmasterTokenResponse);
    setStoredTokens(tokens);
    this.updateState({
      initialized: true,
      authenticated: true,
      loading: false,
      tokens,
    });
    return true;
  }

  private async refreshTokens(): Promise<BagmasterStoredTokens | undefined> {
    if (!isRefreshUsable(this.state.tokens)) {
      return undefined;
    }

    if (!this.refreshPromise) {
      this.refreshPromise = this.performRefresh().finally(() => {
        this.refreshPromise = undefined;
      });
    }

    return await this.refreshPromise;
  }

  private async performRefresh(): Promise<BagmasterStoredTokens | undefined> {
    const refreshToken = this.state.tokens?.refreshToken;
    if (!refreshToken) {
      return undefined;
    }

    const form = new URLSearchParams();
    form.set("grant_type", "refresh_token");
    form.set("client_id", APP_CONFIG.bagmasterKeycloakClientId);
    form.set("refresh_token", refreshToken);

    const response = await fetch(buildTokenEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!response.ok) {
      setStoredTokens(undefined);
      this.updateState({
        initialized: true,
        authenticated: false,
        loading: false,
        tokens: undefined,
      });
      return undefined;
    }

    const tokens = parseTokenResponse((await response.json()) as BagmasterTokenResponse);
    setStoredTokens(tokens);
    this.updateState({
      initialized: true,
      authenticated: true,
      loading: false,
      tokens,
    });
    return tokens;
  }
}
