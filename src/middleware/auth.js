function requireAuth(req, res, next) {
  if (!req.session.accessToken) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'غير مصرح. يرجى تسجيل الدخول أولاً.' });
    }
    return res.redirect('/auth/login');
  }
  next();
}

module.exports = { requireAuth };
