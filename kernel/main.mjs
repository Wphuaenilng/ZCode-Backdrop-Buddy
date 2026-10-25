import { parseArgs } from './app/args.mjs';
import { createKernel } from './app/kernel.mjs';
import { attachStdio } from './transport/stdio.mjs';
import { LineWriter } from './transport/line-writer.mjs';

const args = parseArgs();
const writer = new LineWriter({ stream: process.stdout });

let kernel;
try {
  kernel = await createKernel({
    mode: args.mode,
    dataDir: args.dataDir,
    appRoot: args.appRoot,
    logLevel: args.logLevel,
    ffmpeg: args.ffmpeg,
    ffprobe: args.ffprobe,
    deferSeeding: true,
    onClose: async () => {
      await writer.drain();
      process.exit(0);
    }
  });
} catch (error) {
  process.stderr.write(`[backdropbuddy-kernel] startup failed: ${error?.stack || error}\n`);
  process.exit(1);
}

attachStdio({ kernel, writer });
