/**
 * The Cloudflare Access service token as the request headers Access reads
 * (#782). Access swaps them for the signed `Cf-Access-Jwt-Assertion` that
 * `functions/_lib/access.js` checks. The pair lives in the `prod` environment,
 * so only a job in that environment has it; a run without it stops here,
 * naming what is missing, instead of meeting a bare 403 from production.
 */
export function accessServiceHeaders(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  const missing = [
    ...(id ? [] : ['CF_ACCESS_CLIENT_ID']),
    ...(secret ? [] : ['CF_ACCESS_CLIENT_SECRET']),
  ];
  if (!id || !secret)
    throw new Error(
      `${missing.join(', ')} is not set: the Access service token lives in ` +
        'the `prod` environment, so run this in a job that names it (#782)',
    );
  return { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
}
