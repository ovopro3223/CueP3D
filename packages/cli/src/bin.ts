#!/usr/bin/env node
import { parseBuildArgs, BuildArgsError, BUILD_HELP } from './parse-build-args.js';
import { runBuild, NotImplementedError } from './build-command.js';

function printTopLevelHelp(): void {
  process.stdout.write(
    'Usage: understudy <command>\n\nCommands:\n  build   Build an understudy bundle from a .glb/.gltf model\n\n',
  );
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === '-h' || command === '--help') {
    printTopLevelHelp();
    return;
  }

  if (command !== 'build') {
    process.stderr.write(`Unknown command: ${command}\n\n`);
    printTopLevelHelp();
    process.exitCode = 1;
    return;
  }

  try {
    const parsed = parseBuildArgs(rest);
    if ('help' in parsed) {
      process.stdout.write(BUILD_HELP);
      return;
    }
    await runBuild(parsed);
  } catch (error) {
    if (error instanceof BuildArgsError) {
      process.stderr.write(`${error.message}\n\n${BUILD_HELP}`);
      process.exitCode = 1;
      return;
    }
    if (error instanceof NotImplementedError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main();
