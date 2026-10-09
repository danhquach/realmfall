// `npm run sim`: the headless balance runner (RF-060). Loads the TypeScript
// simulation through Vite's module runner, so it runs on every Node the
// project supports without a build step, and prints one row per year.
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const started = performance.now();
const { module: sim } = await runnerImport('/src/core/sim.ts', {
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  logLevel: 'error',
});
const args = sim.parseArgs(process.argv.slice(2));
if ('error' in args) {
  console.error(args.error);
  process.exit(1);
}
console.log(sim.formatTable(sim.simulate(args.years, args.seed)));
const seconds = ((performance.now() - started) / 1000).toFixed(2);
console.log(`\n${args.years} years, seed ${args.seed}, in ${seconds} s total.`);
