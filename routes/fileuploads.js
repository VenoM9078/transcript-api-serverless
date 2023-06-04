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
const streamifier = require("streamifier");
const vtt2srt = require("node-vtt-to-srt");
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
        const videoUploadResult = await cloudinary.uploader.upload(sourceFile, {
          resource_type: "video",
        });
        console.log("Video upload result", videoUploadResult); // Add this line
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
let totalDuration = 0;

router.post("/transcribe", async (req, res) => {
  console.log("Transcribe endpoint hit");

  if (!req.body) {
    console.log("Request body is undefined");
    return res.status(400).json({ message: "Request body is undefined" });
  }

  const { urls, prompt } = req.body;
  console.log("Request body:", req.body);

  try {
    if (!Array.isArray(urls) || urls.length === 0) {
      console.log("No URLs provided");
      return res.status(400).json({ message: "No URLs provided" });
    }

    let originalTranscriptions = [];
    let modifiedTranscriptions = "";
    for (let url of urls) {
      if (!url) {
        console.log("URL is undefined");
        return res.status(400).json({ message: "URL is undefined" });
      }

      console.log("Processing URL:", url);

      let filename;
      try {
        filename = url.split("/").pop();
      } catch (err) {
        console.error("Error splitting URL:", err);
        return res.status(500).json({ message: "Error splitting URL" });
      }

      let response;
      try {
        response = await axios.get(url, { responseType: "arraybuffer" });
      } catch (err) {
        console.error("Error getting file:", err);
        return res.status(500).json({ message: "Error getting file" });
      }

      const buffer = Buffer.from(response.data, "utf-8");
      const filePath = path.join(__dirname, "..", "transcribed_audio");
      fs.writeFileSync(`${filePath}/${filename}`, buffer);

      const formData = new FormData();
      formData.append("file", fs.createReadStream(`${filePath}/${filename}`));
      formData.append("model", "whisper-1");

      console.log(`File path: ${filePath}/${filename}`);

      let resp;
      try {
        resp = await openai.createTranscription(
          fs.createReadStream(`${filePath}/${filename}`),
          "whisper-1",
          prompt,
          "vtt"
        );
      } catch (err) {
        console.error("Error creating transcription:", err);
        return res
          .status(500)
          .json({ message: "Error creating transcription" });
      }

      const transcription = resp.data;
      fs.unlink(`${filePath}/${filename}`, (err) => {
        if (err) console.error(err);
      });

      // Keep the original transcription
      originalTranscriptions.push(transcription);

      // Parse WEBVTT file and adjust timestamps for modified transcription
      const lines = transcription.split("\n");
      const timeRegexp = /(\d+):(\d+):(\d+).(\d+) --> (\d+):(\d+):(\d+).(\d+)/;
      const adjustedLines = lines.map((line) => {
        const match = line.match(timeRegexp);
        if (match) {
          let [
            _,
            startHour,
            startMinute,
            startSecond,
            startMillisecond,
            endHour,
            endMinute,
            endSecond,
            endMillisecond,
          ] = match;
          let startTime =
            parseInt(startHour) * 3600 +
            parseInt(startMinute) * 60 +
            parseInt(startSecond) +
            parseInt(startMillisecond) / 1000;
          let endTime =
            parseInt(endHour) * 3600 +
            parseInt(endMinute) * 60 +
            parseInt(endSecond) +
            parseInt(endMillisecond) / 1000;

          startTime += totalDuration;
          endTime += totalDuration;

          // Convert time to hh:mm:ss.mmm format
          const pad = (num, size) => ("000" + num).slice(size * -1);
          const timeToStr = (time) => {
            const hours = Math.floor(time / 3600);
            const minutes = Math.floor(time / 60) % 60;
            const seconds = Math.floor(time % 60);
            const milliseconds = time.toFixed(3).slice(-3);

            return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(
              seconds,
              2
            )}.${pad(milliseconds, 3)}`;
          };

          return `${timeToStr(startTime)} --> ${timeToStr(endTime)}`;
        }

        return line;
      });

      const adjustedTranscription = adjustedLines.join("\n");

      // Set totalDuration to endTime of the last cue
      const lastLine = adjustedLines[adjustedLines.length - 1];
      const lastTimeMatch = lastLine.match(timeRegexp);
      if (lastTimeMatch) {
        const endTime =
          parseFloat(lastTimeMatch[5]) * 3600 +
          parseFloat(lastTimeMatch[6]) * 60 +
          parseFloat(lastTimeMatch[7]) +
          parseFloat(lastTimeMatch[8]) / 1000;
        totalDuration = endTime;
      }

      modifiedTranscriptions += adjustedTranscription + "\n\n";
    }

    console.log(modifiedTranscriptions, originalTranscriptions);

    res.status(200).json({
      originalTranscriptions: originalTranscriptions,
      modifiedTranscriptions: modifiedTranscriptions,
    });
  } catch (error) {
    console.error("General error:", error);
    res.status(500).json({ message: "General error", error: error.toString() });
  }
});

router.post("/downloadSrt", (req, res) => {
  const { transcription } = req.body;

  if (!transcription) {
    return res.status(400).json({ message: "No transcription provided" });
  }

  // Create the "srts" directory if it doesn't exist
  const dirPath = path.join(__dirname, "..", "srts");
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  // Convert the transcription from VTT to SRT and write to a file
  const vttFilePath = path.join(dirPath, "transcription.vtt");
  const srtFilePath = path.join(dirPath, "transcription.srt");

  fs.writeFileSync(vttFilePath, transcription);

  fs.createReadStream(vttFilePath)
    .pipe(vtt2srt())
    .pipe(fs.createWriteStream(srtFilePath))
    .on("finish", () => {
      let uploadPromise = new Promise((resolve, reject) => {
        cloudinary.uploader.upload(
          srtFilePath,
          {
            resource_type: "raw",
          },
          function (error, result) {
            if (error) {
              console.error(error); // log the error for debugging
              reject({ message: "Cloudinary upload error" });
            } else if (!result || !result.url) {
              reject({ message: "No result or URL from Cloudinary" });
            } else {
              // Delete the temporary files
              fs.unlinkSync(vttFilePath);
              fs.unlinkSync(srtFilePath);

              resolve({ srt_file_url: result.url });
            }
          }
        );
      });

      uploadPromise
        .then(({ srt_file_url }) => {
          res.json({ srt_file_url });
        })
        .catch((error) => {
          res.status(500).json(error);
        });
    });
});

module.exports = router;
