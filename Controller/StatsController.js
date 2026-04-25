/**
 * Controller/StatsController.js
 *
 * Endpoints :
 *   POST /api/track/pageview              — enregistrer une vue de page (token optionnel)
 *   GET  /api/admin/stats/overview        — vue d'ensemble 30 derniers jours
 *   GET  /api/admin/stats/logins          — historique connexions paginé
 *   GET  /api/admin/stats/pageviews       — stats par page
 */

const LoginHistory = require('../Models/LoginHistory');
const PageView     = require('../Models/PageView');
const User         = require('../Models/User');
const { collectTrackingInfo } = require('../Utils/trackingHelper');

// ─── POST /api/track/pageview ─────────────────────────────────────────────────
module.exports.trackPageView = async (req, res) => {
  try {
    const { path, userId } = req.body;
    if (!path) return res.status(400).json({ success: false, message: 'path requis' });

    const info = collectTrackingInfo(req);
    await PageView.create({ userId: userId || null, path, ...info });

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error('Erreur trackPageView:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ─── GET /api/admin/stats/overview ────────────────────────────────────────────
module.exports.getStatsOverview = async (req, res) => {
  try {
    const now          = new Date();
    const d30          = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const d14          = new Date(now - 14 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalLogins30d,
      failedLogins30d,
      uniqueIPsArr,
      totalPageViews30d,
      topCountries,
      topPages,
      loginsByDay,
      lastLogins,
    ] = await Promise.all([
      // Nombre d'actionnaires
      User.countDocuments({ role: { $in: ['actionnaire', 'actionnaire3'] } }),

      // Connexions 30j
      LoginHistory.countDocuments({ createdAt: { $gte: d30 } }),

      // Échecs 30j
      LoginHistory.countDocuments({ status: 'failed', createdAt: { $gte: d30 } }),

      // IPs uniques 30j
      LoginHistory.distinct('ipAddress', { createdAt: { $gte: d30 }, ipAddress: { $ne: null } }),

      // Pages vues 30j
      PageView.countDocuments({ createdAt: { $gte: d30 } }),

      // Top 5 pays (logins)
      LoginHistory.aggregate([
        { $match: { createdAt: { $gte: d30 }, country: { $nin: [null, 'Local'] } } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),

      // Top 10 pages
      PageView.aggregate([
        { $match: { createdAt: { $gte: d30 } } },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // Connexions par jour (14j)
      LoginHistory.aggregate([
        { $match: { createdAt: { $gte: d14 } } },
        {
          $group: {
            _id:     { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            total:   { $sum: 1 },
            success: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
            failed:  { $sum: { $cond: [{ $eq: ['$status', 'failed']  }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),

      // 10 dernières connexions
      LoginHistory.find().sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalLogins30d,
        failedLogins30d,
        uniqueIPs30d:     uniqueIPsArr.length,
        totalPageViews30d,
        topCountries:     topCountries.map(c => ({ country: c._id, count: c.count })),
        topPages:         topPages.map(p => ({ path: p._id, count: p.count })),
        loginsByDay,
        lastLogins,
      },
    });
  } catch (error) {
    console.error('Erreur getStatsOverview:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ─── GET /api/admin/stats/logins ─────────────────────────────────────────────
module.exports.getLoginHistory = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = {};
    if (req.query.status)  filter.status = req.query.status;
    if (req.query.userId)  filter.userId = req.query.userId;
    if (req.query.from || req.query.to) {
      filter.createdAt = {};
      if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
      if (req.query.to)   filter.createdAt.$lte = new Date(req.query.to);
    }

    const [data, total] = await Promise.all([
      LoginHistory.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LoginHistory.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Erreur getLoginHistory:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ─── GET /api/admin/stats/pageviews ──────────────────────────────────────────
module.exports.getPageViewStats = async (req, res) => {
  try {
    const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byPath, byDay] = await Promise.all([
      PageView.aggregate([
        { $match: { createdAt: { $gte: d30 } } },
        {
          $group: {
            _id:       '$path',
            count:     { $sum: 1 },
            uniqueIPs: { $addToSet: '$ipAddress' },
          },
        },
        {
          $project: {
            path:           '$_id',
            count:          1,
            uniqueVisitors: { $size: '$uniqueIPs' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),

      PageView.aggregate([
        { $match: { createdAt: { $gte: d30 } } },
        {
          $group: {
            _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return res.status(200).json({ success: true, data: { byPath, byDay } });
  } catch (error) {
    console.error('Erreur getPageViewStats:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};
