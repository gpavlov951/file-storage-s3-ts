import type { BunRequest } from "bun";
import { randomBytes } from "crypto";
import path from "path";
import { getBearerToken, validateJWT } from "../auth";
import { type ApiConfig } from "../config";
import { getVideo, updateVideo, type Video } from "../db/videos";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { respondWithJSON } from "./json";

const MAX_UPLOAD_SIZE = 1 << 30; // 1 GB

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  // Extract the videoID from the URL path parameters and parse it as a UUID
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  // Authenticate the user to get a userID
  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  // Get the video metadata from the database, if the user is not the video owner, throw a UserForbiddenError error
  const video = getVideo(cfg.db, videoId);
  if (!video) {
    throw new NotFoundError("Video not found");
  }

  if (video.userID !== userID) {
    throw new UserForbiddenError("You are not the owner of this video");
  }

  // Parse the uploaded video file from the form data
  const formData = await req.formData();
  const videoFile = formData.get("video");
  if (!(videoFile instanceof File)) {
    throw new BadRequestError("Video must be a file");
  }

  // Check that file size does not exceed our upload limit
  if (videoFile.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("Video file is too large");
  }

  // Validate the uploaded file to ensure it's an MP4 video
  if (videoFile.type !== "video/mp4") {
    throw new BadRequestError("Video must be an MP4 file");
  }

  // Generate a random filename with hex format
  const randomFileName = randomBytes(32).toString("hex");
  const fileName = `${randomFileName}.mp4`;
  const tempFilePath = path.join("/tmp", fileName);

  let tempFileCreated = false;
  try {
    // Save the uploaded file to a temporary file on disk
    const data = await videoFile.arrayBuffer();
    await Bun.write(tempFilePath, data);
    tempFileCreated = true;

    // Put the object into S3 using S3Client.file().write()
    const s3File = cfg.s3Client.file(fileName);
    const fileContents = Bun.file(tempFilePath);

    await s3File.write(fileContents, {
      type: videoFile.type,
    });

    // Update the VideoURL of the video record in the database with the S3 bucket and key
    const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${fileName}`;

    const updatedVideo: Video = {
      ...video,
      videoURL,
    };

    updateVideo(cfg.db, updatedVideo);

    return respondWithJSON(200, updatedVideo);
  } finally {
    // Remove the temp file when the process finishes
    if (tempFileCreated) {
      try {
        const fs = require("fs");
        fs.unlinkSync(tempFilePath);
      } catch (error) {
        console.error("Failed to clean up temp file:", error);
      }
    }
  }
}
