const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const cloudinary = require("cloudinary").v2;
const path = require("path");
const mime = require("mime-types");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = path.join(__dirname, "..", "ffmpeg", "bin", "ffmpeg.exe");
const axios = require("axios");
const FormData = require("form-data");
const { Configuration, OpenAIApi } = require("openai");
const YoutubeMp3Downloader = require("youtube-mp3-downloader");
const urlParser = require("url");
const ytdl = require("ytdl-core");

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

ffmpeg.setFfmpegPath(ffmpegPath);

cloudinary.config({
  cloud_name: "dldgy1k9c",
  api_key: "373631273284145",
  api_secret: "PMrfrrHZ_KgkCZ50MszJKFApDOI",
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "/tmp");
  },
  filename: function (req, file, cb) {
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname)
    );
  },
});

// const fileFilter = (req, file, cb) => {
//   const allowedTypes = [
//     "video/mp4",
//     "video/mov",
//     "video/avi",
//     "audio/mp3",
//     "audio/mpeg",
//   ];
//   if (allowedTypes.includes(file.mimetype)) {
//     cb(null, true);
//   } else {
//     cb(
//       new Error(
//         `Only ${allowedTypes.join(", ")} files are allowed. You uploaded a ${
//           file.mimetype
//         } file`
//       )
//     );
//   }
// };

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200 MB in bytes
  },
});

module.exports = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      // No file provided
      return res.status(400).json({ message: "No file provided" });
    }

    const sourceFile = file.path;
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeType = mime.lookup(sourceFile);

    if (mimeType && mimeType.startsWith("audio/")) {
      // If file is already an audio file, upload it directly to Cloudinary
      try {
        const uploadResult = await cloudinary.uploader.upload(sourceFile, {
          resource_type: "video",
        });
        const uploadedFile = {
          url: uploadResult.secure_url,
          fileName: file.filename,
        };
        return res.status(200).json({ file: uploadedFile });
      } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to upload file" });
      }
    } else if (
      mimeType &&
      mimeType.startsWith("video/") &&
      [".mp4", ".mov", ".avi"].includes(extension)
    ) {
      // If file is a video, convert it to audio using ffmpeg and upload to Cloudinary
      try {
        const destinationFile = path.join(
          file.destination,
          `${path.parse(file.filename).name}.mp3`
        );
        await new Promise((resolve, reject) => {
          ffmpeg(sourceFile)
            .setFfmpegPath(ffmpegPath)
            .output(destinationFile)
            .audioCodec("libmp3lame")
            .on("end", resolve)
            .on("error", reject)
            .run();
        });

        const uploadResult = await cloudinary.uploader.upload(destinationFile, {
          resource_type: "video",
        });
        const uploadedFile = {
          url: uploadResult.secure_url,
          fileName: `${path.parse(file.filename).name}.mp3`,
        };

        // Remove the converted audio file from the server
        fs.unlink(destinationFile, (err) => {
          if (err) console.error(err);
        });

        fs.unlink(sourceFile, (err) => {
          if (err) console.error(err);
        });

        return res.status(200).json({ file: uploadedFile });
      } catch (err) {
        console.error(err);
        return res
          .status(500)
          .json({ message: "Failed to convert and upload file" });
      }
    } else {
      // File type not supported
      return res.status(400).json({
        message: `Invalid file type. You uploaded a ${file.mimetype} file`,
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};
