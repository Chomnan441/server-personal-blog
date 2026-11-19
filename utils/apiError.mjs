export function respondServerError(res, { logLabel, error, body }) {
  console.error(`${logLabel}:`, error?.message ?? error);
  return res.status(500).json(body);
}
