import { spawn } from 'node:child_process';

export function resolveFfmpegPath(): string {
  const override = process.env.FFMPEG_PATH;
  return override && override.trim().length > 0 ? override : 'ffmpeg';
}

export function resolveFfprobePath(): string {
  const override = process.env.FFPROBE_PATH;
  return override && override.trim().length > 0 ? override : 'ffprobe';
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export function runProcess(bin: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      reject(new Error(`failed to start "${bin}": ${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `"${bin} ${args.join(' ')}" exited with code ${code}\n${stderr.trim().slice(-4000)}`,
          ),
        );
      }
    });
  });
}

/** Runs ffmpeg with the flags every invocation in this package needs: no banner, errors only, overwrite. */
export async function runFfmpeg(args: string[]): Promise<void> {
  await runProcess(resolveFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

export async function listEncoders(): Promise<string> {
  const { stdout } = await runProcess(resolveFfmpegPath(), ['-hide_banner', '-encoders']);
  return stdout;
}
