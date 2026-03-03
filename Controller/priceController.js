const Price = require('../Models/Price');
const VIPUser = require('../Models/VIPUser');

// Obtenir tous les prix
exports.getAllPrices = async (req, res) => {
  try {
    const prices = await Price.find();
    res.status(200).json({
      success: true,
      data: prices
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des prix",
      error: error.message
    });
  }
};

// Obtenir un prix par type
exports.getPriceByType = async (req, res) => {
  try {
    const { type } = req.params;
    const price = await Price.findOne({ type: type.toUpperCase() });
    
    if (!price) {
      return res.status(404).json({
        success: false,
        message: "Prix non trouvé"
      });
    }

    res.status(200).json({
      success: true,
      data: price
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération du prix",
      error: error.message
    });
  }
};

// Créer ou mettre à jour un prix
exports.upsertPrice = async (req, res) => {
  try {
    const { type, prix_unitaire, description, actif } = req.body;

    if (!type || !prix_unitaire) {
      return res.status(400).json({
        success: false,
        message: "Le type et le prix unitaire sont requis"
      });
    }

    const price = await Price.findOneAndUpdate(
      { type: type.toUpperCase() },
      {
        prix_unitaire,
        description,
        actif: actif !== undefined ? actif : true
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Prix mis à jour avec succès",
      data: price
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la mise à jour du prix",
      error: error.message
    });
  }
};

// Supprimer un prix
exports.deletePrice = async (req, res) => {
  try {
    const { type } = req.params;
    const price = await Price.findOneAndDelete({ type: type.toUpperCase() });

    if (!price) {
      return res.status(404).json({
        success: false,
        message: "Prix non trouvé"
      });
    }

    res.status(200).json({
      success: true,
      message: "Prix supprimé avec succès"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la suppression du prix",
      error: error.message
    });
  }
};

// Gestion des utilisateurs VIP

// Obtenir tous les utilisateurs VIP
exports.getAllVIPUsers = async (req, res) => {
  try {
    const vipUsers = await VIPUser.find();
    res.status(200).json({
      success: true,
      count: vipUsers.length,
      data: vipUsers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des utilisateurs VIP",
      error: error.message
    });
  }
};

// Ajouter un utilisateur VIP
exports.addVIPUser = async (req, res) => {
  try {
    const { telephone, nom, notes } = req.body;

    if (!telephone) {
      return res.status(400).json({
        success: false,
        message: "Le numéro de téléphone est requis"
      });
    }

    const vipUser = await VIPUser.create({
      telephone,
      nom,
      notes
    });

    res.status(201).json({
      success: true,
      message: "Utilisateur VIP ajouté avec succès",
      data: vipUser
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Ce numéro existe déjà dans la liste VIP"
      });
    }
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'ajout de l'utilisateur VIP",
      error: error.message
    });
  }
};

// Supprimer un utilisateur VIP
exports.removeVIPUser = async (req, res) => {
  try {
    const { telephone } = req.params;
    const vipUser = await VIPUser.findOneAndDelete({ telephone });

    if (!vipUser) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur VIP non trouvé"
      });
    }

    res.status(200).json({
      success: true,
      message: "Utilisateur VIP supprimé avec succès"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la suppression de l'utilisateur VIP",
      error: error.message
    });
  }
};

// Vérifier si un numéro est VIP
exports.checkVIPStatus = async (req, res) => {
  try {
    const { telephone } = req.params;
    const vipUser = await VIPUser.findOne({ telephone, actif: true });

    res.status(200).json({
      success: true,
      isVIP: !!vipUser,
      data: vipUser || null
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la vérification du statut VIP",
      error: error.message
    });
  }
};