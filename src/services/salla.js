const axios = require('axios');

const SALLA_API_URL = process.env.SALLA_API_URL || 'https://api.salla.dev/admin/v2';
const RATE_LIMIT_DELAY = 250; // ms between requests (4 req/sec to stay safe)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAllProducts(accessToken) {
  const products = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await axios.get(`${SALLA_API_URL}/products`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { page, per_page: 100 }
      });

      const data = response.data;
      const items = data.data || [];
      products.push(...items);

      const pagination = data.pagination || {};
      hasMore = page < (pagination.totalPages || 1);
      page++;

      if (hasMore) await sleep(RATE_LIMIT_DELAY);
    } catch (err) {
      if (err.response && err.response.status === 429) {
        await sleep(2000);
        // retry same page
      } else {
        throw err;
      }
    }
  }

  return products;
}

async function getProductBySKU(accessToken, sku) {
  try {
    const response = await axios.get(`${SALLA_API_URL}/products`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { sku, per_page: 1 }
    });
    const items = response.data.data || [];
    return items.find(p => p.sku === sku) || null;
  } catch {
    return null;
  }
}

async function updateProduct(accessToken, productId, updates) {
  await sleep(RATE_LIMIT_DELAY);
  const response = await axios.put(
    `${SALLA_API_URL}/products/${productId}`,
    updates,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return response.data;
}

async function getMerchantInfo(accessToken) {
  const response = await axios.get(`${SALLA_API_URL}/store/info`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return response.data.data;
}

module.exports = { getAllProducts, getProductBySKU, updateProduct, getMerchantInfo, sleep, RATE_LIMIT_DELAY };
