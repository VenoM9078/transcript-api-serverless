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
    cb(null, path.join(__dirname, "..", "files"));
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
  limits: {
    fileSize: 200 * 1024 * 1024, // 200 MB in bytes
  },
});

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      // No file provided
      return res.status(400).json({ message: "File not found" });
    }

    const sourceFile = file.path;
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeType = mime.lookup(sourceFile);

    if (mimeType && mimeType.startsWith("audio/")) {
      // If file is already an audio file, upload it directly to Cloudinary
      try {
        const uploadResult = await cloudinary.uploader.upload_large(
          sourceFile,
          {
            resource_type: "video",
          }
        );
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
          "..",
          "files",
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
});

router.post("/upload-yt", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Use POST" });
    return;
  }
  const { url } = req.body;

  if (url == "") {
    throw new Error("No YouTube URL was provided");
  }

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

    const tempFile = path.join(__dirname, "..", "audio_files", "temp.mp3");

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
});

router.post("/transcribe", async (req, res) => {
  try {
    const { url, prompt } = req.body;
    console.log(url, prompt);
    const filename = url.split("/").pop();
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "utf-8");
    const filePath = path.join(__dirname, "..", "transcribed_audio");
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
});
module.exports = router;
