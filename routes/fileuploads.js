const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const cloudinary = require("cloudinary").v2;
const path = require("path");
const mime = require("mime-types");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = path.join(__dirname, "..", "ffmpeg-linux", "ffmpeg");
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
    console.log("Upload endpoint hit");
    const file = req.file;

    if (!file) {
      console.log("No file provided");
      return res.status(400).json({ message: "File not found" });
    }

    console.log("Processing file", file.originalname);
    const sourceFile = file.path;
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeType = mime.lookup(sourceFile);

    if (mimeType && mimeType.startsWith("audio/")) {
      console.log("File is an audio file");
      try {
        console.log("Uploading file to Cloudinary");
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
        console.log("File uploaded successfully", uploadedFile);
        return res.status(200).json({ file: uploadedFile });
      } catch (err) {
        console.error("Error uploading file to Cloudinary", err);
        return res.status(500).json({ message: "Failed to upload file" });
      }
    } else if (
      mimeType &&
      mimeType.startsWith("video/") &&
      [".mp4", ".mov", ".avi"].includes(extension)
    ) {
      console.log("File is a video file");
      try {
        console.log("Uploading video file to Cloudinary");
        const videoUploadResult = await cloudinary.uploader.upload_large(
          sourceFile,
          {
            resource_type: "video",
          }
        );
        const videoFile = {
          url: videoUploadResult.secure_url,
          fileName: file.filename,
        };

        console.log("Converting video to audio");
        const destinationFile = path.join(
          __dirname,
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
            .on("error", (err) => {
              console.error("Error from ffmpeg", err);
              reject(err);
            })
            .run();
        });

        console.log("Uploading converted file to Cloudinary");
        const audioUploadResult = await cloudinary.uploader.upload(
          destinationFile,
          {
            resource_type: "video",
          }
        );
        const audioFile = {
          url: audioUploadResult.secure_url,
          fileName: `${path.parse(file.filename).name}.mp3`,
        };

        console.log("File converted and uploaded successfully", audioFile);

        fs.unlink(destinationFile, (err) => {
          if (err) console.error("Error deleting converted file", err);
        });

        fs.unlink(sourceFile, (err) => {
          if (err) console.error("Error deleting original file", err);
        });

        return res
          .status(200)
          .json({ videoFile: videoFile, audioFile: audioFile });
      } catch (err) {
        console.error("Error converting and uploading file", err);
        return res
          .status(500)
          .json({ message: "Failed to convert and upload file" });
      }
    } else {
      console.log("File type not supported", file.mimetype);
      return res.status(400).json({
        message: `Invalid file type. You uploaded a ${file.mimetype} file`,
      });
    }
  } catch (err) {
    console.error("Unhandled error in /upload endpoint", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/upload-yt", async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method not allowed. Use POST" });
    return;
  }

  const { url } = req.body;
  if (!url || url == "") {
    res.status(400).json({ message: "No YouTube URL was provided" });
    return;
  }

  try {
    // validate the URL
    if (!ytdl.validateURL(url)) {
      res.status(400).json({ message: "Invalid YouTube URL" });
      return;
    }
    console.log(`URL validation passed: ${url}`);

    // get the video info
    let videoInfo;
    try {
      videoInfo = await ytdl.getInfo(url);
      console.log(`Video information retrieved successfully`);
    } catch (err) {
      console.error(`Error getting video information: ${err}`);
      throw new Error("Error getting video information");
    }

    // get the highest quality audio stream
    const audioStream = ytdl.filterFormats(videoInfo.formats, "audioonly")[0];
    console.log(`Audio stream obtained successfully`);

    // create a temporary file to store the MP3 data
    const tempFile = path.join(__dirname, "..", "audio_files", "temp.mp3");
    console.log(`Temporary file location: ${tempFile}`);

    // download and convert the audio stream to MP3
    try {
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
    } catch (err) {
      console.error(`Error during audio conversion: ${err}`);
      throw new Error("Error during audio conversion");
    }

    // upload the MP3 file to Cloudinary
    let cloudinaryResult;
    try {
      cloudinaryResult = await cloudinary.uploader.upload(tempFile, {
        resource_type: "video",
      });
      console.log(`File uploaded successfully to Cloudinary`);
    } catch (err) {
      console.error(`Error uploading to Cloudinary: ${err}`);
      throw new Error("Error uploading to Cloudinary");
    }

    // delete the temporary file
    try {
      fs.unlinkSync(tempFile);
      console.log(`Temporary file deleted`);
    } catch (err) {
      console.error(`Error deleting temporary file: ${err}`);
      throw new Error("Error deleting temporary file");
    }

    // create a signed URL for the uploaded file
    const signedUrl = cloudinary.url(cloudinaryResult.public_id, {
      resource_type: "video",
      format: "mp3",
      secure: true,
    });
    console.log(`Signed URL: ${signedUrl}`);

    // return the signed URL
    res.status(200).json({ url: signedUrl });
  } catch (err) {
    console.error(`Error processing YouTube URL: ${err}`);
    res
      .status(500)
      .json({ message: "Error processing YouTube URL", error: err.toString() });
  }
});

router.post("/transcribe", async (req, res) => {
  try {
    const { urls, prompt } = req.body; // We are now expecting an array of URLs.
    let transcriptions = [];

    for (let url of urls) {
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

      // Add each transcription to the array
      transcriptions.push(transcription);
    }

    res.json({ transcriptions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error transcribing audio" });
  }
});
module.exports = router;
