export async function titanRpc(method: string, params: unknown[] = [], node?: string): Promise<unknown> {
  const body: Record<string, unknown> = { method, params, chain: "C" };
  if (node) body.node = node;

  const res = await fetch("/api/titan/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j?.error) {
    const msg = typeof j.error === "string" ? j.error : j.error?.message || JSON.stringify(j.error);
    throw new Error(msg);
  }
  return j?.result;
}