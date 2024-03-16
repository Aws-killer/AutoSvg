const express = require('express');
const cors = require('cors');
const opentype = require('opentype.js');
const makerjs = require('makerjs');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended: true}));


function handleRequest(err, loadedFont, config) {
    const [text, fontName, size, union, filled, kerning, separate, bezierAccuracy, units, fill, stroke, strokeWidth, strokeNonScaling, fillRule, individualLetters, res] = config;

    if (err) {
        console.error('Font could not be loaded:', err);
        return res.status(500).json({error: err.message});
    }

    if (individualLetters) { // Generate individual SVGs for each letter and store them in a JSON object
        const individualSVGs = {};
        for (let i = 0; i < text.length; i++) {
            const letter = text[i];
            const result = callMakerjs(loadedFont, letter, size, union, filled, kerning, separate, bezierAccuracy, units, fill, stroke, strokeWidth, strokeNonScaling, fillRule);
            individualSVGs[letter] = result.svg;
        }
        res.status(200).json(individualSVGs); // Return JSON object
    } else { // Generate a single SVG for the entire text
        const result = callMakerjs(loadedFont, text, size, union, filled, kerning, separate, bezierAccuracy, units, fill, stroke, strokeWidth, strokeNonScaling, fillRule);
        res.status(200).send(result.svg);
    }
}


async function downloadAndSaveFont(fontUrl) {
    const tempDir = path.join(os.tmpdir(), 'downloaded-fonts');
    try {
        const response = await axios.get(fontUrl, {
            responseType: 'arraybuffer',
            headers: {
                'Accept-Encoding': 'identity'
            }
        });
        let filename;

        // Try to extract filename from Content-Disposition header
        const contentDisposition = response.headers['content-disposition'];
        if (contentDisposition) {
            const matches = /filename=(['"]?)(.+)\1/.exec(contentDisposition);
            if (matches.length === 3) {
                filename = matches[2];
            }
        }

        // If filename not found in header, extract from URL
        if (! filename) {
            const urlParts = fontUrl.split('/');
            filename = urlParts[urlParts.length - 1];
        }

        // Save the font file
        const fontPath = path.join(tempDir, filename);
        fs.writeFileSync(fontPath, response.data);
        return fontPath;
    } catch (error) {
        console.error('Error downloading the font:', error);
        throw error;
    }
}


function callMakerjs(font, text, size, union, filled, kerning, separate, bezierAccuracy, units, fill, stroke, strokeWidth, strokeNonScaling, fillRule) { // Generate the text using a font
    var textModel = new makerjs.models.Text(font, text, size, union, false, bezierAccuracy, {kerning});

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
        scalingStroke: ! strokeNonScaling
    });

    var dxf = makerjs.exporter.toDXF(textModel, {
        units: units,
        usePOLYLINE: true
    });

    return {svg, dxf};
}

app.post('/generateSVGPath', async (req, res) => { // Set default values
    const {
        text,
        size = 72, // Default font size
        union = false,
        filled = true,
        kerning = true,
        separate = false,
        bezierAccuracy = 2,
        units = 'mm', // Default units
        fill = 'black', // Default fill color
        stroke = 'none', // Default stroke color
        strokeWidth = '1', // Default stroke width
        strokeNonScaling = false,
        fillRule = 'nonzero', // Default fill rule
        fontUrl,
        individualLetters = false,
        font = 'Roobert-Regular.ttf' // Default local font
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
        res
    ]

    const fontPath = fontUrl ? await downloadAndSaveFont(fontUrl) : path.join(__dirname, 'fonts', font);

    opentype.load(fontPath, (err, loadedFont) => {
        handleRequest(err, loadedFont, config);
    });
});


app.post('/generateSVGPathWithGoogleFont', async (req, res) => { // Default values for parameters
    const {
        text,
        fontName = 'Open Sans', // Default Google Font
        size = 72, // Default font size
        union = false, // Default union
        filled = true, // Default filled
        kerning = true, // Default kerning
        separate = false, // Default separate
        bezierAccuracy = 2, // Default bezierAccuracy
        units = 'mm', // Default units
        fill = 'black', // Default fill color
        stroke = 'none', // Default stroke
        strokeWidth = '1', // Default stroke width
        strokeNonScaling = false, // Default strokeNonScaling
        fillRule = 'nonzero', // Default fillRule
        individualLetters = false
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
        res
    ]
    const apiKey = 'AIzaSyAOES8EmKhuJEnsn9kS1XKBpxxp-TgN8Jc'; // Use environment variable for API key

    try { // Fetch the list of fonts from Google Fonts API
        const response = await axios.get(`https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}`);
        const fonts = response.data.items;

        // Find the font with the given name
        const fontDetails = fonts.find(f => f.family === fontName);
        if (! fontDetails) {
            return res.status(404).send('Font not found');
        }


        // Load the font using opentype.js
        let fontUrl = fontDetails.files.regular; // Adjust based on font variants if needed
        fontUrl = fontUrl.replace("http", 'https')
        const fontPath = await downloadAndSaveFont(fontUrl);

        opentype.load(fontPath, (err, loadedFont) => {
            handleRequest(err, loadedFont, config);
        });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({error: error.message});
    }
});

app.post('/predictions', async (req, res) => {
    const { input, version } = await req.body;
    const data = {
        "input": input,
        "is_training": false,
        "create_model": "0",
        "stream": false,
        "version": version
    };
    try {
        const response = await fetch('https://replicate.com/api/predictions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add any necessary headers here
            },
            body: JSON.stringify(data),
        });
        return res.json(response);
    } catch (error) {
        console.error('Error:', error);
        return res.status(500).json({ error: error.message });
    }
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
