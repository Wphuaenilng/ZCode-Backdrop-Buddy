export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    mode: 'manager',
    dataDir: null,
    appRoot: null,
    logLevel: null,
    ffmpeg: null,
    ffprobe: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];

    if (arg === '--mode') options.mode = next() || options.mode;
    else if (arg === '--data-dir') options.dataDir = next();
    else if (arg === '--app-root') options.appRoot = next();
    else if (arg === '--log-level') options.logLevel = next();
    else if (arg === '--ffmpeg') options.ffmpeg = next();
    else if (arg === '--ffprobe') options.ffprobe = next();
  }

  return options;
}
