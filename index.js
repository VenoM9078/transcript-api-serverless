const express = require("express");
const app = express();
require("dotenv").config();

const cors = require("cors");
const fileUploadRoute = require("./routes/fileuploads");

app.use(cors());

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

const port = process.env.PORT || 5040;

app.use(express.json());

app.use("/api", fileUploadRoute);

app.use(function (err, req, res, next) {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

app.listen(port, () => {
  console.log("Backend Server is Running on Port 5040`");
});
