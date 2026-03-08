const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const { parseFile, extractMappedData } = require('../services/fileParser');
const { getAllProducts } = require('../services/salla');

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم'));
    }
  }
});

// POST /api/products/upload - Upload file and parse headers
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم رفع أي ملف.' });
  }

  try {
    const { headers, rows, totalRows } = parseFile(req.file.path, req.file.originalname);

    // Store file info in session
    req.session.uploadedFile = {
      path: req.file.path,
      originalName: req.file.originalname,
      totalRows,
      headers
    };

    // Preview first row as sample data
    const sampleRow = rows[0] || {};

    res.json({
      success: true,
      filename: req.file.originalname,
      totalRows,
      headers,
      sampleRow,
      fileType: path.extname(req.file.originalname).toUpperCase().replace('.', '')
    });
  } catch (err) {
    // Clean up file on error
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message });
  }
});

// POST /api/products/preview - Apply column mapping and fetch products for comparison
router.post('/preview', requireAuth, async (req, res) => {
  const { skuCol, priceCol, quantityCol } = req.body;

  if (!skuCol) {
    return res.status(400).json({ error: 'يجب تحديد عمود SKU.' });
  }

  const fileInfo = req.session.uploadedFile;
  if (!fileInfo) {
    return res.status(400).json({ error: 'لم يتم رفع ملف. يرجى البدء من الخطوة الأولى.' });
  }

  try {
    const { parseFile } = require('../services/fileParser');
    const { rows } = parseFile(fileInfo.path, fileInfo.originalName);

    // Extract mapped data
    const mappedItems = extractMappedData(rows, { skuCol, priceCol, quantityCol });

    if (mappedItems.length === 0) {
      return res.status(400).json({ error: 'لم يتم العثور على صفوف صالحة في الملف.' });
    }

    // Fetch all products from Salla
    const sallaProducts = await getAllProducts(req.session.accessToken);

    // Build SKU map
    const skuMap = {};
    sallaProducts.forEach(product => {
      if (product.sku) skuMap[product.sku] = product;
    });

    // Compare and build preview items
    const previewItems = [];
    let matchedCount = 0;
    let willUpdateCount = 0;
    let noChangeCount = 0;
    let notFoundCount = 0;

    mappedItems.forEach(item => {
      const product = skuMap[item.sku];

      if (!product) {
        notFoundCount++;
        previewItems.push({
          sku: item.sku,
          productName: '-',
          oldPrice: null,
          newPrice: item.newPrice ?? null,
          oldQuantity: null,
          newQuantity: item.newQuantity ?? null,
          status: 'not_found'
        });
        return;
      }

      matchedCount++;
      const oldPrice = product.price?.amount ?? null;
      const oldQuantity = product.quantity ?? null;
      const newPrice = item.newPrice ?? null;
      const newQuantity = item.newQuantity ?? null;

      const priceChanged = newPrice !== null && newPrice !== oldPrice;
      const quantityChanged = newQuantity !== null && newQuantity !== oldQuantity;
      const willUpdate = priceChanged || quantityChanged;

      if (willUpdate) {
        willUpdateCount++;
      } else {
        noChangeCount++;
      }

      previewItems.push({
        sku: item.sku,
        productId: product.id,
        productName: product.name,
        oldPrice,
        newPrice,
        oldQuantity,
        newQuantity,
        status: willUpdate ? 'will_update' : 'no_change'
      });
    });

    // Store preview data in session
    req.session.previewData = {
      mapping: { skuCol, priceCol, quantityCol },
      stats: {
        totalRows: mappedItems.length,
        matched: matchedCount,
        willUpdate: willUpdateCount,
        noChange: noChangeCount,
        notFound: notFoundCount
      },
      items: previewItems
    };

    res.json({
      success: true,
      stats: req.session.previewData.stats,
      previewItems: previewItems.slice(0, 50) // first 50 for display
    });
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء معالجة البيانات: ' + err.message });
  }
});

// GET /api/products/preview/download - Download full comparison report as CSV
router.get('/preview/download', requireAuth, (req, res) => {
  const previewData = req.session.previewData;
  if (!previewData) {
    return res.status(400).json({ error: 'لا توجد بيانات معاينة.' });
  }

  const { items } = previewData;
  const statusMap = {
    will_update: 'سيتم التحديث',
    no_change: 'لا يوجد تغيير',
    not_found: 'SKU غير موجود'
  };

  const csvRows = [
    ['SKU', 'اسم المنتج', 'السعر الحالي', 'السعر الجديد', 'الكمية الحالية', 'الكمية الجديدة', 'الحالة'],
    ...items.map(item => [
      item.sku,
      item.productName,
      item.oldPrice ?? '',
      item.newPrice ?? '',
      item.oldQuantity ?? '',
      item.newQuantity ?? '',
      statusMap[item.status] || item.status
    ])
  ];

  const csvContent = '\uFEFF' + csvRows.map(row =>
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="preview-report.csv"');
  res.send(csvContent);
});

module.exports = router;
