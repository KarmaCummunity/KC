import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Prefer the review device family without treating another iPad as identical hardware. */
export function chooseIPad(payload) {
  const devices = Object.entries(payload.devices ?? {}).filter(([runtime]) => runtime.includes('iOS'))
    .sort(([a], [b]) => b.localeCompare(a)).flatMap(([, rows]) => rows)
    .filter((device) => device.isAvailable !== false && device.name?.startsWith('iPad'));
  const selected = devices.find((device) => /Air.*11.*M3/i.test(device.name)) ?? devices[0];
  if (!selected?.udid) throw new Error('No available iPad simulator. No iPhone fallback accepted.');
  return { udid: selected.udid, name: selected.name, exactReviewModel: /Air.*11.*M3/i.test(selected.name) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(chooseIPad(JSON.parse(readFileSync(process.argv[2], 'utf8')))));
}
