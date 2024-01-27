const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

app.get('/', async (req, res) => {
  try {
    const queryParam = req.query.query;
    const prompts = req.query.prompts;

    const headers = {
        'authority': 'lexica.art',
        'accept': 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'Cookie': '__Host-next-auth.csrf-token=0a5027ec7a9c006dd28b3c98f9c66d678daad62039ecd90fbf65a28f320ceed2%7C1d772410a39f4388fe41221b0a34eab40b9cf6983b47f756199ca1e40258d986; __Secure-next-auth.callback-url=https%3A%2F%2Flexica.art; __Secure-next-auth.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..tqQ2tRiypPrR6Yx6.UgblBLIGGccLY_mSGFQvYg3I5xzmCo9bp_M_GsuGRRAa29xvaqHrFiGs-RAbdbdSEquP6-NGHziDx3iKEEl2wPISS4DE2mHxaiCgWHxgrYzcvvneg2ZG67JALFkdiWcmhwjcA48dZ_JX6zb5tOJcJV6t-_aTxhoniuXzcjXu7qSIdLXE0xY1cAq_CKJB1xfXKlAxndCNkGt3EmA_S2GMCub0RAopK4r2e7rrPuUWWoKcZ7NUBfi56mgFymvz2cG5bd2MPwG2zb1RO-mF0JwrglCZ_PksGlC2roduylvavj51ZM2Pwo52cwJ29ngYzg2hsMhaBswGoqRoyznuD6_WKPiSZivAee7MMyVrDCOyYqrery2FVjeapt72zP0S7n3YRp-iV5eQxmHjpgbFIEgn.sj9wKm30l__oBZhFoYSoRw',
    };

    const targetURL = 'https://lexica.art/api/infinite-prompts';
    let requestBody = {
      text: queryParam,
      model: 'lexica-aperture-v3.5',
      searchMode: 'images',
      source: 'search',
      cursor: 0,
    };

    // Using Axios for the HTTP request
    let response = await axios.post(targetURL, requestBody, { headers });

    if (prompts) {
      let temp_prompts = response.data.prompts;
      requestBody.cursor = 50;
      response = await axios.post(targetURL, requestBody, { headers });
      temp_prompts = [...response.data.prompts, ...temp_prompts];
      res.json(temp_prompts);
    } else {
      const jsonResponse = response.data;
      const images = [...jsonResponse.prompts.map(prompt => prompt.images).flat(), ...jsonResponse.images];

      let uniqueListOfObjects = images.filter((obj, index, self) => {
        return self.findIndex((otherObj) => areObjectsEqual(obj, otherObj)) === index;
      });

      res.json(uniqueListOfObjects);
    }
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

function areObjectsEqual(obj1, obj2) {
  return JSON.stringify(obj1) === JSON.stringify(obj2);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
