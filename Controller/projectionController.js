const Projection = require("../Models/Projection");

exports.addProjection = async (req, res) => {
  try {
    const { users, revenue, expenses, shares } = req.body;
    const profit = revenue - expenses;
    const dividend = profit / (shares || 100000);

    const projection = new Projection({
      users,
      revenue,
      expenses,
      shares,
    });

    await projection.save();

    res.status(201).json({
      message: "Projection enregistrée",
      data: {
        users,
        revenue,
        expenses,
        profit,
        dividend,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getAllProjections = async (req, res) => {
  try {
    const projections = await Projection.find();
    res.status(200).json(projections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.projectFuture = async (req, res) => {
  try {
    const { fromYear, toYear, projectedUsers } = req.body;

    if (!fromYear || !toYear || !projectedUsers) {
      return res.status(400).json({
        message: "fromYear, toYear et projectedUsers sont requis.",
      });
    }

    const startDate = new Date(`${fromYear}-01-01`);
    const endDate = new Date(`${fromYear}-12-31T23:59:59`);

    const fromProjection = await Projection.findOne({
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: -1 });

    if (!fromProjection) {
      return res.status(404).json({
        message: `Aucune projection trouvée pour l'année ${fromYear}.`,
      });
    }

    const {
      users: currentUsers,
      revenue: currentRevenue,
      expenses: currentExpenses,
      shares = 100000,
    } = fromProjection;

    const growthFactor = projectedUsers / currentUsers;
    const projectedRevenue = currentRevenue * growthFactor * 2;
    const projectedExpenses = projectedRevenue / 6;
    const projectedProfit = projectedRevenue - projectedExpenses;
    const projectedDividend = projectedProfit / shares;

    // Sauvegarder la projection future dans MongoDB
    const futureProjection = new Projection({
      users: projectedUsers,
      revenue: projectedRevenue,
      expenses: projectedExpenses,
      shares: shares,
      date: new Date(`${toYear}-12-31`)
    });

    await futureProjection.save();

    res.status(200).json({
      fromYear,
      toYear,
      growthFactor,
      current: {
        users: currentUsers,
        revenue: currentRevenue,
        expenses: currentExpenses,
        profit: currentRevenue - currentExpenses,
      },
      projection: {
        users: projectedUsers,
        revenue: projectedRevenue,
        expenses: projectedExpenses,
        profit: projectedProfit,
        dividendPerAction: projectedDividend,
      },
      message: "Projection future enregistrée avec succès."
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
