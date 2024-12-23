const express = require("express");
const cors = require("cors");
const opentype = require("opentype.js");
const makerjs = require("makerjs");
const wawoff2 = require("wawoff2");
const xml2js = require("xml2js");
const axios = require("axios");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const getImageOutline = require("image-outline");
const Tesseract = require("tesseract.js");
const app = express();

const FormData = require("form-data");

class Kolors {
  constructor() {
    this.commonHeaders = {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      priority: "u=1, i",
      referer: "https://kwai-kolors-kolors.hf.space/?__theme=dark",
      origin: "https://kwai-kolors-kolors.hf.space",
    };
  }

  async processRequest(method, url, headers = {}, data = null, files = null) {
    const config = {
      method,
      url,
      headers,
      data,
      responseType: "text",
    };

    if (files) {
      const form = new FormData();
      for (const [name, file] of Object.entries(files)) {
        form.append(name, fs.createReadStream(file.path), {
          filename: file.name,
          contentType: "image/webp",
        });
      }
      config.data = form;
      config.headers = {
        ...headers,
        ...form.getHeaders(),
      };
    } else if (data) {
      config.data = data;
    }

    try {
      const response = await axios(config);
      console.log(response.status);
      console.log(response.data);
      return response.data;
    } catch (error) {
      console.error("Error in processRequest:", error);
      throw error;
    }
  }

  async uploadImage(imagePath) {
    const url =
      "https://kwai-kolors-kolors.hf.space/upload?upload_id=uppaw4kwm5";
    const headers = {
      ...this.commonHeaders,
      "content-type": "multipart/form-data",
    };

    const responseText = await this.processRequest("post", url, headers, null, {
      image: {
        path: imagePath,
        name: "image.webp",
      },
    });
    const filePath = responseText.replace(/[\[\]"\\\n]/g, "");
    return filePath;
  }

  async getJwtToken() {
    const generateTimestamp = () =>
      encodeURIComponent(new Date().toISOString());
    const url = `https://huggingface.co/api/spaces/Kwai-Kolors/Kolors/jwt?expiration=${generateTimestamp()}`;
    const responseText = await this.processRequest(
      "get",
      url,
      this.commonHeaders
    );
    const responseJson = JSON.parse(responseText);
    return responseJson.token;
  }

  async getQueueData(sessionHash) {
    const url = `https://kwai-kolors-kolors.hf.space/queue/data?session_hash=${sessionHash}`;
    const headers = {
      ...this.commonHeaders,
      accept: "text/event-stream",
      "content-type": "application/json",
    };

    try {
      const response = await axios.get(url, {
        headers,
        responseType: "stream",
      });
      return new Promise((resolve, reject) => {
        let timeoutId = setTimeout(() => {
          response.data.destroy(); // Close the stream
          resolve(sessionHash); // Return session_hash if timeout occurs
        }, 3000); // 3 seconds timeout

        response.data.on("data", (chunk) => {
          const lines = chunk
            .toString()
            .split("\n")
            .filter((line) => line.startsWith("data: "));
          lines.forEach((line) => {
            console.log(line);
            const eventData = line.substring(6);
            const eventJson = JSON.parse(eventData);
            if (eventJson.msg === "process_completed") {
              clearTimeout(timeoutId); // Clear the timeout
              const outputData = eventJson.output?.data || [];
              if (outputData.length > 0) {
                const fileInfo = outputData[0];
                resolve(fileInfo.url);
                response.data.destroy(); // Close the stream
              }
            }
          });
        });

        response.data.on("end", () => {
          clearTimeout(timeoutId); // Clear the timeout
          reject(new Error("Stream ended without completion"));
          response.data.destroy(); // Close the stream
        });

        response.data.on("error", (err) => {
          clearTimeout(timeoutId); // Clear the timeout
          reject(err);
          response.data.destroy(); // Close the stream
        });

        response.data.on("close", () => {
          console.log("Stream closed");
        });
      });
    } catch (error) {
      console.error("Error in getQueueData:", error);
      throw error;
    }
  }

  async joinQueue(sessionHash, fileUrl, jwtToken, prompt) {
    const url = "https://kwai-kolors-kolors.hf.space/queue/join?__theme=dark";
    const headers = {
      ...this.commonHeaders,
      "content-type": "application/json",
      "x-zerogpu-token": jwtToken,
      origin: "https://kwai-kolors-kolors.hf.space",
    };

    const data = {
      data: [
        prompt,
        {
          path: fileUrl,
          url: `https://kwai-kolors-kolors.hf.space/file=${fileUrl}`,
          orig_name: "image.webp",
          size: 172602,
          mime_type: "image/webp",
          meta: {
            _type: "gradio.FileData",
          },
        },
        0.3,
        "",
        0,
        true,
        1024,
        1536,
        5,
        25,
      ],
      event_data: null,
      fn_index: 2,
      trigger_id: 26,
      session_hash: sessionHash,
    };

    const responseText = await this.processRequest("post", url, headers, data);
    return responseText;
  }

  generateSessionHash() {
    const length = 11;
    const charset =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      result += charset[randomIndex];
    }
    return result;
  }
}
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Function to convert polygon data to SVG path
function polygonToSVGPath(polygon) {
  if (!polygon || polygon.length === 0) {
    return ""; // Return empty string if polygon is invalid
  }

  // Construct the SVG path string
  let pathString = `M${polygon[0].x},${polygon[0].y}`; // Move to the first point
  for (let i = 1; i < polygon.length; i++) {
    pathString += ` L${polygon[i].x},${polygon[i].y}`; // Line to the next point
  }
  pathString += " Z"; // Close the path

  return pathString;
}

function handleRequest(err, loadedFont, config) {
  const [
    text,
    fontName,
    size,
    union,
    filled,
    kerning,
    separate,
    bezierAccuracy,
    units,
    fill,
    stroke,
    strokeWidth,
    strokeNonScaling,
    fillRule,
    individualLetters,
    res,
  ] = config;

  if (err) {
    console.error("Font could not be loaded:", err);
    return res.status(500).json({ error: err.message });
  }

  if (individualLetters) {
    // Generate individual SVGs for each letter and store them in a JSON object
    const individualSVGs = {};
    for (let i = 0; i < text.length; i++) {
      const letter = text[i];
      const result = callMakerjs(
        loadedFont,
        letter,
        size,
        union,
        filled,
        kerning,
        separate,
        bezierAccuracy,
        units,
        fill,
        stroke,
        strokeWidth,
        strokeNonScaling,
        fillRule
      );
      let temp;
      xml2js.parseString(
        result.svg,
        {
          explicitArray: false,
        },
        function (err, result) {
          if (!err) {
            // Now 'result' contains the JSON representation of the SVG
            temp = result;
          } else {
            console.error(err);
          }
        }
      );

      individualSVGs[letter] = temp;
    }
    res.status(200).json(individualSVGs); // Return JSON object
  } else {
    // Generate a single SVG for the entire text
    const result = callMakerjs(
      loadedFont,
      text,
      size,
      union,
      filled,
      kerning,
      separate,
      bezierAccuracy,
      units,
      fill,
      stroke,
      strokeWidth,
      strokeNonScaling,
      fillRule
    );
    res.status(200).send(result.svg);
  }
}

async function downloadAndSaveFont(fontUrl) {
  const tempDir = path.join(os.tmpdir(), "downloaded-or-converted-fonts");

  try {
    await fs.access(tempDir);
  } catch (error) {
    await fs.mkdir(tempDir, { recursive: true });
  }

  try {
    const response = await axios.get(fontUrl, {
      responseType: "arraybuffer",
      headers: {
        "Accept-Encoding": "identity",
      },
    });

    let filename =
      response.headers["content-disposition"]?.match(
        /filename=['"]?(.+)['"]?/
      )?.[1] || new URL(fontUrl).pathname.split("/").pop();

    const fontPath = path.join(tempDir, filename);
    await fs.writeFile(fontPath, response.data);

    // Check if the file needs to be decompressed from WOFF2 to TTF
    if (filename.endsWith(".woff2")) {
      try {
        const fontBuffer = await fs.readFile(fontPath);
        const decompressedBuffer = await wawoff2.decompress(fontBuffer);
        const ttfFilename = filename.replace(".woff2", ".ttf");
        const ttfFontPath = path.join(tempDir, ttfFilename);
        await fs.writeFile(ttfFontPath, decompressedBuffer);
        console.log("Font decompressed and saved successfully.");
        return ttfFontPath;
      } catch (decompressionError) {
        console.error("Error decompressing the font:", decompressionError);
        throw decompressionError;
      }
    }

    return fontPath;
  } catch (error) {
    console.error("Error processing the font:", error);
    throw error;
  }
}

function callMakerjs(
  font,
  text,
  size,
  union,
  filled,
  kerning,
  separate,
  bezierAccuracy,
  units,
  fill,
  stroke,
  strokeWidth,
  strokeNonScaling,
  fillRule
) {
  // Generate the text using a font
  var textModel = new makerjs.models.Text(
    font,
    text,
    size,
    union,
    false,
    bezierAccuracy,
    { kerning }
  );

  if (separate) {
    for (var i in textModel.models) {
      textModel.models[i].layer = i;
    }
  }

  var svg = makerjs.exporter.toSVG(textModel, {
    fill: filled ? fill : undefined,
    stroke: stroke ? stroke : undefined,
    strokeWidth: strokeWidth ? strokeWidth : undefined,
    fillRule: fillRule ? fillRule : undefined,
    scalingStroke: !strokeNonScaling,
  });

  var dxf = makerjs.exporter.toDXF(textModel, {
    units: units,
    usePOLYLINE: true,
  });

  return { svg, dxf };
}

// Helper function to download an image from a URL
async function downloadImage(url, dest) {
  const writer = await fs.open(dest, "w");
  const response = await axios.get(url, { responseType: "stream" });

  await new Promise((resolve, reject) => {
    response.data.pipe(writer.createWriteStream());
    response.data.on("end", resolve);
    response.data.on("error", reject);
  });

  await writer.close();
}

// API Endpoint
app.post("/highlight", express.json(), async (req, res) => {
  const { imageUrl, searchTerms } = req.body;

  if (!imageUrl || !Array.isArray(searchTerms) || searchTerms.length === 0) {
    return res
      .status(400)
      .json({ error: "imageUrl and searchTerms are required" });
  }

  try {
    // Download the image
    const tempImagePath = path.join(os.tmpdir(), "temp_image.jpg");
    await downloadImage(imageUrl, tempImagePath);

    // Run OCR
    const {
      data: { text, words },
    } = await Tesseract.recognize(tempImagePath, "eng", {
      logger: (info) => console.log(info), // Optional: log OCR progress
    });

    const highlights = [];

    // Search for each term
    searchTerms.forEach((term) => {
      const termWords = term.toLowerCase().split(" ");
      const termLen = termWords.length;

      let wordIndex = 0;

      words.forEach((wordObj, i) => {
        const word = wordObj.text?.toLowerCase();
        if (!word) return;

        if (word === termWords[wordIndex]) {
          wordIndex++;

          // If all words match
          if (wordIndex === termLen) {
            wordIndex = 0;

            // Get bounding box
            const xStart = words[i - termLen + 1].bbox.x0;
            const yStart = words[i - termLen + 1].bbox.y0;
            const xEnd = words[i].bbox.x1;
            const yEnd = words[i].bbox.y1;

            highlights.push({
              text: term,
              bbox: { x0: xStart, y0: yStart, x1: xEnd, y1: yEnd },
            });
          }
        } else {
          wordIndex = 0; // Reset if match breaks
        }
      });
    });

    // Clean up the temporary image
    await fs.unlink(tempImagePath);

    // Respond with highlights
    return res.json({ searchTerms, highlights });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "An error occurred while processing the image." });
  }
});

app.get("/process", async (req, res) => {
  const kolors = new Kolors();
  try {
    const fileUrl =
      "/tmp/gradio/a8afacda04e05001682bb475f128b24002ace7b7/e41b87fb-4cc3-43cd-a6e6-f3dbb08c2399.webp";
    const prompt =
      req.query.prompt ||
      "Anna, 破旧衣服, 大声喊叫的愤怒脸, 嘴巴张大, 全身, 贫民窟背景, 仙女教母, 时尚TikTok风格衣服, 出现在闪亮和点赞的云中, 脸上带着炫酷的表情, 魔法棒, 变成华丽舞会礼服, 鱼网袜和蕾丝项圈, 震惊表情, 这幅艺术作品致敬了传奇的弗兰克·弗拉泽塔，展示了Loish van Baarle的独特风格和Boris Vallejo的动态笔触。这幅杰作向著名艺术家Ross Tran、Greg Tocchini、Tom Bagshaw和Steve Henderson的才华致敬，创造了一个引人入胜且迷人的场景。";
    const sessionHash = req.query.session_hash || kolors.generateSessionHash();
    // Step 1: Get JWT token
    const jwtToken = await kolors.getJwtToken();
    console.log("JWT Token:", jwtToken);

    // Step 2: Join the queue
    const queueResponse = await kolors.joinQueue(
      sessionHash,
      fileUrl,
      jwtToken,
      prompt
    );
    console.log("Queue Response:", queueResponse);

    res.send({ sessionHash });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("An error occurred");
  }
});

app.get("/poll", async (req, res) => {
  const kolors = new Kolors();
  try {
    const sessionHash = req.query.session_hash;
    if (!sessionHash) {
      return res.status(400).send("session_hash is required");
    }

    const finalUrl = await kolors.getQueueData(sessionHash);
    console.log("Final URL:", finalUrl);

    res.send({ finalUrl });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("An error occurred");
  }
});

app.post("/generateSVGPath", async (req, res) => {
  // Set default values
  const {
    text,
    size = 72, // Default font size
    union = false,
    filled = true,
    kerning = true,
    separate = false,
    bezierAccuracy = 2,
    units = "mm", // Default units
    fill = "black", // Default fill color
    stroke = "none", // Default stroke color
    strokeWidth = "1", // Default stroke width
    strokeNonScaling = false,
    fillRule = "nonzero", // Default fill rule
    fontUrl,
    individualLetters = false,
    font = "Roobert-Regular.ttf", // Default local font
  } = req.body;

  const config = [
    text,
    font,
    size,
    union,
    filled,
    kerning,
    separate,
    bezierAccuracy,
    units,
    fill,
    stroke,
    strokeWidth,
    strokeNonScaling,
    fillRule,
    individualLetters,
    res,
  ];

  const fontPath = fontUrl
    ? await downloadAndSaveFont(fontUrl)
    : path.join(__dirname, "public", "fonts", font);
  console.log(fontPath);
  try {
    await fs.access(fontPath);
    console.log("File exists:", fontPath);
  } catch (error) {
    console.log(fontPath);
    res.status(500).json({ error: error.message });
    // Handle the error or throw it
  }
  opentype.load(fontPath, (err, loadedFont) => {
    handleRequest(err, loadedFont, config);
  });
});

app.post("/generateSVGPathWithGoogleFont", async (req, res) => {
  // Default values for parameters
  const {
    text,
    fontName = "Open Sans", // Default Google Font
    size = 72, // Default font size
    union = false, // Default union
    filled = true, // Default filled
    kerning = true, // Default kerning
    separate = false, // Default separate
    bezierAccuracy = 2, // Default bezierAccuracy
    units = "mm", // Default units
    fill = "black", // Default fill color
    stroke = "none", // Default stroke
    strokeWidth = "1", // Default stroke width
    strokeNonScaling = false, // Default strokeNonScaling
    fillRule = "nonzero", // Default fillRule
    individualLetters = false,
  } = req.body;
  const config = [
    text,
    fontName,
    size,
    union,
    filled,
    kerning,
    separate,
    bezierAccuracy,
    units,
    fill,
    stroke,
    strokeWidth,
    strokeNonScaling,
    fillRule,
    individualLetters,
    res,
  ];
  const apiKey = "AIzaSyAOES8EmKhuJEnsn9kS1XKBpxxp-TgN8Jc"; // Use environment variable for API key

  try {
    // Fetch the list of fonts from Google Fonts API
    const response = await axios.get(
      `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}`
    );
    const fonts = response.data.items;

    // Find the font with the given name
    const fontDetails = fonts.find((f) => f.family === fontName);
    if (!fontDetails) {
      return res.status(404).send("Font not found");
    }

    // Load the font using opentype.js
    let fontUrl = fontDetails.files.regular; // Adjust based on font variants if needed
    fontUrl = fontUrl.replace("http", "https");
    const fontPath = await downloadAndSaveFont(fontUrl);

    opentype.load(fontPath, (err, loadedFont) => {
      handleRequest(err, loadedFont, config);
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/predictions", async (req, res) => {
  const { input, path } = req.body;
  const headers = {
    "Content-Type": "application/json",
    // Add any other headers here
  };
  const data = {
    input: input,
    is_training: false,
    create_model: "0",
    stream: false,
  };
  try {
    const response = await axios.post(
      `https://replicate.com/api/${path}/predictions`,
      data,
      { headers }
    );
    return res.json(response.data);
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Route handler for /vectorize
app.post("/vectorize", (req, res) => {
  const { imageUrl } = req.body;
  // Extract imageUrl from request body

  // Call getImageOutline to get the polygon data
  getImageOutline(imageUrl, function (err, polygon) {
    if (err) {
      console.error("Error:", err);
      return res.status(500).json({ error: "Error vectorizing image" });
    }

    // Convert polygon data to SVG path
    const svgPath = polygonToSVGPath(polygon);

    // Send the SVG path back to the client as JSON
    res.json({ svgPath });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
