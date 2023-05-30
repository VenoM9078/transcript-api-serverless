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
    cb(null, path.join(__dirname, "..", "..", "src", "assets", "files"));
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
  const { url } = req.body;

  try {
    // validate the URL
    if (!ytdl.validateURL(url)) {
      throw new Error("Invalid YouTube URL");
    }

    console.log(ytdl.validateURL(url));

    // get the video info
    const videoInfo = await ytdl.getInfo(url);

    // get the highest quality audio stream
    const audioStream = ytdl.filterFormats(videoInfo.formats, "audioonly")[0];

    // create a temporary file to store the MP3 data

    const tempFile = path.join(
      __dirname,
      "..",
      "..",
      "src",
      "assets",
      "youtube_urls",
      "temp.mp3"
    );

    // download and convert the audio stream to MP3
    await new Promise((resolve, reject) => {
      ffmpeg(audioStream.url)
        .noVideo()
        .outputFormat("mp3")
        .outputOptions("-vn")
        .on("error", (err) => {
          console.error(`Error converting video to MP3: ${err}`);
          reject(err);
        })
        .on("end", () => {
          console.log(`Successfully converted video to MP3: ${tempFile}`);
          resolve();
        })
        .save(tempFile);
    });

    // upload the MP3 file to Cloudinary
    const cloudinaryResult = await cloudinary.uploader.upload(tempFile, {
      resource_type: "video",
    });

    // delete the temporary file
    fs.unlinkSync(tempFile);

    // create a signed URL for the uploaded file
    const signedUrl = cloudinary.url(cloudinaryResult.public_id, {
      resource_type: "video",
      format: "mp3",
      secure: true,
    });

    console.log(url);

    // return the signed URL
    res.status(200).json({ url: signedUrl });
  } catch (err) {
    console.error(`Error processing YouTube URL: ${err}`);
    res.status(500).send("Error processing YouTube URL");
  }
};
