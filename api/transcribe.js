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

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "video/mp4",
    "video/mov",
    "video/avi",
    "audio/mp3",
    "audio/mpeg",
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Only ${allowedTypes.join(", ")} files are allowed. You uploaded a ${
          file.mimetype
        } file`
      )
    );
  }
};

const upload = multer({
  storage: storage,
  fileFilter,
  limits: {
    fileSize: 200 * 1024 * 1024, // 200 MB in bytes
  },
});

module.exports = async (req, res) => {
  try {
    const { url, prompt } = req.body;
    console.log(url, prompt);
    const filename = url.split("/").pop();
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "utf-8");
    const filePath = path.join(
      __dirname,
      "..",
      "..",
      "src",
      "assets",
      "transcribeAudio"
    );
    fs.writeFileSync(`${filePath}/${filename}`, buffer);
    const formData = new FormData();
    formData.append("file", fs.createReadStream(`${filePath}/${filename}`));
    formData.append("model", "whisper-1");

    // console.log(formData);

    console.log(`${filePath}/${filename}`);
    const resp = await openai.createTranscription(
      fs.createReadStream(`${filePath}/${filename}`),
      "whisper-1",
      prompt,
      "vtt"
    );
    const transcription = resp.data;
    fs.unlink(`${filePath}/${filename}`, (err) => {
      if (err) console.error(err);
    });

    res.json({ transcription });

    // Delete the mp3 file
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error transcribing audio" });
  }
};
