/**
 * Audit: Verify ALL TKD Alex SDK learnings are implemented.
 * Run: node test/audit-tkd-learnings.mjs
 */

import * as sdk from '../index.js';
import * as ai from '../ai-path/index.js';
import { existsSync, readFileSync, readdirSync } from 'fs';

const results = [];
const check = (cat, name, ok) => { results.push({ cat, name, ok }); };

// 1. RPC QUERIES
check('RPC', 'createRpcQueryClient', typeof sdk.createRpcQueryClient === 'function');
check('RPC', 'rpcQueryNodes', typeof sdk.rpcQueryNodes === 'function');
check('RPC', 'rpcQueryNode', typeof sdk.rpcQueryNode === 'function');
check('RPC', 'rpcQueryBalance', typeof sdk.rpcQueryBalance === 'function');
check('RPC', 'rpcQueryNodesForPlan', typeof sdk.rpcQueryNodesForPlan === 'function');
check('RPC', 'rpcQueryPlan', typeof sdk.rpcQueryPlan === 'function');
check('RPC', 'disconnectRpc', typeof sdk.disconnectRpc === 'function');
check('RPC', 'chain/rpc.js exists', existsSync('chain/rpc.js'));

// 2. ENCODEOBJECT FIX
const msg = sdk.buildMsgStartSession({ from: 'sent1x', node_address: 'sentnode1x', gigabytes: 1 });
check('EncodeObject', 'typeUrl correct', msg.typeUrl === '/sentinel.node.v3.MsgStartSessionRequest');
check('EncodeObject', 'value is object not Uint8Array', typeof msg.value === 'object' && !(msg.value instanceof Uint8Array));
const msg2 = sdk.buildMsg_StartSession({ from: 'sent1x', nodeAddress: 'sentnode1x', gigabytes: 1 });
check('EncodeObject', 'new buildMsg_ works', msg2.typeUrl === '/sentinel.node.v3.MsgStartSessionRequest');
check('EncodeObject', 'buildMsg_EndSession', typeof sdk.buildMsg_EndSession === 'function');
check('EncodeObject', 'buildMsg_StartLease', typeof sdk.buildMsg_StartLease === 'function');
check('EncodeObject', 'buildMsg_RegisterProvider', typeof sdk.buildMsg_RegisterProvider === 'function');
check('EncodeObject', 'protocol/messages.js exists', existsSync('protocol/messages.js'));

// 3. TYPED EVENT PARSERS
check('Events', 'searchEvent', typeof sdk.searchEvent === 'function');
check('Events', 'extractSessionIdTyped', typeof sdk.extractSessionIdTyped === 'function');
check('Events', 'NodeEventCreateSession', sdk.NodeEventCreateSession?.type === 'sentinel.node.v3.EventCreateSession');
check('Events', 'NodeEventPay', sdk.NodeEventPay?.type === 'sentinel.node.v3.EventPay');
check('Events', 'SessionEventEnd', sdk.SessionEventEnd?.type === 'sentinel.session.v3.EventEnd');
check('Events', 'SubscriptionEventCreate', sdk.SubscriptionEventCreate?.type === 'sentinel.subscription.v3.EventCreate');
check('Events', 'LeaseEventCreate', sdk.LeaseEventCreate?.type === 'sentinel.lease.v1.EventCreate');
const ev = { type: 'sentinel.node.v3.EventCreateSession', attributes: [{ key: 'session_id', value: '999' }] };
check('Events', 'parse returns bigint', sdk.NodeEventCreateSession.parse(ev).sessionId === 999n);
check('Events', 'protocol/events.js exists', existsSync('protocol/events.js'));

// 4. TYPESCRIPT
check('TypeScript', 'src/client.ts', existsSync('src/client.ts'));
check('TypeScript', 'src/index.ts', existsSync('src/index.ts'));
check('TypeScript', 'dist/client.js (compiled)', existsSync('dist/client.js'));
check('TypeScript', 'dist/client.d.ts (declarations)', existsSync('dist/client.d.ts'));
check('TypeScript', 'tsconfig.build.json', existsSync('tsconfig.build.json'));

// 5. EXTEND COSMJS
check('CosmJS', 'BlueSentinelClient exported', typeof sdk.BlueSentinelClient === 'function');
check('CosmJS', 'SentinelQueryClient exported', typeof sdk.SentinelQueryClient === 'function');
check('CosmJS', 'connectWithSigner method', typeof sdk.BlueSentinelClient.connectWithSigner === 'function');

// 6. GENERATED PROTOBUF
check('Protobuf', 'generated/ exists', existsSync('generated'));
check('Protobuf', 'node msg.ts', existsSync('generated/sentinel/node/v3/msg.ts'));
check('Protobuf', 'session.ts', existsSync('generated/sentinel/session/v3/session.ts'));
check('Protobuf', 'plan.ts', existsSync('generated/sentinel/plan/v3/plan.ts'));
check('Protobuf', 'subscription msg.ts', existsSync('generated/sentinel/subscription/v3/msg.ts'));
check('Protobuf', 'lease.ts', existsSync('generated/sentinel/lease/v1/lease.ts'));
check('Protobuf', 'provider.ts', existsSync('generated/sentinel/provider/v2/provider.ts'));
check('Protobuf', 'price.ts', existsSync('generated/sentinel/types/v1/price.ts'));
check('Protobuf', 'proto/ source', existsSync('proto/sentinel/node/v3/msg.proto'));
const genFiles = readdirSync('generated', { recursive: true }).filter(f => f.endsWith('.ts'));
check('Protobuf', `${genFiles.length} generated .ts files (>=30)`, genFiles.length >= 30);

// 7. WEBSOCKET CLIENT
check('WebSocket', 'SentinelWsClient exported', typeof sdk.SentinelWsClient === 'function');

// 8. TYPE_URLS
check('TYPE_URLS', 'exported', typeof sdk.TYPE_URLS === 'object');
const urlCount = Object.keys(sdk.TYPE_URLS).length;
check('TYPE_URLS', `${urlCount} URLs (>=20)`, urlCount >= 20);
check('TYPE_URLS', 'START_SESSION correct', sdk.TYPE_URLS.START_SESSION === '/sentinel.node.v3.MsgStartSessionRequest');

// 9. NPM READY
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
check('npm', 'version 1.5.1', pkg.version === '1.5.1');
check('npm', 'files array', Array.isArray(pkg.files));
check('npm', 'exports map', typeof pkg.exports === 'object');
check('npm', './blue export', !!pkg.exports['./blue']);
check('npm', 'build script', !!pkg.scripts.build);
check('npm', 'proto:generate script', !!pkg.scripts['proto:generate']);

// 10. AI-PATH UPDATED
check('ai-path', '29 exports', Object.keys(ai).length === 29);
check('ai-path', 'rpcQueryNodes', typeof ai.rpcQueryNodes === 'function');
check('ai-path', 'extractSessionIdTyped', typeof ai.extractSessionIdTyped === 'function');
check('ai-path', 'TYPE_URLS', typeof ai.TYPE_URLS === 'object');

// 11. MNEMONIC FIX
check('Mnemonic', 'rejects non-BIP39', sdk.isMnemonicValid('a b c d e f g h i j k l') === false);
check('Mnemonic', 'rejects bad checksum', sdk.isMnemonicValid('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon') === false);
check('Mnemonic', 'accepts valid', sdk.isMnemonicValid('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about') === true);

// REPORT
const cats = [...new Set(results.map(r => r.cat))];
let totalPass = 0, totalFail = 0;
console.log('');
console.log('TKD ALEX LEARNINGS — VERIFICATION AUDIT');
console.log('========================================');
for (const cat of cats) {
  const items = results.filter(r => r.cat === cat);
  const pass = items.filter(r => r.ok).length;
  const fail = items.filter(r => !r.ok).length;
  totalPass += pass;
  totalFail += fail;
  console.log(`${fail === 0 ? 'PASS' : 'FAIL'} ${cat}: ${pass}/${items.length}`);
  items.filter(r => !r.ok).forEach(r => console.log(`     x ${r.name}`));
}
console.log('');
console.log(`TOTAL: ${totalPass}/${totalPass + totalFail}`);
if (totalFail === 0) console.log('ALL CHECKS PASSED');
else console.log(`${totalFail} FAILURES`);
