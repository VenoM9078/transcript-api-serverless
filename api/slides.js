const PptxGenJS = require("pptxgenjs");

module.exports = (req, res) => {
  if (req.method === "POST") {
    const slides = req.body;

    // Create a new presentation
    let pptx = new PptxGenJS();

    // Title slide
    const titleSlide = pptx.addSlide();
    titleSlide.addText(slides["Title"], {
      x: 1.5,
      y: 1,
      w: "80%",
      h: 1,
      fontSize: 41,
      color: "1d1b38",
    });
    titleSlide.addText(slides["Objective"], {
      x: 1.5,
      y: 2,
      w: "80%",
      h: 2,
      fontSize: 18,
      color: "1d1b38",
    });

    // Content slides
    slides["Slides"].forEach((item) => {
      const contentSlide = pptx.addSlide();
      contentSlide.addText(item["Heading"], {
        x: 0.5,
        y: 0.5,
        w: "80%",
        h: 1,
        fontSize: 18,
        color: "1d1b38",
      });
      contentSlide.addText(item["Content"], {
        x: 0.5,
        y: 1.2,
        w: "80%",
        h: 2,
        fontSize: 14,
        color: "1d1b38",
      });

      // Display questions as bullets
      item["Questions"].forEach((question, index) => {
        contentSlide.addText(question, {
          x: 0.5,
          y: 2.2 + index * 0.5,
          w: "80%",
          h: 2,
          fontSize: 14,
          color: "1d1b38",
          indentLevel: 1,
          bullet: { code: "2022", marginPt: 15 },
        });
      });
    });

    pptx
      .write("base64")
      .then((base64) => {
        const buffer = Buffer.from(base64, "base64");

        // Set the headers for the response
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        );
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=presentation.pptx"
        );

        // Send the binary stream as a response
        res.send(buffer);
      })
      .catch((err) => {
        console.error(err);
        res.status(500).send("Error generating the presentation.");
      });
  } else {
    res.send("Hello!");
  }
};
