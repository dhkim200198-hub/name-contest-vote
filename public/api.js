export async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let body;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* 빈 응답 */
  }
  if (!res.ok) {
    const err = new Error(data.error || `요청 실패 (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const won = (n) => '₩' + Number(n || 0).toLocaleString('ko-KR');
