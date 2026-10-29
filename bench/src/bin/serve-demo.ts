import { startDemoServer } from '../server.js';

const port = Number(process.env.BENCH_DEMO_PORT ?? 4591);
await startDemoServer(port);
console.log(`bench: demo server listening on port ${String(port)}`);
