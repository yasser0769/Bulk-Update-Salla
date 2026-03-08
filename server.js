require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./src/routes/auth');
const productsRoutes = require('./src/routes/products');
const jobsRoutes = require('./src/routes/jobs');
const { initDB } = require('./src/services/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'salla-bulk-update-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Routes
app.use('/auth', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/jobs', jobsRoutes);

// Serve main app
app.get('/', (req, res) => {
  if (!req.session.accessToken) {
    return res.redirect('/auth/login');
  }
  res.redirect('/pages/upload.html');
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database and start server
initDB();
app.listen(PORT, () => {
  console.log(`Salla Bulk Update app running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT}`);
});
