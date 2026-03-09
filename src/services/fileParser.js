const XLSX = require('xlsx');
const { parse } = require('csv-parse/sync');
const fs = require('fs');

function parseFile(filePath, originalName) {
  const ext = originalName.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    return parseCSV(filePath);
  } else if (ext === 'xls' || ext === 'xlsx') {
    return parseExcel(filePath);
  } else {
    throw new Error('نوع الملف غير مدعوم. يرجى رفع ملف CSV أو Excel.');
  }
}

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true
  });

  if (records.length === 0) {
    throw new Error('الملف فارغ أو لا يحتوي على بيانات.');
  }

  const headers = Object.keys(records[0]);
  return { headers, rows: records, totalRows: records.length };
}

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  if (jsonData.length === 0) {
    throw new Error('الملف فارغ أو لا يحتوي على بيانات.');
  }

  const headers = Object.keys(jsonData[0]);
  const rows = jsonData.map(row => {
    const normalizedRow = {};
    headers.forEach(h => {
      normalizedRow[h] = String(row[h] ?? '').trim();
    });
    return normalizedRow;
  });

  return { headers, rows, totalRows: rows.length };
}

function extractMappedData(rows, mapping) {
  const { skuCol, priceCol, salePriceCol, costPriceCol, quantityCol } = mapping;

  return rows.map((row, index) => {
    const sku = String(row[skuCol] || '').trim();
    const item = { rowIndex: index + 2, sku };

    if (priceCol && row[priceCol] !== undefined && row[priceCol] !== '') {
      const price = parseDecimal(row[priceCol]);
      if (!isNaN(price)) item.newPrice = price;
    }

    if (salePriceCol && row[salePriceCol] !== undefined && row[salePriceCol] !== '') {
      const salePrice = parseDecimal(row[salePriceCol]);
      if (!isNaN(salePrice)) item.newSalePrice = salePrice;
    }

    if (costPriceCol && row[costPriceCol] !== undefined && row[costPriceCol] !== '') {
      const costPrice = parseDecimal(row[costPriceCol]);
      if (!isNaN(costPrice)) item.newCostPrice = costPrice;
    }

    if (quantityCol && row[quantityCol] !== undefined && row[quantityCol] !== '') {
      const qty = parseInt(String(row[quantityCol]).replace(/[^0-9-]/g, ''), 10);
      if (!isNaN(qty)) item.newQuantity = qty;
    }

    return item;
  }).filter(item => item.sku);
}

function parseDecimal(value) {
  const normalized = String(value)
    .replace(/,/g, '.')
    .replace(/[^0-9.-]/g, '');
  return parseFloat(normalized);
}

module.exports = { parseFile, extractMappedData };
