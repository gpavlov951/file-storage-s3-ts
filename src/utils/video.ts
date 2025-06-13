export async function getVideoAspectRatio(filePath: string): Promise<string> {
  const process = Bun.spawn(
    [
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "json",
      filePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  const { exited } = process;
  const exitCode = await exited;

  if (exitCode !== 0) {
    throw new Error(`ffprobe failed with exit code ${exitCode}: ${stderr}`);
  }

  const data = JSON.parse(stdout);
  const stream = data.streams[0];

  if (!stream || !stream.width || !stream.height) {
    throw new Error("Could not get video dimensions");
  }

  const { width, height } = stream;

  // Calculate the actual aspect ratio
  const aspectRatio = width / height;

  // Define target ratios with some tolerance for rounding errors
  const landscapeRatio = 16 / 9; // ~1.778
  const portraitRatio = 9 / 16; // ~0.563
  const tolerance = 0.1;

  // Check if it's close to 16:9 (landscape)
  if (Math.abs(aspectRatio - landscapeRatio) < tolerance) {
    return "landscape";
  }
  // Check if it's close to 9:16 (portrait)
  else if (Math.abs(aspectRatio - portraitRatio) < tolerance) {
    return "portrait";
  }
  // If not close to standard ratios, determine by orientation
  else if (aspectRatio > 1) {
    // Width > Height = landscape orientation
    return "landscape";
  } else {
    // Height > Width = portrait orientation
    return "portrait";
  }
}

export async function processVideoForFastStart(
  inputFilePath: string
): Promise<string> {
  const outputFilePath = inputFilePath + ".processed";

  const process = Bun.spawn(
    [
      "ffmpeg",
      "-i",
      inputFilePath,
      "-movflags",
      "faststart",
      "-map_metadata",
      "0",
      "-codec",
      "copy",
      "-f",
      "mp4",
      outputFilePath,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  const { exited } = process;
  const exitCode = await exited;

  if (exitCode !== 0) {
    throw new Error(`ffmpeg failed with exit code ${exitCode}: ${stderr}`);
  }

  return outputFilePath;
}
