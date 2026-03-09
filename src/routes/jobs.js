const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../services/database');
const { updateProduct, sleep, RATE_LIMIT_DELAY } = require('../services/salla');

const SALLA_TOKEN_URL = process.env.SALLA_TOKEN_URL || 'https://accounts.salla.sa/oauth2/token';
const CLIENT_ID = process.env.SALLA_CLIENT_ID;
const CLIENT_SECRET = process.env.SALLA_CLIENT_SECRET;

// Active job tracking (in-memory for progress updates)
const activeJobs = {};

async function refreshAccessToken(refreshToken) {
  const tokenResponse = await axios.post(
    SALLA_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, refresh_token, expires_in } = tokenResponse.data;
  return {
    accessToken: access_token,
    refreshToken: refresh_token || refreshToken,
    tokenExpiry: Date.now() + (expires_in || 3600) * 1000
  };
}

async function updateProductWithRetry(tokenState, productId, updates) {
  try {
    return await updateProduct(tokenState.accessToken, productId, updates);
  } catch (err) {
    const status = err.response?.status;

    if (status === 401 && tokenState.refreshToken) {
      const refreshed = await refreshAccessToken(tokenState.refreshToken);
      tokenState.accessToken = refreshed.accessToken;
      tokenState.refreshToken = refreshed.refreshToken;
      tokenState.tokenExpiry = refreshed.tokenExpiry;
      return await updateProduct(tokenState.accessToken, productId, updates);
    }

    if (status === 429) {
      await sleep(2000);
      return await updateProduct(tokenState.accessToken, productId, updates);
    }

    throw err;
  }
}

// POST /api/jobs/start - Start update job
router.post('/start', requireAuth, async (req, res) => {
  const previewData = req.session.previewData;
  const fileInfo = req.session.uploadedFile;

  if (!previewData) {
    return res.status(400).json({ error: 'لا توجد بيانات معاينة. يرجى البدء من الخطوة الأولى.' });
  }

  const itemsToUpdate = previewData.items.filter(i => i.status === 'will_update');
  if (itemsToUpdate.length === 0) {
    return res.status(400).json({ error: 'لا توجد منتجات تحتاج إلى تحديث.' });
  }

  const jobId = uuidv4();
  const db = getDB();
  const tokenState = {
    accessToken: req.session.accessToken,
    refreshToken: req.session.refreshToken,
    tokenExpiry: req.session.tokenExpiry
  };

  // Create job record
  db.prepare(`
    INSERT INTO jobs (id, filename, total_rows, status)
    VALUES (?, ?, ?, 'running')
  `).run(jobId, fileInfo?.originalName || 'unknown', itemsToUpdate.length);

  // Save snapshot and job items
  const insertItem = db.prepare(`
    INSERT INTO job_items (
      job_id, sku, product_id, product_name,
      old_price, new_price, old_sale_price, new_sale_price, old_cost_price, new_cost_price,
      old_quantity, new_quantity, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO snapshots (job_id, sku, product_id, old_price, old_sale_price, old_cost_price, old_quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    itemsToUpdate.forEach(item => {
      insertItem.run(jobId, item.sku, item.productId, item.productName,
        item.oldPrice, item.newPrice, item.oldSalePrice, item.newSalePrice, item.oldCostPrice, item.newCostPrice,
        item.oldQuantity, item.newQuantity);
      insertSnapshot.run(jobId, item.sku, item.productId, item.oldPrice, item.oldSalePrice, item.oldCostPrice, item.oldQuantity);
    });
  });

  insertAll();

  // Track job progress in memory
  activeJobs[jobId] = {
    total: itemsToUpdate.length,
    updated: 0,
    failed: 0,
    status: 'running'
  };

  // Store job ID in session
  req.session.currentJobId = jobId;

  // Start processing in background
  processJob(jobId, itemsToUpdate, tokenState);

  res.json({ success: true, jobId, total: itemsToUpdate.length });
});

// GET /api/jobs/:id/progress - Get job progress (SSE)
router.get('/:id/progress', requireAuth, (req, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendProgress = () => {
    const job = activeJobs[id];
    if (!job) {
      const db = getDB();
      const dbJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
      if (dbJob) {
        res.write(`data: ${JSON.stringify({
          total: dbJob.total_rows,
          updated: dbJob.updated,
          failed: dbJob.failed,
          remaining: 0,
          status: dbJob.status
        })}\n\n`);
      }
      clearInterval(interval);
      res.end();
      return;
    }

    const progress = {
      total: job.total,
      updated: job.updated,
      failed: job.failed,
      remaining: job.total - job.updated - job.failed,
      status: job.status
    };

    res.write(`data: ${JSON.stringify(progress)}\n\n`);

    if (job.status === 'completed' || job.status === 'failed') {
      clearInterval(interval);
      res.end();
    }
  };

  sendProgress();
  const interval = setInterval(sendProgress, 500);

  req.on('close', () => {
    clearInterval(interval);
  });
});

// GET /api/jobs/:id/status - Get job status
router.get('/:id/status', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDB();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  const failedItems = db.prepare(`
    SELECT
      sku, product_name,
      old_price, new_price, old_sale_price, new_sale_price, old_cost_price, new_cost_price,
      old_quantity, new_quantity, error_message
    FROM job_items
    WHERE job_id = ? AND status = 'failed'
  `).all(id);

  res.json({ ...job, failedItems });
});

// GET /api/jobs - List all jobs
router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const jobs = db.prepare(`
    SELECT * FROM jobs ORDER BY created_at DESC LIMIT 20
  `).all();

  res.json({ jobs });
});

// POST /api/jobs/:id/undo - Undo a job
router.post('/:id/undo', requireAuth, async (req, res) => {
  const { id } = req.params;
  const db = getDB();

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) {
    return res.status(404).json({ error: 'العملية غير موجودة.' });
  }

  const snapshots = db.prepare('SELECT * FROM snapshots WHERE job_id = ?').all(id);
  if (snapshots.length === 0) {
    return res.status(400).json({ error: 'لا توجد بيانات للتراجع.' });
  }

  const tokenState = {
    accessToken: req.session.accessToken,
    refreshToken: req.session.refreshToken,
    tokenExpiry: req.session.tokenExpiry
  };
  const undoJobId = uuidv4();

  db.prepare(`
    INSERT INTO jobs (id, filename, total_rows, status)
    VALUES (?, ?, ?, 'running')
  `).run(undoJobId, `undo-${id}`, snapshots.length);

  activeJobs[undoJobId] = {
    total: snapshots.length,
    updated: 0,
    failed: 0,
    status: 'running'
  };

  req.session.currentJobId = undoJobId;

  // Process undo in background
  processUndo(undoJobId, snapshots, tokenState, db);

  res.json({ success: true, jobId: undoJobId, total: snapshots.length });
});

// GET /api/jobs/:id/results/download - Download results CSV
router.get('/:id/results/download', requireAuth, (req, res) => {
  const { id } = req.params;
  const db = getDB();

  const items = db.prepare('SELECT * FROM job_items WHERE job_id = ?').all(id);

  const statusMap = {
    updated: 'تم التحديث',
    failed: 'فشل',
    skipped: 'تم التجاهل',
    pending: 'معلق'
  };

  const csvRows = [
    ['SKU', 'اسم المنتج', 'سعر المنتج القديم', 'سعر المنتج الجديد', 'سعر التخفيض القديم', 'سعر التخفيض الجديد', 'سعر التكلفة القديم', 'سعر التكلفة الجديد', 'الكمية القديمة', 'الكمية الجديدة', 'الحالة', 'سبب الفشل'],
    ...items.map(item => [
      item.sku, item.product_name,
      item.old_price ?? '', item.new_price ?? '',
      item.old_sale_price ?? '', item.new_sale_price ?? '',
      item.old_cost_price ?? '', item.new_cost_price ?? '',
      item.old_quantity ?? '', item.new_quantity ?? '',
      statusMap[item.status] || item.status,
      item.error_message || ''
    ])
  ];

  const csvContent = '\uFEFF' + csvRows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="results-${id}.csv"`);
  res.send(csvContent);
});

// Background job processor
async function processJob(jobId, items, tokenState) {
  const db = getDB();
  const updateItem = db.prepare(`
    UPDATE job_items SET status = ?, error_message = ? WHERE job_id = ? AND sku = ?
  `);
  const updateJob = db.prepare(`
    UPDATE jobs SET updated = ?, failed = ?, status = ?, completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let updated = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const updates = {};
      if (item.newPrice !== null && item.newPrice !== undefined) {
        // Salla expects price as a number, not a nested amount object.
        updates.price = item.newPrice;
      }
      if (item.newSalePrice !== null && item.newSalePrice !== undefined) {
        updates.sale_price = item.newSalePrice;
      }
      if (item.newCostPrice !== null && item.newCostPrice !== undefined) {
        updates.cost_price = item.newCostPrice;
      }
      if (item.newQuantity !== null && item.newQuantity !== undefined) {
        updates.quantity = item.newQuantity;
      }

      await updateProductWithRetry(tokenState, item.productId, updates);
      updateItem.run('updated', null, jobId, item.sku);
      updated++;
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || 'خطأ غير معروف';
      updateItem.run('failed', errorMsg, jobId, item.sku);
      failed++;
    }

    activeJobs[jobId].updated = updated;
    activeJobs[jobId].failed = failed;

    await sleep(RATE_LIMIT_DELAY);
  }

  const finalStatus = failed === items.length ? 'failed' : 'completed';
  updateJob.run(updated, failed, finalStatus, jobId);
  activeJobs[jobId].status = finalStatus;

  // Clean up after 5 minutes
  setTimeout(() => { delete activeJobs[jobId]; }, 5 * 60 * 1000);
}

// Background undo processor
async function processUndo(jobId, snapshots, tokenState, db) {
  const updateJob = db.prepare(`
    UPDATE jobs SET updated = ?, failed = ?, status = ?, completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let updated = 0;
  let failed = 0;

  for (const snapshot of snapshots) {
    try {
      const updates = {};
      if (snapshot.old_price !== null) {
        // Keep undo payload aligned with update payload contract.
        updates.price = snapshot.old_price;
      }
      if (snapshot.old_sale_price !== null && snapshot.old_sale_price !== undefined) {
        updates.sale_price = snapshot.old_sale_price;
      }
      if (snapshot.old_cost_price !== null && snapshot.old_cost_price !== undefined) {
        updates.cost_price = snapshot.old_cost_price;
      }
      if (snapshot.old_quantity !== null) {
        updates.quantity = snapshot.old_quantity;
      }

      await updateProductWithRetry(tokenState, snapshot.product_id, updates);
      updated++;
    } catch (err) {
      console.error('Undo item failed:', snapshot.sku, err.response?.data || err.message);
      failed++;
    }

    activeJobs[jobId].updated = updated;
    activeJobs[jobId].failed = failed;

    await sleep(RATE_LIMIT_DELAY);
  }

  const finalStatus = failed === snapshots.length ? 'failed' : 'completed';
  updateJob.run(updated, failed, finalStatus, jobId);
  activeJobs[jobId].status = finalStatus;

  setTimeout(() => { delete activeJobs[jobId]; }, 5 * 60 * 1000);
}

module.exports = router;
