import { Agent, type RequestInit as UndiciRequestInit, fetch as undiciFetch } from "undici";

let insecureAgent: Agent | undefined;

function useInsecureTls(): boolean {
  return process.env.TITAN_TLS_INSECURE_SKIP_VERIFY === "1";
}

/** Server-side fetch to Titan node APIs (supports self-signed HTTPS when configured). */
export async function titanNodeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (useInsecureTls() && url.startsWith("https://")) {
    insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
    const undiciInit = {
      ...init,
      dispatcher: insecureAgent,
    } as UndiciRequestInit;
    return undiciFetch(url, undiciInit) as unknown as Promise<Response>;
  }
  return fetch(url, init);
}