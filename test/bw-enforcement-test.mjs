/**
 * BANDWIDTH ENFORCEMENT TEST
 * Pay for 1 GB session, try to consume >1 GB through SOCKS proxy.
 * Documents exactly where (if anywhere) enforcement kicks in.
 *
 * Run: node test/bw-enforcement-test.mjs
 */

import { config } from 'dotenv';
config({ path: 'C:/Users/Connect/Desktop/AI PATH TEST/.env' });

import * as sdk from '../index.js';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios from 'axios';

const mnemonic = process.env.MNEMONIC;
sdk.registerCleanupHandlers();

console.log('╔═══════════════════════════════════════════════════╗');
console.log('║   BANDWIDTH ENFORCEMENT TEST — 1 GB SESSION       ║');
console.log('║   Goal: Pay for 1 GB, try to use >1 GB            ║');
console.log('╚═══════════════════════════════════════════════════╝\n');

// Connect V2Ray (SOCKS proxy — won't kill our main connection)
console.log('[1] Connecting V2Ray node...');
const result = await sdk.connectDirect({
  mnemonic,
  nodeAddress: 'sentnode1pny88u4npmwupthq7cwfltcaz0r59jr2auen30',
  gigabytes: 1,
  log: (msg) => console.log('  ' + msg),
});

const sessionId = result.sessionId;
const socksPort = result.socksPort;
console.log('\n[2] Session:', String(sessionId), '| SOCKS:', socksPort);
console.log('    Paid for: 1 GB | Now consuming bandwidth...\n');

// SOCKS proxy agent for routing downloads through V2Ray tunnel
const agent = new SocksProxyAgent(`socks5h://127.0.0.1:${socksPort}`);

let totalBytes = 0;
let iteration = 0;
const startTime = Date.now();

// 10 MB test files from speed test servers
const targets = [
  'http://speedtest.tele2.net/10MB.zip',
  'http://proof.ovh.net/files/10Mb.dat',
  'http://ipv4.download.thinkbroadband.com/10MB.zip',
];

async function downloadChunk(url) {
  try {
    const resp = await axios.get(url, {
      httpAgent: agent,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 3,
    });
    return resp.data.byteLength;
  } catch {
    return -1;
  }
}

console.log('[3] Downloading 10 MB chunks through SOCKS proxy...\n');
console.log('    Iter | Downloaded | Elapsed | Status');
console.log('    ─────┼────────────┼─────────┼───────');

let consecutiveFails = 0;
const ONE_GB = 1024 * 1024 * 1024;

while (totalBytes < 1.5 * ONE_GB && consecutiveFails < 5) {
  iteration++;
  const target = targets[iteration % targets.length];
  const bytes = await downloadChunk(target);

  if (bytes > 0) {
    totalBytes += bytes;
    consecutiveFails = 0;
  } else {
    consecutiveFails++;
  }

  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  const gb = (totalBytes / ONE_GB).toFixed(3);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const status = bytes > 0 ? `OK (+${(bytes / (1024*1024)).toFixed(1)} MB)` : 'FAIL';
  const marker = totalBytes > ONE_GB ? ' *** OVER 1 GB ***' : '';

  console.log(`    ${String(iteration).padStart(4)} | ${mb.padStart(8)} MB | ${elapsed.padStart(5)}s  | ${status}${marker}`);
}

const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
const totalGB = (totalBytes / ONE_GB).toFixed(3);
const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
const overageGB = Math.max(0, totalBytes / ONE_GB - 1).toFixed(3);

console.log('\n╔═══════════════════════════════════════════════════════════╗');
console.log(`║  PAID FOR:     1.000 GB`);
console.log(`║  DOWNLOADED:   ${totalGB} GB (${totalMB} MB)`);
console.log(`║  OVERAGE:      ${overageGB} GB over the 1 GB limit`);
console.log(`║  TIME:         ${elapsed}s`);
console.log(`║  ITERATIONS:   ${iteration} (10 MB chunks)`);
console.log(`║  CONSEC FAILS: ${consecutiveFails}`);
if (consecutiveFails >= 5) {
  console.log(`║  CUTOFF:       YES — connection died after ${totalMB} MB`);
  if (totalBytes > ONE_GB) {
    console.log(`║  VERDICT:      Cutoff happened but AFTER exceeding 1 GB by ${overageGB} GB`);
  } else {
    console.log(`║  VERDICT:      Cutoff happened BEFORE 1 GB (${totalMB} MB)`);
  }
} else if (totalBytes >= 1.5 * ONE_GB) {
  console.log('║  CUTOFF:       NONE — consumed 1.5 GB with no enforcement');
  console.log('║  VERDICT:      System is completely ungated past payment');
} else {
  console.log(`║  CUTOFF:       Test ended at ${totalGB} GB`);
}
console.log('╚═══════════════════════════════════════════════════════════╝');

// Disconnect
console.log('\n[4] Disconnecting...');
await sdk.disconnect();
console.log('    Done.');
